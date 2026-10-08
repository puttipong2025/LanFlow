import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { moneyFlowQueryKeys } from "../src/lib/money-flow/query-keys";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Run the production functions, replacing only React scheduling and I/O.
function runtime() {
  const slots: any[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  function memo(value: () => any, deps: unknown[]) {
    const index = cursor++;
    const prior = slots[index];
    if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
      slots[index] = { value: value(), deps };
    }
    return slots[index].value;
  }
  return {
    react: {
      useState(initial: any) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value: any) => {
          slots[index] = typeof value === "function" ? value(slots[index]) : value;
        }];
      },
      useRef(initial: any) {
        const index = cursor++;
        return slots[index] ?? (slots[index] = { current: initial });
      },
      useCallback: (fn: any, deps: unknown[]) => memo(() => fn, deps),
      useMemo: memo,
      useEffect(fn: () => void | (() => void), deps: unknown[]) {
        const index = cursor++;
        const prior = slots[index];
        if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
          effects.push(() => { prior?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
        }
      },
    },
    render<T>(fn: () => T): T {
      cursor = 0;
      const value = fn();
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      return value;
    },
  };
}

function load(path: string, mocks: Record<string, any>, globals: Record<string, any> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, AbortController, URLSearchParams, Error,
    window: { setTimeout: () => 0, clearTimeout: () => {} },
    require: (id: string) => {
      if (!(id in mocks)) throw new Error(`Unmocked dependency: ${id}`);
      return mocks[id];
    },
    ...globals,
  });
  return exports;
}

const auth = (fetch: any) => ({
  authFetch: fetch,
  assertApiResponse: async (response: any) => {
    if (!response.ok) throw new Error((await response.json()).error);
  },
});
const response = (body: any, ok = true) => ({ ok, json: async () => body });

function exportHarness() {
  const react = runtime();
  let location = "a";
  let deleted = false;
  let fail: "list" | "deletions" | null = null;
  let delayList: ReturnType<typeof deferred<any>> | null = null;
  let delayDelete: ReturnType<typeof deferred<any>> | null = null;
  let delayDeletions: ReturnType<typeof deferred<any>> | null = null;
  let deletes = 0;
  const rows = () => deleted ? [] : [{ id: "export-a" }];
  const hook = load("src/hooks/useRubberExports.ts", {
    react: react.react,
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "@/hooks/useActionableBadges": { ACTIONABLE_BADGES_QUERY_KEY: "actionableBadges" },
    "@/lib/auth-fetch": auth(async (url: string, init: any = {}) => {
      if (init.method === "DELETE") {
        deletes++;
        if (delayDelete) await delayDelete.promise;
        deleted = true;
        return response({});
      }
      const params = new URL(url, "http://local").searchParams;
      if (params.get("view") === "deletions") {
        if (delayDeletions) { const pending = delayDeletions; delayDeletions = null; return pending.promise; }
        return response(fail === "deletions" ? { error: "AUDIT_FAILED" } : { deletions: [], hasMore: false }, fail !== "deletions");
      }
      const body = { exports: params.get("locationId") === "b" ? [{ id: "export-b" }] : rows(), permissions: { canDelete: true, canVerify: true }, hasMore: false };
      if (delayList) { const pending = delayList; delayList = null; return pending.promise; }
      return response(fail === "list" ? { error: "LIST_FAILED" } : body, fail !== "list");
    }),
  });
  return {
    render: () => react.render(() => hook.useRubberExports(location, true, "active")),
    switchBranch: () => { location = "b"; },
    fail: (value: typeof fail) => { fail = value; },
    delayList: () => (delayList = deferred()),
    delayDelete: () => (delayDelete = deferred()),
    delayDeletions: () => (delayDeletions = deferred()),
    writes: () => deletes,
  };
}

for (const failure of [null, "list", "deletions"] as const) {
  test(`Export confirmed delete survives ${failure ?? "successful"} reconciliation`, async () => {
    const h = exportHarness(); h.render(); await tick();
    expect(h.render().exports).toHaveLength(1);
    h.fail(failure);
    await h.render().remove("export-a");
    expect(h.render().exports).toEqual([]);
    if (failure) {
      expect(h.render().deletionRefreshError).toBeTruthy();
      h.fail(null);
      await h.render().refreshAfterDelete();
      expect(h.render().deletionRefreshError).toBeNull();
    }
    expect(h.writes()).toBe(1);
  });
}

test("Export ignores pre-delete and old-branch responses", async () => {
  const h = exportHarness(); h.render(); await tick();
  const oldList = h.delayList();
  const reading = h.render().reload();
  await h.render().remove("export-a");
  oldList.resolve(response({ exports: [{ id: "export-a" }], permissions: {} }));
  await reading;
  expect(h.render().exports).toEqual([]);
  const oldDelete = h.delayDelete();
  const deleting = h.render().remove("another-a");
  h.switchBranch(); h.render(); await tick();
  oldDelete.resolve(response({})); await deleting;
  expect(h.render().exports.map((row: any) => row.id)).toEqual(["export-b"]);
});

test("Export ignores a delayed audit failure from the previous branch", async () => {
  const h = exportHarness(); h.render(); await tick();
  const delayed = h.delayDeletions();
  const reading = h.render().reloadDeletions();
  h.switchBranch(); h.render(); await tick();
  delayed.reject(new Error("OLD_BRANCH_READ_FAILED")); await reading;
  expect(h.render().deletionsError).toBeNull();
  expect(h.render().exports.map((row: any) => row.id)).toEqual(["export-b"]);
});

function flatten(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  return [node, ...flatten(node.props?.children)];
}

for (const failure of ["POST403", "POST409", "POST500", "POST500+GET503", "CALLBACK", null]) {
  test(`Branch Receipt preserves outcome after ${failure ?? "success"}`, async () => {
    const react = runtime(); let writes = 0;
    const jsx = (type: any, props: any) => ({ type, props });
    const component = load("src/components/rubber-bills/BranchRubberReceiptModal.tsx", {
      react: react.react, "react/jsx-runtime": { jsx, jsxs: jsx },
      "lucide-react": { PackagePlus: "icon", Search: "icon" },
      "@/components/shared/ModalShell": { ModalShell: "dialog" },
      "@/components/shared/NumberField": { NumberField: "input" },
      "@/lib/bangkok-date": { formatBangkokDateTime: String },
      "@/lib/format": { formatNumber: String },
      "@/lib/rubber-bills/calculations": {
        hasAtMostTwoDecimalPlaces: () => true,
        prorateMoneyHalfUp: () => 0,
      },
      "@/lib/rubber-exports/rubber-export-presentation": { formatRubberAge: String },
      "@/lib/auth-fetch": auth(async (_url: string, init: any = {}) => {
        if (init.method === "POST") {
          writes++;
          return response(failure?.startsWith("POST") ? { error: "SERVER_REJECTED" } : { billNo: "B1" }, !failure?.startsWith("POST"));
        }
        return response(writes && failure?.includes("GET503") ? { error: "READ_FAILED" } : {
          candidates: [{ sourceRubberExportId: "e1", sourceExportNo: "E1" }], hasMore: false,
        }, !(writes && failure?.includes("GET503")));
      }),
    });
    const render = () => flatten(react.render(() => component.BranchRubberReceiptModal({
      destinationLocationId: "a", destinationLocationName: "A", onClose: () => {},
      onReceived: async () => { if (failure === "CALLBACK") throw new Error("REFRESH_FAILED"); },
    })));
    render(); await tick();
    render().find((node) => node.props?.type === "radio").props.onChange();
    render().find((node) => node.type === "button" && node.props.children?.includes?.("ยืนยันรับเข้าสาขา")).props.onClick();
    await tick();
    const tree = render();
    const alerts = tree.filter((node) => node.props?.role === "alert").map((node) => node.props.children);
    if (failure?.startsWith("POST")) expect(alerts.join(" ")).toContain("SERVER_REJECTED");
    else expect(alerts).toEqual([]);
    if (failure === "CALLBACK") expect(tree.filter((node) => node.props?.role === "status").length).toBeGreaterThan(0);
    expect(writes).toBe(1);
  });
}

