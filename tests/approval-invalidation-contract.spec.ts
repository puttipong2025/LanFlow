import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { moneyFlowQueryKeys } from "../src/lib/money-flow/query-keys";

type Mutation = {
  mutationFn?: (variables: unknown) => Promise<unknown>;
  onError?: () => Promise<unknown>;
  onSuccess: (
    data: Record<string, unknown>,
    variables?: { id: string; locationId: string; ownerUserId: string },
  ) => Promise<unknown>;
};

// Execute the production hook callbacks; only React mounting and I/O are replaced.
function loadHook(path: string, hook: string, args: object = {}) {
  const mutations: Mutation[] = [];
  const invalidated: unknown[][] = [];
  const queryDataWrites: Array<{ queryKey: unknown[]; data: unknown }> = [];
  const requestedUrls: string[] = [];
  let clearedAllApprovalCaches = 0;
  const clearedApprovalCaches: string[][] = [];
  const tombstoned: Array<{ locationId: string; billId: string }> = [];
  const removedRubberBills: Array<{ ownerUserId: string; locationId: string; billId: string }> = [];
  const removedRubberApprovalRequests: Array<{
    ownerUserId: string;
    locationId: string;
    requestId: string;
  }> = [];
  let tombstoneFailure: Error | undefined;
  let feedRemovalFailure: Error | undefined;
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
        setQueryData: (queryKey: unknown[], data: unknown) => {
          queryDataWrites.push({ queryKey, data });
        },
      }),
    },
    react: { useEffect: () => {}, useState: (init: () => unknown) => [init(), () => {}] },
    "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({}) },
    "@/lib/supabase-browser": { createSupabaseBrowserClient: () => ({}) },
    "@/lib/rubber-bills/approval": {
      clearAllRubberBillApprovalSettingsCache: () => {
        clearedAllApprovalCaches += 1;
      },
      clearRubberBillApprovalSettingsCache: (locationIds: string[]) => {
        clearedApprovalCaches.push(locationIds);
      },
      loadRubberBillApprovalSettingsCache: () => null,
      saveRubberBillApprovalSettingsCache: () => {},
    },
    "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "actionableBadges" },
    "@/hooks/useRubberBillApprovals": {
      RUBBER_BILL_APPROVAL_SETTINGS_KEY: "rubberBillApprovalSettings",
    },
    "@/hooks/useStockProductApprovals": { STOCK_PRODUCT_APPROVAL_REQUESTS_KEY: "stockProductApprovalRequests" },
    "@/lib/money-flow/query-keys": { moneyFlowQueryKeys },
    "@/lib/auth-fetch": {
      authFetch: async (url: string) => {
        requestedUrls.push(url);
        return ({
        ok: true,
        json: async () => ({ status: "pending", requestId: "approval-request" }),
        });
      },
    },
    "@/lib/idb-queue": {
      tombstoneRubberBillReceiptSnapshotByBillId: async (locationId: string, billId: string) => {
        tombstoned.push({ locationId, billId });
        if (tombstoneFailure) throw tombstoneFailure;
      },
    },
    "@/lib/rubber-bills/feed-cache": {
      removeRubberBillFromOperationalFeedCacheByBillId: async (
        _queryClient: unknown,
        scope: { ownerUserId: string; locationId: string },
        billId: string,
      ) => {
        removedRubberBills.push({ ...scope, billId });
        if (feedRemovalFailure) throw feedRemovalFailure;
      },
      removeRubberBillApprovalRequestFromPendingFeedCache: async (
        _queryClient: unknown,
        scope: { ownerUserId: string; locationId: string },
        requestId: string,
      ) => {
        removedRubberApprovalRequests.push({ ...scope, requestId });
        if (feedRemovalFailure) throw feedRemovalFailure;
      },
    },
    "@/lib/income-expense/build-income-expense-payload": {
      buildIncomeExpensePayload: () => ({}),
    },
    "@/lib/income-expense/query-keys": { INCOME_EXPENSE_FEED_QUERY_KEY: "incomeExpenseFeed" },
    "@/lib/income-expense/approval-cache": {},
    "@/lib/bangkok-date": {},
    "@/lib/supabase-pages": { readAllSupabaseRows: () => Promise.resolve([]) },
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
  const hookResult = exports[hook](args);
  return {
    hookResult,
    mutations,
    invalidated,
    queryDataWrites,
    requestedUrls,
    get clearedAllApprovalCaches() { return clearedAllApprovalCaches; },
    clearedApprovalCaches,
    tombstoned,
    removedRubberBills,
    removedRubberApprovalRequests,
    failTombstone: () => { tombstoneFailure = new Error("TOMBSTONE_FAILED"); },
    failFeedRemoval: () => { feedRemovalFailure = new Error("FEED_REMOVAL_FAILED"); },
    release: () => releases.splice(0).forEach((resolve) => resolve()),
  };
}

