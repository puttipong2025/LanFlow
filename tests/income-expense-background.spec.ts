import { expect, test } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";
import * as queue from "../src/lib/idb-queue";
import * as storage from "../src/lib/income-expense/background-idb";
import { loadSourceModule } from "./helpers/load-source-module";
import { persistIncomeExpenseSubmissions } from "../src/lib/income-expense/persist-submissions";
import type { IncomeExpense } from "../src/types";
import type { QueryClient } from "@tanstack/react-query";
import * as core from "../src/lib/idb-core";
import * as serviceHealth from "../src/lib/service-health";

const owner = "73000000-0000-4000-8000-000000000002";
const serverId = "73000000-0000-4000-8000-000000000003";
const commandId = "73000000-0000-4000-8000-000000000004";
function setup() {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
}
function command(locationId = "branch-a"): queue.SyncEvent {
  return { entity: "income_expense", id: `local-${locationId}`, ownerUserId: owner, locationId,
    operation: "update", serverId, timestamp: 1, status: "pending", payload: {
      contractVersion: 2, background: true, commandId, actorUserId: owner, expectedServerId: serverId,
      operation: "update", locationId, clientTempId: `local-${locationId}`, localBillNo: "LOCAL", billOption: "ค่าใช้จ่าย",
    } };
}
function receipt(event: queue.SyncEvent, outcome = "synced") {
  return { commandId: event.payload.commandId, actorUserId: owner, serverId, locationId: event.locationId,
    clientTempId: event.id, operation: event.operation, outcome };
}
function worker(fetch: (url: string, init?: RequestInit) => Promise<Response>, session = async () => true, globals: Record<string, unknown> = {}) {
  return loadSourceModule<typeof import("../src/lib/income-expense/background-sync")>("src/lib/income-expense/background-sync.ts", {
    "@/lib/auth-fetch": { authFetch: fetch, canSyncCurrentSession: session },
    "@/lib/idb-queue": queue,
    "./background-idb": storage,
  }, { navigator: { onLine: true }, window: globalThis, indexedDB: globalThis.indexedDB, ...globals });
}
const client = { invalidateQueries: async () => {} } as unknown as QueryClient;

test("permission loss during POST retains uncertain work and does not stop another authorized branch", async () => {
  setup();
  for (const branch of ["branch-a", "branch-b"]) await queue.enqueueSyncEvent(command(branch));
  const posted: string[] = [];
  await worker(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); posted.push(payload.locationId);
    return payload.locationId === "branch-a"
      ? Response.json({ errorMessage: "Forbidden" }, { status: 403 })
      : Response.json(receipt(command("branch-b")));
  }).runIncomeExpenseBackground(client, owner);
  expect(posted).toEqual(["branch-a", "branch-b"]);
  const remaining = await storage.incomeExpenseOwnerWork(owner);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].status).toBe("pending");
  expect(remaining[0].serverSubmissionAttempted).toBe(true);
  expect(remaining[0].payload).toEqual(command().payload);
});

test("manual retry reaches the requested failed command behind twenty other due commands", async () => {
  setup();
  for (let i = 0; i < 20; i++) await queue.enqueueSyncEvent(command(`blocked-${i}`));
  const target = { ...command("manual-target"), status: "failed" as const, nextAttemptAt: Date.now() + 120000 };
  await queue.enqueueSyncEvent(target);
  const posted: string[] = [];
  await worker(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); posted.push(payload.clientTempId);
    return Response.json(receipt(command(payload.locationId)));
  }).runIncomeExpenseBackground(client, owner, target.id);
  expect(posted).toContain(target.id);
  expect(posted.length).toBeLessThanOrEqual(20);
});

