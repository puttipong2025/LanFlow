import { getSyncDb, SYNC_QUEUE_STORE } from "@/lib/idb-core";
import {
  areSameSyncEventSnapshots,
  isSameSyncCommand,
  isSameSyncEvent,
} from "@/lib/sync-event-comparison";

export {
  deleteRubberBillReceiptSnapshotsByClientTempId,
  getRubberBillReceiptSnapshot,
  getRubberBillReceiptSnapshots,
  pruneRubberBillReceiptSnapshots,
  putRubberBillReceiptSnapshots,
  tombstoneRubberBillReceiptSnapshotByBillId,
  tombstoneRubberBillReceiptSnapshotsByClientTempId,
  type RubberBillReceiptSnapshot,
} from "@/lib/rubber-bill-receipts-idb";

export type SyncOperation = "create" | "update" | "delete";
export type SyncEntity = "rubber_bills" | "income_expense";

export interface SyncEvent<T = any> {
  queueId?: number;
  id: string;
  entity: SyncEntity;
  ownerUserId: string;
  locationId: string;
  operation: SyncOperation;
  serverId?: string;
  serverBillNo?: string;
  serverSubmissionAttempted?: boolean;
  payload: T;
  timestamp: number;
  status: "pending" | "failed" | "conflict";
  errorMessage?: string;
  failureHttpStatus?: number;
  failureCode?: string;
}
export interface QueuePartition {
  entity: SyncEntity;
  ownerUserId: string;
  locationId: string;
}

export function enqueueSyncEvent<T>(event: Omit<SyncEvent<T>, "queueId">): Promise<number>;
export function enqueueSyncEvent<T>(
  event: Omit<SyncEvent<T>, "queueId">,
  expectedRecordEvents: readonly SyncEvent[],
): Promise<number | null>;
export async function enqueueSyncEvent<T>(
  event: Omit<SyncEvent<T>, "queueId">,
  expectedRecordEvents?: readonly SyncEvent[],
): Promise<number | null> {
  if (!event.ownerUserId || !event.locationId) {
    throw new Error("ownerUserId and locationId are required for offline sync events");
  }

  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    let queueId: number | null = null;
    const transaction = db.transaction(SYNC_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const addEvent = () => {
      const request = store.add(event);
      request.onsuccess = () => {
        queueId = request.result as number;
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    };

    if (expectedRecordEvents === undefined) {
      addEvent();
    } else {
      const request = store.index("id").getAll(event.id);
      request.onsuccess = () => {
        const currentEvents = (request.result as SyncEvent[])
          .filter((current) => current.entity === event.entity
            && current.ownerUserId === event.ownerUserId
            && current.locationId === event.locationId);
        if (areSameSyncEventSnapshots(currentEvents, expectedRecordEvents)) addEvent();
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    }

    transaction.oncomplete = () => {
      db.close();
      resolve(queueId);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function updateSyncEvent(event: SyncEvent): Promise<void> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SYNC_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const request = store.put(event);
    request.onsuccess = () => undefined;
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function updateSyncEventIfCurrent(event: SyncEvent): Promise<boolean> {
  const queueId = event.queueId;
  if (typeof queueId !== "number") return false;
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    let updated = false;
    const transaction = db.transaction(SYNC_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const request = store.get(queueId);
    request.onsuccess = () => {
      const current = request.result as SyncEvent | undefined;
      if (current && isSameSyncCommand(current, event)) {
        store.put(event);
        updated = true;
      }
    };
    transaction.oncomplete = () => { db.close(); resolve(updated); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export async function getPendingEvents({ entity, ownerUserId, locationId }: QueuePartition): Promise<SyncEvent[]> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SYNC_QUEUE_STORE, "readonly");
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const index = store.index("ownerUserId");
    const request = index.getAll(ownerUserId);
    request.onsuccess = () => {
      const results = (request.result as SyncEvent[])
        .filter((event) => event.entity === entity && event.locationId === locationId)
        .sort((a, b) => (a.queueId || 0) - (b.queueId || 0));
      db.close();
      resolve(results);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function removeSyncEvent(queueId: number): Promise<void> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SYNC_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const request = store.delete(queueId);
    request.onsuccess = () => undefined;
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function removeSyncEventIfCurrent(event: SyncEvent): Promise<boolean> {
  const queueId = event.queueId;
  if (typeof queueId !== "number") return false;
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    let removed = false;
    const transaction = db.transaction(SYNC_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const request = store.get(queueId);
    request.onsuccess = () => {
      const current = request.result as SyncEvent | undefined;
      if (current && isSameSyncCommand(current, event)) {
        store.delete(queueId);
        removed = true;
      }
    };
    transaction.oncomplete = () => { db.close(); resolve(removed); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export async function removeSyncEvents(queueIds: number[]): Promise<void> {
  if (queueIds.length === 0) return;
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SYNC_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    queueIds.forEach((queueId) => store.delete(queueId));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function reconcileSyncEventsIfCurrent(
  expectedEvents: readonly SyncEvent[],
  keeper?: SyncEvent,
  requireCompleteRecord = false,
): Promise<boolean> {
  if (expectedEvents.length === 0) return keeper === undefined;
  const queueIds = expectedEvents.map((event) => event.queueId);
  if (queueIds.some((queueId) => typeof queueId !== "number")
      || new Set(queueIds).size !== queueIds.length
      || (keeper && !queueIds.includes(keeper.queueId))) return false;

  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    let matches = true;
    let remaining = expectedEvents.length + (requireCompleteRecord ? 1 : 0);
    let reconciled = false;
    const transaction = db.transaction(SYNC_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const finishRead = () => {
      remaining -= 1;
      if (remaining !== 0 || !matches) return;
      if (keeper) store.put(keeper);
      queueIds.forEach((queueId) => {
        if (queueId !== keeper?.queueId) store.delete(queueId as number);
      });
      reconciled = true;
    };
    if (requireCompleteRecord) {
      const first = expectedEvents[0];
      const record = store.index("ownerUserId").getAll(first.ownerUserId);
      record.onsuccess = () => {
        const current = (record.result as SyncEvent[]).filter((event) => (
          event.id === first.id && event.entity === first.entity && event.locationId === first.locationId
        ));
        if (!areSameSyncEventSnapshots(current, expectedEvents)) matches = false;
        finishRead();
      };
    }
    expectedEvents.forEach((expected, index) => {
      const request = store.get(queueIds[index] as number);
      request.onsuccess = () => {
        const current = request.result as SyncEvent | undefined;
        if (!current || !isSameSyncEvent(current, expected)) matches = false;
        finishRead();
      };
    });
    transaction.oncomplete = () => { db.close(); resolve(reconciled); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
