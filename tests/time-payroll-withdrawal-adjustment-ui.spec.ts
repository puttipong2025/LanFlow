import { expect, test } from "@playwright/test";

import { formatBangkokDateTime } from "@/lib/bangkok-date";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const branch = {
  id: "71000000-0000-4000-8000-000000000001",
  name: "สาขาปรับยอด",
  code: "WADJ",
  active: true,
};
const sourceBranch = {
  id: "71000000-0000-4000-8000-000000000002",
  name: "สาขารายการเดิม",
  code: "WSRC",
  active: true,
};
const employee = {
  id: "72000000-0000-4000-8000-000000000001",
  name: "พนักงานปรับยอด",
  role: "user",
  is_active: true,
  daily_wage: 500,
  primary_location_id: branch.id,
  debt_remaining_amount: 1000,
};
const withdrawal = {
  id: "73000000-0000-4000-8000-000000000001",
  profile_id: employee.id,
  type: "WITHDRAWAL",
  amount: 1000,
  remaining_amount: 1000,
  status: "APPROVED",
  effective_date: "2026-09-01",
  created_at: "2026-09-01T01:00:00Z",
  approved_at: "2026-09-01T01:10:00Z",
  updated_at: "2026-09-19T01:10:00Z",
  report_lock_no: "RPT-20260901-001",
  expense_location_id: branch.id,
  expense_location_name: branch.name,
};

