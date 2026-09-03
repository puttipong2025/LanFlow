import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controls = readFileSync(resolve("src/components/time-tracking/AttendanceControls.tsx"), "utf8");
const moduleSource = readFileSync(resolve("src/components/TimeTrackingModule.tsx"), "utf8");
const modalShellSource = readFileSync(resolve("src/components/shared/ModalShell.tsx"), "utf8");
const expenseLocationChangeSource = readFileSync(resolve("src/components/time-tracking/ExpenseLocationChangeModal.tsx"), "utf8");
const expenseLocationApprovalSource = readFileSync(resolve("src/components/time-tracking/ExpenseLocationApprovalModal.tsx"), "utf8");
const slipPreviewSource = readFileSync(resolve("src/components/time-tracking/SlipPreviewModal.tsx"), "utf8");

test.describe("Lean attendance UI contract", () => {
  test("keeps the exception controls labelled and uses native modal semantics", () => {
    expect(controls).toContain('nativeModal closeOnEscape');
    expect(controls).toContain('aria-label={`${date} ${dayOfWeek(date)}: ${calendarStatusLabel(status)}');
    expect(controls).toContain('role="alert"');
    expect(controls).toContain("setError(formatPayrollUiError(actionError))");
  });

  test("offers attendance editing only on an individual employee calendar", () => {
    expect(moduleSource).not.toContain("AttendanceBatchModal");
    expect(moduleSource).not.toContain("APPLY_ATTENDANCE_BATCH");
    expect(moduleSource).not.toContain("แก้ปฏิทินแบบกลุ่ม");
    expect(controls).not.toContain("AttendanceBatchModal");
    expect(controls).toContain("export function AttendanceCalendar");
  });

  test("does not present dates outside active periods as paid or editable", () => {
    expect(controls).toContain("const isActiveDate = (date: string) => attendance.periods.some");
    expect(controls).toContain('if (status === "INACTIVE") return "ไม่ได้คิดค่าแรง"');
    expect(controls).toContain("disabled={!activeDate || !eligibleDate || !editable || saving}");
    expect(controls).toContain(".filter(([date]) => isActiveDate(date) && isEligibleDate(date))");
  });

  test("does not present active-period dates after the server eligibility boundary as full days", () => {
    expect(controls).toContain('const eligibleThrough = attendance.eligibleThrough ?? "0000-00-00"');
    expect(controls).toContain("const eligibleDate = isEligibleDate(date)");
    expect(controls).toContain('!eligibleDate ? "PENDING"');
    expect(controls).toContain("disabled={!activeDate || !eligibleDate || !editable || saving}");
    expect(controls).toContain('if (status === "PENDING") return "ยังไม่ถึงวันทำงาน"');
    expect(controls).toContain('status === "PENDING" ? "ยังไม่ถึงวันทำงาน" : statusLabel(status)');
  });

  test("uses only exception-attendance actions and contains no TIMER controls", () => {
    for (const action of [
      "REPLACE_ATTENDANCE_EXCEPTIONS",
      "UPDATE_TIME_PAYROLL_CONFIG",
      "SET_PAYROLL_ACTIVE_PERIOD",
      "CORRECT_PAYROLL_PERIOD_START",
    ]) expect(moduleSource).toContain(action);

    expect(moduleSource).not.toContain('"TIMER"');
    expect(moduleSource).not.toContain("auto_start_next_month");
    expect(moduleSource).not.toContain("TOGGLE_TRACKING");
    expect(moduleSource).not.toContain("ADD_BULK_SEGMENTS");
    expect(moduleSource).toContain("<AttendanceCalendar");
  });

  test("guards month changes from stale responses and keeps employee withdrawals server-dated", () => {
    expect(moduleSource).toContain("const loadRequestIdRef = useRef(0)");
    expect(moduleSource).toContain("const requestId = ++loadRequestIdRef.current");
    expect(moduleSource).toContain("if (requestId !== loadRequestIdRef.current) return");
    expect(moduleSource).toContain("if (requestId === loadRequestIdRef.current) setLoading(false)");
    expect(moduleSource).toContain("const effectiveDate = canManageTime");
    expect(moduleSource).toContain(": { amount: Number(amount) }");
    expect(moduleSource).toContain("const requestId = ++adminLoadRequestIdRef.current");
    expect(moduleSource).toContain("if (requestId !== adminLoadRequestIdRef.current) return");
    expect(moduleSource).toContain("const loadSlipsRequestIdRef = useRef(0)");
    expect(moduleSource).toContain("const requestId = ++loadSlipsRequestIdRef.current");
    expect(moduleSource).toContain("if (requestId !== loadSlipsRequestIdRef.current) return");
  });

  test("removes inert admin month and payroll input-dialog state", () => {
    const adminSource = moduleSource.slice(
      moduleSource.indexOf("function AdminTimeTracking"),
      moduleSource.indexOf("function AuditLogsModal"),
    );
    const payrollModalSource = moduleSource.slice(moduleSource.indexOf("function PayrollModal"));

    expect(adminSource).not.toContain("setAttendanceMonth");
    expect(adminSource).not.toContain("time-tracking/admin?month=");
    expect(payrollModalSource).not.toContain("useInputDialog");
    expect(payrollModalSource).not.toContain("inputDialog");
  });

  test("keeps row actions in the management column as labelled emoji buttons", () => {
    expect(moduleSource).toContain("const periodState = user.period_state as PayrollPeriodStateDto | undefined");
    expect(moduleSource).toContain('const status = periodState?.currentStatus === "ACTIVE" ? \'ACTIVE_PERIOD\' : \'INACTIVE_PERIOD\'');
    expect(moduleSource).toContain("aria-label={overviewLabel}");
    expect(moduleSource).toContain('aria-label={`แก้ไขค่าแรงรายวันของ ${user.name}`}');
    expect(moduleSource).toContain("aria-label={payrollLabel}");
    expect(moduleSource).toContain('<span aria-hidden="true">🗓️</span>');
    expect(moduleSource).toContain('<span aria-hidden="true">✏️</span>');
    expect(moduleSource).toContain('<span aria-hidden="true">🧾</span>');
    expect(moduleSource).not.toContain('>แดชบอร์ด</th>');
    expect(moduleSource).not.toContain('>สรุปสิ้นเดือน</th>');
    expect(moduleSource).not.toContain("ดู Dashboard");
  });

  test("shows a branch filter, pending-only count badge, and server-authoritative action copy", () => {
    expect(moduleSource).toContain("กรองสาขา");
    expect(moduleSource).toContain('aria-label="กรองตามสถานะ"');
    expect(moduleSource).toContain('filter === "pending" && branchPendingCount > 0');
    expect(moduleSource).toContain('filter === "pending" && branchPendingCount > 0 && (');
    expect(moduleSource).toContain('window.addEventListener("focus", refreshVisibleData)');
    expect(moduleSource).toContain('document.addEventListener("visibilitychange", refreshVisibleData)');
    expect(moduleSource).not.toContain("hasPeriodHistory: false");
    expect(controls).toContain("สิ้นสุดสถานะเงินเดือนวันที่");
    expect(controls).toContain("คิดค่าแรงถึง");
    expect(controls).toContain("ระบบจะตรวจเวลาสิ้นสุดวันทำงานจากเซิร์ฟเวอร์");
    expect(controls).toContain("actionDraft &&");
    expect(controls).toContain('role={actionDraft.action === "END" ? "alertdialog" : "dialog"}');
    expect(controls).toContain('actionDraft.action === "RESUME" ? periodState.resumeEarliestOn');
    expect(controls).toContain("วันย้อนหลังนับเต็มวันตามปฏิทินเดิม");
    expect(controls).toContain('role="alertdialog"');
    expect(controls).toContain('title="ยกเลิกกำหนดการ"');
    expect(controls).toContain('title="แก้ไขวันเริ่มช่วงล่าสุด"');
    expect(controls).toContain("affectedMonths(correction.currentStartOn, correctionDate)");
    expect(controls).toContain("จะไม่เปลี่ยนวันสิ้นสุด สลิป หรือรายการหักเงินจริง");
    expect(controls).toContain('id="period-start-correction-error" role="alert"');
    expect(moduleSource).toContain('action: "CORRECT_PAYROLL_PERIOD_START"');
    expect(moduleSource).toContain("period_id: periodId");
    expect(modalShellSource).toContain("role={role}");
  });

  test("uses an action-first payroll-period UI inside the employee dialog", () => {
    expect(moduleSource.indexOf("<AttendancePeriodControls")).toBeLessThan(
      moduleSource.indexOf("<AttendanceCalendar"),
    );
    expect(controls).toContain('const [actionDraft, setActionDraft]');
    expect(controls).not.toContain(">วันที่มีผล<input");
    expect(controls).toContain('if (action === "ENABLE") return "เริ่มคิดค่าแรง"');
    expect(controls).toContain('if (action === "PAUSE") return "พักคิดค่าแรง"');
    expect(controls).toContain('if (action === "RESUME") return "กลับมาคิดค่าแรง"');
    expect(controls).toContain('return "สิ้นสุดสถานะเงินเดือน"');
    expect(controls).toContain('return "วันที่สิ้นสุดสถานะเงินเดือน"');
    expect(controls).toContain("แก้กำหนดการ");
    expect(controls).toContain("ยืนยันและแทนที่กำหนดเดิม");
    expect(controls).toContain("วันเริ่มที่ถูกต้อง");
    expect(controls).toContain("แก้ไขวันเริ่ม");
    expect(controls).not.toContain("ตรวจสอบวันใหม่");
    expect(controls).toContain('new Intl.DateTimeFormat("th-TH"');
    expect(controls).toContain("function formatPayrollUiError");
    expect(controls).toContain("setError(formatPayrollUiError(actionError))");
    expect(controls).toContain("setCorrectionError(formatPayrollUiError(correctionFailure))");
    expect(moduleSource).toContain("payrollPeriodActionLabel(periodState.nextAction.action)");
    expect(moduleSource).toContain("formatThaiDate(periodState.nextAction.activationOn)");
    expect(moduleSource).not.toContain("รอ {periodState.nextAction.action}");
  });

  test("uses accessible native dialogs for debt, payroll, and audit-history workflows", () => {
    const payrollModalSource = moduleSource.slice(moduleSource.indexOf("function PayrollModal"));
    const auditLogsModalSource = moduleSource.slice(
      moduleSource.indexOf("function AuditLogsModal"),
      moduleSource.indexOf("function PayrollModal"),
    );

    expect(payrollModalSource).toContain('title={`สลิปเงินเดือนของ ${user.name}`}');
    expect(payrollModalSource).toContain("closeDisabled={saving}");
    expect(payrollModalSource).toContain('title="สร้างสลิปเงินเดือน"');
    expect(payrollModalSource).toContain("nativeModal");
    expect(payrollModalSource).toContain("closeOnEscape");
    expect(auditLogsModalSource).toContain('title={`ประวัติการกระทำของ Admin: ${adminName}`}');
    expect(auditLogsModalSource).toContain("nativeModal");
    expect(auditLogsModalSource).toContain("closeOnEscape");
    expect(moduleSource).toContain('aria-label="ดูประวัติของแอดมิน"');
    expect(moduleSource).toContain('title="สร้างหนี้สิน"');
    expect(moduleSource).toContain('htmlFor="time-payroll-debt-date"');
    expect(moduleSource).toContain('title={dashboardUser.id === profile.id ? "ข้อมูลของตนเอง" : "ข้อมูลของพนักงาน"}');
    for (const source of [expenseLocationChangeSource, expenseLocationApprovalSource]) {
      expect(source).toContain("<ModalShell");
      expect(source).toContain("nativeModal");
      expect(source).toContain("closeOnEscape");
      expect(source).toContain("closeDisabled={saving}");
      expect(source).toContain('role="alert"');
    }
    expect(slipPreviewSource).toContain("nativeModal");
    expect(slipPreviewSource).toContain("closeOnEscape");
    expect(slipPreviewSource).toContain("closeDisabled={pdfShare.busy}");
    expect(modalShellSource).toContain("dialog.showModal()");
    expect(modalShellSource).toContain("event.stopPropagation()");
    expect(modalShellSource).toContain("previousFocus?.focus()");
  });
});

