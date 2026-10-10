import type { MoneyTransferStatusFilter } from "@/hooks/useMoneyTransfers";

export const MONEY_TRANSFER_STATUS_FILTERS: Array<[MoneyTransferStatusFilter, string]> = [
  ["all", "ทั้งหมด"],
  ["pending", "รอโอน"],
  ["partial", "ค้างจ่าย"],
  ["advance_payment", "จ่ายล่วงหน้า"],
  ["paid", "จ่ายครบ"],
  ["overpaid", "ชำระเกิน"],
  ["branch_and_transfer", "โอน+สาขาจ่าย"],
  ["cancelled", "ยกเลิก"],
  ["branch_pending_receipt", "รอยืนยันรับ"],
  ["branch_received", "รับแล้ว"],
];

export const MONEY_TRANSFER_STATUS_STYLES: Record<Exclude<MoneyTransferStatusFilter, "all">, string> = {
  paid: "bg-leaf/10 text-leaf",
  branch_and_transfer: "bg-leaf/10 text-leaf",
  overpaid: "bg-clay/10 text-clay",
  partial: "bg-amber/20 text-amber",
  advance_payment: "bg-purple-500/20 text-purple-600",
  cancelled: "bg-clay/10 text-clay",
  pending: "bg-amber/20 text-amber",
  branch_pending_receipt: "bg-amber/20 text-amber",
  branch_received: "bg-leaf/10 text-leaf",
};

export const MONEY_TRANSFER_STATUS_LABELS: Record<Exclude<MoneyTransferStatusFilter, "all">, string> = {
  paid: "จ่ายครบ",
  branch_and_transfer: "โอน+สาขาจ่าย",
  overpaid: "ชำระเกิน",
  partial: "ค้างจ่าย",
  advance_payment: "จ่ายล่วงหน้า",
  cancelled: "ยกเลิก",
  pending: "รอโอน",
  branch_pending_receipt: "รอยืนยันรับ",
  branch_received: "รับแล้ว",
};
