import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

async function openRubberBills(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await expect(page.getByRole("button", { name: "บัตรคิว", exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: ShareData) => data.files?.[0]?.type === "application/pdf",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const state = window as typeof window & { sharedQueuePdfs?: string[] };
        state.sharedQueuePdfs ??= [];
        const filename = data.files?.[0]?.name;
        if (filename) state.sharedQueuePdfs.push(filename);
      },
    });
  });
});

test("manages, reorders, warns, reshares, deletes, and persists the daily queue", async ({ page }) => {
  await openRubberBills(page);
  await expect.poll(() => page.evaluate(() => (
    Object.keys(localStorage).some((key) => key.startsWith("lanflow:weighing-queue-customers:v1:"))
  ))).toBe(true);
  await page.getByRole("button", { name: "บัตรคิว", exact: true }).click();

  await expect(page.getByRole("heading", { name: "กำหนดเวลาชั่งประจำวัน" })).toBeVisible();
  await page.locator('input[type="time"]').fill("14:00");
  await page.getByRole("button", { name: "เริ่มคิววันนี้" }).click();

  const customerInput = page.getByRole("textbox", { name: "ชื่อลูกค้าสำหรับบัตรคิว" });
  await customerInput.fill("ลูกค้าชื่อซ้ำ");
  await page.getByRole("button", { name: "เพิ่มเข้าคิว" }).click();
  await customerInput.fill("ลูกค้าชื่อซ้ำ");
  await page.getByRole("button", { name: "เพิ่มเข้าคิว" }).click();

  const queueTable = page.getByRole("table", { name: "ตารางคิวชั่ง" });
  let rows = queueTable.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("1");
  await expect(rows.nth(1)).toContainText("2");

  await rows.nth(1).getByRole("button", { name: "แชร์ PDF บัตรคิว 2" }).click();
  await expect(rows.nth(1)).toContainText("แชร์ล่าสุด");
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { sharedQueuePdfs?: string[] }).sharedQueuePdfs?.at(-1)
  )).toMatch(/^LanFlow-weighing-queue-Q02-.*-80mm\.pdf$/);

  await rows.nth(1).getByRole("button", { name: "เลื่อนคิว 2 ขึ้น" }).click();
  rows = queueTable.locator("tbody tr");
  await expect(rows.nth(0)).toContainText("ข้อมูลเปลี่ยนหลังแชร์");

  await rows.nth(0).getByRole("button", { name: "แชร์ PDF บัตรคิว 1" }).click();
  await expect(rows.nth(0)).toContainText("แชร์ล่าสุด");

  await page.getByRole("button", { name: "แก้เวลา" }).click();
  await page.locator('input[type="time"]').fill("15:00");
  await page.getByRole("button", { name: "บันทึกเวลา" }).click();
  await expect(rows.nth(0)).toContainText("ข้อมูลเปลี่ยนหลังแชร์");

  page.once("dialog", (dialog) => dialog.accept());
  await rows.nth(1).getByRole("button", { name: "ลบคิว 2" }).click();
  await expect(rows).toHaveCount(1);

  await page.getByRole("button", { name: "ปิด" }).click();
  await page.getByRole("button", { name: "บัตรคิว", exact: true }).click();
  await expect(page.getByRole("table", { name: "ตารางคิวชั่ง" }).locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("15:00 น.", { exact: true })).toBeVisible();
});

test("reloads offline with cached customers and the device-local queue", async ({ page, context }) => {
  test.skip(process.env.PW_PROJECT !== "pwa", "requires the production PWA service worker");

  await openRubberBills(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.evaluate(() => {
    const deviceId = localStorage.getItem("lanflow:device-id");
    if (!deviceId) throw new Error("device id is missing");
    localStorage.setItem(`lanflow:weighing-queue-customers:v1:${deviceId}`, JSON.stringify({
      version: 1,
      cachedAt: new Date().toISOString(),
      customers: [{
        id: "cached-customer",
        mainName: "ลูกค้าแคชทดสอบ",
        legacyMemberId: "CACHE001",
        class: "สาขาใหญ่จ่าย",
        farmAddress: "สวนออฟไลน์",
      }],
    }));
  });

  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();

  await page.getByRole("button", { name: "เพิ่มบิลยาง" }).click();
  const billCustomerInput = page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]');
  await billCustomerInput.fill("CACHE001");
  await expect(page.getByRole("button", { name: /ลูกค้าแคชทดสอบ/ })).toBeVisible();
  await page.getByRole("button", { name: /ลูกค้าแคชทดสอบ/ }).click();
  await expect(billCustomerInput).toHaveValue("ลูกค้าแคชทดสอบ");
  await expect(page.getByRole("radio", { name: "สาขาใหญ่จ่าย" })).toHaveCount(0);
  await expect(page.getByText("สวนออฟไลน์")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "ปิด" }).click();
  await expect(page.getByRole("heading", { name: "บิลเครื่องชั่งเล็ก" })).toBeHidden();

  await page.getByRole("button", { name: "บัตรคิว", exact: true }).click();
  await page.locator('input[type="time"]').fill("16:00");
  await page.getByRole("button", { name: "เริ่มคิววันนี้" }).click();

  const customerInput = page.getByRole("textbox", { name: "ชื่อลูกค้าสำหรับบัตรคิว" });
  await customerInput.fill("ลูกค้าแคช");
  await expect(page.getByRole("button", { name: /ลูกค้าแคชทดสอบ/ })).toBeVisible();
  await page.getByRole("button", { name: /ลูกค้าแคชทดสอบ/ }).click();
  await page.getByRole("button", { name: "เพิ่มเข้าคิว" }).click();
  await customerInput.fill("ลูกค้ากรอกเอง");
  await page.getByRole("button", { name: "เพิ่มเข้าคิว" }).click();

  const queueRows = page.getByRole("table", { name: "ตารางคิวชั่ง" }).locator("tbody tr");
  await expect(queueRows).toHaveCount(2);
  await expect(queueRows.nth(0)).toContainText("ลูกค้าแคชทดสอบ");

  await queueRows.nth(0).getByRole("button", { name: "แชร์ PDF บัตรคิว 1" }).click();
  await expect(queueRows.nth(0)).toContainText("แชร์ล่าสุด");
  await queueRows.nth(1).getByRole("button", { name: "เลื่อนคิว 2 ขึ้น" }).click();
  await expect(queueRows.nth(1)).toContainText("ข้อมูลเปลี่ยนหลังแชร์");

  page.once("dialog", (dialog) => dialog.accept());
  await queueRows.nth(0).getByRole("button", { name: "ลบคิว 1" }).click();
  await expect(queueRows).toHaveCount(1);

  await page.reload();
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("button", { name: "บัตรคิว", exact: true }).click();
  await expect(page.getByRole("table", { name: "ตารางคิวชั่ง" }).locator("tbody tr")).toContainText("ลูกค้าแคชทดสอบ");
  await expect(page.getByText("16:00 น.", { exact: true })).toBeVisible();
});

test("shares an 80mm appointment PDF from a wait preset", async ({ page }) => {
  await openRubberBills(page);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "แชร์ PDF บัตรนัด 5 นาที" }).click();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { sharedQueuePdfs?: string[] }).sharedQueuePdfs?.at(-1)
  )).toMatch(/^LanFlow-weighing-appointment-.*-5min-80mm\.pdf$/);
  await expect(page.getByText("แชร์ PDF บัตรนัดชั่งแล้ว")).toBeVisible();
  await expect(page.getByRole("heading", { name: "เลือกระยะเวลารอ" })).toHaveCount(0);
});
