import { getSyncDb, SYNC_QUEUE_STORE } from "@/lib/idb-core";
import { isSameSyncCommand } from "@/lib/sync-event-comparison";
import type { SyncEvent } from "@/lib/idb-queue";

let active: { ownerUserId: string; locationId: string; notify: (message: string) => void } | undefined;
export function registerRubberBackgroundNotifications(ownerUserId: string, locationId: string, notify: (message: string) => void) {
  const scope = { ownerUserId, locationId, notify };
  active = scope;
  return () => { if (active === scope) active = undefined; };
}

export function isRubberBackgroundScopeActive(ownerUserId: string, locationId: string) {
  return active?.ownerUserId === ownerUserId && active.locationId === locationId;
}

export async function notifyRubberBackgroundFailure(event: SyncEvent) {
  const scope = active;
  if (!event.payload.background || event.status === "pending" || !event.errorMessage
      || !scope || scope.ownerUserId !== event.ownerUserId || scope.locationId !== event.locationId) return;
  const reason = JSON.stringify([event.payload.commandId ?? event.payload.idempotencyKey, event.status, event.failureCode, event.errorMessage]);
  const db = await getSyncDb();
  const first = await new Promise<boolean>((resolve, reject) => {
    let changed = false;
    const tx = db.transaction(SYNC_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(SYNC_QUEUE_STORE);
    const read = store.get(event.queueId!);
    read.onsuccess = () => {
      const current = read.result as (SyncEvent & { notifiedReason?: string }) | undefined;
      if (active !== scope || !current || !isSameSyncCommand(current, event) || current.status !== event.status || current.errorMessage !== event.errorMessage
          || current.failureCode !== event.failureCode || current.notifiedReason === reason) return;
      store.put({ ...current, notifiedReason: reason });
      changed = true;
    };
    tx.oncomplete = () => { db.close(); resolve(changed); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
  if (first && active === scope) scope.notify(event.errorMessage);
}
