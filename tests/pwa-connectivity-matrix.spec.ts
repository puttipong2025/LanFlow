import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:3001" });

test.describe("production PWA connectivity matrix", () => {
  test.afterEach(async ({ context }) => {
    await context.setOffline(false).catch(() => {});
  });

  test("updates every open window and reloads each window once on reconnect", async ({
    context,
    page,
  }) => {
    test.setTimeout(90_000);
    const phone = process.env.TEST_PHONE || "0800000000";
    const password = process.env.TEST_PASSWORD || "password123";
    await context.addInitScript(() => {
      const current = Number(sessionStorage.getItem("lanflow:pwa-navigation-count") || "0");
      sessionStorage.setItem("lanflow:pwa-navigation-count", String(current + 1));
    });

    await page.goto("/login");
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => page.evaluate(() =>
      Boolean(navigator.serviceWorker?.controller)
    )).toBe(true);

    const secondPage = await context.newPage();
    await secondPage.goto("/");
    await expect(secondPage.getByText("ออนไลน์", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => secondPage.evaluate(() =>
      Boolean(navigator.serviceWorker?.controller)
    )).toBe(true);

    const firstBaseline = await page.evaluate(() =>
      Number(sessionStorage.getItem("lanflow:pwa-navigation-count"))
    );
    const secondBaseline = await secondPage.evaluate(() =>
      Number(sessionStorage.getItem("lanflow:pwa-navigation-count"))
    );

    await context.setOffline(true);
    await expect(page.getByText("ไม่มีอินเทอร์เน็ต", { exact: true })).toBeVisible();
    await expect(secondPage.getByText("ไม่มีอินเทอร์เน็ต", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^เลือกสาขา/)).toBeDisabled();
    await expect(secondPage.getByLabel(/^เลือกสาขา/)).toBeDisabled();

    await context.setOffline(false);
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(secondPage.getByText("ออนไลน์", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => page.evaluate(() =>
      Number(sessionStorage.getItem("lanflow:pwa-navigation-count"))
    )).toBe(firstBaseline + 1);
    await expect.poll(() => secondPage.evaluate(() =>
      Number(sessionStorage.getItem("lanflow:pwa-navigation-count"))
    )).toBe(secondBaseline + 1);

    await page.waitForTimeout(1_000);
    expect(await page.evaluate(() =>
      Number(sessionStorage.getItem("lanflow:pwa-navigation-count"))
    )).toBe(firstBaseline + 1);
    expect(await secondPage.evaluate(() =>
      Number(sessionStorage.getItem("lanflow:pwa-navigation-count"))
    )).toBe(secondBaseline + 1);
  });

  test("restores a persisted Rubber Bill draft after reconnect reload", async ({
    context,
    page,
  }) => {
    test.setTimeout(90_000);
    const phone = process.env.TEST_PHONE || "0800000000";
    const password = process.env.TEST_PASSWORD || "password123";
    const marker = `PWA-DRAFT-${Date.now()}`;

    await page.goto("/login");
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => page.evaluate(() =>
      Boolean(navigator.serviceWorker?.controller)
    )).toBe(true);

    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
    const modal = page.locator(".fixed.inset-0").last();
    const customerInput = modal.locator(
      'input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]',
    );
    await customerInput.fill(marker);
    await page.keyboard.press("Escape");
    await context.setOffline(true);
    await expect(page.getByText("ไม่มีอินเทอร์เน็ต", { exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
    await page.getByRole("button", { name: "เพิ่มบิลยาง", exact: true }).click();
    const restoredModal = page.locator(".fixed.inset-0").last();
    await expect(restoredModal.locator(
      'input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]',
    )).toHaveValue(marker);

    page.once("dialog", (dialog) => dialog.accept());
    await restoredModal.getByRole("button", { name: "ปิด", exact: true }).click();
    await expect(restoredModal).toBeHidden();
  });
});
