import { expect, test, type Page } from "@playwright/test";

const employeeId = "7ef10000-0000-4000-8000-000000000021";
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(new Date());

async function workspace(page: Page) {
  let adminReads = 0, badgeReads = 0, saves = 0;
  let value = 500;
  let badgeCount = 1;
  let failBadge = false;
  let failSave = false;
  let failRead = false;
  let slipDeleted = false;
  let hold: Promise<void> = Promise.resolve();
  const revision = "a".repeat(32);
  await page.route("**/api/lanflow/rubber-weight-alert", route => route.fulfill({ json: { config: {}, candidates: [] } }));
  await page.route("**/rest/v1/rpc/get_actionable_badge_counts", route => {
    badgeReads++;
    return failBadge ? route.fulfill({ status: 503, json: { message: "unavailable" } })
      : route.fulfill({ json: [{ location_id: "branch", module_id: "time-tracking", item_count: badgeCount }] });
  });
  await page.route("**/api/lanflow/time-tracking/admin", async route => {
    if (route.request().method() === "GET") {
      adminReads++;
      return route.fulfill({ json: { users: [{ id: employeeId, name: "Refresh Employee", daily_wage: 500,
        debt_remaining_amount: value, missing_payroll_months: [], period_state: { currentStatus: "ACTIVE" } }],
      pendingTransactions: [], pendingSlips: [], settings: { workdayEndTime: "16:00" },
      permissions: { canManage: true, canConfigure: true, canDecide: true }, paymentLocations: [] } });
    }
    const body = route.request().postDataJSON();
    if (body.action === "LIST_PAYROLL_SLIPS") return route.fulfill({ json: { slips: slipDeleted ? [] : [{
      id: "7ef30000-0000-4000-8000-000000000021", month, gross_pay: 500, total_deductions: 500, net_pay: 0,
      status: "APPROVED", created_at: "2026-11-01T00:00:00Z", cancelled_at: null,
    }] } });
    if (body.action === "DELETE_PAYROLL_SLIP") {
      saves++;
      await hold;
      slipDeleted = true;
      return route.fulfill({ json: { success: true } });
    }
    if (["CREATE_DEBT", "REPLACE_ATTENDANCE_EXCEPTIONS", "UPDATE_TIME_PAYROLL_CONFIG"].includes(body.action)) {
      saves++;
      await hold;
      if (failSave) return route.fulfill({ status: 409, json: { error: "ข้อมูลเปลี่ยน กรุณาโหลดใหม่", code: "ATTENDANCE_STALE" } });
      value = 700;
      badgeCount = 2;
      return route.fulfill({ json: { success: true } });
    }
    return route.continue();
  });
  await page.route("**/api/lanflow/time-tracking/user?**", async route => {
    if (failRead) return route.fulfill({ status: 503, json: { error: "unavailable" } });
    return route.fulfill({ json: { wageInfo: { remainingBalance: value, totalDays: 20, totalDebt: value },
      transactions: [], deductions: [], slips: [], attendance: { month, revision, mode: "EXCEPTIONS", workdayEndTime: "16:00",
        eligibleThrough: `${month}-28`, periods: [{ id: "period", startOn: `${month}-01`, endOn: null }], exceptions: [],
        summary: { fullDays: 31, halfDays: 0, offDays: 0, paidDays: 31, grossPay: 15500 } } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
  await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
  await page.getByRole("button", { name: "จัดการปฏิทินวันทำงานของ Refresh Employee" }).click();
  const dialog = page.getByRole("dialog", { name: "ข้อมูลของพนักงาน" });
  await expect(dialog.getByText("ประวัติสร้างหนี้สิน/เบิกเงิน")).toBeVisible();
  return { dialog, stats: () => ({ adminReads, badgeReads, saves }), setReadFailure: () => { failRead = true; },
    setConflict: () => { failSave = true; }, externalChange: () => { value = 900; },
    setBadgeFailure: () => { failBadge = true; },
    delay: () => { let release!: () => void; hold = new Promise<void>(resolve => { release = resolve; }); return release; } };
}

test("a saved debt refreshes the directory and badges once without reloading the page", async ({ page }) => {
  const w = await workspace(page);
  const before = w.stats();
  await expect(page.getByLabel("จำนวนงาน")).toHaveText("1");
  await w.dialog.getByRole("button", { name: "สร้างหนี้สินเพิ่ม" }).click();
  const debt = page.getByRole("dialog", { name: "สร้างหนี้สิน", exact: true });
  await debt.getByLabel("รายละเอียด").fill("Regression debt");
  await debt.getByLabel("ยอดเงิน (บาท)").fill("200");
  const release = w.delay();
  const save = debt.getByRole("button", { name: "บันทึก", exact: true });
  await save.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(debt.getByRole("button", { name: /^(บันทึก|กำลังบันทึก\.\.\.)$/ })).toBeDisabled();
  await expect.poll(() => w.stats().saves).toBe(1);
  release();
  await expect(debt).toBeHidden();
  await expect.poll(() => w.stats().adminReads).toBeGreaterThan(before.adminReads);
  await expect.poll(() => w.stats().badgeReads).toBeGreaterThan(before.badgeReads);
  await expect(page.getByLabel("จำนวนงาน")).toHaveText("2");
  await w.dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Refresh Employee" })).toContainText("700");
});

test("calendar conflict is shown without a second write", async ({ page }) => {
  const w = await workspace(page);
  w.setConflict();
  await w.dialog.getByRole("button", { name: new RegExp(`^${month}-01 `) }).click();
  const save = w.dialog.getByRole("button", { name: "บันทึกปฏิทิน", exact: true });
  const release = w.delay();
  await save.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(w.dialog.getByRole("button", { name: "กำลังบันทึก...", exact: true })).toBeDisabled();
  await expect.poll(() => w.stats().saves).toBe(1);
  release();
  await expect(w.dialog.getByRole("alert")).toContainText("ข้อมูลเปลี่ยน กรุณาโหลดใหม่");
});

test("calendar keeps its month fixed while a save is in flight", async ({ page }) => {
  const w = await workspace(page);
  await w.dialog.getByRole("button", { name: new RegExp(`^${month}-01 `) }).click();
  const release = w.delay();
  await w.dialog.getByRole("button", { name: "บันทึกปฏิทิน", exact: true }).click();
  await expect.poll(() => w.stats().saves).toBe(1);
  try {
    await expect(w.dialog.getByRole("button", { name: "เดือนก่อน", exact: true })).toBeDisabled();
    await expect(w.dialog.getByRole("button", { name: "เดือนถัดไป", exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(w.dialog.getByRole("button", { name: "เดือนก่อน", exact: true })).toBeEnabled();
});

test("background read failure keeps the open view and offers read-only retry", async ({ page }) => {
  await page.clock.install();
  const w = await workspace(page);
  w.setReadFailure();
  await page.clock.runFor(60_001);
  await expect(w.dialog.getByText("ประวัติสร้างหนี้สิน/เบิกเงิน")).toBeVisible();
  await expect(w.dialog.getByRole("alert")).toContainText("โหลดข้อมูลล่าสุดไม่ได้");
  expect(w.stats().saves).toBe(0);
});


test("the shared minute refresh updates money even when badge count is unchanged", async ({ page }) => {
  await page.clock.install();
  const w = await workspace(page);
  const before = w.stats();
  w.externalChange();
  await page.clock.runFor(60_001);
  await expect.poll(() => w.stats().adminReads).toBeGreaterThan(before.adminReads);
  await expect(w.dialog.getByText("฿900", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("จำนวนงาน")).toHaveText("1");
  expect(w.stats().saves).toBe(0);
});

test("Enter twice submits payroll settings only once and unlocks after completion", async ({ page }) => {
  const w = await workspace(page);
  await w.dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await page.getByRole("button", { name: "ตั้งค่าเวลาสิ้นสุดวันทำงาน" }).click();
  const config = page.getByRole("dialog", { name: "ตั้งค่าเวลาสิ้นสุดวันทำงาน" });
  const release = w.delay();
  await config.getByLabel("เวลาใหม่").fill("17:00");
  await config.locator("form").evaluate(form => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(config.getByRole("button", { name: "กำลังบันทึก...", exact: true })).toBeDisabled();
  await expect.poll(() => w.stats().saves).toBe(1);
  release();
  await expect(config).toBeHidden();
});

test("hidden tabs pause the minute refresh and returning refreshes immediately", async ({ page }) => {
  await page.clock.install();
  const w = await workspace(page);
  const before = w.stats().adminReads;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });
  w.externalChange();
  await page.clock.runFor(120_001);
  expect(w.stats().adminReads).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });
  await page.clock.runFor(1);
  await expect.poll(() => w.stats().adminReads).toBeGreaterThan(before);
  await expect(w.dialog.getByText("฿900", { exact: true })).toHaveCount(2);
});

test("a committed debt remains committed when the subsequent employee read fails", async ({ page }) => {
  const w = await workspace(page);
  await w.dialog.getByRole("button", { name: "สร้างหนี้สินเพิ่ม" }).click();
  const debt = page.getByRole("dialog", { name: "สร้างหนี้สิน", exact: true });
  await debt.getByLabel("รายละเอียด").fill("Saved before read failure");
  await debt.getByLabel("ยอดเงิน (บาท)").fill("200");
  w.setReadFailure();
  await debt.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(debt).toBeHidden();
  await expect(w.dialog.getByRole("alert")).toContainText("โหลดข้อมูลล่าสุดไม่ได้");
  expect(w.stats().saves).toBe(1);
  await w.dialog.getByRole("button", { name: "ลองโหลดใหม่", exact: true }).click();
  expect(w.stats().saves).toBe(1);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: "output/payroll-ui-mobile-error.png", fullPage: true });
});

test("offline pauses the shared refresh and reconnect loads the latest data", async ({ page }) => {
  await page.clock.install();
  const w = await workspace(page);
  const before = w.stats().adminReads;
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
  });
  w.externalChange();
  await page.clock.runFor(60_001);
  expect(w.stats().adminReads).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.runFor(1);
  await expect.poll(() => w.stats().adminReads).toBeGreaterThan(before);
  await expect(w.dialog.getByText("฿900", { exact: true })).toHaveCount(2);
});

test("deleting a slip uses a disabled confirmation until the one request completes", async ({ page }) => {
  const w = await workspace(page);
  await w.dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await page.getByRole("button", { name: "จัดการสลิปเงินเดือนของ Refresh Employee" }).click();
  const payroll = page.getByRole("dialog", { name: "สลิปเงินเดือนของ Refresh Employee" });
  await payroll.getByRole("button", { name: "ลบสลิป", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "ลบสลิปเงินเดือน" });
  const release = w.delay();
  const confirm = confirmation.getByRole("button", { name: "ยืนยันลบ", exact: true });
  await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(confirm).toBeDisabled();
  await expect.poll(() => w.stats().saves).toBe(1);
  release();
  await expect(confirmation).toBeHidden();
  await expect(payroll.getByText("ไม่มีประวัติการทำสลิปเงินเดือน")).toBeVisible();
});

test("failed badge reads show unavailability instead of a misleading zero", async ({ page }) => {
  await page.clock.install();
  const w = await workspace(page);
  await expect(page.getByLabel("จำนวนงาน")).toHaveText("1");
  w.setBadgeFailure();
  await page.clock.runFor(60_001);
  await page.clock.runFor(5000);
  await expect(page.getByLabel("จำนวนงาน")).toHaveText("โหลดจำนวนงานล่าสุดไม่ได้");
});
