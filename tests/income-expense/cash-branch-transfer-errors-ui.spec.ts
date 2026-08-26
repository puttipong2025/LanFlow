import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const transferId = "099a446b-6a54-40ae-8caa-0a3cf86676cb";
const summary = {
  id: transferId, locationId: "00000000-0000-4000-8000-000000000001",
  sourceLocationName: "สาขาต้นทาง", targetLocationId: "00000000-0000-4000-8000-000000000001",
  targetLocationName: "สาขาปลายทาง", createdByName: "LanFlow E2E", createdByPhone: "0800000000",
  sentTotal: 20, status: "pending_receipt", note: "test error", sentAt: "2026-08-26T00:00:00.000Z",
};
const detail = {
  ...summary,
  location_id: summary.locationId,
  target_location_id: summary.targetLocationId,
  target_location_name: summary.targetLocationName,
  created_by_name: summary.createdByName,
  created_by_phone: summary.createdByPhone,
  money_transfer_cash_details: [{
    sent_coin_1_count: 0, sent_coin_2_count: 0, sent_coin_5_count: 0, sent_coin_10_count: 0,
    sent_banknote_20_count: 1, sent_banknote_50_count: 0, sent_banknote_100_count: 0, sent_banknote_500_count: 0, sent_banknote_1000_count: 0,
    received_coin_1_count: null, received_coin_2_count: null, received_coin_5_count: null, received_coin_10_count: null,
    received_banknote_20_count: null, received_banknote_50_count: null, received_banknote_100_count: null, received_banknote_500_count: null, received_banknote_1000_count: null,
    sent_total: 20, received_total: null, difference_total: null, cash_status: "pending_receipt", note: "test error", sent_at: "2026-08-26T00:00:00.000Z",
    received_at: null, received_by_name: null, received_by_phone: null,
  }],
};

async function openIncomeExpense(page: import("@playwright/test").Page) {
  await page.goto("/");
  const tab = page.getByRole("button", { name: "รับ-จ่าย" });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
}

test("shows an accessible pending-queue error with retry while the operational list stays visible", async ({ page }) => {
  let allowPending = false;
  await page.route("**/api/lanflow/cash-branch-transfers?**", async (route) => {
    if (!route.request().url().includes("view=pending")) return route.continue();
    if (!allowPending) {
      await route.fulfill({ status: 500, json: { error: "คิวเงินสดล้มเหลว" } });
      return;
    }
    await route.fulfill({ json: { transfers: [summary], total: 1 } });
  });

  await openIncomeExpense(page);
  await expect(page.getByRole("alert", { name: /โหลดคิวรอรับเงินสดไม่สำเร็จ/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "รายการ" })).toBeVisible();
  allowPending = true;
  await page.getByRole("button", { name: "ลองใหม่สำหรับคิวรอรับเงินสด" }).click();
  await expect(page.locator(`button[data-transfer-id="${transferId}"]`)).toBeVisible();
});

test("detail error keeps the receipt dialog closable and retries without clearing the queue", async ({ page }) => {
  let detailAttempts = 0;
  await page.route("**/api/lanflow/cash-branch-transfers?**", async (route) => {
    if (!route.request().url().includes("view=pending")) return route.continue();
    await route.fulfill({ json: { transfers: [summary], total: 1 } });
  });
  await page.route(`**/api/lanflow/cash-branch-transfers/${transferId}`, async (route) => {
    detailAttempts += 1;
    if (detailAttempts === 1) {
      await route.fulfill({ status: 500, json: { error: "รายละเอียดเงินสดล้มเหลว" } });
      return;
    }
    await route.fulfill({ json: { transfer: detail } });
  });

  await openIncomeExpense(page);
  await page.locator(`button[data-transfer-id="${transferId}"]`).click();
  const dialog = page.locator(".fixed.inset-0").last();
  await expect(dialog.getByRole("alert", { name: /โหลดรายละเอียดเงินสดไม่สำเร็จ/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "ปิด", exact: true })).toBeVisible();
  await expect(page.locator(`button[data-transfer-id="${transferId}"]`)).toBeVisible();
  await dialog.getByRole("button", { name: "ลองใหม่สำหรับรายละเอียดเงินสด" }).click();
  await expect(dialog.getByLabel("แบงค์ 20", { exact: true })).toHaveValue("1");
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(dialog).toBeHidden();
});