test("a forbidden POST followed by an account change stops before the next branch", async () => {
  setup();
  for (const branch of ["branch-a", "branch-b"]) await queue.enqueueSyncEvent(command(branch));
  let checks = 0, posts = 0;
  await worker(async () => { posts++; return Response.json({}, { status: 403 }); }, async () => ++checks === 1)
    .runIncomeExpenseBackground(client, owner);
  expect(posts).toBe(1);
  const remaining = await storage.incomeExpenseOwnerWork(owner);
  expect(remaining).toHaveLength(2);
  expect(remaining.every((event) => event.status === "pending")).toBe(true);
});

test("background context canonicalizes uppercase UUIDs before querying and comparing the result", async () => {
  const record = "abcdef00-0000-4000-8000-000000000003", branch = "abcdef00-0000-4000-8000-000000000001";
  let queried: unknown;
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/background/route")>("src/app/api/lanflow/income-expense/background/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { sub: owner }, supabase: {
      rpc: async (_name: string, args: unknown) => { queried = args; return { data: { status: "ok", serverId: record,
        locationId: branch, clientTempId: "test", revisionNo: 1, recordStatus: "active", approvalPending: false }, error: null }; },
    } }) },
  });
  const result = await route.GET(new Request(`http://localhost/api/lanflow/income-expense/background?serverId=${record.toUpperCase()}&locationId=${branch.toUpperCase()}`));
  expect(result.status).toBe(200);
  expect(queried).toEqual({ p_server_id: record, p_location_id: branch });
});

test("an empty owner makes no network calls and one round sends at most twenty due commands", async () => {
  setup(); let posts = 0; let checks = 0;
  const module = worker(async (_url, init) => {
    posts++; const payload = JSON.parse(String(init?.body));
    return Response.json(receipt(command(payload.locationId)));
  }, async () => { checks++; return true; });
  await module.runIncomeExpenseBackground(client, owner);
  expect([posts, checks]).toEqual([0, 0]);
  for (let index = 0; index < 25; index++) await queue.enqueueSyncEvent(command(`branch-${index}`));
  await module.runIncomeExpenseBackground(client, owner);
  expect([posts, checks]).toEqual([20, 20]);
  expect(await storage.incomeExpenseOwnerWork(owner)).toHaveLength(5);
});

