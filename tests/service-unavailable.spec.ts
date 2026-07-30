import { expect, test } from "@playwright/test";

async function readSyncQueue(page: import("@playwright/test").Page) {
  return page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open("lanflow_sync_db");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sync_queue")) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction("sync_queue", "readonly");
      const all = transaction.objectStore("sync_queue").getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
      transaction.oncomplete = () => db.close();
    };
  }));
}

test.describe("online device with unavailable API", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("keeps cached bootstrap data visible and distinguishes service failure from offline", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible();

    await page.route(/\/api\/lanflow(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "service unavailable" }),
      });
    });

    await page.reload();

    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible();
    await expect(page.getByText(
      "เชื่อมต่อระบบไม่ได้ กำลังแสดงข้อมูลล่าสุด",
      { exact: true },
    )).toBeVisible();
    await expect(page.getByText("ไม่มีอินเทอร์เน็ต", { exact: true })).toHaveCount(0);
  });

  test("shows service failure when a Dashboard request fails after bootstrap", async ({
    page,
  }) => {
    await page.route("**/api/lanflow/dashboard/snapshot?**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "dashboard unavailable" }),
      });
    });

    await page.goto("/");
    await expect(page.getByLabel(/^เลือกสาขา/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible();
    await expect(page.getByText(
      "เชื่อมต่อระบบไม่ได้ กำลังแสดงข้อมูลล่าสุด",
      { exact: true },
    )).toBeVisible();
  });

  test("keeps an Income save pending when authentication needs recovery", async ({
    page,
  }) => {
    const marker = `INCOME-401-PENDING-${Date.now()}`;
    await page.goto("/");
    await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.route("**/api/lanflow/income-expense", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ errorMessage: "authentication expired" }),
      });
    });

    await page.getByRole("button", { name: /^รับ-จ่าย(?: |$)/ }).click();
    await page.getByRole("button", { name: "เพิ่มรายรับ", exact: true }).click();
    const modal = page.locator(".fixed.inset-0").last();
    const line = modal.locator("table tbody tr").first();
    await line.locator("input:not([type])").fill(marker);
    await line.locator('input[type="number"]').last().fill("10");
    await modal.getByRole("button", { name: "บันทึกบิล", exact: true }).click();
    await expect(modal).toBeHidden();

    await expect.poll(async () => {
      const queue = await readSyncQueue(page);
      return queue.some((event) =>
        event.entity === "income_expense"
        && event.status === "pending"
        && event.payload?.title === marker
      );
    }).toBe(true);

    await page.evaluate((targetMarker) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("lanflow_sync_db");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("sync_queue", "readwrite");
        const cursorRequest = transaction.objectStore("sync_queue").openCursor();
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          if (cursor.value?.payload?.title === targetMarker) cursor.delete();
          cursor.continue();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    }), marker);
  });
});
