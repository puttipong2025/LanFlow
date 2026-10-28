import { getSyncDb, SYNC_QUEUE_STORE, RUBBER_BILL_RECEIPT_STORE, RUBBER_BILL_RECEIPT_TOMBSTONE_STORE } from "@/lib/idb-core";
import { isSameSyncEvent } from "@/lib/sync-event-comparison";
import type { SyncEvent } from "@/lib/idb-queue";
import { removeSyncEventIfCurrent } from "@/lib/idb-queue";

export function acknowledgeRubberCommand(event: SyncEvent, result: Record<string, unknown>) {
  return event.payload.background
    ? completeRubberCommand(event, result.errorCode === "BILL_ALREADY_DELETED" || (event.operation === "delete" && result.status === "synced"))
    : removeSyncEventIfCurrent(event);
}

// Queue acknowledgement and deletion tombstone commit together. Reopening the
// app cannot resurrect a cached receipt after the queue has disappeared.
export async function completeRubberCommand(event: SyncEvent, deleted: boolean) {
  if (typeof event.queueId !== "number" || (deleted && !event.serverId)) return false;
  const db = await getSyncDb();
  return new Promise<boolean>((resolve, reject) => {
    let completed = false;
    const tx = db.transaction([SYNC_QUEUE_STORE, RUBBER_BILL_RECEIPT_STORE, RUBBER_BILL_RECEIPT_TOMBSTONE_STORE], "readwrite");
    const queue = tx.objectStore(SYNC_QUEUE_STORE);
    const request = queue.get(event.queueId!);
    request.onsuccess = () => {
      const current = request.result as SyncEvent | undefined;
      if (!current || !isSameSyncEvent(current, event)) return;
      if (deleted) {
        tx.objectStore(RUBBER_BILL_RECEIPT_TOMBSTONE_STORE).put({ key: `bill:${event.locationId}:${event.serverId}` });
        const receipt = tx.objectStore(RUBBER_BILL_RECEIPT_STORE).get(event.serverId!);
        receipt.onsuccess = () => {
          if (receipt.result?.locationId === event.locationId && receipt.result?.bill?.clientTempId === event.id) {
            tx.objectStore(RUBBER_BILL_RECEIPT_STORE).delete(event.serverId!);
          }
        };
      }
      queue.delete(event.queueId!);
      completed = true;
    };
    tx.oncomplete = () => { db.close(); resolve(completed); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
