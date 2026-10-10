import { bangkokDateString } from "@/lib/bangkok-date";
import { paymentAllocationSourceLabel } from "@/lib/time-tracking/payment-label";
import type { Location } from "@/types";
export const TIME_TRACKING_OFFLINE_MESSAGE = "เวลาและเงินเดือนใช้ได้เมื่อออนไลน์เท่านั้น";
export function bangkokToday() { return bangkokDateString(); }
export function reportLockReason(item: { report_lock_no?: string | null }) {
  return item.report_lock_no ? `ล็อกโดยรายงาน ${item.report_lock_no} — ต้องลบรายงานล่าสุดตามลำดับก่อน` : null;
}
export function paymentSourceLabel(item: { amount?: number | string | null; net_pay?: number | string | null; expense_location_id?: string | null; expense_location_name?: string | null; payment_channel?: string | null; payment_transfer_amount?: number | string | null }) {
  const allocationLabel = paymentAllocationSourceLabel({
    channel: item.payment_channel,
    transferAmount: Number(item.payment_transfer_amount || 0),
    sourceAmount: Number(item.amount ?? item.net_pay ?? 0),
    locationName: item.expense_location_name,
  });
  if (allocationLabel) return allocationLabel;
  return item.expense_location_id ? `จ่ายโดย: ${item.expense_location_name || "ไม่พบชื่อสาขาผู้จ่าย"}` : "จ่ายนอกระบบ";
}
export function paymentScopeReason(item: { status: string; expense_location_id?: string | null }, globalManager: boolean, locations: Location[]) {
  return item.status === "APPROVED" && item.expense_location_id && !globalManager && !locations.some((location) => location.id === item.expense_location_id)
    ? "รายการนี้จ่ายจากสาขานอกขอบเขต กรุณาให้ผู้จัดการระบบจัดการ" : null;
}
