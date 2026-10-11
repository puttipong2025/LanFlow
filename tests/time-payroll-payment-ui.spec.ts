import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });
const branch = { id: "71000000-0000-4000-8000-000000000001", name: "สาขาผู้จ่าย A", code: "PAYA", active: true };
const secondBranch = { id: "71000000-0000-4000-8000-000000000002", name: "สาขาผู้จ่าย B", code: "PAYB", active: true };
const employee = { id: "72000000-0000-4000-8000-000000000001", name: "พนักงานวิธีจ่าย", role: "user", is_active: true, daily_wage: 500, primary_location_id: branch.id };
const slip = { id: "73000000-0000-4000-8000-000000000001", profile_id: employee.id, month: "2026-08", gross_pay: 500, total_deductions: 0, net_pay: 500, created_at: "2026-09-01T01:00:00Z", cancelled_at: null, report_lock_no: null };

function branchSummary(
  locationId: string,
  netCashFlow: unknown,
  options: {
    snapshotStatus?: string;
    isOverdue?: boolean;
    calculatedAt?: string | null;
    cashStatus?: string;
    summary?: null;
  } = {},
) {
  return {
    locationId,
    snapshotStatus: options.snapshotStatus ?? "ready",
    isOverdue: options.isOverdue ?? false,
    calculatedAt: options.calculatedAt === undefined ? "2026-10-11T01:00:00.000Z" : options.calculatedAt,
    cashStatus: options.cashStatus ?? "normal",
    summary: options.summary === null ? null : {
      netCashFlow,
      rubberInventoryWeight: 0,
      purchaseToday: {
        paidTotal: 0,
        billCount: 0,
        netWeight: 0,
        averagePrice: null,
        rubberValue: 0,
        deductionTotal: 0,
        unpricedBillCount: 0,
        pendingApprovalCount: 0,
      },
    },
  };
}

async function mockBranchSummaries(page: Page, summaries = [branchSummary(branch.id, 300)]) {
  await page.route("**/api/lanflow/dashboard/branch-summaries", async (route) => {
    await route.fulfill({ json: summaries });
  });
}

