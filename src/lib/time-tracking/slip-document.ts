import { calculateTimeSegmentPaidDays, type PaidWorkSegment } from "@/lib/time-tracking/pay";

type SlipDocumentStatus = "PENDING" | "APPROVED";
type SlipDocumentKind = "withdrawal" | "payroll";

type SlipCalendarDay = {
  date: string;
  day: number;
  paidDays: number;
};

export type SlipDocumentRow = {
  id: string;
  date: string | null;
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
  approvedAt: string | null;
  paymentLabel: string | null;
  adminComment: string | null;
  summary: Array<{ label: string; value: string }>;
  calendar: SlipCalendarDay[];
  deductionRows: SlipDocumentRow[];
  sourceRows: SlipDocumentRow[];
  notice: string;
  filename: string;
};

type ApprovalFields = {
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
  amount: number;
  description?: string | null;
  effective_date?: string | null;
  applied_month?: string | null;
  created_at?: string | null;
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
  } | null;
};

const statusLabels: Record<SlipDocumentStatus, string> = {
  PENDING: "รออนุมัติ",
  APPROVED: "อนุมัติแล้ว",
};

const numberFormatter = new Intl.NumberFormat("th-TH", {
  maximumFractionDigits: 2,
});

function formatMoney(value: number) {
  return `${numberFormatter.format(Number(value) || 0)} บาท`;
}

function formatDays(value: number) {
  return `${numberFormatter.format(Number(value) || 0)} วัน`;
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

function transactionLabel(type: string) {
  if (type === "DEBT") return "สร้างหนี้สิน";
  if (type === "WITHDRAWAL") return "เบิกเงิน";
  if (type === "DEBT_DEDUCTION") return "หักหนี้อัตโนมัติ";
  if (type === "WITHDRAWAL_DEDUCTION") return "หักยอดเบิกอัตโนมัติ";
  return "รายการหักเงิน";
}

function transactionRow(transaction: SnapshotTransaction): SlipDocumentRow {
  return {
    id: transaction.id,
    date: transaction.applied_month || transaction.effective_date || transaction.created_at || null,
    label: transactionLabel(transaction.type),
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
    deductionRows: [],
    sourceRows: [],
    notice: source.status === "PENDING"
      ? "ประมาณการหากอนุมัติ โดยคำนวณจากข้อมูลปัจจุบันในระบบ เอกสารนี้รับรองสถานะคำขอ ไม่ใช่หลักฐานการรับเงิน"
      : "เอกสารนี้รับรองสถานะคำขอ ไม่ใช่หลักฐานการรับเงิน",
    filename: `LanFlow-เบิกเงิน-${filenameDate(source.effective_date)}-${source.id.slice(0, 8)}-${statusLabel}.pdf`,
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
  const transactions = source.slip_data?.transactions || [];
  const approved = transactions.filter((transaction) => transaction.status === "APPROVED");
  const statusLabel = statusLabels[source.status];
  const attendance = source.slip_data?.attendance;

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
    approverName: source.approver_name || null,
    approvedAt: source.approved_at || null,
    paymentLabel: source.payment_label || null,
    adminComment: source.admin_comment || null,
    summary: [
      ...(attendance ? [
        { label: "วันเต็ม", value: formatDays(attendance.summary.fullDays) },
        { label: "ครึ่งวัน", value: formatDays(attendance.summary.halfDays) },
        { label: "วันหยุด", value: formatDays(attendance.summary.offDays) },
      ] : []),
      { label: "จำนวนวันทำงานรวม", value: formatDays(source.total_days) },
      { label: "ค่าแรงต่อวัน", value: formatMoney(source.daily_wage) },
      { label: "ค่าแรงรวม", value: formatMoney(source.gross_pay) },
      { label: "ยอดหักรวม", value: formatMoney(source.total_deductions) },
      { label: "ยอดสุทธิ", value: formatMoney(source.net_pay) },
    ],
    calendar: attendance ? calendarForAttendance(attendance) : calendarForMonth(source.month, source.slip_data?.segments),
    deductionRows: approved
      .filter((transaction) => transaction.type !== "DEBT" && transaction.type !== "WITHDRAWAL")
      .map(transactionRow),
    sourceRows: approved
      .filter((transaction) => transaction.type === "DEBT" || transaction.type === "WITHDRAWAL")
      .map(transactionRow),
    notice: source.status === "APPROVED"
      ? "เอกสารนี้รับรองข้อมูลสลิปเงินเดือนที่อนุมัติแล้วตามข้อมูลในระบบ"
      : "เอกสารนี้เป็นสลิปเงินเดือนที่อยู่ระหว่างรออนุมัติ",
    filename: `LanFlow-เงินเดือน-${source.month}-${source.id.slice(0, 8)}-${statusLabel}.pdf`,
  };
}
