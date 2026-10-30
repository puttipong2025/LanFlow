import type { RubberBillReceiptSnapshot } from "@/lib/rubber-bill-receipts-idb";

// Change only for a deliberate read-cache repair, independently from deployment IDs.
export const BUSINESS_CACHE_VERSIONS = { rubber: 1, income: 1 } as const;
export const BUSINESS_CACHE_PROTOCOL = 1;
export type CacheModule = keyof typeof BUSINESS_CACHE_VERSIONS;
export type CacheMetadata = { key: string; version: number; updatedAt: string };
export type ReceiptCheck = { billId: string; state: "active"; snapshot: RubberBillReceiptSnapshot }
  | { billId: string; state: "deleted"; revisionNo: number };

export function cacheMetadataKey(module: CacheModule, owner: string, branch: string) {
  return module === "rubber" ? `rubber:${branch}` : `income:${owner}:${branch}`;
}

export function validateReceiptChecks(value: unknown, expected: RubberBillReceiptSnapshot[], locationId: string): ReceiptCheck[] {
  if (!Array.isArray(value) || value.length !== expected.length) throw new Error("ตรวจข้อมูลบิลเดิมไม่ครบ");
  const ids = new Set(expected.map(row => row.billId));
  for (const row of value) {
    if (!row || !ids.delete(row.billId)) throw new Error("ข้อมูลอ้างอิงบิลไม่ตรงกัน");
    const before = expected.find(item => item.billId === row.billId)!;
    const revision = row.state === "active" ? row.snapshot?.revisionNo : row.revisionNo;
    if (!Number.isSafeInteger(revision) || revision < before.revisionNo) throw new Error("ข้อมูลบิลตอบกลับเป็นรุ่นเก่า");
    if (row.state === "active") {
      const s = row.snapshot;
      if (!s || s.billId !== row.billId || s.locationId !== locationId || s.bill?.id !== row.billId
        || s.bill.locationId !== locationId || s.bill.recordStatus !== "active" || s.bill.revisionNo !== revision
        || !s.serverBillNo || !s.receipt || typeof s.receipt !== "object") throw new Error("รูปแบบสำเนาบิลไม่ถูกต้อง");
    } else if (row.state !== "deleted") throw new Error("ยังยืนยันสถานะบิลไม่ได้");
  }
  return value;
}
