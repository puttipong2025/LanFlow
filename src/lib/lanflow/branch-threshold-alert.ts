import { parseRubberWeightAlertConfig, type RubberWeightAlertConfig } from "./rubber-weight-alert";

export type AlertKind = "cash" | "weight" | "count";
export type ThresholdCandidate = {
  kind: AlertKind; locationId: string; locationName: string;
  groupId: string; groupOrder: number; value: number; threshold: number; calculatedAt: string;
};
export type UnavailableAlert = {
  kind: AlertKind; locationId: string; locationName: string;
  reason: "missing_snapshot" | "not_ready" | "missing_metric";
};
export type BranchThresholdCheck = {
  config: RubberWeightAlertConfig;
  configuredCount: number; checkedCount: number;
  candidates: ThresholdCandidate[]; unavailable: UnavailableAlert[];
};
export const CASH_THRESHOLD_MIN = 10_000;
export const CASH_THRESHOLD_MAX = 1_000_000;
export function validCashThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value >= CASH_THRESHOLD_MIN && value <= CASH_THRESHOLD_MAX && Number(value.toFixed(2)) === value;
}
const kindValid = (value: unknown): value is AlertKind => value === "cash" || value === "weight" || value === "count";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parseBranchThresholdCheck(value: unknown): BranchThresholdCheck | null {
  if (!object(value)) return null;
  const config = parseRubberWeightAlertConfig(value.config);
  if (!config || !Array.isArray(value.candidates) || !Array.isArray(value.unavailable)
    || !Number.isSafeInteger(value.configuredCount) || Number(value.configuredCount) < 0
    || !Number.isSafeInteger(value.checkedCount) || Number(value.checkedCount) < 0) return null;
  const candidates: ThresholdCandidate[] = [];
  for (const item of value.candidates) {
    if (!object(item) || !kindValid(item.kind) || typeof item.locationId !== "string"
      || typeof item.locationName !== "string" || typeof item.groupId !== "string"
      || !Number.isInteger(item.groupOrder) || Number(item.groupOrder) < 1
      || typeof item.value !== "number" || !Number.isFinite(item.value)
      || typeof item.threshold !== "number" || !Number.isFinite(item.threshold)
      || typeof item.calculatedAt !== "string") return null;
    candidates.push(item as ThresholdCandidate);
  }
  const unavailable: UnavailableAlert[] = [];
  for (const item of value.unavailable) {
    if (!object(item) || !kindValid(item.kind) || typeof item.locationId !== "string"
      || typeof item.locationName !== "string"
      || !["missing_snapshot", "not_ready", "missing_metric"].includes(String(item.reason))) return null;
    unavailable.push(item as UnavailableAlert);
  }
  if (Number(value.checkedCount) + unavailable.length !== value.configuredCount
    || candidates.length > Number(value.checkedCount)) return null;
  return { config, candidates, unavailable, configuredCount: Number(value.configuredCount), checkedCount: Number(value.checkedCount) };
}
