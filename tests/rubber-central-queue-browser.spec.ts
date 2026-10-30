import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { selectAppLocation, selectedAppLocationId, confirmCurrentBranchIfRequired } from "./helpers/select-app-location";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";
import { assertSafeIntegrationTarget } from "./support/integration-target";

const sql = (query: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8", windowsHide: true }).trim();
async function openBills(page: Page, branch: string) {
  await installThresholdAlertHandler(page);
  await page.goto("/");
  // Existing global threshold notices can close an open selector while the
  // initial app loads. Reopen it after the notice instead of a detached click.
  await expect(async () => {
    if (await selectedAppLocationId(page) === branch) return;
    const option = page.locator(`[role="option"][data-location-id="${branch}"]`);
    if (!await option.isVisible()) await page.locator('button[data-location-id][aria-controls="location-selector-listbox"]').click({ timeout: 5_000 });
    await option.click({ timeout: 5_000 });
    expect(await selectedAppLocationId(page)).toBe(branch);
  }).toPass({ timeout: 25_000, intervals: [500, 1_000] });
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await expect(page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true })).toBeVisible();
}

test("two devices see server processing while the origin leaves the branch; manager acceptance closes before POST", async ({ browser }) => {
  test.setTimeout(180_000);
  assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const origin = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const observer = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const branch = crypto.randomUUID(), other = crypto.randomUUID(), approvalBill = crypto.randomUUID();
  const marker = `CQ-${branch.slice(0, 8)}`;
  const me = await (await origin.request.get("/api/auth/me")).json();
  const actor = me.profile.id;
  let release = () => {};
  try {
    sql(`begin;insert into public.locations(id,name,code,is_active) values
      ('${branch}','${marker}','Q${branch.slice(0,6)}',true),('${other}','${marker}-other','R${branch.slice(0,6)}',true);
      insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,
      location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,revision_no,
      created_at,created_by_user_id,created_by_name,created_by_phone)
      values('${approvalBill}','${approvalBill}','CQ-APPROVAL','CQ-APPROVAL','original:${approvalBill}','synced','active',
      '${branch}','CQ-APPROVAL',current_date-2,'${marker}-approval','weighing',100,100,1,0,100,1,'2000-01-01',
      '${actor}','Fixture','0000000000');commit;`);
    console.info('CQ browser: fixtures ready');
    const page = await origin.newPage(); const viewing = await observer.newPage();
    await openBills(page, branch); await openBills(viewing, branch);
    console.info('CQ browser: both devices opened');
    let posts = 0, commandId = "";
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/lanflow/rubber-bills/queue", async route => {
      if (route.request().method() === "POST") { posts++; commandId = route.request().postDataJSON().commandId; await gate; }
      await route.continue();
    });
    let downloads = 0; page.on("download", () => { downloads++; });
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
    await confirmCurrentBranchIfRequired(page);
    const modal = page.getByRole("dialog", { name: "บิลเครื่องชั่งเล็ก", exact: true });
    await expect(modal).toBeVisible();
    await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(marker);
    await page.keyboard.press("Escape");
    const weigh = modal.locator("table").first().locator("tbody tr").first();
    await weigh.locator('input[type="number"]').nth(0).fill("100");
    await weigh.locator('input[type="number"]').nth(1).fill("0");
    await weigh.locator('input[type="number"]').nth(3).fill("1");
    await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(modal).not.toBeVisible({ timeout: 15_000 });
    await expect.poll(() => posts).toBe(1);
    console.info('CQ browser: local accepted before POST');
    expect(sql(`select count(*) from private.rubber_queue_jobs where command_id='${commandId}'`)).toBe("0");
    await expect.poll(() => downloads, { timeout: 15000 }).toBe(1);
    await selectAppLocation(page, other);
    release();
    await expect.poll(() => sql(`select state from private.rubber_queue_jobs where command_id='${commandId}'`), { timeout: 25_000 }).toBe("done");
    await expect(viewing.getByRole("row").filter({ hasText: marker }).filter({ hasNotText: "approval" }).first()).toBeVisible({ timeout: 25_000 });
    console.info('CQ browser: other device refreshed without sender');
    expect(await selectedAppLocationId(page)).toBe(other);
    expect(downloads).toBe(1);
    await expect(page.getByRole("dialog", { name: "กำลังสร้าง PDF" })).not.toBeVisible();
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    await page.unroute("**/api/lanflow/rubber-bills/queue");

    // Create an actual pending delete through the same authenticated central API.
    const deleteId = crypto.randomUUID();
    const currentPayload = JSON.parse(sql(`select private.current_rubber_bill_payload('${approvalBill}')`));
    const admitted = await observer.request.post("/api/lanflow/rubber-bills/queue", { data: { ...currentPayload, centralQueue: true,
      actorUserId: actor, contractVersion: 2, commandId: deleteId, idempotencyKey: deleteId, operation: "delete",
      locationId: branch, clientTempId: approvalBill, expectedRevisionNo: 1, expectedCommandGeneration: 0, expectedQueueVersion: 0 } });
    expect([200, 202]).toContain(admitted.status());
    expect((await admitted.json()).commandId).toBe(deleteId);
    await expect.poll(() => sql(`select result->>'status' from private.rubber_queue_jobs where command_id='${deleteId}'`), { timeout: 25_000 }).toBe("pending_approval");
    const requestId = sql(`select id from public.rubber_bill_approval_requests where location_id='${branch}' and client_temp_id='${approvalBill}' and request_status='pending'`);
    const pendingFeed = await observer.request.get(`/api/lanflow/rubber-bills/feed?locationId=${branch}&mode=pending_approval&documentStatus=any&limit=25`);
    expect(pendingFeed.ok(), await pendingFeed.text()).toBe(true);
    console.info('CQ browser: pending feed API validated');
    const approvals = viewing.getByRole("dialog", { name: "ตั้งค่าและอนุมัติบิลยาง", exact: true });
    // Global threshold acknowledgements can dismiss a newly opened dialog.
    await expect(async () => {
      if (!await approvals.isVisible()) await viewing.getByRole("button", { name: /^ตั้งค่าและอนุมัติบิลยาง/ }).click();
      await expect(approvals.getByText(`${marker}-approval`, { exact: false })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 25_000 });
    console.info('CQ browser: manager card visible');
    let managerCommand = ""; const approvalGate = new Promise<void>(resolve => { release = resolve; });
    await viewing.route("**/api/lanflow/rubber-bills/queue", async route => {
      if (route.request().method() === "POST" && route.request().postDataJSON().queueAction === "approve") {
        managerCommand = route.request().postDataJSON().commandId; await approvalGate;
      }
      await route.continue();
    });
    await approvals.getByRole("button", { name: "อนุมัติ", exact: true }).click();
    const confirm = viewing.getByRole("alertdialog", { name: "อนุมัติคำขอนี้?" }).getByRole("button", { name: "ยืนยันอนุมัติ", exact: true });
    await confirm.focus();
    await expect(confirm).toBeFocused();
    await confirm.press("Enter");
    await expect(approvals).toBeVisible();
    await expect(approvals.getByRole("button", { name: "รอผลคำสั่ง", exact: true })).toHaveCount(2);
    for (const button of await approvals.getByRole("button", { name: "รอผลคำสั่ง", exact: true }).all()) {
      await expect(button).toBeDisabled();
    }
    console.info('CQ browser: manager accepted before POST');
    mkdirSync("output", { recursive: true });
    await viewing.screenshot({ path: "output/rubber-central-queue-pending.png", fullPage: true });
    await expect.poll(() => managerCommand).not.toBe("");
    expect(sql(`select record_status from public.rubber_bills where id='${approvalBill}'`)).toBe("active");
    await approvals.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect(approvals).not.toBeVisible();
    await selectAppLocation(viewing, other); release();
    await expect.poll(() => sql(`select result->>'status' from private.rubber_queue_jobs where command_id='${managerCommand}'`), { timeout: 25_000 }).toBe("approved");
    expect(sql(`select record_status from public.rubber_bills where id='${approvalBill}'`)).toBe("deleted");
    expect(sql(`select approved_by_user_id from public.rubber_bill_approval_requests where id='${requestId}'`)).toBe(actor);
    await expect(viewing.getByRole("alertdialog")).not.toBeVisible();
    await selectAppLocation(page, branch);
    await page.getByRole("button", { name: /^คิวซิงก์/ }).click();
    const shared = page.getByRole("dialog", { name: `คิวซิงก์ — ${marker}` });
    await shared.getByRole("button", { name: "ผลดำเนินการ", exact: true }).click();
    await shared.getByLabel("ค้นหาเลขบิลในคิว").fill("CQ-APPROVAL");
    await expect(shared.getByText("อนุมัติคำขอ", { exact: false }).first()).toBeVisible();
    mkdirSync("output", { recursive: true });
    await page.screenshot({ path: "output/rubber-central-queue-shared.png", fullPage: true });
    expect(downloads).toBe(1); // Returning did not replay the already shared local receipt.
    await shared.getByRole("button", { name: "ปิด", exact: true }).click();
    // Two creations become ready together. The real PDF path must deliver both,
    // while the observer remains silent and never acquires origin intents.
    let observerDownloads = 0; viewing.on("download", () => { observerDownloads++; });
    let printPosts = 0;
    const printGate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/lanflow/rubber-bills/queue", async route => {
      if (route.request().method() === "POST") { printPosts++; await printGate; }
      await route.continue();
    });
    for (let index = 0; index < 2; index++) {
      await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
      await confirmCurrentBranchIfRequired(page);
      const create = page.getByRole("dialog", { name: "บิลเครื่องชั่งเล็ก", exact: true });
      await create.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(`${marker}-print-${index}`);
      await page.keyboard.press("Escape");
      const weighRow = create.locator("table").first().locator("tbody tr").first();
      await weighRow.locator('input[type="number"]').nth(0).fill("100");
      await weighRow.locator('input[type="number"]').nth(1).fill("0");
      await weighRow.locator('input[type="number"]').nth(3).fill("1");
      await create.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
      await expect(create).not.toBeVisible();
    }
    release();
    await expect.poll(() => downloads, { timeout: 60_000, intervals: [500, 1_000, 2_000] }).toBe(3);
    await expect.poll(() => printPosts, { timeout: 45000 }).toBeGreaterThanOrEqual(2);
    expect(observerDownloads).toBe(0);
    await expect.poll(() => sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name like '${marker}-print-%'`), { timeout: 45000 }).toBe("2");
    console.info('CQ browser: both origin PDFs delivered serially');
  } finally {
    release();
    await Promise.race([Promise.allSettled([origin.close(), observer.close()]), new Promise(resolve => setTimeout(resolve, 3_000))]);
    sql(`begin;set local app.history_retention_cleanup='on';
      delete from public.rubber_bill_approval_requests where location_id in ('${branch}','${other}');
      delete from public.rubber_bill_items where bill_id in (select id from public.rubber_bills where location_id in ('${branch}','${other}'));
      delete from public.rubber_bills where location_id in ('${branch}','${other}');set constraints all immediate;
      delete from public.dashboard_money_events where location_id in ('${branch}','${other}');
      delete from public.dashboard_branch_snapshots where location_id in ('${branch}','${other}');
      delete from public.document_deletion_audits where location_id in ('${branch}','${other}');
      delete from public.user_locations where location_id in ('${branch}','${other}');
      delete from public.locations where id in ('${branch}','${other}');commit;`);
  }
});

for (const stage of ["local", "lost-response"] as const) {
  test(`full browser restart preserves ${stage} work and reconciles the same command once`, async ({ playwright }, testInfo) => {
    test.setTimeout(120_000);
    assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const branch = crypto.randomUUID(), marker = `REOPEN-${branch.slice(0, 8)}`;
    const profile = testInfo.outputPath("persistent-profile");
    const launch = () => playwright.chromium.launchPersistentContext(profile, { headless: true, acceptDownloads: true });
    let context = await launch();
    let release = () => {};
    try {
      const auth = JSON.parse(readFileSync("playwright/.auth/super_admin.json", "utf8"));
      await context.addCookies(auth.cookies);
      sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','Z${branch.slice(0, 6)}',true);`);
      const page = await context.newPage();
      await openBills(page, branch);
      await expect.poll(() => page.evaluate(location => Boolean(localStorage.getItem(`lanflow:rubber-bill-approval-settings:v4:${location}`)), branch)).toBe(true);
      let admission!: () => void;
      const admitted = new Promise<void>(resolve => { admission = resolve; });
      const responseGate = new Promise<void>(resolve => { release = resolve; });
      if (stage === "local") await context.setOffline(true);
      else await page.route("**/api/lanflow/rubber-bills/queue", async route => {
        if (route.request().method() !== "POST") { await route.continue(); return; }
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        admission();
        await responseGate;
        await route.fulfill({ response }).catch(() => {});
      });
      await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
      await confirmCurrentBranchIfRequired(page);
      const modal = page.getByRole("dialog", { name: "บิลเครื่องชั่งเล็ก", exact: true });
      await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(marker);
      await page.keyboard.press("Escape");
      const weigh = modal.locator("table").first().locator("tbody tr").first();
      await weigh.locator('input[type="number"]').nth(0).fill("100");
      await weigh.locator('input[type="number"]').nth(1).fill("0");
      await weigh.locator('input[type="number"]').nth(3).fill("0");
      await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
      await expect(modal).not.toBeVisible();
      const identity = await page.evaluate(() => new Promise<{ id: string; command: string }>((resolve, reject) => {
        const open = indexedDB.open("lanflow_sync_db"); open.onerror = () => reject(open.error);
        open.onsuccess = () => { const db = open.result; const tx = db.transaction("sync_queue");
          const read = tx.objectStore("sync_queue").getAll();
          read.onsuccess = () => { const event = read.result.find(event => event.entity === "rubber_bills");
            resolve({ id: event.id, command: event.payload.commandId }); };
          tx.oncomplete = () => db.close(); };
      }));
      if (stage === "lost-response") await admitted;
      else expect(sql(`select count(*) from private.rubber_queue_jobs where location_id='${branch}'`)).toBe("0");
      await context.close(); release();
      context = await launch();
      const resumed = await context.newPage();
      let downloads = 0; resumed.on("download", () => { downloads++; });
      await openBills(resumed, branch);
      await expect.poll(() => sql(`select count(*) from public.rubber_bills where location_id='${branch}' and client_temp_id='${identity.id}'`), { timeout: 45_000 }).toBe("1");
      await expect(resumed.getByRole("row").filter({ hasText: marker }).getByText("ซิงก์แล้ว", { exact: true })).toBeVisible({ timeout: 45_000 });
      expect(sql(`select command_id from private.rubber_queue_jobs where location_id='${branch}'`)).toBe(identity.command);
      expect(downloads).toBe(0);
    } finally {
      release(); await context.close();
      sql(`begin;set local app.history_retention_cleanup='on';
        delete from public.rubber_bill_approval_requests where location_id='${branch}';
        delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${branch}');
        delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
        delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
        delete from public.document_deletion_audits where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
        delete from public.locations where id='${branch}';commit;`);
    }
  });
}

