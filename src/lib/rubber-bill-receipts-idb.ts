import type { RubberBillReceiptModel } from "@/components/rubber-bills/bill-display";
import {
  getSyncDb,
  RUBBER_BILL_RECEIPT_STORE,
  RUBBER_BILL_RECEIPT_TOMBSTONE_STORE,
} from "@/lib/idb-core";
import type { RubberBill } from "@/types";

export interface RubberBillReceiptSnapshot {
  billId: string;
  locationId: string;
  serverBillNo: string;
  serverReceivedAt: string;
  revisionNo: number;
  bill: RubberBill;
  receipt: RubberBillReceiptModel;
}

type RubberBillReceiptTombstone = {
  key: string;
};

function clientTombstoneKey(locationId: string, clientTempId: string) {
  return `client:${locationId}:${clientTempId}`;
}

function billTombstoneKey(locationId: string, billId: string) {
  return `bill:${locationId}:${billId}`;
}

export async function putRubberBillReceiptSnapshots(
  snapshots: RubberBillReceiptSnapshot[],
  signal?: AbortSignal,
): Promise<void> {
  if (snapshots.length === 0 || signal?.aborted) return;
  const db = await getSyncDb();
  if (signal?.aborted) {
    db.close();
    return;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [RUBBER_BILL_RECEIPT_STORE, RUBBER_BILL_RECEIPT_TOMBSTONE_STORE],
      "readwrite",
    );
    const receiptStore = transaction.objectStore(RUBBER_BILL_RECEIPT_STORE);
    const tombstoneStore = transaction.objectStore(RUBBER_BILL_RECEIPT_TOMBSTONE_STORE);
    let settled = false;
    const abort = () => {
      try {
        transaction.abort();
      } catch {
        // The transaction already completed between the signal and this callback.
      }
    };
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      db.close();
      if (error && !signal?.aborted) reject(error);
      else resolve();
    };
    transaction.oncomplete = () => finish();
    transaction.onabort = () => finish(transaction.error);
    transaction.onerror = () => finish(transaction.error ?? new Error("Receipt snapshot transaction failed"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }

    for (const snapshot of snapshots) {
      const clientTombstoneRequest = tombstoneStore.get(
        clientTombstoneKey(snapshot.locationId, snapshot.bill.clientTempId),
      );
      clientTombstoneRequest.onsuccess = () => {
        if (clientTombstoneRequest.result) return;
        const billTombstoneRequest = tombstoneStore.get(
          billTombstoneKey(snapshot.locationId, snapshot.billId),
        );
        billTombstoneRequest.onsuccess = () => {
          if (billTombstoneRequest.result) return;
          const receiptRequest = receiptStore.get(snapshot.billId);
          receiptRequest.onsuccess = () => {
            const current = receiptRequest.result as RubberBillReceiptSnapshot | undefined;
            if (
              !current
              || snapshot.revisionNo > current.revisionNo
              || (
                snapshot.revisionNo === current.revisionNo
                && snapshot.serverReceivedAt >= current.serverReceivedAt
              )
            ) {
              receiptStore.put(snapshot);
            }
          };
        };
      };
    }
  });
}

export async function getRubberBillReceiptSnapshot(
  billId: string,
): Promise<RubberBillReceiptSnapshot | null> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RUBBER_BILL_RECEIPT_STORE, "readonly");
    const request = transaction.objectStore(RUBBER_BILL_RECEIPT_STORE).get(billId);
    request.onsuccess = () => resolve((request.result as RubberBillReceiptSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getRubberBillReceiptSnapshots(
  locationId: string,
): Promise<RubberBillReceiptSnapshot[]> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RUBBER_BILL_RECEIPT_STORE, "readonly");
    const request = transaction
      .objectStore(RUBBER_BILL_RECEIPT_STORE)
      .index("locationId")
      .getAll(locationId);
    request.onsuccess = () => {
      resolve(
        (request.result as RubberBillReceiptSnapshot[])
          .sort((a, b) =>
            b.serverReceivedAt.localeCompare(a.serverReceivedAt)
            || b.billId.localeCompare(a.billId)
          ),
      );
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function pruneRubberBillReceiptSnapshots(
  locationId: string,
  keep = 100,
): Promise<void> {
  const snapshots = await getRubberBillReceiptSnapshots(locationId);
  const stale = snapshots.slice(Math.max(keep, 0));
  if (stale.length === 0) return;

  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RUBBER_BILL_RECEIPT_STORE, "readwrite");
    const store = transaction.objectStore(RUBBER_BILL_RECEIPT_STORE);
    stale.forEach((snapshot) => store.delete(snapshot.billId));
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

export async function deleteRubberBillReceiptSnapshotsByClientTempId(
  locationId: string,
  clientTempId: string,
): Promise<void> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RUBBER_BILL_RECEIPT_STORE, "readwrite");
    const receiptStore = transaction.objectStore(RUBBER_BILL_RECEIPT_STORE);
    const cursorRequest = receiptStore.index("locationId").openCursor(locationId);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const snapshot = cursor.value as RubberBillReceiptSnapshot;
      if (snapshot.bill.clientTempId === clientTempId) cursor.delete();
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
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

export async function tombstoneRubberBillReceiptSnapshotsByClientTempId(
  locationId: string,
  clientTempId: string,
): Promise<void> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [RUBBER_BILL_RECEIPT_STORE, RUBBER_BILL_RECEIPT_TOMBSTONE_STORE],
      "readwrite",
    );
    const receiptStore = transaction.objectStore(RUBBER_BILL_RECEIPT_STORE);
    const tombstoneStore = transaction.objectStore(RUBBER_BILL_RECEIPT_TOMBSTONE_STORE);
    const key = clientTombstoneKey(locationId, clientTempId);
    const tombstone: RubberBillReceiptTombstone = {
      key,
    };
    tombstoneStore.put(tombstone);

    const cursorRequest = receiptStore.index("locationId").openCursor(locationId);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const snapshot = cursor.value as RubberBillReceiptSnapshot;
      if (snapshot.bill.clientTempId === clientTempId) cursor.delete();
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
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

export async function tombstoneRubberBillReceiptSnapshotByBillId(
  locationId: string,
  billId: string,
): Promise<void> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [RUBBER_BILL_RECEIPT_STORE, RUBBER_BILL_RECEIPT_TOMBSTONE_STORE],
      "readwrite",
    );
    const receiptStore = transaction.objectStore(RUBBER_BILL_RECEIPT_STORE);
    const tombstoneStore = transaction.objectStore(RUBBER_BILL_RECEIPT_TOMBSTONE_STORE);
    const key = billTombstoneKey(locationId, billId);
    const tombstone: RubberBillReceiptTombstone = {
      key,
    };
    tombstoneStore.put(tombstone);
    receiptStore.delete(billId);
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
