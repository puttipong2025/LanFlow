import { bangkokDateString } from "@/lib/bangkok-date";
import type { Location } from "@/types";
export const TIME_TRACKING_OFFLINE_MESSAGE = "เวลาและเงินเดือนใช้ได้เมื่อออนไลน์เท่านั้น";
export function bangkokToday() { return bangkokDateString(); }
export function reportLockReason(item: { report_lock_no?: string | null }) {
  return item.report_lock_no ? `ล็อกโดยรายงาน ${item.report_lock_no} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : null;
}
export function paymentSourceLabel(item: { expense_location_id?: string | null; expense_location_name?: string | null }) {
  return item.expense_location_id ? `จ่ายโดย: ${item.expense_location_name || "ไม่พบชื่อสาขาผู้จ่าย"}` : "ส่วนกลางจ่าย (จ่ายนอกระบบ)";
}
export function paymentScopeReason(item: { status: string; expense_location_id?: string | null }, globalManager: boolean, locations: Location[]) {
  return item.status === "APPROVED" && item.expense_location_id && !globalManager && !locations.some((location) => location.id === item.expense_location_id)
    ? "รายการนี้จ่ายจากสาขานอกขอบเขต กรุณาให้ผู้จัดการระบบจัดการ" : null;
}

