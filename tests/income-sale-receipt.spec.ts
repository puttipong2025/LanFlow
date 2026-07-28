import { expect, test } from "@playwright/test";

import {
  buildSaleReceiptModel,
  getSaleReceiptShareBlockReason,
  renderSaleReceiptHtml,
} from "../src/lib/income-expense/sale-receipt";
import type { IncomeExpense, Location } from "../src/types";

const location: Location = {
  id: "location-1",
  name: "สาขาทดสอบ",
  code: "TEST",
  active: true,
};

function makeSaleBill(patch: Partial<IncomeExpense> = {}): IncomeExpense {
  return {
    id: "bill-1",
    clientTempId: "bill-1",
    localBillNo: "LOCAL-1",
    serverBillNo: "2607270001",
    syncStatus: "synced",
    idempotencyKey: "create:bill-1:0",
    locationId: location.id,
    type: "income",
    number: "2607270001",
    txDate: "2026-07-27",
    title: "บิลขาย — 2 รายการ",
    cost: 175,
    billOption: "บิลขาย",
    saleLineCount: 2,
    saleLines: [
      {
        id: "line-1",
        incomeSaleItemId: "sale-item-1",
        stockProductId: "product-1",
        title: "น้ำกรด",
        quantity: 2,
        unitPrice: 50,
        lineTotal: 100,
        sequenceNo: 1,
      },
      {
        id: "line-2",
        incomeSaleItemId: "sale-item-2",
        stockProductId: "product-2",
        title: "สินค้า <พิเศษ>",
        quantity: 3,
        unitPrice: 25,
        lineTotal: 75,
        sequenceNo: 2,
      },
    ],
    createdByUserId: "user-1",
    createdByName: "ผู้ทดสอบ",
    createdByPhone: "",
    clientCreatedAt: "2026-07-27T03:00:00.000Z",
    clientRecordedAt: "2026-07-27T03:00:00.000Z",
    revisionNo: 1,
    recordStatus: "active",
    ...patch,
  };
}

test.describe("sale bill receipt", () => {
  test("renders one authoritative parent and its ordered lines", () => {
    const bill = makeSaleBill();
    expect(getSaleReceiptShareBlockReason(bill, true)).toBeNull();

    const model = buildSaleReceiptModel(bill, location);
    const html = renderSaleReceiptHtml(model);
    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain("2607270001");
    expect(html).toContain("175.00 บาท");
    expect(model.txDateText).toMatch(/27.*07.*2569/);
    expect(html).toContain("ผู้ทดสอบ");
    expect(html).toContain("สินค้า &lt;พิเศษ&gt;");
    expect(html).not.toContain("สินค้า <พิเศษ>");
  });

  test("blocks offline, unsynced, incomplete, and invalid line data", () => {
    expect(getSaleReceiptShareBlockReason(makeSaleBill(), false)).toContain("ออนไลน์");
    expect(getSaleReceiptShareBlockReason(
      makeSaleBill({ syncStatus: "failed", serverBillNo: undefined }),
      true
    )).toContain("ลองซิงก์อีกครั้ง");
    expect(getSaleReceiptShareBlockReason(
      makeSaleBill({ saleLineCount: 2, saleLines: undefined }),
      true
    )).toContain("ไม่ครบ");
    expect(getSaleReceiptShareBlockReason(
      makeSaleBill({
        saleLines: makeSaleBill().saleLines!.map((line, index) => ({
          ...line,
          sequenceNo: index + 2,
        })),
      }),
      true
    )).toContain("ลำดับ");
  });
});
