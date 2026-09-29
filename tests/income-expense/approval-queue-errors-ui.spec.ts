import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

test("approval queue reports a failed request load and can retry", async ({ page }) => {
  let failApprovalReads = true;
  await page.route("**/rest/v1/income_expense_approval_requests?*", async (route) => {
    if (!failApprovalReads) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 400,
      json: { message: "approval queue unavailable" },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^รับ-จ่าย(?: |$)/ }).click();
  await page.getByRole("button", { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();

  const approvalModal = page.locator(".fixed.inset-0").last();
  const loadError = approvalModal.getByRole("alert");
  await expect(loadError).toContainText("โหลดคำขออนุมัติไม่สำเร็จ", { timeout: 15_000 });
  await expect(approvalModal.getByText("ยังไม่มีคำขออนุมัติ", { exact: true })).toHaveCount(0);

  failApprovalReads = false;
  await loadError.getByRole("button", { name: "ลองใหม่", exact: true }).click();
  await expect(loadError).toBeHidden();
});
