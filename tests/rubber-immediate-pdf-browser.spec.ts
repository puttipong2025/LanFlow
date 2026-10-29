import { test, expect, type Page, type Download } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { selectedAppLocationId, confirmCurrentBranchIfRequired } from "./helpers/select-app-location";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";
import { assertSafeIntegrationTarget } from "./support/integration-target";

const sql = (query: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8", windowsHide: true }).trim();
function cleanup(branch: string) {
  sql(`begin;set local app.history_retention_cleanup='on';
    delete from public.cash_count_alert_groups where id='${branch}';
    delete from public.rubber_bill_approval_requests where location_id='${branch}';
    delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${branch}');
    delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
    delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
    delete from public.document_deletion_audits where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
    delete from public.locations where id='${branch}';commit;`);
}
async function open(page: Page, branch: string) {
  await installThresholdAlertHandler(page); await page.goto("/");
  await expect(async () => {
    if (await selectedAppLocationId(page) === branch) return;
    const option = page.locator(`[role="option"][data-location-id="${branch}"]`);
    if (!await option.isVisible()) await page.locator('button[data-location-id][aria-controls="location-selector-listbox"]').click({ timeout: 5000 });
    await option.click({ timeout: 5000 }); expect(await selectedAppLocationId(page)).toBe(branch);
  }).toPass({ timeout: 25000, intervals: [500, 1000] });
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await expect(page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true })).toBeVisible();
}
async function fill(page: Page, customer: string, price = "1") {
  const modal = page.getByRole("dialog", { name: /บิลเครื่องชั่งเล็ก/ });
  await expect(modal).toBeVisible();
  await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(customer);
  await page.keyboard.press("Escape");
  const row = modal.locator("table").first().locator("tbody tr").first();
  await row.locator('input[type="number"]').nth(0).fill("100");
  await row.locator('input[type="number"]').nth(1).fill("0");
  await row.locator('input[type="number"]').nth(3).fill(price);
  return modal;
}
async function add(page: Page, customer: string, price = "1") {
  await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
  await confirmCurrentBranchIfRequired(page);
  return fill(page, customer, price);
}
async function queue(page: Page) {
  return page.evaluate(() => new Promise<Array<{ payload: { localContextPending?: boolean; commandId: string }; id: string }>>((resolve, reject) => {
    const req = indexedDB.open("lanflow_sync_db"); req.onerror = () => reject(req.error);
    req.onsuccess = () => { const db = req.result; const tx = db.transaction("sync_queue");
      const read = tx.objectStore("sync_queue").getAll(); read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); };
  }));
}
async function assertPdf(download: Download) {
  const path = await download.path(); expect(path).toBeTruthy();
  const bytes = readFileSync(path!); expect(bytes.subarray(0, 5).toString()).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(1000);
}

