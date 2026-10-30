import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import { isBusinessCacheSettings, isCacheInterval, businessCacheSettingsKey, type BusinessCacheSettings } from "../src/lib/business-cache/settings";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

test("central setting accepts off and whole minutes from 10 through 120", () => {
  for (const value of [null, 10, 11, 120]) expect(isCacheInterval(value)).toBe(true);
  for (const value of [undefined, 0, 9, 121, 10.5, "10", Infinity, NaN]) expect(isCacheInterval(value)).toBe(false);
  expect(isBusinessCacheSettings({ intervalMinutes: 10, revision: 1 })).toBe(true);
  expect(isBusinessCacheSettings({ intervalMinutes: 10, revision: 0 })).toBe(false);
});

test("settings route rejects invalid inputs, stale changes and unauthorized managers", async () => {
  let writes = 0, allowed = true, code = "";
  const api = loadSourceModule<typeof import("../src/app/api/lanflow/business-cache/settings/route")>("src/app/api/lanflow/business-cache/settings/route.ts", {
    "@/lib/server/auth": { requireRole: async (_request: Request, roles: string[]) => {
      expect(roles).toEqual(["super_admin"]);
      return allowed ? { ok: true, supabase: { rpc: async () => {
        writes++; return code ? { error: { code } } : { data: { intervalMinutes: 10, revision: 2 } };
      } } } : { ok: false, response: Response.json({}, { status: 403 }) };
    } },
  });
  const put = (intervalMinutes: unknown, expectedRevision: unknown = 1) => api.PUT(new Request("http://localhost", {
    method: "PUT", body: JSON.stringify({ intervalMinutes, expectedRevision }),
  }));
  for (const value of [9, 121, 10.5, "10"]) expect((await put(value)).status).toBe(400);
  for (const revision of [null, 2_147_483_648, Number.MAX_SAFE_INTEGER]) expect((await put(10, revision)).status).toBe(400);
  expect(writes).toBe(0);
  expect((await put(10)).status).toBe(200);
  code = "40001"; expect((await put(10)).status).toBe(409);
  allowed = false; expect((await put(10)).status).toBe(403); expect(writes).toBe(2);
});

test("timer pauses while hidden/offline, uses new shared interval and stops cleanly", async () => {
  let online = true, hidden = false, minutes: number | null = 10, calls = 0;
  let scheduled: { callback: () => void; delay: number } | undefined;
  const visibility = new Set<() => void>(), connectivity = new Set<() => void>();
  const source = loadSourceModule<typeof import("../src/lib/business-cache/timer")>("src/lib/business-cache/timer.ts", {
    "@/lib/connectivity": { getConnectivitySnapshot: () => online, subscribeConnectivity: (listener: () => void) => {
      connectivity.add(listener); return () => connectivity.delete(listener);
    } },
  }, {
    document: { get hidden() { return hidden; }, addEventListener: (_: string, listener: () => void) => visibility.add(listener),
      removeEventListener: (_: string, listener: () => void) => visibility.delete(listener) },
    setTimeout: (callback: () => void, delay: number) => { scheduled = { callback, delay }; return 1; },
    clearTimeout: () => { scheduled = undefined; },
  });
  const timer = source.startCacheVersionTimer(() => minutes, async () => { calls++; });
  expect(scheduled?.delay).toBe(600_000);
  scheduled!.callback(); await Promise.resolve(); await Promise.resolve(); expect(calls).toBe(1);
  hidden = true; visibility.forEach(fn => fn()); expect(scheduled).toBeUndefined();
  hidden = false; visibility.forEach(fn => fn()); expect(scheduled?.delay).toBe(600_000);
  online = false; connectivity.forEach(fn => fn()); expect(scheduled).toBeUndefined();
  online = true; connectivity.forEach(fn => fn()); expect(calls).toBe(1);
  minutes = 120; timer.reset(); expect(scheduled?.delay).toBe(7_200_000);
  minutes = null; timer.reset(); expect(scheduled).toBeUndefined();
  minutes = 10; timer.reset(); timer.stop(); expect(scheduled).toBeUndefined();
  expect(visibility.size).toBe(0); expect(connectivity.size).toBe(0);
});

