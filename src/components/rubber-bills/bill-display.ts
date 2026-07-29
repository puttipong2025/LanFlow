import { thaiBahtText } from "@/lib/thai-baht-text";
import { multiplyMoneyHalfUp } from "@/lib/rubber-bills/calculations";
import type { RubberBill } from "@/types";

export type RubberBillReceiptModel = {
  receiptKind: "offline" | "synced";
  referenceLabel: "เลขอ้างอิงบนเครื่อง" | "เลขบิล";
  referenceNo: string;
  billDate: string;
  customerName: string;
  payerName: string;
  approvalLabel: string;
  hasZeroPrice: boolean;
  weighItems: Array<{
    label: string;
    inWeight: number;
    outWeight: number;
    netWeight: number;
    price: number;
    lineTotal: number;
  }>;
  deductions: Array<{ label: string; amount: number }>;
  totalWeight: number;
  deductWeight: number;
  netWeight: number;
  rubberValue: number;
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

export function getRubberBillPrintBlockReason(bill: RubberBill) {
  if (bill.billType !== "บิลเครื่องชั่งเล็ก") return "รองรับเฉพาะบิลเครื่องชั่งเล็ก";
  if (bill.recordStatus !== "active") return "พิมพ์ได้เฉพาะบิลที่ยังใช้งาน";
  if (bill.approvalPending) return "บิลนี้ยังรออนุมัติ จึงยังพิมพ์ไม่ได้";
  if (bill.syncStatus === "pending" && bill.serverBillNo) {
    return "บิลที่ซิงก์แล้วกำลังรอบันทึกการเปลี่ยนแปลง";
  }
  if (bill.syncStatus === "failed" || bill.syncStatus === "conflict") {
    return "บิลมีปัญหาการซิงก์ กรุณาแก้ไขก่อนพิมพ์";
  }
  if (bill.syncStatus !== "pending" && bill.syncStatus !== "synced") {
    return "สถานะบิลนี้ยังไม่พร้อมพิมพ์";
  }
  return null;
}

function currentRevisionApprovalLabel(
  bill: RubberBill,
  receiptKind: RubberBillReceiptModel["receiptKind"]
) {
  if (receiptKind === "offline") {
    return bill.configuredPriceSnapshot === null
      ? "ไม่ได้เปิดใช้กฎอนุมัติราคา"
      : "ผ่านการตรวจราคาบนเครื่อง — ไม่ต้องอนุมัติ";
  }
  if (
    bill.approvalState === "approved"
    && bill.approvalRevisionNo === bill.revisionNo
  ) {
    return `อนุมัติแล้ว — ${bill.approvalApprovedByName?.trim() || "ไม่ระบุ"}`;
  }
  return "ไม่ต้องอนุมัติ";
}

export function buildRubberBillReceiptModel(bill: RubberBill): RubberBillReceiptModel {
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

  const receiptKind = bill.syncStatus === "synced" && Boolean(bill.serverBillNo)
    ? "synced"
    : "offline";
  const weighItems = (bill.weighItems ?? []).map((item) => ({
    label: item.label,
    inWeight: item.inWeight,
    outWeight: item.outWeight,
    netWeight: item.netWeight,
    price: item.price,
    lineTotal: multiplyMoneyHalfUp(item.netWeight, item.price)
  }));

  return {
    receiptKind,
    referenceLabel: receiptKind === "synced" ? "เลขบิล" : "เลขอ้างอิงบนเครื่อง",
    referenceNo: receiptKind === "synced"
      ? bill.serverBillNo!
      : bill.localBillNo,
    billDate: bill.billDate,
    customerName: bill.customerName,
    payerName: bill.createdByName?.trim() || "ไม่ระบุ",
    approvalLabel: currentRevisionApprovalLabel(bill, receiptKind),
    hasZeroPrice: weighItems.some((item) => item.price === 0),
    weighItems,
    totalWeight: bill.weight,
    deductWeight: bill.deductWeight,
    netWeight: bill.netWeight,
    rubberValue: bill.rubberValue,
    averagePrice: bill.price,
    deductions,
    deductionTotal: bill.deductionTotal,
    netTotal: bill.netTotal,
    netTotalText: thaiBahtText(bill.netTotal)
  };
}

export function resolveRubberBillReceiptForPrint(
  bill: RubberBill,
  snapshot: { revisionNo: number; receipt: RubberBillReceiptModel } | null,
  isOnline: boolean
) {
  if (bill.syncStatus !== "synced" || !bill.serverBillNo) {
    return buildRubberBillReceiptModel(bill);
  }
  if (snapshot?.revisionNo === bill.revisionNo) {
    return snapshot.receipt;
  }
  if (!isOnline) {
    throw new Error("ไม่พบสำเนาใบพิมพ์ของบิลนี้ในเครื่อง กรุณาออนไลน์เพื่อโหลดใหม่");
  }
  return buildRubberBillReceiptModel(bill);
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

function formatReceiptWeight(value: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function renderRubberBillReceiptHtml(model: RubberBillReceiptModel) {
  const h = escapeReceiptHtml;
  const n = formatReceiptNumber;
  const weight = formatReceiptWeight;
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
  const title = model.receiptKind === "offline"
    ? "ใบรับซื้อยางออฟไลน์"
    : "ใบรับซื้อยาง";

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>${h(title)} ${h(model.referenceNo)}</title>
<style>
@page { size: 78mm auto; margin: 3mm; }
* { box-sizing: border-box; } body { margin: 0; width: 72mm; color: #000; font: 11px/1.35 Arial, "Noto Sans Thai", sans-serif; }
h1 { margin: 0 0 4px; text-align: center; font-size: 18px; } .warning { margin: 6px 0; border: 3px double #000; padding: 6px 3px; text-align: center; font-size: 14px; font-weight: 800; }
.meta { margin: 6px 0; } .row { display: flex; justify-content: space-between; gap: 8px; } .row span:first-child { overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; } th, td { border-bottom: 1px solid #777; padding: 2px 1px; text-align: left; } th { font-size: 9px; } .num { text-align: right; } .muted { color: #555; text-align: center; }
.totals { border-top: 1px solid #000; padding-top: 4px; }
.payable { margin-top: 5px; border: 2px solid #000; padding: 5px 3px; font-size: 15px; font-weight: 800; }
.words { margin-top: 5px; text-align: center; font-weight: 700; overflow-wrap: anywhere; } .signature { margin-top: 14px; display: flex; justify-content: space-between; gap: 12px; text-align: center; }
.stamp-space { height: 40mm; }
.thank-you { margin: 0 0 3mm; text-align: center; font-weight: 700; }
</style></head><body>
<h1>${h(title)}</h1>
${model.hasZeroPrice ? '<div class="warning">ยังไม่กำหนดราคา — ห้ามจ่าย</div>' : ""}
<div class="meta"><div class="row"><span>${h(model.referenceLabel)}</span><strong>${h(model.referenceNo)}</strong></div><div class="row"><span>วันที่</span><span>${h(model.billDate)}</span></div></div>
<div><strong>ลูกค้า:</strong> ${h(model.customerName)}</div>
<div><strong>ผู้รับผิดชอบการจ่าย:</strong> ${h(model.payerName)}</div>
<div><strong>สถานะอนุมัติ:</strong> ${h(model.approvalLabel)}</div>
<table><thead><tr><th>รายการ</th><th class="num">เข้า</th><th class="num">ออก</th><th class="num">ชั่งสุทธิ</th><th class="num">ราคา</th><th class="num">รวม</th></tr></thead><tbody>${weighRows}</tbody></table>
${model.deductWeight > 0 ? `<div class="row"><span>น้ำหนักรวมก่อนหัก</span><span>${weight(model.totalWeight)} กก.</span></div><div class="row"><span>น้ำหนักหัก</span><span>${weight(model.deductWeight)} กก.</span></div>` : ""}
<div class="row"><strong>น้ำหนักสุทธิ</strong><strong>${weight(model.netWeight)} กก.</strong></div>
<div class="row"><span>ราคาเฉลี่ย</span><span>${n(model.averagePrice)}</span></div>
<div class="row"><span>มูลค่ายาง</span><span>${n(model.rubberValue)}</span></div>
<div class="totals"><strong>รายการหักเงิน</strong>${deductionRows}<div class="row"><strong>ยอดหักเงิน</strong><strong>${n(model.deductionTotal)}</strong></div></div>
<div class="row payable"><span>ยอดที่ต้องจ่ายลูกค้า</span><span>${n(model.netTotal)} บาท</span></div>
<div class="words">(${h(model.netTotalText)})</div>
<div class="signature"><div>________________<br>ผู้ขาย</div><div>________________<br>ผู้รับซื้อ</div></div>
<div class="stamp-space" aria-hidden="true"></div>
<div class="thank-you">ขอบคุณที่ใช้บริการค่ะ</div>
</body></html>`;
}
