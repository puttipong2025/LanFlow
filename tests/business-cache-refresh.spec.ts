import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import type { CacheState } from "../src/lib/business-cache/refresh";
import type { CacheModule } from "../src/lib/business-cache/protocol";
import { QueryClient } from "@tanstack/react-query";
import { incomeExpenseOperationalQueryKeys } from "../src/lib/income-expense/query-keys";

function harness({ current = true, blocked = false, failRubber = false, unsupported = false, repairVersion = 1, settings = undefined as unknown } = {}) {
  const calls: string[] = [], commits: string[] = [];
  const states = new Map<CacheModule, CacheState>();
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let form = blocked;
  const source = loadSourceModule<typeof import("../src/lib/business-cache/refresh")>("src/lib/business-cache/refresh.ts", {
    "@/lib/auth-fetch": { authFetch: async (url: string, init: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") return Response.json({ checks: [{ billId: "bill", state: "unknown" }] });
      return Response.json({ protocol: unsupported ? 2 : 1, versions: { rubber: repairVersion, income: 1 }, ...(settings === undefined ? {} : { settings }) });
    }, assertApiResponse: async (response: Response) => { if (!response.ok) throw new Error("http failure"); } },
    "@/lib/rubber-bill-receipts-idb": { getRubberBillReceiptSnapshots: async () => failRubber ? [{ billId: "bill", revisionNo: 1 }] : [] },
    "./storage": { readCacheMetadata: async (key: string) => current ? ({ key, version: 1, updatedAt: "2026-10-30T00:00:00Z" }) : null,
      commitCacheRefresh: async (row: { key: string }) => { commits.push(row.key); } },
    "./forms": { hasOpenBusinessForm: () => form, waitForBusinessForms: async () => { await wait; form = false; } },
  });
  let incomeFetches = 0;
  let savedSettings = { intervalMinutes: null as number | null, revision: 2 };
  const client = { setQueryData: (_key: unknown, updater: (current: typeof savedSettings) => typeof savedSettings) => { savedSettings = updater(savedSettings); },
    invalidateQueries: async () => {}, fetchInfiniteQuery: async () => { incomeFetches++; return {}; } };
  const run = (signal = new AbortController().signal) => source.refreshBusinessCaches(client as never, "owner", "branch", signal,
    (module, value) => { states.set(module, value); });
  return { calls, commits, states, run, release, incomeFetches: () => incomeFetches, settings: () => savedSettings };
}

test("unchanged versions perform one metadata request and no batch or feed fetch", async () => {
  const h = harness(); await h.run();
  expect(h.calls).toHaveLength(1); expect(h.incomeFetches()).toBe(0); expect(h.commits).toEqual([]);
  expect(h.states.get("rubber")?.state).toBe("current");
});

test("first run accepts an empty rubber scope and uses the existing income query", async () => {
  const h = harness({ current: false }); await h.run();
  expect(h.commits.sort()).toEqual(["income:owner:branch", "rubber:branch"]);
  expect(h.incomeFetches()).toBe(1);
});

test("open form blocks both module commits until closed without starting another metadata check", async () => {
  const h = harness({ current: false, blocked: true }); const run = h.run();
  await expect.poll(() => h.states.get("rubber")?.state).toBe("waiting");
  expect(h.commits).toEqual([]); h.release(); await run;
  expect(h.calls).toHaveLength(1); expect(h.commits).toHaveLength(2);
});

test("unknown receipt preserves rubber version while income can finish", async () => {
  const h = harness({ current: false, failRubber: true }); await h.run();
  expect(h.states.get("rubber")?.state).toBe("failed"); expect(h.states.get("income")?.state).toBe("current");
  expect(h.commits).toEqual(["income:owner:branch"]);
});

test("unsupported future protocol cannot be accepted by an older client", async () => {
  const h = harness({ unsupported: true });
  let message = "";
  try { await h.run(); } catch (error) { message = (error as Error).message; }
  expect(message).toContain("เวอร์ชันใหม่");
  expect(h.commits).toEqual([]); expect(h.incomeFetches()).toBe(0);
});

