import { bangkokDateString } from "@/lib/bangkok-date";

const CACHE_KEY = "lanflow:income-expense-approval-settings:v1";
const invalidatedStorage = new WeakSet<Storage>();

export type CachedIncomeExpenseApprovalSettings = {
  nonCurrentDateRequiresApproval: boolean;
  cachedAt: string;
};

function browserStorage() {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function saveIncomeExpenseApprovalSettingsCache(
  nonCurrentDateRequiresApproval: boolean,
  cachedAt = new Date(),
  storage = browserStorage(),
) {
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({
      nonCurrentDateRequiresApproval,
      cachedAt: cachedAt.toISOString(),
    } satisfies CachedIncomeExpenseApprovalSettings));
    invalidatedStorage.delete(storage);
  } catch {
    // Optional cache failure must not turn an acknowledged server write into failure.
    invalidatedStorage.add(storage);
    try { storage.removeItem(CACHE_KEY); } catch { /* Reads remain blocked for this storage instance. */ }
  }
}

export function loadIncomeExpenseApprovalSettingsCache(
  storage = browserStorage(),
): CachedIncomeExpenseApprovalSettings | null {
  if (!storage || invalidatedStorage.has(storage)) return null;
  try {
    const parsed = JSON.parse(storage.getItem(CACHE_KEY) ?? "null") as Partial<CachedIncomeExpenseApprovalSettings> | null;
    return parsed
      && typeof parsed.nonCurrentDateRequiresApproval === "boolean"
      && typeof parsed.cachedAt === "string"
      ? parsed as CachedIncomeExpenseApprovalSettings
      : null;
  } catch {
    return null;
  }
}

export function assertOfflineIncomeExpenseDateAllowed(
  txDate: string,
  settings: CachedIncomeExpenseApprovalSettings | null,
  isOnline: boolean,
) {
  if (isOnline || txDate === bangkokDateString()) return;
  if (!settings) {
    throw new Error("เครื่องนี้ยังไม่เคยโหลดกติกาอนุมัติ กรุณาออนไลน์ก่อนบันทึกรายการต่างวัน");
  }
  if (settings.nonCurrentDateRequiresApproval) {
    throw new Error("รายการต่างจากวันปัจจุบัน ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
  }
}
