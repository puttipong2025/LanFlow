import { expect, test } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";
import { inspectOfflineReadiness, readinessPercent } from "../src/lib/offline-readiness";
import { loadSourceModule } from "./helpers/load-source-module";

const origin = "https://lanflow.test";
const asset = "/_next/static/chunks/app/page-test.js";
const manifest = { buildId: "test", assets: [{ url: asset, revision: "v1" }] };
let entries: Map<string, Map<string, Response>>;
let storage: Map<string, string>;
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

test.beforeEach(() => {
  entries = new Map([
    ["workbox-precache-v2-test", new Map([[`${origin}${asset}?__WB_REVISION__=v1`, new Response("script")]])],
    ["lanflow-start-url", new Map([[`${origin}/`, new Response(`<script src="${asset}"></script>`, { headers: { "content-type": "text/html" } })]])],
  ]);
  storage = new Map([
    ["lanflow:last-auth-user", "user"],
    ["lanflow:auth-profile:user", JSON.stringify({ profile: { id: "user" }, validatedAt: new Date().toISOString() })],
    ["lanflow_bootstrap_cache:user", JSON.stringify({ profile: { id: "user", locationIds: ["branch"] }, locations: [{ id: "branch", active: true }], selectedLocationId: "branch" })],
  ]);
  const overrides = {
    window: globalThis,
    location: { origin },
    navigator: { serviceWorker: { controller: {} } },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null },
    indexedDB: new IDBFactory(),
    caches: {
      keys: async () => [...entries.keys()],
      open: async (name: string) => ({
        match: async (input: string, options?: { ignoreSearch?: boolean }) => {
          const url = new URL(input, origin);
          const cache = entries.get(name);
          for (const [key, value] of cache ?? []) {
            const target = new URL(key);
            if (options?.ignoreSearch ? url.pathname === target.pathname : url.href === target.href) return value.clone();
          }
        },
      }),
    },
  };
  for (const [key, value] of Object.entries(overrides)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});

test.afterEach(() => {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
});

test("100% requires actual versioned assets, cached HTML, valid account, assigned branch and writable queue", async () => {
  expect(await inspectOfflineReadiness(manifest, "user", "branch")).toMatchObject({ ready: true, percent: 100 });
});

test("missing or wrong-version files reduce the percentage", async () => {
  entries.get("workbox-precache-v2-test")!.clear();
  const missing = await inspectOfflineReadiness(manifest, "user", "branch");
  expect(missing.ready).toBe(false);
  expect(missing.percent).toBeLessThan(100);
  entries.get("workbox-precache-v2-test")!.set(`${origin}${asset}?__WB_REVISION__=old`, new Response("old"));
  expect((await inspectOfflineReadiness(manifest, "user", "branch")).ready).toBe(false);
});

test("stale HTML referencing a deleted chunk cannot report ready", async () => {
  entries.get("lanflow-start-url")!.set(`${origin}/`, new Response('<script src="/_next/static/old.js"></script>', { headers: { "content-type": "text/html" } }));
  expect((await inspectOfflineReadiness(manifest, "user", "branch")).ready).toBe(false);
});

test("a cached login document cannot count as the authenticated app shell", async () => {
  entries.get("lanflow-start-url")!.set(`${origin}/`, new Response('<script src="/_next/static/chunks/app/login/page-login.js"></script>', { headers: { "content-type": "text/html" } }));
  entries.get("workbox-precache-v2-test")!.set(`${origin}/_next/static/chunks/app/login/page-login.js?__WB_REVISION__=v1`, new Response("login"));
  expect((await inspectOfflineReadiness(manifest, "user", "branch")).ready).toBe(false);
});

test("Vercel deployment query parameters do not hide a cached root page chunk", async () => {
  entries.get("lanflow-start-url")!.set(`${origin}/`, new Response(`<script src="${asset}?dpl=dpl_production"></script>`, { headers: { "content-type": "text/html" } }));
  expect(await inspectOfflineReadiness(manifest, "user", "branch")).toMatchObject({ ready: true, percent: 100 });
});

test("expired or different-owner account and unavailable branch cannot report ready", async () => {
  storage.set("lanflow:auth-profile:user", JSON.stringify({ profile: { id: "user" }, validatedAt: "2000-01-01" }));
  expect((await inspectOfflineReadiness(manifest, "user", "branch")).ready).toBe(false);
  storage.set("lanflow:auth-profile:user", JSON.stringify({ profile: { id: "other" }, validatedAt: new Date().toISOString() }));
  expect((await inspectOfflineReadiness(manifest, "user", "branch")).ready).toBe(false);
  expect((await inspectOfflineReadiness(manifest, "user", "other-branch")).ready).toBe(false);
});