test("acceptance persists one immutable command before any submission; concurrent acceptance cannot duplicate it", async () => {
  setup();
  const event = command("73000000-0000-4000-8000-000000000001");
  const transaction = { id: serverId, clientTempId: event.id, locationId: event.locationId,
    revisionNo: 1, billOption: "ค่าใช้จ่าย", cost: 100 } as IncomeExpense;
  let posts = 0;
  const module = worker(async (_url, init) => {
    if (init?.method === "POST") posts++;
    return Response.json({ actorUserId: owner, serverId, clientTempId: event.id, locationId: event.locationId,
      billOption: "ค่าใช้จ่าย", revisionNo: 1, recordStatus: "active", approvalPending: false });
  });
  const results = await Promise.allSettled([
    module.acceptIncomeExpenseBackground(transaction, "update", owner),
    module.acceptIncomeExpenseBackground(transaction, "update", owner),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const stored = await storage.incomeExpenseOwnerWork(owner);
  expect(stored).toHaveLength(1);
  expect(stored[0].payload.commandId).toMatch(/^[0-9a-f-]{36}$/);
  expect(posts).toBe(0);
});

test("missing context, changed revision and approval block acceptance without creating work", async () => {
  setup(); const event = command();
  for (const patch of [{ recordStatus: "deleted" }, { revisionNo: 2 }, { approvalPending: true }, { actorUserId: "other" }]) {
    const module = worker(async () => Response.json({ actorUserId: owner, serverId, clientTempId: event.id,
      locationId: event.locationId, billOption: "ค่าใช้จ่าย", revisionNo: 1, recordStatus: "active", approvalPending: false, ...patch }));
    const result = await module.acceptIncomeExpenseBackground({ id: serverId, clientTempId: event.id, locationId: event.locationId,
      revisionNo: 1, billOption: "ค่าใช้จ่าย" } as IncomeExpense, "delete", owner).then(() => true, () => false);
    expect(result).toBe(false);
  }
  expect(await storage.incomeExpenseOwnerWork(owner)).toEqual([]);
});

test("background route rejects wrong actor and unbound acknowledgements; context is private", async () => {
  const event = command("73000000-0000-4000-8000-000000000001");
  const payload = { ...event.payload, expectedRevisionNo: 1, idempotencyKey: `update:${event.id}:1`, recordStatus: "active",
    localBillNo: "LOCAL-BG", txDate: "2026-10-28", type: "expense", title: "Test", cost: 100,
    clientRecordedAt: "2026-10-28T01:00:00.000Z", clientCreatedAt: "2026-10-28T01:00:00.000Z" };
  let rpcCalls = 0;
  let data: unknown = receipt(event);
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/background/route")>("src/app/api/lanflow/income-expense/background/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { sub: owner }, supabase: {
      rpc: async () => { rpcCalls++; return { data, error: null }; },
    } }) },
  });
  const request = (body: unknown) => new Request("http://localhost/api/lanflow/income-expense/background", {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
  expect((await route.POST(request({ ...payload, actorUserId: "other" }))).status).toBe(409);
  expect(rpcCalls).toBe(0);
  expect((await route.POST(request(payload))).status).toBe(200);
  data = { ...receipt(event), commandId: "other" };
  expect((await route.POST(request(payload))).status).toBe(503);
  data = { status: "ok", serverId, locationId: event.locationId, clientTempId: event.id,
    revisionNo: 1, recordStatus: "active", billOption: "ค่าใช้จ่าย", approvalPending: false };
  const context = await route.GET(new Request(`http://localhost/api/lanflow/income-expense/background?serverId=${serverId}&locationId=${event.locationId}`));
  expect(context.status).toBe(200);
  expect(context.headers.get("Cache-Control")).toContain("no-store");
});

test("aborting cleanup rolls back both queue removal and deferred notice", async () => {
  setup(); const event = command(); event.queueId = await queue.enqueueSyncEvent(event);
  const module = loadSourceModule<typeof storage>("src/lib/income-expense/background-idb.ts", {
    "@/lib/idb-core": { ...core, getSyncDb: async () => {
      const db = await core.getSyncDb();
      const original = db.transaction.bind(db);
      db.transaction = ((...args: Parameters<IDBDatabase["transaction"]>) => {
        const tx = original(...args);
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = (name: string) => {
          const store = objectStore(name);
          if (name === core.SYNC_QUEUE_STORE) {
            const remove = store.delete.bind(store);
            store.delete = (key) => { const request = remove(key); tx.abort(); return request; };
          }
          return store;
        };
        return tx;
      }) as IDBDatabase["transaction"];
      return db;
    } },
  });
  expect(await module.completeIncomeExpenseBackground(event, "retained reason").then(() => false, () => true)).toBe(true);
  expect(await queue.getPendingEvents(event)).toHaveLength(1);
  expect(await storage.incomeExpenseNotices(owner, event.locationId)).toEqual([]);
});

