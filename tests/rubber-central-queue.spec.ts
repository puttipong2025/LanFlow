import { expect, test } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";
import * as idb from "../src/lib/idb-core";
import * as queue from "../src/lib/idb-queue";
import * as completion from "../src/lib/rubber-bills/complete-command";
import { mergeRubberBillLocalEvents, rubberBillFromSyncEvent } from "../src/lib/rubber-bills/local-feed";
import { loadSourceModule } from "./helpers/load-source-module";
import type { RubberQueueRow } from "../src/lib/rubber-bills/central-queue-contract";
import { getPendingServerActionBlockReason } from "../src/lib/record-action-locks";
import { QueryClient } from "@tanstack/react-query";
import type { RubberBill } from "../src/types";

const owner = "ad000000-0000-4000-8000-000000000001";
const branch = "ad000000-0000-4000-8000-000000000002";
const otherBranch = "ad000000-0000-4000-8000-000000000003";
const server = "ad000000-0000-4000-8000-000000000004";
test.beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
});

async function fixture(locationId = branch): Promise<queue.SyncEvent> {
  const commandId = crypto.randomUUID();
  const event: queue.SyncEvent = { id: crypto.randomUUID(), entity: "rubber_bills", ownerUserId: owner,
    locationId, operation: "create", timestamp: Date.now(), status: "pending", payload: {
      centralQueue: true, background: true, actorUserId: owner, contractVersion: 2, commandId, idempotencyKey: commandId,
      expectedQueueVersion: 0, expectedCommandGeneration: 0, expectedRevisionNo: 0, operation: "create", locationId,
      billDate: "2026-10-28", localBillNo: "L-CENTRAL", customerName: "Fixture", acidPackCount: 0, items: [],
      clientCreatedAt: "2026-10-28T00:00:00Z", clientRecordedAt: "2026-10-28T00:00:00Z",
    } };
  event.payload.clientTempId = event.id;
  event.queueId = await queue.enqueueSyncEvent(event);
  return event;
}

test("create, edit and delete row buttons stay disabled throughout pending sync", async () => {
  const event = await fixture();
  const { RubberBillsTable } = loadSourceModule<typeof import("../src/components/rubber-bills/RubberBillsTable")>(
    "src/components/rubber-bills/RubberBillsTable.tsx", {});
  type Element = { props: { children?: unknown; disabled?: boolean; onClick?: unknown; className?: string } };
  function nodes(value: unknown): Element[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const element = value as Element;
    return [element, ...nodes(element.props.children)];
  }
  const noop = () => {};
  const edit = () => {}, remove = () => {};
  for (const operation of ["create", "update", "delete"] as const) {
    for (const attempted of [false, true, false]) {
      const pendingEvent = { ...event, operation, serverSubmissionAttempted: attempted,
        serverId: operation === "create" ? undefined : server, serverBillNo: operation === "create" ? undefined : "S-1" };
      const draft = rubberBillFromSyncEvent(pendingEvent, owner)!;
      const confirmed = { ...draft, id: server, serverBillNo: "S-1", syncStatus: "synced" as const, serverSubmissionAttempted: false };
      const [projected] = mergeRubberBillLocalEvents(operation === "create" ? [] : [confirmed], [pendingEvent], owner);
      const render = (bill: typeof draft) => nodes(RubberBillsTable({ bills: [bill], page: 1, pageSize: 50,
        onPageChange: noop, onView: noop, onEvidence: noop, onEdit: edit, onDelete: remove,
        onPrint: noop, onRetry: noop, onDiscardLocal: noop, onOpenOcrSourceImage: noop,
        retryDisabled: false, discardDisabled: false, evidenceStatesByBillId: new Map(), evidenceOnline: true,
        getActionBlockReason: getPendingServerActionBlockReason }));
      const pendingNodes = render(projected);
      const pending = pendingNodes.filter(node => node.props.onClick && node.props.children === "แก้");
      expect(pending, `${operation}, submission attempted ${attempted}`).toHaveLength(1);
      expect(pending[0].props.disabled, `${operation}, submission attempted ${attempted}`).toBe(true);
      expect(pendingNodes.find(node => node.props.onClick && node.props.className?.includes("bg-danger"))?.props.disabled).toBe(true);
      const synced = render(confirmed);
      expect(synced.find(node => node.props.children === "แก้")?.props.disabled).toBe(false);
      expect(synced.find(node => node.props.onClick && node.props.className?.includes("bg-danger"))?.props.disabled).toBe(false);
    }
  }
});

