import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";
import { confirmCurrentBranchIfRequired, selectedAppLocationId } from "./helpers/select-app-location";
import { assertSafeIntegrationTarget } from "./support/integration-target";

const sql = (query: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8", windowsHide: true }).trim();
function cleanup(branch: string) {
  sql(`delete from public.rubber_bill_approval_requests where location_id='${branch}';delete from public.rubber_bills where location_id='${branch}';`);
  sql(`begin;set local app.history_retention_cleanup='on';
    delete from private.rubber_queue_jobs where location_id='${branch}';
    delete from private.rubber_bill_number_bindings where location_id='${branch}';
    delete from private.rubber_bill_suffix_counters where location_id='${branch}';
    delete from private.rubber_bill_issuer_heads where location_id='${branch}';
    delete from private.rubber_bill_issuers where location_id='${branch}';
    delete from private.rubber_bill_issuer_counters where location_id='${branch}';
    delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
    delete from public.document_deletion_audits where location_id='${branch}';
    delete from public.user_locations where location_id='${branch}';delete from public.locations where id='${branch}';commit;`);
}
async function openBranch(page: Page, branch: string) {
  await installThresholdAlertHandler(page); await page.goto("/");
  await expect(async () => {
    if (await selectedAppLocationId(page) === branch) return;
    const option = page.locator(`[role="option"][data-location-id="${branch}"]`);
    if (!await option.isVisible()) await page.locator('button[data-location-id][aria-controls="location-selector-listbox"]').click({ timeout: 5000 });
    await option.click({ timeout: 5000 }); expect(await selectedAppLocationId(page)).toBe(branch);
  }).toPass({ timeout: 30000 });
}
test("Admin manages real issuer registration and retirement at desktop and mobile widths", async ({ browser }, info) => {
  test.setTimeout(180000); assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const branch = crypto.randomUUID(), marker = `ISS-${branch.slice(0, 6)}`;
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const origin = new URL(String(info.project.use.baseURL)).origin;
  const registration = { locationId: branch, installationId: crypto.randomUUID(), generationId: crypto.randomUUID() };
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','I${branch.slice(0,6)}',true)`);
    const registered = await context.request.post("/api/lanflow/rubber-bills/issuers", { headers: { origin }, data: registration });
    expect(registered.status(), await registered.text()).toBe(200);
    const issuer = await registered.json();
    expect((await (await context.request.post("/api/lanflow/rubber-bills/issuers", { headers: { origin }, data: registration })).json()).id).toBe(issuer.id);
    const ordinary = await browser.newContext({ storageState: "playwright/.auth/admin.json" });
    try { expect((await ordinary.request.get("/api/lanflow/admin/rubber-bill-issuers")).status()).toBe(403); }
    finally { await ordinary.close(); }
    const page = await context.newPage(); await installThresholdAlertHandler(page); await page.goto("/");
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "เครื่องออกบิล", exact: true }).click();
    await page.getByLabel("กรองสาขาเครื่องออกบิล").selectOption(branch);
    const row = page.getByRole("row").filter({ has: page.getByText(issuer.code, { exact: true }) });
    await expect(row).toContainText(marker);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(row.getByRole("button", { name: "เลิกใช้งาน", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("heading", { name: "เครื่องออกบิล", exact: true }).locator("../..").screenshot({ path: info.outputPath(`issuers-${width}.png`) });
    }
    await row.getByRole("button", { name: "เลิกใช้งาน", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: `เลิกใช้งานรหัส ${issuer.code}?` });
    await expect(dialog).toBeVisible(); await expect(dialog).toContainText("ไม่ระงับการเข้าสู่ระบบ");
    await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).focus();
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
    await expect(row.getByRole("button", { name: "เลิกใช้งาน", exact: true })).toBeFocused();
    await row.getByRole("button", { name: "เลิกใช้งาน", exact: true }).click();
    await dialog.getByRole("button", { name: "ยืนยันเลิกใช้งาน" }).click();
    await expect(dialog).toBeHidden(); await expect(row).toContainText("เลิกใช้งานแล้ว");
    await page.getByLabel("กรองสถานะรหัสเครื่อง").selectOption("retired"); await expect(row).toBeVisible();
    expect((await context.request.patch("/api/lanflow/admin/rubber-bill-issuers", {
      headers: { origin }, data: { id: issuer.id.toUpperCase() },
    })).status()).toBe(200);
    expect((await context.request.get("/api/lanflow/admin/rubber-bill-issuers?locationId=")).status()).toBe(200);
    expect((await context.request.get("/api/lanflow/admin/rubber-bill-issuers?offset=2147483648")).status()).toBe(400);
    const replacement = await context.request.post("/api/lanflow/rubber-bills/issuers", { headers: { origin }, data: registration });
    expect(replacement.status(), await replacement.text()).toBe(200);
    const next = await replacement.json(); expect(next.id).not.toBe(issuer.id); expect(next.code).not.toBe(issuer.code);
  } finally { await context.close(); cleanup(branch); }
});

