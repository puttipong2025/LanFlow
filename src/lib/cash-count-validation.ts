import { CASH_DENOMINATIONS, type CashCounts } from "@/types/cash-counts";

export function validCashCountCounts(value: unknown): value is CashCounts {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== CASH_DENOMINATIONS.length) return false;
  const counts = value as Record<string, unknown>;
  return CASH_DENOMINATIONS.every((denomination) => typeof counts[denomination] === "number"
    && Number.isInteger(counts[denomination]) && Number(counts[denomination]) >= 0 && Number(counts[denomination]) <= 10_000_000);
}