test("save and delete publish the local queue before releasing the mutation lock without waiting for network refresh", async () => {
  const event = await fixture();
  const client = new QueryClient();
  type Mutation = { onSuccess: (data: { approvalPending: boolean }, variables: { bill: RubberBill }) => unknown };
  const mutations: Mutation[] = [];
  let release!: () => void;
  let gate: Promise<void>;
  const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useQueryClient: () => client, useMutation: (options: Mutation) => {
      mutations.push(options); return {};
    } },
    "@/lib/idb-queue": { ...queue, getPendingEvents: async () => { await gate; return [event]; } },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: () => new Promise(() => {}) },
  }, { navigator: { onLine: false } });
  hook.useRubberBillMutations(branch, owner, null);
  for (const mutation of mutations) {
    client.setQueryData(["rubberBillLocalState", owner, branch], { events: [] });
    gate = new Promise<void>(resolve => { release = resolve; });
    let released = false;
    const completion = Promise.resolve(mutation.onSuccess({ approvalPending: false }, {
      bill: rubberBillFromSyncEvent(event, owner)!,
    })).then(() => { released = true; });
    await Promise.resolve();
    expect(released).toBe(false);
    release();
    await completion;
    expect(client.getQueryData(["rubberBillLocalState", owner, branch])).toEqual({ events: [event] });
  }
  client.clear();
});

test("a post-commit queue read failure preserves success and keeps the committed bill locked", async () => {
  const event = await fixture();
  const client = new QueryClient();
  type Mutation = { onSuccess: (data: { approvalPending: boolean; committedLocalEvent: queue.SyncEvent }, variables: { bill: RubberBill }) => unknown };
  const mutations: Mutation[] = [];
  const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useQueryClient: () => client, useMutation: (options: Mutation) => { mutations.push(options); return {}; } },
    "@/lib/idb-queue": { ...queue, getPendingEvents: async () => { throw new Error("storage unavailable after commit"); } },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
  }, { navigator: { onLine: false } });
  hook.useRubberBillMutations(branch, owner, null);
  for (const mutation of mutations) {
    client.setQueryData(["rubberBillLocalState", owner, branch], { events: [] });
    await expect(Promise.resolve(mutation.onSuccess({ approvalPending: false, committedLocalEvent: event }, {
      bill: rubberBillFromSyncEvent(event, owner)!,
    }))).resolves.toBeUndefined();
    expect(client.getQueryData(["rubberBillLocalState", owner, branch])).toEqual({ events: [event] });
    const progressed = { ...event, status: "failed" as const, failureHttpStatus: 400, errorMessage: "กรุณาแก้ไขข้อมูล" };
    client.setQueryData(["rubberBillLocalState", owner, branch], { events: [progressed] });
    await mutation.onSuccess({ approvalPending: false, committedLocalEvent: event }, {
      bill: rubberBillFromSyncEvent(event, owner)!,
    });
    expect(client.getQueryData(["rubberBillLocalState", owner, branch])).toEqual({ events: [progressed] });
  }
  client.clear();
});

