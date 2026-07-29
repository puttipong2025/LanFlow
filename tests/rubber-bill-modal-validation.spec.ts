import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

for (const viewport of [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 393, height: 852 },
]) {
test(`shows all Rubber Bill errors without moving focus and restores blank numeric inputs to zero on ${viewport.name}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มบิลยาง" }).click();

  const modal = page.locator(".fixed.inset-0").last();
  const weighRow = modal.locator("table").first().locator("tbody tr").first();
  const editableZero = weighRow.locator('input[type="number"]').nth(0);
  const readOnlyZero = weighRow.locator('input[type="number"]').nth(2);
  const deductWeight = modal.getByLabel("หักน้ำหนักยาง (กก.)");

  await editableZero.focus();
  await expect(editableZero).toHaveValue("");
  await editableZero.fill("12");
  await editableZero.fill("");
  await expect(editableZero).toHaveValue("");
  await readOnlyZero.focus();
  await expect(editableZero).toHaveValue("0");
  await expect(readOnlyZero).toHaveValue("0");

  await deductWeight.focus();
  await expect(deductWeight).toHaveValue("");
  await deductWeight.fill("12");
  await deductWeight.fill("");
  await expect(deductWeight).toHaveValue("");
  await readOnlyZero.focus();
  await expect(deductWeight).toHaveValue("0");

  const saveButton = modal.getByRole("button", { name: "บันทึกบิล" });
  await saveButton.focus();
  await saveButton.click();

  await expect(page.getByText("พบข้อมูลที่ต้องแก้ไข 3 จุด")).toBeVisible();
  await expect(page.getByText("ชื่อลูกค้า: กรุณาระบุข้อมูล").last()).toBeVisible();

  const summary = modal.getByRole("alert");
  await expect(summary).toContainText("ชื่อลูกค้า: กรุณาระบุข้อมูล");
  await expect(summary).toContainText("รายการชั่งที่ 1: น้ำหนักเข้าต้องมากกว่าน้ำหนักออก");
  await expect(summary).toContainText("รายการชั่งที่ 1: น้ำหนักชั่งสุทธิต้องมากกว่า 0");
  await expect(summary.locator("li")).toHaveCount(3);
  await expect(saveButton).toBeFocused();
  await expect.poll(() => summary.evaluate((element) => {
    const scrollBody = element.closest(".modal-scroll-body");
    return scrollBody?.scrollTop ?? -1;
  })).toBeLessThan(20);
});
}
