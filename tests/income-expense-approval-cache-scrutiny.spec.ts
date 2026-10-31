import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

const cacheFile = "src/lib/income-expense/approval-cache.ts";
const date = new Date("2026-11-01T00:00:00.000Z");
function storage(blockWrite = false, blockRemove = false): Storage {
  const rows = new Map<string, string>();
  return {
    get length() { return rows.size; }, clear: () => rows.clear(),
    getItem: key => rows.get(key) ?? null, key: index => [...rows.keys()][index] ?? null,
    setItem: (key, value) => { if (blockWrite) throw new Error("QuotaExceededError"); rows.set(key, value); },
    removeItem: key => { if (blockRemove) throw new Error("SecurityError"); rows.delete(key); },
  };
}
function cache(globals: Record<string, unknown> = {}) {
  return loadSourceModule<typeof import("../src/lib/income-expense/approval-cache")>(cacheFile, {}, globals);
}
function blockedWindow() {
  return Object.defineProperty({}, "localStorage", { get() { throw new Error("SecurityError"); } });
}

test("blocked localStorage getter does not escape cache writes", () => {
  const module = cache({ window: blockedWindow() });
  expect(() => module.saveIncomeExpenseApprovalSettingsCache(true, date)).not.toThrow();
});

test("blocked localStorage getter is treated as a missing cache", () => {
  const module = cache({ window: blockedWindow() });
  expect(module.loadIncomeExpenseApprovalSettingsCache()).toBeNull();
});

test("quota failure cannot escape after a committed settings write", () => {
  const module = cache();
  expect(() => module.saveIncomeExpenseApprovalSettingsCache(true, date, storage(true))).not.toThrow();
});

test("normal storage retains both false and true policy values", () => {
  const module = cache(); const local = storage();
  for (const value of [false, true]) {
    module.saveIncomeExpenseApprovalSettingsCache(value, date, local);
    expect(module.loadIncomeExpenseApprovalSettingsCache(local)).toEqual({ nonCurrentDateRequiresApproval: value, cachedAt: date.toISOString() });
  }
});

for (const blockRemove of [false, true]) test(`a failed cache replacement invalidates the old date policy with blocked removal=${blockRemove}`, () => {
  const module = cache(); const local = storage(false, blockRemove);
  module.saveIncomeExpenseApprovalSettingsCache(false, date, local);
  const normalWrite = local.setItem;
  local.setItem = () => { throw new Error("QuotaExceededError"); };
  try { module.saveIncomeExpenseApprovalSettingsCache(true, date, local); } catch { /* Inspect the old cache even on the broken implementation. */ }
  expect(module.loadIncomeExpenseApprovalSettingsCache(local)).toBeNull();
  expect(() => module.assertOfflineIncomeExpenseDateAllowed("2026-10-01", module.loadIncomeExpenseApprovalSettingsCache(local), false)).toThrow("ยังไม่เคยโหลด");
  local.setItem = normalWrite;
  module.saveIncomeExpenseApprovalSettingsCache(true, date, local);
  expect(module.loadIncomeExpenseApprovalSettingsCache(local)?.nonCurrentDateRequiresApproval).toBe(true);
});

test("cleanup failure is also contained when storage is unavailable", () => {
  const module = cache();
  expect(() => module.saveIncomeExpenseApprovalSettingsCache(true, date, storage(true, true))).not.toThrow();
});

test("server rendering needs no browser storage", () => {
  const module = cache();
  expect(() => module.saveIncomeExpenseApprovalSettingsCache(true, date)).not.toThrow();
  expect(module.loadIncomeExpenseApprovalSettingsCache()).toBeNull();
});

for (const blocked of [false, true]) test(`production post-commit callback remains successful with blocked storage=${blocked}`, async () => {
  const mutations: Array<{ onSuccess: (patch: { nonCurrentDateRequiresApproval: boolean }) => Promise<unknown> }> = [];
  let current: Record<string, unknown> = { nonCurrentDateRequiresApproval: false };
  let refreshes = 0;
  const local = storage(blocked);
  const module = loadSourceModule<typeof import("../src/hooks/useIncomeExpenseApprovals")>("src/hooks/useIncomeExpenseApprovals.ts", {
    react: { useEffect: () => {} },
    "@tanstack/react-query": {
      useQuery: () => ({}), useMutation: (options: typeof mutations[number]) => { mutations.push(options); return {}; },
      useQueryClient: () => ({ cancelQueries: async () => {},
        setQueryData: (_key: unknown, update: (value: typeof current) => typeof current) => { current = update(current); },
        invalidateQueries: async () => { refreshes++; },
      }),
    },
    "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({}) },
    "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "actionableBadges" },
    "@/lib/connectivity": { getConnectivitySnapshot: () => true },
  }, { window: { localStorage: local } });
  module.useIncomeExpenseApprovals();
  const error = await mutations[2].onSuccess({ nonCurrentDateRequiresApproval: true }).then(() => null, error => error);
  expect(error).toBeNull();
  expect(current.nonCurrentDateRequiresApproval).toBe(true);
  expect(refreshes).toBe(1);
});