function stockHarness(count: number, stop: "failure" | "offline" | "network" | null = null) {
  const mutations: any[] = []; const reads: Array<ReturnType<typeof deferred<void>>> = [];
  const keys: unknown[][] = []; const options: any[] = []; const removed: number[] = []; const updated: any[] = [];
  const navigator = { onLine: true }; let posts = 0;
  const events = Array.from({ length: count }, (_, i) => ({
    id: `e${i}`, queueId: i, timestamp: i, status: "pending", entity: "rubber_bills",
    payload: { items: [{ itemType: "stock_deduction", stockProductId: "p1", quantity: 1 }] },
  }));
  const hook = load("src/hooks/useStockSyncRetry.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: (filter: any, option: any) => {
        keys.push(filter.queryKey); options.push(option); const read = deferred(); reads.push(read); return read.promise;
      } }),
      useMutation: (mutation: any) => { mutations.push(mutation); return { mutateAsync: mutation.mutationFn }; },
    },
    "@/lib/idb-queue": {
      getPendingEvents: async ({ entity }: any) => entity === "rubber_bills" ? events : [],
      removeSyncEvent: async (id: number) => { removed.push(id); if (stop === "offline") navigator.onLine = false; },
      updateSyncEvent: async (event: any) => { updated.push(event); },
    },
    "@/lib/auth-fetch": { authFetch: async () => {
      posts++;
      if (stop === "network" && posts === count) throw new Error("NETWORK_FAILED");
      return response({ status: "conflict", errorMessage: "STOCK_FAILED" }, !(stop === "failure" && posts === count));
    } },
    "@/lib/money-flow/query-keys": { moneyFlowQueryKeys },
  }, { navigator });
  const api = hook.useStockSyncRetry("a", "u");
  return { api, reads, keys, options, removed, updated, posts: () => posts };
}

for (const [count, stop] of [[1, null], [3, null], [2, "failure"], [1, "failure"], [2, "offline"], [2, "network"], [0, null]] as const) {
  test(`Stock batch ${count}/${stop ?? "success"} awaits one reconciliation`, async () => {
    const h = stockHarness(count, stop); let settled = false;
    const promise = h.api.retryStockSync().then((result: any) => { settled = true; return result; });
    await tick();
    expect(h.keys).toHaveLength(count ? 4 : 0);
    if (count) expect(settled).toBe(false);
    h.reads.forEach((read) => read.resolve());
    const result = await promise;
    expect(result.attempted).toBe(stop === "offline" ? 1 : count);
    expect(result.synced).toBe(stop ? (stop === "offline" ? 1 : count - 1) : count);
    expect(result.stopped).toBe(Boolean(stop));
    if (stop === "offline") expect(result.refreshError).toBeTruthy();
    expect(h.removed).toHaveLength(result.synced);
    expect(h.updated).toHaveLength(stop && stop !== "offline" ? 1 : 0);
  });
}

test("Stock read failure retains committed result and retry only refreshes queries", async () => {
  const h = stockHarness(1); let settled = false;
  const promise = h.api.retryStockSync().then((value: any) => { settled = true; return value; });
  await tick();
  h.reads[0].reject(new Error("READ_FAILED")); await tick();
  expect(settled).toBe(false);
  h.reads.slice(1).forEach((read) => read.resolve());
  const result = await promise;
  expect(result).toMatchObject({ synced: 1, stopped: false });
  expect(result.refreshError).toBeTruthy();
  expect(h.updated).toEqual([]);
  expect(h.options.every((option) => option?.throwOnError === true)).toBe(true);
  const retry = h.api.refreshStockSync(); await tick();
  h.reads.slice(4).forEach((read) => read.resolve()); await retry;
  expect(h.posts()).toBe(1);
});

test("Shared invalidation has no legacy Money Transfer or Dashboard factories", () => {
  for (const key of ["moneyTransfers", "moneyTransfersRoot", "dashboardOverview"]) {
    expect(Object.keys(moneyFlowQueryKeys)).not.toContain(key);
  }
});

test("Rubber Bill confirmed delete clears its receipt snapshot before reconciliation", async () => {
  const snapshotCleanup = deferred<void>();
  const mutations: any[] = [];
  let invalidations = 0;
  const queryClient = {};
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async () => 1,
      deleteRubberBillReceiptSnapshotsByClientTempId: async () => {},
      getPendingEvents: async () => [],
      removeSyncEvent: async () => {},
      removeSyncEvents: async () => {},
      updateSyncEvent: async () => {},
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": { authFetch: async () => response({ status: "synced" }) },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": {
      invalidateMoneyFlowLocation: async () => { invalidations++; },
    },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: () => ({ payload: { operation: "delete" } }),
    },
    "@/lib/rubber-bills/feed-cache": {
      removeConfirmedRubberBillLocally: async () => snapshotCleanup.promise,
    },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true } });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const confirmedDelete = mutations[1].mutationFn({
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 1,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });
  await tick();

  expect(invalidations).toBe(0);
  snapshotCleanup.resolve();
  const result = await confirmedDelete;
  await mutations[1].onSuccess(result);
  expect(invalidations).toBeGreaterThan(0);
});

test("Rubber Bill delete refreshes the submission branch after the active branch changes", async () => {
  const mutations: any[] = [];
  const invalidated: Array<{ ownerUserId: string; locationId: string }> = [];
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {},
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": { authFetch: async () => response({ status: "synced" }) },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": {
      invalidateMoneyFlowLocation: async (_queryClient: unknown, scope: { ownerUserId: string; locationId: string }) => {
        invalidated.push(scope);
      },
    },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": { buildRubberBillRpcPayload: () => ({ payload: {} }) },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
  }, { navigator: { onLine: false } });

  hook.useRubberBillMutations("location-b", "owner-1", null);
  await mutations[1].onSuccess(
    { approvalPending: false },
    {
      bill: { locationId: "location-a" },
      deletedByName: "Owner",
      deletedByPhone: "0800000000",
    },
  );

  expect(invalidated).toEqual([{ ownerUserId: "owner-1", locationId: "location-a" }]);
});

test("Rubber Bill save keeps the submitted branch and approval settings after options change", async () => {
  const mutations: any[] = [];
  const queueReads: any[] = [];
  const queuedEvents: any[] = [];
  const validatedSettings: any[] = [];
  const configuredCaps: unknown[] = [];
  const branchASettings = { locationId: "location-a", effectivePriceCap: 44 };
  const branchBSettings = { locationId: "location-b", effectivePriceCap: 99 };
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async (event: any) => {
        queuedEvents.push(event);
        return 1;
      },
      getPendingEvents: async (partition: any) => {
        queueReads.push(partition);
        return [];
      },
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": { authFetch: async () => { throw new Error("UNEXPECTED_POST"); } },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": {
      assertOfflineRubberBillPriceAllowed: (_prices: number[], _date: string, settings: unknown) => {
        validatedSettings.push(settings);
      },
    },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: (bill: any, _operation: string, configuredCap: unknown) => {
        configuredCaps.push(configuredCap);
        return {
          calculatedBill: bill,
          payload: {
            operation: "create",
            locationId: bill.locationId,
            expectedRevisionNo: 0,
          },
        };
      },
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
  }, { navigator: { onLine: false } });

  hook.useRubberBillMutations("location-b", "owner-1", branchBSettings);
  const result = await mutations[0].mutationFn({
    bill: {
      id: "client-bill-1",
      clientTempId: "client-bill-1",
      locationId: "location-a",
      billDate: "2026-10-07",
      weighItems: [],
    },
    approvalSettings: branchASettings,
  });

  expect(queueReads).toEqual([{
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-a",
  }]);
  expect(queuedEvents).toHaveLength(1);
  expect(queuedEvents[0]).toMatchObject({ locationId: "location-a" });
  expect(validatedSettings).toEqual([branchASettings]);
  expect(configuredCaps).toEqual([44]);
  expect(result.configuredPriceSnapshot).toBe(44);
});

