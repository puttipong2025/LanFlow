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
  await expect(page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true })).toBeVisible({ timeout: 25000 });
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

test("delete retains its row and disables actions before held context and feed reads finish", async ({ browser }) => {
  test.setTimeout(600000); assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const branch = crypto.randomUUID(), marker = `DELETE-${branch.slice(0, 8)}`;
  const samples = Number(process.env.RUBBER_FEEDBACK_SAMPLES ?? 1), durations: number[] = [];
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const release: Array<() => void> = [];
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','D${branch.slice(0, 6)}',true)`);
    for (let i = 0; i < samples; i++) {
      const id = crypto.randomUUID();
      sql(`insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,revision_no,created_at,created_by_user_id,created_by_name,created_by_phone)
        select '${id}','${id}','${marker}-${i}','${marker}-${i}','${id}','synced','active','${branch}','${marker}-${i}',(clock_timestamp() at time zone 'Asia/Bangkok')::date,'${marker}-${i}','บิลเครื่องชั่งเล็ก',100,100,1,0,100,1,clock_timestamp(),id,name,phone from public.profiles where role='super_admin' limit 1`);
    }
    const page = await context.newPage(); page.setDefaultTimeout(15000); await open(page, branch);
    for (let i = 0; i < samples; i++) {
      sql(`update public.rubber_bills set created_at=clock_timestamp() where location_id='${branch}' and record_status='active'`);
      const row = page.getByRole("row").filter({ hasText: marker }).first();
      await expect(row.getByText("ซิงก์แล้ว", { exact: true })).toBeVisible({ timeout: 40000 });
      await row.getByRole("button", { name: "ลบ", exact: true }).click();
      const dialog = page.getByRole("alertdialog", { name: "ลบบิลยาง", exact: true });
      let resume!: () => void;
      const gate = new Promise<void>(resolve => { resume = resolve; release.push(resolve); });
      await page.route("**/api/lanflow/rubber-bills/command-context?**", async route => { await gate; await route.continue(); });
      await page.route("**/api/lanflow/rubber-bills/feed?**", async route => { await gate; await route.continue(); });
      const started = Date.now();
      await dialog.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 1000 });
      await expect(row.getByText("รอส่งจากเครื่อง", { exact: true })).toBeVisible({ timeout: 1000 });
      await expect(row.getByRole("button", { name: /กำลังยืนยันผล/ }).first()).toBeDisabled();
      durations.push(Date.now() - started);
      expect(sql(`select count(*) from public.rubber_bills where location_id='${branch}' and record_status='active'`)).toBe(String(samples - i));
      await page.waitForTimeout(3000); // Controlled transport hold, outside measured local feedback.
      resume();
      await page.unroute("**/api/lanflow/rubber-bills/command-context?**"); await page.unroute("**/api/lanflow/rubber-bills/feed?**");
      await expect.poll(() => sql(`select count(*) from public.rubber_bills where location_id='${branch}' and record_status='active'`), { timeout: 40000 }).toBe(String(samples - i - 1));
      await expect.poll(async () => (await queue(page)).length, { timeout: 40000 }).toBe(0);
    }
    console.log(JSON.stringify({ operation: "delete", samples: durations.length, milliseconds: durations, max: Math.max(...durations) }));
    expect(Math.max(...durations)).toBeLessThanOrEqual(1000);
  } finally { release.forEach(fn => fn()); await context.close(); cleanup(branch); }
});

