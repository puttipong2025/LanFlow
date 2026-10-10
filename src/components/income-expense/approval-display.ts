import type {
  IncomeExpenseApprovalAppliesTo,
  IncomeExpenseApprovalMatchMode,
  IncomeExpenseApprovalReason,
  IncomeExpenseApprovalStatus,
} from "@/types";

export const appliesToLabels: Record<IncomeExpenseApprovalAppliesTo, string> = {
  income: "รายรับ", expense: "รายจ่าย", both: "รับ-จ่าย",
};
export const matchModeLabels: Record<IncomeExpenseApprovalMatchMode, string> = {
  contains: "พบข้อความ", exact: "ตรงทั้งรายการ",
};
export const reasonLabels: Record<IncomeExpenseApprovalReason, string> = {
  keyword: "ข้อความที่กำหนด", amount_threshold: "ยอดถึงเกณฑ์", non_current_date: "วันที่ไม่ใช่วันปัจจุบัน",
};
export const statusLabels: Record<IncomeExpenseApprovalStatus, string> = {
  pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ปฏิเสธแล้ว", cancelled: "ยกเลิกแล้ว",
};

export function parseOptionalAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? amount : Number.NaN;
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatPerson(name?: string | null, phone?: string | null) {
  return [name?.trim(), phone?.trim()].filter(Boolean).join(" · ") || "—";
}
