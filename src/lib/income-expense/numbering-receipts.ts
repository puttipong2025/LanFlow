import { getSyncDb, SYNC_QUEUE_STORE, INCOME_SUBMISSION_STORE, INCOME_EXPENSE_OUTCOME_STORE } from "@/lib/idb-core";
import { isSameSyncEvent } from "@/lib/sync-event-comparison";
import { isIncomeExpenseSyncResult } from "@/lib/income-expense/contracts";
import type { SyncEvent } from "@/lib/idb-queue";

/** Persist the handoff before removing an outbox record, including pending approval. */
export async function confirmIncomeNumberedEvent(event: SyncEvent, result: Record<string, unknown>) {
  if (!event.payload.billNumbering || !isIncomeExpenseSyncResult(result, event.payload)) return false;
  const db = await getSyncDb();
  return new Promise<boolean>((resolve, reject) => {
    let done = false;
    const tx = db.transaction([SYNC_QUEUE_STORE, INCOME_SUBMISSION_STORE, INCOME_EXPENSE_OUTCOME_STORE], "readwrite");
    const queue = tx.objectStore(SYNC_QUEUE_STORE), read = queue.get(event.queueId!);
    read.onsuccess = () => {
      if (!read.result || !isSameSyncEvent(read.result, event)) return;
      const key = JSON.stringify([event.ownerUserId, event.locationId, event.id]);
      const submissions = tx.objectStore(INCOME_SUBMISSION_STORE), previous = submissions.get(key);
      previous.onsuccess = () => {
        submissions.put({ ...previous.result, key, result,
          ...(result.status === "discarded" ? { cancelled: true } : {}) });
        if (result.status === "rejected" || result.status === "discarded") {
          tx.objectStore(INCOME_EXPENSE_OUTCOME_STORE).put({ commandId: `create:${event.id}`, ownerUserId: event.ownerUserId,
            locationId: event.locationId, serverId: String(result.id ?? event.id), number: event.payload.localBillNo,
            message: result.status === "rejected" ? "รายการไม่ได้รับอนุมัติ เลขเดิมไม่ถูกนำกลับมาใช้" : "รายการนี้สิ้นสุดแล้ว" });
        }
        queue.delete(event.queueId!); done = true;
      };
    };
    tx.oncomplete = () => { db.close(); resolve(done); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
