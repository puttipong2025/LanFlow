import { expect, test } from "@playwright/test";

test.use({ storageState: "playwright/.auth/super_admin.json" });

const transferId = "6c829a06-12a6-4cec-92d7-1f20de1c93f1";
const summary = {
  id: transferId,
  locationId: "00000000-0000-4000-8000-000000000001",
  sourceLocationName: "สาขาต้นทาง",
  targetLocationId: "00000000-0000-4000-8000-000000000001",
  targetLocationName: "สาขาปลายทาง",
  createdByName: "LanFlow E2E",
  createdByPhone: "0800000000",
  sentTotal: 20,
  status: "pending_receipt",
  note: "summary only",
  sentAt: "2026-08-26T00:00:00.000Z",
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
    sent_banknote_20_count: 1, sent_banknote_50_count: 0, sent_banknote_100_count: 0,
    sent_banknote_500_count: 0, sent_banknote_1000_count: 0,
    received_coin_1_count: null, received_coin_2_count: null, received_coin_5_count: null, received_coin_10_count: null,
    received_banknote_20_count: null, received_banknote_50_count: null, received_banknote_100_count: null,
    received_banknote_500_count: null, received_banknote_1000_count: null,
    sent_total: 20, received_total: null, difference_total: null, cash_status: "pending_receipt",
    note: "summary only", sent_at: "2026-08-26T00:00:00.000Z", received_at: null,
    received_by_name: null, received_by_phone: null,
  }],
};

test("cash queue mounts with bounded summary and fetches denominations only after opening the receipt", async ({ page }) => {
  const summaryBodies: unknown[] = [];
  let detailCalls = 0;
  await page.route("**/api/lanflow/cash-branch-transfers?**", async (route) => {
    if (!route.request().url().includes("view=pending")) return route.continue();
    summaryBodies.push({ transfers: [summary], total: 21 });
    await route.fulfill({ json: { transfers: [summary], total: 21 } });
  });
  await page.route(`**/api/lanflow/cash-branch-transfers/${transferId}`, async (route) => {
    detailCalls += 1;
    await route.fulfill({ json: { transfer: detail } });
  });

  await page.goto("/");
  const incomeExpenseTab = page.getByRole("button", { name: "รับ-จ่าย" });
  await expect(incomeExpenseTab).toBeVisible({ timeout: 30_000 });
  await incomeExpenseTab.click();
  await expect(page.locator(`button[data-transfer-id="${transferId}"]`)).toBeVisible();

  expect(summaryBodies.length).toBeGreaterThan(0);
  expect(summaryBodies.every((body) => !JSON.stringify(body).includes("sent_coin_"))).toBe(true);
  expect(summaryBodies.every((body) => !JSON.stringify(body).includes("received_banknote_"))).toBe(true);
  await expect(page.locator(`button[data-transfer-id="${transferId}"]`)).toContainText("จาก LanFlow E2E · ฿20");
  expect(detailCalls).toBe(0);

  await page.locator(`button[data-transfer-id="${transferId}"]`).click();
  await expect(page.getByRole("heading", { name: "ตรวจรับเงินสด", exact: true })).toBeVisible();
  await expect.poll(() => detailCalls).toBe(1);
  await expect(page.getByLabel("แบงค์ 20", { exact: true })).toHaveValue("1");
});
