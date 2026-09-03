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
      "@/lib/bangkok-date": { formatBangkokDateTime: String },
      "@/lib/format": { formatNumber: String },
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
