import { expect, test, type Page } from "@playwright/test";
import type { HistoryRetentionOverview } from "../src/types/history-retention";

const keys = ["dashboard_money_events", "time_tracking_audit_logs", "admin_account_audit_logs",
  "income_expense_approval_requests", "cash_transfer_delete_requests", "rubber_bill_approval_requests",
  "stock_entry_approval_requests", "stock_product_approval_requests", "scheduler_run_history", "cleanup_run_history"];
function initial(): HistoryRetentionOverview {
  return { currentDays: 15, requestedDays: 15, cutoffDate: "2026-08-20", updatedAt: "2026-09-03T01:00:00Z",
    updatedByName: "manager", totalEligible: 1005,
    groups: keys.map(key => ({ key, eligibleCount: key === "scheduler_run_history" ? 1005 : 0, oldestDate: key === "scheduler_run_history" ? "2026-08-01" : null })), lastCleanup: null };
}
async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "การเก็บประวัติ", exact: true }).click();
  await expect(page.getByLabel("จำนวนวันที่เก็บ")).toHaveValue("15");
}
test.describe("background history retention UI", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("confirms impact, deduplicates, reopens progress and polls metadata only", async ({ page }) => {
    let state = initial();
    let commands = 0;
    let fullReads = 0;
    let statusReads = 0;
    await page.route(/\/api\/lanflow\/admin\/history-retention(?:\?.*)?$/, async route => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { action: string; expectedUpdatedAt: string; cutoffDate: string };
        expect(body.action).toBe("cleanup");
        expect(body.expectedUpdatedAt).toBe(state.updatedAt);
        expect(body.cutoffDate).toBe(state.cutoffDate);
        commands += 1;
        state = { ...state, lastCleanup: { id: "job-1", source: "manual", status: "running", retentionDays: 15,
          cutoffDate: state.cutoffDate, deletedCounts: {}, remainingCounts: { scheduler_run_history: 1005 }, countsAsOf: state.updatedAt,
          batches: 0, hasMore: true, errorMessage: null, startedAt: state.updatedAt, completedAt: null } };
        await route.fulfill({ status: 202, json: { status: "running", runId: "job-1" } });
      } else if (route.request().url().includes("view=status")) {
        statusReads += 1;
        await route.fulfill({ json: { currentDays: state.currentDays, cutoffDate: state.cutoffDate, updatedAt: state.updatedAt, lastCleanup: state.lastCleanup } });
      } else { fullReads += 1; await route.fulfill({ json: state }); }
    });
    await openSettings(page);
    const start = page.getByRole("button", { name: "ล้างประวัติที่หมดอายุตอนนี้", exact: true });
    await start.click();
    const dialog = page.getByRole("alertdialog", { name: "ยืนยันล้างประวัติที่หมดอายุ?", exact: true });
    await expect(dialog).toContainText("1,005");
    await expect(dialog).toContainText("ไม่ลบข้อมูลธุรกิจหรือยอดสะสม");
    await expect(dialog.getByRole("button", { name: "ยกเลิก", exact: true })).toBeFocused();
    await page.screenshot({ path: "output/history-retention-background/confirmation-desktop.png", fullPage: true });
    await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    expect(commands).toBe(0);
    await start.click();
    await dialog.getByRole("button", { name: "ยืนยันเริ่มล้าง", exact: true }).click();
    await expect(start).toBeDisabled();
    expect(commands).toBe(1);
    const readsBeforePoll = fullReads;
    await expect.poll(() => statusReads, { timeout: 10000 }).toBeGreaterThan(0);
    expect(fullReads).toBe(readsBeforePoll);
    await page.getByRole("button", { name: "พนักงาน", exact: true }).click();
    await page.getByRole("button", { name: "การเก็บประวัติ", exact: true }).click();
    await expect(start).toBeDisabled();
    await expect(page.getByText("รับงานแล้ว — รอรอบล้าง", { exact: true })).toBeVisible();
    expect(commands).toBe(1);
    state.lastCleanup = { ...state.lastCleanup!, status: "succeeded", deletedCounts: { scheduler_run_history: 1005 },
      remainingCounts: { scheduler_run_history: 0 }, batches: 2, hasMore: false, completedAt: "2026-09-03T01:02:00Z" };
    state.totalEligible = 0;
    state.groups = state.groups.map(group => ({ ...group, eligibleCount: 0, oldestDate: null }));
    await expect(start).toBeEnabled({ timeout: 10000 });
    await expect(page.getByText("ลบแล้ว 1,005 รายการ · 2 ชุด", { exact: true })).toBeVisible();
  });

  test("keeps unsaved days, requires preview and handles a stale confirmation on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let state = initial();
    let commands = 0;
    await page.route(/\/api\/lanflow\/admin\/history-retention(?:\?.*)?$/, async route => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { action: string; retentionDays?: number };
        if (body.action === "preview") await route.fulfill({ json: { ...state, requestedDays: body.retentionDays } });
        else { commands += 1; state = { ...state, updatedAt: "2026-09-03T02:00:00Z" }; await route.fulfill({ status: 409, json: { error: "การตั้งค่าถูกเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด" } }); }
      } else await route.fulfill({ json: state });
    });
    await openSettings(page);
    const days = page.getByLabel("จำนวนวันที่เก็บ");
    await days.fill("30");
    await expect(page.getByRole("button", { name: "ล้างประวัติที่หมดอายุตอนนี้" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "บันทึกค่า", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "ตรวจข้อมูลล่าสุด", exact: true }).click();
    await expect(days).toHaveValue("30");
    await page.getByRole("button", { name: "ตรวจผลกระทบ", exact: true }).click();
    await page.getByRole("button", { name: "บันทึกค่า", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "ยืนยันเปลี่ยนระยะเก็บประวัติ?", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "ยืนยันเปลี่ยนค่า", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "โหลดข้อมูลล่าสุด" })).toBeVisible();
    expect(commands).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: "output/history-retention-background/settings-mobile.png", fullPage: true });
  });

  test("status polling recovers if a policy-change overview refresh fails once", async ({ page }) => {
    const original = initial();
    const changed = { ...original, currentDays: 30, requestedDays: 30, cutoffDate: "2026-08-05", updatedAt: "2026-09-03T02:00:00Z" };
    let fullReads = 0;
    let statusReads = 0;
    let failRefresh = true;
    await page.route(/\/api\/lanflow\/admin\/history-retention(?:\?.*)?$/, async route => {
      if (route.request().url().includes("view=status")) {
        statusReads += 1;
        await route.fulfill({ json: { currentDays: changed.currentDays, cutoffDate: changed.cutoffDate, updatedAt: changed.updatedAt, lastCleanup: null } });
      } else {
        fullReads += 1;
        if (statusReads > 0 && failRefresh) {
          failRefresh = false;
          await route.fulfill({ status: 503, json: { error: "โหลดผลกระทบชั่วคราวไม่สำเร็จ" } });
        } else await route.fulfill({ json: statusReads === 0 ? original : changed });
      }
    });
    await openSettings(page);
    await expect(page.getByLabel("จำนวนวันที่เก็บ")).toHaveValue("30", { timeout: 15000 });
    expect(statusReads).toBeGreaterThanOrEqual(2);
    expect(fullReads).toBeGreaterThanOrEqual(3);
  });

  for (const status of [401, 403]) {
    test(`permission loss (${status}) closes a pending cleanup confirmation`, async ({ page }) => {
      let commands = 0;
      await page.route(/\/api\/lanflow\/admin\/history-retention(?:\?.*)?$/, async route => {
        if (route.request().method() === "POST") {
          commands += 1;
          await route.fulfill({ status, json: { error: "Access revoked" } });
        } else await route.fulfill({ json: initial() });
      });
      await openSettings(page);
      await page.getByRole("button", { name: "ล้างประวัติที่หมดอายุตอนนี้", exact: true }).click();
      await page.getByRole("button", { name: "ยืนยันเริ่มล้าง", exact: true }).click();
      await expect(page.getByRole("alertdialog")).not.toBeVisible();
      await expect(page.getByLabel("จำนวนวันที่เก็บ")).not.toBeVisible();
      await expect(page.getByText("Access revoked", { exact: true })).toBeVisible();
      expect(commands).toBe(1);
    });
  }

  test("a forbidden full refresh clears the previously loaded impact data", async ({ page }) => {
    let forbidden = false;
    await page.route(/\/api\/lanflow\/admin\/history-retention(?:\?.*)?$/, async route => {
      await route.fulfill(forbidden
        ? { status: 403, json: { error: "Access revoked" } }
        : { json: initial() });
    });
    await openSettings(page);
    forbidden = true;
    await page.getByRole("button", { name: "ตรวจข้อมูลล่าสุด", exact: true }).click();
    await expect(page.getByLabel("จำนวนวันที่เก็บ")).not.toBeVisible();
    await expect(page.getByText("Access revoked", { exact: true })).toBeVisible();
    forbidden = false;
    await page.getByRole("button", { name: "ลองใหม่", exact: true }).click();
    await expect(page.getByLabel("จำนวนวันที่เก็บ")).toHaveValue("15");
    await expect(page.getByRole("alert").filter({ hasText: "Access revoked" })).not.toBeVisible();
  });

  test("HTTP 409 refreshes a stale confirmation independently of message wording", async ({ page }) => {
    let state = initial();
    await page.route(/\/api\/lanflow\/admin\/history-retention(?:\?.*)?$/, async route => {
      if (route.request().method() === "POST") {
        state = { ...state, currentDays: 30, requestedDays: 30, updatedAt: "2026-09-03T02:00:00Z" };
        await route.fulfill({ status: 409, json: { error: "Settings changed; refresh required" } });
      } else await route.fulfill({ json: state });
    });
    await openSettings(page);
    await page.getByRole("button", { name: "ล้างประวัติที่หมดอายุตอนนี้", exact: true }).click();
    await page.getByRole("button", { name: "ยืนยันเริ่มล้าง", exact: true }).click();
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    await expect(page.getByLabel("จำนวนวันที่เก็บ")).toHaveValue("30");
  });

  test("a truncated successful JSON response does not replace usable overview state", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    let truncated = false;
    await page.route(/\/api\/lanflow\/admin\/history-retention(?:\?.*)?$/, async route => {
      await route.fulfill(truncated
        ? { status: 200, contentType: "application/json", body: '{"currentDays":' }
        : { json: initial() });
    });
    await openSettings(page);
    pageErrors.length = 0;
    truncated = true;
    await page.getByRole("button", { name: "ตรวจข้อมูลล่าสุด", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /JSON|Unexpected|Expected/ })).toBeVisible();
    await expect(page.getByLabel("จำนวนวันที่เก็บ")).toHaveValue("15");
    expect(pageErrors).toEqual([]);
  });

  test("a retryable server error does not discard the cleanup request UUID", async ({ page }) => {
    const requestIds: string[] = [];
    await page.route(/\/api\/lanflow\/admin\/history-retention(?:\?.*)?$/, async route => {
      if (route.request().method() === "POST") {
        requestIds.push(route.request().postDataJSON().requestId);
        await route.fulfill({ status: 503, json: { error: "โหลดข้อมูลล่าสุดไม่สำเร็จชั่วคราว" } });
      } else await route.fulfill({ json: initial() });
    });
    await openSettings(page);
    await page.getByRole("button", { name: "ล้างประวัติที่หมดอายุตอนนี้", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    const confirm = dialog.getByRole("button", { name: "ยืนยันเริ่มล้าง", exact: true });
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText("โหลดข้อมูลล่าสุดไม่สำเร็จชั่วคราว");
    await confirm.click();
    await expect.poll(() => requestIds.length).toBe(2);
    expect(requestIds[1]).toBe(requestIds[0]);
  });
});
