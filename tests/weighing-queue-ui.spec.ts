import { expect, test } from "@playwright/test";
import path from "node:path";
import { confirmCurrentBranchIfRequired } from "./helpers/select-app-location";

test.use({ storageState: "playwright/.auth/super_admin.json" });

async function openRubberBills(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await expect(page.getByRole("button", { name: "บัตรคิว", exact: true })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: ShareData) => data.files?.[0]?.type === "application/pdf",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const state = window as typeof window & {
          sharedQueuePdfs?: string[];
          sharedQueuePdfMetadata?: Array<{ filename: string; pdfText: string; size: number }>;
        };
        state.sharedQueuePdfs ??= [];
        state.sharedQueuePdfMetadata ??= [];
        const file = data.files?.[0];
        if (file) {
          state.sharedQueuePdfs.push(file.name);
          state.sharedQueuePdfMetadata.push({
            filename: file.name,
            pdfText: new TextDecoder().decode(await file.arrayBuffer()),
            size: file.size,
          });
        }
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

  await page.getByRole("button", { name: "ปิด", exact: true }).click();
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
  await confirmCurrentBranchIfRequired(page);
  const billCustomerInput = page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]');
  await billCustomerInput.fill("CACHE001");
  await expect(page.getByRole("button", { name: /ลูกค้าแคชทดสอบ/ })).toBeVisible();
  await page.getByRole("button", { name: /ลูกค้าแคชทดสอบ/ }).click();
  await expect(billCustomerInput).toHaveValue("ลูกค้าแคชทดสอบ");
  await expect(page.getByRole("radio", { name: "สาขาใหญ่จ่าย" })).toHaveCount(0);
  await expect(page.getByText("สวนออฟไลน์")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
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

test("reviews, focuses, shares, and advances an appointment number only after success", async ({ page }) => {
  test.setTimeout(60_000);
  await openRubberBills(page);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await expect(page.getByRole("button", { name: "เลือกเวลารอ 120 นาที" })).toBeVisible();
  await expect(page.getByRole("button", { name: "เลือกเวลารอ 180 นาที" })).toBeVisible();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();

  const nameInput = page.getByRole("textbox", { name: /ชื่อลูกค้า/ });
  const appointmentDialog = page.getByRole("dialog", { name: "จับเวลา" });
  await expect(nameInput).toBeFocused();
  await expect(page.getByText("เลขคิวบัตรนัด")).toBeVisible();
  await expect(appointmentDialog.getByText("1", { exact: true })).toBeVisible();
  await nameInput.fill("  ลูกค้าบัตรนัด  ");

  await page.getByRole("button", { name: "เปลี่ยนเวลา" }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 10 นาที" }).click();
  await expect(nameInput).toHaveValue("  ลูกค้าบัตรนัด  ");
  await page.getByRole("button", { name: "แชร์ PDF", exact: true }).click();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { sharedQueuePdfs?: string[] }).sharedQueuePdfs?.at(-1)
  )).toMatch(/^LanFlow-weighing-appointment-Q1-.*-80mm\.pdf$/);
  await expect(page.getByText("แชร์ PDF บัตรนัดชั่งแล้ว")).toBeVisible();
  await expect(page.getByRole("heading", { name: "เลือกระยะเวลารอ" })).toBeVisible();
  const pdfMetadata = await page.evaluate(() => (
    window as typeof window & {
      sharedQueuePdfMetadata?: Array<{ filename: string; pdfText: string; size: number }>;
    }
  ).sharedQueuePdfMetadata?.at(-1));
  expect(pdfMetadata?.size).toBeGreaterThan(1_000);
  expect(pdfMetadata?.pdfText.match(/\/Type \/Page\b/g)).toHaveLength(1);
  expect(pdfMetadata?.pdfText).toContain("/MediaBox [0 0 226.772");
  expect(await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("lanflow:weighing-appointment-counter:"));
    const raw = key ? localStorage.getItem(key) : null;
    return { keys: Object.keys(localStorage).filter((item) => item.includes("weighing-appointment")), raw };
  })).toMatchObject({
    keys: [expect.stringContaining("weighing-appointment-counter:")],
    raw: expect.not.stringContaining("ลูกค้าบัตรนัด"),
  });

  await page.getByRole("button", { name: "เลือกเวลารอ 15 นาที" }).click();
  await expect(appointmentDialog.getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /ชื่อลูกค้า/ })).toHaveValue("");
});