test("Rubber approval group saves clear the Server-confirmed affected branches", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberApprovalGroups.ts",
    "useRubberApprovalGroups",
  );
  const confirmed = {
    group: {},
    affectedLocationIds: ["submitted-branch", "source-group-branch"],
  };

  for (const mutation of loaded.mutations.slice(0, 2)) {
    const result = mutation.onSuccess(confirmed);
    expect(loaded.clearedApprovalCaches.at(-1)).toEqual(confirmed.affectedLocationIds);
    loaded.release();
    await result;
  }
});

test("Rubber ungrouped defaults clear historical branch caches beyond the active response", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberApprovalGroups.ts",
    "useRubberApprovalGroups",
  );
  const result = loaded.mutations[4].onSuccess({
    ungroupedDefaults: {
      locationIds: ["active-ungrouped-branch"],
    },
  });

  expect(loaded.clearedAllApprovalCaches).toBe(1);
  expect(loaded.clearedApprovalCaches).toEqual([]);
  loaded.release();
  await result;
});

test("Rubber approval settings save keeps the submission branch after options change", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch-b" },
  );

  await loaded.mutations[0].mutationFn?.({
    nonCurrentDateRequiresApproval: true,
    locationId: "branch-a",
  });

  expect(loaded.requestedUrls).toEqual([
    "/api/lanflow/rubber-bills/approval-settings?locationId=branch-a",
  ]);
});

test("Rubber approval settings cache uses the saved branch after the filter changes in flight", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch-b" },
  );
  const settings = {
    locationId: "branch-a",
    nonCurrentDateRequiresApproval: true,
  };
  const result = loaded.mutations[0].onSuccess(settings);

  expect(loaded.queryDataWrites).toEqual([{
    queryKey: ["rubberBillApprovalSettings", "branch-a"],
    data: settings,
  }]);
  loaded.release();
  await result;
});

test("Rubber approval settings save clears persisted caches beyond the current branch list", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch-a" },
  );
  const result = loaded.mutations[0].onSuccess({
    locationId: "branch-a",
    nonCurrentDateRequiresApproval: true,
  });

  expect(loaded.clearedAllApprovalCaches).toBe(1);
  loaded.release();
  await result;
});

test("approved Rubber Bill delete tombstones its offline receipt before refreshing feeds", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch" },
  );
  const result = loaded.mutations[1].onSuccess({
    status: "approved",
    operation: "delete",
    billId: "bill-1",
  }, { id: "request-1", locationId: "branch", ownerUserId: "owner-1" });

  await expect.poll(() => loaded.tombstoned).toEqual([
    { locationId: "branch", billId: "bill-1" },
  ]);
  await expect.poll(() => loaded.invalidated.length).toBe(7);
  loaded.release();
  await result;
});

