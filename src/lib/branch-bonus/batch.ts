import { isJsonObject, isUuid } from "@/lib/validation/primitives";
import { BONUS_METRICS, type BonusBatchIntent, type BonusBatchPart } from "@/types/branch-bonus";
import { parseBonusSettings } from "./input";

export function parseBonusBatch(value: unknown, confirmation = false): BonusBatchPart[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const result: BonusBatchPart[] = [];
  let exports = 0, exclusions = 0;
  for (const part of value) {
    if (!isJsonObject(part) || Object.keys(part).some(k => !["key", "input", "expected", "finalAmount"].includes(k))
      || typeof part.key !== "string" || !/^\d{1,6}$/.test(part.key) || result.some(p => p.key === part.key)) return null;
    const input = parseBonusSettings(part.input);
    if (!input || Number(input.rate.toFixed(2)) !== input.rate || BONUS_METRICS.some(k => !Number.isInteger(input.metrics[k].weight)
      || (k !== "counts" && input.metrics[k].weight > 0 && input.metrics[k].target !== null
        && Number(input.metrics[k].target!.toFixed(2)) !== input.metrics[k].target))) return null;
    exports += input.exportIds.length; exclusions += input.excludedKeys.length;
    if (exports > 5000 || exclusions > 50000) return null;
    if (confirmation && (typeof part.expected !== "string" || !/^[a-f0-9]{32}$/.test(part.expected))) return null;
    if (part.finalAmount !== undefined && part.finalAmount !== null && (typeof part.finalAmount !== "number"
      || !Number.isFinite(part.finalAmount) || part.finalAmount < 0 || part.finalAmount > 9999999999.99
      || Number(part.finalAmount.toFixed(2)) !== part.finalAmount)) return null;
    result.push({ key: part.key, input, ...(typeof part.expected === "string" ? { expected: part.expected } : {}),
      ...(part.finalAmount !== undefined ? { finalAmount: part.finalAmount as number | null } : {}) });
  }
  return result;
}

const storageKey = (owner: string, location: string) => `lanflow:bonus-batch:${owner}:${location}`;
export function readBonusBatchIntent(owner: string, location: string): BonusBatchIntent | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey(owner, location)) ?? "null");
    return isJsonObject(raw) && raw.version === 1 && raw.ownerId === owner && raw.locationId === location && isUuid(raw.id)
      && typeof raw.review === "string" && /^[a-f0-9]{32}$/.test(raw.review) && parseBonusBatch(raw.periods, true)
      ? raw as BonusBatchIntent : null;
  } catch { return null; }
}
export function saveBonusBatchIntent(intent: BonusBatchIntent) {
  window.localStorage.setItem(storageKey(intent.ownerId, intent.locationId), JSON.stringify(intent));
}
export function clearBonusBatchIntent(owner: string, location: string) {
  window.localStorage.removeItem(storageKey(owner, location));
}
