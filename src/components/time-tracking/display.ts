import type { PayrollPeriodAction } from "@/lib/time-tracking/attendance-contract";

const MONTH_FORMATTER = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
const THAI_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });

export function formatThaiDate(date: string) {
  const value = new Date(`${date}T00:00:00+07:00`);
  return Number.isNaN(value.getTime()) ? date : THAI_DATE_FORMATTER.format(value);
}
export function monthLabel(month: string) {
  return MONTH_FORMATTER.format(new Date(`${month}-01T00:00:00+07:00`));
}
export function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function payrollPeriodActionLabel(action: PayrollPeriodAction) {
  if (action === "ENABLE") return "เริ่มคิดค่าแรง";
  if (action === "PAUSE") return "พักคิดค่าแรง";
  if (action === "RESUME") return "กลับมาคิดค่าแรง";
  return "สิ้นสุดสถานะเงินเดือน";
}

