import { expect, test } from "@playwright/test";

import { buildMoneyTransferSourceDetails } from "../src/lib/money-transfers/source-details";

test("builds Rubber Bill source details and weighted totals", () => {
  const result = buildMoneyTransferSourceDetails({
    items: [
      { id: "item-1", sourceType: "rubber_bill", sourceId: "bill-1", customerName: "A", amount: 900 },
      { id: "item-2", sourceType: "rubber_bill", sourceId: "bill-2", customerName: "B", amount: 400 },
    ],
    rubberBills: [
      { id: "bill-1", billNo: "RB-1", netWeight: 100, price: 10, rubberValue: 1_000, deductionTotal: 100, netTotal: 900, serverCreatedAt: "2026-08-24T02:00:00Z" },
      { id: "bill-2", billNo: "RB-2", netWeight: 50, price: 9, rubberValue: 450, deductionTotal: 50, netTotal: 400, serverCreatedAt: "2026-08-24T01:00:00Z" },
    ],
  });

  expect(result.rows.map((row) => row.sourceNumber)).toEqual(["RB-1", "RB-2"]);
  expect(result.totals).toEqual({
    netWeight: 150,
    averagePrice: 9.67,
    rubberValue: 1_450,
    deductedAmount: 150,
    netPayableAmount: 1_300,
    missingCount: 0,
  });
});

test("keeps a visible missing-source row", () => {
  const result = buildMoneyTransferSourceDetails({
    items: [
      { id: "item-1", sourceType: "rubber_bill", sourceId: "missing", customerName: null, amount: 0 },
    ],
    rubberBills: [],
  });
  expect(result.rows[0]).toMatchObject({
    sourceType: "rubber_bill",
    sourceLabel: "บิลยาง",
    sourceNumber: "ไม่พบข้อมูลต้นทาง",
    isMissing: true,
  });
  expect(result.totals.missingCount).toBe(1);
});
