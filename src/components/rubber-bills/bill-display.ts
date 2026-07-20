import { thaiBahtText } from "@/lib/thai-baht-text";
import type { Customer, RubberBill } from "@/types";

export type RubberBillReceiptModel = {
  billNo: string;
  billDate: string;
  customerName: string;
  customerAddress?: string;
  showFscEudr: boolean;
  paymentResponsibility: string;
  weighItems: Array<{
    label: string;
    inWeight: number;
    outWeight: number;
    netWeight: number;
    price: number;
    lineTotal: number;
  }>;
  deductions: Array<{ label: string; amount: number }>;
  weight: number;
  grossTotal: number;
  averagePrice: number;
  deductionTotal: number;
  netTotal: number;
  netTotalText: string;
};

export function formatBillTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("th-TH")} ${date.toLocaleTimeString("th-TH", { hour12: false })}`;
}

export function getDisplayBillNo(bill: RubberBill) {
  return bill.serverBillNo ?? bill.localBillNo ?? bill.billNo;
}

export function getRubberBillPrintBlockReason(
  bill: RubberBill,
  isOnline: boolean,
  isMarkingPrinted = false
) {
  if (bill.billType !== "บิลเครื่องชั่งเล็ก") return "รองรับเฉพาะบิลเครื่องชั่งเล็ก";
  if (bill.recordStatus !== "active") return "พิมพ์ได้เฉพาะบิลที่ยังใช้งาน";
  if (bill.syncStatus !== "synced" || !bill.serverBillNo) return "กรุณารอให้บิลซิงก์และได้รับเลขบิลจากเซิร์ฟเวอร์ก่อน";
  if (!isOnline) return "ต้องออนไลน์เพื่อบันทึกสถานะหลังยืนยันว่าพิมพ์แล้ว";
  if (isMarkingPrinted) return "กำลังบันทึกสถานะการพิมพ์";
  return null;
}

export function resolveReceiptCustomer(bill: RubberBill, customers: Customer[]) {
  if (bill.customerId) return customers.find((customer) => customer.id === bill.customerId);
  const matches = customers.filter((customer) => customer.mainName === bill.customerName);
  return matches.length === 1 ? matches[0] : undefined;
}

export function buildRubberBillReceiptModel(
  bill: RubberBill,
  customer?: Customer
): RubberBillReceiptModel {
  const deductions = [
    ...(bill.acidItems ?? []).map((item) => ({
      label: `${item.name} ${formatReceiptNumber(item.quantity)} ${item.unit}`,
      amount: item.quantity * item.unitPrice
    })),
    ...(bill.debtItems ?? (bill.debtItem ? [bill.debtItem] : [])).map((item) => ({
      label: item.title,
      amount: item.amount
    }))
  ];
  const knownDeduction = deductions.reduce((sum, item) => sum + item.amount, 0);
  const weightDeduction = bill.deductWeight > 0
    ? Math.min(bill.deductionTotal - knownDeduction, bill.deductWeight * bill.price)
    : bill.deductionTotal - knownDeduction;
  if (weightDeduction > 0.005) {
    deductions.push({
      label: bill.deductWeight > 0 ? `หักน้ำหนัก ${formatReceiptNumber(bill.deductWeight)} กก.` : "หักน้ำหนัก/รายการหักเดิม",
      amount: weightDeduction
    });
  }

  return {
    billNo: getDisplayBillNo(bill),
    billDate: bill.billDate,
    customerName: bill.customerName,
    customerAddress: customer?.farms?.[0]?.address || undefined,
    showFscEudr: customer?.fscStatus === "yes",
    paymentResponsibility: bill.customerType,
    weighItems: (bill.weighItems ?? []).map((item) => ({
      label: item.label,
      inWeight: item.inWeight,
      outWeight: item.outWeight,
      netWeight: item.netWeight,
      price: item.price,
      lineTotal: Math.floor(item.netWeight * item.price)
    })),
    weight: bill.weight,
    grossTotal: bill.netTotal + bill.deductionTotal,
    averagePrice: bill.price,
    deductions,
    deductionTotal: bill.deductionTotal,
    netTotal: bill.netTotal,
    netTotalText: thaiBahtText(bill.netTotal)
  };
}

export function escapeReceiptHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatReceiptNumber(value: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(value);
}

export function renderRubberBillReceiptHtml(model: RubberBillReceiptModel) {
  const h = escapeReceiptHtml;
  const n = formatReceiptNumber;
  const weighRows = model.weighItems.length === 0
    ? '<tr><td colspan="6" class="muted">ไม่มีรายการชั่ง</td></tr>'
    : model.weighItems.map((item) => `
      <tr>
        <td>${h(item.label)}</td><td class="num">${n(item.inWeight)}</td><td class="num">${n(item.outWeight)}</td>
        <td class="num">${n(item.netWeight)}</td><td class="num">${n(item.price)}</td><td class="num">${n(item.lineTotal)}</td>
      </tr>`).join("");
  const deductionRows = model.deductions.length === 0
    ? '<div class="row muted"><span>ไม่มีรายการหัก</span><span>0</span></div>'
    : model.deductions.map((item) => `<div class="row"><span>${h(item.label)}</span><span>${n(item.amount)}</span></div>`).join("");

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>บิล ${h(model.billNo)}</title>
<style>
@page { size: 78mm auto; margin: 3mm; }
* { box-sizing: border-box; } body { margin: 0; width: 72mm; color: #000; font: 11px/1.35 Arial, "Noto Sans Thai", sans-serif; }
h1 { margin: 0 0 4px; text-align: center; font-size: 18px; } .center { text-align: center; } .fsc { margin: 4px 0; border: 1px solid #000; padding: 3px; text-align: center; font-weight: 700; }
.meta { margin: 6px 0; } .row { display: flex; justify-content: space-between; gap: 8px; } .row span:first-child { overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; } th, td { border-bottom: 1px solid #777; padding: 2px 1px; text-align: left; } th { font-size: 9px; } .num { text-align: right; } .muted { color: #555; text-align: center; }
.totals { border-top: 1px solid #000; padding-top: 4px; } .grand { margin-top: 4px; border-top: 2px solid #000; padding-top: 4px; font-size: 14px; font-weight: 700; }
.words { margin-top: 5px; text-align: center; font-weight: 700; overflow-wrap: anywhere; } .signature { margin-top: 14px; display: flex; justify-content: space-between; gap: 12px; text-align: center; }
</style></head><body>
<h1>ใบรับซื้อยาง</h1>
${model.showFscEudr ? '<div class="fsc">FSC / EUDR</div>' : ""}
<div class="meta"><div class="row"><span>เลขบิล</span><strong>${h(model.billNo)}</strong></div><div class="row"><span>วันที่</span><span>${h(model.billDate)}</span></div></div>
<div><strong>ลูกค้า:</strong> ${h(model.customerName)}</div>
${model.customerAddress ? `<div><strong>ที่อยู่:</strong> ${h(model.customerAddress)}</div>` : ""}
<div><strong>ผู้รับผิดชอบการจ่าย:</strong> ${h(model.paymentResponsibility)}</div>
<table><thead><tr><th>รายการ</th><th class="num">เข้า</th><th class="num">ออก</th><th class="num">สุทธิ</th><th class="num">ราคา</th><th class="num">รวม</th></tr></thead><tbody>${weighRows}</tbody></table>
<div class="row"><strong>น้ำหนักรวม</strong><strong>${n(model.weight)} กก.</strong></div>
<div class="row"><span>ราคาเฉลี่ย</span><span>${n(model.averagePrice)}</span></div>
<div class="row"><span>มูลค่ายาง</span><span>${n(model.grossTotal)}</span></div>
<div class="totals"><strong>รายการหัก</strong>${deductionRows}<div class="row"><strong>ยอดหักรวม</strong><strong>${n(model.deductionTotal)}</strong></div></div>
<div class="row grand"><span>ยอดสุทธิ</span><span>${n(model.netTotal)} บาท</span></div>
<div class="words">(${h(model.netTotalText)})</div>
<div class="signature"><div>________________<br>ผู้ขาย</div><div>________________<br>ผู้รับซื้อ</div></div>
</body></html>`;
}