test("branch change retains local work counts when the queue read finishes before metadata", async () => {
  type Status = import("../src/hooks/useBusinessCacheStatus").BusinessCacheStatus;
  let state: Status = { scope: "owner:old", rubber: { state: "unchecked" }, income: { state: "unchecked" }, pending: 99 };
  let effect!: () => () => void, release!: () => void;
  const metadata = new Promise<null>(resolve => { release = () => resolve(null); });
  const client = new QueryClient();
  const source = loadSourceModule<typeof import("../src/hooks/useBusinessCacheStatus")>("src/hooks/useBusinessCacheStatus.ts", {
    react: { useState: () => [state, (update: (current: Status) => Status) => { state = update(state); }],
      useEffect: (callback: typeof effect) => { effect = callback; } },
    "@tanstack/react-query": { QueryObserver, useQueryClient: () => client },
    "@/lib/connectivity": { getConnectivitySnapshot: () => false, subscribeConnectivity: () => () => {} },
    "@/lib/business-cache/storage": { readCacheMetadata: () => metadata },
    "@/lib/business-cache/refresh": { EMPTY_CACHE_STATE: { state: "unchecked" } },
    "@/lib/business-cache/timer": { startCacheVersionTimer: () => ({ reset: () => {}, stop: () => {} }) },
    "@/lib/idb-queue": { getPendingEvents: async ({ entity }: { entity: string }) => [{ id: "same", entity, status: "pending" }] },
  });
  source.useBusinessCacheStatus("owner", "new"); const stop = effect();
  try {
    await expect.poll(() => state.pending).toBe(2);
    release(); await expect.poll(() => state.scope).toBe("owner:new");
    expect(state.pending).toBe(2);
    expect(state.work).toEqual({ pending: 2, failed: 0, conflict: 0 });
  } finally { release(); stop(); client.clear(); }
});

test("metadata transport failure keeps the last successful cache timestamp", async () => {
  type Status = import("../src/hooks/useBusinessCacheStatus").BusinessCacheStatus;
  const updatedAt = "2026-10-30T00:00:00Z";
  let state: Status = { scope: "owner:branch", rubber: { state: "unchecked" }, income: { state: "unchecked" }, pending: null };
  let effect!: () => () => void;
  const client = new QueryClient();
  const source = loadSourceModule<typeof import("../src/hooks/useBusinessCacheStatus")>("src/hooks/useBusinessCacheStatus.ts", {
    react: { useState: () => [state, (update: (current: Status) => Status) => { state = update(state); }],
      useEffect: (callback: typeof effect) => { effect = callback; } },
    "@tanstack/react-query": { QueryObserver, useQueryClient: () => client },
    "@/lib/connectivity": { getConnectivitySnapshot: () => true, subscribeConnectivity: () => () => {} },
    "@/lib/business-cache/storage": { readCacheMetadata: async () => ({ version: 1, updatedAt }) },
    "@/lib/business-cache/refresh": { EMPTY_CACHE_STATE: { state: "unchecked" },
      refreshBusinessCaches: async (_client: unknown, _owner: string, _branch: string, _signal: AbortSignal,
        publish: (module: "rubber" | "income", state: { state: string; updatedAt: string }) => void) => {
        for (const module of ["rubber", "income"] as const) publish(module, { state: "checking", updatedAt });
        throw new Error("temporary network failure");
      } },
    "@/lib/business-cache/timer": { startCacheVersionTimer: () => ({ reset: () => {}, stop: () => {} }) },
    "@/lib/idb-queue": { getPendingEvents: async () => [] },
  });
  source.useBusinessCacheStatus("owner", "branch"); const stop = effect();
  try {
    await expect.poll(() => state.rubber.state).toBe("failed");
    expect(state.rubber.updatedAt).toBe(updatedAt);
    expect(state.income.updatedAt).toBe(updatedAt);
  } finally { stop(); client.clear(); }
});

