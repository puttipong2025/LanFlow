import { calculateTimeSegmentPaidDays, type PaidWorkSegment } from "@/lib/time-tracking/pay";
import { formatDailyWage, formatPayrollMoney } from "@/lib/time-tracking/format";

type SlipDocumentStatus = "PENDING" | "APPROVED";
type SlipDocumentKind = "withdrawal" | "payroll";

type SlipCalendarDay = {
  date: string;
  day: number;
  paidDays: number;
};

export type SlipDocumentRow = {
  id: string;
  dateLabel: string | null;
  label: string;
  description: string | null;
  amount: number;
};

export type TimePayrollSlipDocument = {
  kind: SlipDocumentKind;
  sourceId: string;
  title: string;
  status: SlipDocumentStatus;
  statusLabel: string;
  employeeName: string;
  amount: number | null;
  month: string;
  effectiveDate: string | null;
  createdAt: string;
  generatedAt: string;
  description: string | null;
  approverName: string | null;
  creatorName?: string | null;
  approvedAt: string | null;
  paymentLabel: string | null;
  adminComment: string | null;
  summary: Array<{ label: string; value: string }>;
  workSummary?: Array<{ label: string; value: string }>;
  calendar: SlipCalendarDay[];
  sourceRows: SlipDocumentRow[];
  notice: string;
  filename: string;
};

type SlipDocumentDetailRow = {
  label: string;
  value: string;
};

type ApprovalFields = {
  history_creator_name?: string | null;
  approved_at?: string | null;
  approver_name?: string | null;
  payment_label?: string | null;
  admin_comment?: string | null;
};

type WithdrawalSource = ApprovalFields & {
  id: string;
  status: SlipDocumentStatus;
  amount: number;
  remaining_amount: number;
  effective_date: string;
  created_at: string;
  description?: string | null;
};

type SnapshotTransaction = {
  id: string;
  type: string;
  status: string;
  amount: number | string;
  description?: string | null;
  effective_date?: string | null;
  applied_month?: string | null;
  source_effective_date?: string | null;
  created_at?: string | null;
  carried_forward?: boolean;
  cancelled_at?: string | null;
};

type AttendanceSnapshot = {
  month: string;
  workdayEndTime: string;
  eligibleThrough?: string;
  periods: Array<{ id?: string; startOn: string; endOn: string | null }>;
  exceptions: Array<{ date: string; status: "HALF_DAY" | "OFF" }>;
  summary: {
    fullDays: number;
    halfDays: number;
    offDays: number;
    paidDays: number;
    grossPay: number;
  };
};

type OutstandingAdjustmentsSnapshot = {
  beforeDeductions: number;
  deductedThisSlip: number;
  remainingAfterDeductions: number;
};

type PayrollSource = ApprovalFields & {
  id: string;
  month: string;
  status: SlipDocumentStatus;
  total_days: number;
  daily_wage: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  created_at: string;
  slip_data: {
    segments?: PaidWorkSegment[] | null;
    transactions?: SnapshotTransaction[] | null;
    attendance?: AttendanceSnapshot | null;
    outstandingAdjustments?: OutstandingAdjustmentsSnapshot | null;
    outstandingSources?: SnapshotTransaction[] | null;
  } | null;
};

const statusLabels: Record<SlipDocumentStatus, string> = {
  PENDING: "รออนุมัติ",
  APPROVED: "อนุมัติแล้ว",
};

const numberFormatter = new Intl.NumberFormat("th-TH", {
  maximumFractionDigits: 2,
});
const documentDateFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "medium",
  timeStyle: "short",
});
const documentDayFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "medium",
});

function formatMoney(value: number) {
  return `${numberFormatter.format(Number(value) || 0)} บาท`;
}

function formatDailyWageMoney(value: number) {
  return `${formatDailyWage(value)} บาท`;
}

function formatPayrollMoneyValue(value: number) {
  return `${formatPayrollMoney(value)} บาท`;
}