test("blocked version-5 upgrade explains old tabs, then preserves work when upgrading to version 7", async () => {
  setup();
  const previous = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lanflow_sync_db", 5);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(core.SYNC_QUEUE_STORE, { keyPath: "queueId", autoIncrement: true });
      store.createIndex("ownerUserId", "ownerUserId"); store.createIndex("id", "id"); store.createIndex("locationId", "locationId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = previous.transaction(core.SYNC_QUEUE_STORE, "readwrite");
    tx.objectStore(core.SYNC_QUEUE_STORE).add(command());
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  const error = await core.getSyncDb().then(() => "", (cause: Error) => cause.message);
  expect(error).toContain("ปิดแท็บ");
  previous.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const upgraded = await core.getSyncDb();
  expect(upgraded.version).toBe(7);
  expect(upgraded.objectStoreNames.contains(core.INCOME_EXPENSE_OUTCOME_STORE)).toBe(true);
  upgraded.close();
  expect(await storage.incomeExpenseOwnerWork(owner)).toHaveLength(1);
});

test("exact cleanup keeps the outcome after reopening, and preserves another tab's newer work", async () => {
  setup();
  const event = command(); event.queueId = await queue.enqueueSyncEvent(event);
  expect(await storage.completeIncomeExpenseBackground(event, "ข้อมูลเปลี่ยนแล้ว")).toBe(true);
  expect(await queue.getPendingEvents(event)).toEqual([]);
  expect(await storage.incomeExpenseNotices(owner, event.locationId)).toHaveLength(1);
  expect(await storage.incomeExpenseNotices("other", event.locationId)).toEqual([]);
  const newer = command(); newer.queueId = await queue.enqueueSyncEvent(newer);
  await queue.updateSyncEvent({ ...newer, timestamp: 2 });
  expect(await storage.completeIncomeExpenseBackground(newer, "old reason")).toBe(false);
  expect(await queue.getPendingEvents(newer)).toHaveLength(1);
  const [notice] = await storage.incomeExpenseNotices(owner, event.locationId);
  await storage.dismissIncomeExpenseNotice(notice);
  expect(await storage.incomeExpenseNotices(owner, event.locationId)).toEqual([]);
});

test("owner round sends accepted commands from two branches without a selected-branch notification", async () => {
  setup();
  for (const branch of ["branch-a", "branch-b"]) await queue.enqueueSyncEvent(command(branch));
  const posted: string[] = [];
  const module = worker(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); posted.push(payload.locationId);
    return Response.json(receipt(command(payload.locationId)));
  });
  await module.runIncomeExpenseBackground(client, owner);
  expect(posted).toEqual(["branch-a", "branch-b"]);
  expect(await storage.incomeExpenseOwnerWork(owner)).toEqual([]);
  expect(await storage.incomeExpenseNotices(owner, "branch-a")).toEqual([]);
});

for (const failureAt of ["session-response", "session-network", "session-timeout", "failed-context", "submission"]) {
  test(`background ${failureAt} failure retains work without changing the global service banner`, async () => {
    setup();
    serviceHealth.recordServiceResponse("/api/auth/me", 200);
    serviceHealth.recordServiceResponse("/api/lanflow/income-expense/background", 200);
    const event = command();
    if (failureAt === "failed-context") event.status = "failed";
    await queue.enqueueSyncEvent(event);
    const fetch = async (url: string) => {
      if (url === "/api/auth/me" && failureAt === "session-network") throw new Error("network unavailable");
      if (url === "/api/auth/me" && failureAt === "session-timeout") throw new DOMException("Timed out", "TimeoutError");
      if (url === "/api/auth/me" && !failureAt.startsWith("session")) {
        return Response.json({ profile: { id: owner, role: "admin", locationIds: [event.locationId] } });
      }
      return Response.json({ error: "temporarily unavailable" }, { status: 503 });
    };
    const dependencies = {
      "@/lib/idb-queue": queue, "./background-idb": storage,
      "@/lib/service-health": serviceHealth, "@/lib/connectivity": { isDeviceOnline: () => true },
    };
    const globals = { navigator: { onLine: true }, window: globalThis, indexedDB, fetch, ReadableStream };
    const module = loadSourceModule<typeof import("../src/lib/income-expense/background-sync")>(
      "src/lib/income-expense/background-sync.ts", dependencies, globals);
    await module.runIncomeExpenseBackground(client, owner);
    const remaining = await storage.incomeExpenseOwnerWork(owner);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload).toEqual(event.payload);
    const backgroundUnavailable = serviceHealth.getServiceUnavailableSnapshot();
    // The same real transport still exposes a foreground service failure.
    const auth = loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts", dependencies, globals);
    await auth.authFetch("/api/foreground-health-control").then((response) => response.json());
    const foregroundUnavailable = serviceHealth.getServiceUnavailableSnapshot();
    for (const path of ["/api/auth/me", "/api/lanflow/income-expense/background", "/api/foreground-health-control"])
      serviceHealth.recordServiceResponse(path, 200);
    expect(backgroundUnavailable).toBe(false);
    expect(foregroundUnavailable).toBe(true);
  });
}