test("failed local publication preserves concurrent progress but replaces a stale proposal", async () => {
  const event = await fixture();
  const unrelated = await fixture();
  const client = new QueryClient();
  const key = ["rubberBillLocalState", owner, branch];
  let rejectRead!: (reason: Error) => void;
  const cache = loadSourceModule<typeof import("../src/lib/rubber-bills/feed-cache")>("src/lib/rubber-bills/feed-cache.ts", {
    "@/lib/idb-queue": { ...queue, getPendingEvents: () => new Promise((_resolve, reject) => { rejectRead = reject; }) },
  });
  client.setQueryData(key, { events: [event, unrelated] });
  const publishing = cache.publishRubberBillLocalQueue(client, { ownerUserId: owner, locationId: branch }, event.id, event);
  const progressed = { ...event, status: "failed" as const, failureHttpStatus: 400 };
  client.setQueryData(key, { events: [progressed, unrelated] });
  rejectRead(new Error("read failed"));
  await publishing;
  expect(client.getQueryData(key)).toEqual({ events: [progressed, unrelated] });

  const stale = { ...event, payload: { ...event.payload, customerName: "old proposal" } };
  client.setQueryData(key, { events: [stale, unrelated] });
  const replacement = cache.publishRubberBillLocalQueue(client, { ownerUserId: owner, locationId: branch }, event.id, event);
  rejectRead(new Error("read failed"));
  await replacement;
  expect(client.getQueryData(key)).toEqual({ events: [unrelated, event] });

  client.setQueryData(key, { events: [] });
  const concurrentOtherBill = cache.publishRubberBillLocalQueue(client, { ownerUserId: owner, locationId: branch }, event.id, event);
  client.setQueryData(key, { events: [unrelated] });
  rejectRead(new Error("read failed"));
  await concurrentOtherBill;
  expect(client.getQueryData(key)).toEqual({ events: [unrelated, event] });
  client.clear();
});
function row(event: queue.SyncEvent, done = false): RubberQueueRow {
  return { commandId: event.payload.commandId, actorUserId: owner, locationId: event.locationId,
    clientTempId: event.id, action: event.operation, state: done ? "done" : "queued", acceptedAt: "2026-10-28T00:00:00Z",
    version: 1, attempts: 0, nextAttemptAt: "2026-10-28T00:00:00Z", errorCode: null,
    completedAt: done ? "2026-10-28T00:00:01Z" : null, canRetire: false,
    result: done ? { status: "synced", commandId: event.payload.commandId, id: server,
      serverBillNo: "S-CENTRAL", revisionNo: 1, serverReceivedAt: "2026-10-28T00:00:01Z" } : null };
}
function runner(fetch: (url: string, init?: RequestInit) => Promise<Response>, session = async () => true) {
  return loadSourceModule<typeof import("../src/lib/rubber-bills/central-sync")>("src/lib/rubber-bills/central-sync.ts", {
    "@/lib/idb-core": idb, "@/lib/idb-queue": queue,
    "@/lib/auth-fetch": { authFetch: fetch, canSyncCurrentSession: session },
    "./complete-command": completion,
    "@/lib/rubber-bills/complete-command": completion,
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    "@/lib/rubber-bills/background-notifications": { notifyRubberBackgroundFailure: async () => {}, notifyRubberManagerOutcome: () => {} },
  }, { navigator: { onLine: true } });
}
const client = { invalidateQueries: async () => {} } as never;

for (const disposeDuringRead of [true, false]) {
test(disposeDuringRead ? "active polling does not start a stale scope after its IndexedDB read completes"
  : "active polling stops scheduling when the owner has no pending work", async () => {
  let cleanup!: () => void;
  let poll!: () => Promise<void>;
  let release!: (events: queue.SyncEvent[]) => void;
  let calls = 0;
  let activeTimers = 0;
  const hook = loadSourceModule<typeof import("../src/hooks/useLanFlowOfflineSyncCoordinator")>("src/hooks/useLanFlowOfflineSyncCoordinator.ts", {
    react: { useEffect: (effect: () => () => void) => { cleanup = effect(); } },
    sonner: { toast: { error: () => {} } },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/connectivity": { isDeviceOnline: () => true, subscribeConnectivity: () => () => {} },
    "@/lib/rubber-bills/background-notifications": { registerRubberBackgroundNotifications: () => () => {} },
    "@/hooks/useIncomeExpense": { syncPendingIncomeExpense: async () => {} },
    "@/hooks/useRubberBills": { syncPendingRubberBills: async () => {} },
    "@/lib/income-expense/background-sync": { runIncomeExpenseBackground: async () => {} },
    "@/lib/rubber-bills/central-sync": { runRubberCentralQueue: async () => { calls++; },
      subscribeRubberQueueActivity: (_owner: string, callback: () => void) => { callback(); return () => {}; },
      rubberOwnerWork: () => new Promise(resolve => { release = resolve; }) },
  }, { window: { addEventListener: () => {}, removeEventListener: () => {} },
    setInterval: () => 1,
    clearInterval: () => {}, setTimeout: (callback: () => Promise<void>, delay: number) => {
      if (delay === 2_000) { poll = callback; activeTimers++; } return 1;
    }, clearTimeout: () => {} });
  hook.useLanFlowOfflineSyncCoordinator({ ownerUserId: owner, locationId: branch });
  const initialCalls = calls;
  const pending = poll();
  if (disposeDuringRead) cleanup();
  release(disposeDuringRead ? [await fixture()] : []);
  await pending;
  expect(calls).toBe(initialCalls);
  expect(activeTimers).toBe(1);
  if (!disposeDuringRead) cleanup();
});
}

