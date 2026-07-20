export function validateRubberBillDraft(draft: {
  customerName: string;
  weighItems: { inWeight: number; outWeight: number; netWeight: number; price: number }[];
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
    if (item.inWeight <= item.outWeight) {
      errors.push(`รายการชั่งที่ ${index + 1}: น้ำหนักเข้าต้องมากกว่าน้ำหนักออก`);
    }
    if (item.netWeight <= 0) {
      errors.push(`รายการชั่งที่ ${index + 1}: น้ำหนักสุทธิต้องมากกว่า 0`);
    }
    if (item.price <= 0) {
      errors.push(`รายการชั่งที่ ${index + 1}: ราคาต้องมากกว่า 0`);
    }
  });

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
  });

  draft.debtItems.forEach((item, index) => {
    if (!item.title.trim()) {
      errors.push(`รายการหักหนี้ที่ ${index + 1}: ต้องระบุชื่อรายการ`);
    }
    if (item.amount <= 0) {
      errors.push(`รายการหักหนี้ที่ ${index + 1}: จำนวนเงินต้องมากกว่า 0`);
    }
  });

  const hasDeductions = draft.acidItems.length > 0 || draft.debtItems.length > 0;
  if (hasDeductions && draft.netTotal <= 0) {
    errors.push("ยอดเงินสุทธิต้องมากกว่า 0 เมื่อมีการหักหนี้/เบิกของ");
  } else if (draft.netTotal < 0) {
    errors.push("ยอดเงินสุทธิไม่สามารถติดลบได้");
  }

  return errors;
}
