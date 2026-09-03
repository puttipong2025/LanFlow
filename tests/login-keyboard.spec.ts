import { expect, test } from "@playwright/test";

test("password reveal is reachable by keyboard and toggles without submitting", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel("รหัสผ่าน", { exact: true });
  const reveal = page.getByRole("button", { name: "แสดง", exact: true });
  await password.fill("synthetic-password");
  await password.focus();
  await page.keyboard.press("Tab");
  await expect(reveal).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "ซ่อน", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type", "password");
  await page.keyboard.press("Shift+Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".login-error")).toHaveCount(0);
});