for (const central of [false, true]) {
  test(`local discard ${central ? "preserves a central correction" : "still removes a legacy failure"}`, async () => {
    const event = await fixture();
    event.payload.centralQueue = central;
    event.status = "failed"; event.failureHttpStatus = 400; event.serverSubmissionAttempted = false;
    await queue.updateSyncEvent(event);
    expect(rubberBillFromSyncEvent(event, owner)?.canDiscardSyncFailure).toBe(!central);
    let deletedReceipts = 0;
    const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
      "@tanstack/react-query": { useQueryClient: () => client, useMutation: (options: unknown) => options },
      "@/lib/idb-queue": { ...queue, deleteRubberBillReceiptSnapshotsByClientTempId: async () => { deletedReceipts++; } },
      "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
    }, { navigator: { onLine: true } });
    const discard = hook.useRubberBillMutations(branch, owner).discardSyncProblem(event.id);
    const error = await discard.then(() => null, (cause: Error) => cause.message);
    if (central) expect(error).toContain("คิวซิงก์กลาง");
    else expect(error).toBeNull();
    expect(await queue.getPendingEvents(event)).toHaveLength(central ? 1 : 0);
    expect(deletedReceipts).toBe(central ? 0 : 1);
  });
}

test("central correction displays a disabled discard action while legacy failure remains discardable", async () => {
  const event = await fixture(); event.status = "failed"; event.failureHttpStatus = 400;
  const { RubberBillsTable } = loadSourceModule<typeof import("../src/components/rubber-bills/RubberBillsTable")>(
    "src/components/rubber-bills/RubberBillsTable.tsx", {});
  type Element = { props: { children?: unknown; "aria-label"?: string; disabled?: boolean } };
  function nodes(value: unknown): Element[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object" || !("props" in value)) return [];
    const element = value as Element;
    return [element, ...nodes(element.props.children)];
  }
  for (const central of [false, true]) {
    event.payload.centralQueue = central;
    const tree = RubberBillsTable({ bills: [rubberBillFromSyncEvent(event, owner)!], page: 1, pageSize: 50,
      onPageChange: () => {}, onView: () => {}, onEvidence: () => {}, onEdit: () => {}, onDelete: () => {},
      onPrint: () => {}, onRetry: () => {}, onDiscardLocal: () => {}, onOpenOcrSourceImage: () => {},
      retryDisabled: false, discardDisabled: false, evidenceStatesByBillId: new Map(), evidenceOnline: true });
    const label = central ? "กรุณาแก้ไขร่างจากคิวซิงก์กลาง" : "ทิ้งรายการค้างในเครื่อง";
    const discard = nodes(tree).find(node => node.props["aria-label"] === label);
    expect(discard).toBeDefined();
    expect(discard!.props.disabled).toBe(central);
  }
});

test("central admission keeps immutable local work until a confirmed business result", async () => {
  const event = await fixture();
  const sends: { url: string; method?: string; payload?: unknown }[] = [];
  const sync = runner(async (url, init) => {
    sends.push({ url, method: init?.method, payload: init?.body && JSON.parse(String(init.body)) });
    return Response.json(row(event));
  });
  await sync.runRubberCentralQueue(client, owner);
  const [current] = await queue.getPendingEvents(event);
  expect(current.payload).toEqual(event.payload);
  expect(current.serverSubmissionAttempted).toBe(true);
  expect(sends).toHaveLength(1);
  expect(sends[0].url).toBe("/api/lanflow/rubber-bills/queue");
  expect(sends[0].payload).toEqual(event.payload);
});

