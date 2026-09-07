import { expect, test } from "@playwright/test";

import { getSaleReceiptShareBlockReason } from "../src/lib/income-expense/sale-receipt";
import type { IncomeExpense } from "../src/types";

test("blocks a pending sale receipt with the Rubber Bill message", () => {
  const transaction = {
    id: crypto.randomUUID(),
    clientTempId: crypto.randomUUID(),
    localBillNo: "LOCAL-PENDING",
    serverBillNo: "SALE-PENDING",
    syncStatus: "synced",
    idempotencyKey: "pending-sale",
    locationId: crypto.randomUUID(),
    type: "income",
    number: "SALE-PENDING",
    txDate: "2026-09-07",
    title: "บิลขาย — 1 รายการ",
    cost: 25,
    billOption: "บิลขาย",
    clientCreatedAt: new Date().toISOString(),
    clientRecordedAt: new Date().toISOString(),
    revisionNo: 1,
    recordStatus: "active",
    createdByUserId: crypto.randomUUID(),
    createdByName: "ผู้ทดสอบ",
    createdByPhone: "",
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
    approvalPending: true,
  } satisfies IncomeExpense;

  expect(getSaleReceiptShareBlockReason(transaction, true)).toBe(
    "บิลนี้ยังรออนุมัติ จึงยังพิมพ์ไม่ได้",
  );
});