test("direct Rubber Bill delete delegates its confirmed queue cleanup after server success", async () => {
  const mutations: any[] = [];
  const cleaned: any[] = [];
  let rawQueueCleanupAttempts = 0;
  const queryClient = {};
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async () => 7,
      getPendingEvents: async () => [],
      removeSyncEvent: async () => {
        rawQueueCleanupAttempts++;
        throw new Error("QUEUE_CLEANUP_FAILED");
      },
      removeSyncEvents: async () => {},
      updateSyncEvent: async () => {},
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": { authFetch: async () => response({ status: "synced" }) },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": { buildRubberBillRpcPayload: () => ({ payload: {} }) },
    "@/lib/rubber-bills/feed-cache": {
      removeConfirmedRubberBillLocally: async (
        _client: unknown,
        scope: { ownerUserId: string; locationId: string },
        clientTempId: string,
        queueId?: number,
      ) => { cleaned.push({ ...scope, clientTempId, queueId }); },
    },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true } });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const result = await mutations[1].mutationFn({
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 1,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });

  expect(result).toEqual({ approvalPending: false });
  expect(rawQueueCleanupAttempts).toBe(0);
  expect(cleaned).toEqual([{
    ownerUserId: "owner-1",
    locationId: "location-1",
    clientTempId: "client-bill-1",
    queueId: 7,
  }]);
});

test("direct Rubber Bill delete preserves a confirmed pending approval when queue cleanup fails", async () => {
  const mutations: any[] = [];
  let queuedEvent: any;
  let cleanupAttempts = 0;
  let cleanupFails = false;
  const cleanQueue = async () => {
    cleanupAttempts++;
    if (cleanupFails) throw new Error("QUEUE_CLEANUP_FAILED");
    queuedEvent = undefined;
  };
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async (event: any) => {
        queuedEvent = { ...event, queueId: 7 };
        return 7;
      },
      getPendingEvents: async () => [],
      removeSyncEvent: cleanQueue,
      removeSyncEventIfCurrent: cleanQueue,
      removeSyncEvents: async () => {},
      updateSyncEvent: async () => {},
      updateSyncEventIfCurrent: async () => false,
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": {
      authFetch: async () => response({
        status: "pending_approval",
        requestId: "request-1",
        operation: "delete",
        clientTempId: "client-bill-1",
      }),
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: () => ({ payload: { operation: "delete" } }),
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, {
    navigator: { onLine: true },
    console: { error: () => {}, warn: () => {} },
  });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const variables = {
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 1,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  };

  const control = await mutations[1].mutationFn(variables);
  expect(control).toEqual({ approvalPending: true });
  expect(cleanupAttempts).toBe(1);
  expect(queuedEvent).toBeUndefined();

  cleanupFails = true;
  const result = await mutations[1].mutationFn(variables);

  expect(result).toEqual({ approvalPending: true });
  expect(cleanupAttempts).toBe(2);
  expect(queuedEvent).toBeDefined();
});

test("direct Rubber Bill delete does not race the background queue replay", async () => {
  const mutations: any[] = [];
  const directWriteStarted = deferred();
  const releaseDirectWrite = deferred();
  const localCleanupStarted = deferred();
  const releaseLocalCleanup = deferred();
  let queuedEvent: any;
  let writes = 0;
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async (event: any) => {
        queuedEvent = { ...event, queueId: 7 };
        return 7;
      },
      getPendingEvents: async () => queuedEvent ? [queuedEvent] : [],
      removeSyncEvent: async () => { queuedEvent = undefined; },
      removeSyncEvents: async () => {},
      updateSyncEvent: async (event: any) => { queuedEvent = event; },
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": {
      authFetch: async () => {
        writes++;
        if (writes === 1) {
          directWriteStarted.resolve();
          await releaseDirectWrite.promise;
        }
        return response({ status: "synced" });
      },
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: () => ({ payload: { operation: "delete" } }),
    },
    "@/lib/rubber-bills/feed-cache": {
      removeConfirmedRubberBillLocally: async () => {
        localCleanupStarted.resolve();
        await releaseLocalCleanup.promise;
        queuedEvent = undefined;
      },
    },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true } });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const deleting = mutations[1].mutationFn({
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 1,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });
  await directWriteStarted.promise;

  await hook.syncPendingRubberBills({}, "owner-1", "location-1");
  expect(writes).toBe(1);
  releaseDirectWrite.resolve();
  await localCleanupStarted.promise;
  const replayDuringCleanup = hook.syncPendingRubberBills({}, "owner-1", "location-1");
  await tick();
  const writesBeforeLocalCleanup = writes;
  releaseLocalCleanup.resolve();
  const [result] = await Promise.all([deleting, replayDuringCleanup]);
  await mutations[1].onSuccess(result);

  expect(writesBeforeLocalCleanup).toBe(1);
});

test("stale Rubber Bill update replay cannot erase its replacement delete event", async () => {
  const mutations: any[] = [];
  const backgroundWriteStarted = deferred();
  const releaseBackgroundWrite = deferred();
  let writes = 0;
  let queuedEvent: any = {
    queueId: 41,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: "update",
    serverId: "server-bill-1",
    serverBillNo: "RB-1",
    payload: { operation: "update", expectedRevisionNo: 3 },
    timestamp: 1,
    status: "pending",
  };
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async () => { throw new Error("UNEXPECTED_ENQUEUE"); },
      getPendingEvents: async () => queuedEvent ? [queuedEvent] : [],
      reconcileSyncEventsIfCurrent: async (expected: any[], keeper?: any) => {
        if (expected.length !== 1
            || queuedEvent?.queueId !== expected[0].queueId
            || queuedEvent.operation !== expected[0].operation
            || JSON.stringify(queuedEvent.payload) !== JSON.stringify(expected[0].payload)) return false;
        queuedEvent = keeper ? { ...keeper, payload: { ...keeper.payload } } : undefined;
        return true;
      },
      removeSyncEvent: async (queueId: number) => {
        if (queuedEvent?.queueId === queueId) queuedEvent = undefined;
      },
      removeSyncEventIfCurrent: async (event: any) => {
        if (queuedEvent?.queueId !== event.queueId
            || queuedEvent.operation !== event.operation
            || JSON.stringify(queuedEvent.payload) !== JSON.stringify(event.payload)) return false;
        queuedEvent = undefined;
        return true;
      },
      removeSyncEvents: async () => {},
      updateSyncEvent: async (event: any) => { queuedEvent = { ...event }; },
      updateSyncEventIfCurrent: async () => false,
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": {
      authFetch: async () => {
        writes++;
        if (writes === 1) {
          backgroundWriteStarted.resolve();
          await releaseBackgroundWrite.promise;
          return response({ status: "synced" });
        }
        throw new Error("DIRECT_DELETE_NETWORK_FAILURE");
      },
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => true },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: () => ({ payload: { operation: "delete" } }),
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true }, console: { error: () => {}, warn: () => {} } });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const replay = hook.syncPendingRubberBills({}, "owner-1", "location-1");
  await backgroundWriteStarted.promise;

  await mutations[1].mutationFn({
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 4,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });
  expect(queuedEvent).toMatchObject({ queueId: 41, operation: "delete" });

  releaseBackgroundWrite.resolve();
  await replay;

  expect(queuedEvent).toMatchObject({ queueId: 41, operation: "delete" });
});

