export type SyncOperation = "create" | "update" | "delete";
export type SyncEntity = "rubber_bills" | "income_expense";

export interface SyncEvent<T = any> {
  queueId?: number;
  id: string;
  entity: SyncEntity;
  ownerUserId: string;
  locationId: string;
  operation: SyncOperation;
  payload: T;
  timestamp: number;
  status: "pending" | "failed" | "conflict";
  errorMessage?: string;
}

export interface QueuePartition {
  entity: SyncEntity;
  ownerUserId: string;
  locationId: string;
}

const DB_NAME = "lanflow_sync_db";
const STORE_NAME = "sync_queue";
const DB_VERSION = 3;
const LEGACY_QUEUE_ERROR = "รายการออฟไลน์นี้สร้างก่อนอัปเกรดและไม่มีข้อมูลผู้ใช้ จึงหยุดซิงก์เพื่อความปลอดภัย";

function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "queueId", autoIncrement: true });
        store.createIndex("entity", "entity", { unique: false });
        store.createIndex("id", "id", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("ownerUserId", "ownerUserId", { unique: false });
        store.createIndex("locationId", "locationId", { unique: false });
        return;
      }

      const transaction = (event.target as IDBOpenDBRequest).transaction!;
      const store = transaction.objectStore(STORE_NAME);
      if (!store.indexNames.contains("ownerUserId")) {
        store.createIndex("ownerUserId", "ownerUserId", { unique: false });
      }
      if (!store.indexNames.contains("locationId")) {
        store.createIndex("locationId", "locationId", { unique: false });
      }
      if (event.oldVersion < 3) {
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const queuedEvent = cursor.value as Partial<SyncEvent>;
          if (!queuedEvent.ownerUserId) {
            cursor.update({
              ...queuedEvent,
              ownerUserId: "",
              locationId: queuedEvent.locationId ?? (queuedEvent.payload as { locationId?: string } | undefined)?.locationId ?? "",
              status: "failed",
              errorMessage: queuedEvent.errorMessage ?? LEGACY_QUEUE_ERROR,
            });
          }
          cursor.continue();
        };
      }
    };
  });
}

export async function enqueueSyncEvent<T>(event: Omit<SyncEvent<T>, "queueId">): Promise<number> {
  if (!event.ownerUserId || !event.locationId) {
    throw new Error("ownerUserId and locationId are required for offline sync events");
  }

  const db = await getDb();
  return new Promise((resolve, reject) => {
    let queueId: number;
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(event);
    request.onsuccess = () => {
      queueId = request.result as number;
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
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
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
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

export async function getPendingEvents({ entity, ownerUserId, locationId }: QueuePartition): Promise<SyncEvent[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
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
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
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
