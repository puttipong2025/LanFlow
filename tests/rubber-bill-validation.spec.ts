import { expect, test } from "@playwright/test";

import {
  getRubberBillPaymentBlockReason,
  getRubberBillTransferBlockReason,
  isRubberBillPayable,
  validateRubberBillDraft,
} from "../src/lib/rubber-bill-validation";

function draft(price: number) {
  return {
    customerName: "ลูกค้าทดสอบ",
    weighItems: [{
      inWeight: 100,
      outWeight: 20,
      netWeight: 80,
      price,
    }],
    acidItems: [],
    debtItems: [],
    netTotal: Math.max(80 * price, 0),
  };
}

test.describe("Rubber Bill price validation", () => {
  test("allows zero price", () => {
    expect(validateRubberBillDraft(draft(0))).toEqual([]);
  });

  test("rejects negative and more than two decimal places", () => {
    expect(validateRubberBillDraft(draft(-0.01))).toContain(
      "รายการชั่งที่ 1: ราคาต้องไม่ติดลบ"
    );
    expect(validateRubberBillDraft(draft(1.001))).toContain(
      "รายการชั่งที่ 1: ราคาต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง"
    );
  });

  test("blocks payment until every weigh row has a positive price and net total", () => {
    expect(getRubberBillPaymentBlockReason({
      netTotal: 200,
      weighItems: [{ id: "1", label: "ชั่ง1", inWeight: 20, outWeight: 10, netWeight: 10, price: 0 }],
    })).toContain("ราคา");
    expect(getRubberBillPaymentBlockReason({
      netTotal: 200,
      weighItems: [
        { id: "1", label: "ชั่ง1", inWeight: 20, outWeight: 10, netWeight: 10, price: 20 },
        { id: "2", label: "ชั่ง2", inWeight: 20, outWeight: 10, netWeight: 10, price: 0 },
      ],
    })).toContain("ราคา");
    expect(getRubberBillPaymentBlockReason({
      netTotal: 0,
      weighItems: [{ id: "1", label: "ชั่ง1", inWeight: 20, outWeight: 10, netWeight: 10, price: 20 }],
    })).toContain("ยอดสุทธิ");
    expect(isRubberBillPayable({
      netTotal: 200,
      weighItems: [{ id: "1", label: "ชั่ง1", inWeight: 20, outWeight: 10, netWeight: 10, price: 20 }],
    })).toBe(true);
  });

  test("blocks Money Transfer until the payable bill has synced", () => {
    const bill = {
      netTotal: 20,
      weighItems: [{ id: "1", label: "ชั่ง1", inWeight: 2, outWeight: 1, netWeight: 1, price: 20 }],
      syncStatus: "pending" as const,
      serverBillNo: undefined,
    };
    expect(getRubberBillTransferBlockReason(bill)).toContain("ซิงก์");
    expect(getRubberBillTransferBlockReason({
      ...bill,
      syncStatus: "synced",
      serverBillNo: "RB-1",
    })).toBeNull();
  });
});