test("offline create stays local, can be edited, and reconnect admits its immutable latest draft once", async ({ browser }) => {
  test.setTimeout(120_000);
  assertSafeIntegrationTarget(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const branch = crypto.randomUUID(), marker = `CQOFF-${branch.slice(0, 8)}`;
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','O${branch.slice(0,6)}',true);`);
    const page = await context.newPage();
    await openBills(page, branch);
    await expect.poll(async () => page.evaluate((location) => Boolean(localStorage.getItem(`lanflow:rubber-bill-approval-settings:v4:${location}`)), branch)).toBe(true);
    await context.setOffline(true);
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
    await confirmCurrentBranchIfRequired(page);
    const modal = page.getByRole("dialog", { name: "บิลเครื่องชั่งเล็ก", exact: true });
    await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(marker);
    await page.keyboard.press("Escape");
    const weigh = modal.locator("table").first().locator("tbody tr").first();
    await weigh.locator('input[type="number"]').nth(0).fill("100");
    await weigh.locator('input[type="number"]').nth(1).fill("0");
    await weigh.locator('input[type="number"]').nth(3).fill("0");
    await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(modal).not.toBeVisible();
    expect(sql(`select count(*) from private.rubber_queue_jobs where location_id='${branch}'`)).toBe("0");
    const row = page.getByRole("row").filter({ hasText: marker }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "แก้ไข", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "แก้ไขบิลเครื่องชั่งเล็ก", exact: true });
    await edit.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(`${marker}-corrected`);
    await page.keyboard.press("Escape");
    await edit.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(edit).not.toBeVisible();
    await context.setOffline(false);
    await expect.poll(() => sql(`select count(*) from public.rubber_bills where location_id='${branch}' and customer_name='${marker}-corrected'`), { timeout: 45_000 }).toBe("1");
    expect(sql(`select count(*) from private.rubber_queue_jobs where location_id='${branch}'`)).toBe("1");
    expect(sql(`select state from private.rubber_queue_jobs where location_id='${branch}'`)).toBe("done");
    await expect(row.getByText("ซิงก์แล้ว", { exact: true })).toBeVisible({ timeout: 35_000 });
    await context.setOffline(true);
    const guarded = row.getByRole("button", { name: "รายการนี้ซิงก์แล้ว ต้องออนไลน์เพื่อแก้ไขหรือลบ", exact: true });
    await expect(guarded).toHaveCount(2);
    await expect(guarded.nth(0)).toBeDisabled(); await expect(guarded.nth(1)).toBeDisabled();
  } finally {
    await context.close().catch(() => {});
    sql(`begin;set local app.history_retention_cleanup='on';
      delete from public.rubber_bill_approval_requests where location_id='${branch}';
      delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${branch}');
      delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
      delete from public.locations where id='${branch}';commit;`);
  }
});
