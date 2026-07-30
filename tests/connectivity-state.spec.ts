import { expect, test } from "@playwright/test";

test.describe("shared device connectivity state", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test.afterEach(async ({ context }) => {
    await context.setOffline(false).catch(() => {});
  });

  test("updates the Header indicator and offline controls from one transition", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    const locationButton = page.getByLabel(/^เลือกสาขา/);
    await expect(locationButton).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible();
    await expect(locationButton).toBeEnabled();

    await context.setOffline(true);

    await expect(page.getByText("ไม่มีอินเทอร์เน็ต", { exact: true })).toBeVisible();
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeHidden();
    await expect(locationButton).toBeDisabled();
  });
});