test("new work arriving during admission drains without another recovery tick and keeps one upload active", async () => {
  const first = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const commands: string[] = [];
  let active = 0, maximum = 0;
  const sync = runner(async (_url, init) => {
    active++; maximum = Math.max(maximum, active);
    const payload = JSON.parse(String(init?.body));
    commands.push(payload.commandId);
    if (commands.length === 1) { entered(); await gate; }
    active--;
    const current = (await queue.getPendingEvents(first)).find(event => event.payload.commandId === payload.commandId)!;
    return Response.json(row(current));
  });
  const running = sync.runRubberCentralQueue(client, owner);
  await started;
  const second = await fixture();
  const joined = sync.runRubberCentralQueue(client, owner);
  release();
  await Promise.all([running, joined]);
  expect(commands).toEqual([first.payload.commandId, second.payload.commandId]);
  expect(maximum).toBe(1);
  expect(await queue.getPendingEvents(first)).toHaveLength(2);
});

test("continuous new arrivals are capped at three rounds per flight", async () => {
  await fixture();
  let sends = 0;
  let sync!: ReturnType<typeof runner>;
  sync = runner(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    const current = (await queue.getPendingEvents({ entity: "rubber_bills", ownerUserId: owner, locationId: branch }))
      .find(event => event.payload.commandId === payload.commandId)!;
    sends++;
    await fixture();
    void sync.runRubberCentralQueue(client, owner);
    return Response.json(row(current));
  });
  await sync.runRubberCentralQueue(client, owner);
  expect(sends).toBe(3);
});

test("unchanged admitted pending status does not refetch business queries on each poll", async () => {
  const event = await fixture();
  await queue.updateSyncEvent({ ...event, centralAccepted: true } as queue.SyncEvent);
  let invalidations = 0;
  const sync = runner(async () => Response.json(row(event)));
  await sync.runRubberCentralQueue({ invalidateQueries: async () => { invalidations++; } } as never, owner);
  expect(invalidations).toBe(0);
  expect(await queue.getPendingEvents(event)).toHaveLength(1);
});

for (const state of ['paused', 'retry_wait'] as const) {
  test(`server ${state} backoff avoids polling the same job every two seconds`, async () => {
    const event = await fixture();
    await queue.updateSyncEvent({ ...event, centralAccepted: true } as queue.SyncEvent);
    const started = Date.now();
    let reads = 0;
    const sync = runner(async () => { reads++; return Response.json({ ...row(event), state,
      nextAttemptAt: new Date(started + 60_000).toISOString() }); });
    await sync.runRubberCentralQueue(client, owner);
    const [retained] = await sync.rubberOwnerWork(owner);
    expect(retained.nextAttemptAt).toBeGreaterThanOrEqual(started + 30_000);
    expect(retained.nextAttemptAt).toBeLessThanOrEqual(Date.now() + 30_000);
    await sync.runRubberCentralQueue(client, owner);
    expect(reads).toBe(1);
    expect(retained.payload).toEqual(event.payload);
  });
}

test('explicit recovery can recheck an admitted receipt before its backoff without resubmitting it', async () => {
  const event = await fixture();
  await queue.updateSyncEvent({ ...event, centralAccepted: true, nextAttemptAt: Date.now() + 30_000 } as queue.SyncEvent);
  const methods: string[] = [];
  const sync = runner(async (_url, init) => { methods.push(init?.method ?? 'GET'); return Response.json(row(event, true)); });
  await sync.runRubberCentralQueue(client, owner);
  expect(methods).toEqual([]);
  await sync.runRubberCentralQueue(client, owner, true);
  expect(methods).toEqual(['GET']);
  expect(await queue.getPendingEvents(event)).toHaveLength(0);
});