test("a server repair version bump works in the already open compatible client", async () => {
  const h = harness({ repairVersion: 2 }); await h.run();
  expect(h.commits).toEqual(["rubber:branch"]); expect(h.states.get("rubber")?.state).toBe("current");
  expect(h.incomeFetches()).toBe(0);
});

test("unchanged repair version still receives shared settings without overwriting a newer save", async () => {
  const h = harness({ settings: { intervalMinutes: 10, revision: 3 } }); await h.run();
  expect(h.settings()).toEqual({ intervalMinutes: 10, revision: 3 }); expect(h.commits).toEqual([]);
  const stale = harness({ settings: { intervalMinutes: 120, revision: 1 } }); await stale.run();
  expect(stale.settings()).toEqual({ intervalMinutes: null, revision: 2 });
});

test("reusing an in-flight income feed still waits for a form opened during the request", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const commits: string[] = [];
  const states = new Map<CacheModule, CacheState>();
  let form = false, requested = false;
  let finishFeed!: (value: unknown) => void, closeForm!: () => void;
  const pendingFeed = new Promise(resolve => { finishFeed = resolve; });
  const pendingForm = new Promise<void>(resolve => { closeForm = resolve; });
  const source = loadSourceModule<typeof import("../src/lib/business-cache/refresh")>("src/lib/business-cache/refresh.ts", {
    "@/lib/auth-fetch": { authFetch: async () => {
      requested = true; return Response.json({ protocol: 1, versions: { rubber: 1, income: 1 } });
    }, assertApiResponse: async () => {} },
    "@/lib/rubber-bill-receipts-idb": { getRubberBillReceiptSnapshots: async () => [] },
    "./storage": { readCacheMetadata: async (key: string) => key.startsWith("rubber:") ? { version: 1 } : null,
      commitCacheRefresh: async (row: { key: string }) => { commits.push(row.key); } },
    "./forms": { hasOpenBusinessForm: () => form, waitForBusinessForms: () => pendingForm },
  });
  const existing = client.fetchInfiniteQuery({ queryKey: incomeExpenseOperationalQueryKeys.feed("owner", "branch", "latest", ""),
    initialPageParam: null, queryFn: () => pendingFeed, getNextPageParam: () => undefined });
  try {
    const run = source.refreshBusinessCaches(client, "owner", "branch", new AbortController().signal,
      (module, value) => states.set(module, value));
    await expect.poll(() => requested).toBe(true);
    form = true; finishFeed({ rows: [], nextCursor: null, hasMore: false, pendingApprovalCount: 0 }); await existing;
    await expect.poll(() => states.get("income")?.state).toBe("waiting");
    expect(commits).toEqual([]);
    form = false; closeForm(); await run;
    expect(commits).toEqual(["income:owner:branch"]);
  } finally { finishFeed({}); closeForm(); client.clear(); }
});

test("real form wait cancels cleanly and does not retain an observer after closing", async () => {
  let open = true, disconnected = 0, changed!: () => void;
  const source = loadSourceModule<typeof import("../src/lib/business-cache/forms")>("src/lib/business-cache/forms.ts", {}, {
    document: { querySelector: () => open ? {} : null, body: {} },
    MutationObserver: class {
      constructor(callback: () => void) { changed = callback; }
      observe() {}
      disconnect() { disconnected++; }
    },
  });
  const cancelled = new AbortController();
  const waiting = source.waitForBusinessForms(cancelled.signal);
  cancelled.abort();
  expect(await waiting.then(() => "unexpected success", (error: Error) => error.message)).toContain("ยกเลิก");
  expect(disconnected).toBe(1);
  const closing = source.waitForBusinessForms(new AbortController().signal);
  open = false; changed(); await closing;
  expect(disconnected).toBe(2);
  await source.waitForBusinessForms(new AbortController().signal);
  expect(disconnected).toBe(2);
});
