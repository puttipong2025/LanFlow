import type { ReportDetails, ReportSummary } from "@/types/reports";

const BANGKOK_TIME_ZONE = "Asia/Bangkok";

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

export function reportPdfFilename(report: ReportSummary) {
  return `LanFlow-report-${sanitizeFilenamePart(report.reportNo)}-${formatBangkokFileTimestamp(report.createdAt)}-A4-landscape.pdf`;
}

export function reportShareTitle(report: ReportSummary) {
  return `รายงาน LanFlow ${report.reportNo} · ${report.locationName} · ${formatThaiDateTime(report.createdAt)}`;
}

export function reportStatusLabel(_report: ReportSummary) {
  return "ใช้งาน";
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
  const incomeExpense = details.incomeExpense.map((row) => ({
    ...row,
    income: row.type === "income" ? row.amount : null,
    expense: row.type === "expense" ? row.amount : null,
  }));
  const income = incomeExpense.reduce((sum, row) => sum + (row.income ?? 0), 0);
  const expense = incomeExpense.reduce((sum, row) => sum + (row.expense ?? 0), 0);

  return {
    traderRubberBills: details.rubberBills.filter((row) => row.customerGroup === "trader"),
    farmerRubberBills: details.rubberBills.filter((row) => row.customerGroup === "farmer"),
    branchReceiptRubberBills: details.rubberBills.filter((row) => row.customerGroup === "branch_receipt"),
    incomeExpense,
    totals: {
      ocrNet: details.ocrTickets.reduce((sum, row) => sum + row.weightNet, 0),
      ocrRemaining: details.ocrTickets.reduce((sum, row) => sum + row.weightRemaining, 0),
      ocrAmount: details.ocrTickets.reduce((sum, row) => sum + row.amount, 0),
      income,
      expense,
      balance: income - expense,
      stockQuantity: details.stock.reduce((sum, row) => sum + row.quantity, 0),
      stockAmount: details.stock.reduce((sum, row) => sum + row.amount, 0),
      payrollAmount: details.timePayroll.reduce((sum, row) => sum + (row.amount ?? 0), 0),
      workHours: details.timePayroll
        .filter((row) => row.category === "เวลาทำงาน")
        .reduce((sum, row) => sum + (row.quantity ?? 0), 0),
      transferAmount: details.bankTransfers.reduce((sum, row) => sum + row.amount, 0),
      slipAmount: details.bankTransfers.reduce((sum, row) => sum + row.slipAmount, 0),
      fee: details.bankTransfers.reduce((sum, row) => sum + row.fee, 0),
      branchPaid: details.bankTransfers.reduce((sum, row) => sum + row.branchPaid, 0),
    },
  };
}
