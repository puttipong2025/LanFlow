import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(path), "utf8");
const controls = [
  "src/components/time-tracking/attendance/AttendanceCalendar.tsx",
  "src/components/time-tracking/periods/AttendancePeriodControls.tsx",
  "src/components/time-tracking/settings/TimePayrollConfigPanel.tsx",
  "src/components/time-tracking/display.ts",
].map(readSource).join("\n");
const employeeSource = [
  "src/components/time-tracking/employee/EmployeeWorkspace.tsx",
  "src/components/time-tracking/employee/EmployeeDialogs.tsx",
  "src/components/time-tracking/employee/EmployeeTransactionHistory.tsx",
  "src/components/time-tracking/employee/employee-attendance-actions.ts",
].map(readSource).join("\n");
const managerSource = [
  "src/components/time-tracking/manager/ManagerWorkspace.tsx",
  "src/components/time-tracking/manager/ManagerHeader.tsx",
  "src/components/time-tracking/manager/ManagerEmployeeDirectory.tsx",
  "src/components/time-tracking/manager/ManagerDialogs.tsx",
].map(readSource).join("\n");
const payrollModalSource = readSource("src/components/time-tracking/payroll/PayrollModal.tsx");
const employeeSlipListSource = readSource("src/components/time-tracking/employee/EmployeeSlipList.tsx");
const auditLogsModalSource = readSource("src/components/time-tracking/audit/AuditLogsModal.tsx");
const moduleSource = [
  readSource("src/components/TimeTrackingModule.tsx"),
  employeeSource,
  managerSource,
  payrollModalSource,
  auditLogsModalSource,
].join("\n");
const modalShellSource = readFileSync(resolve("src/components/shared/ModalShell.tsx"), "utf8");
const expenseLocationChangeSource = readFileSync(resolve("src/components/time-tracking/ExpenseLocationChangeModal.tsx"), "utf8");
const slipPreviewSource = readFileSync(resolve("src/components/time-tracking/SlipPreviewModal.tsx"), "utf8");

test.beforeEach(async ({ page }) => {
  await page.route("**/api/lanflow/rubber-weight-alert", (route) => route.fulfill({
    json: {
      config: { thresholdKg: 10_000, intervalMinutes: 60 },
      candidates: [],
    },
  }));
});

