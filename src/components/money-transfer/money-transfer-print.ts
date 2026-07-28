import type { Location, MoneyTransfer, MoneyTransferItem, MoneyTransferSlip } from "@/types";

const PRINTABLE_STATUSES = new Set<MoneyTransfer["transferStatus"]>([
  "paid",
  "overpaid",
  "branch_and_transfer",
  "advance_payment",
]);

const STATUS_LABELS: Record<MoneyTransfer["transferStatus"], string> = {
  pending: "รอโอน",
  paid: "จ่ายครบ",
  partial: "ค้างจ่าย",
  overpaid: "ชำระเกิน",
  branch_and_transfer: "โอน + สาขาจ่าย",
  advance_payment: "จ่ายล่วงหน้า",
  cancelled: "ยกเลิก",
};

const TYPE_LABELS: Record<MoneyTransfer["transferType"], string> = {
  customer: "โอนให้ลูกค้า",
  transport: "จ่ายค่าขนส่ง",
  branch: "โอนให้สาขา",
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type MoneyTransferReceiptSlip = MoneyTransferSlip & {
  transactionDateText: string;
};

export type MoneyTransferReceiptItem = MoneyTransferItem & {
  sourceLabel: string;
  shortSourceId: string;
};

export type MoneyTransferReceiptModel = {
  shortId: string;
  typeLabel: string;
  statusLabel: string;
  isUnfinished: boolean;
  createdAtText: string;
  sourceLocationName: string;
  targetLocationName: string | null;
  recipientName: string;
  bankName: string | null;
  accountName: string | null;
  accountNumber: string | null;
  primaryAmount: number;
  primaryAmountLabel: string;
  slipTotal: number;
  feeTotal: number;
  sourceItemTotal: number;
  branchPaidAmount: number;
  difference: number;
  createdByName: string;
  createdByPhone: string | null;
  slips: MoneyTransferReceiptSlip[];
  items: MoneyTransferReceiptItem[];
};

export function getMoneyTransferPrintBlockReason(transfer: MoneyTransfer) {
  return PRINTABLE_STATUSES.has(transfer.transferStatus)
    ? null
    : "แชร์ PDF ได้เมื่อจ่ายเสร็จสิ้น";
}

export function shortTransferId(id: string) {
  return id.replaceAll("-", "").slice(0, 8).toUpperCase();
}

function formatBangkokDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : `${DATE_TIME_FORMATTER.format(date)} น.`;
}

function locationName(locations: Location[], id?: string | null) {
  return locations.find((location) => location.id === id)?.name ?? "ไม่ระบุสาขา";
}

