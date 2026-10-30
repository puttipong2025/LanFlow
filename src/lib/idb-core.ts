export const SYNC_QUEUE_STORE = "sync_queue";
export const RUBBER_BILL_RECEIPT_STORE = "rubber_bill_receipts";
export const RUBBER_BILL_RECEIPT_TOMBSTONE_STORE = "rubber_bill_receipt_tombstones";
export const INCOME_EXPENSE_OUTCOME_STORE = "income_expense_outcomes";
export const BUSINESS_CACHE_META_STORE = "business_cache_meta";

const DB_NAME = "lanflow_sync_db";
// Protocol fence: older uploaders must not read locally staged command envelopes.
const DB_VERSION = 8;
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
    let blocked = false;
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("กรุณาปิดแท็บ LanFlow เก่าแล้วลองอีกครั้ง")); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(BUSINESS_CACHE_META_STORE)) {
        db.createObjectStore(BUSINESS_CACHE_META_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(INCOME_EXPENSE_OUTCOME_STORE)) {
        const outcomes = db.createObjectStore(INCOME_EXPENSE_OUTCOME_STORE, { keyPath: "commandId" });
        outcomes.createIndex("ownerUserId", "ownerUserId");
      }
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
