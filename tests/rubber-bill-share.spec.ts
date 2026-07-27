import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test.use({ storageState: { cookies: [], origins: [] } });

test("shares a Rubber Bill PDF and falls back to download", async ({ page }) => {
  await page.addInitScript(() => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.setTimeout(() => originalToBlob.apply(this, args), 200);
    };
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: ShareData) => data.files?.[0]?.type === "application/pdf",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        const state = window as typeof window & {
          sharedReceipt?: { name: string; size: number; type: string };
          shareCallCount?: number;
          waitingVisibleAtShare?: boolean;
        };
        state.shareCallCount = (state.shareCallCount ?? 0) + 1;
        state.waitingVisibleAtShare = Boolean(document.getElementById("share-pdf-waiting-title"));
        state.sharedReceipt = file
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
  expect(await page.evaluate(() =>
    (window as typeof window & { waitingVisibleAtShare?: boolean }).waitingVisibleAtShare
  )).toBe(false);

  const shareCallsBeforeCancel = await page.evaluate(() =>
    (window as typeof window & { shareCallCount?: number }).shareCallCount ?? 0
  );
  await shareButton.click();
  const waitingDialog = page.getByRole("dialog", { name: "กำลังสร้าง PDF" });
  await expect(waitingDialog).toBeVisible();
  await waitingDialog.getByRole("button", { name: "ยกเลิก" }).click();
  await expect(waitingDialog).toBeHidden();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() =>
    (window as typeof window & { shareCallCount?: number }).shareCallCount ?? 0
  )).toBe(shareCallsBeforeCancel);
  await expect(shareButton).toBeEnabled();

  let cancelledDownloads = 0;
  page.on("download", () => {
    cancelledDownloads += 1;
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("cancelled", "AbortError");
      },
    });
  });
  await shareButton.click();
  await expect(shareButton).toBeEnabled();
  await page.waitForTimeout(300);
  expect(cancelledDownloads).toBe(0);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => {
        throw new Error("unsupported");
      },
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
  const outputDir = join(process.cwd(), "output", "pdf");
  await mkdir(outputDir, { recursive: true });
  await download.saveAs(join(outputDir, "rubber-bill-receipt-80mm.pdf"));
});
