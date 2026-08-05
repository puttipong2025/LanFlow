import { expect, test, type Locator, type Page } from "@playwright/test";

import { selectAppLocation } from "./helpers/select-app-location";
import { bangkokDateString } from "../src/lib/bangkok-date";

test.use({ storageState: { cookies: [], origins: [] } });

const phone = process.env.TEST_PHONE ?? "0800000000";
const password = process.env.TEST_PASSWORD ?? "password123";

type SharedReceipt = { name: string; size: number; type: string };

async function installShareMock(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: ShareData) => data.files?.[0]?.type === "application/pdf",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        const state = window as typeof window & {
          sharedSaleReceipts?: Array<{
            name: string;
            size: number;
            type: string;
          }>;
        };
        state.sharedSaleReceipts ??= [];
        if (file) {
          state.sharedSaleReceipts.push({
            name: file.name,
            size: file.size,
            type: file.type,
          });
        }
      },
    });
  });
}

async function sharedReceipts(page: Page): Promise<SharedReceipt[]> {
  return page.evaluate(() =>
    (window as typeof window & { sharedSaleReceipts?: SharedReceipt[] })
      .sharedSaleReceipts ?? []
  );
}

async function readQueue(page: Page) {
  return page.evaluate(() => new Promise<Array<{
    id: string;
    status: "pending" | "failed" | "conflict";
    errorMessage?: string;
  }>>((resolve, reject) => {
    const request = indexedDB.open("lanflow_sync_db");
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve([]);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sync_queue")) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction("sync_queue", "readonly");
      const all = transaction.objectStore("sync_queue").getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result);
      };
      all.onerror = () => {
        db.close();
        reject(all.error);
      };
    };
  }));
}

async function loginAndOpenIncomeExpense(page: Page) {
  await page.goto("/login");
  await page.locator("#phone").fill(phone);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByText("ออกจากระบบ")).toBeVisible({ timeout: 30_000 });

  const response = await page.request.get("/api/auth/me");
  expect(response.ok()).toBeTruthy();
  const me = await response.json() as {
    profile: { locationIds: string[] };
  };

  await page.goto("/");
  await selectAppLocation(page, me.profile.locationIds[0]);
  await page.getByRole("navigation").getByRole("button", {
    name: /^รับ-จ่าย(?: มีงานที่จัดการได้ \d+ รายการ)?$/,
  }).click();
  await expect(page.getByRole("button", { name: "เพิ่มรายรับ" })).toBeVisible();
}

function incomeExpenseModal(page: Page) {
  return page.locator(".fixed.inset-0").filter({
    has: page.getByRole("heading", { name: "เพิ่ม/แก้ไข บิลเงินสด" }),
  }).last();
}

async function chooseFirstSaleItem(modal: Locator, rowIndex = 0) {
  const select = modal.locator("tbody tr").nth(rowIndex).locator("select");
  await expect.poll(() => select.locator("option").count()).toBeGreaterThan(1);
  const value = await select.locator("option").nth(1).getAttribute("value");
  expect(value).toBeTruthy();
  await select.selectOption(value!);
}

async function fillSaleLine(
  modal: Locator,
  rowIndex: number,
  quantity: string,
  priceValue: string,
) {
  const row = modal.locator("tbody tr").nth(rowIndex);
  await chooseFirstSaleItem(modal, rowIndex);
  await row.locator('input[type="number"]').nth(0).fill(quantity);
  await row.locator('input[type="number"]').nth(1).fill(priceValue);
}

