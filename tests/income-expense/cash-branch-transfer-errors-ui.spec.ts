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

function cashLedgerRow({
  id,
  type,
  title,
  reportLockNo,
}: {
  id: string;
  type: "income" | "expense";
  title: string;
  reportLockNo: string | null;
}) {
  const rowId = `cash-transfer-${type}:${id}`;
  return {
    id: rowId,
    clientTempId: rowId,
    localBillNo: `CASH-${id.slice(0, 8)}`,
    serverBillNo: `CASH-${id.slice(0, 8)}`,
    syncStatus: "synced",
    idempotencyKey: rowId,
    locationId: "00000000-0000-4000-8000-000000000001",
    type,
    number: `CASH-${id.slice(0, 8)}`,
    txDate: "2026-09-29",
    title,
    cost: 20,
    billOption: type === "income" ? "รายรับ" : "ค่าใช้จ่าย",
    createdByUserId: "00000000-0000-4000-8000-000000000002",
    createdByName: "LanFlow E2E",
    createdByPhone: "0800000000",
    clientCreatedAt: "2026-09-29T00:00:00.000Z",
    clientRecordedAt: "2026-09-29T00:00:00.000Z",
    serverReceivedAt: "2026-09-29T00:00:00.000Z",
    revisionNo: 1,
    recordStatus: "active",
    relationSourceType: "money_transfer",
    relationSourceId: `cash:${id}`,
    relationSourceLocationId: "00000000-0000-4000-8000-000000000001",
    relationLabel: type === "income" ? "รับเงินแล้ว" : "รอรับเงิน",
    relationLockReason: "รายการนี้มาจากการโยกเงินสด ต้องเปิดรายละเอียดเพื่อดูข้อมูล",
    reportLockNo,
  };
}

test("report-locked outgoing and incoming cash rows disable delete but keep read actions", async ({ page }) => {
  const outgoing = cashLedgerRow({
    id: "199a446b-6a54-40ae-8caa-0a3cf86676cb",
    type: "expense",
    title: "โยกเงินสดไป สาขาปลายทาง",
    reportLockNo: "RPT-LOCK-OUT",
  });
  const incoming = cashLedgerRow({
    id: "299a446b-6a54-40ae-8caa-0a3cf86676cb",
    type: "income",
    title: "รับโอนเงินสดจาก สาขาต้นทาง",
    reportLockNo: "RPT-LOCK-IN",
  });
  const unlocked = cashLedgerRow({
    id: "399a446b-6a54-40ae-8caa-0a3cf86676cb",
    type: "expense",
    title: "โยกเงินสดที่ยังไม่ออกรายงาน",
    reportLockNo: null,
  });
  const lockedIncomeExpense = {
    ...unlocked,
    id: "income-expense-locked",
    clientTempId: "income-expense-locked",
    localBillNo: "IE-LOCKED",
    serverBillNo: "IE-LOCKED",
    number: "IE-LOCKED",
    idempotencyKey: "income-expense-locked",
    title: "รายรับทั่วไปที่ล็อกโดยรายงาน",
    type: "income",
    billOption: "รายรับ",
    relationSourceType: undefined,
    relationSourceId: undefined,
    relationSourceLocationId: undefined,
    relationLabel: undefined,
    relationLockReason: undefined,
    reportLockNo: "RPT-LOCK-GENERAL",
  };
  await page.route("**/api/lanflow/income-expense/feed?**", (route) => route.fulfill({
    json: { rows: [outgoing, incoming, unlocked, lockedIncomeExpense], nextCursor: null, hasMore: false, pendingApprovalCount: 0 },
  }));
  await page.route(`**/api/lanflow/cash-branch-transfers/${outgoing.relationSourceId.slice(5)}`, (route) => route.fulfill({
    json: {
      transfer: {
        ...detail,
        id: outgoing.relationSourceId.slice(5),
        report_lock_no: outgoing.reportLockNo,
      },
    },
  }));

  await openIncomeExpense(page);

  for (const [title, reportNo] of [
    [outgoing.title, outgoing.reportLockNo],
    [incoming.title, incoming.reportLockNo],
  ] as const) {
    const row = page.locator("table tbody tr", { hasText: title });
    const reason = `ล็อกโดยรายงาน ${reportNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`;
    await expect(row).toBeVisible();
    await expect(row.getByText(`ล็อกโดย ${reportNo}`, { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: reason, exact: true })).toBeDisabled();
    await expect(row.getByRole("button", { name: "เปิดรายการต้นทาง", exact: true })).toBeEnabled();
    await expect(row.getByRole("button", { name: "แชร์ PDF รายละเอียดเงินสด 80 มม.", exact: true })).toBeEnabled();
  }

  const unlockedRow = page.locator("table tbody tr", { hasText: unlocked.title });
  await expect(unlockedRow.getByRole("button", { name: "ลบรายการโยกเงิน", exact: true })).toBeEnabled();
  await expect(unlockedRow.getByText(/ล็อกโดย RPT-/)).toHaveCount(0);

  const lockedIncomeExpenseRow = page.locator("table tbody tr", { hasText: lockedIncomeExpense.title });
  const generalReason = "ล็อกโดยรายงาน RPT-LOCK-GENERAL — ต้องลบรายงานล่าสุดตามลำดับก่อน";
  const blockedActions = lockedIncomeExpenseRow.getByRole("button", { name: generalReason, exact: true });
  await expect(lockedIncomeExpenseRow.getByText("ล็อกโดย RPT-LOCK-GENERAL", { exact: true })).toBeVisible();
  await expect(blockedActions).toHaveCount(2);
  for (const action of await blockedActions.all()) await expect(action).toBeDisabled();

  const outgoingRow = page.locator("table tbody tr", { hasText: outgoing.title });
  await outgoingRow.getByRole("button", { name: "เปิดรายการต้นทาง", exact: true }).click();
  const details = page.locator(".fixed.inset-0").last();
  await expect(details.getByText(`ล็อกโดยรายงาน ${outgoing.reportLockNo}`, { exact: false })).toBeVisible();
  await expect(details.getByRole("button", { name: "แก้ไขก่อนตรวจรับ", exact: true })).toBeDisabled();
});