for (const outcome of ["success", "permanent failure"] as const) {
  test(`stale direct Rubber Bill update ${outcome} cannot erase its replacement delete event`, async () => {
    const mutations: any[] = [];
    const updateWriteStarted = deferred();
    const releaseUpdateWrite = deferred();
    let queuedEvent: any;
    const sameCommand = (left: any, right: any) => left?.queueId === right.queueId
      && left.operation === right.operation
      && JSON.stringify(left.payload) === JSON.stringify(right.payload);
    const hook = load("src/hooks/useRubberBills.ts", {
      "@tanstack/react-query": {
        useQueryClient: () => ({}),
        useMutation: (mutation: any) => {
          mutations.push(mutation);
          return { mutateAsync: mutation.mutationFn };
        },
      },
      "@/lib/idb-queue": {
        enqueueSyncEvent: async (event: any) => {
          queuedEvent = { ...event, payload: { ...event.payload }, queueId: 41 };
          return 41;
        },
        getPendingEvents: async () => queuedEvent ? [{
          ...queuedEvent, payload: { ...queuedEvent.payload },
        }] : [],
        reconcileSyncEventsIfCurrent: async (expected: any[], keeper?: any) => {
          if (expected.length !== 1 || !sameCommand(queuedEvent, expected[0])) return false;
          queuedEvent = keeper ? { ...keeper, payload: { ...keeper.payload } } : undefined;
          return true;
        },
        removeSyncEvent: async (queueId: number) => {
          if (queuedEvent?.queueId === queueId) queuedEvent = undefined;
        },
        removeSyncEventIfCurrent: async (event: any) => {
          if (!sameCommand(queuedEvent, event)) return false;
          queuedEvent = undefined;
          return true;
        },
        removeSyncEvents: async () => {},
        updateSyncEvent: async (event: any) => {
          queuedEvent = { ...event, payload: { ...event.payload } };
        },
        updateSyncEventIfCurrent: async (event: any) => {
          if (!sameCommand(queuedEvent, event)) return false;
          queuedEvent = { ...event, payload: { ...event.payload } };
          return true;
        },
      },
      sonner: { toast: { success: () => {} } },
      "@/lib/record-action-locks": {
        OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
        PENDING_SERVER_ACTION_MESSAGE: "PENDING",
      },
      "@/lib/auth-fetch": {
        authFetch: async (_url: string, init: { body: string }) => {
          const submission = JSON.parse(init.body);
          if (submission.operation === "delete") {
            throw new Error("DIRECT_DELETE_NETWORK_FAILURE");
          }
          updateWriteStarted.resolve();
          await releaseUpdateWrite.promise;
          return outcome === "success"
            ? response({
              status: "synced",
              id: "server-bill-1",
              serverBillNo: "RB-1",
              revisionNo: 4,
              serverReceivedAt: "2026-10-07T00:00:00.000Z",
            })
            : response({ status: "conflict", errorMessage: "STALE_UPDATE" }, false);
        },
      },
      "@/lib/sync-response": { isRetryableSyncResponse: () => false },
      "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
      "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
      "@/lib/scoped-single-flight": {
        createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
      },
      "@/lib/rubber-bills/submission": {
        buildRubberBillRpcPayload: (bill: any, operation: string) => ({
          calculatedBill: bill,
          payload: {
            operation,
            clientTempId: bill.clientTempId,
            locationId: "location-1",
            expectedRevisionNo: bill.revisionNo,
            idempotencyKey: `${operation}:${bill.clientTempId}:${bill.revisionNo}`,
          },
        }),
      },
      "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
      "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
    }, { navigator: { onLine: true }, console: { error: () => {} } });

    hook.useRubberBillMutations("location-1", "owner-1", null);
    const saving = mutations[0].mutationFn({
      bill: {
        id: "server-bill-1",
        clientTempId: "client-bill-1",
        serverBillNo: "RB-1",
        billNo: "RB-1",
        revisionNo: 3,
        configuredPriceSnapshot: null,
      },
    });
    await updateWriteStarted.promise;

    await mutations[1].mutationFn({
      bill: {
        id: "server-bill-1",
        clientTempId: "client-bill-1",
        serverBillNo: "RB-1",
        revisionNo: 3,
        configuredPriceSnapshot: null,
      },
      deletedByName: "Owner",
      deletedByPhone: "0800000000",
    });
    expect(queuedEvent).toMatchObject({ queueId: 41, operation: "delete" });

    releaseUpdateWrite.resolve();
    const saveOutcome = await saving.then(() => "resolved", () => "rejected");

    expect(saveOutcome).toBe(outcome === "success" ? "resolved" : "rejected");
    expect(queuedEvent).toMatchObject({ queueId: 41, operation: "delete" });
  });
}

for (const queuedOperation of ["update", "create"] as const) {
test(`stale local Rubber Bill ${queuedOperation} coalescing cannot undo a concurrent delete`, async () => {
  const mutations: any[] = [];
  const saveWriteStarted = deferred();
  const releaseSaveWrite = deferred();
  let queuedEvent: any = {
    queueId: 41,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: queuedOperation,
    serverId: "server-bill-1",
    serverBillNo: "RB-1",
    payload: { operation: queuedOperation, customerName: "old",
      expectedRevisionNo: queuedOperation === "create" ? 0 : 3 },
    timestamp: 1,
    status: "pending",
  };
  const sameCommand = (left: any, right: any) => left?.queueId === right.queueId
    && left.operation === right.operation
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
  const waitForConcurrentDelete = async (event: any) => {
    if (event.operation === queuedOperation && event.payload.customerName === "new") {
      saveWriteStarted.resolve();
      await releaseSaveWrite.promise;
    }
  };
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async () => { throw new Error("UNEXPECTED_ENQUEUE"); },
      getPendingEvents: async () => queuedEvent ? [{
        ...queuedEvent, payload: { ...queuedEvent.payload },
      }] : [],
      reconcileSyncEventsIfCurrent: async (expected: any[], keeper: any) => {
        if (keeper) await waitForConcurrentDelete(keeper);
        if (!sameCommand(queuedEvent, expected[0])) return false;
        queuedEvent = keeper ? { ...keeper, payload: { ...keeper.payload } } : undefined;
        return true;
      },
      removeSyncEvent: async () => {},
      removeSyncEventIfCurrent: async () => false,
      removeSyncEvents: async (queueIds: number[]) => {
        if (queueIds.includes(queuedEvent?.queueId)) queuedEvent = undefined;
      },
      updateSyncEvent: async (event: any) => {
        await waitForConcurrentDelete(event);
        queuedEvent = { ...event, payload: { ...event.payload } };
      },
      updateSyncEventIfCurrent: async () => false,
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": { authFetch: async () => { throw new Error("NETWORK_FAILURE"); } },
    "@/lib/sync-response": { isRetryableSyncResponse: () => true },
    "@/lib/rubber-bills/approval": {
      assertOfflineRubberBillPriceAllowed: () => {},
      assertRubberBillDeleteAllowed: () => {},
    },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: (bill: any, operation: string) => ({
        calculatedBill: bill,
        payload: {
          operation,
          customerName: bill.customerName,
          expectedRevisionNo: bill.revisionNo,
          idempotencyKey: `${operation}:${bill.clientTempId}:${bill.revisionNo}`,
        },
      }),
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true }, console: { error: () => {} } });

  hook.useRubberBillMutations(
    "location-1", "owner-1", queuedOperation === "create" ? { effectivePriceCap: 20 } : null);
  const bill = {
    id: queuedOperation === "create" ? "client-bill-1" : "server-bill-1",
    clientTempId: "client-bill-1",
    serverBillNo: "RB-1",
    billNo: "RB-1",
    revisionNo: queuedOperation === "create" ? 0 : 3,
    configuredPriceSnapshot: null,
  };
  const saving = mutations[0].mutationFn({ bill: { ...bill, customerName: "new" } });
  await saveWriteStarted.promise;

  await mutations[1].mutationFn({
    bill,
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });
  if (queuedOperation === "update") {
    expect(queuedEvent).toMatchObject({ queueId: 41, operation: "delete" });
  } else {
    expect(queuedEvent).toBeUndefined();
  }

  releaseSaveWrite.resolve();
  expect(await saving.then(() => "resolved", () => "rejected")).toBe("rejected");
  if (queuedOperation === "update") {
    expect(queuedEvent).toMatchObject({ queueId: 41, operation: "delete" });
  } else {
    expect(queuedEvent).toBeUndefined();
  }
});
}

