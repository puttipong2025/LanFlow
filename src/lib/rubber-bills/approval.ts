import type { EffectiveRubberApprovalSettings } from "@/types";
import { bangkokDateString } from "@/lib/bangkok-date";

const CACHE_PREFIX = "lanflow:rubber-bill-approval-settings:v4:";

export type CachedRubberBillApprovalSettings = EffectiveRubberApprovalSettings & {
  cachedAt: string;
};

function browserStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function cacheKey(locationId: string) {
  return `${CACHE_PREFIX}${locationId}`;
}

export function assertOfflineRubberBillPriceAllowed(
  prices: number[],
  billDate: string,
  settings: Pick<
    EffectiveRubberApprovalSettings,
    "effectivePriceCap" | "nonCurrentDateRequiresApproval"
  > | null,
  isOnline: boolean,
) {
  if (isOnline) return;
  if (!settings) {
    throw new Error("เครื่องนี้ยังไม่เคยโหลดกติกาอนุมัติ กรุณาออนไลน์ก่อนสร้างบิล");
  }
  const isNonCurrentDate = billDate !== bangkokDateString();
  if (isNonCurrentDate && settings.nonCurrentDateRequiresApproval) {
    throw new Error("บิลต่างจากวันปัจจุบัน ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
  }
  if (prices.some((price) => price > settings.effectivePriceCap)) {
    throw new Error("ราคาบิลสูงกว่าราคาสูงสุดที่กำหนด ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
  }
}

export function saveRubberBillApprovalSettingsCache(
  settings: EffectiveRubberApprovalSettings,
  cachedAt = new Date(),
  storage = browserStorage()
) {
  if (!storage) return;
  const cache: CachedRubberBillApprovalSettings = {
    ...settings,
    cachedAt: cachedAt.toISOString(),
  };
  try {
    storage.setItem(cacheKey(settings.locationId), JSON.stringify(cache));
  } catch {
    // Browser storage is an optional offline optimization.
  }
}

export function loadRubberBillApprovalSettingsCache(
  locationId: string,
  storage = browserStorage()
): CachedRubberBillApprovalSettings | null {
  if (!storage || !locationId) return null;
  try {
    const parsed = JSON.parse(storage.getItem(cacheKey(locationId)) ?? "null") as Partial<CachedRubberBillApprovalSettings> | null;
    if (!parsed) return null;
    const hasValidPrice = [parsed.centralPrice, parsed.priceAllowance, parsed.effectivePriceCap]
      .every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
    const hasPositiveCentralPrice = typeof parsed.centralPrice === "number" && parsed.centralPrice > 0;
    const hasValidCachedAt = typeof parsed.cachedAt === "string" && Number.isFinite(Date.parse(parsed.cachedAt));
    const hasValidSource = (parsed.ruleSource === "ungrouped" && parsed.groupId === null)
      || (parsed.ruleSource === "group"
      && typeof parsed.groupId === "string"
      && parsed.groupId.length > 0);
    const hasValidRule = hasValidSource
      && Number.isInteger(parsed.editWindowMinutes)
      && (parsed.editWindowMinutes as number) >= 0
      && Number.isInteger(parsed.priceRuleRevision)
      && (parsed.priceRuleRevision as number) > 0
      && hasValidPrice
      && hasPositiveCentralPrice
      && Math.round((parsed.centralPrice as number) * 100)
        + Math.round((parsed.priceAllowance as number) * 100)
        === Math.round((parsed.effectivePriceCap as number) * 100);
    if (
      parsed.locationId !== locationId
      || typeof parsed.locationId !== "string"
      || typeof parsed.nonCurrentDateRequiresApproval !== "boolean"
      || !hasValidCachedAt
      || !hasValidRule
    ) {
      return null;
    }
    return parsed as CachedRubberBillApprovalSettings;
  } catch {
    return null;
  }
}

export function clearRubberBillApprovalSettingsCache(locationIds: string[], storage = browserStorage()) {
  if (!storage) return;
  for (const locationId of locationIds) {
    try {
      storage.removeItem(cacheKey(locationId));
    } catch {
      // A successful Server mutation must not fail because local storage is unavailable.
    }
  }
}

export function clearAllRubberBillApprovalSettingsCache(storage = browserStorage()) {
  if (!storage) return;
  let keys: string[];
  try {
    keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key?.startsWith(CACHE_PREFIX) === true);
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Continue clearing any remaining cache entries when a storage shim fails selectively.
    }
  }
}
