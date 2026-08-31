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
    expect(controls).toContain("if (actionError) setError(actionError)");
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
    expect(controls).toContain('if (status === "INACTIVE") return "ไม่ได้เปิดเงินเดือน"');
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
    expect(moduleSource).toContain("const activePeriod = user.active_period as { id: string; startOn: string; endOn: string | null }");
    expect(moduleSource).toContain("const status = activePeriod ? 'ACTIVE_PERIOD' : 'INACTIVE_PERIOD'");
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
    expect(modalShellSource).toContain("previousFocus?.focus()");
  });
});

test.describe("Time/payroll native dialogs", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("closes the employee calendar dialog with Escape and restores its trigger", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("ตัวกรอง").selectOption("all");
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

    await page.getByLabel("ตัวกรอง").selectOption("all");
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
});
