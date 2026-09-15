import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const migrationPath = "supabase/migrations/20260915010000_time_payroll_wage_recalculation.sql";

test("wage recalculation keeps one planner, ordered locks, stale protection, and legacy RPC compatibility", async () => {
  const [sql, moduleSource, dialog] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile("src/components/TimeTrackingModule.tsx", "utf8"),
    readFile("src/components/time-tracking/WageRecalculationDialog.tsx", "utf8"),
  ]);

  expect(sql).toContain("private.plan_time_tracking_deductions(");
  expect(sql).toContain("private.apply_time_tracking_deductions(");
  expect(sql).toContain("private.plan_time_tracking_deductions(\n    p_profile_id,");
  expect(sql.indexOf("time-payroll-attendance:")).toBeLessThan(sql.indexOf("time-tracking:", sql.indexOf("create or replace function public.commit_time_tracking_wage_recalculation")));
  expect(sql).toContain("raise exception 'WAGE_PREVIEW_STALE'");
  expect(sql).toContain("ps.status in ('PENDING', 'APPROVED')");
  expect(sql).toContain("create or replace function public.update_time_tracking_wage(");
  expect(sql).toContain("raise exception 'DEDUCTION_WAGE_LOCKED'");
  expect(sql).toContain("'RECALCULATE_WAGE_DEDUCTIONS'");
  expect(moduleSource).toContain("WageRecalculationDialog");
  expect(moduleSource).toContain('json?.code === "WAGE_PREVIEW_STALE"');
  expect(dialog).toContain("<AlertDialog");
  expect(dialog).toContain('role="alert"');
  expect(dialog).toContain("text-pretty");
  expect(dialog).not.toContain("gradient");
  expect(dialog).not.toContain("animate-");
});