function formatDays(value: number) {
  return `${numberFormatter.format(Number(value) || 0)} วัน`;
}

function formatDocumentDate(value: string | null) {
  return value ? documentDateFormatter.format(new Date(value)) : "-";
}

function formatTransactionDate(value: string | null) {
  if (!value) return null;
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00+07:00`
    : value;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? documentDayFormatter.format(date) : value;
}

export function buildSlipDocumentDetailRows(
  document: TimePayrollSlipDocument,
): SlipDocumentDetailRow[] {
  return [
    { label: "ชื่อพนักงาน", value: document.employeeName },
    { label: "เดือน", value: document.month },
    ...(document.amount == null ? [] : [{ label: "ยอดเบิก", value: formatMoney(document.amount) }]),
    ...(document.effectiveDate ? [{
      label: "วันที่รายการ",
      value: formatDocumentDate(`${document.effectiveDate}T00:00:00+07:00`),
    }] : []),
    { label: "วันที่สร้างคำขอ/สลิป", value: formatDocumentDate(document.createdAt) },
    ...(document.description ? [{ label: "รายละเอียด", value: document.description }] : []),
    { label: "รหัสอ้างอิง", value: document.sourceId },
    { label: "ผู้สร้างรายการ", value: document.creatorName || "ไม่ทราบผู้สร้างรายการ" },
    ...(document.approverName ? [{ label: "ผู้อนุมัติ", value: document.approverName }] : []),
    ...(document.approvedAt ? [{ label: "วันที่อนุมัติ", value: formatDocumentDate(document.approvedAt) }] : []),
    ...(document.paymentLabel ? [{ label: "วิธีจ่าย", value: document.paymentLabel }] : []),
    ...(document.adminComment ? [{ label: "หมายเหตุผู้อนุมัติ", value: document.adminComment }] : []),
    { label: "สร้างเอกสารเมื่อ", value: formatDocumentDate(document.generatedAt) },
  ];
}

function bangkokDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoDate));
}

function calendarForMonth(month: string, segments: PaidWorkSegment[] | null | undefined) {
  const paidDaysByDate = new Map<string, number>();
  for (const segment of segments || []) {
    if (!segment.end_time) continue;
    const date = bangkokDate(segment.start_time);
    if (!date.startsWith(`${month}-`)) continue;
    paidDaysByDate.set(
      date,
      (paidDaysByDate.get(date) || 0) + calculateTimeSegmentPaidDays(segment),
    );
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    return { date, day, paidDays: paidDaysByDate.get(date) || 0 };
  });
}

function calendarForAttendance(attendance: AttendanceSnapshot) {
  const exceptionsByDate = new Map(attendance.exceptions.map((exception) => [exception.date, exception.status]));
  const isActiveDate = (date: string) => attendance.periods.some((period) => (
    date >= period.startOn && (period.endOn == null || date <= period.endOn)
  ));
  const [year, monthNumber] = attendance.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${attendance.month}-${String(day).padStart(2, "0")}`;
    const eligible = attendance.eligibleThrough == null || date <= attendance.eligibleThrough;
    const exception = exceptionsByDate.get(date);
    const paidDays = !isActiveDate(date) || !eligible
      ? 0
      : exception === "HALF_DAY"
        ? 0.5
        : exception === "OFF"
          ? 0
          : 1;

    return { date, day, paidDays };
  });
}

function filenameDate(date: string) {
  return date.slice(0, 10).replaceAll("-", "");
}

function readTransactionSnapshot(value: unknown): SnapshotTransaction[] | null {
  if (!Array.isArray(value) || !value.every((row) => (
    row && typeof row === "object"
    && typeof row.id === "string" && typeof row.type === "string" && typeof row.status === "string"
    && (typeof row.amount === "number" || (typeof row.amount === "string" && row.amount.trim() !== ""))
    && Number.isFinite(Number(row.amount)) && Number(row.amount) >= 0
    && ["description", "effective_date", "source_effective_date", "applied_month", "created_at", "cancelled_at"]
      .every((key) => row[key] == null || typeof row[key] === "string")
    && (row.carried_forward == null || typeof row.carried_forward === "boolean")
  ))) return null;
  return value;
}

