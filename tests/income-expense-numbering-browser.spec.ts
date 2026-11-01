import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { selectAppLocation, confirmCurrentBranchIfRequired } from "./helpers/select-app-location";
import { waitForBillIssuer } from "./helpers/wait-bill-issuer";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";
import { assertSafeIntegrationTarget } from "./support/integration-target";
import { bangkokDateString } from "../src/lib/bangkok-date";

const sql = (query: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8", windowsHide: true }).trim();
test("real PWA keeps accepted numbers while reopening a fresh form after partial failure", async ({ browser }, info) => {
  test.setTimeout(240000); assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const branch = crypto.randomUUID(), marker = `IEN-${branch.slice(0,6)}`;
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const settings = JSON.parse(sql("select to_jsonb(s) from public.income_expense_approval_settings s where id=true"));
  let owner = "";
  try {
    owner = (await (await context.request.get("/api/auth/me")).json()).profile.id;
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','IN${branch.slice(0,6)}',true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${owner}','${branch}',false);
      update public.income_expense_approval_settings set applies_to='both',approval_min_amount=null,non_current_date_requires_approval=false;`);
    const registration = { locationId: branch, installationId: crypto.randomUUID(), generationId: crypto.randomUUID() };
    const registered = await context.request.post("/api/lanflow/rubber-bills/issuers", { headers: { origin: new URL(String(info.project.use.baseURL)).origin }, data: registration });
    expect(registered.ok()).toBe(true); const issuer = await registered.json();
    const oldTab = await context.newPage(); await oldTab.goto("/manifest.json");
    await oldTab.evaluate(({ issuer, registration }) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("lanflow_sync_db", 9);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result, queue = db.createObjectStore("sync_queue", { keyPath: "queueId", autoIncrement: true });
        for (const key of ["entity", "id", "status", "ownerUserId", "locationId"]) queue.createIndex(key, key);
        queue.add({ id: "legacy-preserved", entity: "income_expense", ownerUserId: "another-owner", locationId: issuer.locationId, operation: "create", status: "pending", timestamp: 1, payload: { localBillNo: "LEGACY-PRESERVED", title: "other owner's legacy work" } });
        const numbers = db.createObjectStore("rubber_bill_numbers", { keyPath: "key" });
        if (issuer.deviceId) numbers.put({ key: "bill-issuer-installation", version: 1,
          installationId: registration.installationId, generationId: registration.generationId, locations: [issuer.locationId] });
        numbers.put({ key: issuer.locationId, version: 1,
          installationId: registration.installationId, generationId: registration.generationId, issuer, checkedAt: 0,
          counters: { "2026-10-31": 7 }, reservations: { old: { base: `0007-261031-${issuer.code}`, metadata: { version: 1, issuerId: issuer.id, date: "2026-10-31", sequence: 7 } } } });
      };
      request.onsuccess = () => { Reflect.set(window, "__numberingOldDb", request.result); request.result.onversionchange = () => { document.title = "upgrade-blocked-by-old-tab"; }; resolve(); };
    }), { issuer, registration });
    const page = await context.newPage(), pageErrors: string[] = []; page.on("pageerror", error => pageErrors.push(error.message)); await installThresholdAlertHandler(page); page.on("dialog", dialog => dialog.accept());
    page.setDefaultTimeout(15_000);
    await page.goto("/"); await expect(oldTab).toHaveTitle("upgrade-blocked-by-old-tab", { timeout: 30000 }); await oldTab.close();
    await page.goto("/"); await selectAppLocation(page, branch);
    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click(); await waitForBillIssuer(page, branch);
    await expect(page.getByRole("status").filter({ hasText: /^พร้อมใช้งานออฟไลน์ 100%$/ })).toBeVisible({ timeout: 60000 });
    const readRetained = () => page.evaluate(branch => new Promise<{ version: number; counters: unknown; legacy: unknown }>(resolve => {
      const request = indexedDB.open("lanflow_sync_db"); request.onsuccess = () => {
        const db = request.result, tx = db.transaction(["rubber_bill_numbers", "sync_queue"]);
        const state = tx.objectStore("rubber_bill_numbers").get(branch), legacy = tx.objectStore("sync_queue").index("id").get("legacy-preserved");
        tx.oncomplete = () => { resolve({ version: db.version, counters: state.result.counters, legacy: legacy.result?.payload.localBillNo }); db.close(); };
      };
    }), branch);
    expect(await readRetained()).toEqual({ version: 11, counters: { "2026-10-31": 7 }, legacy: "LEGACY-PRESERVED" });
    await context.setOffline(true);
    await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
    const modal = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
    await modal.getByLabel("วันที่", { exact: true }).fill("2026-10-31");
    await expect(modal.getByLabel("เลขที่บิล", { exact: true })).toHaveValue("ออกเลขเมื่อบันทึก");
    await expect(modal.getByLabel("เลขบิลชั่วคราว", { exact: true })).toHaveCount(0);
    await modal.getByRole("button", { name: "เพิ่มรายการ", exact: true }).click();
    for (const [index, title] of [`${marker}-one`, `${marker}-two`].entries()) {
      const row = modal.locator("tbody tr").nth(index);
      await row.locator("input").first().fill(title); await row.locator('input[type="number"]').fill(String(10 + index));
    }
    await page.evaluate(title => {
      const original = IDBObjectStore.prototype.add; let failed = false;
      IDBObjectStore.prototype.add = function (...args) {
        if (!failed && this.name === "sync_queue" && args[0]?.payload?.title === title) { failed = true; throw new DOMException("fixture quota failure", "QuotaExceededError"); }
        return original.apply(this, args);
      };
    }, `${marker}-two`);
    await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(modal).toBeHidden();
    const storageMessage = page.getByText("พื้นที่บันทึกในเครื่องไม่พอ กรุณาเพิ่มพื้นที่ว่างแล้วลองใหม่", { exact: true });
    await expect(storageMessage).toBeVisible();
    const readQueue = () => page.evaluate(() => new Promise<Array<{ id: string; payload: { localBillNo: string; billNumbering: { sequence: number }; title: string } }>>(resolve => {
      const request = indexedDB.open("lanflow_sync_db"); request.onsuccess = () => {
        const db = request.result, tx = db.transaction("sync_queue"), read = tx.objectStore("sync_queue").getAll();
        tx.oncomplete = () => { db.close(); resolve(read.result); };
      };
    }));
    const before = (await readQueue()).filter(row => row.payload.title?.startsWith(marker));
    expect(before).toHaveLength(1); expect(before[0].payload.localBillNo).toMatch(/^E-0001-\d{6}-D\d+$/);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(storageMessage).toBeHidden({ timeout: 10000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await page.getByRole("button", { name: "เพิ่มรายจ่าย", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
    const restored = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
    await expect(restored.locator("tbody tr")).toHaveCount(1);
    await expect(restored.locator("tbody input").first()).toHaveValue("");
    await expect(restored.getByLabel("วันที่", { exact: true })).toHaveValue(bangkokDateString());
    expect(await restored.locator("table").evaluate(table => table.scrollWidth <= table.parentElement!.clientWidth)).toBe(true);
    await restored.screenshot({ path: info.outputPath("numbered-fresh-mobile.png") });
    await restored.getByLabel("วันที่", { exact: true }).fill("2026-10-31");
    await restored.locator("tbody input").first().fill(`${marker}-two`);
    await restored.locator('input[type="number"]').fill("11");
    await restored.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(restored).toBeHidden();
    const after = (await readQueue()).filter(row => row.payload.title?.startsWith(marker));
    expect(after).toHaveLength(2); expect(after.find(row => row.id === before[0].id)?.payload).toEqual(before[0].payload);
    expect(after.map(row => row.payload.billNumbering.sequence).sort()).toEqual([1,2]);
    expect((await readRetained()).counters).toEqual({ "2026-10-31": 7 });
    await context.setOffline(false);
    await expect.poll(() => sql(`select count(*) from public.income_expense where location_id='${branch}'`), { timeout: 60000 }).toBe("2");
    await expect(page.getByRole("row").filter({ hasText: `${marker}-one` })).toContainText(`${before[0].payload.localBillNo}-1`, { timeout: 30000 });
    const replay = await context.request.post("/api/lanflow/income-expense", { data: before[0].payload });
    expect(replay.ok(), await replay.text()).toBe(true);
    expect((await replay.json()).serverBillNo).toBe(`${before[0].payload.localBillNo}-1`);
    expect(sql(`select count(*) from public.income_expense where location_id='${branch}'`)).toBe("2");
    await page.screenshot({ path: info.outputPath("numbered-final-mobile.png") });
    sql("update public.income_expense_approval_settings set approval_min_amount=1");
    await page.reload(); await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    let approvalPreflights = 0;
    page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/income-expense/approval-requests")) approvalPreflights++; });
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click(); await confirmCurrentBranchIfRequired(page);
    const approvalForm = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
    await approvalForm.locator("tbody tr input").first().fill(`${marker}-approval`);
    await approvalForm.locator('input[type="number"]').fill("25");
    await approvalForm.getByRole("button", { name: "บันทึกบิล", exact: true }).click(); await expect(approvalForm).toBeHidden();
    await expect.poll(() => sql(`select count(*) from public.income_expense_approval_requests where location_id='${branch}'`), { timeout: 30000 }).toBe("1");
    const request = JSON.parse(sql(`select jsonb_build_object('id',id,'payload',requested_payload) from public.income_expense_approval_requests where location_id='${branch}'`));
    expect(approvalPreflights).toBe(0);
    expect(sql(`select count(*) from public.income_expense where location_id='${branch}'`)).toBe("2");
    await page.reload(); await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await expect(page.getByRole("row").filter({ hasText: `${marker}-approval` })).toContainText(request.payload.localBillNo);
    await page.getByRole("button", { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();
    await expect(page.getByRole("row", { name: `คำขอ ${marker}-approval` })).toContainText(`เลขที่บิล: ${request.payload.localBillNo}`);
    const decision = await context.request.post(`/api/lanflow/income-expense/approval-requests/${request.id}/decide`, { data: { decision: "approved" } });
    expect(decision.ok(), await decision.text()).toBe(true);
    await page.reload(); await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await expect(page.getByRole("row").filter({ hasText: `${marker}-approval` })).toContainText(`${request.payload.localBillNo}-1`);
    await page.getByRole("button", { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();
    await expect(page.getByRole("row", { name: `คำขอ ${marker}-approval` })).toContainText(`เลขที่บิล: ${request.payload.localBillNo}-1`);
    const approvedReplay = await context.request.post("/api/lanflow/income-expense", { data: request.payload });
    expect((await approvedReplay.json()).serverBillNo).toBe(`${request.payload.localBillNo}-1`);
    expect(sql(`select count(*) from public.income_expense where location_id='${branch}'`)).toBe("3");
    await page.screenshot({ path: info.outputPath("numbered-approval-mobile.png") });
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close().catch(() => {});
    sql(`begin; set local app.history_retention_cleanup='on';
      update public.income_expense_approval_settings set applies_to='${settings.applies_to}',approval_min_amount=${settings.approval_min_amount ?? "null"},non_current_date_requires_approval=${settings.non_current_date_requires_approval};
      delete from public.income_expense_approval_requests where location_id='${branch}';
      delete from public.income_expense where location_id='${branch}'; set constraints all immediate;
      delete from private.income_expense_number_bindings where location_id='${branch}'; delete from private.income_expense_suffix_counters where location_id='${branch}';
      delete from private.income_expense_create_receipts where location_id='${branch}';
      delete from private.rubber_bill_issuer_heads where location_id='${branch}'; delete from private.rubber_bill_issuers where location_id='${branch}'; delete from private.rubber_bill_issuer_counters where location_id='${branch}';
      delete from public.dashboard_money_events where location_id='${branch}'; delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.user_locations where location_id='${branch}'; delete from public.locations where id='${branch}'; commit;`);
  }
});