test('explicit receipt recovery preserves admission backoff for an unknown command', async () => {
  const event = await fixture();
  await queue.updateSyncEvent({ ...event, serverSubmissionAttempted: true, nextAttemptAt: Date.now() + 30_000 } as queue.SyncEvent);
  let requests = 0;
  const sync = runner(async () => { requests++; throw new Error('Do not resubmit unknown admission early'); });
  await sync.runRubberCentralQueue(client, owner, true);
  expect(requests).toBe(0);
  expect((await queue.getPendingEvents(event))[0].payload).toEqual(event.payload);
});

test('receipt recovery arriving during admission joins the owner flight without losing its wake', async () => {
  const admitted = await fixture();
  await queue.updateSyncEvent({ ...admitted, centralAccepted: true, nextAttemptAt: Date.now() + 30_000 } as queue.SyncEvent);
  const fresh = await fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const methods: string[] = [];
  const sync = runner(async (url, init) => {
    methods.push(init?.method ?? 'GET');
    if (init?.method === 'POST') { entered(); await gate; return Response.json(row(fresh)); }
    const id = new URL(url, 'https://example.test').searchParams.get('commandId');
    return Response.json(row(id === admitted.payload.commandId ? admitted : fresh, true));
  });
  const running = sync.runRubberCentralQueue(client, owner);
  await started;
  const joined = sync.runRubberCentralQueue(client, owner, true);
  release(); await Promise.all([running, joined]);
  expect(methods).toEqual(['POST', 'GET', 'GET']);
  expect(await queue.getPendingEvents(admitted)).toHaveLength(0);
});

for (const mismatch of ["actorUserId", "locationId", "clientTempId", "commandId", "emptyResult", "wrongRevision"] as const) {
  test(`uncertain central result ${mismatch} cannot acknowledge or replace an intent`, async () => {
    const event = await fixture();
    const result = row(event, true);
    if (mismatch === "emptyResult") result.result = {};
    else if (mismatch === "wrongRevision") { result.result!.revisionNo = 0; }
    else result[mismatch] = crypto.randomUUID();
    await runner(async () => Response.json(result)).runRubberCentralQueue(client, owner);
    const [retained] = await queue.getPendingEvents(event);
    expect(retained.payload).toEqual(event.payload);
  });
}

test("owner round drains another branch while a first branch has a transient failure", async () => {
  const first = await fixture();
  const second = await fixture(otherBranch);
  const sent: string[] = [];
  await runner(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); sent.push(payload.locationId);
    if (payload.locationId === branch) throw new Error("network unavailable");
    return Response.json(row(second, true));
  }).runRubberCentralQueue(client, owner);
  expect(sent).toEqual([branch, otherBranch]);
  expect(await queue.getPendingEvents(first)).toHaveLength(1);
  expect(await queue.getPendingEvents(second)).toHaveLength(0);
});

test("account changes during upload do not reconcile the previous owner's work", async () => {
  const event = await fixture(); let account = true;
  await runner(async () => { account = false; return Response.json(row(event, true)); }, async () => account)
    .runRubberCentralQueue(client, owner);
  expect(await queue.getPendingEvents(event)).toHaveLength(1);
});

test("lost admission response reuses the exact identity after reconnect", async () => {
  const event = await fixture(); const commands: unknown[] = []; let attempt = 0;
  const sync = runner(async (_url, init) => {
    commands.push(JSON.parse(String(init?.body)));
    if (attempt++ === 0) throw new Error("response lost after commit");
    return Response.json(row(event, true));
  });
  await sync.runRubberCentralQueue(client, owner);
  const [retained] = await queue.getPendingEvents(event);
  await queue.updateSyncEvent({ ...retained, nextAttemptAt: 0 } as queue.SyncEvent);
  await sync.runRubberCentralQueue(client, owner);
  expect(commands).toEqual([event.payload, event.payload]);
  expect(await queue.getPendingEvents(event)).toHaveLength(0);
});

test("old outcomes preserve a draft changed in another tab during the request", async () => {
  const event = await fixture();
  await runner(async () => {
    const [current] = await queue.getPendingEvents(event);
    await queue.updateSyncEvent({ ...current, payload: { ...current.payload, customerName: "Changed elsewhere" } });
    return Response.json(row(event, true));
  }).runRubberCentralQueue(client, owner);
  expect((await queue.getPendingEvents(event))[0].payload.customerName).toBe("Changed elsewhere");
});