test.describe("Time/payroll native dialogs", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("keeps the payroll modal current while its parent summary refreshes", async ({ page }) => {
    const createdSlip = {
      id: "4c74fbd5-e08f-4510-8860-4b9e627aa89e",
      month: "2026-08-01",
      gross_pay: 15000,
      total_deductions: 0,
      net_pay: 15000,
      status: "PENDING",
      created_at: "2026-09-02T02:00:00.000Z",
      cancelled_at: null,
      expense_location_id: null,
      report_lock_no: null,
    };
    let listReads = 0;
    let initialListsReleased = false;
    let slipCreated = false;
    let expectingAdminRefresh = false;
    let releaseOldList!: () => void;
    let releaseAdminRefresh!: () => void;
    let markAdminRefreshRequested!: () => void;
    const oldListReleased = new Promise<void>((resolve) => { releaseOldList = resolve; });
    const adminRefreshReleased = new Promise<void>((resolve) => { releaseAdminRefresh = resolve; });
    const adminRefreshRequested = new Promise<void>((resolve) => { markAdminRefreshRequested = resolve; });

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() === "GET") {
        if (expectingAdminRefresh) {
          expectingAdminRefresh = false;
          markAdminRefreshRequested();
          await adminRefreshReleased;
        }
        await route.continue();
        return;
      }

      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "LIST_PAYROLL_SLIPS") {
        listReads += 1;
        if (!initialListsReleased) {
          await oldListReleased;
        }
        await route.fulfill({ json: { slips: slipCreated ? [createdSlip] : [] } });
        return;
      }

      if (body.action === "CREATE_PAYROLL_SLIP") {
        slipCreated = true;
        expectingAdminRefresh = true;
        await route.fulfill({ json: { success: true, slip: createdSlip } });
        return;
      }

      await route.continue();
    });
    page.on("dialog", (dialog) => void dialog.accept());

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ / }).first().click();

    const payrollDialog = page.getByRole("dialog", { name: /^สลิปเงินเดือนของ / });
    const createSlipButton = payrollDialog.getByRole("button", { name: "สร้างสลิปเงินเดือน", exact: true });
    await expect(createSlipButton).toBeDisabled();
    initialListsReleased = true;
    releaseOldList();
    await expect(createSlipButton).toBeEnabled();
    await createSlipButton.click();
    const createDialog = page.getByRole("dialog", { name: "สร้างสลิปเงินเดือน" });
    await createDialog.getByLabel("เดือน").fill("2026-08");
    await createDialog.getByRole("button", { name: "ยืนยันสร้างสลิป" }).click();

    await adminRefreshRequested;
    try {
      await expect.poll(() => listReads).toBeGreaterThanOrEqual(2);
      await expect(payrollDialog.getByText("สลิปเดือน 2026-08-01", { exact: true })).toBeVisible({ timeout: 750 });
    } finally {
      releaseAdminRefresh();
    }
  });

  test("updates the open employee detail before the admin summary refresh completes", async ({ page }) => {
    const employee = {
      id: "e85ab5ad-019c-474b-93cf-2c88a01cd2e4",
      name: "พนักงานอนุมัติทันที",
      daily_wage: 500,
      primary_location_id: null,
      debt_remaining_amount: 100,
    };
    const transaction = {
      id: "739b559c-9783-4813-9cbd-2f8c45456068",
      profile_id: employee.id,
      type: "DEBT",
      amount: 100,
      remaining_amount: 100,
      effective_date: "2026-09-02",
      created_at: "2026-09-02T03:00:00.000Z",
      status: "PENDING",
      description: "หนี้ทดสอบ",
      report_lock_no: null,
    };
    let approved = false;
    let releaseAdminRefresh!: () => void;
    let markAdminRefreshRequested!: () => void;
    const adminRefreshReleased = new Promise<void>((resolve) => { releaseAdminRefresh = resolve; });
    const adminRefreshRequested = new Promise<void>((resolve) => { markAdminRefreshRequested = resolve; });

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() === "GET") {
        if (approved) {
          markAdminRefreshRequested();
          await adminRefreshReleased;
        }
        await route.fulfill({
          json: {
            permissions: { canManage: true, canDecide: true, canConfigure: true },
            users: [employee],
            pendingTransactions: approved ? [] : [transaction],
            pendingSlips: [],
            paymentLocations: [],
            admins: [],
          },
        });
        return;
      }

      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "APPROVE_TRANSACTION") {
        approved = true;
        await route.fulfill({ json: { success: true, result: { status: "APPROVED" } } });
        return;
      }
      await route.continue();
    });
    await page.route("**/api/lanflow/time-tracking/user?*", (route) => route.fulfill({
      json: {
        transactions: [{ ...transaction, status: approved ? "APPROVED" : "PENDING" }],
        wageInfo: { remainingBalance: 0, totalDays: 0, totalDebt: 100 },
        attendance: null,
        periodState: null,
      },
    }));

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible();
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: /^จัดการปฏิทินวันทำงานของ พนักงานอนุมัติทันที/ }).click();
    const employeeDialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });
    await employeeDialog.getByRole("button", { name: "อนุมัติ" }).click();
    await page.getByLabel("เหตุผลการอนุมัติ").fill("อนุมัติจาก regression");
    await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await adminRefreshRequested;

    try {
      await expect(employeeDialog.getByText("APPROVED", { exact: true })).toBeVisible({ timeout: 1_000 });
      await expect(employeeDialog.getByRole("button", { name: "อนุมัติ" })).toHaveCount(0);
    } finally {
      releaseAdminRefresh();
    }
  });

  test("updates the open payroll slip once and keeps it visible during summary refresh", async ({ page }) => {
    const slip = {
      id: "fe281ea6-b8c6-401c-97f3-17fc60cd3408",
      month: "2026-08-01",
      gross_pay: 0,
      total_deductions: 0,
      net_pay: 0,
      created_at: "2026-09-02T03:00:00.000Z",
      cancelled_at: null,
      expense_location_id: null,
      report_lock_no: null,
    };
    let approved = false;
    let listReads = 0;
    let releaseAdminRefresh!: () => void;
    let markAdminRefreshRequested!: () => void;
    const adminRefreshReleased = new Promise<void>((resolve) => { releaseAdminRefresh = resolve; });
    const adminRefreshRequested = new Promise<void>((resolve) => { markAdminRefreshRequested = resolve; });

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() === "GET") {
        if (approved) {
          markAdminRefreshRequested();
          await adminRefreshReleased;
        }
        await route.continue();
        return;
      }

      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "LIST_PAYROLL_SLIPS") {
        listReads += 1;
        await route.fulfill({ json: { slips: [{ ...slip, status: approved ? "APPROVED" : "PENDING" }] } });
        return;
      }
      if (body.action === "APPROVE_PAYROLL_SLIP") {
        approved = true;
        await route.fulfill({ json: { success: true, result: { status: "APPROVED" } } });
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible();
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ / }).first().click();
    const payrollDialog = page.getByRole("dialog", { name: /^สลิปเงินเดือนของ / });
    await expect(payrollDialog.getByText("PENDING", { exact: true })).toBeVisible();
    const readsBeforeApproval = listReads;
    await payrollDialog.getByRole("button", { name: "อนุมัติ" }).click();
    await page.getByLabel("เหตุผลการอนุมัติ").fill("อนุมัติสลิปจาก regression");
    await page.getByRole("dialog", { name: "อนุมัติรายการ" }).getByRole("button", { name: "ยืนยัน" }).click();
    await adminRefreshRequested;

    try {
      await expect(payrollDialog.getByText("APPROVED", { exact: true })).toBeVisible({ timeout: 1_000 });
      expect(listReads).toBe(readsBeforeApproval + 1);
    } finally {
      releaseAdminRefresh();
    }
  });

  test("updates the open payroll payment method before the summary refresh completes", async ({ page }) => {
    const location = { id: "695e95b8-f4a7-4a0a-909f-f2f932c3ef8b", name: "สาขาจ่ายเงิน", code: "PAY", active: true };
    const employee = {
      id: "9d159aa0-d258-40b2-82f9-8a90517d0c61",
      name: "พนักงานเปลี่ยนวิธีจ่าย",
      daily_wage: 500,
      primary_location_id: location.id,
      debt_remaining_amount: 0,
    };
    const slip = {
      id: "45874010-28e4-4ed6-828d-1584a150170a",
      month: "2026-08-01",
      gross_pay: 15000,
      total_deductions: 0,
      net_pay: 15000,
      status: "APPROVED",
      created_at: "2026-09-02T03:00:00.000Z",
      cancelled_at: null,
      expense_location_id: location.id,
      report_lock_no: null,
    };
    let changed = false;
    let listReads = 0;
    let releaseAdminRefresh!: () => void;
    let markAdminRefreshRequested!: () => void;
    const adminRefreshReleased = new Promise<void>((resolve) => { releaseAdminRefresh = resolve; });
    const adminRefreshRequested = new Promise<void>((resolve) => { markAdminRefreshRequested = resolve; });

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() === "GET") {
        if (changed) {
          markAdminRefreshRequested();
          await adminRefreshReleased;
        }
        await route.fulfill({
          json: {
            permissions: { canManage: true, canDecide: true, canConfigure: true },
            users: [employee],
            pendingTransactions: [],
            pendingSlips: [],
            paymentLocations: [location],
            admins: [],
          },
        });
        return;
      }

      const body = route.request().postDataJSON() as { action?: string; payload?: { expense_location_id?: string | null } };
      if (body.action === "LIST_PAYROLL_SLIPS") {
        listReads += 1;
        await route.fulfill({ json: { slips: [{ ...slip, expense_location_id: changed ? null : location.id }] } });
        return;
      }
      if (body.action === "CHANGE_EXPENSE_LOCATION") {
        expect(body.payload?.expense_location_id).toBeNull();
        changed = true;
        await route.fulfill({ json: { success: true } });
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible();
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ พนักงานเปลี่ยนวิธีจ่าย/ }).click();
    const payrollDialog = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานเปลี่ยนวิธีจ่าย" });
    const readsBeforeChange = listReads;
    await payrollDialog.getByRole("button", { name: "เปลี่ยนวิธีจ่าย" }).click();
    const changeDialog = page.getByRole("dialog", { name: "เปลี่ยนวิธีจ่าย" });
    await changeDialog.getByLabel("วิธีจ่ายใหม่").selectOption("__central_outside_system__");
    await changeDialog.getByRole("button", { name: "บันทึก", exact: true }).click();
    await adminRefreshRequested;

    try {
      await expect(payrollDialog.getByText("ส่วนกลางจ่าย (จ่ายนอกระบบ)", { exact: true })).toBeVisible({ timeout: 1_000 });
      expect(listReads).toBe(readsBeforeChange + 1);
    } finally {
      releaseAdminRefresh();
    }
  });

  test("closes the employee calendar dialog with Escape and restores its trigger", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    const calendarButton = page.getByRole("button", { name: /^จัดการปฏิทินวันทำงานของ / }).first();
    await expect(calendarButton).toBeVisible();
    await calendarButton.click();

    const calendarDialog = page.getByRole("dialog", { name: /^(ข้อมูลของตนเอง|ข้อมูลของพนักงาน)$/ });
    await expect(calendarDialog).toBeVisible();
    await expect(calendarDialog.getByRole("button", { name: "ปิด", exact: true }).first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(calendarDialog).toBeHidden();
    await expect(calendarButton).toBeFocused();
  });

  test("closes the outer payroll dialog with Escape, restores its trigger, and keeps the outer dialog open after closing the nested form", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    const payrollButton = page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ / }).first();
    await expect(payrollButton).toBeVisible();
    await payrollButton.click();

    const payrollDialog = page.getByRole("dialog", { name: /^สลิปเงินเดือนของ / });
    await expect(payrollDialog).toBeVisible();
    await expect(payrollDialog.getByRole("button", { name: "ปิด", exact: true })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(payrollDialog).toBeHidden();
    await expect(payrollButton).toBeFocused();

    await payrollButton.click();
    const createButton = page.getByRole("button", { name: "สร้างสลิปเงินเดือน", exact: true });
    await expect(createButton).toBeVisible();
    await createButton.click();

    const dialog = page.getByRole("dialog", { name: "สร้างสลิปเงินเดือน" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("เดือน")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "ปิด", exact: true })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(payrollDialog).toBeVisible();
    await expect(createButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(payrollDialog).toBeHidden();
    await expect(payrollButton).toBeFocused();
  });

  test("closes the admin audit-history dialog with Escape and restores the select trigger", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });

    const auditSelect = page.getByLabel("ดูประวัติของแอดมิน");
    await expect(auditSelect).toBeVisible();
    const adminId = await auditSelect.locator("option").evaluateAll((options) => options
      .map((option) => (option as HTMLOptionElement).value)
      .find(Boolean));
    expect(adminId).toBeTruthy();
    if (!adminId) throw new Error("ไม่พบแอดมินสำหรับทดสอบหน้าประวัติ");

    await auditSelect.selectOption(adminId);
    const auditDialog = page.getByRole("dialog", { name: /^ประวัติการกระทำของ Admin: / });
    await expect(auditDialog).toBeVisible();
    await expect(auditDialog.getByRole("button", { name: "ปิด", exact: true })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(auditDialog).toBeHidden();
    await expect(auditSelect).toBeFocused();
  });

  test("keeps branch and status controls usable without page overflow at 360px and 393px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });

    await expect(page.getByLabel("กรองสาขา")).toBeVisible();
    const allButton = page.getByRole("button", { name: "ทั้งหมด", exact: true });
    const pendingButton = page.getByRole("button", { name: /^รออนุมัติ/ });
    await allButton.click();
    await expect(allButton).toHaveAttribute("aria-pressed", "true");
    await pendingButton.click();
    await expect(pendingButton).toHaveAttribute("aria-pressed", "true");
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    await page.setViewportSize({ width: 393, height: 852 });
    const widerDimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(widerDimensions.scrollWidth).toBeLessThanOrEqual(widerDimensions.width);
  });
});