test("approval uses the shared payment dialog and persists the displayed payer only after success", async ({ page }) => {
  let status = "PENDING";
  let payer: string | null = null;
  let transferAmount = 0;
  let approvalCalls = 0;
  await mockBranchSummaries(page, [branchSummary(branch.id, 300), branchSummary(secondBranch.id, 100)]);
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { permissions: { canManage: true, canDecide: true, canConfigure: true }, users: [employee], paymentLocations: [branch], pendingSlips: status === "PENDING" ? [slip] : [], pendingTransactions: [], admins: [] } });
      return;
    }
    const { action, payload } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: [{ ...slip, status, expense_location_id: payer, expense_location_name: payer ? branch.name : null, payment_channel: payer ? "branch_and_transfer" : "outside_system", payment_transfer_amount: transferAmount }] } });
    } else if (action === "APPROVE_PAYROLL_SLIP") {
      approvalCalls++;
      expect(payload.payment).toMatchObject({ channel: "branch_and_transfer", expenseLocationId: branch.id, transferAmount: "125", expectedSourceAmount: 500 });
      if (approvalCalls === 1) {
        await route.fulfill({ status: 403, json: { error: "สิทธิ์สาขาเปลี่ยน กรุณาตรวจสอบ" } });
        return;
      }
      payer = payload.payment.expenseLocationId;
      transferAmount = Number(payload.payment.transferAmount);
      status = "APPROVED";
      await route.fulfill({ json: { success: true } });
    } else if (action === "CHANGE_PAYMENT_ALLOCATION") {
      expect(payload.payment).toMatchObject({ channel: "outside_system", expenseLocationId: null, transferAmount: null, expectedSourceAmount: 500 });
      payer = null;
      transferAmount = 0;
      await route.fulfill({ json: { success: true } });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^เวลาและเงินเดือน/ }).click();
  await page.getByLabel("กรองสาขา").selectOption(branch.id);
  await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานวิธีจ่าย/ }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานวิธีจ่าย" });
  const approve = payroll.getByRole("button", { name: "อนุมัติ", exact: true });
  await approve.click();
  const payment = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
  await expect(payment.getByRole("radio")).toHaveCount(2);
  await expect(payment.getByRole("radio", { checked: true })).toHaveCount(0);
  await payment.press("Escape");
  await expect(approve).toBeFocused();
  expect(approvalCalls).toBe(0);
  await approve.click();
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();
  const netCashFlowCard = payment.getByText("รับ–จ่ายสุทธิของสาขา").locator("..");
  await expect(netCashFlowCard.getByText("฿300.00", { exact: true })).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("200");
  await expect(payment.getByLabel("สาขาที่จ่ายส่วนต่าง")).toHaveValue(branch.id);
  await expect(payment.getByRole("option", { name: /สาขาผู้จ่าย B/ })).toHaveCount(0);
  await payment.getByText("จ่ายนอกระบบ", { exact: true }).click();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveCount(0);
  await expect(payment.getByLabel("สาขาที่จ่ายส่วนต่าง")).toHaveCount(0);
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("200");
  await expect(payment.getByLabel("สาขาที่จ่ายส่วนต่าง")).toHaveValue(branch.id);
  const submitPayment = payment.getByRole("button", { name: "อนุมัติ", exact: true });
  await payment.getByLabel("ยอดโอนเงิน").fill("1e2");
  await expect(submitPayment).toBeDisabled();
  await payment.getByLabel("ยอดโอนเงิน").fill("01");
  await expect(submitPayment).toBeDisabled();
  await payment.getByLabel("ยอดโอนเงิน").fill("1.001");
  await expect(submitPayment).toBeDisabled();
  await payment.getByLabel("ยอดโอนเงิน").fill("125");
  await payment.getByLabel("สาขาที่จ่ายส่วนต่าง").selectOption(branch.id);
  await submitPayment.click();
  await expect(payment.getByRole("alert")).toHaveText("สิทธิ์สาขาเปลี่ยน กรุณาตรวจสอบ");
  expect(status).toBe("PENDING");
  await payment.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  await expect(payment).toHaveCount(0);
  const change = payroll.getByRole("button", { name: "เปลี่ยนวิธีจ่าย", exact: true });
  await expect(change.locator("..")).toContainText(`โอน 125.00 บาท + ${branch.name} จ่ายส่วนต่าง`);
  await change.click();
  const correction = page.getByRole("dialog", { name: "เปลี่ยนวิธีจ่าย", exact: true });
  await correction.getByText("จ่ายนอกระบบ", { exact: true }).click();
  await correction.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(change.locator("..")).toContainText("จ่ายนอกระบบ");
  expect(approvalCalls).toBe(2);
});