test("rolls back a cancelled appointment share and keeps its review draft", async ({ page }) => {
  test.setTimeout(60_000);
  await openRubberBills(page);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  const nameInput = page.getByRole("textbox", { name: /ชื่อลูกค้า/ });
  await nameInput.fill("ลูกค้ายกเลิกแชร์");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("ยกเลิก", "AbortError");
      },
    });
  });

  const shareButton = page.getByRole("button", { name: "แชร์ PDF", exact: true });
  await shareButton.click();
  await expect(shareButton).toBeEnabled({ timeout: 20_000 });
  await expect(nameInput).toHaveValue("ลูกค้ายกเลิกแชร์");
  await expect(nameInput).toBeFocused();
  await expect(page.getByRole("dialog", { name: "จับเวลา" }).getByText("1", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("lanflow:weighing-appointment-counter:"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  })).toMatchObject({ lastIssued: 0, pending: null });
});

test("rolls back an appointment when PDF generation is cancelled from the waiting dialog", async ({ page }) => {
  await openRubberBills(page);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  const nameInput = page.getByRole("textbox", { name: /ชื่อลูกค้า/ });
  await nameInput.fill("ลูกค้ายกเลิกระหว่างสร้าง PDF");
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function toBlob() {
      // Keep PDF generation pending until the waiting dialog aborts it.
    };
  });

  const shareButton = page.getByRole("button", { name: "แชร์ PDF", exact: true });
  await shareButton.click();
  const waitingDialog = page.getByRole("dialog", { name: "กำลังสร้าง PDF" });
  await expect(waitingDialog).toBeVisible();
  await waitingDialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();

  await expect(shareButton).toBeEnabled();
  await expect(nameInput).toHaveValue("ลูกค้ายกเลิกระหว่างสร้าง PDF");
  await expect(nameInput).toBeFocused();
  expect(await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("lanflow:weighing-appointment-counter:"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  })).toMatchObject({ lastIssued: 0, pending: null });
});

test("rolls back an appointment reservation when PDF generation fails", async ({ page }) => {
  await openRubberBills(page);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback) {
      callback(null);
    };
  });

  await page.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect(page.getByText("ไม่สามารถสร้างข้อมูล PDF ได้", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("lanflow:weighing-appointment-counter:"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  })).toMatchObject({ lastIssued: 0, pending: null });
});

test("serializes appointment shares across two tabs and requires review after a stale preview", async ({ page, context }) => {
  test.setTimeout(90_000);
  await openRubberBills(page);
  const secondPage = await context.newPage();
  await openRubberBills(secondPage);

  for (const currentPage of [page, secondPage]) {
    await currentPage.getByRole("button", { name: "จับเวลา", exact: true }).click();
    await currentPage.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
    await expect(
      currentPage.getByRole("dialog", { name: "จับเวลา" }).getByText("1", { exact: true }),
    ).toBeVisible();
  }

  await page.evaluate(() => {
    const state = window as typeof window & {
      appointmentShareStarted?: boolean;
      releaseAppointmentShare?: () => void;
    };
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        state.appointmentShareStarted = true;
        await new Promise<void>((resolve) => {
          state.releaseAppointmentShare = resolve;
        });
      },
    });
  });

  await page.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { appointmentShareStarted?: boolean }
  ).appointmentShareStarted)).toBe(true);

  await secondPage.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect(secondPage.getByText("อีกแท็บกำลังออกบัตรนัด กรุณารอให้เสร็จแล้วลองใหม่")).toBeVisible();

  await page.evaluate(() => (
    window as typeof window & { releaseAppointmentShare?: () => void }
  ).releaseAppointmentShare?.());
  await expect(page.getByRole("heading", { name: "เลือกระยะเวลารอ" })).toBeVisible({ timeout: 20_000 });

  await secondPage.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect(secondPage.getByText("เลขคิวมีการเปลี่ยนแปลง ระบบอัปเดตเลขใหม่แล้ว กรุณาตรวจสอบและกดแชร์อีกครั้ง")).toBeVisible();
  await expect(
    secondPage.getByRole("dialog", { name: "จับเวลา" }).getByText("2", { exact: true }),
  ).toBeVisible();
  await secondPage.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect.poll(() => secondPage.evaluate(() =>
    (window as typeof window & { sharedQueuePdfs?: string[] }).sharedQueuePdfs?.at(-1)
  )).toMatch(/^LanFlow-weighing-appointment-Q2-.*-80mm\.pdf$/);
});

