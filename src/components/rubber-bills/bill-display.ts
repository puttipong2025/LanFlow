import type { RubberBill } from "@/types";

export function formatBillTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("th-TH")} ${date.toLocaleTimeString("th-TH", { hour12: false })}`;
}

export function getDisplayBillNo(bill: RubberBill) {
  return bill.serverBillNo ?? bill.localBillNo ?? bill.billNo;
}
