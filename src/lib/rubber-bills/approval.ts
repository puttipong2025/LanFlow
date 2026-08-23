import type { EffectiveRubberApprovalSettings } from "@/types";
import { bangkokDateString } from "@/lib/bangkok-date";

const CACHE_PREFIX = "lanflow:rubber-bill-approval-settings:v3:";

export type CachedRubberBillApprovalSettings = EffectiveRubberApprovalSettings & {
  cachedAt: string;
};

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function cacheKey(locationId: string) {
  return `${CACHE_PREFIX}${locationId}`;
}

export function isRubberBillPriceApprovalRequired(
  prices: number[],
  settings: Pick<EffectiveRubberApprovalSettings, "configuredPrice"> & { priceTimeExempt?: boolean },
) {
  if (settings.priceTimeExempt || settings.configuredPrice === null) return false;
  const capInSatang = Math.round(settings.configuredPrice * 100);
  return prices.some((price) => Math.round(price * 100) > capInSatang);
}

export function assertOfflineRubberBillPriceAllowed(
  prices: number[],
  billDate: string,
  settings: Pick<
    EffectiveRubberApprovalSettings,
    "configuredPrice" | "nonCurrentDateRequiresApproval"
  > & { priceTimeExempt?: boolean } | null,
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
  if (isRubberBillPriceApprovalRequired(prices, settings)) {
    throw new Error("ราคาบิลสูงกว่าราคายางที่กำหนด ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
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
    const hasValidPrice = parsed.configuredPrice === null || (
      typeof parsed.configuredPrice === "number"
      && Number.isFinite(parsed.configuredPrice)
      && parsed.configuredPrice >= 0
    );
    const hasValidCachedAt = typeof parsed.cachedAt === "string" && Number.isFinite(Date.parse(parsed.cachedAt));
    const isExempt = parsed.groupId === null
      && parsed.priceTimeExempt === true
      && parsed.editWindowMinutes === null
      && parsed.configuredPrice === null;
    const isGrouped = typeof parsed.groupId === "string"
      && parsed.groupId.length > 0
      && parsed.priceTimeExempt === false
      && Number.isInteger(parsed.editWindowMinutes)
      && (parsed.editWindowMinutes as number) >= 0
      && hasValidPrice;
    if (
      parsed.locationId !== locationId
      || typeof parsed.locationId !== "string"
      || typeof parsed.nonCurrentDateRequiresApproval !== "boolean"
      || !hasValidCachedAt
      || (!isExempt && !isGrouped)
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