test("auto-approved payroll chooses the payer before creation and fits a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let created = false;
  let createCalls = 0;
  await mockBranchSummaries(page, [branchSummary(branch.id, 250, { snapshotStatus: "dirty" })]);
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { permissions: { canManage: true, canDecide: true, canConfigure: true }, users: [employee], paymentLocations: [branch], pendingSlips: [], pendingTransactions: [], admins: [] } });
      return;
    }
    const { action, payload } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: created ? [{ ...slip, status: "APPROVED", expense_location_id: branch.id, expense_location_name: branch.name, payment_channel: "branch_and_transfer", payment_transfer_amount: 250 }] : [] } });
    } else if (action === "PREVIEW_PAYROLL_SLIP") {
      await route.fulfill({ json: { preview: { netPay: 500 } } });
    } else if (action === "CREATE_PAYROLL_SLIP") {
      expect(payload).toMatchObject({
        user_id: employee.id,
        month: "2026-08",
        expected_net_pay: 500,
        payment: { channel: "branch_and_transfer", expenseLocationId: branch.id, transferAmount: "250", expectedSourceAmount: 500 },
      });
      createCalls++;
      created = true;
      await route.fulfill({ json: { success: true } });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^เวลาและเงินเดือน/ }).click();
  await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
  await page.getByLabel("กรองสาขา").selectOption(branch.id);
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
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();
  await expect(payment.getByText(/ข้อมูลอาจไม่สด/)).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("250");
  await payment.getByLabel("สาขาที่จ่ายส่วนต่าง").selectOption(branch.id);
  await payment.getByRole("button", { name: "สร้างและอนุมัติ", exact: true }).click();
  await expect(payroll.getByText("APPROVED", { exact: true })).toBeVisible();
  await expect(payroll.getByRole("button", { name: "เปลี่ยนวิธีจ่าย" }).locator("..")).toContainText(branch.name);
  expect(createCalls).toBe(1);
  expect(await payroll.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("late branch summaries preserve manual input and a branch change starts a new recommendation", async ({ page }) => {
  let releaseSummaries: (() => void) | undefined;
  const summariesReady = new Promise<void>((resolve) => { releaseSummaries = resolve; });
  await page.route("**/api/lanflow/dashboard/branch-summaries", async (route) => {
    await summariesReady;
    await route.fulfill({
      json: [branchSummary(branch.id, 300), branchSummary(secondBranch.id, 100)],
    });
  });
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [employee],
          paymentLocations: [branch, secondBranch],
          pendingSlips: [slip],
          pendingTransactions: [],
          admins: [],
        },
      });
      return;
    }
    const { action } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: [{ ...slip, status: "PENDING" }] } });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^เวลาและเงินเดือน/ }).click();
  await page.getByLabel("กรองสาขา").selectOption(branch.id);
  await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานวิธีจ่าย/ }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานวิธีจ่าย" });
  await payroll.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("500");
  await payment.getByLabel("ยอดโอนเงิน").fill("125");

  releaseSummaries?.();
  const netCashFlowCard = payment.getByText("รับ–จ่ายสุทธิของสาขา").locator("..");
  await expect(netCashFlowCard.getByText("฿300.00", { exact: true })).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("125");

  await payment.getByLabel("สาขาที่จ่ายส่วนต่าง").selectOption(secondBranch.id);
  await expect(netCashFlowCard.getByText("฿100.00", { exact: true })).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("400");
});

test("a failed first summary request keeps the dialog usable with a full-transfer fallback", async ({ page }) => {
  await page.route("**/api/lanflow/dashboard/branch-summaries", async (route) => {
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [employee],
          paymentLocations: [branch],
          pendingSlips: [slip],
          pendingTransactions: [],
          admins: [],
        },
      });
      return;
    }
    const { action } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: [{ ...slip, status: "PENDING" }] } });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^เวลาและเงินเดือน/ }).click();
  await page.getByLabel("กรองสาขา").selectOption(branch.id);
  await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานวิธีจ่าย/ }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานวิธีจ่าย" });
  await payroll.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();

  await expect(payment.getByLabel("สาขาที่จ่ายส่วนต่าง")).toHaveValue(branch.id);
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("500");
  await expect(payment.getByText(/โหลดรับ–จ่ายสุทธิไม่ได้/)).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("500");
  await expect(payment.getByRole("button", { name: "อนุมัติ", exact: true })).toBeEnabled();
});

test("a malformed branch-summary timestamp cannot crash the payment dialog", async ({ page }) => {
  await mockBranchSummaries(page, [branchSummary(branch.id, 300, { calculatedAt: "not-a-date" })]);
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [employee],
          paymentLocations: [branch],
          pendingSlips: [slip],
          pendingTransactions: [],
          admins: [],
        },
      });
      return;
    }
    const { action } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: [{ ...slip, status: "PENDING" }] } });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^เวลาและเงินเดือน/ }).click();
  await page.getByLabel("กรองสาขา").selectOption(branch.id);
  await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานวิธีจ่าย/ }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานวิธีจ่าย" });
  await payroll.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();

  await expect(payment.getByText("รับ–จ่ายสุทธิของสาขา")).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("200");
});

