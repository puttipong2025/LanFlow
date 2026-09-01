import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test.use({ storageState: { cookies: [], origins: [] } });

async function routeApprovalSettings(page: Page) {
  await page.route("**/api/lanflow/rubber-bills/approval-settings?locationId=*", async (route) => {
    const locationId = new URL(route.request().url()).searchParams.get("locationId") ?? "";
    await route.fulfill({
      json: {
        locationId,
        groupId: null,
        priceTimeExempt: true,
        editWindowMinutes: null,
        configuredPrice: null,
        nonCurrentDateRequiresApproval: false,
      },
    });
  });
}

test("locks the Rubber Bill modal and sends one request during rapid submit", async ({ page }) => {
  await routeApprovalSettings(page);

  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveCount = 0;
  await page.route("**/api/lanflow/rubber-bills", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    saveCount += 1;
    await saveGate;
    await route.fulfill({
      json: {
        status: "synced",
        id: crypto.randomUUID(),
        serverBillNo: "SERVER-RUBBER-SINGLE-FLIGHT",
        revisionNo: 1,
        serverReceivedAt: new Date().toISOString(),
      },
    });
  });

  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มบิลยาง" }).click();

  const modal = page.locator(".fixed.inset-0").last();
  await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]')
    .fill(`SINGLE-FLIGHT-${Date.now()}`);
  await page.keyboard.press("Escape");
  const weighRow = modal.locator("table").first().locator("tbody tr").first();
  await weighRow.locator('input[type="number"]').nth(0).fill("1000");
  await weighRow.locator('input[type="number"]').nth(1).fill("200");
  await weighRow.locator('input[type="number"]').nth(3).fill("20");

  await modal.getByRole("button", { name: "บันทึกบิล" }).click();
  await expect.poll(() => saveCount).toBe(1);
  await expect(modal).toBeVisible();
  const savingButton = modal.getByRole("button", { name: "กำลังบันทึก..." });
  await expect(savingButton).toBeDisabled();
  await expect(modal.getByRole("button", { name: "ปิด" })).toBeDisabled();
  await savingButton.evaluate((button: HTMLButtonElement) => button.click());
  expect(saveCount).toBe(1);

  releaseSave();
  await expect(modal).toBeHidden();
});

test("removes every stock deduction after shortage confirmation and saves the rubber bill", async ({ page }) => {
  await routeApprovalSettings(page);
  let submittedPayload: any;
  await page.route("**/api/lanflow/rubber-bills", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submittedPayload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        status: "synced",
        id: crypto.randomUUID(),
        serverBillNo: "SERVER-RUBBER-NO-STOCK-DEDUCTION",
        revisionNo: 1,
        serverReceivedAt: new Date().toISOString(),
      },
    });
  });

  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มบิลยาง" }).click();

  const modal = page.locator(".fixed.inset-0").last();
  await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]')
    .fill(`RUBBER-SHORTAGE-${Date.now()}`);
  await page.keyboard.press("Escape");
  const weighRow = modal.locator("table").first().locator("tbody tr").first();
  await weighRow.locator('input[type="number"]').nth(0).fill("1000");
  await weighRow.locator('input[type="number"]').nth(1).fill("200");
  await weighRow.locator('input[type="number"]').nth(3).fill("20");

  await modal.getByRole("button", { name: "เพิ่มรายการหักสินค้า" }).click();
  const stockRow = modal.locator("section").filter({ hasText: "หักสินค้า" })
    .locator("tbody tr").first();
  await expect.poll(() => stockRow.locator("select option").count()).toBeGreaterThan(1);
  const productId = await stockRow.locator("select option").nth(1).getAttribute("value");
  await stockRow.locator("select").selectOption(productId!);
  await stockRow.locator('input[type="number"]').nth(0).fill("1000000000");

  await modal.getByRole("button", { name: "บันทึกบิล" }).click();
  const shortageAlert = page.getByRole("dialog", { name: "สินค้าในสต็อกไม่พอ" });
  await expect(shortageAlert).toBeVisible();
  await shortageAlert.getByRole("button", { name: "ยืนยันและลบรายการหักสินค้าทั้งหมด" }).click();

  await expect.poll(() => submittedPayload).toBeTruthy();
  expect(submittedPayload.acidPackCount).toBe(0);
  expect(submittedPayload.items.filter((item: any) => item.itemType === "stock_deduction")).toEqual([]);
});

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
  await routeApprovalSettings(page);

  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();

  await page.getByRole("button", { name: "เพิ่มบิลยาง" }).click();
  await page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]')
    .fill(`MANUAL-SHARE-${Date.now()}`);
  await page.keyboard.press("Escape");
  const modal = page.locator(".fixed.inset-0").last();
  const weighRow = modal.locator("table").first().locator("tbody tr").first();
  await weighRow.locator('input[type="number"]').nth(0).fill("1000");
  await weighRow.locator('input[type="number"]').nth(1).fill("200");
  await weighRow.locator('input[type="number"]').nth(3).fill("20");
  await modal.getByRole("button", { name: "บันทึกบิล" }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { sharedReceipt?: unknown }).sharedReceipt
  )).not.toBeUndefined();
  await page.evaluate(() => {
    const state = window as typeof window & {
      sharedReceipt?: unknown;
      shareCallCount?: number;
    };
    state.sharedReceipt = undefined;
    state.shareCallCount = 0;
  });

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
  await waitingDialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
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