test.describe("wage recalculation UI", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/lanflow/rubber-weight-alert", (route) => route.fulfill({
      json: {
        config: { thresholdKg: 10_000, intervalMinutes: 60 },
        candidates: [],
      },
    }));
  });

  test("previews monthly totals before committing a wage increase", async ({ page }) => {
    let previewRequested = false;
    let commitRequested = false;
    let releasePreview: (() => void) | undefined;
    const holdPreview = new Promise<void>((resolve) => { releasePreview = resolve; });
    const digest = "a".repeat(64);

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "PREVIEW_WAGE_RECALCULATION") {
        previewRequested = true;
        await holdPreview;
        return route.fulfill({ json: { preview: {
          profileId: "00000000-0000-4000-8000-000000000001",
          oldWage: 500,
          newWage: 600,
          throughMonth: "2026-09",
          noOp: false,
          digest,
          months: [{ month: "2026-09", closed: false, slipStatus: null, paidDays: 15, grossPay: 9000, oldDeduction: 7500, newDeduction: 9000, delta: 1500, restoredAmount: 0, additionalDeduction: 1500 }],
          totals: { oldDeduction: 7500, newDeduction: 9000, delta: 1500, restoredAmount: 0, additionalDeduction: 1500 },
        } } });
      }
      if (body.action === "COMMIT_WAGE_RECALCULATION") {
        commitRequested = true;
        return route.fulfill({ json: { success: true, result: { committed: true } } });
      }
      return route.continue();
    });

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    const editWageButton = page.getByRole("button", { name: /^แก้ไขค่าแรงรายวันของ / }).first();
    await editWageButton.click();
    const inputDialog = page.getByRole("dialog", { name: "แก้ไขค่าแรงรายวัน" });
    await inputDialog.getByLabel("ค่าแรงรายวัน (บาท)").fill("600");
    await inputDialog.getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await expect.poll(async () => page
      .getByRole("button", { name: /^แก้ไขค่าแรงรายวันของ / })
      .evaluateAll((buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled)))
      .toBe(true);
    releasePreview?.();

    const previewDialog = page.getByRole("alertdialog", { name: /^ตรวจยอดก่อนแก้ค่าแรงของ / });
    await expect(previewDialog).toBeVisible();
    await expect(previewDialog.getByText("หักเพิ่ม", { exact: false })).toBeVisible();
    await expect(previewDialog.getByRole("region", { name: "ยอดหักก่อนและหลังรายเดือน" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(previewDialog).toBeHidden();
    await expect(editWageButton).toBeFocused();

    await editWageButton.click();
    await inputDialog.getByLabel("ค่าแรงรายวัน (บาท)").fill("600");
    await inputDialog.getByRole("button", { name: "ยืนยัน", exact: true }).click();
    await expect(previewDialog).toBeVisible();
    await previewDialog.getByRole("button", { name: "ยืนยันแก้ค่าแรง" }).click();
    await expect(page.getByText("แก้ค่าแรงและคำนวณยอดหักใหม่แล้ว")).toBeVisible();
    expect(previewRequested).toBe(true);
    expect(commitRequested).toBe(true);
  });

  test("stops an unchanged wage before the confirmation step", async ({ page }) => {
    let commitRequested = false;
    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "PREVIEW_WAGE_RECALCULATION") {
        return route.fulfill({ json: { preview: {
          profileId: "00000000-0000-4000-8000-000000000001",
          oldWage: 500,
          newWage: 500,
          throughMonth: "2026-09",
          noOp: true,
          digest: "d".repeat(64),
          months: [],
          totals: { oldDeduction: 0, newDeduction: 0, delta: 0, restoredAmount: 0, additionalDeduction: 0 },
        } } });
      }
      if (body.action === "COMMIT_WAGE_RECALCULATION") commitRequested = true;
      return route.continue();
    });

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: /^แก้ไขค่าแรงรายวันของ / }).first().click();
    const inputDialog = page.getByRole("dialog", { name: "แก้ไขค่าแรงรายวัน" });
    await inputDialog.getByLabel("ค่าแรงรายวัน (บาท)").fill("500");
    await inputDialog.getByRole("button", { name: "ยืนยัน", exact: true }).click();

    await expect(page.getByText("ค่าแรงเท่าเดิม ไม่มีข้อมูลที่ต้องเปลี่ยน")).toBeVisible();
    await expect(page.getByRole("alertdialog", { name: /^ตรวจยอดก่อนแก้ค่าแรงของ / })).toHaveCount(0);
    expect(commitRequested).toBe(false);
  });

  test("warns for zero wage and refreshes a stale preview in place", async ({ page }) => {
    let previewReads = 0;
    let commitWrites = 0;
    const digest = "b".repeat(64);

    await page.setViewportSize({ width: 360, height: 800 });

    await page.route("**/api/lanflow/time-tracking/admin", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "PREVIEW_WAGE_RECALCULATION") {
        previewReads += 1;
        const oldDeduction = previewReads === 1 ? 7500 : 7000;
        return route.fulfill({ json: { preview: {
          profileId: "00000000-0000-4000-8000-000000000001",
          oldWage: 500,
          newWage: 0,
          throughMonth: "2026-09",
          noOp: false,
          digest: previewReads === 1 ? digest : "c".repeat(64),
          months: [{ month: "2026-09", closed: false, slipStatus: null, paidDays: 15, grossPay: 0, oldDeduction, newDeduction: 0, delta: -oldDeduction, restoredAmount: oldDeduction, additionalDeduction: 0 }],
          totals: { oldDeduction, newDeduction: 0, delta: -oldDeduction, restoredAmount: oldDeduction, additionalDeduction: 0 },
        } } });
      }
      if (body.action === "COMMIT_WAGE_RECALCULATION") {
        commitWrites += 1;
        if (commitWrites === 1) return route.fulfill({ status: 409, json: { error: "ข้อมูลเปลี่ยนแล้ว", code: "WAGE_PREVIEW_STALE" } });
        return route.fulfill({ json: { success: true, result: { committed: true } } });
      }
      return route.continue();
    });

    await page.goto("/");
    await page.getByRole("button", { name: "เวลาและเงินเดือน", exact: true }).click();
    await expect(page.getByRole("heading", { name: "จัดการเวลาและเงินเดือน" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "ทั้งหมด", exact: true }).click();
    await page.getByRole("button", { name: /^แก้ไขค่าแรงรายวันของ / }).first().click();
    const inputDialog = page.getByRole("dialog", { name: "แก้ไขค่าแรงรายวัน" });
    await inputDialog.getByLabel("ค่าแรงรายวัน (บาท)").fill("0");
    await inputDialog.getByRole("button", { name: "ยืนยัน", exact: true }).click();

    const previewDialog = page.getByRole("alertdialog", { name: /^ตรวจยอดก่อนแก้ค่าแรงของ / });
    await expect(previewDialog.getByText("ค่าแรงใหม่เป็น 0 บาท", { exact: false })).toBeVisible();
    await expect(previewDialog.getByRole("button", { name: "ยกเลิก" })).toBeFocused();
    expect(await previewDialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    })).toBe(true);
    await page.setViewportSize({ width: 393, height: 800 });
    expect(await previewDialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    })).toBe(true);
    await previewDialog.getByRole("button", { name: "ยืนยันแก้ค่าแรง" }).click();
    await expect(previewDialog.getByRole("alert")).toContainText("ระบบโหลด Preview ล่าสุดแล้ว");
    expect(previewReads).toBe(2);
    await previewDialog.getByRole("button", { name: "ยืนยันแก้ค่าแรง" }).click();
    await expect(page.getByText("แก้ค่าแรงและคำนวณยอดหักใหม่แล้ว")).toBeVisible();
    expect(commitWrites).toBe(2);
  });
});