test("keeps one sale command in flight and preserves the modal until sync succeeds", async ({ page }) => {
  await installShareMock(page);

  let releaseSync!: () => void;
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  let approvalCount = 0;
  let syncCount = 0;

  await page.route("**/api/lanflow/income-expense/approval-requests", async (route) => {
    approvalCount += 1;
    await route.fulfill({ json: { status: "no_approval" } });
  });
  await page.route("**/api/lanflow/income-expense", async (route) => {
    syncCount += 1;
    await syncGate;
    await route.fulfill({
      json: {
        status: "synced",
        id: crypto.randomUUID(),
        serverBillNo: "SERVER-SALE-SINGLE-FLIGHT",
        revisionNo: 1,
        serverReceivedAt: new Date().toISOString(),
        title: "บิลขาย — 1 รายการ",
        cost: 25,
        saleLineCount: 1,
        saleLines: [{
          id: crypto.randomUUID(),
          incomeSaleItemId: crypto.randomUUID(),
          stockProductId: crypto.randomUUID(),
          title: "สินค้า",
          quantity: 1,
          unitPrice: 25,
          lineTotal: 25,
          sequenceNo: 1,
        }],
      },
    });
  });

  await loginAndOpenIncomeExpense(page);
  await page.getByRole("button", { name: "เพิ่มรายรับ" }).click();
  const modal = incomeExpenseModal(page);
  await modal.getByRole("button", { name: /บิลขาย/ }).click();
  await fillSaleLine(modal, 0, "1", "25");

  await modal.getByRole("button", { name: "บันทึกบิล" }).click();
  await expect.poll(() => syncCount).toBe(1);
  await expect(modal).toBeVisible();
  const savingButton = modal.getByRole("button", { name: "กำลังบันทึก..." });
  await expect(savingButton).toBeDisabled();
  await expect(modal.getByRole("button", { name: "ปิด" })).toBeDisabled();
  await savingButton.evaluate((button: HTMLButtonElement) => button.click());
  expect(approvalCount).toBe(0);
  await expect(modal).toBeVisible();
  releaseSync();
  await expect(modal).toBeHidden();
});

test("opens the PDF window only after one whole-bill sync succeeds", async ({ page }) => {
  await installShareMock(page);

  let releaseSync!: () => void;
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  let syncStarted = false;
  let syncCount = 0;
  await page.route("**/api/lanflow/income-expense", async (route) => {
    syncStarted = true;
    await syncGate;
    syncCount += 1;
    await route.fulfill({
      json: {
        status: "synced",
        id: crypto.randomUUID(),
        serverBillNo: "SERVER-SALE-1",
        revisionNo: 1,
        serverReceivedAt: new Date().toISOString(),
        title: "บิลขาย — 2 รายการ",
        cost: 80,
        saleLineCount: 2,
        saleLines: [
          {
            id: crypto.randomUUID(),
            incomeSaleItemId: crypto.randomUUID(),
            stockProductId: crypto.randomUUID(),
            title: "สินค้า 1",
            quantity: 2,
            unitPrice: 25,
            lineTotal: 50,
            sequenceNo: 1,
          },
          {
            id: crypto.randomUUID(),
            incomeSaleItemId: crypto.randomUUID(),
            stockProductId: crypto.randomUUID(),
            title: "สินค้า 2",
            quantity: 3,
            unitPrice: 10,
            lineTotal: 30,
            sequenceNo: 2,
          },
        ],
      },
    });
  });

  await loginAndOpenIncomeExpense(page);
  await page.getByRole("button", { name: "เพิ่มรายรับ" }).click();
  const modal = incomeExpenseModal(page);
  await modal.getByRole("button", { name: /บิลขาย/ }).click();
  await fillSaleLine(modal, 0, "2", "25");
  await modal.getByRole("button", { name: "เพิ่มรายการ" }).click();
  await fillSaleLine(modal, 1, "3", "10");
  await modal.getByRole("button", { name: "บันทึกบิล" }).click();

  const waiting = page.getByRole("dialog", { name: "กำลังสร้าง PDF" });
  await expect.poll(() => syncStarted).toBe(true);
  await expect(waiting).toBeHidden();
  await expect(modal).toBeVisible();
  expect(await sharedReceipts(page)).toEqual([]);

  releaseSync();
  await expect.poll(() => sharedReceipts(page), { timeout: 20_000 }).toHaveLength(1);
  const [receipt] = await sharedReceipts(page);
  expect(syncCount).toBe(1);
  expect(receipt).toMatchObject({
    name: "LanFlow-sale-bill-SERVER-SALE-1-80mm.pdf",
    type: "application/pdf",
  });
  expect(receipt.size).toBeGreaterThan(1_000);
  await expect(waiting).toBeHidden();
});

