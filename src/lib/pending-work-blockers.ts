export const PENDING_WORK_BLOCKER_LABELS = {
  rubber_bill_pending: "บิลยางที่ยังไม่พร้อม",
  income_expense_approval_pending: "คำขอรับ–จ่ายรออนุมัติ",
  cash_transfer_delete_pending: "คำขอลบรายการโยกเงินสด",
  stock_entry_delete_pending: "คำขอลบรายการสต็อก",
  cash_transfer_receipt_pending: "เงินสดโอนเข้าสาขาที่ยังไม่รับ",
  branch_transfer_receipt_pending: "เงินโอนเข้าบัญชีสาขาที่ยังไม่ยืนยันรับ",
  branch_transfer_delete_pending: "คำขอลบรายการโอนเข้าบัญชีสาขา",
} as const;

export type PendingWorkBlockerKey = keyof typeof PENDING_WORK_BLOCKER_LABELS;

export type PendingWorkBlocker = {
  key: PendingWorkBlockerKey;
  label: string;
  count: number;
};

const blockerOrder = Object.keys(PENDING_WORK_BLOCKER_LABELS) as PendingWorkBlockerKey[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlockerKey(value: unknown): value is PendingWorkBlockerKey {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(PENDING_WORK_BLOCKER_LABELS, value);
}

export function parsePendingWorkDetail(value: unknown): PendingWorkBlocker[] | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.blockers)) {
    return null;
  }

  const seen = new Set<PendingWorkBlockerKey>();
  const blockers: PendingWorkBlocker[] = [];

  for (const item of value.blockers) {
    if (!isRecord(item) || Object.keys(item).length !== 2) return null;
    if (!isBlockerKey(item.key) || !Number.isSafeInteger(item.count) || Number(item.count) <= 0) {
      return null;
    }
    if (seen.has(item.key)) return null;
    seen.add(item.key);
    blockers.push({
      key: item.key,
      label: PENDING_WORK_BLOCKER_LABELS[item.key],
      count: Number(item.count),
    });
  }

  if (blockers.length === 0) return null;
  return blockers.sort((left, right) => blockerOrder.indexOf(left.key) - blockerOrder.indexOf(right.key));
}

export function parsePendingWorkApiBody(value: unknown): PendingWorkBlocker[] | null {
  if (!isRecord(value) || !Array.isArray(value.blockers)) return null;
  return parsePendingWorkDetail({
    blockers: value.blockers.map((item) => {
      if (!isRecord(item)) return item;
      return { key: item.key, count: item.count };
    }),
  });
}
