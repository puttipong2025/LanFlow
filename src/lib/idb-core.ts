export const SYNC_QUEUE_STORE = "sync_queue";
export const RUBBER_BILL_RECEIPT_STORE = "rubber_bill_receipts";
export const RUBBER_BILL_RECEIPT_TOMBSTONE_STORE = "rubber_bill_receipt_tombstones";

const DB_NAME = "lanflow_sync_db";
const DB_VERSION = 5;
const LEGACY_QUEUE_ERROR = "รายการออฟไลน์นี้สร้างก่อนอัปเกรดและไม่มีข้อมูลผู้ใช้ จึงหยุดซิงก์เพื่อความปลอดภัย";

type LegacyQueuedEvent = {
  ownerUserId?: string;
  locationId?: string;
  payload?: { locationId?: string };
  errorMessage?: string;
  [key: string]: unknown;
};

export function getSyncDb(): Promise<IDBDatabase> {
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
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        const store = db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: "queueId", autoIncrement: true });
        store.createIndex("entity", "entity", { unique: false });
        store.createIndex("id", "id", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("ownerUserId", "ownerUserId", { unique: false });
        store.createIndex("locationId", "locationId", { unique: false });
      } else {
        const transaction = (event.target as IDBOpenDBRequest).transaction!;
        const store = transaction.objectStore(SYNC_QUEUE_STORE);
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
            const queuedEvent = cursor.value as LegacyQueuedEvent;
            if (!queuedEvent.ownerUserId) {
              cursor.update({
                ...queuedEvent,
                ownerUserId: "",
                locationId: queuedEvent.locationId ?? queuedEvent.payload?.locationId ?? "",
                status: "failed",
                errorMessage: queuedEvent.errorMessage ?? LEGACY_QUEUE_ERROR,
              });
            }
            cursor.continue();
          };
        }
      }

      if (!db.objectStoreNames.contains(RUBBER_BILL_RECEIPT_STORE)) {
        const receiptStore = db.createObjectStore(RUBBER_BILL_RECEIPT_STORE, { keyPath: "billId" });
        receiptStore.createIndex("locationId", "locationId", { unique: false });
        receiptStore.createIndex("serverReceivedAt", "serverReceivedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(RUBBER_BILL_RECEIPT_TOMBSTONE_STORE)) {
        db.createObjectStore(RUBBER_BILL_RECEIPT_TOMBSTONE_STORE, { keyPath: "key" });
      }
    };
  });
}
