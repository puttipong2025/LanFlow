import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });
const branch = { id: "71000000-0000-4000-8000-000000000001", name: "สาขาผู้จ่าย A", code: "PAYA", active: true };
const employee = { id: "72000000-0000-4000-8000-000000000001", name: "พนักงานวิธีจ่าย", role: "user", is_active: true, daily_wage: 500, primary_location_id: branch.id };
const slip = { id: "73000000-0000-4000-8000-000000000001", profile_id: employee.id, month: "2026-08", gross_pay: 500, total_deductions: 0, net_pay: 500, created_at: "2026-09-01T01:00:00Z", cancelled_at: null, report_lock_no: null };

test("approval uses the shared payment dialog and persists the displayed payer only after success", async ({ page }) => {
  let status = "PENDING";
  let payer: string | null = null;
  let approvalCalls = 0;
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { permissions: { canManage: true, canDecide: true, canConfigure: true }, users: [employee], paymentLocations: [branch], pendingSlips: status === "PENDING" ? [slip] : [], pendingTransactions: [], admins: [] } });
      return;
    }
    const { action, payload } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: [{ ...slip, status, expense_location_id: payer, expense_location_name: payer ? branch.name : null }] } });
    } else if (action === "APPROVE_PAYROLL_SLIP") {
      approvalCalls++;
      expect(payload.expense_location_id).toBe(branch.id);
      if (approvalCalls === 1) {
        await route.fulfill({ status: 403, json: { error: "สิทธิ์สาขาเปลี่ยน กรุณาตรวจสอบ" } });
        return;
      }
      payer = payload.expense_location_id;
      status = "APPROVED";
      await route.fulfill({ json: { success: true } });
    } else if (action === "CHANGE_EXPENSE_LOCATION") {
      expect(payload.expense_location_id).toBeNull();
      payer = null;
      await route.fulfill({ json: { success: true } });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
  await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานวิธีจ่าย/ }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานวิธีจ่าย" });
  const approve = payroll.getByRole("button", { name: "อนุมัติ", exact: true });
  await approve.click();
  const payment = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
  await expect(payment.getByLabel("วิธีจ่าย", { exact: true })).toHaveValue(branch.id);
  await expect(payment.getByRole("spinbutton")).toHaveCount(0);
  await payment.press("Escape");
  await expect(approve).toBeFocused();
  expect(approvalCalls).toBe(0);
  await approve.click();
  await payment.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  await expect(payment.getByRole("alert")).toHaveText("สิทธิ์สาขาเปลี่ยน กรุณาตรวจสอบ");
  expect(status).toBe("PENDING");
  await payment.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  await expect(payment).toHaveCount(0);
  const change = payroll.getByRole("button", { name: "เปลี่ยนวิธีจ่าย", exact: true });
  await expect(change.locator("..")).toContainText(`จ่ายจาก: ${branch.name}`);
  await change.click();
  const correction = page.getByRole("dialog", { name: "เปลี่ยนวิธีจ่าย", exact: true });
  await correction.getByLabel("วิธีจ่ายใหม่").selectOption("__central_outside_system__");
  await correction.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(change.locator("..")).toContainText("ส่วนกลางจ่าย (จ่ายนอกระบบ)");
  expect(approvalCalls).toBe(2);
});

test("auto-approved payroll chooses the payer before creation and fits a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let created = false;
  let createCalls = 0;
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { permissions: { canManage: true, canDecide: true, canConfigure: true }, users: [employee], paymentLocations: [branch], pendingSlips: [], pendingTransactions: [], admins: [] } });
      return;
    }
    const { action, payload } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: created ? [{ ...slip, status: "APPROVED", expense_location_id: branch.id, expense_location_name: branch.name }] : [] } });
    } else if (action === "PREVIEW_PAYROLL_SLIP") {
      await route.fulfill({ json: { preview: { netPay: 500 } } });
    } else if (action === "CREATE_PAYROLL_SLIP") {
      expect(payload).toMatchObject({ user_id: employee.id, month: "2026-08", expense_location_id: branch.id, expected_net_pay: 500 });
      createCalls++;
      created = true;
      await route.fulfill({ json: { success: true } });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
  await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
  await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานวิธีจ่าย/ }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานวิธีจ่าย" });
  await payroll.getByRole("button", { name: "สร้างสลิปเงินเดือน", exact: true }).click();
  const create = page.getByRole("dialog", { name: "สร้างสลิปเงินเดือน", exact: true });
  await create.getByLabel("เดือน").fill("2026-08");
  await create.getByRole("button", { name: "ยืนยันสร้างสลิป" }).click();
  const payment = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
  await expect(payment.getByText("฿500.00", { exact: true })).toBeVisible();
  expect(createCalls).toBe(0);
  await payment.press("Escape");
  expect(createCalls).toBe(0);
  await expect(create.getByRole("button", { name: "ยืนยันสร้างสลิป" })).toBeFocused();
  await create.getByRole("button", { name: "ยืนยันสร้างสลิป" }).click();
  await payment.getByRole("button", { name: "สร้างและอนุมัติ", exact: true }).click();
  await expect(payroll.getByText("APPROVED", { exact: true })).toBeVisible();
  await expect(payroll.getByRole("button", { name: "เปลี่ยนวิธีจ่าย" }).locator("..")).toContainText(branch.name);
  expect(createCalls).toBe(1);
  expect(await payroll.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
