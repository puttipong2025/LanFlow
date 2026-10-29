import { getSyncDb, SYNC_QUEUE_STORE, INCOME_EXPENSE_OUTCOME_STORE } from "@/lib/idb-core";
import type { SyncEvent } from "@/lib/idb-queue";
import { isSameSyncEvent } from "@/lib/sync-event-comparison";

export type IncomeExpenseNotice = {
  commandId: string; ownerUserId: string; locationId: string; serverId: string;
  number: string; message: string;
};

export async function incomeExpenseOwnerWork(ownerUserId: string): Promise<SyncEvent[]> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE_STORE, "readonly");
    const read = tx.objectStore(SYNC_QUEUE_STORE).index("ownerUserId").getAll(ownerUserId);
    read.onsuccess = () => resolve(read.result as SyncEvent[]);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function completeIncomeExpenseBackground(event: SyncEvent, message?: string) {
  const db = await getSyncDb();
  return new Promise<boolean>((resolve, reject) => {
    let completed = false;
    const tx = db.transaction([SYNC_QUEUE_STORE, INCOME_EXPENSE_OUTCOME_STORE], "readwrite");
    const queue = tx.objectStore(SYNC_QUEUE_STORE);
    const read = queue.get(event.queueId!);
    read.onsuccess = () => {
      if (!read.result || !isSameSyncEvent(read.result, event)) return;
      if (message) tx.objectStore(INCOME_EXPENSE_OUTCOME_STORE).put({
        commandId: event.payload.commandId, ownerUserId: event.ownerUserId, locationId: event.locationId,
        serverId: event.serverId!, number: event.serverBillNo ?? event.payload.localBillNo, message,
      } satisfies IncomeExpenseNotice);
      queue.delete(event.queueId!);
      completed = true;
    };
    tx.oncomplete = () => { db.close(); resolve(completed); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function incomeExpenseNotices(ownerUserId: string, locationId: string): Promise<IncomeExpenseNotice[]> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INCOME_EXPENSE_OUTCOME_STORE, "readonly");
    const read = tx.objectStore(INCOME_EXPENSE_OUTCOME_STORE).index("ownerUserId").getAll(ownerUserId);
    read.onsuccess = () => resolve((read.result as IncomeExpenseNotice[]).filter((item) => item.locationId === locationId));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function dismissIncomeExpenseNotice(notice: IncomeExpenseNotice) {
  const db = await getSyncDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(INCOME_EXPENSE_OUTCOME_STORE, "readwrite");
    const store = tx.objectStore(INCOME_EXPENSE_OUTCOME_STORE);
    const read = store.get(notice.commandId);
    read.onsuccess = () => {
      if (read.result?.ownerUserId === notice.ownerUserId && read.result?.locationId === notice.locationId) store.delete(notice.commandId);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
