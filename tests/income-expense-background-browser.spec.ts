import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { selectAppLocation } from "./helpers/select-app-location";
const sql = (query: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8" }).trim();

test("revocation returns to login while the original browser retains its local outbox across reload", async ({ browser }) => {
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  try {
    const me = await (await context.request.get("/api/auth/me")).json();
    const page = await context.newPage(); await page.goto("/");
    await expect(page.getByRole("button", { name: /^รับ-จ่าย/ })).toBeVisible();
    const id = crypto.randomUUID(), serverId = crypto.randomUUID();
    const event = { entity: "income_expense", id, ownerUserId: me.profile.id, locationId: me.profile.locationIds[0],
      operation: "update", serverId, timestamp: Date.now(), status: "pending", payload: {
        contractVersion: 2, background: true, commandId: crypto.randomUUID(), actorUserId: me.profile.id,
        expectedServerId: serverId, clientTempId: id, locationId: me.profile.locationIds[0], operation: "update", billOption: "ค่าใช้จ่าย",
      } };
    await page.evaluate(async (event) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("lanflow_sync_db", 7); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("sync_queue", "readwrite"); tx.objectStore("sync_queue").add(event);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      });
    }, event);
    await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { errorCode: "SESSION_REVOKED" } }));
    await page.evaluate(() => window.dispatchEvent(new Event("lanflow:cash-count-unlocked")));
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await page.reload();
    const retained = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("lanflow_sync_db"); request.onsuccess = () => resolve(request.result); });
      return new Promise<Record<string, unknown>[]>((resolve) => { const tx = db.transaction("sync_queue"); const read = tx.objectStore("sync_queue").getAll(); read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); });
    });
    expect(retained).toHaveLength(1); expect(retained[0].payload).toEqual(event.payload);
  } finally { await context.close(); }
});