test.describe("cash transfer delete scope", () => {
  test.use({ storageState: "playwright/.auth/admin.json" });

  test("destination-only admin sees delete disabled before loading transfer detail", async ({ page }) => {
    const incoming = {
      ...cashLedgerRow({
        id: "499a446b-6a54-40ae-8caa-0a3cf86676cb",
        type: "income",
        title: "รับโอนเงินสดจากสาขาที่ไม่ได้ดูแล",
        reportLockNo: null,
      }),
      relationSourceLocationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    };
    await page.route("**/api/lanflow/income-expense/feed?**", (route) => route.fulfill({
      json: { rows: [incoming], nextCursor: null, hasMore: false, pendingApprovalCount: 0 },
    }));

    await openIncomeExpense(page);

    const row = page.locator("table tbody tr", { hasText: incoming.title });
    await expect(row.getByRole("button", {
      name: "เฉพาะผู้ดูแลสาขาต้นทางหรือผู้จัดการระบบเท่านั้น",
      exact: true,
    })).toBeDisabled();
  });
});

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

test("coalesces two same-tick receipt confirmations into one request", async ({ page }) => {
  let receiptRequests = 0;
  await page.route("**/api/lanflow/cash-branch-transfers?**", async (route) => {
    if (!route.request().url().includes("view=pending")) return route.continue();
    await route.fulfill({ json: { transfers: [summary], total: 1 } });
  });
  await page.route(`**/api/lanflow/cash-branch-transfers/${transferId}`, async (route) => {
    await route.fulfill({ json: { transfer: detail } });
  });
  await page.route(`**/api/lanflow/cash-branch-transfers/${transferId}/receive`, async (route) => {
    receiptRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ json: { id: transferId, status: "synced", difference: 0 } });
  });

  await openIncomeExpense(page);
  await page.locator(`button[data-transfer-id="${transferId}"]`).click();
  const dialog = page.locator(".fixed.inset-0").last();
  const confirm = dialog.getByRole("button", { name: "ยืนยันรับเงิน" });
  await confirm.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect.poll(() => receiptRequests).toBe(1);
});