test("serializes first-use appointment shares even when legacy device-id initialization races", async ({ page, context }) => {
  test.setTimeout(60_000);
  const secondPage = await context.newPage();
  for (const [currentPage, seed] of [[page, 1_111], [secondPage, 2_222]] as const) {
    await currentPage.addInitScript(({ deviceSeed }) => {
      const originalGetItem = Storage.prototype.getItem;
      const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
      let deviceReadInjected = false;
      let randomInjected = false;
      Storage.prototype.getItem = function getItem(key: string) {
        if (key === "lanflow:device-id" && !deviceReadInjected) {
          deviceReadInjected = true;
          return null;
        }
        return originalGetItem.call(this, key);
      };
      Object.defineProperty(crypto, "getRandomValues", {
        configurable: true,
        value: (array: Uint16Array) => {
          if (!randomInjected && array instanceof Uint16Array && array.length === 2) {
            randomInjected = true;
            array.fill(deviceSeed);
            return array;
          }
          return originalGetRandomValues(array);
        },
      });
    }, { deviceSeed: seed });
    await openRubberBills(currentPage);
    await currentPage.getByRole("button", { name: "จับเวลา", exact: true }).click();
    await currentPage.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  }

  await page.evaluate(() => {
    const state = window as typeof window & {
      appointmentShareStarted?: boolean;
      releaseAppointmentShare?: () => void;
    };
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        state.appointmentShareStarted = true;
        await new Promise<void>((resolve) => {
          state.releaseAppointmentShare = resolve;
        });
      },
    });
  });
  await page.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { appointmentShareStarted?: boolean }
  ).appointmentShareStarted)).toBe(true);

  await secondPage.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect(secondPage.getByText("อีกแท็บกำลังออกบัตรนัด กรุณารอให้เสร็จแล้วลองใหม่")).toBeVisible();
  await page.evaluate(() => (
    window as typeof window & { releaseAppointmentShare?: () => void }
  ).releaseAppointmentShare?.());
});

test("lets another tab reuse the number after a normal share cancellation", async ({ page, context }) => {
  test.setTimeout(60_000);
  await openRubberBills(page);
  const secondPage = await context.newPage();
  await openRubberBills(secondPage);
  for (const currentPage of [page, secondPage]) {
    await currentPage.getByRole("button", { name: "จับเวลา", exact: true }).click();
    await currentPage.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("ยกเลิก", "AbortError");
      },
    });
  });

  const firstShareButton = page.getByRole("button", { name: "แชร์ PDF", exact: true });
  await firstShareButton.click();
  await expect(firstShareButton).toBeEnabled({ timeout: 20_000 });
  await secondPage.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect.poll(() => secondPage.evaluate(() =>
    (window as typeof window & { sharedQueuePdfs?: string[] }).sharedQueuePdfs?.at(-1)
  )).toMatch(/^LanFlow-weighing-appointment-Q1-.*-80mm\.pdf$/);
});

test("keeps appointments usable when legacy device identity is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key === "lanflow:device-id") throw new DOMException("blocked", "SecurityError");
      return originalGetItem.call(this, key);
    };
  });
  await openRubberBills(page);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  await expect(page.getByRole("textbox", { name: /ชื่อลูกค้า/ })).toBeFocused();
  await expect(page.getByRole("dialog", { name: "จับเวลา" }).getByText("1", { exact: true })).toBeVisible();
});

test("does not open the device-local queue under a fallback identity", async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key === "lanflow:device-id") throw new DOMException("blocked", "SecurityError");
      return originalGetItem.call(this, key);
    };
  });
  await openRubberBills(page);

  await page.getByRole("button", { name: "บัตรคิว", exact: true }).click();

  await expect(page.getByText("อุปกรณ์นี้ไม่อนุญาตให้เก็บคิวชั่ง จึงยังไม่สามารถเปิดบัตรคิวได้")).toBeVisible();
  await expect(page.getByRole("heading", { name: "กำหนดเวลาชั่งประจำวัน" })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => (
    key.includes("weighing-queue:v1:storage-unavailable")
  )))).toBe(false);
});

test("fails closed when appointment counter storage is unreadable", async ({ page }) => {
  await page.addInitScript(() => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key.startsWith("lanflow:weighing-appointment-counter:")) {
        throw new DOMException("blocked", "SecurityError");
      }
      return originalGetItem.call(this, key);
    };
  });
  await openRubberBills(page);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  await expect(page.getByText("ไม่สามารถอ่านเลขคิวบัตรนัดจากอุปกรณ์นี้ได้")).toBeVisible();
  await expect(page.getByRole("button", { name: "แชร์ PDF", exact: true })).toHaveCount(0);
});

test("fails closed before PDF handoff when Web Locks are unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  });
  await openRubberBills(page);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  await expect(page.getByText("เบราว์เซอร์นี้ไม่รองรับการกันเลขคิวบัตรนัดอย่างปลอดภัย").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "แชร์ PDF", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (
    window as typeof window & { sharedQueuePdfs?: string[] }
  ).sharedQueuePdfs ?? [])).toEqual([]);
});

test("commits an appointment number after a real fallback download event", async ({ page }) => {
  test.setTimeout(60_000);
  await openRubberBills(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "แชร์ PDF", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^LanFlow-weighing-appointment-Q1-.*-80mm\.pdf$/);
  await expect(page.getByText("แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน")).toBeVisible();
  expect(await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("lanflow:weighing-appointment-counter:"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  })).toMatchObject({ lastIssued: 1, pending: null });
});

