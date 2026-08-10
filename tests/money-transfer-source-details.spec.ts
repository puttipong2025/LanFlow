import { expect, test } from "@playwright/test";

import { buildMoneyTransferSourceDetails } from "../src/lib/money-transfers/source-details";

test.describe("Money transfer source details", () => {
  test("maps mixed sources newest-first and calculates weighted totals", () => {
    const result = buildMoneyTransferSourceDetails({
      items: [
        {
          id: "item-rubber",
          sourceType: "rubber_bill",
          sourceId: "rubber-1",
          customerName: "ลูกค้าบิลยาง",
          amount: 1_200,
        },
        {
          id: "item-ocr",
          sourceType: "ocr_ticket",
          sourceId: "ocr-1",
          customerName: "ลูกค้า OCR",
          amount: 750,
        },
      ],
      rubberBills: [{
        id: "rubber-1",
        billNo: "RB-001",
        netWeight: 95,
        price: 13,
        rubberValue: 1_235,
        deductionTotal: 35,
        netTotal: 1_200,
        serverCreatedAt: "2026-08-10T01:00:00.000Z",
      }],
      ocrTickets: [{
        id: "ocr-1",
        ticketId: "OCR-001",
        weightRemaining: 40,
        totalAmount: 800,
        moneyDeducted: 50,
        createdAt: "2026-08-10T02:00:00.000Z",
      }],
    });

    expect(result.rows.map((row) => row.sourceId)).toEqual(["ocr-1", "rubber-1"]);
    expect(result.rows[0]).toMatchObject({
      sourceLabel: "OCR",
      sourceNumber: "OCR-001",
      netWeight: 40,
      averagePrice: 20,
      rubberValue: 800,
      deductedAmount: 50,
      netPayableAmount: 750,
      isMissing: false,
    });
    expect(result.rows[1]).toMatchObject({
      sourceLabel: "บิลยาง",
      sourceNumber: "RB-001",
      netWeight: 95,
      averagePrice: 13,
      rubberValue: 1_235,
      deductedAmount: 35,
      netPayableAmount: 1_200,
      isMissing: false,
    });
    expect(result.totals).toEqual({
      netWeight: 135,
      averagePrice: 15.07,
      rubberValue: 2_035,
      deductedAmount: 85,
      netPayableAmount: 1_950,
      missingCount: 0,
    });
  });

  test("uses source id as a deterministic newest-first tie-breaker", () => {
    const result = buildMoneyTransferSourceDetails({
      items: [
        { id: "item-a", sourceType: "ocr_ticket", sourceId: "a", customerName: null, amount: 10 },
        { id: "item-z", sourceType: "ocr_ticket", sourceId: "z", customerName: null, amount: 10 },
      ],
      rubberBills: [],
      ocrTickets: [
        { id: "a", ticketId: "A", weightRemaining: 1, totalAmount: 10, moneyDeducted: 0, createdAt: "2026-08-10T02:00:00.000Z" },
        { id: "z", ticketId: "Z", weightRemaining: 1, totalAmount: 10, moneyDeducted: 0, createdAt: "2026-08-10T02:00:00.000Z" },
      ],
    });

    expect(result.rows.map((row) => row.sourceId)).toEqual(["z", "a"]);
  });

  test("keeps the source-id tie-breaker when both timestamps are missing", () => {
    const result = buildMoneyTransferSourceDetails({
      items: [
        { id: "item-a", sourceType: "rubber_bill", sourceId: "a", customerName: null, amount: 10 },
        { id: "item-z", sourceType: "rubber_bill", sourceId: "z", customerName: null, amount: 10 },
      ],
      rubberBills: [],
      ocrTickets: [],
    });

    expect(result.rows.map((row) => row.sourceId)).toEqual(["z", "a"]);
  });

  test("keeps invalid averages and missing sources visible without inventing values", () => {
    const result = buildMoneyTransferSourceDetails({
      items: [
        { id: "item-zero", sourceType: "ocr_ticket", sourceId: "ocr-zero", customerName: null, amount: 100 },
        { id: "item-missing", sourceType: "rubber_bill", sourceId: "missing", customerName: null, amount: 999 },
      ],
      rubberBills: [],
      ocrTickets: [{
        id: "ocr-zero",
        ticketId: null,
        weightRemaining: 0,
        totalAmount: 100,
        moneyDeducted: null,
        createdAt: null,
      }],
    });

    expect(result.rows[0]).toMatchObject({
      sourceId: "ocr-zero",
      sourceNumber: "—",
      averagePrice: null,
      deductedAmount: 0,
      netPayableAmount: 100,
      isMissing: false,
    });
    expect(result.rows[1]).toMatchObject({
      sourceId: "missing",
      sourceNumber: "ไม่พบข้อมูลต้นทาง",
      netWeight: null,
      averagePrice: null,
      rubberValue: null,
      deductedAmount: null,
      netPayableAmount: null,
      isMissing: true,
    });
    expect(result.totals).toEqual({
      netWeight: 0,
      averagePrice: null,
      rubberValue: 100,
      deductedAmount: 0,
      netPayableAmount: 100,
      missingCount: 1,
    });
  });

  test("keeps a missing OCR rubber value and payable amount empty", () => {
    const result = buildMoneyTransferSourceDetails({
      items: [
        { id: "item-null-total", sourceType: "ocr_ticket", sourceId: "ocr-null-total", customerName: null, amount: 0 },
      ],
      rubberBills: [],
      ocrTickets: [{
        id: "ocr-null-total",
        ticketId: "OCR-NULL",
        weightRemaining: 10,
        totalAmount: null,
        moneyDeducted: 5,
        createdAt: null,
      }],
    });

    expect(result.rows[0]).toMatchObject({
      averagePrice: null,
      rubberValue: null,
      deductedAmount: 5,
      netPayableAmount: null,
    });
  });
});