test("confirmed session revocation redirects immediately and preserves every owner's immutable queued command", async () => {
  setup();
  for (const branch of ["branch-a", "branch-b"]) await queue.enqueueSyncEvent(command(branch));
  const before = await storage.incomeExpenseOwnerWork(owner);
  const redirects: string[] = [], events: string[] = [];
  let posts = 0;
  const module = loadSourceModule<typeof import("../src/lib/income-expense/background-sync")>(
    "src/lib/income-expense/background-sync.ts", {
      "@/lib/idb-queue": queue, "./background-idb": storage,
      "@/lib/connectivity": { isDeviceOnline: () => true },
    }, {
      navigator: { onLine: true }, indexedDB, ReadableStream,
      window: { indexedDB, location: { pathname: "/", assign: (url: string) => redirects.push(url) },
        dispatchEvent: (event: { type: string }) => events.push(event.type) },
      CustomEvent: class { constructor(public type: string, public detail: unknown) {} },
      fetch: async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") posts++;
        return Response.json({ errorCode: "SESSION_REVOKED" }, { status: 401 });
      },
    });
  await module.runIncomeExpenseBackground(client, owner);
  expect(redirects.length).toBeGreaterThan(0);
  expect(redirects.every((url) => url === "/login")).toBe(true);
  expect(events).toContain("lanflow:auth-required");
  expect(posts).toBe(0);
  expect(await storage.incomeExpenseOwnerWork(owner)).toEqual(before);
});

test("cross-branch worker leaves legacy creates, sales and unmarked edits on their original path", async () => {
  setup();
  for (const patch of [{ operation: "create" }, { billOption: "บิลขาย" }, { background: undefined }, { contractVersion: 1 }]) {
    const event = command();
    await queue.enqueueSyncEvent({ ...event, payload: { ...event.payload, ...patch } });
  }
  let calls = 0;
  await worker(async () => { calls++; return Response.json({}); }).runIncomeExpenseBackground(client, owner);
  expect(calls).toBe(0);
  expect(await storage.incomeExpenseOwnerWork(owner)).toHaveLength(4);
});

test("shared badge and overview refresh once per completed owner round, never on an empty round", async () => {
  setup();
  for (const branch of ["branch-a", "branch-b"]) await queue.enqueueSyncEvent(command(branch));
  const invalidations: unknown[] = [];
  const queryClient = { invalidateQueries: async ({ queryKey }: { queryKey: unknown }) => { invalidations.push(queryKey); } } as unknown as QueryClient;
  const module = worker(async (_url, init) => Response.json(receipt(command(JSON.parse(String(init?.body)).locationId))));
  await module.runIncomeExpenseBackground(queryClient, owner);
  expect(invalidations.filter((key) => JSON.stringify(key) === '["actionableBadges"]')).toHaveLength(1);
  expect(invalidations.filter((key) => JSON.stringify(key) === '["dashboardBranchSummaries"]')).toHaveLength(1);
  const count = invalidations.length;
  await module.runIncomeExpenseBackground(queryClient, owner);
  expect(invalidations).toHaveLength(count);
});