test("keeps the appointment counter across an offline PWA reload", async ({ page, context }) => {
  test.skip(process.env.PW_PROJECT !== "pwa", "requires the production PWA service worker");
  test.setTimeout(90_000);
  await openRubberBills(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  await page.getByRole("button", { name: "แชร์ PDF", exact: true }).click();
  await expect(page.getByRole("heading", { name: "เลือกระยะเวลารอ" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "เสร็จสิ้น" }).click();

  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  await expect(
    page.getByRole("dialog", { name: "จับเวลา" }).getByText("2", { exact: true }),
  ).toBeVisible();
});

test("exports real appointment PDF fixtures for visual QA", async ({ page }) => {
  const outputDirectory = process.env.APPOINTMENT_PDF_QA_DIR;
  test.skip(!outputDirectory, "set APPOINTMENT_PDF_QA_DIR for manual PDF QA artifacts");
  test.setTimeout(90_000);
  await page.clock.setFixedTime(new Date("2026-07-25T16:30:00.000Z"));
  await openRubberBills(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  await page.getByRole("button", { name: "จับเวลา", exact: true }).click();
  await page.getByRole("button", { name: "เลือกเวลารอ 60 นาที" }).click();
  const [firstDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "แชร์ PDF", exact: true }).click(),
  ]);
  await firstDownload.saveAs(path.join(outputDirectory!, "appointment-Q1-empty-next-day.pdf"));

  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("lanflow:weighing-appointment-counter:"));
    if (!key) throw new Error("appointment counter key is missing");
    const state = JSON.parse(localStorage.getItem(key) ?? "null");
    localStorage.setItem(key, JSON.stringify({ ...state, lastIssued: 9_998, pending: null }));
  });
  await page.getByRole("button", { name: "เลือกเวลารอ 5 นาที" }).click();
  await page.getByRole("textbox", { name: /ชื่อลูกค้า/ }).fill("ก".repeat(100));
  const [lastDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "แชร์ PDF", exact: true }).click(),
  ]);
  await lastDownload.saveAs(path.join(outputDirectory!, "appointment-Q9999-name-100.pdf"));
});

test("shares a stateless custom queue ticket and keeps the draft only after share cancellation", async ({ page, context }) => {
  test.setTimeout(60_000);
  await openRubberBills(page);
  if (process.env.PW_PROJECT === "pwa") {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole("button", { name: "บิลยาง", exact: true }).click();
  }

  const queueButton = page.getByRole("button", { name: "บัตรคิว", exact: true });
  const customButton = page.getByRole("button", { name: "คิวกำหนดเอง", exact: true });
  const appointmentButton = page.getByRole("button", { name: "จับเวลา", exact: true });
  await expect(customButton).toBeVisible();
  expect(await queueButton.evaluate((queue, custom) => (
    Boolean(queue.compareDocumentPosition(custom as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
  ), await customButton.elementHandle())).toBe(true);
  expect(await customButton.evaluate((custom, appointment) => (
    Boolean(custom.compareDocumentPosition(appointment as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
  ), await appointmentButton.elementHandle())).toBe(true);

  await customButton.click();
  const input = page.getByRole("textbox", { name: "เลขลำดับคิว" });
  await expect(input).toBeFocused();
  await input.fill("0");
  await page.getByRole("button", { name: "แชร์ PDF บัตรคิว" }).click();
  await expect(page.getByText("กรุณาระบุเลขลำดับคิวตั้งแต่ 1 ถึง 9999", { exact: true })).toBeVisible();

  await input.fill("00a07");
  await expect(input).toHaveValue("0007");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("ยกเลิก", "AbortError");
      },
    });
  });
  const shareButton = page.getByRole("button", { name: "แชร์ PDF บัตรคิว" });
  await shareButton.click();
  await expect(shareButton).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "บัตรคิวกำหนดเอง" })).toBeVisible();
  await expect(input).toHaveValue("0007");

  await page.evaluate(() => {
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
  await page.getByRole("button", { name: "แชร์ PDF บัตรคิว" }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { sharedQueuePdfs?: string[] }
  ).sharedQueuePdfs?.at(-1))).toMatch(
    /^LanFlow-custom-weighing-queue-Q7-.*-80mm\.pdf$/,
  );
  await expect(page.getByText("แชร์ PDF บัตรคิวกำหนดเองแล้ว")).toBeVisible();
  await expect(page.getByRole("heading", { name: "บัตรคิวกำหนดเอง" })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => (
    key.includes("custom-weighing-queue") || key.includes("custom-queue")
  )))).toEqual([]);

  await customButton.click();
  await expect(page.getByRole("textbox", { name: "เลขลำดับคิว" })).toHaveValue("");
});
