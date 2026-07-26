import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("shares a Rubber Bill PDF and falls back to download", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: ShareData) => data.files?.[0]?.type === "application/pdf",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        (window as typeof window & {
          sharedReceipt?: { name: string; size: number; type: string };
        }).sharedReceipt = file
          ? { name: file.name, size: file.size, type: file.type }
          : undefined;
      },
    });
  });

  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();

  const shareButton = page.locator(
    'button[title="แชร์ PDF ใบรับซื้อยาง"]:not([disabled])'
  ).first();
  await expect(shareButton).toBeVisible();
  await shareButton.click();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      sharedReceipt?: { name: string; size: number; type: string };
    }).sharedReceipt
  )).not.toBeUndefined();
  const sharedReceipt = await page.evaluate(() =>
    (window as typeof window & {
      sharedReceipt?: { name: string; size: number; type: string };
    }).sharedReceipt
  );
  expect(sharedReceipt).toMatchObject({
    type: "application/pdf",
  });
  expect(sharedReceipt?.name).toMatch(/^LanFlow-rubber-bill-.*-80mm\.pdf$/);
  expect(sharedReceipt?.size).toBeGreaterThan(1_000);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });
  const downloadPromise = page.waitForEvent("download");
  await shareButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^LanFlow-rubber-bill-.*-80mm\.pdf$/
  );
});
