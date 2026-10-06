import type { IncomeExpense, RubberBill, SyncStatus } from "@/types";

type SyncableRecord = Pick<RubberBill | IncomeExpense, "id" | "clientTempId" | "serverBillNo"> & {
  syncStatus?: SyncStatus;
  serverSubmissionAttempted?: boolean;
};

export const OFFLINE_SYNCED_ACTION_MESSAGE = "รายการนี้ซิงก์แล้ว ต้องออนไลน์เพื่อแก้ไขหรือลบ";
export const PENDING_SERVER_ACTION_MESSAGE = "รายการนี้บันทึกถึงเซิร์ฟเวอร์แล้วและกำลังยืนยันผล กรุณารอสักครู่";
export const RUBBER_BILL_TRANSFER_LOCK_MESSAGE = "รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน";

export function isSyncedServerRecord(record: SyncableRecord) {
  return Boolean(record.serverBillNo) || record.syncStatus === "synced" || record.id !== record.clientTempId;
}

export function getOfflineSyncedActionBlockReason(record: SyncableRecord, isOnline: boolean) {
  if (!isOnline && isSyncedServerRecord(record)) {
    return OFFLINE_SYNCED_ACTION_MESSAGE;
  }
  return null;
}

export function getPendingServerActionBlockReason(record: SyncableRecord) {
  return record.syncStatus === "pending"
    && (record.serverSubmissionAttempted === true || isSyncedServerRecord(record))
    ? PENDING_SERVER_ACTION_MESSAGE
    : null;
}