test.describe("Lean attendance UI contract", () => {
  test("keeps the exception controls labelled and uses native modal semantics", () => {
    expect(controls).toContain('nativeModal closeOnEscape');
    expect(controls).toContain('aria-label={`${date} ${dayOfWeek(date)}: ${calendarStatusLabel(status)}');
    expect(controls).toContain('role="alert"');
    expect(controls).toContain("setError(formatPayrollUiError(actionError))");
  });

  test("refreshes the affected branch after approving an adjustment or payment allocation", () => {
    expect(managerSource).toContain(
      "invalidatePaymentLocations(queryClient, profile.id, [expenseLocationId, payment?.expenseLocationId])",
    );
    expect(employeeSource).toContain(
      "invalidatePaymentLocations(queryClient, profile.id, [value.locationId])",
    );
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

  test("shows the server-confirmed open deduction summary without adding another dialog", () => {
    expect(moduleSource).toContain("notifyAttendanceSaved(json.result");
    expect(moduleSource).toContain("oldOpenDeduction");
    expect(moduleSource).toContain("newOpenDeduction");
    expect(moduleSource).toContain("deductionsChanged");
    expect(moduleSource).toContain("ยอดหักเดือนเปิด");
    expect(moduleSource).toContain('toast.success("บันทึกและคำนวณยอดหักใหม่แล้ว"');
    expect(controls).not.toContain("AttendanceDeductionSummaryDialog");
    expect(controls).toContain('id="attendance-calendar-error" role="alert"');
    expect(moduleSource).not.toContain('alert(json?.error || "บันทึกปฏิทินไม่สำเร็จ")');
  });

  test("binds attendance replacement to the loaded server snapshot", () => {
    expect(moduleSource).toContain("month: attendance.month, selections");
    expect(moduleSource).toContain("saving={saving || loading || attendance.month !== attendanceMonth}");
  });

  test("clears a failed attendance save when the user discards the draft", () => {
    expect(controls).toContain('onClick={() => { setDraft(null); setSaveError(null); }}');
  });

  test("guards month changes from stale responses and keeps employee withdrawals server-dated", () => {
    expect(moduleSource).toContain("const loadRequestIdRef = useRef(0)");
    expect(moduleSource).toContain("const requestId = ++loadRequestIdRef.current");
    expect(moduleSource).toContain("if (requestId !== loadRequestIdRef.current) return");
    expect(moduleSource).toContain("if (requestId === loadRequestIdRef.current) setLoading(false)");
    expect(moduleSource).toContain("const effectiveDate = canManageTime");
    expect(moduleSource).toContain(": { amount },");
    expect(moduleSource).toContain("const requestId = ++adminLoadRequestIdRef.current");
    expect(moduleSource).toContain("if (requestId !== adminLoadRequestIdRef.current) return");
    expect(moduleSource).toContain("const loadSlipsRequestIdRef = useRef(0)");
    expect(moduleSource).toContain("const requestId = ++loadSlipsRequestIdRef.current");
    expect(moduleSource).toContain("if (requestId !== loadSlipsRequestIdRef.current) return");
  });

  test("removes inert admin month and payroll input-dialog state", () => {
    expect(managerSource).not.toContain("setAttendanceMonth");
    expect(managerSource).not.toContain("time-tracking/admin?month=");
    expect(payrollModalSource).not.toContain("useInputDialog");
    expect(payrollModalSource).not.toContain("inputDialog");
  });

  test("mounts the employee input dialog exactly once", () => {
    const workspaceSource = readSource("src/components/time-tracking/employee/EmployeeWorkspace.tsx");
    const dialogsSource = readSource("src/components/time-tracking/employee/EmployeeDialogs.tsx");

    expect(workspaceSource.match(/^\s*\{inputDialog\}\s*$/gm) ?? []).toHaveLength(0);
    expect(dialogsSource.match(/^\s*\{inputDialog\}\s*$/gm)).toHaveLength(1);
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
    expect(moduleSource).toContain('filter === "pending" ? "งานค้าง" : "ทั้งหมด"');
    expect(moduleSource).toContain("missing_payroll_months");
    expect(moduleSource).toContain("ขาดสลิป");
    expect(moduleSource).toContain("usePayrollCutoffRefresh");
    expect(managerSource).toContain("const refreshPayrollBoundary = useCallback");
    expect(managerSource).toContain("load(false),\n      queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] })");
    expect(managerSource).toContain("usePayrollCutoffRefresh(\n    refreshPayrollBoundary,");
    expect(managerSource).toContain("load={refreshPayrollBoundary}");
    expect(managerSource).toContain("await refreshPayrollBoundary();\n      return true;");
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

  test("lists missing payroll months and defaults creation to the oldest month", () => {
    expect(payrollModalSource).toContain("missingPayrollMonths[0]");
    expect(payrollModalSource).toContain("เดือนที่ยังไม่มีสลิป");
    expect(payrollModalSource).toContain("missingPayrollMonths.map(monthLabel)");
  });

  test("labels cancelled payroll slips and exposes no live actions for them", () => {
    expect(payrollModalSource).toContain("const cancelled = Boolean(slip.cancelled_at);");
    expect(payrollModalSource).toContain("{cancelled ? 'ยกเลิก' : slip.status}");
    expect(payrollModalSource).toContain("!cancelled && canDecide && slip.status === 'PENDING'");
    expect(payrollModalSource).toContain("!cancelled && slip.status === 'APPROVED'");
    expect(employeeSlipListSource).toContain("slip.cancelled_at ? 'ยกเลิก' : slip.status");
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
    for (const source of [expenseLocationChangeSource]) {
      expect(source).toContain("<ModalShell");
      expect(source).toContain("nativeModal");
      expect(source).toContain("closeOnEscape");
      expect(source).toContain("closeDisabled={saving}");
      expect(source).toContain('role="alert"');
      expect(source).not.toContain("CENTRAL_OUTSIDE");
      expect(source).not.toContain('mode?: "change" | "approve" | "create"');
    }
    expect(slipPreviewSource).toContain("nativeModal");
    expect(slipPreviewSource).toContain("closeOnEscape");
    expect(slipPreviewSource).toContain("closeDisabled={pdfShare.busy}");
    expect(modalShellSource).toContain("dialog.showModal()");
    expect(modalShellSource).toContain("event.stopPropagation()");
    expect(modalShellSource).toContain("const previousFocus = returnFocusElement ?? previousFocusRef.current");
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

      if (body.action === "PREVIEW_PAYROLL_SLIP") {
        await route.fulfill({ json: { preview: { netPay: 15000 } } });
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
    const paymentDialog = page.getByRole("dialog", { name: "เลือกวิธีจ่าย", exact: true });
    await paymentDialog.getByText("จ่ายนอกระบบ", { exact: true }).click();
    await paymentDialog.getByRole("button", { name: "สร้างและอนุมัติ" }).click();

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
    await page.getByLabel("กรองสาขา").selectOption("all");
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

  test("keeps rejected debt and withdrawal history visible to payroll managers", async ({ page }) => {
    const employee = {
      id: "0aa15628-b940-4928-b02c-2d7018964f7b",
      name: "พนักงานประวัติรายการปฏิเสธ",
      daily_wage: 500,
      primary_location_id: null,
      debt_remaining_amount: 0,
    };
    const rejectedTransaction = {
      id: "a63d15c2-d70c-46dd-95de-0917bff827d5",
      profile_id: employee.id,
      type: "DEBT",
      amount: 100,
      remaining_amount: 0,
      effective_date: "2026-09-02",
      created_at: "2026-09-02T03:00:00.000Z",
      status: "REJECTED",
      description: "ประวัติหนี้ที่ถูกปฏิเสธ",
      report_lock_no: null,
    };

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        json: {
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [employee],
          pendingTransactions: [],
          pendingSlips: [],
          paymentLocations: [],
          admins: [],
        },
      });
    });
    await page.route("**/api/lanflow/time-tracking/user?*", (route) => route.fulfill({
      json: {
        transactions: [rejectedTransaction],
        wageInfo: { remainingBalance: 0, totalDays: 0, totalDebt: 0 },
        attendance: null,
        periodState: null,
      },
    }));

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await page.getByLabel("กรองสาขา").selectOption("all");
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: /^จัดการปฏิทินวันทำงานของ พนักงานประวัติรายการปฏิเสธ/ }).click();
    const employeeDialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });

    await expect(employeeDialog.getByText("ประวัติหนี้ที่ถูกปฏิเสธ", { exact: true })).toBeVisible();
    await expect(employeeDialog.getByText("REJECTED", { exact: true })).toBeVisible();
  });

  test("labels rejection correctly and recovers after a network failure", async ({ page }) => {
    const employee = {
      id: "e85ab5ad-019c-474b-93cf-2c88a01cd2e5",
      name: "พนักงานปฏิเสธรายการ",
      daily_wage: 500,
      primary_location_id: null,
      debt_remaining_amount: 100,
    };
    const transaction = {
      id: "739b559c-9783-4813-9cbd-2f8c45456069",
      profile_id: employee.id,
      type: "DEBT",
      amount: 100,
      remaining_amount: 100,
      effective_date: "2026-09-02",
      created_at: "2026-09-02T03:00:00.000Z",
      status: "PENDING",
      description: "หนี้สำหรับทดสอบปฏิเสธ",
      report_lock_no: null,
    };

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            permissions: { canManage: true, canDecide: true, canConfigure: true },
            users: [employee],
            pendingTransactions: [transaction],
            pendingSlips: [],
            paymentLocations: [],
            admins: [],
          },
        });
        return;
      }
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "APPROVE_TRANSACTION") {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.route("**/api/lanflow/time-tracking/user?*", (route) => route.fulfill({
      json: {
        transactions: [transaction],
        wageInfo: { remainingBalance: 0, totalDays: 0, totalDebt: 100 },
        attendance: null,
        periodState: null,
      },
    }));

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await page.getByLabel("กรองสาขา").selectOption("all");
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: /^จัดการปฏิทินวันทำงานของ พนักงานปฏิเสธรายการ/ }).click();
    const employeeDialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });
    await employeeDialog.getByRole("button", { name: "ปฏิเสธ" }).click();
    const rejectionDialog = page.getByRole("dialog", { name: "ปฏิเสธรายการ" });
    await rejectionDialog.getByLabel("เหตุผลการปฏิเสธ").fill("ข้อมูลไม่ครบ");
    const failureAlert = page.waitForEvent("dialog");
    const submit = rejectionDialog.getByRole("button", { name: "ยืนยัน" }).click();
    const alert = await failureAlert;
    expect(alert.message()).toBe("ไม่สามารถบันทึกการปฏิเสธได้");
    await alert.accept();
    await submit;
    await expect(employeeDialog.getByText("PENDING", { exact: true })).toBeVisible();
    await expect(employeeDialog.getByRole("button", { name: "ปฏิเสธ" })).toBeEnabled();
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
    const slip = {
      id: "45874010-28e4-4ed6-828d-1584a150170a",
      month: "2026-08-01",
      gross_pay: 15000,
      total_deductions: 0,
      net_pay: 15000,
      status: "APPROVED",
      created_at: "2026-09-02T03:00:00.000Z",
      cancelled_at: null,
      expense_location_id: "695e95b8-f4a7-4a0a-909f-f2f932c3ef8b",
      expense_location_name: "สาขาจ่ายเงิน",
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
        await route.continue();
        return;
      }

      const body = route.request().postDataJSON() as {
        action?: string;
        payload?: {
          payment?: {
            channel?: string;
            expenseLocationId?: string | null;
            transferAmount?: string | null;
            expectedSourceAmount?: number;
          };
        };
      };
      if (body.action === "LIST_PAYROLL_SLIPS") {
        listReads += 1;
        await route.fulfill({
          json: {
            slips: [{
              ...slip,
              expense_location_id: changed ? null : slip.expense_location_id,
              expense_location_name: changed ? null : slip.expense_location_name,
            }],
          },
        });
        return;
      }
      if (body.action === "CHANGE_PAYMENT_ALLOCATION") {
        expect(body.payload?.payment).toEqual({
          channel: "outside_system",
          expenseLocationId: null,
          transferAmount: null,
          expectedSourceAmount: 15000,
        });
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
    await page.getByRole("button", { name: /^จัดการสลิปเงินเดือนของ / }).first().click();
    const payrollDialog = page.getByRole("dialog", { name: /^สลิปเงินเดือนของ / });
    const readsBeforeChange = listReads;
    await payrollDialog.getByRole("button", { name: "เปลี่ยนวิธีจ่าย" }).click();
    const changeDialog = page.getByRole("dialog", { name: "เปลี่ยนวิธีจ่าย" });
    await changeDialog.getByText("จ่ายนอกระบบ", { exact: true }).click();
    await changeDialog.getByRole("button", { name: "บันทึก", exact: true }).click();
    await adminRefreshRequested;

    try {
      await expect(payrollDialog.getByText("จ่ายนอกระบบ", { exact: true })).toBeVisible({ timeout: 1_000 });
      expect(listReads).toBe(readsBeforeChange + 1);
    } finally {
      releaseAdminRefresh();
    }
  });

  test("keeps a newly selected attendance month read-only until its server snapshot arrives", async ({ page }) => {
    const employee = {
      id: "42b44f45-d44a-4efe-b987-0ab872b591b1",
      name: "พนักงานเปลี่ยนเดือนช้า",
      daily_wage: 500,
      primary_location_id: null,
      debt_remaining_amount: 0,
      is_active: true,
      period_state: {
        currentStatus: "ACTIVE",
        currentPeriod: null,
        nextAction: null,
        hasPeriodHistory: true,
        resumeEarliestOn: null,
        periodStartCorrection: null,
      },
    };
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const currentMonth = today.slice(0, 7);
    const [year, month] = currentMonth.split("-").map(Number);
    const previous = new Date(Date.UTC(year, month - 2, 1));
    const previousMonth = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
    const previousDay = `${previousMonth}-01`;
    let releasePreviousMonth!: () => void;
    let markPreviousMonthRequested!: () => void;
    const previousMonthReleased = new Promise<void>((resolve) => { releasePreviousMonth = resolve; });
    const previousMonthRequested = new Promise<void>((resolve) => { markPreviousMonthRequested = resolve; });

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fulfill({ json: { success: true } });
        return;
      }
      await route.fulfill({
        json: {
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [employee],
          pendingTransactions: [],
          pendingSlips: [],
          paymentLocations: [],
          admins: [],
        },
      });
    });
    await page.route("**/api/lanflow/time-tracking/user?*", async (route) => {
      const requestedMonth = new URL(route.request().url()).searchParams.get("month") ?? currentMonth;
      if (requestedMonth === previousMonth) {
        markPreviousMonthRequested();
        await previousMonthReleased;
      }
      await route.fulfill({
        json: {
          profile: employee,
          transactions: [],
          wageInfo: { remainingBalance: 0, totalDays: 0, totalDebt: 0 },
          periodState: employee.period_state,
          attendance: {
            month: requestedMonth,
            mode: "EXCEPTIONS",
            workdayEndTime: "15:00",
            eligibleThrough: today,
            periods: [{ id: "e9ba5311-8e20-4749-9a13-0af22c7bf977", startOn: previousDay, endOn: null }],
            exceptions: requestedMonth === previousMonth ? [{ date: previousDay, status: "OFF" }] : [],
            summary: { fullDays: 0, halfDays: 0, offDays: 0, paidDays: 0, grossPay: 0 },
          },
        },
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await page.getByLabel("กรองสาขา").selectOption("all");
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: `จัดการปฏิทินวันทำงานของ ${employee.name}` }).click();
    const dialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });
    await expect(dialog.getByRole("button", { name: new RegExp(`^${currentMonth}-01`) })).toBeVisible();
    await dialog.getByRole("button", { name: "เดือนก่อน" }).click();
    await previousMonthRequested;

    try {
      await expect(dialog.getByRole("button", { name: new RegExp(`^${previousDay}`) })).toBeDisabled();
    } finally {
      releasePreviousMonth();
    }
    await expect(dialog.getByRole("button", { name: new RegExp(`^${previousDay}.*หยุด`) })).toBeEnabled();
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

  test("shows combined missing-slip work badges and defaults to the oldest month", async ({ page }) => {
    let missingPayrollMonths = ["2026-07", "2026-08"];
    const employee = {
      id: "86000000-0000-4000-8000-000000000001",
      name: "พนักงานขาดสลิป",
      daily_wage: 500,
      primary_location_id: null,
      debt_remaining_amount: 0,
      missing_payroll_months: missingPayrollMonths,
    };
    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: {
          settings: { workdayEndTime: "16:00" },
          permissions: { canManage: true, canDecide: true, canConfigure: true },
          users: [{ ...employee, missing_payroll_months: missingPayrollMonths }],
          pendingTransactions: [],
          pendingSlips: [{ profile_id: employee.id }],
          paymentLocations: [],
          admins: [],
        } });
        return;
      }
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "LIST_PAYROLL_SLIPS") {
        await route.fulfill({ json: { slips: [] } });
        return;
      }
      if (body.action === "PREVIEW_PAYROLL_SLIP") {
        await route.fulfill({ json: { preview: { netPay: 0 } } });
        return;
      }
      if (body.action === "CREATE_PAYROLL_SLIP") {
        missingPayrollMonths = ["2026-08"];
        await route.fulfill({ json: { slip: { id: "created-slip" } } });
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await page.getByLabel("กรองสาขา").selectOption("all");
    await expect(page.getByText("ขาดสลิป 2 เดือน", { exact: true })).toBeVisible();
    const payrollButton = page.getByRole("button", {
      name: /จัดการสลิปเงินเดือนของ พนักงานขาดสลิป มีงานค้าง 3 รายการ/,
    });
    await expect(payrollButton.locator("span").last()).toHaveText("3");
    await payrollButton.click();

    const payrollDialog = page.getByRole("dialog", { name: "สลิปเงินเดือนของ พนักงานขาดสลิป" });
    await expect(payrollDialog.getByText("เดือนที่ยังไม่มีสลิป", { exact: true })).toBeVisible();
    await expect(payrollDialog.getByText(/กรกฎาคม 2569.*สิงหาคม 2569/)).toBeVisible();
    await payrollDialog.getByRole("button", { name: "สร้างสลิปเงินเดือน", exact: true }).click();
    const createDialog = page.getByRole("dialog", { name: "สร้างสลิปเงินเดือน" });
    await expect(createDialog.getByLabel("เดือน")).toHaveValue("2026-07");
    await createDialog.getByRole("button", { name: "ยืนยันสร้างสลิป" }).click();
    await expect(createDialog).toBeHidden();
    await expect(payrollDialog.getByText("สิงหาคม 2569", { exact: true })).toBeVisible();
    await expect(payrollDialog.getByText("กรกฎาคม 2569", { exact: true })).toBeHidden();
    await payrollDialog.getByRole("button", { name: "สร้างสลิปเงินเดือน", exact: true }).click();
    await expect(createDialog.getByLabel("เดือน")).toHaveValue("2026-08");
  });

  test("keeps branch and status controls usable without page overflow at 360px and 393px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });

    await expect(page.getByLabel("กรองสาขา")).toBeVisible();
    const allButton = page.getByRole("button", { name: "ทั้งหมด", exact: true });
    const pendingButton = page.getByRole("button", { name: /^งานค้าง/ });
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