test("local-only Rubber Bill delete cannot race a create replay marker", async () => {
  const mutations: any[] = [];
  const deleteWriteStarted = deferred();
  const releaseDeleteWrite = deferred();
  let removedLocally = 0;
  let serverWrites = 0;
  let queuedEvent: any = {
    queueId: 41,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: "create",
    payload: { operation: "create", customerName: "new", expectedRevisionNo: 0 },
    timestamp: 1,
    status: "pending",
  };
  const sameCommand = (left: any, right: any) => left?.queueId === right.queueId
    && left.operation === right.operation
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
  const sameEvent = (left: any, right: any) => sameCommand(left, right)
    && left.timestamp === right.timestamp
    && left.status === right.status
    && left.errorMessage === right.errorMessage
    && left.serverSubmissionAttempted === right.serverSubmissionAttempted;
  const queue = {
    enqueueSyncEvent: async () => { throw new Error("UNEXPECTED_ENQUEUE"); },
    getPendingEvents: async () => queuedEvent ? [{
      ...queuedEvent, payload: { ...queuedEvent.payload },
    }] : [],
    reconcileSyncEventsIfCurrent: async (expected: any[], keeper?: any) => {
      if (!keeper) {
        deleteWriteStarted.resolve();
        await releaseDeleteWrite.promise;
      }
      if (!queuedEvent || expected.length !== 1 || !sameEvent(queuedEvent, expected[0])) return false;
      queuedEvent = keeper ? { ...keeper, payload: { ...keeper.payload } } : undefined;
      return true;
    },
    removeSyncEvent: async () => {},
    removeSyncEventIfCurrent: async (event: any) => {
      if (!sameCommand(queuedEvent, event)) return false;
      queuedEvent = undefined;
      return true;
    },
    removeSyncEvents: async (queueIds: number[]) => {
      deleteWriteStarted.resolve();
      await releaseDeleteWrite.promise;
      if (queueIds.includes(queuedEvent?.queueId)) queuedEvent = undefined;
    },
    updateSyncEvent: async () => {},
    updateSyncEventIfCurrent: async () => false,
  };
  const shared = {
    "@/lib/idb-queue": queue,
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": {
      assertOfflineRubberBillPriceAllowed: () => {},
      assertRubberBillDeleteAllowed: () => {},
    },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: (bill: any, operation: string) => ({
        calculatedBill: bill,
        payload: {
          operation,
          customerName: bill.customerName,
          expectedRevisionNo: bill.revisionNo,
          idempotencyKey: `${operation}:${bill.clientTempId}:${bill.revisionNo}`,
        },
      }),
    },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  };
  const deletingTab = load("src/hooks/useRubberBills.ts", {
    ...shared,
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/auth-fetch": { authFetch: async () => { throw new Error("UNEXPECTED_DIRECT_WRITE"); } },
    "@/lib/rubber-bills/feed-cache": {
      removeConfirmedRubberBillLocally: async () => { removedLocally++; },
    },
  }, { navigator: { onLine: true }, console: { error: () => {} } });
  const replayTab = load("src/hooks/useRubberBills.ts", {
    ...shared,
    "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: () => ({}) },
    "@/lib/auth-fetch": {
      authFetch: async () => {
        serverWrites++;
        return response({ status: "synced" });
      },
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
  }, { navigator: { onLine: true }, console: { error: () => {} } });

  deletingTab.useRubberBillMutations("location-1", "owner-1", { effectivePriceCap: 20 });
  const deleting = mutations[1].mutationFn({
    bill: {
      id: "client-bill-1",
      clientTempId: "client-bill-1",
      customerName: "new",
      revisionNo: 0,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });
  await deleteWriteStarted.promise;

  await replayTab.syncPendingRubberBills({}, "owner-1", "location-1");
  expect(serverWrites).toBe(1);
  releaseDeleteWrite.resolve();

  expect(await deleting.then(() => "resolved", () => "rejected")).toBe("rejected");
  expect(removedLocally).toBe(0);
});

test("stale Rubber Bill create replay cannot overwrite a newer local edit before transport", async () => {
  const mutations: any[] = [];
  const markerWriteStarted = deferred();
  const releaseMarkerWrite = deferred();
  let writes = 0;
  let queuedEvent: any = {
    queueId: 41,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: "create",
    payload: { operation: "create", customerName: "old" },
    timestamp: 1,
    status: "pending",
  };
  const sameCommand = (left: any, right: any) => left?.queueId === right.queueId
    && left.operation === right.operation
    && JSON.stringify(left.payload) === JSON.stringify(right.payload);
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async () => { throw new Error("UNEXPECTED_ENQUEUE"); },
      getPendingEvents: async () => [{ ...queuedEvent, payload: { ...queuedEvent.payload } }],
      reconcileSyncEventsIfCurrent: async (expected: any[], keeper: any) => {
        if (keeper.serverSubmissionAttempted === true) {
          markerWriteStarted.resolve();
          await releaseMarkerWrite.promise;
        }
        if (!sameCommand(queuedEvent, expected[0])) return false;
        queuedEvent = { ...keeper, payload: { ...keeper.payload } };
        return true;
      },
      removeSyncEvent: async () => {},
      removeSyncEventIfCurrent: async () => false,
      removeSyncEvents: async () => {},
      updateSyncEvent: async (event: any) => {
        if (event.serverSubmissionAttempted === true) {
          markerWriteStarted.resolve();
          await releaseMarkerWrite.promise;
        }
        queuedEvent = { ...event, payload: { ...event.payload } };
      },
      updateSyncEventIfCurrent: async (event: any) => {
        markerWriteStarted.resolve();
        await releaseMarkerWrite.promise;
        if (!sameCommand(queuedEvent, event)) return false;
        queuedEvent = { ...event, payload: { ...event.payload } };
        return true;
      },
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": {
      authFetch: async () => {
        writes++;
        throw new Error("NETWORK_FAILURE");
      },
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => true },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: (bill: any, operation: string) => ({
        calculatedBill: bill,
        payload: {
          operation,
          customerName: bill.customerName,
          expectedRevisionNo: 0,
          idempotencyKey: `create:${bill.clientTempId}:0`,
        },
      }),
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true }, console: { error: () => {} } });

  hook.useRubberBillMutations("location-1", "owner-1", { effectivePriceCap: 20 });
  const replay = hook.syncPendingRubberBills({}, "owner-1", "location-1");
  await markerWriteStarted.promise;

  await mutations[0].mutationFn({
    bill: {
      id: "client-bill-1",
      clientTempId: "client-bill-1",
      customerName: "new",
      billDate: "2026-10-07",
      revisionNo: 0,
      weighItems: [],
    },
  });
  expect(queuedEvent.payload.customerName).toBe("new");

  releaseMarkerWrite.resolve();
  await replay;

  expect(writes).toBe(0);
  expect(queuedEvent).toMatchObject({
    queueId: 41,
    operation: "create",
    payload: expect.objectContaining({ customerName: "new" }),
  });
});