test("unavailable storage cannot report ready and does not destroy queued data", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  expect(await inspectOfflineReadiness(manifest, "user", "branch")).toMatchObject({ ready: false, detail: "พื้นที่เก็บรายการออฟไลน์ยังไม่พร้อม" });
  expect(storage.get("lanflow:last-auth-user")).toBe("user");
});

test("percentage stays bounded and an unknown total never reports ready", () => {
  expect(readinessPercent(0, 0, true)).toBe(0);
  expect(readinessPercent(9, 10, true)).toBe(90);
  expect(readinessPercent(10, 10, false)).toBe(99);
  expect(readinessPercent(11, 10, true)).toBe(100);
});

test("a manifest timeout does not poison the next visibility-triggered attempt", async () => {
  let effect: (() => void) | undefined;
  let timeout: (() => void) | undefined;
  let visibility: (() => void) | undefined;
  const signals: AbortSignal[] = [];
  const component = loadSourceModule<typeof import("../src/components/lanflow/OfflineReadinessStatus")>(
    "src/components/lanflow/OfflineReadinessStatus.tsx", {
      react: { useState: (value: unknown) => [value, () => {}], useEffect: (callback: () => void) => { effect = callback; } },
      "@/lib/offline-readiness": {
        readOfflineManifest: async (_online: boolean, signal: AbortSignal) => {
          signals.push(signal);
          if (signals.length === 1) return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout"))));
          if (signal.aborted) throw new Error("poisoned retry");
          return manifest;
        },
        inspectOfflineReadiness: async () => ({ ready: true, percent: 100, detail: "ready" }),
      },
    }, {
      window: { caches: {}, addEventListener: () => {}, removeEventListener: () => {} },
      navigator: { serviceWorker: { addEventListener: () => {}, removeEventListener: () => {} } },
      document: { hidden: false, addEventListener: (name: string, callback: () => void) => { if (name === "visibilitychange") visibility = callback; }, removeEventListener: () => {} },
      setTimeout: (callback: () => void, ms: number) => { if (ms === 10000) timeout = callback; return 1; },
      clearTimeout: () => {},
    },
  );
  component.OfflineReadinessStatus({ userId: "user", locationId: "branch", online: true });
  effect!();
  timeout!();
  await new Promise((resolve) => setImmediate(resolve));
  visibility!();
  await new Promise((resolve) => setImmediate(resolve));
  expect(signals).toHaveLength(2);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
});

test("worker replacement during a manifest fetch discards its obsolete readiness result", async () => {
  let effect: (() => void) | undefined;
  let workerChanged: (() => void) | undefined;
  let resolveManifest: ((value: typeof manifest) => void) | undefined;
  const states: Array<{ ready?: boolean }> = [];
  const delays: number[] = [];
  const component = loadSourceModule<typeof import("../src/components/lanflow/OfflineReadinessStatus")>(
    "src/components/lanflow/OfflineReadinessStatus.tsx", {
      react: { useState: (value: unknown) => [value, (next: { ready?: boolean }) => states.push(next)], useEffect: (callback: () => void) => { effect = callback; } },
      "@/lib/offline-readiness": {
        readOfflineManifest: () => new Promise((resolve) => { resolveManifest = resolve; }),
        inspectOfflineReadiness: async () => ({ ready: true, percent: 100, detail: "obsolete" }),
      },
    }, {
      window: { caches: {}, addEventListener: () => {}, removeEventListener: () => {} },
      navigator: { serviceWorker: { addEventListener: (_name: string, callback: () => void) => { workerChanged = callback; }, removeEventListener: () => {} } },
      document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
      setTimeout: (_callback: () => void, ms: number) => { delays.push(ms); return 1; }, clearTimeout: () => {},
    },
  );
  component.OfflineReadinessStatus({ userId: "user", locationId: "branch", online: true });
  effect!();
  workerChanged!();
  resolveManifest!(manifest);
  await new Promise((resolve) => setImmediate(resolve));
  expect(states.some((state) => state.ready)).toBe(false);
  expect(delays.at(-1)).toBe(0);
});

