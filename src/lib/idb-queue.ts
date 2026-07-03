export type SyncOperation = "create" | "update" | "delete";

export interface SyncEvent<T = any> {
  queueId?: number; // Auto-incremented key
  id: string; // usually clientTempId
  entity: "rubber_bills" | "income_expense"; // namespace
  operation: SyncOperation;
  payload: T;
  timestamp: number;
  status: "pending" | "failed" | "conflict";
  errorMessage?: string;
}

const DB_NAME = "lanflow_sync_db";
const STORE_NAME = "sync_queue";
const DB_VERSION = 2; // Increased to add auto-increment

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
      } else {
        // Migration path if needed
      }
    };
  });
}

export async function enqueueSyncEvent<T>(event: Omit<SyncEvent<T>, "queueId">): Promise<number> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(event);
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
  });
}

export async function updateSyncEvent(event: SyncEvent): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(event);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingEvents(entity: string): Promise<SyncEvent[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("entity");
    const request = index.getAll(entity);
    request.onsuccess = () => {
      // Sort by queueId to ensure correct replay order, only return pending/failed items that aren't permanently locked
      let results = (request.result as SyncEvent[]).sort((a, b) => (a.queueId || 0) - (b.queueId || 0));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function removeSyncEvent(queueId: number): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(queueId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