test("stale Rubber Bill queue normalization cannot overwrite a replacement delete event", async () => {
  const mutations: any[] = [];
  const normalizationWriteStarted = deferred();
  const releaseNormalizationWrite = deferred();
  const navigatorState = { onLine: true };
  let writes = 0;
  let queuedEvents: any[] = [
    {
      queueId: 41,
      id: "client-bill-1",
      entity: "rubber_bills",
      ownerUserId: "owner-1",
      locationId: "location-1",
      operation: "update",
      serverId: "server-bill-1",
      payload: { operation: "update", expectedRevisionNo: 3, customerName: "old" },
      timestamp: 1,
      status: "pending",
    },
    {
      queueId: 42,
      id: "client-bill-1",
      entity: "rubber_bills",
      ownerUserId: "owner-1",
      locationId: "location-1",
      operation: "update",
      serverId: "server-bill-1",
      payload: { operation: "update", expectedRevisionNo: 3, customerName: "new" },
      timestamp: 2,
      status: "pending",
    },
  ];
  const staleGroup = queuedEvents.map((event) => ({ ...event, payload: { ...event.payload } }));
  const staleKeeper = { ...staleGroup[0], payload: { ...staleGroup[1].payload } };
  const replaceEvent = (event: any) => {
    queuedEvents = queuedEvents.map((current) => (
      current.queueId === event.queueId ? { ...event, payload: { ...event.payload } } : current
    ));
  };
  let reconciliationCalls = 0;
  const reconcileIfCurrent = async (expected: any[], keeper?: any) => {
    reconciliationCalls += 1;
    if (reconciliationCalls === 1) {
      normalizationWriteStarted.resolve();
      await releaseNormalizationWrite.promise;
    }
    const unchanged = expected.every((event) => {
      const current = queuedEvents.find((candidate) => candidate.queueId === event.queueId);
      return current?.operation === event.operation
        && JSON.stringify(current.payload) === JSON.stringify(event.payload);
    });
    if (!unchanged) return false;
    queuedEvents = keeper ? [keeper] : [];
    return true;
  };
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async () => { throw new Error("UNEXPECTED_ENQUEUE"); },
      getPendingEvents: async () => queuedEvents.map((event) => ({
        ...event, payload: { ...event.payload },
      })),
      reconcileSyncEventsIfCurrent: reconcileIfCurrent,
      removeSyncEvent: async () => {},
      removeSyncEventIfCurrent: async () => false,
      removeSyncEvents: async (queueIds: number[]) => {
        queuedEvents = queuedEvents.filter((event) => !queueIds.includes(event.queueId));
      },
      updateSyncEvent: async (event: any) => {
        if (event.operation === "update") {
          normalizationWriteStarted.resolve();
          await releaseNormalizationWrite.promise;
        }
        replaceEvent(event);
      },
      updateSyncEventIfCurrent: async () => false,
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": {
      authFetch: async () => {
        writes++;
        throw new Error("DIRECT_DELETE_NETWORK_FAILURE");
      },
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => true },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: () => ({ payload: { operation: "delete" } }),
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": {
      coalesceQueueGroup: () => ({ action: "keep", keeper: staleKeeper, remove: [staleGroup[1]] }),
    },
  }, { navigator: navigatorState, console: { error: () => {}, warn: () => {} } });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const replay = hook.syncPendingRubberBills({}, "owner-1", "location-1");
  await normalizationWriteStarted.promise;

  await mutations[1].mutationFn({
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 4,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });
  expect(queuedEvents).toEqual([
    expect.objectContaining({ queueId: 41, operation: "delete" }),
  ]);

  releaseNormalizationWrite.resolve();
  await replay;

  expect(writes).toBe(1);
  expect(queuedEvents).toEqual([
    expect.objectContaining({ queueId: 41, operation: "delete" }),
  ]);
});

test("Rubber Bill delete reuses a pending update queue slot before any fallible cleanup", async () => {
  const mutations: any[] = [];
  const updatedEvents: any[] = [];
  const reconciliations: Array<{ expected: any[]; keeper: any }> = [];
  const removedQueueIds: number[] = [];
  let enqueueAttempts = 0;
  const pendingUpdate = {
    queueId: 41,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: "update",
    serverId: "server-bill-1",
    serverBillNo: "RB-1",
    payload: { operation: "update", expectedRevisionNo: 3 },
    timestamp: 1,
    status: "pending",
  };
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async () => {
        enqueueAttempts++;
        throw new Error("ENQUEUE_FAILED");
      },
      getPendingEvents: async () => [pendingUpdate],
      reconcileSyncEventsIfCurrent: async (expected: any[], keeper: any) => {
        reconciliations.push({ expected, keeper });
        return true;
      },
      removeSyncEvent: async (queueId: number) => { removedQueueIds.push(queueId); },
      removeSyncEvents: async () => {},
      updateSyncEvent: async (event: unknown) => { updatedEvents.push(event); },
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": {
      authFetch: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ status: "failed", errorMessage: "TEMPORARY" }),
      }),
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => true },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: () => ({ payload: { operation: "delete" } }),
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true }, console: { error: () => {} } });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const result = await mutations[1].mutationFn({
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 4,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });

  expect(result).toEqual({ approvalPending: false });

  expect(enqueueAttempts).toBe(0);
  expect(removedQueueIds).toEqual([]);
  expect(updatedEvents).toEqual([]);
  expect(reconciliations).toHaveLength(1);
  expect(reconciliations[0].expected).toEqual([pendingUpdate]);
  expect(reconciliations[0].keeper).toMatchObject({
    queueId: 41,
    operation: "delete",
    payload: {
      operation: "delete",
      expectedRevisionNo: 3,
      idempotencyKey: "delete:client-bill-1:3",
    },
  });
});

test("stale Rubber Bill delete handoff cannot overwrite a newer pending update", async () => {
  const mutations: any[] = [];
  const handoffStarted = deferred<void>();
  const releaseHandoff = deferred<void>();
  let gateOpened = false;
  const pendingUpdate = {
    queueId: 41,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: "update",
    serverId: "server-bill-1",
    serverBillNo: "RB-1",
    payload: { operation: "update", expectedRevisionNo: 3, customerName: "old" },
    timestamp: 1,
    status: "pending",
  };
  const newerUpdate = {
    ...pendingUpdate,
    payload: { ...pendingUpdate.payload, customerName: "newer" },
    timestamp: 2,
  };
  let queuedEvents = [pendingUpdate];
  const pauseAtHandoff = async () => {
    if (!gateOpened) {
      gateOpened = true;
      handoffStarted.resolve();
    }
    await releaseHandoff.promise;
  };
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async () => { throw new Error("UNEXPECTED_ENQUEUE"); },
      getPendingEvents: async () => queuedEvents.map((event) => ({
        ...event,
        payload: { ...event.payload },
      })),
      reconcileSyncEventsIfCurrent: async (expected: any[], keeper?: any) => {
        await pauseAtHandoff();
        if (JSON.stringify(queuedEvents) !== JSON.stringify(expected)) return false;
        queuedEvents = keeper ? [keeper] : [];
        return true;
      },
      removeSyncEvent: async () => {},
      removeSyncEventIfCurrent: async () => false,
      removeSyncEvents: async () => {},
      updateSyncEvent: async (event: any) => {
        await pauseAtHandoff();
        queuedEvents = [event];
      },
      updateSyncEventIfCurrent: async () => false,
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": {
      authFetch: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ status: "failed", errorMessage: "TEMPORARY" }),
      }),
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => true },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: () => ({ payload: { operation: "delete" } }),
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true }, console: { error: () => {} } });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const deleting = mutations[1].mutationFn({
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 4,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });
  await handoffStarted.promise;

  queuedEvents = [newerUpdate];
  releaseHandoff.resolve();

  const outcome = await deleting.then(
    () => ({ status: "resolved" }),
    (error: Error) => ({ status: "rejected", message: error.message }),
  );
  expect(outcome).toEqual({
    status: "rejected",
    message: "ข้อมูลบิลในเครื่องถูกเปลี่ยนจากอีกหน้าต่าง กรุณาลองลบอีกครั้ง",
  });
  expect(queuedEvents).toEqual([newerUpdate]);
});

test("stale direct Rubber Bill delete failure cannot resurrect a confirmed queue event", async () => {
  const mutations: any[] = [];
  const requestStarted = deferred<void>();
  const releaseResponse = deferred<void>();
  let queuedEvents: any[] = [];
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        mutations.push(mutation);
        return { mutateAsync: mutation.mutationFn };
      },
    },
    "@/lib/idb-queue": {
      enqueueSyncEvent: async (event: any) => {
        queuedEvents = [{ ...event, queueId: 41 }];
        return 41;
      },
      getPendingEvents: async () => [],
      reconcileSyncEventsIfCurrent: async () => false,
      removeSyncEvent: async () => {},
      removeSyncEventIfCurrent: async () => false,
      removeSyncEvents: async () => {},
      updateSyncEvent: async (event: any) => { queuedEvents = [event]; },
      updateSyncEventIfCurrent: async (event: any) => {
        const current = queuedEvents.find((candidate) => candidate.queueId === event.queueId);
        if (!current || current.operation !== event.operation
            || JSON.stringify(current.payload) !== JSON.stringify(event.payload)) return false;
        queuedEvents = [event];
        return true;
      },
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": {
      authFetch: async () => {
        requestStarted.resolve();
        await releaseResponse.promise;
        return {
          ok: false,
          status: 400,
          json: async () => ({ status: "failed", errorMessage: "BUSINESS_FAILURE" }),
        };
      },
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": {
      buildRubberBillRpcPayload: () => ({ payload: { operation: "delete" } }),
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true }, console: { error: () => {} } });

  hook.useRubberBillMutations("location-1", "owner-1", null);
  const deleting = mutations[1].mutationFn({
    bill: {
      id: "server-bill-1",
      clientTempId: "client-bill-1",
      serverBillNo: "RB-1",
      revisionNo: 4,
      configuredPriceSnapshot: null,
    },
    deletedByName: "Owner",
    deletedByPhone: "0800000000",
  });
  await requestStarted.promise;

  queuedEvents = [];
  releaseResponse.resolve();

  const outcome = await deleting.then(
    () => ({ status: "resolved" }),
    (error: Error) => ({ status: "rejected", message: error.message }),
  );
  expect(outcome).toEqual({ status: "rejected", message: "BUSINESS_FAILURE" });
  expect(queuedEvents).toEqual([]);
});

