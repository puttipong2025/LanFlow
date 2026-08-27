import { formatCurrency } from "@/lib/format";
import type { CashBranchTransferStatus, CashDenominationCounts } from "@/types";

export type CashDenominationUnit = "ใบ" | "เหรียญ";

export const CASH_DENOMINATIONS: Array<[
  keyof CashDenominationCounts,
  string,
  number,
  CashDenominationUnit,
]> = [
  ["banknote1000", "แบงค์ 1,000", 1000, "ใบ"],
  ["banknote500", "แบงค์ 500", 500, "ใบ"],
  ["banknote100", "แบงค์ 100", 100, "ใบ"],
  ["banknote50", "แบงค์ 50", 50, "ใบ"],
  ["banknote20", "แบงค์ 20", 20, "ใบ"],
  ["coin10", "เหรียญ 10", 10, "เหรียญ"],
  ["coin5", "เหรียญ 5", 5, "เหรียญ"],
  ["coin2", "เหรียญ 2", 2, "เหรียญ"],
  ["coin1", "เหรียญ 1", 1, "เหรียญ"],
];

export type CashCountValues = Record<keyof CashDenominationCounts, string>;

export function zeroCashCountValues(): CashCountValues {
  return Object.fromEntries(
    CASH_DENOMINATIONS.map(([key]) => [key, "0"]),
  ) as CashCountValues;
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
  return differenceTotal
    ? `รับเงินแล้ว · ผลต่าง ${formatCurrency(differenceTotal)}`
    : "รับเงินแล้ว";
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
