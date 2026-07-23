import { formatCurrency } from "@/lib/format";
import type { CashBranchTransferStatus, CashDenominationCounts } from "@/types";

export const CASH_DENOMINATIONS: Array<[keyof CashDenominationCounts, string, number]> = [
  ["banknote1000", "แบงค์ 1,000", 1000],
  ["banknote500", "แบงค์ 500", 500],
  ["banknote100", "แบงค์ 100", 100],
  ["banknote50", "แบงค์ 50", 50],
  ["banknote20", "แบงค์ 20", 20],
  ["coin10", "เหรียญ 10", 10],
  ["coin5", "เหรียญ 5", 5],
  ["coin2", "เหรียญ 2", 2],
  ["coin1", "เหรียญ 1", 1],
];

export type CashCountValues = Record<keyof CashDenominationCounts, string>;

export function emptyCashCountValues(): CashCountValues {
  return {
    coin1: "",
    coin2: "",
    coin5: "",
    coin10: "",
    banknote20: "",
    banknote50: "",
    banknote100: "",
    banknote500: "",
    banknote1000: "",
  };
}

export function cashCountValues(counts: CashDenominationCounts): CashCountValues {
  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [key, String(value)]),
  ) as CashCountValues;
}

export function parseCashCounts(values: CashCountValues): CashDenominationCounts | null {
  const result = {} as CashDenominationCounts;
  for (const [key] of CASH_DENOMINATIONS) {
    if (values[key] === "" || !/^\d+$/.test(values[key])) return null;
    result[key] = Number(values[key]);
  }
  return result;
}

export function calculateCashTotal(counts: CashDenominationCounts | null) {
  return counts
    ? CASH_DENOMINATIONS.reduce((sum, [key, , value]) => sum + counts[key] * value, 0)
    : 0;
}

export function calculateCashDifferences(
  sent: CashDenominationCounts,
  received: CashDenominationCounts,
) {
  const byDenomination = Object.fromEntries(
    CASH_DENOMINATIONS.map(([key]) => [key, received[key] - sent[key]]),
  ) as CashDenominationCounts;
  return {
    byDenomination,
    total: calculateCashTotal(received) - calculateCashTotal(sent),
  };
}

export function cashTransferStatusLabel(status: CashBranchTransferStatus, differenceTotal: number | null) {
  if (status === "pending_receipt") return "รอรับเงิน";
  if (status === "received") return "รับเงินแล้ว";
  const difference = formatCurrency(differenceTotal ?? 0);
  return status === "mismatched" ? `ยอดไม่ตรง ${difference}` : `ยอมรับผลต่าง ${difference}`;
}

export function buildCashTransferCreatePayload(input: {
  sourceLocationId: string;
  targetLocationId: string;
  sent: CashDenominationCounts;
  note: string;
  clientTempId: string;
  idempotencyKey: string;
}) {
  return { ...input };
}

export function buildCashTransferUpdatePayload(input: {
  targetLocationId: string;
  sent: CashDenominationCounts;
  note: string;
}) {
  return { ...input };
}