export function getSlipCalendarFirstWeekday(month: string) {
  // This is a calendar date, not an instant to convert to the device timezone.
  return new Date(`${month}-01T00:00:00Z`).getUTCDay();
}

function transactionRow(transaction: SnapshotTransaction): SlipDocumentRow {
  const date = transaction.source_effective_date
    || transaction.effective_date
    || transaction.applied_month
    || transaction.created_at
    || null;
  return {
    id: transaction.id,
    dateLabel: formatTransactionDate(date),
    label: transaction.carried_forward
      ? transaction.type === "DEBT" ? "หนี้ยกมา" : "เงินเบิกยกมา"
      : transaction.type === "DEBT" ? "หนี้" : "เบิกเงิน",
    description: transaction.description || null,
    amount: Number(transaction.amount) || 0,
  };
}

export function canCreateSlipDocument(status: string, cancelledAt: string | null | undefined) {
  return cancelledAt == null && (status === "PENDING" || status === "APPROVED");
}

export function buildWithdrawalSlipDocument({
  source,
  employeeName,
  dailyWage,
  totalPaidDays,
  existingDeductions,
  segments,
  attendance,
  generatedAt,
}: {
  source: WithdrawalSource;
  employeeName: string;
  dailyWage: number;
  totalPaidDays: number;
  existingDeductions: number;
  segments: PaidWorkSegment[];
  attendance?: AttendanceSnapshot | null;
  generatedAt: string;
}): TimePayrollSlipDocument {
  const grossWage = Math.max(Math.trunc(totalPaidDays * dailyWage * 100) / 100, 0);
  const availableWage = Math.max(grossWage - existingDeductions, 0);
  const wageRemaining = source.status === "PENDING"
    ? Math.max(availableWage - source.amount, 0)
    : availableWage;
  const outstanding = source.status === "PENDING"
    ? Math.max(source.amount - availableWage, 0)
    : Math.max(Number(source.remaining_amount) || 0, 0);
  const month = source.effective_date.slice(0, 7);
  const statusLabel = statusLabels[source.status];

  return {
    kind: "withdrawal",
    sourceId: source.id,
    title: "สลิปเบิกเงิน",
    status: source.status,
    statusLabel,
    employeeName,
    amount: Number(source.amount) || 0,
    month,
    effectiveDate: source.effective_date,
    createdAt: source.created_at,
    generatedAt,
    description: source.description || null,
    creatorName: source.history_creator_name?.trim() || "ไม่ทราบผู้สร้างรายการ",
    approverName: source.approver_name || null,
    approvedAt: source.approved_at || null,
    paymentLabel: source.payment_label || null,
    adminComment: source.admin_comment || null,
    summary: [
      { label: "วันทำงานสะสม", value: formatDays(totalPaidDays) },
      { label: "ค่าแรงสะสม", value: formatMoney(grossWage) },
      { label: "ค่าแรงคงเหลือหลังเบิก", value: formatMoney(wageRemaining) },
      { label: "ยอดเบิกที่ยังหักไม่หมด", value: formatMoney(outstanding) },
    ],
    calendar: attendance ? calendarForAttendance(attendance) : calendarForMonth(month, segments),
    sourceRows: [],
    notice: source.status === "PENDING"
      ? "ประมาณการหากอนุมัติ โดยคำนวณจากข้อมูลปัจจุบันในระบบ เอกสารนี้รับรองสถานะคำขอ ไม่ใช่หลักฐานการรับเงิน"
      : "เอกสารนี้รับรองสถานะคำขอ ไม่ใช่หลักฐานการรับเงิน",
    filename: `LanFlow-เบิกเงิน-${filenameDate(source.effective_date)}-${source.id.slice(0, 8)}-${statusLabel}-80mm.pdf`,
  };
}