test("a delayed settings save response cannot overwrite a newer metadata setting", async () => {
  for (const newerMetadata of [false, true]) {
    const client = new QueryClient();
    const key = businessCacheSettingsKey("owner");
    client.setQueryData(key, { intervalMinutes: null, revision: 1 });
    let closed = false, started = false, release!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { release = resolve; });
    const slots = [true, { intervalMinutes: null, revision: 1 }, true, 10, "", false];
    let index = 0;
    const source = loadSourceModule<typeof import("../src/components/lanflow/BusinessCacheSettings")>("src/components/lanflow/BusinessCacheSettings.tsx", {
      react: { useEffect: () => {}, useId: () => "help", useRef: () => ({ current: false }),
        useState: () => {
          const slot = index++;
          return [slots[slot], (value: unknown) => { if (slot === 0 && value === false) closed = true; }];
        } },
      "@tanstack/react-query": { useQueryClient: () => client, useQuery: () => ({ data: client.getQueryData(key) }) },
      "@/components/shared/ModalShell": { ModalShell: () => null },
      "@/components/shared/NumberField": { NumberField: () => null },
      "@/lib/auth-fetch": { authFetch: async () => { started = true; return response; }, assertApiResponse: async () => {} },
    });
    try {
      const outer = source.BusinessCacheSettings({ owner: "owner", canEdit: true, online: true });
      const editor = outer.props.children[2];
      const modal = editor.type(editor.props);
      modal.props.children.props.onSubmit({ preventDefault() {}, currentTarget: { querySelector: () => ({ valueAsNumber: 10 }) } });
      expect(started).toBe(true);
      if (newerMetadata) client.setQueryData(key, { intervalMinutes: 120, revision: 3 });
      release(Response.json({ intervalMinutes: 10, revision: 2 }));
      await expect.poll(() => closed).toBe(true);
      expect(client.getQueryData<BusinessCacheSettings>(key)).toEqual(newerMetadata
        ? { intervalMinutes: 120, revision: 3 } : { intervalMinutes: 10, revision: 2 });
    } finally { release(Response.json({ intervalMinutes: 10, revision: 2 })); client.clear(); }
  }
});

test("background invalidation refreshes local work counts after leaving either business module", async () => {
  type Status = import("../src/hooks/useBusinessCacheStatus").BusinessCacheStatus;
  for (const entity of ["rubber_bills", "income_expense"] as const) {
    const client = new QueryClient();
    const root = entity === "rubber_bills" ? "rubberBillLocalState" : "incomeExpensePending";
    const key = [root, "owner", "branch"];
    client.setQueryData(key, entity === "rubber_bills" ? { events: [] } : []);
    client.setQueryData([root, "owner", "other"], []);
    let remaining = 2, reads = 0;
    let state: Status = { scope: "owner:branch", rubber: { state: "unchecked" }, income: { state: "unchecked" }, pending: null };
    let effect!: () => () => void;
    const source = loadSourceModule<typeof import("../src/hooks/useBusinessCacheStatus")>("src/hooks/useBusinessCacheStatus.ts", {
      react: { useState: () => [state, (update: (current: Status) => Status) => { state = update(state); }],
        useEffect: (callback: typeof effect) => { effect = callback; } },
      "@tanstack/react-query": { QueryObserver, useQueryClient: () => client },
      "@/lib/connectivity": { getConnectivitySnapshot: () => false, subscribeConnectivity: () => () => {} },
      "@/lib/business-cache/storage": { readCacheMetadata: async () => null },
      "@/lib/business-cache/refresh": { EMPTY_CACHE_STATE: { state: "unchecked" } },
      "@/lib/business-cache/timer": { startCacheVersionTimer: () => ({ reset: () => {}, stop: () => {} }) },
      "@/lib/idb-queue": { getPendingEvents: async ({ entity: requested }: { entity: string }) => {
        reads++; return entity === requested ? Array.from({ length: remaining }, (_, index) => ({ id: `job${index}`, entity, status: "pending" })) : [];
      } },
    });
    source.useBusinessCacheStatus("owner", "branch"); const stop = effect();
    try {
      await expect.poll(() => state.pending).toBe(2);
      remaining = 1;
      const before = reads;
      await client.invalidateQueries({ queryKey: [root, "owner", "other"] });
      expect(reads).toBe(before); expect(state.pending).toBe(2);
      await client.invalidateQueries({ queryKey: key });
      await expect.poll(() => state.pending).toBe(1);
      remaining = 0;
      await client.invalidateQueries({ queryKey: key });
      await expect.poll(() => state.pending, { timeout: 1000 }).toBe(0);
      expect(state.work).toEqual({ pending: 0, failed: 0, conflict: 0 });
      expect(reads).toBe(before + 2);
    } finally {
      stop();
      expect(client.getQueryCache().getAll().every(query => query.getObserversCount() === 0)).toBe(true);
      client.clear();
    }
  }
});
