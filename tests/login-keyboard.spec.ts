import { expect, test } from "@playwright/test";

test("keeps the credential form usable while session revalidation is pending", async ({ page }) => {
  let releaseAuthCheck = () => {};
  const authCheckPending = new Promise<void>((resolve) => {
    releaseAuthCheck = resolve;
  });

  await page.route("**/api/auth/me", async (route) => {
    await authCheckPending;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "auth service unavailable" }),
    });
  });

  try {
    await page.goto("/login");
    const phone = page.getByLabel("เบอร์โทรศัพท์", { exact: true });
    await expect(phone).toBeVisible({
      timeout: 1_000,
    });
    await expect(phone).toBeEnabled();
    await phone.fill("0812345678");
    const submit = page.locator('button[type="submit"]');
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAccessibleName("กำลังตรวจสอบสถานะ...");
    releaseAuthCheck();
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveAccessibleName("เข้าสู่ระบบ");
  } finally {
    releaseAuthCheck();
  }
});

test("password reveal is reachable by keyboard and toggles without submitting", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel("รหัสผ่าน", { exact: true });
  const reveal = page.getByRole("button", { name: "แสดง", exact: true });
  const submit = page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true });
  await expect(submit).toBeEnabled();
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
  await expect(submit).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".login-error")).toHaveCount(0);
});