for (const assets of ["available", "manifest-outage", "missing-worker", "missing-cache"] as const) test(`online issuer registration with offline assets ${assets}`, async () => {
  const branch = "af000000-0000-4000-8000-000000000001";
  let effect: (() => void | (() => void)) | undefined;
  const numbering = loadSourceModule<typeof import("../src/lib/rubber-bills/numbering-idb")>(
    "src/lib/rubber-bills/numbering-idb.ts", {
      "@/lib/auth-fetch": {
        authFetch: async () => Response.json({ version: 1, id: "af000000-0000-4000-8000-000000000002", code: "D01", locationId: branch }),
        assertApiResponse: async () => {},
      },
    }, { window: { indexedDB: new IDBFactory() } },
  );
  const states: Array<{ ready?: boolean }> = [];
  const component = loadSourceModule<typeof import("../src/components/lanflow/OfflineReadinessStatus")>(
    "src/components/lanflow/OfflineReadinessStatus.tsx", {
      react: { useState: (value: unknown) => [value, (next: { ready?: boolean }) => states.push(next)], useEffect: (callback: () => void) => { effect = callback; } },
      "@/lib/lanflow/bootstrap-cache": { readBootstrapCache: () => ({ profile: { role: "admin" } }) },
      "@/lib/rubber-bills/numbering-idb": numbering,
      "@/lib/offline-readiness": {
        readOfflineManifest: async () => { if (assets === "manifest-outage") throw new Error("manifest unavailable"); return manifest; },
        inspectOfflineReadiness: async () => ({ ready: true, percent: 100, detail: "ready" }),
      },
    }, {
      window: { ...(assets === "missing-cache" ? {} : { caches: {} }), addEventListener: () => {}, removeEventListener: () => {} },
      navigator: assets === "missing-worker" ? {} : { serviceWorker: { addEventListener: () => {}, removeEventListener: () => {} } },
      document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
      setTimeout: () => 1, clearTimeout: () => {},
    },
  );
  component.OfflineReadinessStatus({ userId: "user", locationId: branch, online: true });
  const cleanup = effect!();
  try {
    await expect.poll(() => numbering.rubberNumberingReady(branch), { timeout: 1000 }).toBe(true);
    expect(states.some(state => state.ready)).toBe(assets === "available");
  } finally { if (typeof cleanup === "function") cleanup(); }
});

test("first issuer registration retries after a temporary outage without needing a tab change", async () => {
  const branch = "af000000-0000-4000-8000-000000000003";
  let effect: (() => void | (() => void)) | undefined;
  const requests: string[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  const numbering = loadSourceModule<typeof import("../src/lib/rubber-bills/numbering-idb")>(
    "src/lib/rubber-bills/numbering-idb.ts", {
      "@/lib/auth-fetch": {
        authFetch: async (_url: string, init: RequestInit) => {
          requests.push(String(init.body));
          if (requests.length === 1) throw new Error("temporary registration outage");
          return Response.json({ version: 1, id: "af000000-0000-4000-8000-000000000004", code: "D01", locationId: branch });
        },
        assertApiResponse: async () => {},
      },
    }, { window: { indexedDB: new IDBFactory() } },
  );
  const component = loadSourceModule<typeof import("../src/components/lanflow/OfflineReadinessStatus")>(
    "src/components/lanflow/OfflineReadinessStatus.tsx", {
      react: { useState: (value: unknown) => [value, () => {}], useEffect: (callback: () => void) => { effect = callback; } },
      "@/lib/lanflow/bootstrap-cache": { readBootstrapCache: () => ({ profile: { role: "admin" } }) },
      "@/lib/rubber-bills/numbering-idb": numbering,
      "@/lib/offline-readiness": {
        readOfflineManifest: async () => manifest,
        inspectOfflineReadiness: async () => ({ ready: true, percent: 100, detail: "ready" }),
      },
    }, {
      window: { caches: {}, addEventListener: () => {}, removeEventListener: () => {} },
      navigator: { serviceWorker: { addEventListener: () => {}, removeEventListener: () => {} } },
      document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
      setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout: (id: number) => { timers.delete(id); },
    },
  );
  component.OfflineReadinessStatus({ userId: "user", locationId: branch, online: true });
  const cleanup = effect!();
  try {
    await expect.poll(() => timers.size, { timeout: 1000 }).toBe(1);
    expect(requests).toHaveLength(1);
    expect(await numbering.rubberNumberingReady(branch)).toBe(false);
    const [id, retry] = [...timers][0];
    expect(retry.delay).toBe(2000);
    timers.delete(id); retry.callback();
    await expect.poll(() => numbering.rubberNumberingReady(branch), { timeout: 1000 }).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
  } finally { if (typeof cleanup === "function") cleanup(); }
  expect(timers.size).toBe(0);
});