test("waits for an edited sale line to sync and keeps the server bill number on the PDF", async ({ page }) => {
  await installShareMock(page);

  const serverBillNo = "SERVER-EDIT-1001";
  const clientTempId = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  const today = bangkokDateString();
  let releaseSync!: () => void;
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  let syncStarted = false;

  await page.route("**/api/lanflow/income-expense/feed?**", async (route) => {
    await route.fulfill({
      json: {
        rows: [{
          id: rowId,
          clientTempId,
          localBillNo: "LOCAL-EDIT-1",
          serverBillNo,
          syncStatus: "synced",
          idempotencyKey: `create:${clientTempId}:0`,
          locationId: "placeholder",
          type: "income",
          number: serverBillNo,
          txDate: today,
          title: "สินค้าก่อนแก้",
          cost: 25,
          billOption: "บิลขาย",
          saleLineCount: 1,
          createdByUserId: crypto.randomUUID(),
          createdByName: "ผู้ทดสอบ",
          createdByPhone: "",
          clientCreatedAt: new Date().toISOString(),
          clientRecordedAt: new Date().toISOString(),
          revisionNo: 1,
          recordStatus: "active",
        }],
        nextCursor: null,
      },
    });
  });
  await page.route(`**/api/lanflow/income-expense/${rowId}`, async (route) => {
    await route.fulfill({
      json: {
        saleLineCount: 1,
        saleLines: [{
          id: crypto.randomUUID(),
          incomeSaleItemId: crypto.randomUUID(),
          stockProductId: crypto.randomUUID(),
          title: "สินค้าก่อนแก้",
          quantity: 1,
          unitPrice: 25,
          lineTotal: 25,
          sequenceNo: 1,
        }],
      },
    });
  });
  await page.route("**/api/lanflow/income-expense", async (route) => {
    syncStarted = true;
    await syncGate;
    await route.fulfill({
      json: {
        status: "synced",
        id: rowId,
        serverBillNo,
        revisionNo: 2,
        serverReceivedAt: new Date().toISOString(),
        title: "บิลขาย — 1 รายการ",
        cost: 120,
        saleLineCount: 1,
        saleLines: [{
          id: crypto.randomUUID(),
          incomeSaleItemId: crypto.randomUUID(),
          stockProductId: crypto.randomUUID(),
          title: "สินค้าแก้ไข",
          quantity: 4,
          unitPrice: 30,
          lineTotal: 120,
          sequenceNo: 1,
        }],
      },
    });
  });

  await loginAndOpenIncomeExpense(page);
  const row = page.locator("tbody tr", { hasText: "สินค้าก่อนแก้" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "แก้ไข", exact: true }).click();
  const modal = incomeExpenseModal(page);
  await fillSaleLine(modal, 0, "4", "30");
  await modal.getByRole("button", { name: "บันทึกบิล" }).click();

  const waiting = page.getByRole("dialog", { name: "กำลังสร้าง PDF" });
  await expect.poll(() => syncStarted).toBe(true);
  await expect(waiting).toBeHidden();
  await expect(modal).toBeVisible();
  expect(await sharedReceipts(page)).toEqual([]);

  releaseSync();
  await expect.poll(() => sharedReceipts(page), { timeout: 20_000 }).toHaveLength(1);
  expect((await sharedReceipts(page))[0].name).toBe(
    `LanFlow-sale-bill-${serverBillNo}-80mm.pdf`
  );
});

test("shows every stock shortage, preserves the modal, and removes the rejected queue event", async ({ page }) => {
  await installShareMock(page);
  const submittedClientIds: string[] = [];

  await page.route("**/api/lanflow/income-expense", async (route) => {
    const payload = route.request().postDataJSON();
    submittedClientIds.push(payload.clientTempId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (submittedClientIds.length > 1) {
      await route.fulfill({
        json: {
          status: "synced",
          id: crypto.randomUUID(),
          serverBillNo: "SERVER-RETRY-SAME-ID",
          revisionNo: 1,
          serverReceivedAt: new Date().toISOString(),
          title: "บิลขาย — 1 รายการ",
          cost: 50,
          saleLineCount: 1,
          saleLines: [{
            id: crypto.randomUUID(),
            incomeSaleItemId: crypto.randomUUID(),
            stockProductId: crypto.randomUUID(),
            title: "สินค้า",
            quantity: 2,
            unitPrice: 25,
            lineTotal: 50,
            sequenceNo: 1,
          }],
        },
      });
      return;
    }
    await route.fulfill({
      status: 400,
      json: {
        status: "failed",
        errorCode: "STOCK_SHORTAGE",
        errorMessage: "สินค้าในสต็อกไม่พอสำหรับบิลขาย",
        stockShortages: [
          { productId: crypto.randomUUID(), productName: "น้ำกรด A", requestedQuantity: 2, availableQuantity: 1 },
          { productId: crypto.randomUUID(), productName: "ถุง B", requestedQuantity: 5, availableQuantity: 0 },
        ],
      },
    });
  });

  await loginAndOpenIncomeExpense(page);
  await page.getByRole("button", { name: "เพิ่มรายรับ" }).click();
  const modal = incomeExpenseModal(page);
  await modal.getByRole("button", { name: /บิลขาย/ }).click();
  await fillSaleLine(modal, 0, "2", "25");
  await modal.getByRole("button", { name: "บันทึกบิล" }).click();

  const shortageAlert = page.getByRole("dialog", { name: "สินค้าในสต็อกไม่พอ" });
  await expect(shortageAlert).toContainText("น้ำกรด A: ขอ 2 · คงเหลือ 1");
  await expect(shortageAlert).toContainText("ถุง B: ขอ 5 · คงเหลือ 0");
  expect(await sharedReceipts(page)).toEqual([]);
  await expect.poll(async () => (await readQueue(page)).length).toBe(0);
  await shortageAlert.getByRole("button", { name: "ตกลง" }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "บันทึกบิล" }).click();
  await expect(modal).toBeHidden();
  expect(submittedClientIds).toHaveLength(2);
  expect(submittedClientIds[1]).toBe(submittedClientIds[0]);
});

