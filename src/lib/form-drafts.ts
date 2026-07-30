export type FormDraftType = "rubber-bill" | "income" | "expense";

export type FormDraftPartition = {
  ownerUserId: string;
  locationId: string;
  formType: FormDraftType;
};

type StoredFormDraft<T> = FormDraftPartition & {
  key: string;
  data: T;
  updatedAt: number;
};

const DB_NAME = "lanflow_form_drafts_db";
const DB_VERSION = 1;
const STORE_NAME = "form_drafts";
const pendingDraftFlushers = new Set<() => Promise<void>>();

function draftKey({ ownerUserId, locationId, formType }: FormDraftPartition) {
  return JSON.stringify([ownerUserId, locationId, formType]);
}

export function registerDraftFlusher(flush: () => Promise<void>) {
  pendingDraftFlushers.add(flush);
  return () => {
    pendingDraftFlushers.delete(flush);
  };
}

export async function flushPendingFormDrafts() {
  await Promise.all(Array.from(pendingDraftFlushers, (flush) => flush()));
}

function openDraftDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
  });
}

export async function readFormDraft<T>(partition: FormDraftPartition) {
  const db = await openDraftDb();
  return new Promise<T | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(draftKey(partition));
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    request.onsuccess = () => {
      db.close();
      resolve((request.result as StoredFormDraft<T> | undefined)?.data ?? null);
    };
  });
}

export async function writeFormDraft<T>(
  partition: FormDraftPartition,
  data: T,
) {
  const db = await openDraftDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      ...partition,
      key: draftKey(partition),
      data,
      updatedAt: Date.now(),
    } satisfies StoredFormDraft<T>);
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

export async function deleteFormDraft(partition: FormDraftPartition) {
  const db = await openDraftDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(draftKey(partition));
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}
