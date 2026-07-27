import type { RubberBill } from "@/types";
import { hasAtMostTwoDecimalPlaces } from "@/lib/rubber-bills/calculations";

export function getRubberBillPaymentBlockReason(
  bill: Pick<RubberBill, "netTotal" | "weighItems">
) {
  const weighItems = bill.weighItems ?? [];
  if (weighItems.length === 0 || weighItems.some((item) => item.price <= 0)) {
    return "ยังมีรายการราคายาง 0 จึงยังจ่ายเงินไม่ได้";
  }
  if (bill.netTotal <= 0) {
    return "ยอดสุทธิต้องมากกว่า 0 จึงจะจ่ายเงินได้";
  }
  return null;
}

export function isRubberBillPayable(
  bill: Pick<RubberBill, "netTotal" | "weighItems">
) {
  return getRubberBillPaymentBlockReason(bill) === null;
}

export function getRubberBillTransferBlockReason(
  bill: Pick<RubberBill, "netTotal" | "weighItems" | "syncStatus" | "serverBillNo">
) {
  const paymentReason = getRubberBillPaymentBlockReason(bill);
  if (paymentReason) return paymentReason;
  if (bill.syncStatus !== "synced" || !bill.serverBillNo) {
    return "กรุณารอให้บิลซิงก์กับเซิร์ฟเวอร์ก่อนโอนเงิน";
  }
  return null;
}

export function validateRubberBillDraft(draft: {
  customerName: string;
  weighItems: { inWeight: number; outWeight: number; netWeight: number; price: number }[];
  deductWeight: number;
  totalWeight: number;
  acidItems: { name: string; stockProductId?: string | null; quantity: number; unitPrice: number }[];
  debtItems: { title: string; amount: number }[];
  netTotal: number;
}): string[] {
  const errors: string[] = [];

  if (!draft.customerName.trim()) {
    errors.push("กรุณาระบุชื่อลูกค้า");
  }

  const activeWeighItems = draft.weighItems;
  if (activeWeighItems.length === 0) {
    errors.push("ต้องมีรายการชั่งน้ำหนักอย่างน้อย 1 รายการ");
  }

  activeWeighItems.forEach((item, index) => {
    if (item.inWeight < 0 || item.outWeight < 0) {
      errors.push(`รายการชั่งที่ ${index + 1}: น้ำหนักต้องไม่ติดลบ`);
    }
    if (item.inWeight <= item.outWeight) {
      errors.push(`รายการชั่งที่ ${index + 1}: น้ำหนักเข้าต้องมากกว่าน้ำหนักออก`);
    }
    if (item.netWeight <= 0) {
      errors.push(`รายการชั่งที่ ${index + 1}: น้ำหนักสุทธิต้องมากกว่า 0`);
    }
    if (
      !hasAtMostTwoDecimalPlaces(item.inWeight)
      || !hasAtMostTwoDecimalPlaces(item.outWeight)
      || !hasAtMostTwoDecimalPlaces(item.netWeight)
    ) {
      errors.push(`รายการชั่งที่ ${index + 1}: น้ำหนักต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
    if (item.price < 0) {
      errors.push(`รายการชั่งที่ ${index + 1}: ราคาต้องไม่ติดลบ`);
    }
    if (Math.abs(item.price * 100 - Math.round(item.price * 100)) > 1e-9) {
      errors.push(`รายการชั่งที่ ${index + 1}: ราคาต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
  });

  if (!hasAtMostTwoDecimalPlaces(draft.deductWeight)) {
    errors.push("น้ำหนักที่หักต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง");
  }
  if (draft.deductWeight < 0) {
    errors.push("น้ำหนักที่หักต้องไม่ติดลบ");
  }
  if (draft.totalWeight > 0 && draft.deductWeight >= draft.totalWeight) {
    errors.push("น้ำหนักที่หักต้องน้อยกว่าน้ำหนักรวม");
  }

  draft.acidItems.forEach((item, index) => {
    if (!item.name.trim()) {
      errors.push(`รายการหักสินค้าที่ ${index + 1}: ต้องระบุชื่อ`);
    }
    if (!item.stockProductId) {
      errors.push(`รายการหักสินค้าที่ ${index + 1}: ต้องเลือกสินค้าในสต็อก`);
    }
    if (item.quantity <= 0) {
      errors.push(`รายการหักสินค้าที่ ${index + 1}: จำนวนต้องมากกว่า 0`);
    }
    if (item.unitPrice < 0) {
      errors.push(`รายการหักสินค้าที่ ${index + 1}: ราคาต้องไม่ติดลบ`);
    }
    if (
      !hasAtMostTwoDecimalPlaces(item.quantity)
      || !hasAtMostTwoDecimalPlaces(item.unitPrice)
    ) {
      errors.push(`รายการหักสินค้าที่ ${index + 1}: จำนวนและราคาต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
  });

  draft.debtItems.forEach((item, index) => {
    if (!item.title.trim()) {
      errors.push(`รายการหักหนี้ที่ ${index + 1}: ต้องระบุชื่อรายการ`);
    }
    if (item.amount <= 0) {
      errors.push(`รายการหักหนี้ที่ ${index + 1}: จำนวนเงินต้องมากกว่า 0`);
    }
    if (!hasAtMostTwoDecimalPlaces(item.amount)) {
      errors.push(`รายการหักหนี้ที่ ${index + 1}: จำนวนเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
  });

  if (draft.netTotal < 0) {
    errors.push("ยอดเงินสุทธิไม่สามารถติดลบได้");
  }

  return errors;
}
