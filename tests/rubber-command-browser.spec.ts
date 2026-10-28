import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { selectAppLocation } from "./helpers/select-app-location";

const sql = (query: string) => execFileSync("docker", ["exec", "supabase_db_webapp", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query], { encoding: "utf8" }).trim();

test("delete dialog creates and replaces approval then the approved bill leaves Latest", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ storageState: "playwright/.auth/super_admin.json" });
  const branch = crypto.randomUUID(), bill = crypto.randomUUID();
  const number = `CMDUI-${bill.slice(0, 8)}`;
  const me = await (await context.request.get("/api/auth/me")).json();
  const actor = me.profile.id;
  expect(actor).toMatch(/^[0-9a-f-]{36}$/);
  try {
    sql(`begin;insert into public.locations(id,name,code,is_active) values('${branch}','Command UI fixture','CU${branch.slice(0,6)}',true);
      insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',false);
      insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,
      location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,revision_no,
      created_at,created_by_user_id,created_by_name,created_by_phone)
      values('${bill}','${bill}','${number}','${number}','original:${bill}','synced','active','${branch}','${number}',current_date-2,'Command UI fixture','weighing',
      100,3800,38,0,3800,1,'2000-01-01','${actor}','Command UI fixture','0000000000');commit;`);
    const page = await context.newPage();
    await page.addLocatorHandler(page.getByRole("alertdialog", { name: "แจ้งเตือน", exact: true }), async (alert) => {
      await alert.getByRole("button", { name: "รับทราบ", exact: true }).click();
    });
    await page.goto("/");
    await page.getByRole("button", { name: /^บิลยาง/ }).click();
    await selectAppLocation(page, branch);
    await page.getByLabel("ค้นหา:").fill(number);
    const row = page.getByRole("row").filter({ hasText: number });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "ลบ", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "ลบบิลยาง", exact: true });
    await expect(dialog).toContainText(number);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(sql(`select record_status from public.rubber_bills where id='${bill}'`)).toBe("active");
    await row.getByRole("button", { name: "ลบ", exact: true }).click();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/lanflow/rubber-bills", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await dialog.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toContainText("กำลังส่งคำขอลบ");
    const blocked = row.getByRole("button", { name: "รายการนี้บันทึกถึงเซิร์ฟเวอร์แล้วและกำลังยืนยันผล กรุณารอสักครู่", exact: true });
    await expect(blocked).toHaveCount(2);
    for (const action of await blocked.all()) await expect(action).toBeDisabled();
    await page.getByRole("button", { name: "ภาพรวม", exact: true }).click();
    release();
    const pendingSql = `select id from public.rubber_bill_approval_requests where location_id='${branch}' and request_status='pending'`;
    await expect.poll(() => sql(pendingSql)).toMatch(/^[0-9a-f-]{36}$/);
    const first = sql(pendingSql);
    await page.getByRole("button", { name: /^บิลยาง/ }).click();
    await page.getByLabel("ค้นหา:").fill(number);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    await expect(row.getByRole("button", { name: "ลบ", exact: true })).toBeEnabled();
    await row.getByRole("button", { name: "ลบ", exact: true }).click();
    await dialog.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => sql(pendingSql)).not.toBe(first);
    const second = sql(pendingSql);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
    expect(sql(`select count(*) from public.rubber_bill_approval_requests where id='${first}'`)).toBe("0");
    await page.screenshot({ path: "output/rubber-command-replacement-ui.png", fullPage: true });
    const approval = await context.request.post(`/api/lanflow/rubber-bills/approval-requests/${second}/approve`);
    expect(approval.ok(), await approval.text()).toBe(true);
    expect(sql(`select record_status from public.rubber_bills where id='${bill}'`)).toBe("deleted");
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: number })).toHaveCount(0);
  } finally {
    await context.close().catch(() => {});
    sql(`begin;set local app.history_retention_cleanup='on';
      delete from private.approval_request_replay_guards where workflow='rubber_bill' and request_key in
        (select command_id::text from private.rubber_command_receipts where location_id='${branch}');
      delete from public.rubber_bill_approval_requests where location_id='${branch}';
      delete from public.rubber_bill_items where bill_id='${bill}';delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
      delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
      delete from public.document_deletion_audits where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
      delete from public.locations where id='${branch}';commit;`);
  }
});