test("Rubber Bill queue normalization removes a noop group in one atomic batch", async () => {
  const events = [
    {
      queueId: 51,
      id: "local-bill-1",
      entity: "rubber_bills",
      ownerUserId: "owner-1",
      locationId: "location-1",
      operation: "create",
      payload: { operation: "create" },
      timestamp: 1,
      status: "pending",
    },
    {
      queueId: 52,
      id: "local-bill-1",
      entity: "rubber_bills",
      ownerUserId: "owner-1",
      locationId: "location-1",
      operation: "delete",
      payload: { operation: "delete" },
      timestamp: 2,
      status: "pending",
    },
  ];
  const reconciledGroups: any[][] = [];
  let reads = 0;
  let singleRemovals = 0;
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useMutation: () => ({}), useQueryClient: () => ({}) },
    "@/lib/idb-queue": {
      getPendingEvents: async () => (++reads === 1 ? events : []),
      reconcileSyncEventsIfCurrent: async (group: any[]) => { reconciledGroups.push(group); },
      removeSyncEvent: async () => { singleRemovals++; },
      removeSyncEvents: async () => {},
      updateSyncEvent: async () => {},
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": { authFetch: async () => { throw new Error("UNEXPECTED_POST"); } },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": { buildRubberBillRpcPayload: () => ({ payload: {} }) },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true } });

  await hook.syncPendingRubberBills({}, "owner-1", "location-1");

  expect(reconciledGroups).toEqual([events]);
  expect(singleRemovals).toBe(0);
});

test("background Rubber Bill delete replay delegates confirmed queue cleanup", async () => {
  const event = {
    queueId: 7,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: "delete",
    serverId: "server-bill-1",
    payload: { operation: "delete" },
    timestamp: 1,
    status: "pending",
  };
  const cleaned: any[] = [];
  let rawQueueCleanupAttempts = 0;
  const hook = load("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useMutation: () => ({}), useQueryClient: () => ({}) },
    "@/lib/idb-queue": {
      getPendingEvents: async () => [event],
      removeSyncEvent: async () => {
        rawQueueCleanupAttempts++;
        throw new Error("QUEUE_CLEANUP_FAILED");
      },
      updateSyncEvent: async () => {},
    },
    sonner: { toast: { success: () => {} } },
    "@/lib/record-action-locks": {
      OFFLINE_SYNCED_ACTION_MESSAGE: "OFFLINE",
      PENDING_SERVER_ACTION_MESSAGE: "PENDING",
    },
    "@/lib/auth-fetch": { authFetch: async () => response({ status: "synced" }) },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/approval": { assertOfflineRubberBillPriceAllowed: () => {} },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/scoped-single-flight": {
      createScopedSingleFlight: () => (_scope: string, run: () => Promise<unknown>) => run(),
    },
    "@/lib/rubber-bills/submission": { buildRubberBillRpcPayload: () => ({ payload: {} }) },
    "@/lib/rubber-bills/feed-cache": {
      removeConfirmedRubberBillLocally: async (
        _client: unknown,
        scope: { ownerUserId: string; locationId: string },
        clientTempId: string,
        queueId?: number,
      ) => { cleaned.push({ ...scope, clientTempId, queueId }); },
    },
    "@/lib/coalesceQueueGroup": { coalesceQueueGroup: () => ({ action: "noop" }) },
  }, { navigator: { onLine: true } });

  await hook.syncPendingRubberBills({}, "owner-1", "location-1");

  expect(rawQueueCleanupAttempts).toBe(0);
  expect(cleaned).toEqual([{
    ownerUserId: "owner-1",
    locationId: "location-1",
    clientTempId: "client-bill-1",
    queueId: 7,
  }]);
});

test("manual Rubber Bill delete retry keeps server identity when queue cleanup fails", async () => {
  const serverId = "71000000-0000-4000-8000-000000000021";
  const event = {
    queueId: 7,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: "delete",
    serverId,
    payload: {
      operation: "delete",
      clientTempId: "client-bill-1",
      locationId: "location-1",
      expectedRevisionNo: 1,
      idempotencyKey: "delete:client-bill-1:1",
    },
    timestamp: 1,
    status: "failed",
  };
  let submitted: Record<string, unknown> | undefined;
  const cleaned: Array<{
    ownerUserId: string;
    locationId: string;
    clientTempId: string;
    queueId?: number;
  }> = [];
  let invalidations = 0;
  const queryClient = {};
  const hook = load("src/hooks/usePerRecordSyncRetry.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
      useMutation: (mutation: any) => ({
        mutateAsync: mutation.mutationFn,
        isPending: false,
      }),
    },
    "@/lib/idb-queue": {
      getPendingEvents: async () => [event],
      removeSyncEvent: async () => { throw new Error("QUEUE_CLEANUP_FAILED"); },
      updateSyncEvent: async () => {},
    },
    "@/lib/auth-fetch": {
      authFetch: async (_url: string, init: { body: string }) => {
        submitted = JSON.parse(init.body);
        return response({
          status: "synced",
          id: serverId,
          serverBillNo: "RB-1",
          revisionNo: 2,
          serverReceivedAt: "2026-10-07T00:00:00.000Z",
        });
      },
    },
    "@/lib/money-flow/invalidation": {
      invalidateMoneyFlowLocation: async () => { invalidations++; },
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/feed-cache": {
      removeConfirmedRubberBillLocally: async (
        _client: unknown,
        scope: { ownerUserId: string; locationId: string },
        clientTempId: string,
        queueId?: number,
      ) => { cleaned.push({ ...scope, clientTempId, queueId }); },
    },
  }, { navigator: { onLine: true } });

  const retry = hook.usePerRecordSyncRetry("location-1", "owner-1");
  await retry.retrySyncEvent({ entity: "rubber_bills", id: "client-bill-1" });

  expect(submitted).toMatchObject({
    expectedServerId: serverId,
    submissionMode: "replay",
  });
  expect(cleaned).toEqual([{
    ownerUserId: "owner-1",
    locationId: "location-1",
    clientTempId: "client-bill-1",
    queueId: 7,
  }]);
  expect(invalidations).toBe(1);
});

test("manual Rubber Bill delete retry preserves a confirmed pending approval when queue cleanup fails", async () => {
  const event = {
    queueId: 7,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-1",
    locationId: "location-1",
    operation: "delete",
    serverId: "server-bill-1",
    payload: { operation: "delete", clientTempId: "client-bill-1" },
    timestamp: 1,
    status: "failed",
  };
  let cleanupAttempts = 0;
  let invalidations = 0;
  const hook = load("src/hooks/usePerRecordSyncRetry.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => ({
        mutateAsync: mutation.mutationFn,
        isPending: false,
      }),
    },
    "@/lib/idb-queue": {
      getPendingEvents: async () => [event],
      removeSyncEventIfCurrent: async () => {
        cleanupAttempts++;
        throw new Error("QUEUE_CLEANUP_FAILED");
      },
      updateSyncEvent: async () => {},
      updateSyncEventIfCurrent: async () => false,
    },
    "@/lib/auth-fetch": {
      authFetch: async () => response({
        status: "pending_approval",
        requestId: "request-1",
        operation: "delete",
        clientTempId: "client-bill-1",
      }),
    },
    "@/lib/money-flow/invalidation": {
      invalidateMoneyFlowLocation: async () => { invalidations++; },
    },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
  }, {
    navigator: { onLine: true },
    console: { warn: () => {} },
  });

  const retry = hook.usePerRecordSyncRetry("location-1", "owner-1");
  await retry.retrySyncEvent({ entity: "rubber_bills", id: "client-bill-1" });

  expect(cleanupAttempts).toBe(1);
  expect(invalidations).toBe(1);
});