test("unknown acknowledgement and network failure retain immutable work for bounded retry", async () => {
  setup(); const event = command(); await queue.enqueueSyncEvent(event);
  const module = worker(async () => Response.json({ status: "synced" }));
  await module.runIncomeExpenseBackground(client, owner);
  const [remaining] = await storage.incomeExpenseOwnerWork(owner);
  expect(remaining.payload).toEqual(event.payload);
  expect(remaining.status).toBe("pending");
  let posted = false;
  await worker(async () => { posted = true; throw new Error("network"); }).runIncomeExpenseBackground(client, owner);
  expect(posted).toBe(false);
});

test("session changing between commands prevents starting the next request", async () => {
  setup();
  for (const branch of ["branch-a", "branch-b"]) await queue.enqueueSyncEvent(command(branch));
  let calls = 0;
  const module = worker(async () => { calls++; return Response.json(receipt(command())); }, async () => calls === 0);
  await module.runIncomeExpenseBackground(client, owner);
  expect(calls).toBe(1);
  expect((await storage.incomeExpenseOwnerWork(owner)).map((event) => event.locationId)).toEqual(["branch-b"]);
});

test("a stalled response times out without stopping another branch or losing the first command", async () => {
  setup();
  for (const branch of ["branch-a", "branch-b"]) await queue.enqueueSyncEvent(command(branch));
  const module = worker(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    if (payload.locationId === "branch-b") return Response.json(receipt(command("branch-b")));
    init?.signal?.throwIfAborted();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
  }, async () => true, { AbortSignal: { timeout: () => AbortSignal.timeout(1) } });
  await module.runIncomeExpenseBackground(client, owner);
  const remaining = await storage.incomeExpenseOwnerWork(owner);
  expect(remaining.map((event) => event.locationId)).toEqual(["branch-a"]);
  expect(remaining[0].status).toBe("pending");
});

test("account switch after session check pauses the immutable command instead of failing it", async () => {
  setup(); const event = command(); await queue.enqueueSyncEvent(event);
  const module = worker(async () => Response.json({ errorCode: "ACTOR_CHANGED" }, { status: 409 }));
  await module.runIncomeExpenseBackground(client, owner);
  const [pending] = await storage.incomeExpenseOwnerWork(owner);
  expect(pending.status).toBe("pending");
  expect(pending.payload).toEqual(event.payload);
});

test("failed branch does not block a second branch; conflict draft is retired with a durable reason", async () => {
  setup();
  for (const branch of ["branch-a", "branch-b"]) await queue.enqueueSyncEvent(command(branch));
  const module = worker(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    return payload.locationId === "branch-a" ? Response.json({ errorMessage: "locked" }, { status: 400 })
      : Response.json(receipt(command("branch-b"), "revision_conflict"));
  });
  await module.runIncomeExpenseBackground(client, owner);
  expect((await storage.incomeExpenseOwnerWork(owner)).map((event) => event.status)).toEqual(["failed"]);
  expect(await storage.incomeExpenseNotices(owner, "branch-b")).toHaveLength(1);
});

test("partial mixed submission retry does not repeat already accepted update or create", async () => {
  const transactions = ["existing", "new-a", "new-b"].map((id, index) => ({ id: index ? id : serverId,
    clientTempId: id, billOption: "ค่าใช้จ่าย", serverBillNo: index ? undefined : "IE-1" }) as IncomeExpense);
  const accepted = new Map<string, "persisted" | "approval">();
  const calls: string[] = []; let fail = true;
  const actions = { editing: transactions[0], accepted, approve: async () => ({ requiresApproval: false }),
    update: async (transaction: IncomeExpense) => { calls.push(transaction.clientTempId); return transaction; },
    create: async (transaction: IncomeExpense) => { if (transaction.clientTempId === "new-b" && fail) throw new Error("storage"); calls.push(transaction.clientTempId); return transaction; } };
  expect((await persistIncomeExpenseSubmissions(transactions, actions)).persistError).toBeTruthy();
  fail = false;
  expect((await persistIncomeExpenseSubmissions(transactions, actions)).persistError).toBeUndefined();
  expect(calls).toEqual(["existing", "new-a", "new-b"]);
});