test("accepted income edit and deletion close before delayed POST while authoritative values remain", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const branch = crypto.randomUUID(), bill = crypto.randomUUID(), clientId = `IEBG-${bill}`;
  const otherBranch = crypto.randomUUID();
  const marker = `IEBG-${bill.slice(0, 8)}`;
  const me = await (await context.request.get("/api/auth/me")).json();
  const actor = me.profile.id;
  expect(actor).toMatch(/^[0-9a-f-]{36}$/);
  let release = () => {};
  try {
    sql(`insert into public.locations(id,name,code,is_active) values('${branch}','${marker}','B${bill.slice(0,6)}',true);
      insert into public.locations(id,name,code,is_active) values('${otherBranch}','${marker}-other','C${bill.slice(0,6)}',true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',false);
      insert into public.income_expense(id,client_temp_id,location_id,type,number,local_bill_no,server_bill_no,tx_date,title,cost,bill_option,client_recorded_at,client_created_at,created_by_user_id,created_by_name,created_by_phone,revision_no,idempotency_key,sync_status)
      values('${bill}','${clientId}','${branch}','expense','${marker}','${marker}','${marker}',(now() at time zone 'Asia/Bangkok')::date,'${marker}',100,'ค่าใช้จ่าย',now(),now(),'${actor}','Test','000',1,'create:${clientId}:0','synced');`);
    const page = await context.newPage();
    await page.addLocatorHandler(page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true }), async (alert) => {
      await alert.getByRole("button", { name: "รับทราบ", exact: true }).click();
    });
    await page.goto("/");
    await selectAppLocation(page, branch);
    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    const row = page.getByRole("row").filter({ hasText: marker }).first();
    await expect(row).toBeVisible();
    let started = 0;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/lanflow/income-expense/background", async (route) => {
      if (route.request().method() === "POST") { started++; await wait; }
      await route.continue();
    });
    await row.getByRole("button", { name: "แก้ไข", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "เพิ่ม/แก้ไข บิลเงินสด" });
    await dialog.locator("tbody tr").first().locator("input").first().fill(`${marker}-changed`);
    await dialog.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => started).toBe(1);
    await expect(row.getByText("กำลังส่งการแก้ไข", { exact: true })).toBeVisible();
    mkdirSync("output", { recursive: true });
    await page.screenshot({ path: "output/income-expense-background-pending.png", fullPage: true });
    expect(sql(`select title from public.income_expense where id='${bill}'`)).toBe(marker);
    const observer = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
    try {
      const observerPage = await observer.newPage();
      await observerPage.goto("/");
      const observerQueue = await observerPage.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("lanflow_sync_db");
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        if (!db.objectStoreNames.contains("sync_queue")) { db.close(); return []; }
        return new Promise<unknown[]>((resolve, reject) => {
          const tx = db.transaction("sync_queue"); const read = tx.objectStore("sync_queue").getAll();
          read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); tx.onerror = () => reject(tx.error);
        });
      });
      expect(observerQueue).toEqual([]);
      // A separately authenticated device can read the authoritative result, not this local draft.
      const contextResult = await observer.request.get(`/api/lanflow/income-expense/background?serverId=${bill}&locationId=${branch}`);
      expect(contextResult.ok()).toBe(true);
      expect((await contextResult.json()).revisionNo).toBe(1);
    } finally { await observer.close(); }
    await page.getByRole("button", { name: /^ภาพรวม|^Dashboard/ }).first().click();
    await selectAppLocation(page, otherBranch);
    release();
    await expect.poll(() => sql(`select title from public.income_expense where id='${bill}'`)).toBe(`${marker}-changed`);
    await selectAppLocation(page, branch);
    await page.getByRole("button", { name: /^รับ-จ่าย/ }).click();
    await expect(row).toContainText(`${marker}-changed`);
    await page.unroute("**/api/lanflow/income-expense/background");
    let releaseConflict!: () => void;
    let heldPayload: Record<string, unknown> | undefined;
    const conflictWait = new Promise<void>((resolve) => { releaseConflict = resolve; release = resolve; });
    await page.route("**/api/lanflow/income-expense/background", async (route) => {
      if (route.request().method() === "POST") {
        heldPayload = route.request().postDataJSON() as Record<string, unknown>;
        await conflictWait;
      }
      await route.continue();
    });
    await row.getByRole("button", { name: "แก้ไข", exact: true }).click();
    await dialog.locator("tbody tr").first().locator("input").first().fill(`${marker}-draft`);
    await dialog.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => Boolean(heldPayload)).toBe(true);
    const otherPayload = { ...heldPayload, title: `${marker}-other` };
    for (const field of ["contractVersion", "background", "commandId", "actorUserId", "expectedServerId"]) delete (otherPayload as Record<string, unknown>)[field];
    const otherUpdate = await context.request.post("/api/lanflow/income-expense", { data: otherPayload });
    expect(otherUpdate.ok(), await otherUpdate.text()).toBe(true);
    await selectAppLocation(page, otherBranch);
    releaseConflict();
    await expect.poll(() => sql(`select result->>'outcome' from private.income_expense_background_commands where command_id='${heldPayload!.commandId}'`)).toBe("revision_conflict");
    const notice = page.locator('[role="status"]').filter({ hasText: "รายการเปลี่ยนแล้ว ยกเลิกการแก้ไข/ลบที่ค้างไว้" });
    await expect(notice).toHaveCount(0);
    await selectAppLocation(page, branch);
    await expect(notice).toBeVisible();
    await expect(row).toContainText(`${marker}-other`);
    await expect(row).not.toContainText(`${marker}-draft`);
    await page.screenshot({ path: "output/income-expense-background-conflict.png", fullPage: true });
    await notice.getByRole("button", { name: "รับทราบ", exact: true }).click();
    await expect(notice).not.toBeVisible();
    await page.unroute("**/api/lanflow/income-expense/background");
    let releaseDelete!: () => void;
    const deleteWait = new Promise<void>((resolve) => { releaseDelete = resolve; release = resolve; });
    await page.route("**/api/lanflow/income-expense/background", async (route) => {
      if (route.request().method() === "POST") await deleteWait;
      await route.continue();
    });
    await row.getByRole("button", { name: "ลบ", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "ยืนยันลบรายการ" });
    await confirm.getByRole("button", { name: "ส่งคำขอลบ", exact: true }).click();
    await expect(confirm).not.toBeVisible();
    await expect(row.getByText("กำลังส่งคำขอลบ", { exact: true })).toBeVisible();
    expect(sql(`select record_status from public.income_expense where id='${bill}'`)).toBe("active");
    releaseDelete();
    await expect.poll(() => sql(`select record_status from public.income_expense where id='${bill}'`)).toBe("deleted");
    await expect(row).not.toBeVisible();
  } finally {
    release();
    await context.close().catch(() => {});
    sql(`begin; set local app.history_retention_cleanup='on';
      delete from private.income_expense_background_commands where location_id='${branch}';
      delete from public.income_expense_approval_requests where location_id='${branch}';
      delete from public.income_expense where location_id='${branch}'; set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';
      delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';
      delete from public.user_locations where location_id='${branch}'; delete from public.locations where id='${branch}'; commit;`);
    sql(`begin; delete from public.dashboard_money_events where location_id='${otherBranch}';
      delete from public.dashboard_branch_snapshots where location_id='${otherBranch}';
      delete from public.document_deletion_audits where location_id='${otherBranch}';
      delete from public.user_locations where location_id='${otherBranch}'; delete from public.locations where id='${otherBranch}'; commit;`);
  }
});