test("manual sync retry keeps the submitted branch and owner after options change", async () => {
  const event = {
    queueId: 7,
    id: "client-bill-1",
    entity: "rubber_bills",
    ownerUserId: "owner-a",
    locationId: "location-a",
    operation: "update",
    payload: { operation: "update", locationId: "location-a" },
    timestamp: 1,
    status: "failed",
  };
  let currentMutation: any;
  const queueReads: any[] = [];
  const removed: any[] = [];
  const invalidated: any[] = [];
  const mutateAsync = (variables: any) => currentMutation.mutationFn(variables);
  const hook = load("src/hooks/usePerRecordSyncRetry.ts", {
    "@tanstack/react-query": {
      useQueryClient: () => ({}),
      useMutation: (mutation: any) => {
        currentMutation = mutation;
        return { mutateAsync, isPending: false };
      },
    },
    "@/lib/idb-queue": {
      getPendingEvents: async (partition: any) => {
        queueReads.push(partition);
        return partition.ownerUserId === "owner-a" && partition.locationId === "location-a"
          ? [event]
          : [];
      },
      removeSyncEventIfCurrent: async (candidate: any) => { removed.push(candidate); },
      updateSyncEvent: async () => {},
      updateSyncEventIfCurrent: async () => {},
    },
    "@/lib/auth-fetch": { authFetch: async () => response({ status: "synced" }) },
    "@/lib/money-flow/invalidation": {
      invalidateMoneyFlowLocation: async (_client: unknown, scope: any) => { invalidated.push(scope); },
    },
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
    "@/lib/sync-response": { isRetryableSyncResponse: () => false },
  }, { navigator: { onLine: true } });

  const submissionA = hook.usePerRecordSyncRetry("location-a", "owner-a");
  hook.usePerRecordSyncRetry("location-b", "owner-b");
  await submissionA.retrySyncEvent({ entity: "rubber_bills", id: "client-bill-1" });

  expect(queueReads).toEqual([{
    entity: "rubber_bills",
    ownerUserId: "owner-a",
    locationId: "location-a",
  }]);
  expect(removed).toEqual([event]);
  expect(invalidated).toEqual([{ ownerUserId: "owner-a", locationId: "location-a" }]);
});

test("confirmed Rubber Bill local cleanup remains best-effort across feed, receipt, and queue", async () => {
  let feedCacheWriteAttempts = 0;
  let receiptCleanupAttempts = 0;
  let queueCleanupAttempts = 0;
  const warnings: unknown[][] = [];
  const helper = load("src/lib/rubber-bills/feed-cache.ts", {
    "@/lib/money-flow/query-keys": {
      moneyFlowQueryKeys: {
        rubberBillOperationalFeedRoot: () => ["rubberBillOperationalFeed"],
      },
    },
    "@/lib/idb-queue": {
      tombstoneRubberBillReceiptSnapshotsByClientTempId: async () => {
        receiptCleanupAttempts++;
        throw new Error("RECEIPT_CLEANUP_FAILED");
      },
      removeSyncEvent: async () => {
        queueCleanupAttempts++;
        throw new Error("QUEUE_CLEANUP_FAILED");
      },
    },
  }, {
    console: { warn: (...args: unknown[]) => warnings.push(args) },
  });

  await helper.removeConfirmedRubberBillLocally({
    cancelQueries: async () => {},
    setQueriesData: () => {
      feedCacheWriteAttempts++;
      throw new Error("FEED_CLEANUP_FAILED");
    },
  }, {
    ownerUserId: "owner-1",
    locationId: "location-1",
  }, "client-bill-1", 7);

  expect(feedCacheWriteAttempts).toBe(1);
  expect(receiptCleanupAttempts).toBe(1);
  expect(queueCleanupAttempts).toBe(1);
  expect(warnings).toHaveLength(3);
});

test("an aborted Rubber Bill feed cannot finish a stale receipt snapshot write", async () => {
  const writeGate = deferred<void>();
  let snapshotPresent = false;
  let feedOptions: any;
  const bill = {
    id: "server-bill-1",
    clientTempId: "client-bill-1",
    locationId: "location-1",
    serverBillNo: "RB-1",
    serverReceivedAt: "2026-10-07T01:00:00.000Z",
    serverCreatedAt: "2026-10-07T01:00:00.000Z",
    clientRecordedAt: "2026-10-07T01:00:00.000Z",
    revisionNo: 1,
  };
  const hook = load("src/hooks/useRubberBillList.ts", {
    "@tanstack/react-query": {
      useInfiniteQuery: (options: any) => {
        feedOptions = options;
        return {};
      },
      useQuery: () => ({}),
    },
    "@/components/rubber-bills/bill-display": {
      buildRubberBillReceiptModel: () => ({}),
    },
    "@/hooks/useRubberBillEvidenceReview": {
      mapRubberBillEvidenceState: (value: unknown) => value,
    },
    "@/lib/auth-fetch": {
      authFetch: async () => response({
        rows: [{}], evidenceStates: [], nextCursor: null, hasMore: false,
      }),
      assertApiResponse: async () => {},
    },
    "@/lib/idb-queue": {
      getPendingEvents: async () => [],
      getRubberBillReceiptSnapshots: async () => [],
      putRubberBillReceiptSnapshots: async (_snapshots: unknown[], signal?: AbortSignal) => {
        await writeGate.promise;
        if (!signal?.aborted) snapshotPresent = true;
      },
      pruneRubberBillReceiptSnapshots: async () => {},
    },
    "@/lib/money-flow/query-keys": {
      moneyFlowQueryKeys: {
        rubberBillOperationalFeed: (...parts: unknown[]) => ["rubberBillOperationalFeed", ...parts],
      },
    },
    "@/lib/rubber-bills/local-feed": {
      mergeRubberBillLocalEvents: (bills: unknown[]) => bills,
      rubberBillFromSyncEvent: () => null,
      scopeRubberBillLocalEventsToServerRows: (_bills: unknown[], events: unknown[]) => events,
    },
    "@/lib/rubber-bills/map-feed-row": { mapRubberBillFeedRow: () => bill },
    "@/lib/supabase/client": { createSupabaseBrowserClient: () => ({}) },
  }, { navigator: { onLine: true } });

  hook.useRubberBillList({
    ownerUserId: "owner-1",
    locationId: "location-1",
    mode: "latest",
    documentStatus: "any",
    search: "",
  });
  const controller = new AbortController();
  const reading = feedOptions.queryFn({ pageParam: null, signal: controller.signal });
  await tick();

  controller.abort();
  snapshotPresent = false;
  writeGate.resolve();
  await reading;

  expect(snapshotPresent).toBe(false);
});

for (const strict of [false, true]) {
  test(`Shared refresh preserves default policy and propagates errors only for opt-in=${strict}`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let fail = false;
    const observer = new QueryObserver(client, {
      queryKey: moneyFlowQueryKeys.stock("a"),
      queryFn: async () => { if (fail) throw new Error("READ_FAILED"); return []; },
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch(); fail = true;
    const helper = load("src/lib/money-flow/invalidation.ts", {
      "@/lib/money-flow/query-keys": { moneyFlowQueryKeys },
    });
    try {
      const promise = helper.invalidateMoneyFlowLocation(client, { locationId: "a", ownerUserId: "u" }, strict ? { throwOnError: true } : undefined);
      const failure = await promise.then(() => null, (error: Error) => error.message);
      expect(failure).toBe(strict ? "READ_FAILED" : null);
    } finally { unsubscribe(); client.clear(); }
  });
}