test("new create returns after durable local commit without submitting business or waiting for POST", async () => {
  const event = await fixture(); await queue.removeSyncEvent(event.queueId!);
  const bill = { ...rubberBillFromSyncEvent(event, owner)!, revisionNo: 0 };
  let posts = 0;
  const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useQueryClient: () => client, useMutation: (options: { mutationFn: (v: unknown) => Promise<unknown> }) => ({ mutateAsync: options.mutationFn }) },
    "@/lib/idb-queue": queue,
    "@/lib/auth-fetch": { authFetch: async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts++; return new Promise(() => {}); }
      return Response.json({ generation: 0, revisionNo: 0, queueVersion: 0, recordStatus: null });
    }, assertApiResponse: async () => {} },
    "sonner": { toast: {} },
  }, { navigator: { onLine: true } });
  const mutations = hook.useRubberBillMutations(branch, owner, { effectivePriceCap: 50 } as never);
  const saved = await mutations.addBill(bill);
  expect(saved.syncStatus).toBe("pending");
  expect(saved.serverSubmissionAttempted).toBe(true);
  expect(posts).toBe(0);
  const [accepted] = await queue.getPendingEvents(event);
  expect("committedLocalEvent" in saved ? saved.committedLocalEvent : undefined).toEqual(accepted);
  expect(accepted.payload.centralQueue).toBe(true);
  expect(accepted.payload.actorUserId).toBe(owner);
  expect(accepted.payload.expectedQueueVersion).toBe(0);
});

test("origin printing is serial and a branch change permanently skips retrospective printing", async () => {
  const event = await fixture();
  const next = await fixture();
  const bill = rubberBillFromSyncEvent(event, owner)!;
  bill.netTotal = 100;
  const prints = loadSourceModule<typeof import("../src/lib/rubber-bills/central-print")>("src/lib/rubber-bills/central-print.ts", {}, { navigator: { onLine: true } });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const stop = prints.registerRubberQueuePrinter(owner, branch, async current => { calls.push(current.clientTempId); await gate; });
  prints.printAcceptedRubberReceipt(owner, branch, bill);
  prints.printAcceptedRubberReceipt(owner, branch, { ...bill, clientTempId: next.id });
  await Promise.resolve(); expect(calls).toEqual([event.id]);
  stop(); release(); await new Promise(resolve => setTimeout(resolve, 0));
  const stopAgain = prints.registerRubberQueuePrinter(owner, branch, async current => { calls.push(current.clientTempId); });
  await Promise.resolve(); expect(calls).toEqual([event.id]);
  stopAgain();
});

test("origin printing waits for a busy PDF and starts when idle", async () => {
  const event = await fixture(); const bill = rubberBillFromSyncEvent(event, owner)!; bill.netTotal = 100;
  const prints = loadSourceModule<typeof import("../src/lib/rubber-bills/central-print")>("src/lib/rubber-bills/central-print.ts", {},
    { navigator: { onLine: true }, setTimeout });
  let busy = true, calls = 0;
  const stop = prints.registerRubberQueuePrinter(owner, branch, async () => { calls++; }, () => busy);
  prints.printAcceptedRubberReceipt(owner, branch, bill);
  await new Promise(resolve => setTimeout(resolve, 60)); expect(calls).toBe(0);
  busy = false;
  await expect.poll(() => calls, { intervals: [60] }).toBe(1);
  stop();
});

for (const action of ["approve", "cancel"] as const) {
  test(`manager ${action} commits one exact-target local command without waiting for a business POST`, async () => {
    const target = crypto.randomUUID(); let calls = 0;
    const sync = runner(async () => { calls++; throw new Error("No business POST expected during local acceptance"); });
    expect(await sync.acceptRubberManagerCommand(owner, branch, target, action)).toEqual({ queued: true });
    const [event] = await queue.getPendingEvents({ entity: "rubber_bills", ownerUserId: owner, locationId: branch });
    expect(event.payload.queueAction).toBe(action); expect(event.payload.targetRequestId).toBe(target);
    expect(event.id).toBe(`request:${target}`); expect(event.payload.actorUserId).toBe(owner);
    expect(calls).toBe(0);
    const duplicate = await sync.acceptRubberManagerCommand(owner, branch, target, action).then(() => "accepted", error => String(error.message));
    expect(duplicate).toContain("รอยืนยัน");
    expect(await queue.getPendingEvents(event)).toHaveLength(1);
  });
}

