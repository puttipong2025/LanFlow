import { hasAtMostTwoDecimalPlaces } from "@/lib/rubber-bills/calculations";

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
    errors.push("ชื่อลูกค้า: กรุณาระบุข้อมูล");
  }

  const activeWeighItems = draft.weighItems;
  if (activeWeighItems.length === 0) {
    errors.push("ชั่งสินค้า: ต้องมีรายการชั่งอย่างน้อย 1 รายการ");
  }

  activeWeighItems.forEach((item, index) => {
    const row = `รายการชั่งที่ ${index + 1}`;
    if (item.inWeight < 0) {
      errors.push(`${row}: น้ำหนักเข้าต้องไม่ติดลบ`);
    }
    if (item.outWeight < 0) {
      errors.push(`${row}: น้ำหนักออกต้องไม่ติดลบ`);
    }
    if (item.inWeight <= item.outWeight) {
      errors.push(`${row}: น้ำหนักเข้าต้องมากกว่าน้ำหนักออก`);
    }
    if (item.netWeight <= 0) {
      errors.push(`${row}: น้ำหนักชั่งสุทธิต้องมากกว่า 0`);
    }
    if (!hasAtMostTwoDecimalPlaces(item.inWeight)) {
      errors.push(`${row}: น้ำหนักเข้าต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
    if (!hasAtMostTwoDecimalPlaces(item.outWeight)) {
      errors.push(`${row}: น้ำหนักออกต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
    if (!hasAtMostTwoDecimalPlaces(item.netWeight)) {
      errors.push(`${row}: น้ำหนักชั่งสุทธิต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
    if (item.price < 0) {
      errors.push(`${row}: ราคาสินค้าต้องไม่ติดลบ`);
    }
    if (Math.abs(item.price * 100 - Math.round(item.price * 100)) > 1e-9) {
      errors.push(`${row}: ราคาสินค้าต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
  });

  if (!hasAtMostTwoDecimalPlaces(draft.deductWeight)) {
    errors.push("หักน้ำหนักยาง (กก.): ต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง");
  }
  if (draft.deductWeight < 0) {
    errors.push("หักน้ำหนักยาง (กก.): ต้องไม่ติดลบ");
  }
  if (draft.totalWeight > 0 && draft.deductWeight >= draft.totalWeight) {
    errors.push("หักน้ำหนักยาง (กก.): ต้องน้อยกว่าน้ำหนักรวม");
  }

  draft.acidItems.forEach((item, index) => {
    const row = `รายการหักสินค้าที่ ${index + 1}`;
    if (!item.name.trim()) {
      errors.push(`${row}: รายการหักต้องระบุชื่อสินค้า`);
    }
    if (!item.stockProductId) {
      errors.push(`${row}: รายการหักต้องเลือกสินค้าในสต็อก`);
    }
    if (item.quantity <= 0) {
      errors.push(`${row}: จำนวนต้องมากกว่า 0`);
    }
    if (item.unitPrice < 0) {
      errors.push(`${row}: ราคาต่อหน่วยต้องไม่ติดลบ`);
    }
    if (!hasAtMostTwoDecimalPlaces(item.quantity)) {
      errors.push(`${row}: จำนวนต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
    if (!hasAtMostTwoDecimalPlaces(item.unitPrice)) {
      errors.push(`${row}: ราคาต่อหน่วยต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
  });

  draft.debtItems.forEach((item, index) => {
    const row = `รายการหักหนี้ที่ ${index + 1}`;
    if (!item.title.trim()) {
      errors.push(`${row}: รายการหนี้ต้องระบุข้อมูล`);
    }
    if (item.amount <= 0) {
      errors.push(`${row}: ยอดเงินต้องมากกว่า 0`);
    }
    if (!hasAtMostTwoDecimalPlaces(item.amount)) {
      errors.push(`${row}: ยอดเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง`);
    }
  });

  if (draft.netTotal < 0) {
    errors.push("ยอดที่ต้องจ่ายลูกค้า (บาท): ต้องไม่ติดลบ");
  }

  return errors;
}
