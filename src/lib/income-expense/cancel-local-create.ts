import { getSyncDb, SYNC_QUEUE_STORE, INCOME_SUBMISSION_STORE } from "@/lib/idb-core";
import { PENDING_SERVER_ACTION_MESSAGE } from "@/lib/record-action-locks";
import { areSameSyncEventSnapshots } from "@/lib/sync-event-comparison";
import type { SyncEvent } from "@/lib/idb-queue";
import { incomeExpenseFromSyncEvent } from "./operational-list";

/** Cancellation and the accepted-form marker commit together, before any sender can claim this work. */
export async function cancelUnsubmittedIncomeCreate(expected: SyncEvent[]) {
  const first = expected[0];
  if (!first || !expected.every(event => event.entity === "income_expense" && event.ownerUserId === first.ownerUserId
    && event.locationId === first.locationId && event.id === first.id && event.operation === "create"
    && event.status === "pending" && event.serverSubmissionAttempted === false && !event.serverId && !event.serverBillNo)) {
    throw new Error(PENDING_SERVER_ACTION_MESSAGE);
  }
  const db = await getSyncDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SYNC_QUEUE_STORE, INCOME_SUBMISSION_STORE], "readwrite");
    const queue = tx.objectStore(SYNC_QUEUE_STORE), submissions = tx.objectStore(INCOME_SUBMISSION_STORE);
    const read = queue.index("ownerUserId").getAll(first.ownerUserId);
    let cancelled = false;
    read.onsuccess = () => {
      const current = (read.result as SyncEvent[]).filter(event => event.entity === "income_expense"
        && event.locationId === first.locationId && event.id === first.id);
      if (!areSameSyncEventSnapshots(current, expected)) return;
      const key = JSON.stringify([first.ownerUserId, first.locationId, first.id]), previous = submissions.get(key);
      previous.onsuccess = () => {
        try {
          if (previous.result?.result) return;
          submissions.put({ key, transaction: incomeExpenseFromSyncEvent(first), ...previous.result, cancelled: true });
          current.forEach(event => queue.delete(event.queueId!));
          cancelled = true;
        } catch { tx.abort(); }
      };
    };
    tx.oncomplete = () => { db.close(); if (cancelled) resolve(); else reject(new Error(PENDING_SERVER_ACTION_MESSAGE)); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("ยังยกเลิกรายการไม่ได้ กรุณาลองใหม่")); };
  });
}