test("create and edit share real PDFs before context and POST complete, while approval and sync do not duplicate sharing", async ({ browser }) => {
  test.setTimeout(180000); assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const branch = crypto.randomUUID(), marker = `PDF-${branch.slice(0, 8)}`;
  const release: Array<() => void> = [];
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','P${branch.slice(0, 6)}',true)`);
    const page = await context.newPage(); await open(page, branch);
    const downloads: Download[] = []; page.on("download", file => downloads.push(file));
    for (const stage of ["create", "edit"] as const) {
      let resumeGet!: () => void, resumePost!: () => void, gets = 0, posts = 0;
      const getGate = new Promise<void>(resolve => { resumeGet = resolve; release.push(resolve); });
      const postGate = new Promise<void>(resolve => { resumePost = resolve; release.push(resolve); });
      await page.route("**/api/lanflow/rubber-bills/command-context?**", async route => { gets++; await getGate; await route.continue(); });
      await page.route("**/api/lanflow/rubber-bills/queue", async route => {
        if (route.request().method() === "POST") { posts++; await postGate; } await route.continue();
      });
      if (stage === "create") await add(page, `${marker}-${stage}`);
      else {
        const row = page.getByRole("row").filter({ hasText: `${marker}-create` }).first();
        await expect(row.getByText("ซิงก์แล้ว", { exact: true })).toBeVisible({ timeout: 40000 });
        await expect(row.getByRole("button", { name: "ดูรายละเอียด", exact: true })).toHaveCount(0);
        await row.getByRole("button", { name: "แก้ไข", exact: true }).click(); await fill(page, `${marker}-${stage}`, "2");
      }
      const modal = page.getByRole("dialog", { name: /บิลเครื่องชั่งเล็ก/ });
      await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
      await expect(modal).toBeHidden();
      const count = stage === "create" ? 1 : 2;
      await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(count);
      await assertPdf(downloads[count - 1]);
      expect(posts).toBe(0);
      expect((await queue(page))[0].payload.localContextPending).toBe(true);
      expect(sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name='${marker}-${stage}'`)).toBe("0");
      resumeGet(); await expect.poll(() => posts, { timeout: 20000 }).toBe(1); expect(gets).toBe(1);
      resumePost();
      await expect.poll(() => sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name='${marker}-${stage}'`), { timeout: 40000 }).toBe("1");
      await expect.poll(async () => (await queue(page)).length, { timeout: 40000 }).toBe(0);
      expect(downloads).toHaveLength(count);
      await page.unroute("**/api/lanflow/rubber-bills/command-context?**"); await page.unroute("**/api/lanflow/rubber-bills/queue");
    }
    const approval = await add(page, `${marker}-approval`, "99999");
    await approval.getByRole("button", { name: "ส่งขออนุมัติ", exact: true }).click();
    await expect(approval).toBeHidden();
    await expect.poll(() => sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}' and request_status='pending'`), { timeout: 40000 }).toBe("1");
    expect(downloads).toHaveLength(2);
    // Existing cached policy allows ordinary offline creation and actual local PDF generation.
    await context.setOffline(true);
    const offline = await add(page, `${marker}-offline`);
    await offline.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(offline).toBeHidden();
    await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(3); await assertPdf(downloads[2]);
    expect((await queue(page)).length).toBeGreaterThan(0);
    await context.setOffline(false);
    await expect.poll(() => sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name='${marker}-offline'`), { timeout: 45000 }).toBe("1");
    expect(downloads).toHaveLength(3);
    // Exercise the native API branch with a controlled OS boundary; this is not a physical-device claim.
    await page.evaluate(() => {
      const handoffs: Array<{ name: string; signature: string }> = [];
      Object.defineProperty(window, "nativePdfHandoffs", { value: handoffs, configurable: true });
      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
      Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => {
        const file = data.files![0]; handoffs.push({ name: file.name, signature: new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5)) });
      } });
    });
    const native = await add(page, `${marker}-native`);
    await native.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "nativePdfHandoffs").length)).toBe(1);
    expect(await page.evaluate(() => Reflect.get(window, "nativePdfHandoffs")[0].signature)).toBe("%PDF-");
    await expect.poll(async () => (await queue(page)).length, { timeout: 45000 }).toBe(0);
    expect(await page.evaluate(() => Reflect.get(window, "nativePdfHandoffs").length)).toBe(1);
    expect(downloads).toHaveLength(3);
    await page.screenshot({ path: "output/rubber-immediate-pdf-browser.png", fullPage: true });
  } finally { release.forEach(resolve => resolve()); await context.close(); cleanup(branch); }
});

test("PWA offline reload permits unknown locks but retains a previously confirmed lock", async ({ browser }) => {
  test.skip(process.env.PW_PROJECT !== "pwa", "Requires the production service worker");
  test.setTimeout(180000); assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const branch = crypto.randomUUID(), marker = `PWAPDF-${branch.slice(0, 8)}`;
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','V${branch.slice(0, 6)}',true)`);
    const page = await context.newPage(); await open(page, branch);
    const warm = await add(page, `${marker}-warm`);
    await expect(warm.getByRole("button", { name: "บันทึกบิล", exact: true })).toBeEnabled();
    await warm.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30000 }).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /ออฟไลน์.*%/ })).toBeVisible();
    await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("lanflow:cash-lock:v1:")).forEach(key => localStorage.removeItem(key)));
    await context.setOffline(true); await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("alertdialog", { name: "กำลังตรวจสถานะสาขา", exact: true })).toHaveCount(0);
    const download = page.waitForEvent("download");
    const offline = await add(page, `${marker}-offline-reload`);
    await offline.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await assertPdf(await download);
    expect(await queue(page)).toHaveLength(1);
    sql(`insert into public.cash_count_alert_groups(id,due_days,lock_enabled,grace_hours,unlock_hours) values('${branch}',1,true,1,1);
      insert into public.cash_count_alert_members(location_id,group_id,joined_at) values('${branch}','${branch}',now()-interval '5 days')`);
    await context.setOffline(false);
    const confirmed = await page.request.get(`/api/lanflow/cash-counts/lock?locationId=${branch}`);
    expect(confirmed.ok()).toBe(true);
    expect((await confirmed.json()).states[0].locked).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /^ออนไลน์$/ })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("lanflow:cash-count-lock-changed")));
    await expect(page.getByRole("alertdialog", { name: "สาขาถูกล็อก", exact: true })).toBeVisible({ timeout: 15000 });
    await context.setOffline(true); await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alertdialog", { name: "สาขาถูกล็อก", exact: true })).toBeVisible({ timeout: 30000 });
  } finally { await context.close(); cleanup(branch); }
});
