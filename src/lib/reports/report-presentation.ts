import type { ReportDetails, ReportHeader, ReportLedgerRow } from "@/types/reports";

const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const REPORT_NUMBER_COLLATOR = new Intl.Collator("th-TH", {
  numeric: true,
  sensitivity: "base",
});

export const REPORT_OPENING_BALANCE_COUNT_NOTE = "ไม่รวมยอดยกมา";
export const REPORT_STATUS_LABEL = "ใช้งาน";

type DatedReportRow = { date: string; number: string };
type ReportDateRange = { start: string; end: string };

function compareBlankLast(left: string, right: string, compare: (a: string, b: string) => number) {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (!normalizedLeft && !normalizedRight) return 0;
  if (!normalizedLeft) return 1;
  if (!normalizedRight) return -1;
  return compare(normalizedLeft, normalizedRight);
}

function sortReportRows<T extends DatedReportRow>(rows: T[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => (
      compareBlankLast(left.row.date, right.row.date, (a, b) => a.localeCompare(b))
      || compareBlankLast(left.row.number, right.row.number, (a, b) => REPORT_NUMBER_COLLATOR.compare(a, b))
      || left.index - right.index
    ))
    .map(({ row }) => row);
}

function isOpeningBalance(row: ReportLedgerRow) {
  return row.isOpeningBalance === true;
}

function reportDateRange(rows: DatedReportRow[]): ReportDateRange | null {
  const dates = rows.map((row) => row.date.trim()).filter(Boolean).sort();
  return dates.length === 0 ? null : { start: dates[0], end: dates[dates.length - 1] };
}

export function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatWholeMoney(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

export function formatQuantity(value: number) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

export function formatThaiDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: BANGKOK_TIME_ZONE,
  }).format(new Date(`${value}T00:00:00+07:00`));
}

export function formatReportDateRange(range: ReportDateRange | null) {
  if (!range) return "ไม่มีรายการ";
  if (range.start === range.end) return formatThaiDate(range.start);
  return `${formatThaiDate(range.start)} – ${formatThaiDate(range.end)}`;
}

export function formatReportItemCount(value: number) {
  return `รวม ${value.toLocaleString("th-TH")} รายการ`;
}

export function formatThaiDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BANGKOK_TIME_ZONE,
  }).format(new Date(value));
}

function formatBangkokFileTimestamp(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: BANGKOK_TIME_ZONE,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}-${part("hour")}${part("minute")}`;
}

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "report";
}

export function reportPdfFilename(report: ReportHeader) {
  return `LanFlow-report-${sanitizeFilenamePart(report.reportNo)}-${formatBangkokFileTimestamp(report.createdAt)}-A4-landscape.pdf`;
}

export function reportShareTitle(report: ReportHeader) {
  return `รายงาน LanFlow ${report.reportNo} · ${report.locationName} · ${formatThaiDateTime(report.createdAt)}`;
}

export type RubberBillRow = ReportDetails["rubberBills"][number];

export function rubberBillTotals(rows: RubberBillRow[]) {
  return rows.reduce((sum, row) => ({
    weight: sum.weight + row.netWeight,
    value: sum.value + row.rubberValue,
    deduction: sum.deduction + row.deduction,
    net: sum.net + row.net,
  }), { weight: 0, value: 0, deduction: 0, net: 0 });
}

export function buildReportPresentation(details: ReportDetails) {
  const rubberBills = sortReportRows(details.rubberBills);
  const incomeExpense = sortReportRows(details.incomeExpense.map((row) => ({
    ...row,
    income: row.type === "income" ? row.amount : null,
    expense: row.type === "expense" ? row.amount : null,
  })));
  const stock = sortReportRows(details.stock);
  const timePayroll = sortReportRows(details.timePayroll);
  const bankTransfers = sortReportRows(details.bankTransfers);
  const periodIncomeExpense = incomeExpense.filter((row) => !isOpeningBalance(row));
  const traderRubberBills = rubberBills.filter((row) => row.customerGroup === "trader");
  const farmerRubberBills = rubberBills.filter((row) => row.customerGroup === "farmer");
  const branchReceiptRubberBills = rubberBills.filter((row) => row.customerGroup === "branch_receipt");
  const income = incomeExpense.reduce((sum, row) => sum + (row.income ?? 0), 0);
  const expense = incomeExpense.reduce((sum, row) => sum + (row.expense ?? 0), 0);

  return {
    traderRubberBills,
    farmerRubberBills,
    branchReceiptRubberBills,
    incomeExpense,
    stock,
    timePayroll,
    bankTransfers,
    counts: {
      traderRubberBills: traderRubberBills.length,
      farmerRubberBills: farmerRubberBills.length,
      branchReceiptRubberBills: branchReceiptRubberBills.length,
      incomeExpense: periodIncomeExpense.length,
      stock: stock.length,
      timePayroll: timePayroll.length,
      bankTransfers: bankTransfers.length,
    },
    dateRange: reportDateRange([
      ...rubberBills,
      ...periodIncomeExpense,
      ...stock,
      ...timePayroll,
      ...bankTransfers,
    ]),
    totals: {
      income,
      expense,
      balance: income - expense,
      stockQuantity: stock.reduce((sum, row) => sum + row.quantity, 0),
      stockAmount: stock.reduce((sum, row) => sum + row.amount, 0),
      payrollAmount: timePayroll.reduce((sum, row) => sum + (row.amount ?? 0), 0),
      workHours: timePayroll
        .filter((row) => row.category === "เวลาทำงาน")
        .reduce((sum, row) => sum + (row.quantity ?? 0), 0),
      transferAmount: bankTransfers.reduce((sum, row) => sum + row.amount, 0),
      slipAmount: bankTransfers.reduce((sum, row) => sum + row.slipAmount, 0),
      fee: bankTransfers.reduce((sum, row) => sum + row.fee, 0),
      branchPaid: bankTransfers.reduce((sum, row) => sum + row.branchPaid, 0),
    },
  };
}