test("labels the post-save PDF action as closing a saved bill window", async ({ page }) => {
  await installShareMock(page);

  let releaseSync!: () => void;
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  let syncStarted = false;

  await page.route("**/api/lanflow/income-expense", async (route) => {
    syncStarted = true;
    await syncGate;
    await route.fulfill({
      json: {
        status: "synced",
        id: crypto.randomUUID(),
        serverBillNo: "SERVER-CANCEL-1",
        revisionNo: 1,
        serverReceivedAt: new Date().toISOString(),
        title: "บิลขาย — 1 รายการ",
        cost: 25,
        saleLineCount: 1,
        saleLines: [{
          id: crypto.randomUUID(),
          incomeSaleItemId: crypto.randomUUID(),
          stockProductId: crypto.randomUUID(),
          title: "สินค้า",
          quantity: 1,
          unitPrice: 25,
          lineTotal: 25,
          sequenceNo: 1,
        }],
      },
    });
  });

  await loginAndOpenIncomeExpense(page);
  await page.getByRole("button", { name: "เพิ่มรายรับ" }).click();
  const modal = incomeExpenseModal(page);
  await modal.getByRole("button", { name: /บิลขาย/ }).click();
  await fillSaleLine(modal, 0, "1", "25");
  await modal.getByRole("button", { name: "บันทึกบิล" }).click();

  const waiting = page.getByRole("dialog", { name: "กำลังสร้าง PDF" });
  await expect.poll(() => syncStarted).toBe(true);
  await expect(waiting).toBeHidden();
  await expect(modal).toBeVisible();

  releaseSync();
  await Promise.all([
    expect(waiting).toContainText("บิลบันทึกแล้ว กรุณารอสักครู่"),
    expect(waiting.getByRole("button", { name: "ปิดหน้าต่าง", exact: true })).toBeVisible(),
  ]);
  await expect(waiting).toBeHidden();
  await expect(modal).toBeHidden();
  await expect.poll(async () => (await readQueue(page)).length).toBe(0);
});

test("lets the user remove a legacy failed sale that never reached the server", async ({ page }) => {
  await installShareMock(page);
  await page.route("**/api/lanflow/income-expense", async (route) => {
    await route.fulfill({
      status: 400,
      json: { status: "failed", errorMessage: "บิลค้างทดสอบ" },
    });
  });

  await loginAndOpenIncomeExpense(page);
  await page.getByRole("button", { name: "เพิ่มรายรับ" }).click();
  const modal = incomeExpenseModal(page);
  await modal.getByRole("button", { name: /บิลขาย/ }).click();
  await fillSaleLine(modal, 0, "1", "25");
  await modal.getByRole("button", { name: "บันทึกบิล" }).click();
  await expect.poll(async () => (await readQueue(page))[0]?.status).toBe("failed");
  await expect(modal).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await modal.getByRole("button", { name: /ปิด/ }).click();
  await expect(modal).toBeHidden();

  const discardButton = page.getByRole("button", { name: "ลบรายการค้าง" });
  await expect(discardButton).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await discardButton.click();
  await expect.poll(async () => (await readQueue(page)).length).toBe(0);
  await expect(discardButton).toBeHidden();
});
