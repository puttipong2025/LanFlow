import { expect, test } from "@playwright/test";

import {
  buildSaleReceiptGroups,
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

function makeLine(patch: Partial<IncomeExpense> = {}): IncomeExpense {
  return {
    id: "line-1",
    clientTempId: "line-1",
    localBillNo: "LOCAL-1",
    serverBillNo: "2607270001",
    syncStatus: "synced",
    idempotencyKey: "create:line-1:0",
    locationId: location.id,
    type: "income",
    number: "2607270001",
    txDate: "2026-07-27",
    title: "น้ำกรด",
    cost: 100,
    billOption: "บิลขาย",
    unit: "2",
    price: 50,
    stockQuantity: 2,
    saleGroupId: "11111111-1111-4111-8111-111111111111",
    saleLineOrder: 1,
    saleExpectedLines: 2,
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

test.describe("sale receipt grouping", () => {
  test("groups and orders synced sale lines for one 80mm receipt", () => {
    const second = makeLine({
      id: "line-2",
      clientTempId: "line-2",
      localBillNo: "LOCAL-2",
      serverBillNo: "2607270002",
      title: "สินค้า <พิเศษ>",
      cost: 999,
      unit: "3",
      stockQuantity: 3,
      price: 25,
      saleLineOrder: 2,
    });
    const group = buildSaleReceiptGroups([second, makeLine()]).values().next().value;

    expect(group?.leaderId).toBe("line-1");
    expect(group?.lines.map((line) => line.id)).toEqual(["line-1", "line-2"]);
    expect(getSaleReceiptShareBlockReason(group, true)).toBeNull();

    const model = buildSaleReceiptModel(group!, location);
    const html = renderSaleReceiptHtml(model);
    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain("ใบขายสินค้า");
    expect(html).toContain("2607270001");
    expect(html).toContain("175.00 บาท");
    expect(model.txDateText).toMatch(/27.*07.*2569/);
    expect(html).toContain("ผู้ทดสอบ");
    expect(html).toContain("สินค้า &lt;พิเศษ&gt;");
    expect(html).not.toContain("สินค้า <พิเศษ>");
    expect(html).not.toContain("ใบกำกับภาษี</h1>");
  });

  test("blocks incomplete, failed, and offline groups", () => {
    const incomplete = buildSaleReceiptGroups([makeLine()]).values().next().value;
    expect(getSaleReceiptShareBlockReason(incomplete, true)).toContain("ครบ 2 รายการ");
    expect(getSaleReceiptShareBlockReason(incomplete, false)).toContain("ออนไลน์");

    const failed = buildSaleReceiptGroups([
      makeLine({ saleExpectedLines: 1, syncStatus: "failed", serverBillNo: undefined }),
    ]).values().next().value;
    expect(getSaleReceiptShareBlockReason(failed, true)).toContain("ลองซิงก์อีกครั้ง");

    const inconsistent = buildSaleReceiptGroups([
      makeLine(),
      makeLine({
        id: "line-2",
        clientTempId: "line-2",
        saleLineOrder: 2,
        saleExpectedLines: 1,
      }),
    ]).values().next().value;
    expect(getSaleReceiptShareBlockReason(inconsistent, true)).toContain("ไม่สอดคล้อง");
  });

  test("uses the first remaining line as leader after a deletion leaves an order gap", () => {
    const remaining = makeLine({
      id: "line-2",
      clientTempId: "line-2",
      saleLineOrder: 2,
      saleExpectedLines: 1,
    });
    const group = buildSaleReceiptGroups([remaining]).values().next().value;

    expect(group?.leaderId).toBe("line-2");
    expect(getSaleReceiptShareBlockReason(group, true)).toBeNull();
  });

  test("treats an ungrouped historical sale as a single-line fallback", () => {
    const transaction = makeLine({
      saleGroupId: null,
      saleLineOrder: null,
      saleExpectedLines: null,
    });
    const group = buildSaleReceiptGroups([transaction]).values().next().value;

    expect(group?.expectedLines).toBe(1);
    expect(getSaleReceiptShareBlockReason(group, true)).toBeNull();
  });
});