test("create and edit share real PDFs before context and POST complete, while approval and sync do not duplicate sharing", async ({ browser }) => {
  test.setTimeout(600000); assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const branch = crypto.randomUUID(), marker = `PDF-${branch.slice(0, 8)}`;
  const release: Array<() => void> = [];
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','P${branch.slice(0, 6)}',true)`);
    const page = await context.newPage(); await open(page, branch);
    const downloads: Download[] = []; page.on("download", file => downloads.push(file));
    const samples = Number(process.env.RUBBER_FEEDBACK_SAMPLES ?? 1), durations: number[] = [];
    const stages: Array<"create" | "edit"> = ["create", ...Array<"edit">(samples).fill("edit")];
    for (const [sample, stage] of stages.entries()) {
      const label = `${marker}-${stage}-${sample}`;
      let resumeGet!: () => void, resumePost!: () => void, gets = 0, posts = 0;
      const getGate = new Promise<void>(resolve => { resumeGet = resolve; release.push(resolve); });
      const postGate = new Promise<void>(resolve => { resumePost = resolve; release.push(resolve); });
      await page.route("**/api/lanflow/rubber-bills/command-context?**", async route => { gets++; await getGate; await route.continue(); });
      await page.route("**/api/lanflow/rubber-bills/queue", async route => {
        if (route.request().method() === "POST") { posts++; await postGate; } await route.continue();
      });
      if (stage === "create") await add(page, label);
      else {
        sql(`update public.rubber_bills set created_at=clock_timestamp() where location_id='${branch}' and record_status='active'`);
        const row = page.getByRole("row").filter({ hasText: marker }).first();
        await expect(row.getByText("ซิงก์แล้ว", { exact: true })).toBeVisible({ timeout: 40000 });
        await expect(row.getByRole("button", { name: "ดูรายละเอียด", exact: true })).toHaveCount(0);
        await row.getByRole("button", { name: "แก้ไข", exact: true }).click(); await fill(page, label, "2");
      }
      const modal = page.getByRole("dialog", { name: /บิลเครื่องชั่งเล็ก/ });
      let resumeFeed!: () => void;
      const feedGate = new Promise<void>(resolve => { resumeFeed = resolve; release.push(resolve); });
      if (stage === "edit") await page.route("**/api/lanflow/rubber-bills/feed?**", async route => { await feedGate; await route.continue(); });
      const started = Date.now();
      await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
      await expect(modal).toBeHidden();
      if (stage === "edit") {
        const edited = page.getByRole("row").filter({ hasText: label }).first();
        await expect(edited).toBeVisible({ timeout: 1000 });
        await expect(edited.getByRole("button", { name: "กำลังยืนยันผล", exact: false }).first()).toBeDisabled({ timeout: 1000 });
        durations.push(Date.now() - started);
        await page.waitForTimeout(3000); // Feed remains held after local feedback is observed.
        resumeFeed();
        await page.unroute("**/api/lanflow/rubber-bills/feed?**");
      }
      const count = sample + 1;
      await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(count);
      await assertPdf(downloads[count - 1]);
      if (stage === "edit" && sample === samples) await downloads[count - 1].saveAs("output/rubber-feedback-edited-receipt.pdf");
      expect(posts).toBe(0);
      expect((await queue(page))[0].payload.localContextPending).toBe(true);
      expect(sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name='${label}'`)).toBe("0");
      resumeGet(); await expect.poll(() => posts, { timeout: 20000 }).toBe(1); expect(gets).toBe(1);
      resumePost();
      await expect.poll(() => sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name='${label}'`), { timeout: 40000 }).toBe("1");
      await expect.poll(async () => (await queue(page)).length, { timeout: 40000 }).toBe(0);
      expect(downloads).toHaveLength(count);
      await page.unroute("**/api/lanflow/rubber-bills/command-context?**"); await page.unroute("**/api/lanflow/rubber-bills/queue");
    }
    const pendingRow = page.getByRole("row").filter({ hasText: marker }).first();
    await expect(pendingRow.getByText("ซิงก์แล้ว", { exact: true })).toBeVisible({ timeout: 40000 });
    await pendingRow.getByRole("button", { name: "แก้ไข", exact: true }).click();
    const pendingEdit = await fill(page, `${marker}-pending-edit`, "99999");
    await pendingEdit.getByRole("button", { name: "ส่งขออนุมัติ", exact: true }).click();
    await expect(pendingEdit).toBeHidden();
    await expect.poll(() => sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}' and operation='update' and request_status='pending'`), { timeout: 40000 }).toBe("1");
    await expect.poll(async () => (await queue(page)).length, { timeout: 40000 }).toBe(0);
    await page.reload(); await open(page, branch);
    const pending = page.getByRole("row").filter({ hasText: `${marker}-pending-edit` }).first();
    await expect(pending).toBeVisible();
    await expect(pending.getByRole("button", { name: /รออนุมัติ จึงยังแก้ไขหรือลบไม่ได้/ }).first()).toBeDisabled();
    expect(downloads).toHaveLength(samples + 1);
    const approval = await add(page, `${marker}-approval`, "99999");
    await approval.getByRole("button", { name: "ส่งขออนุมัติ", exact: true }).click();
    await expect(approval).toBeHidden();
    await expect.poll(() => sql(`select count(*) from public.rubber_bill_approval_requests where location_id='${branch}' and request_status='pending'`), { timeout: 40000 }).toBe("2");
    console.log(JSON.stringify({ operation: "edit", samples: durations.length, milliseconds: durations, max: Math.max(...durations) }));
    expect(Math.max(...durations)).toBeLessThanOrEqual(1000);
    expect(downloads).toHaveLength(samples + 1);
    // Existing cached policy allows ordinary offline creation and actual local PDF generation.
    await context.setOffline(true);
    const offline = await add(page, `${marker}-offline`);
    await offline.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(offline).toBeHidden();
    await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(samples + 2); await assertPdf(downloads[samples + 1]);
    expect((await queue(page)).length).toBeGreaterThan(0);
    await context.setOffline(false);
    await expect.poll(() => sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name='${marker}-offline'`), { timeout: 45000 }).toBe("1");
    expect(downloads).toHaveLength(samples + 2);
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
    expect(downloads).toHaveLength(samples + 2);
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
