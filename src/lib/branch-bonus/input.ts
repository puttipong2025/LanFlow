import { isJsonObject, isUuid } from "@/lib/validation/primitives";
import { BONUS_METRICS, type BonusSettings } from "@/types/branch-bonus";

export function newBonusSettings(): BonusSettings {
  return { exportIds: [], excludedKeys: [], excludedGroups: [], rate: 0,
    metrics: { burden: { weight: 0, target: null }, loss: { weight: 0, target: null }, counts: { weight: 0, target: null } } };
}

export function parseBonusSettings(value: unknown): BonusSettings | null {
  if (!isJsonObject(value) || Object.keys(value).some(key => !["exportIds", "excludedKeys", "excludedGroups", "rate", "metrics"].includes(key))) return null;
  const { exportIds, excludedKeys, excludedGroups, rate, metrics } = value;
  const stringArray = (v: unknown, limit: number): v is string[] => Array.isArray(v)
    && v.length <= limit && v.every(item => typeof item === "string" && item.length <= 100) && new Set(v).size === v.length;
  if (!stringArray(exportIds, 5000) || exportIds.length === 0 || !exportIds.every(isUuid)
    || !stringArray(excludedKeys, 50000) || !excludedKeys.every(key => /^(expense|withdrawal|payroll|transport|work|fee):[0-9a-f-]+$/i.test(key) && isUuid(key.split(":")[1]))
    || !stringArray(excludedGroups, 6) || !excludedGroups.every(key => ["expense", "withdrawal", "payroll", "transport", "work", "fee"].includes(key))
    || typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1000 || Number(rate.toFixed(4)) !== rate
    || !isJsonObject(metrics) || Object.keys(metrics).some(key => !BONUS_METRICS.includes(key as typeof BONUS_METRICS[number]))) return null;
  const result = newBonusSettings();
  const isTarget = (target: unknown): target is number => typeof target === "number" && Number.isFinite(target) && target >= 0 && target <= 99999999999;
  for (const key of BONUS_METRICS) {
    const metric = metrics[key];
    if (!isJsonObject(metric) || Object.keys(metric).some(field => !["weight", "target"].includes(field))
      || typeof metric.weight !== "number" || !Number.isFinite(metric.weight) || metric.weight < 0 || metric.weight > 100
      || Number(metric.weight.toFixed(2)) !== metric.weight
      || (key !== "counts" && metric.weight > 0 && metric.target != null && !isTarget(metric.target))) return null;
    // Keep valid legacy targets for exact request replay; the server derives new count goals.
    result.metrics[key] = { weight: metric.weight, target: metric.weight === 0 || !isTarget(metric.target) ? null : metric.target };
  }
  const ids = exportIds.map(id => id.toLowerCase()), exclusions = excludedKeys.map(key => key.toLowerCase());
  if (new Set(ids).size !== ids.length || new Set(exclusions).size !== exclusions.length) return null;
  return { ...result, exportIds: ids.sort(), excludedKeys: exclusions.sort(), excludedGroups: [...excludedGroups].sort(), rate };
}