test("a failed branch snapshot is disclosed while keeping the full-transfer fallback", async ({ page }) => {
  await mockBranchSummaries(page, [branchSummary(branch.id, 0, {
    snapshotStatus: "failed",
    calculatedAt: null,
    cashStatus: "no_data",
    summary: null,
  })]);
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [employee],
          paymentLocations: [branch],
          pendingSlips: [slip],
          pendingTransactions: [],
          admins: [],
        },
      });
      return;
    }
    const { action } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: [{ ...slip, status: "PENDING" }] } });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^เวลาและเงินเดือน/ }).click();
  await page.getByLabel("กรองสาขา").selectOption(branch.id);
  await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานวิธีจ่าย/ }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานวิธีจ่าย" });
  await payroll.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();

  await expect(payment.getByText(/คำนวณรับ–จ่ายสุทธิไม่สำเร็จ/)).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("500");
  await expect(payment.getByRole("button", { name: "อนุมัติ", exact: true })).toBeEnabled();
});

test("a time-payroll manager without the business app header still receives the branch recommendation", async ({ page }) => {
  const managerProfile = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "ผู้จัดการเงินเดือนส่วนกลาง",
    phone: "0800000000",
    role: "super_admin",
    isActive: true,
    locationIds: [],
    primaryLocationId: null,
    canAccessSystemManager: true,
    canManageTimePayroll: true,
  };
  let summaryRequests = 0;
  let netCashFlow = 300;
  let releaseRefreshedSummary: (() => void) | undefined;
  const refreshedSummaryReady = new Promise<void>((resolve) => {
    releaseRefreshedSummary = resolve;
  });

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: { profile: managerProfile } });
  });
  await page.route("**/api/lanflow", async (route) => {
    await route.fulfill({
      json: {
        locations: [],
        profile: managerProfile,
        confirmationMinutes: null,
        rubberWeightAlertConfig: null,
      },
    });
  });
  await page.route("**/api/lanflow/dashboard/branch-summaries", async (route) => {
    summaryRequests += 1;
    if (summaryRequests === 2) {
      await refreshedSummaryReady;
    }
    await route.fulfill({ json: [branchSummary(branch.id, netCashFlow)] });
  });
  await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [employee],
          paymentLocations: [branch],
          pendingSlips: [slip],
          pendingTransactions: [],
          admins: [],
        },
      });
      return;
    }
    const { action } = route.request().postDataJSON();
    if (action === "LIST_PAYROLL_SLIPS") {
      await route.fulfill({ json: { slips: [{ ...slip, status: "PENDING" }] } });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "เวลาและเงินเดือน" })).toBeVisible();
  await page.getByLabel("กรองสาขา").selectOption(branch.id);
  await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานวิธีจ่าย/ }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานวิธีจ่าย" });
  await payroll.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();

  const netCashFlowCard = payment.getByText("รับ–จ่ายสุทธิของสาขา").locator("..");
  await expect(netCashFlowCard.getByText("฿300.00", { exact: true })).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("200");
  expect(summaryRequests).toBe(1);
  await payment.press("Escape");

  netCashFlow = 100;
  await payroll.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  await expect.poll(() => summaryRequests).toBe(2);
  await payment.getByText("โอนเงิน + สาขาจ่าย", { exact: true }).click();

  await expect(netCashFlowCard.getByText("฿300.00", { exact: true })).toBeVisible();
  await expect(payment.getByText(/ข้อมูลอาจไม่สด/)).toBeVisible();
  releaseRefreshedSummary?.();
  await expect(netCashFlowCard.getByText("฿100.00", { exact: true })).toBeVisible();
  await expect(payment.getByLabel("ยอดโอนเงิน")).toHaveValue("400");
  expect(summaryRequests).toBe(2);

  await page.context().setOffline(true);
  await expect(netCashFlowCard.getByText("฿100.00", { exact: true })).toBeVisible();
  await expect(payment.getByText(/ข้อมูลอาจไม่สด/)).toBeVisible();
  expect(summaryRequests).toBe(2);
});
