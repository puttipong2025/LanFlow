import { getSyncDb, BUSINESS_CACHE_META_STORE, RUBBER_BILL_RECEIPT_STORE, RUBBER_BILL_RECEIPT_TOMBSTONE_STORE } from "@/lib/idb-core";
import type { RubberBillReceiptSnapshot } from "@/lib/rubber-bill-receipts-idb";
import { type CacheMetadata, type ReceiptCheck, validateReceiptChecks } from "./protocol";
import { buildRubberBillReceiptModel } from "@/components/rubber-bills/bill-display";

export async function readCacheMetadata(key: string): Promise<CacheMetadata | null> {
  const db = await getSyncDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BUSINESS_CACHE_META_STORE, "readonly");
    const request = tx.objectStore(BUSINESS_CACHE_META_STORE).get(key);
    tx.oncomplete = () => {
      db.close(); const row = request.result as CacheMetadata | undefined;
      resolve(row?.key === key && Number.isSafeInteger(row.version) && row.version > 0
        && typeof row.updatedAt === "string" && Number.isFinite(Date.parse(row.updatedAt)) ? row : null);
    };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// Metadata and the receipt changes share the same transaction. Queue/drafts are never cleared.
export async function commitCacheRefresh(metadata: CacheMetadata, expected: RubberBillReceiptSnapshot[] = [],
  checks: ReceiptCheck[] = [], locationId = "", signal?: AbortSignal) {
  validateReceiptChecks(checks, expected, locationId);
  if (signal?.aborted) throw new Error("การอัปเดตถูกยกเลิก");
  const db = await getSyncDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BUSINESS_CACHE_META_STORE, RUBBER_BILL_RECEIPT_STORE, RUBBER_BILL_RECEIPT_TOMBSTONE_STORE], "readwrite");
    const receipts = tx.objectStore(RUBBER_BILL_RECEIPT_STORE);
    const tombstones = tx.objectStore(RUBBER_BILL_RECEIPT_TOMBSTONE_STORE);
    const abort = () => { try { tx.abort(); } catch { /* Already committed. */ } };
    signal?.addEventListener("abort", abort, { once: true });
    const finish = (error?: unknown) => {
      signal?.removeEventListener("abort", abort); db.close();
      if (error) reject(error); else resolve();
    };
    tx.oncomplete = () => finish();
    tx.onabort = tx.onerror = () => finish(tx.error ?? new Error("เก็บข้อมูลแคชไม่สำเร็จ"));
    for (const check of checks) {
      const request = receipts.get(check.billId);
      request.onsuccess = () => {
        const current = request.result as RubberBillReceiptSnapshot | undefined;
        const before = expected.find(row => row.billId === check.billId)!;
        // Preserve concurrent additions/updates/removals, including deletion tombstones.
        if (!current || JSON.stringify(current) !== JSON.stringify(before)) { tx.abort(); return; }
        if (check.state === "deleted") {
          tombstones.put({ key: `bill:${locationId}:${check.billId}` });
          receipts.delete(check.billId);
        } else {
          const byBill = tombstones.get(`bill:${locationId}:${check.billId}`);
          const byClient = tombstones.get(`client:${locationId}:${check.snapshot.bill.clientTempId}`);
          byClient.onsuccess = () => {
            if (!byBill.result && !byClient.result) {
              const bill = check.snapshot.bill;
              receipts.put({ ...check.snapshot, bill, receipt: buildRubberBillReceiptModel(bill) });
            }
          };
        }
      };
    }
    const metadataStore = tx.objectStore(BUSINESS_CACHE_META_STORE);
    const latestMetadata = metadataStore.get(metadata.key);
    latestMetadata.onsuccess = () => {
      // Another tab may have completed a newer repair after our initial read.
      // Fence the write inside the same transaction as the receipt changes.
      if (latestMetadata.result?.version > metadata.version) { tx.abort(); return; }
      metadataStore.put(metadata);
    };
    if (signal?.aborted) abort();
  });
}
