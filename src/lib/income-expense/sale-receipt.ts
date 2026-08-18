import type { IncomeExpense, Location } from "@/types";

export type SaleReceiptModel = {
  branchName: string;
  referenceNo: string;
  txDateText: string;
  createdByName: string;
  lines: Array<{
    title: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  total: number;
};

export function getSaleReceiptShareBlockReason(
  transaction: IncomeExpense | undefined,
  online: boolean,
) {
  if (!online) return "แชร์ PDF บิลขายได้เมื่อออนไลน์";
  if (!transaction || transaction.billOption !== "บิลขาย") return "ไม่พบข้อมูลบิลขาย";
  if (transaction.syncStatus === "failed" || transaction.syncStatus === "conflict") {
    return "บิลขายซิงก์ไม่สำเร็จ กรุณาใช้ปุ่มลองซิงก์อีกครั้ง";
  }
  if (transaction.syncStatus !== "synced" || !transaction.serverBillNo) {
    return "กำลังรอให้บิลขายซิงก์สำเร็จ";
  }
  if (
    !transaction.saleLines
    || transaction.saleLines.length < 1
    || transaction.saleLines.length > 50
    || transaction.saleLines.length !== transaction.saleLineCount
  ) {
    return "ข้อมูลรายการบิลขายไม่ครบ";
  }
  if (
    transaction.saleLines.some((line, index) =>
      line.sequenceNo !== index + 1
      || !Number.isInteger(line.quantity)
      || line.quantity <= 0
      || line.unitPrice < 0
    )
  ) {
    return "ลำดับรายการบิลขายไม่ถูกต้อง";
  }
  return null;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSaleDate(value: string) {
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function buildSaleReceiptModel(
  transaction: IncomeExpense,
  location: Location,
): SaleReceiptModel {
  const lines = (transaction.saleLines ?? []).map((line) => ({
    title: line.title,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    total: line.lineTotal,
  }));
  return {
    branchName: location.name,
    referenceNo: transaction.serverBillNo ?? transaction.localBillNo,
    txDateText: formatSaleDate(transaction.txDate),
    createdByName: transaction.createdByName,
    lines,
    total: transaction.cost,
  };
}

export function renderSaleReceiptHtml(model: SaleReceiptModel) {
  const h = escapeHtml;
  const rows = model.lines.map((line, index) => `
    <tr>
      <td>${index + 1}. ${h(line.title)}</td>
      <td class="number">${formatNumber(line.quantity)}</td>
      <td class="number">${formatNumber(line.unitPrice)}</td>
      <td class="number">${formatNumber(line.total)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>ใบขายสินค้า ${h(model.referenceNo)}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; width: 80mm; padding: 3mm; color: #000; font: 11px/1.4 Arial, "Noto Sans Thai", sans-serif; overflow-wrap: anywhere; }
h1 { margin: 0; text-align: center; font-size: 20px; }
.center { text-align: center; }
.section { margin-top: 7px; border-top: 1px dashed #000; padding-top: 5px; }
.row { display: flex; justify-content: space-between; gap: 8px; }
.row > :last-child { text-align: right; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th, td { padding: 3px 1px; border-bottom: 1px dotted #777; vertical-align: top; }
th { text-align: left; font-size: 10px; }
.number { text-align: right; white-space: nowrap; }
.total { margin-top: 7px; border: 2px solid #000; padding: 6px; font-size: 18px; font-weight: 700; }
.footer { margin-top: 9px; border-top: 1px dashed #000; padding-top: 5px; text-align: center; font-size: 9px; }
</style></head><body>
<h1>ใบขายสินค้า</h1>
<div class="center">${h(model.branchName)}</div>
<div class="section">
  <div class="row"><span>เลขบิล</span><strong>${h(model.referenceNo)}</strong></div>
  <div class="row"><span>วันที่</span><strong>${h(model.txDateText)}</strong></div>
</div>
<div class="section">
  <table>
    <thead><tr><th>รายการ</th><th class="number">จำนวน</th><th class="number">ราคา</th><th class="number">รวม</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<div class="row total"><span>ยอดรวม</span><span>${formatNumber(model.total)} บาท</span></div>
<div class="section"><div class="row"><span>ผู้สร้าง</span><strong>${h(model.createdByName)}</strong></div></div>
<div class="footer">เอกสารภายในจากระบบ LanFlow - ไม่ใช่ใบกำกับภาษี</div>
</body></html>`;
}