test("manager adjusts a locked withdrawal with a clear signed preview and branch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let latestTarget = 1000;
  let adjustments: Array<Record<string, unknown>> = [];
  let postCalls = 0;

  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [employee],
          paymentLocations: [branch, sourceBranch],
          pendingSlips: [],
          pendingTransactions: [],
          admins: [],
        },
      });
      return;
    }
    const { action, payload } = route.request().postDataJSON();
    if (action === "ADMIN_REQUEST_WITHDRAWAL_ADJUSTMENT") {
      postCalls += 1;
      expect(payload).toMatchObject({
        withdrawal_id: withdrawal.id,
        target_amount: 600,
        expense_location_id: sourceBranch.id,
        reason: "คืนส่วนที่เบิกเกิน",
      });
      expect(payload).not.toHaveProperty("user_id");
      adjustments = [{
        id: "74000000-0000-4000-8000-000000000001",
        parent_debt_id: withdrawal.id,
        amount: 600,
        adjustment_base_amount: 1000,
        status: "APPROVED",
        created_at: "2026-09-19T02:00:00Z",
        description: "ปรับยอดเบิก 73000000: 1000.00 → 600.00 (ลด 400.00)",
      }];
      latestTarget = 600;
      await route.fulfill({ json: { success: true } });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/lanflow/time-tracking/user?**", async (route) => {
    await route.fulfill({
      json: {
        wageInfo: { totalDays: 0, grossPay: 0, remainingBalance: 0, totalDebt: latestTarget },
        transactions: [{ ...withdrawal, expense_location_id: sourceBranch.id, expense_location_name: sourceBranch.name }],
        debts: [],
        deductions: [],
        slips: [],
        adjustments,
        adjustmentSummaries: [{
          withdrawalId: withdrawal.id,
          latestTarget,
          closedSlipFloor: 300,
          pendingAdjustmentId: null,
        }],
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
  await page.getByRole("button", { name: `จัดการปฏิทินวันทำงานของ ${employee.name}` }).click();
  const employeeDialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });
  await expect(employeeDialog.getByText(
    `วันที่อนุมัติ: ${formatBangkokDateTime(withdrawal.approved_at)}`,
    { exact: true },
  )).toBeVisible();
  const adjustButton = employeeDialog.getByRole("button", { name: "ปรับยอดเบิก", exact: true });
  await adjustButton.click();

  let adjustmentDialog = page.getByRole("dialog", { name: "ปรับยอดเบิกเงิน" });
  await adjustmentDialog.press("Escape");
  await expect(adjustButton).toBeFocused();
  await adjustButton.click();
  adjustmentDialog = page.getByRole("dialog", { name: "ปรับยอดเบิกเงิน" });
  await expect(adjustmentDialog.getByText("฿1,000.00", { exact: true })).toBeVisible();
  await expect(adjustmentDialog.getByText("฿300.00", { exact: true })).toBeVisible();
  await adjustmentDialog.getByLabel("ยอดเบิกใหม่ (บาท)").fill("200");
  await expect(adjustmentDialog.getByText("ยอดใหม่ต่ำกว่ายอดที่ถูกหักในสลิปเก่าซึ่งปิดแล้ว")).toBeVisible();
  await expect(adjustmentDialog.getByRole("button", { name: "บันทึกและอนุมัติ" })).toBeDisabled();

  await adjustmentDialog.getByLabel("ยอดเบิกใหม่ (บาท)").fill("600");
  await expect(adjustmentDialog.getByText("เพิ่มรายรับ (คืนเงิน) ฿400.00")).toBeVisible();
  await expect(adjustmentDialog.getByLabel("สาขาที่รับ–จ่ายส่วนต่าง")).toHaveValue(sourceBranch.id);
  await expect(adjustmentDialog.getByLabel("สาขาที่รับ–จ่ายส่วนต่าง").locator('option[value="__central_outside_system__"]')).toHaveCount(0);
  await adjustmentDialog.getByLabel("รายละเอียดเพิ่มเติม (ไม่บังคับ)").fill("คืนส่วนที่เบิกเกิน");
  await adjustmentDialog.getByRole("button", { name: "บันทึกและอนุมัติ" }).click();

  await expect(adjustmentDialog).toHaveCount(0);
  await expect(employeeDialog.getByText("เบิกเงิน ฿600", { exact: true })).toBeVisible();
  await expect(employeeDialog.getByText(/฿1,000 → ฿600/)).toBeVisible();
  expect(await employeeDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(postCalls).toBe(1);
});

test("manager approval preselects the locked withdrawal source branch", async ({ page }) => {
  const pendingAdjustmentId = "74000000-0000-4000-8000-000000000003";
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      json: {
        permissions: { canManage: true, canDecide: true, canConfigure: true },
        users: [employee],
        paymentLocations: [branch, sourceBranch],
        pendingSlips: [],
        pendingTransactions: [{ profile_id: employee.id }],
        admins: [],
      },
    });
  });
  await page.route("**/api/lanflow/time-tracking/user?**", async (route) => {
    await route.fulfill({
      json: {
        wageInfo: { totalDays: 0, grossPay: 0, remainingBalance: 0, totalDebt: 1000 },
        transactions: [{
          ...withdrawal,
          expense_location_id: sourceBranch.id,
          expense_location_name: sourceBranch.name,
        }],
        debts: [],
        deductions: [],
        slips: [],
        adjustments: [{
          id: pendingAdjustmentId,
          parent_debt_id: withdrawal.id,
          amount: 600,
          adjustment_base_amount: 1000,
          status: "PENDING",
          created_at: "2026-09-19T02:00:00Z",
          description: "ปรับยอดเบิก 73000000: 1000.00 → 600.00 (ลด 400.00)",
        }],
        adjustmentSummaries: [{
          withdrawalId: withdrawal.id,
          latestTarget: 1000,
          closedSlipFloor: 0,
          pendingAdjustmentId,
        }],
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
  await page.getByRole("button", { name: `จัดการปฏิทินวันทำงานของ ${employee.name}` }).click();
  const employeeDialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });
  await employeeDialog.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  const approvalDialog = page.getByRole("dialog", { name: "เลือกวิธีจ่าย" });
  await expect(approvalDialog.getByLabel("วิธีจ่าย")).toHaveValue(sourceBranch.id);
});

test("manager API rejects an adjustment without a branch before calling the RPC", async ({ request }) => {
  const response = await request.post("/api/lanflow/time-tracking/admin", {
    data: {
      action: "ADMIN_REQUEST_WITHDRAWAL_ADJUSTMENT",
      payload: { withdrawal_id: withdrawal.id, target_amount: 600, expense_location_id: null },
    },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: "ข้อมูลปรับยอดเบิกไม่ถูกต้อง" });
});

test.describe("employee self-service adjustment", () => {
  test.use({ storageState: "playwright/.auth/user.json" });

  test("employee API rejects malformed targets and withdrawal identifiers", async ({ request }) => {
    for (const payload of [
      { withdrawal_id: withdrawal.id, target_amount: "NaN" },
      { withdrawal_id: "not-a-uuid", target_amount: 600 },
    ]) {
      const response = await request.post("/api/lanflow/time-tracking/user", {
        data: { action: "REQUEST_WITHDRAWAL_ADJUSTMENT", payload },
      });
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ error: "ข้อมูลปรับยอดเบิกไม่ถูกต้อง" });
    }
  });

  test("submits and withdraws a pending request without choosing a branch", async ({ page }) => {
    let pending = false;
    const actions: string[] = [];
    const adjustmentId = "74000000-0000-4000-8000-000000000002";

    await page.route("**/api/lanflow/time-tracking/user?**", async (route) => {
      await route.fulfill({
        json: {
          wageInfo: { totalDays: 0, grossPay: 0, remainingBalance: 0, totalDebt: 1000 },
          transactions: [withdrawal],
          debts: [],
          deductions: [],
          slips: [],
          adjustments: pending ? [{
            id: adjustmentId,
            parent_debt_id: withdrawal.id,
            amount: 600,
            adjustment_base_amount: 1000,
            status: "PENDING",
            created_at: "2026-09-19T02:00:00Z",
            description: "ปรับยอดเบิก 73000000: 1000.00 → 600.00 (ลด 400.00)",
          }] : [],
          adjustmentSummaries: [{
            withdrawalId: withdrawal.id,
            latestTarget: 1000,
            closedSlipFloor: 0,
            pendingAdjustmentId: pending ? adjustmentId : null,
          }],
        },
      });
    });
    await page.route("**/api/lanflow/time-tracking/user", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const { action, payload } = route.request().postDataJSON();
      actions.push(action);
      if (action === "REQUEST_WITHDRAWAL_ADJUSTMENT") {
        expect(payload).toMatchObject({
          withdrawal_id: withdrawal.id,
          target_amount: 600,
          reason: "",
        });
        expect(payload).not.toHaveProperty("user_id");
        expect(payload).not.toHaveProperty("expense_location_id");
        pending = true;
      } else if (action === "WITHDRAW_WITHDRAWAL_ADJUSTMENT") {
        expect(payload.adjustment_id).toBe(adjustmentId);
        pending = false;
      } else {
        throw new Error(`Unexpected employee action: ${action}`);
      }
      await route.fulfill({ json: { success: true } });
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ระบบเวลาและเงินเดือน (ของตนเอง)" })).toBeVisible();
    const adjustButton = page.getByRole("button", { name: "ปรับยอดเบิก", exact: true });
    await adjustButton.click();
    const dialog = page.getByRole("dialog", { name: "ปรับยอดเบิกเงิน" });
    await expect(dialog.getByLabel("สาขาที่รับ–จ่ายส่วนต่าง")).toHaveCount(0);
    await dialog.getByLabel("ยอดเบิกใหม่ (บาท)").fill("600");
    await dialog.getByRole("button", { name: "ส่งคำขอ" }).click();
    await expect(adjustButton).toBeDisabled();
    await expect(page.getByRole("button", { name: "ถอนคำขอ" })).toBeVisible();
    page.once("dialog", (confirmation) => confirmation.accept());
    await page.getByRole("button", { name: "ถอนคำขอ" }).click();
    await expect(adjustButton).toBeEnabled();
    expect(actions).toEqual(["REQUEST_WITHDRAWAL_ADJUSTMENT", "WITHDRAW_WITHDRAWAL_ADJUSTMENT"]);
  });
});
