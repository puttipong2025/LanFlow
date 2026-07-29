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
    deductWeight: 0,
    totalWeight: 80,
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
      "รายการชั่งที่ 1: ราคาสินค้าต้องไม่ติดลบ"
    );
    expect(validateRubberBillDraft(draft(1.001))).toContain(
      "รายการชั่งที่ 1: ราคาสินค้าต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง"
    );
  });

  test("returns every invalid field with its visible label and row number", () => {
    const errors = validateRubberBillDraft({
      customerName: " ",
      weighItems: [{
        inWeight: -20.001,
        outWeight: -10.001,
        netWeight: -10.001,
        price: -1.001,
      }],
      deductWeight: -1.001,
      totalWeight: 10,
      acidItems: [{
        name: "",
        stockProductId: null,
        quantity: -0.001,
        unitPrice: -1.001,
      }],
      debtItems: [{
        title: "",
        amount: -0.001,
      }],
      netTotal: -1,
    });

    expect(errors).toEqual([
      "ชื่อลูกค้า: กรุณาระบุข้อมูล",
      "รายการชั่งที่ 1: น้ำหนักเข้าต้องไม่ติดลบ",
      "รายการชั่งที่ 1: น้ำหนักออกต้องไม่ติดลบ",
      "รายการชั่งที่ 1: น้ำหนักเข้าต้องมากกว่าน้ำหนักออก",
      "รายการชั่งที่ 1: น้ำหนักชั่งสุทธิต้องมากกว่า 0",
      "รายการชั่งที่ 1: น้ำหนักเข้าต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      "รายการชั่งที่ 1: น้ำหนักออกต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      "รายการชั่งที่ 1: น้ำหนักชั่งสุทธิต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      "รายการชั่งที่ 1: ราคาสินค้าต้องไม่ติดลบ",
      "รายการชั่งที่ 1: ราคาสินค้าต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      "หักน้ำหนักยาง (กก.): ต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      "หักน้ำหนักยาง (กก.): ต้องไม่ติดลบ",
      "รายการหักสินค้าที่ 1: รายการหักต้องระบุชื่อสินค้า",
      "รายการหักสินค้าที่ 1: รายการหักต้องเลือกสินค้าในสต็อก",
      "รายการหักสินค้าที่ 1: จำนวนต้องมากกว่า 0",
      "รายการหักสินค้าที่ 1: ราคาต่อหน่วยต้องไม่ติดลบ",
      "รายการหักสินค้าที่ 1: จำนวนต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      "รายการหักสินค้าที่ 1: ราคาต่อหน่วยต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      "รายการหักหนี้ที่ 1: รายการหนี้ต้องระบุข้อมูล",
      "รายการหักหนี้ที่ 1: ยอดเงินต้องมากกว่า 0",
      "รายการหักหนี้ที่ 1: ยอดเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      "ยอดที่ต้องจ่ายลูกค้า (บาท): ต้องไม่ติดลบ",
    ]);
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
