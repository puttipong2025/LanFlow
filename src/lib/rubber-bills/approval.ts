import type { EffectiveRubberApprovalSettings } from "@/types";
import { bangkokDateString } from "@/lib/bangkok-date";

const CACHE_PREFIX = "lanflow:rubber-bill-approval-settings:v4:";

export type CachedRubberBillApprovalSettings = EffectiveRubberApprovalSettings & {
  cachedAt: string;
};

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
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
  const capInSatang = Math.round(settings.effectivePriceCap * 100);
  if (prices.some((price) => Math.round(price * 100) > capInSatang)) {
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
  storage.setItem(cacheKey(settings.locationId), JSON.stringify(cache));
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
  for (const locationId of locationIds) storage.removeItem(cacheKey(locationId));
}