test("device accepts one offline base and receives the same final suffix on exact replay", async ({ browser }, info) => {
  test.setTimeout(180000); assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const branch = crypto.randomUUID(), marker = `BASE-${branch.slice(0, 6)}`;
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const origin = new URL(String(info.project.use.baseURL)).origin;
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','N${branch.slice(0,6)}',true)`);
    const page = await context.newPage(); await openBranch(page, branch);
    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
    await expect.poll(async () => page.evaluate(locationId => new Promise<boolean>(resolve => {
      const request = indexedDB.open("lanflow_sync_db"); request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("rubber_bill_numbers")) { db.close(); resolve(false); return; }
        const tx = db.transaction("rubber_bill_numbers"), read = tx.objectStore("rubber_bill_numbers").get(locationId);
        read.onsuccess = () => resolve(Boolean(read.result?.issuer)); tx.oncomplete = () => db.close();
      };
    }), branch), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
    const modal = page.getByRole("dialog", { name: /บิลเครื่องชั่งเล็ก/ }); await expect(modal).toBeVisible();
    await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(marker); await page.keyboard.press("Escape");
    const weigh = modal.locator("table").first().locator("tbody tr").first();
    await weigh.locator('input[type="number"]').nth(0).fill("10"); await weigh.locator('input[type="number"]').nth(1).fill("0");
    const settings = await (await context.request.get(`/api/lanflow/rubber-bills/approval-settings?locationId=${branch}`)).json();
    await weigh.locator('input[type="number"]').nth(3).fill(String(Math.min(1, settings.effectivePriceCap)));
    await expect(modal.getByRole("button", { name: "บันทึกบิล", exact: true })).toBeEnabled();
    if (process.env.PW_PROJECT === "pwa") {
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30000 }).toBe(true);
      await expect(page.getByRole("status").filter({ hasText: /^พร้อมใช้งานออฟไลน์ 100%$/ })).toBeVisible({ timeout: 60000 });
    }
    await context.setOffline(true);
    const download = page.waitForEvent("download"); let downloads = 0; page.on("download", () => { downloads++; });
    await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(modal).toBeHidden(); expect((await download).suggestedFilename()).toContain("D");
    const pending = await page.evaluate(() => new Promise<Array<{ payload: Record<string, unknown>; id: string }>>(resolve => {
      const request = indexedDB.open("lanflow_sync_db"); request.onsuccess = () => { const db = request.result;
        const tx = db.transaction("sync_queue"), read = tx.objectStore("sync_queue").getAll(); read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); };
    }));
    const event = pending.find(item => item.payload.customerName === marker)!;
    expect(event).toBeTruthy(); const base = String(event.payload.localBillNo); expect(base).toMatch(/^\d{4,}-\d{6}-D\d+$/);
    await expect(page.getByRole("row").filter({ hasText: marker })).toContainText(base);
    await expect(page.getByRole("row").filter({ hasText: marker }).getByText(base, { exact: true })).toHaveCount(1);
    if (process.env.PW_PROJECT === "pwa") {
      await page.reload(); await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
      await expect(page.getByRole("row").filter({ hasText: marker })).toContainText(base);
    }
    let prepared: Record<string, unknown> | undefined;
    page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/lanflow/rubber-bills/queue")) prepared = request.postDataJSON(); });
    await context.setOffline(false);
    await expect.poll(() => sql(`select server_bill_no from public.rubber_bills where location_id='${branch}' and customer_name='${marker}'`), { timeout: 60000 }).toBe(`${base}-1`);
    await expect(page.getByRole("row").filter({ hasText: marker })).toContainText(`${base}-1`, { timeout: 20000 });
    expect(prepared).toBeTruthy();
    const replay = await context.request.post("/api/lanflow/rubber-bills/queue", { headers: { origin }, data: prepared });
    expect(replay.status(), await replay.text()).toBe(200); expect((await replay.json()).result.serverBillNo).toBe(`${base}-1`);
    expect(sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name='${marker}'`)).toBe("1");
    expect(downloads).toBe(1);
    const invalidCommand = crypto.randomUUID(), invalidClient = crypto.randomUUID();
    const invalid = { ...prepared!, commandId: invalidCommand, idempotencyKey: invalidCommand, clientTempId: invalidClient,
      billNumbering: { ...(prepared!.billNumbering as object), date: "2026-02-30" } };
    for (const endpoint of ["/api/lanflow/rubber-bills/queue", "/api/lanflow/rubber-bills"]) {
      const rejected = await context.request.post(endpoint, { headers: { origin }, data: invalid });
      expect(rejected.status(), await rejected.text()).toBe(400);
      expect(await rejected.json()).toMatchObject({ errorCode: "NUMBERING_REJECTED", commandId: invalidCommand, clientTempId: invalidClient });
    }
    expect(sql(`select count(*) from private.rubber_queue_jobs where command_id='${invalidCommand}'`)).toBe("0");
    expect(sql(`select count(*) from public.rubber_bills where client_temp_id='${invalidClient}'`)).toBe("0");
  } finally { await context.setOffline(false); await context.close(); cleanup(branch); }
});
