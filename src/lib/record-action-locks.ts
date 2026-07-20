import type { IncomeExpense, RubberBill, SyncStatus } from "@/types";

type SyncableRecord = Pick<RubberBill | IncomeExpense, "id" | "clientTempId" | "serverBillNo"> & {
  syncStatus?: SyncStatus;
};

export const OFFLINE_SYNCED_ACTION_MESSAGE = "รายการนี้ซิงก์แล้ว ต้องออนไลน์เพื่อแก้ไขหรือลบ";
export const RUBBER_BILL_TRANSFER_LOCK_MESSAGE = "รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน";
export const OCR_TICKET_TRANSFER_LOCK_MESSAGE = "รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน";
export const INCOME_EXPENSE_BRANCH_TRANSFER_LOCK_MESSAGE = "รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง";
export const INCOME_EXPENSE_CUSTOMER_TRANSFER_LOCK_MESSAGE = "รายการนี้มาจากโอนเงินลูกค้าแบบโอน+สาขาจ่าย ต้องแก้ไขหรือลบที่โมดูลโอนเงินลูกค้าต้นทาง";
export const INCOME_EXPENSE_RUBBER_BILL_LOCK_MESSAGE = "รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยางต้นทาง";
export const INCOME_EXPENSE_OCR_TICKET_LOCK_MESSAGE = "รายการนี้มาจาก OCR บิลยาง ต้องแก้ไขหรือลบที่โมดูล OCR บิลยางต้นทาง";

export function isSyncedServerRecord(record: SyncableRecord) {
  return Boolean(record.serverBillNo) || record.syncStatus === "synced" || record.id !== record.clientTempId;
}

export function getOfflineSyncedActionBlockReason(record: SyncableRecord, isOnline: boolean) {
  if (!isOnline && isSyncedServerRecord(record)) {
    return OFFLINE_SYNCED_ACTION_MESSAGE;
  }
  return null;
}