for (const mode of ["online", "offline"] as const) {
test(`automatically shares a payable rubber bill after an ${mode} submit`, async ({ page, context }) => {
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
          autoSharedRubberReceipt?: { name: string; size: number; type: string };
        }).autoSharedRubberReceipt = file
          ? { name: file.name, size: file.size, type: file.type }
          : undefined;
      },
    });
  });
  await routeApprovalSettings(page);
  if (mode === "online") {
    await page.route("**/api/lanflow/rubber-bills", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        json: {
          status: "synced",
          id: crypto.randomUUID(),
          serverBillNo: "SERVER-RUBBER-AUTO-1",
          revisionNo: 1,
          serverReceivedAt: new Date().toISOString(),
        },
      });
    });
  }

  await page.goto("/login");
  await page.locator("#phone").fill(process.env.TEST_PHONE ?? "0800000000");
  await page.locator("#password").fill(process.env.TEST_PASSWORD ?? "password123");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await expect(page.getByRole("button", { name: "เพิ่มบิลยาง" })).toBeVisible();

  if (mode === "offline") await context.setOffline(true);
  const marker = `AUTO-SHARE-${mode.toUpperCase()}-${Date.now()}`;
  await page.getByRole("button", { name: "เพิ่มบิลยาง" }).click();
  await page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(marker);
  await page.keyboard.press("Escape");
  const modal = page.locator(".fixed.inset-0").last();
  const weighRow = modal.locator("table").first().locator("tbody tr").first();
  await weighRow.locator('input[type="number"]').nth(0).fill("1000");
  await weighRow.locator('input[type="number"]').nth(1).fill("200");
  await weighRow.locator('input[type="number"]').nth(3).fill("20");
  await modal.getByRole("button", { name: "บันทึกบิล" }).click();

  const waiting = page.getByRole("dialog", { name: "กำลังสร้าง PDF" });
  await expect(waiting).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      autoSharedRubberReceipt?: { name: string; size: number; type: string };
    }).autoSharedRubberReceipt
  )).not.toBeUndefined();
  const receipt = await page.evaluate(() =>
    (window as typeof window & {
      autoSharedRubberReceipt?: { name: string; size: number; type: string };
    }).autoSharedRubberReceipt
  );
  expect(receipt).toMatchObject({ type: "application/pdf" });
  if (mode === "online") {
    expect(receipt?.name).toBe("LanFlow-rubber-bill-SERVER-RUBBER-AUTO-1-80mm.pdf");
  } else {
    expect(receipt?.name).toMatch(/^LanFlow-rubber-bill-.*-80mm\.pdf$/);
  }
  expect(receipt?.size).toBeGreaterThan(1_000);
  await expect(waiting).toBeHidden();

  if (mode === "online") return;
  const queuedBill = await page.evaluate((customerName) => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open("lanflow_sync_db");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("sync_queue", "readonly");
      const all = transaction.objectStore("sync_queue").getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result.find((event) => event.payload?.customerName === customerName));
      };
      all.onerror = () => {
        db.close();
        reject(all.error);
      };
    };
  }), marker);
  expect(queuedBill).toMatchObject({ operation: "create", status: "pending" });
});
}
