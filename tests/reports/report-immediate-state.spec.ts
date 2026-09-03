import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

test("removes a server-deleted report even when the list refresh fails", async ({ page }) => {
  let deleted = false;
  let deletes = 0;
  await page.route(/\/api\/lanflow\/reports\?.*$/, async (route) => {
    if (deleted) {
      await route.fulfill({ status: 503, json: { error: "REPORT_HISTORY_UNAVAILABLE" } });
    } else {
      await route.fulfill({ json: { reports: [{
        id: "confirmed-report", reportNo: "RPT-CONFIRMED-DELETE", cutoffAt: "2026-09-02T03:00:00.000Z",
        createdByName: "ผู้ทดสอบ", itemCount: 1, isLatestActive: true, hasCashCount: false,
        cashCountId: null, rubberExportLockNo: null,
      }], hasMore: false, nextCursor: null } });
    }
  });
  await page.route("**/api/lanflow/reports/confirmed-report", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    deleted = true;
    deletes += 1;
    await route.fulfill({ json: { status: "deleted" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "รายงาน", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "RPT-CONFIRMED-DELETE" });
  await row.getByRole("button", { name: "ลบรายงานล่าสุดเพื่อปลดล็อกรายการ" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "ลบ", exact: true }).click();
  await expect(page.getByText("REPORT_HISTORY_UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(deletes).toBe(1);
});
