import type { RubberBillApprovalSettings } from "@/types";
import { bangkokDateString } from "@/lib/bangkok-date";

const CACHE_KEY = "lanflow:rubber-bill-approval-settings:v2";

export type CachedRubberBillApprovalSettings = Pick<
  RubberBillApprovalSettings,
  "editWindowMinutes" | "configuredPrice" | "nonCurrentDateRequiresApproval"
> & {
  cachedAt: string;
};

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function isRubberBillPriceApprovalRequired(
  prices: number[],
  configuredPrice: number | null
) {
  if (configuredPrice === null) return false;
  const capInSatang = Math.round(configuredPrice * 100);
  return prices.some((price) => Math.round(price * 100) > capInSatang);
}

export function assertOfflineRubberBillPriceAllowed(
  prices: number[],
  billDate: string,
  settings: Pick<RubberBillApprovalSettings, "editWindowMinutes" | "configuredPrice" | "nonCurrentDateRequiresApproval"> | null,
  isOnline: boolean,
) {
  if (isOnline) return;
  const isNonCurrentDate = billDate !== bangkokDateString();
  if (!settings) {
    if (!isNonCurrentDate) {
      throw new Error("เครื่องนี้ยังไม่เคยโหลดกติกาอนุมัติ กรุณาออนไลน์ก่อนสร้างบิล");
    }
    throw new Error("เครื่องนี้ยังไม่เคยโหลดกติกาอนุมัติ กรุณาออนไลน์ก่อนสร้างบิล");
  }
  if (isNonCurrentDate && settings.nonCurrentDateRequiresApproval) {
    throw new Error("บิลต่างจากวันปัจจุบัน ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
  }
  if (isRubberBillPriceApprovalRequired(prices, settings.configuredPrice)) {
    throw new Error("ราคาบิลสูงกว่าราคายางที่กำหนด ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
  }
}

export function saveRubberBillApprovalSettingsCache(
  settings: Pick<RubberBillApprovalSettings, "editWindowMinutes" | "configuredPrice" | "nonCurrentDateRequiresApproval">,
  cachedAt = new Date(),
  storage = browserStorage()
) {
  if (!storage) return;
  const cache: CachedRubberBillApprovalSettings = {
    editWindowMinutes: settings.editWindowMinutes,
    configuredPrice: settings.configuredPrice,
    nonCurrentDateRequiresApproval: settings.nonCurrentDateRequiresApproval,
    cachedAt: cachedAt.toISOString(),
  };
  storage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function loadRubberBillApprovalSettingsCache(
  storage = browserStorage()
): CachedRubberBillApprovalSettings | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(CACHE_KEY) ?? "null") as Partial<CachedRubberBillApprovalSettings> | null;
    if (
      !parsed
      || !Number.isInteger(parsed.editWindowMinutes)
      || (parsed.editWindowMinutes ?? -1) < 0
      || (
        parsed.configuredPrice !== null
        && (
          typeof parsed.configuredPrice !== "number"
          || !Number.isFinite(parsed.configuredPrice)
          || parsed.configuredPrice < 0
        )
      )
      || typeof parsed.cachedAt !== "string"
      || typeof parsed.nonCurrentDateRequiresApproval !== "boolean"
    ) {
      return null;
    }
    return parsed as CachedRubberBillApprovalSettings;
  } catch {
    return null;
  }
}