test("approved Rubber Bill delete removes the operational row before feed reconciliation", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch", ownerUserId: "owner-1" },
  );
  const result = loaded.mutations[1].onSuccess({
    status: "approved",
    operation: "delete",
    billId: "bill-1",
  }, { id: "request-1", locationId: "branch", ownerUserId: "owner-1" });

  await expect.poll(() => loaded.removedRubberBills).toEqual([{
    ownerUserId: "owner-1",
    locationId: "branch",
    billId: "bill-1",
  }]);
  loaded.release();
  await result;
});

test("deleted Rubber Bill approval request disappears before feed reconciliation", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch-b", ownerUserId: "owner-1" },
  );
  const result = loaded.mutations[2].onSuccess(
    { status: "deleted", requestId: "request-1" },
    { id: "request-1", locationId: "branch-a", ownerUserId: "owner-1" },
  );

  await expect.poll(() => loaded.removedRubberApprovalRequests).toEqual([{
    ownerUserId: "owner-1",
    locationId: "branch-a",
    requestId: "request-1",
  }]);
  loaded.release();
  await result;
});

test("approved Rubber Bill delete keeps the submission branch when the filter changes in flight", async () => {
  const latestRender = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch-b" },
  );
  const result = latestRender.mutations[1].onSuccess(
    {
      status: "approved",
      operation: "delete",
      billId: "bill-1",
    },
    { id: "request-1", locationId: "branch-a", ownerUserId: "owner-1" },
  );

  await expect.poll(() => latestRender.tombstoned).toEqual([
    { locationId: "branch-a", billId: "bill-1" },
  ]);
  latestRender.release();
  await result;
});

test("approved Rubber Bill delete still refreshes feeds when local cleanup fails", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch" },
  );
  loaded.failFeedRemoval();
  loaded.failTombstone();
  const result = loaded.mutations[1].onSuccess({
    status: "approved",
    operation: "delete",
    billId: "bill-1",
  }, { id: "request-1", locationId: "branch", ownerUserId: "owner-1" });

  await expect.poll(() => loaded.invalidated.length).toBe(7);
  loaded.release();
  expect(await result).toBeUndefined();
});

test("uncertain Rubber approval decisions refresh their authoritative owners", async () => {
  const loaded = loadHook(
    "src/hooks/useRubberBillApprovals.ts",
    "useRubberBillApprovals",
    { locationId: "branch" },
  );

  for (const [index, expectedInvalidations] of [[1, 7], [2, 3]] as const) {
    loaded.invalidated.length = 0;
    expect(loaded.mutations[index].onError).toBeDefined();
    const result = loaded.mutations[index].onError?.();
    await expect.poll(() => loaded.invalidated.length).toBe(expectedInvalidations);
    loaded.release();
    await result;
  }
});

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

test("pending income approval submission refreshes the queue, feed, and actionable badges before settling", async () => {
  const loaded = loadHook("src/hooks/useIncomeExpenseApprovals.ts", "useIncomeExpenseApprovals");
  const hookResult = loaded.hookResult as {
    submitForApprovalIfNeeded: (transaction: Record<string, unknown>, operation: "update") => Promise<unknown>;
  };
  let settled = false;
  const submitted = hookResult.submitForApprovalIfNeeded({
    billOption: "บิลขาย",
    txDate: "2026-09-07",
  }, "update").then((result) => {
    settled = true;
    return result;
  });

  await expect.poll(() => loaded.invalidated).toEqual([
    ["incomeExpenseApprovalRequests"],
    ["incomeExpenseFeed"],
    ["actionableBadges"],
  ]);
  expect(settled).toBe(false);
  loaded.release();
  expect(await submitted).toEqual({ requiresApproval: true });
});

test("shared money-flow refresh has no legacy Rubber approval query owners", () => {
  for (const path of ["src/lib/money-flow/query-keys.ts", "src/lib/money-flow/invalidation.ts"]) {
    expect(readFileSync(path, "utf8")).not.toMatch(/rubberBillApprovalMarkers|rubberBillApprovalRequests/);
  }
});