export function buildPayrollSlipDocument({
  source,
  employeeName,
  generatedAt,
}: {
  source: PayrollSource;
  employeeName: string;
  generatedAt: string;
}): TimePayrollSlipDocument {
  const statusLabel = statusLabels[source.status];
  const attendance = source.slip_data?.attendance;
  const outstanding = source.slip_data?.outstandingAdjustments ?? {
    beforeDeductions: source.total_deductions,
    remainingAfterDeductions: 0,
  };
  // New snapshots include each source's balance before this month's deductions,
  // including carried balances. Legacy snapshots retain their saved source rows.
  const sources = readTransactionSnapshot(source.slip_data?.outstandingSources)
    ?? readTransactionSnapshot(source.slip_data?.transactions) ?? [];
  const sourceRows = sources
    .filter((transaction) => transaction.status === "APPROVED"
      && (transaction.type === "DEBT" || transaction.type === "WITHDRAWAL")
      && (transaction.cancelled_at == null
        || new Date(transaction.cancelled_at).getTime() > new Date(source.created_at).getTime()))
    .map(transactionRow);
  const hasAdjustments = sourceRows.length > 0 || Number(outstanding.beforeDeductions) > 0
    || Number(source.total_deductions) > 0 || Number(outstanding.remainingAfterDeductions) > 0;

  return {
    kind: "payroll",
    sourceId: source.id,
    title: "สลิปเงินเดือน",
    status: source.status,
    statusLabel,
    employeeName,
    amount: null,
    month: source.month,
    effectiveDate: null,
    createdAt: source.created_at,
    generatedAt,
    description: null,
    creatorName: source.history_creator_name?.trim() || "ไม่ทราบผู้สร้างรายการ",
    approverName: source.approver_name || null,
    approvedAt: source.approved_at || null,
    paymentLabel: source.payment_label || null,
    adminComment: source.admin_comment || null,
    workSummary: [
      ...(attendance ? [
        { label: "วันเต็ม", value: formatDays(attendance.summary.fullDays) },
        { label: "ครึ่งวัน", value: formatDays(attendance.summary.halfDays) },
        { label: "วันหยุด", value: formatDays(attendance.summary.offDays) },
      ] : []),
      { label: "จำนวนวันทำงานรวม", value: formatDays(source.total_days) },
      { label: "ค่าแรงต่อวัน", value: formatDailyWageMoney(source.daily_wage) },
    ],
    summary: [
      { label: "ค่าแรงรวม", value: formatPayrollMoneyValue(source.gross_pay) },
      ...(hasAdjustments ? [{ label: "หนี้และเงินเบิกก่อนหักรวม", value: formatPayrollMoneyValue(outstanding.beforeDeductions) }] : []),
      ...(hasAdjustments ? [{ label: "ยอดค้างยกไปเดือนถัดไป", value: formatPayrollMoneyValue(outstanding.remainingAfterDeductions) }] : []),
      { label: "เงินเดือนสุทธิที่ต้องจ่าย", value: formatPayrollMoneyValue(source.net_pay) },
    ],
    calendar: attendance ? calendarForAttendance(attendance) : calendarForMonth(source.month, source.slip_data?.segments),
    sourceRows,
    notice: source.status === "APPROVED"
      ? "เอกสารนี้รับรองข้อมูลสลิปเงินเดือนที่อนุมัติแล้วตามข้อมูลในระบบ ไม่ใช่หลักฐานการรับเงินจริง"
      : "เอกสารนี้เป็นสลิปเงินเดือนที่อยู่ระหว่างรออนุมัติ ไม่ใช่หลักฐานการรับเงินจริง",
    filename: `LanFlow-เงินเดือน-${source.month}-${source.id.slice(0, 8)}-${statusLabel}-80mm.pdf`,
  };
}