test("fair uploader round reserves a slot for another branch despite a large first-branch backlog", async () => {
  const first = await fixture(), second = await fixture(otherBranch);
  const sync = runner(async () => Response.json({}));
  const backlog = Array.from({ length: 100 }, () => ({ ...first }));
  expect(sync.fairRubberQueueRound([...backlog, second]).slice(0, 2).map(event => event.locationId)).toEqual([branch, otherBranch]);
  expect(sync.fairRubberQueueRound([...backlog, second])).toHaveLength(20);
});

test("a failed PDF handoff cannot replay business or prevent the next ready receipt", async () => {
  const first = await fixture(), second = await fixture(); const bill = rubberBillFromSyncEvent(first, owner)!; bill.netTotal = 100;
  const prints = loadSourceModule<typeof import("../src/lib/rubber-bills/central-print")>("src/lib/rubber-bills/central-print.ts", {}, { navigator: { onLine: true } });
  const calls: string[] = [];
  const stop = prints.registerRubberQueuePrinter(owner, branch, async current => {
    calls.push(current.clientTempId); if (calls.length === 1) throw new Error("PDF cancelled");
  });
  prints.printAcceptedRubberReceipt(owner, branch, bill); prints.printAcceptedRubberReceipt(owner, branch, { ...bill, clientTempId: second.id });
  await expect.poll(() => calls.length).toBe(2);
  expect(calls).toEqual([first.id, second.id]);
  expect(await queue.getPendingEvents(first)).toHaveLength(2); // Printing performs no queue/business mutation.
  stop();
});

test("PDF handoff awaits an asynchronous account check before delivery", async () => {
  let delivered = false;
  const hook = loadSourceModule<typeof import("../src/hooks/useSharePdf")>("src/hooks/useSharePdf.ts", {
    react: { useCallback: (callback: unknown) => callback, useRef: (current: unknown) => ({ current }),
      useEffect: () => {}, useState: (current: unknown) => [current, () => {}] },
    "@/lib/rubber-bills/print-receipt": { shareReceiptPdf: async (_html: string, _filename: string, options: { onBeforeHandoff: () => Promise<void> }) => {
      await options.onBeforeHandoff(); delivered = true; return "downloaded";
    } },
  }, { DOMException, requestAnimationFrame: (callback: () => void) => callback() });
  const result = await hook.useSharePdf().sharePdf(() => ({ html: "receipt", filename: "bill.pdf" }), async () => false);
  expect(result).toBe("cancelled"); expect(delivered).toBe(false);
});

test("manager-approved deletion atomically acknowledges its request command and tombstones the actual bill", async () => {
  const source = await fixture(); await queue.removeSyncEvent(source.queueId!);
  const request = crypto.randomUUID();
  const { queueId: _previousId, ...base } = source;
  const event: queue.SyncEvent = { ...base, id: `request:${request}`, operation: "update", payload: {
    ...source.payload, operation: "update", clientTempId: `request:${request}`, queueAction: "approve", targetRequestId: request } };
  event.queueId = await queue.enqueueSyncEvent(event);
  const bill = rubberBillFromSyncEvent(source, owner)!;
  const snapshot = { billId: server, locationId: branch, serverBillNo: "R", serverReceivedAt: "2026-10-28T00:00:00Z", revisionNo: 1, bill, receipt: {} as never };
  await queue.putRubberBillReceiptSnapshots([snapshot]);
  expect(await completion.acknowledgeRubberCommand(event, { status: "approved", commandId: event.payload.commandId,
    operation: "delete", requestId: request, billId: server })).toBe(true);
  await queue.putRubberBillReceiptSnapshots([snapshot]);
  expect(await queue.getRubberBillReceiptSnapshots(branch)).toHaveLength(0);
  expect(await queue.getPendingEvents(event)).toHaveLength(0);
});