export function buildMoneyTransferReceiptModel(
  transfer: MoneyTransfer,
  locations: Location[],
): MoneyTransferReceiptModel {
  const slips = [...(transfer.slips ?? [])]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .map((slip) => ({
      ...slip,
      transactionDateText: formatBangkokDateTime(slip.transactionDate),
    }));
  const items = (transfer.items ?? []).map((item) => ({
    ...item,
    sourceLabel: item.sourceType === "rubber_bill" ? "บิลยาง" : "ใบชั่ง OCR",
    shortSourceId: shortTransferId(item.sourceId),
  }));
  const slipTotal = slips.reduce((sum, slip) => sum + slip.amount, 0);
  const feeTotal = slips.reduce((sum, slip) => sum + slip.fee, 0);
  const sourceItemTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const branchPaidAmount = transfer.branchPaidAmount ?? 0;
  const isImplicitHeadOffice = transfer.transferType === "branch"
    && Boolean(transfer.targetLocationId)
    && transfer.locationId === transfer.targetLocationId;
  const sourceLocationName = isImplicitHeadOffice
    ? "สำนักงานใหญ่"
    : locationName(locations, transfer.locationId);
  const targetLocationName = transfer.transferType === "branch"
    ? transfer.targetLocationName ?? locationName(locations, transfer.targetLocationId)
    : null;
  const primaryAmount = transfer.transferStatus === "advance_payment"
    ? slipTotal
    : transfer.netAmountToPay;

  return {
    shortId: shortTransferId(transfer.id),
    typeLabel: TYPE_LABELS[transfer.transferType],
    statusLabel: STATUS_LABELS[transfer.transferStatus],
    isUnfinished: transfer.transferStatus === "advance_payment",
    createdAtText: formatBangkokDateTime(transfer.createdAt),
    sourceLocationName,
    targetLocationName,
    recipientName: transfer.customerName
      ?? transfer.transportStaffName
      ?? transfer.targetLocationName
      ?? "ไม่ระบุผู้รับ",
    bankName: transfer.bankName,
    accountName: transfer.accountName,
    accountNumber: transfer.accountNumber,
    primaryAmount,
    primaryAmountLabel: transfer.transferStatus === "advance_payment"
      ? "ยอดจ่ายล่วงหน้า"
      : "ยอดที่ต้องจ่าย",
    slipTotal,
    feeTotal,
    sourceItemTotal,
    branchPaidAmount,
    difference: slipTotal + branchPaidAmount - transfer.netAmountToPay,
    createdByName: transfer.createdByName ?? "ไม่ระบุ",
    createdByPhone: transfer.createdByPhone ?? null,
    slips,
    items,
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatWholeMoney(value: number) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatWeight(value: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function renderMoneyTransferReceiptHtml(model: MoneyTransferReceiptModel) {
  const h = escapeHtml;
  const money = formatMoney;
  const accountRows = [
    model.bankName && `<div class="row"><span>ธนาคาร</span><strong>${h(model.bankName)}</strong></div>`,
    model.accountName && `<div class="row"><span>ชื่อบัญชี</span><strong>${h(model.accountName)}</strong></div>`,
    model.accountNumber && `<div class="row"><span>เลขบัญชี</span><strong>${h(model.accountNumber)}</strong></div>`,
  ].filter(Boolean).join("");
  const itemRows = model.items.length === 0
    ? '<div class="muted">ไม่มีรายการบิล/ใบชั่งต้นทาง</div>'
    : model.items.map((item, index) => {
      const deductionLabel = "ยอดหักเงิน (บาท)";
      return `
        <div class="entry">
          <div class="row"><strong>${index + 1}. ${h(item.sourceLabel)} #${h(item.shortSourceId)}</strong><strong>${money(item.amount)}</strong></div>
          <div class="small">${h(item.customerName ?? "ไม่ระบุชื่อลูกค้า")}</div>
          ${item.netWeightAfterDeduction == null ? "" : `<div class="row small"><span>น้ำหนักสุทธิ (กก.)</span><span>${formatWeight(item.netWeightAfterDeduction)}</span></div>`}
          ${item.deductedAmount != null && item.deductedAmount > 0 ? `<div class="row small"><span>${deductionLabel}</span><span>${money(item.deductedAmount)}</span></div>` : ""}
          ${item.netPayableAmount == null ? "" : `<div class="row small"><span>ยอดสุทธิที่ต้องจ่ายลูกค้า (บาท)</span><span>${item.sourceType === "rubber_bill" ? formatWholeMoney(item.netPayableAmount) : money(item.netPayableAmount)}</span></div>`}
        </div>`;
    }).join("");
  const slipRows = model.slips.length === 0
    ? '<div class="muted">ไม่มีสลิป</div>'
    : model.slips.map((slip, index) => `
      <div class="entry">
        <div class="row"><strong>สลิป ${index + 1}</strong><strong>${money(slip.amount)}</strong></div>
        <div class="small">วันที่ ${h(slip.transactionDateText)}</div>
        <div class="small">อ้างอิง ${h(slip.referenceNumber ?? "—")}</div>
        <div class="small">ผู้จ่าย ${h(slip.senderName ?? "—")}</div>
        <div class="small">ผู้รับ ${h(slip.receiverName ?? "—")}</div>
        <div class="row small"><span>ค่าธรรมเนียม</span><span>${money(slip.fee)}</span></div>
      </div>`).join("");

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>ใบรายการโอนเงิน ${h(model.shortId)}</title>
<style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; width: 80mm; padding: 3mm; color: #000; font: 11px/1.4 Arial, "Noto Sans Thai", sans-serif; overflow-wrap: anywhere; }
h1 { margin: 0; text-align: center; font-size: 18px; }
.center { text-align: center; }
.status { display: inline-block; margin: 5px 0; border: 1.5px solid #000; padding: 2px 8px; font-size: 13px; font-weight: 700; }
.warning { margin: 5px 0; border: 2px solid #000; padding: 4px; text-align: center; font-weight: 800; }
.section { margin-top: 7px; border-top: 1px dashed #000; padding-top: 5px; }
.section-title { margin-bottom: 3px; font-size: 12px; font-weight: 700; }
.row { display: flex; justify-content: space-between; gap: 8px; }
.row > :last-child { text-align: right; }
.amount { margin: 7px 0; border: 2px solid #000; padding: 6px; text-align: center; }
.amount strong { display: block; font-size: 22px; line-height: 1.2; }
.entry { margin-top: 4px; border-bottom: 1px dotted #777; padding-bottom: 4px; }
.small { font-size: 10px; }
.muted { color: #555; text-align: center; }
.footer { margin-top: 9px; border-top: 1px dashed #000; padding-top: 5px; text-align: center; font-size: 9px; }
</style></head><body>
<h1>ใบรายการโอนเงิน</h1>
<div class="center">รหัสรายการ ${h(model.shortId)}</div>
<div class="center"><span class="status">${h(model.statusLabel)}</span></div>
${model.isUnfinished ? '<div class="warning">รายการยังไม่สิ้นสุด</div>' : ""}
<div class="row"><span>ประเภท</span><strong>${h(model.typeLabel)}</strong></div>
<div class="row"><span>วันที่สร้าง</span><strong>${h(model.createdAtText)}</strong></div>
<div class="section">
  <div class="row"><span>ต้นทาง</span><strong>${h(model.sourceLocationName)}</strong></div>
  ${model.targetLocationName ? `<div class="row"><span>ปลายทาง</span><strong>${h(model.targetLocationName)}</strong></div>` : ""}
  <div class="row"><span>ผู้รับ</span><strong>${h(model.recipientName)}</strong></div>
  ${accountRows}
</div>
<div class="amount"><span>${h(model.primaryAmountLabel)}</span><strong>${money(model.primaryAmount)} บาท</strong></div>
<div class="row"><span>ยอดสลิปรวม</span><strong>${money(model.slipTotal)}</strong></div>
<div class="row"><span>ค่าธรรมเนียมรวม</span><strong>${money(model.feeTotal)}</strong></div>
${model.items.length > 0 ? `<div class="row"><span>ยอดรายการต้นทางรวม</span><strong>${money(model.sourceItemTotal)}</strong></div>` : ""}
${model.branchPaidAmount > 0 ? `<div class="row"><span>สาขาจ่าย</span><strong>${money(model.branchPaidAmount)}</strong></div>` : ""}
<div class="row"><span>ส่วนต่าง</span><strong>${money(model.difference)}</strong></div>
<div class="section"><div class="section-title">รายการบิล/ใบชั่งต้นทาง (${model.items.length})</div>${itemRows}</div>
<div class="section"><div class="section-title">สลิปประกอบรายการ (${model.slips.length})</div>${slipRows}</div>
<div class="section">
  <div class="row"><span>ผู้สร้าง</span><strong>${h(model.createdByName)}</strong></div>
  ${model.createdByPhone ? `<div class="row"><span>โทรศัพท์</span><strong>${h(model.createdByPhone)}</strong></div>` : ""}
</div>
<div class="footer">เอกสารนี้สร้างจากข้อมูลรายการโอนเงินในระบบ LanFlow</div>
</body></html>`;
}
