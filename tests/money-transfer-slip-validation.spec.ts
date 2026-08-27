import { expect, test } from "@playwright/test";

import { validateMoneyTransferSlips } from "../src/components/money-transfer/slip-validation";
import type { MoneyTransferSlip } from "../src/types";

function slip(transactionDate: string | null): MoneyTransferSlip {
  return {
    id: "slip-1",
    inputMethod: "manual",
    amount: 100,
    referenceNumber: null,
    fee: 0,
    senderName: null,
    receiverName: null,
    transactionDate,
    slipImageUrl: null,
    sortOrder: 0,
  };
}

test("rejects a malformed slip transaction date", () => {
  expect(validateMoneyTransferSlips([slip("not-a-date")])).toContainEqual({
    slipId: "slip-1",
    slipIndex: 0,
    field: "transactionDate",
    message: "สลิป 1: วันที่ทำรายการไม่ถูกต้อง",
  });
});
