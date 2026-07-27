import { CASH_DENOMINATIONS } from "@/lib/cash-branch-transfer";
import type { CashBranchTransfer } from "@/types";

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

function formatDateTime(value: string | null) {
  if (!value) return "ยังไม่ตรวจรับ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function cashTransferReference(id: string) {
  return `CASH-${id.slice(0, 8).toUpperCase()}`;
}

export function renderCashTransferReceiptHtml(
  transfer: CashBranchTransfer,
  sourceLocationName: string,
) {
  const h = escapeHtml;
  const received = transfer.received;
  const rows = CASH_DENOMINATIONS.map(([key, label, denomination]) => {
    const sentCount = transfer.sent[key];
    const receivedCount = received?.[key];
    return `<tr>
      <td>${h(label)}</td>
      <td class="number">${sentCount}</td>
      <td class="number">${receivedCount ?? "-"}</td>
      <td class="number">${receivedCount == null ? "-" : receivedCount - sentCount}</td>
      <td class="number">${formatNumber(denomination)}</td>
    </tr>`;
  }).join("");
  const reference = cashTransferReference(transfer.id);
  const status = transfer.status === "received" ? "รับเงินแล้ว" : "รอรับเงิน";

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>รายละเอียดเงินสด ${h(reference)}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; width: 80mm; padding: 3mm; color: #000; font: 10px/1.4 Arial, "Noto Sans Thai", sans-serif; overflow-wrap: anywhere; }
h1 { margin: 0; text-align: center; font-size: 18px; }
.center { text-align: center; }
.section { margin-top: 7px; border-top: 1px dashed #000; padding-top: 5px; }
.row { display: flex; justify-content: space-between; gap: 8px; }
.row > :last-child { text-align: right; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th, td { padding: 2px 1px; border-bottom: 1px dotted #777; vertical-align: top; }
th { text-align: left; font-size: 9px; }
.number { text-align: right; white-space: nowrap; }
.total { font-size: 13px; font-weight: 700; }
.footer { margin-top: 9px; border-top: 1px dashed #000; padding-top: 5px; text-align: center; font-size: 9px; }
</style></head><body>
<h1>รายละเอียดเงินสด</h1>
<div class="center">${h(reference)} · ${h(status)}</div>
<div class="section">
  <div class="row"><span>จาก</span><strong>${h(sourceLocationName)}</strong></div>
  <div class="row"><span>ไป</span><strong>${h(transfer.targetLocationName ?? "ไม่ทราบสาขา")}</strong></div>
  <div class="row"><span>ส่งเมื่อ</span><strong>${h(formatDateTime(transfer.sentAt))}</strong></div>
  <div class="row"><span>ผู้ส่ง</span><strong>${h(transfer.createdByName)} · ${h(transfer.createdByPhone)}</strong></div>
</div>
<div class="section">
  <table>
    <thead><tr><th>ชนิด</th><th class="number">ส่ง</th><th class="number">รับ</th><th class="number">ต่าง</th><th class="number">บาท</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<div class="section total">
  <div class="row"><span>ยอดส่ง</span><span>${formatNumber(transfer.sentTotal)} บาท</span></div>
  <div class="row"><span>ยอดรับ</span><span>${transfer.receivedTotal == null ? "-" : `${formatNumber(transfer.receivedTotal)} บาท`}</span></div>
  <div class="row"><span>ผลต่าง</span><span>${transfer.differenceTotal == null ? "-" : `${formatNumber(transfer.differenceTotal)} บาท`}</span></div>
</div>
<div class="section">
  <div class="row"><span>ผู้ตรวจรับ</span><strong>${h(transfer.receivedByName ?? "ยังไม่ตรวจรับ")}${transfer.receivedByPhone ? ` · ${h(transfer.receivedByPhone)}` : ""}</strong></div>
  <div class="row"><span>รับเมื่อ</span><strong>${h(formatDateTime(transfer.receivedAt))}</strong></div>
  ${transfer.note ? `<div>หมายเหตุ: ${h(transfer.note)}</div>` : ""}
</div>
<div class="footer">เอกสารรายละเอียดการโยกเงินสดจากระบบ LanFlow</div>
</body></html>`;
}
