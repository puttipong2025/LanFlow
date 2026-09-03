import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { moneyFlowQueryKeys } from "../src/lib/money-flow/query-keys";

type Mutation = { onSuccess: (data: { status: string }) => Promise<unknown> };

// Execute the production hook callbacks; only React mounting and I/O are replaced.
function loadHook(path: string, hook: string, args: object = {}) {
  const mutations: Mutation[] = [];
  const invalidated: unknown[][] = [];
  const releases: Array<() => void> = [];
  const dependencies: Record<string, unknown> = {
    "@tanstack/react-query": {
      useQuery: () => ({}),
      useMutation: (options: Mutation) => { mutations.push(options); return {}; },
      useQueryClient: () => ({
        invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
          invalidated.push(queryKey);
          return new Promise<void>((resolve) => releases.push(resolve));
        },
      }),
    },
    react: { useEffect: () => {}, useState: (init: () => unknown) => [init(), () => {}] },
    "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({}) },
    "@/lib/supabase-browser": { createSupabaseBrowserClient: () => ({}) },
    "@/lib/rubber-bills/approval": { loadRubberBillApprovalSettingsCache: () => null },
    "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "actionableBadges" },
    "@/hooks/useStockProductApprovals": { STOCK_PRODUCT_APPROVAL_REQUESTS_KEY: "stockProductApprovalRequests" },
    "@/lib/money-flow/query-keys": { moneyFlowQueryKeys },
    "@/lib/auth-fetch": {},
    "@/lib/income-expense/build-income-expense-payload": {},
    "@/lib/income-expense/query-keys": { INCOME_EXPENSE_FEED_QUERY_KEY: "incomeExpenseFeed" },
    "@/lib/income-expense/approval-cache": {},
    "@/lib/bangkok-date": {},
  };
  const exports: Record<string, (args: object) => unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: (id: string) => {
      if (!(id in dependencies)) throw new Error(`Unmocked dependency: ${id}`);
      return dependencies[id];
    },
  });
  exports[hook](args);
  return { mutations, invalidated, release: () => releases.splice(0).forEach((resolve) => resolve()) };
}

for (const [hook, queue, downstream] of [
  ["useStockEntryApprovals", "stockEntryApprovalRequests", ["stock"]],
  ["useStockProductApprovals", "stockProductApprovalRequests", ["stockProducts", "incomeSaleItems", "stock"]],
] as const) {
  for (const status of ["approved", "rejected"] as const) {
    test(`${hook} invalidates only server-confirmed ${status} owners and awaits them`, async () => {
      const loaded = loadHook(`src/hooks/${hook}.ts`, hook);
      let settled = false;
      const result = loaded.mutations[0].onSuccess({ status }).then(() => { settled = true; });
      expect(loaded.invalidated.map((key) => key[0]).sort()).toEqual([
        queue, "actionableBadges", ...(status === "approved" ? downstream : []),
      ].sort());
      await Promise.resolve();
      expect(settled).toBe(false);
      loaded.release();
      await result;
      expect(settled).toBe(true);
    });
  }
}

for (const [index, status] of [[1, "approved"], [2, "deleted"]] as const) {
  test(`Rubber ${status} uses real feed owners without an orphan queue key`, async () => {
    const loaded = loadHook("src/hooks/useRubberBillApprovals.ts", "useRubberBillApprovals", { locationId: "branch" });
    const result = loaded.mutations[index].onSuccess({ status });
    expect(loaded.invalidated).toEqual([
      moneyFlowQueryKeys.rubberBillOperationalFeedRoot(),
      moneyFlowQueryKeys.rubberBillWorkCountsRoot(),
      ["actionableBadges"],
      ...(status === "approved" ? [
        moneyFlowQueryKeys.moneyTransferListRoot(),
        moneyFlowQueryKeys.moneyTransferSourcesRoot(),
        moneyFlowQueryKeys.incomeExpenseFeedRoot(),
        moneyFlowQueryKeys.stockRoot(),
      ] : []),
    ]);
    loaded.release();
    await result;
  });
}

test("pending product create/delete refresh only their approval queue", async () => {
  const loaded = loadHook("src/hooks/useAcidProducts.ts", "useAcidProducts");
  for (const mutation of loaded.mutations) {
    loaded.invalidated.length = 0;
    const result = mutation.onSuccess({ status: "pending" });
    expect(loaded.invalidated).toEqual([["stockProductApprovalRequests"]]);
    loaded.release();
    await result;
  }
});

for (const hook of ["useCustomers", "useTransportStaffs", "useIncomeSaleItems"]) {
  test(`${hook} keeps every mutation pending until its list refresh completes`, async () => {
    const loaded = loadHook(`src/hooks/${hook}.ts`, hook);
    expect(loaded.mutations.length).toBeGreaterThan(0);
    for (const mutation of loaded.mutations) {
      let settled = false;
      const result = Promise.resolve(mutation.onSuccess({ status: "synced" })).then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      loaded.release();
      await result;
    }
  });
}

test("income approval settings and decisions await every affected owner", async () => {
  const loaded = loadHook("src/hooks/useIncomeExpenseApprovals.ts", "useIncomeExpenseApprovals");
  for (const [index, mutation] of loaded.mutations.entries()) {
    loaded.invalidated.length = 0;
    let settled = false;
    const result = Promise.resolve(mutation.onSuccess({ status: "approved" })).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    if (index === 3) expect(loaded.invalidated).toContainEqual(["stock"]);
    loaded.release();
    await result;
  }
});

test("shared money-flow refresh has no legacy Rubber approval query owners", () => {
  for (const path of ["src/lib/money-flow/query-keys.ts", "src/lib/money-flow/invalidation.ts"]) {
    expect(readFileSync(path, "utf8")).not.toMatch(/rubberBillApprovalMarkers|rubberBillApprovalRequests/);
  }
});
