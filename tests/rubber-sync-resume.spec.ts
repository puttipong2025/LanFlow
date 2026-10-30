import { test, expect } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";
import * as queue from "../src/lib/idb-queue";
import * as idb from "../src/lib/idb-core";
import * as preparation from "../src/lib/rubber-bills/preparation-failure";
import { loadSourceModule } from "./helpers/load-source-module";
import { rubberBillFromSyncEvent } from "../src/lib/rubber-bills/local-feed";
import { getRubberBillSyncActionBlockReason } from "../src/lib/record-action-locks";

const owner = "ad000000-0000-4000-8000-000000000001";
const location = "ad000000-0000-4000-8000-000000000002";
const client = { invalidateQueries: async () => {} } as never;
test.beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
});

async function fixture() {
  const commandId = crypto.randomUUID();
  const event: queue.SyncEvent = { id: crypto.randomUUID(), entity: "rubber_bills", ownerUserId: owner,
    locationId: location, operation: "create", timestamp: Date.now(), status: "pending", serverSubmissionAttempted: false,
    payload: { commandId, idempotencyKey: commandId, centralQueue: true, background: true, contractVersion: 2,
      localContextPending: true, inputMethod: "ocr", operation: "create", actorUserId: owner, locationId: location,
      expectedRevisionNo: 0, items: [], customerName: "Resume", billDate: "2026-10-30", localBillNo: "LOCAL" } };
  event.payload.clientTempId = event.id;
  event.queueId = await queue.enqueueSyncEvent(event);
  return event;
}

test("delete-only exception requires an unsent new local bill; edit and unknown submission stay locked", async () => {
  const event = await fixture();
  const bill = rubberBillFromSyncEvent(event, owner)!;
  expect(getRubberBillSyncActionBlockReason(bill, "delete")).toBeNull();
  expect(getRubberBillSyncActionBlockReason(bill, "edit")).toBeTruthy();
  for (const change of [{ serverSubmissionAttempted: true }, { serverSubmissionAttempted: undefined },
    { serverBillNo: "SERVER" }, { id: "server-id" }, { syncStatus: "pending" as const, serverSubmissionAttempted: true }]) {
    expect(getRubberBillSyncActionBlockReason({ ...bill, ...change }, "delete")).toBeTruthy();
  }
});

test("local feed never turns unknown or centrally accepted creation into a deletable unsent bill", async () => {
  const event = await fixture();
  for (const change of [{ serverSubmissionAttempted: undefined }, { centralAccepted: true }]) {
    const projected = rubberBillFromSyncEvent({ ...event, ...change }, owner)!;
    expect(getRubberBillSyncActionBlockReason(projected, "delete")).toBeTruthy();
    expect(projected.syncErrorMessage).not.toBe("รอส่งจากเครื่อง");
  }
  expect(getRubberBillSyncActionBlockReason(rubberBillFromSyncEvent(event, owner)!, "delete")).toBeNull();
});

for (const scenario of ["offline", "submitted", "accepted", "unknown", "concurrent-submit", "dependent-event"] as const) {
  test(`local delete ${scenario} uses the current complete outbox snapshot and never queues a server delete`, async () => {
    const event = await fixture();
    if (scenario === "submitted") await queue.updateSyncEvent({ ...event, serverSubmissionAttempted: true });
    if (scenario === "accepted") await queue.updateSyncEvent({ ...event, centralAccepted: true } as queue.SyncEvent);
    if (scenario === "unknown") await queue.updateSyncEvent({ ...event, serverSubmissionAttempted: undefined });
    let removed = 0;
    const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
      "@tanstack/react-query": { useQueryClient: () => client,
        useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
      "@/lib/idb-queue": { ...queue, reconcileSyncEventsIfCurrent: async (...args: Parameters<typeof queue.reconcileSyncEventsIfCurrent>) => {
        if (scenario === "concurrent-submit") await queue.updateSyncEvent({ ...event, serverSubmissionAttempted: true });
        if (scenario === "dependent-event") {
          const dependent = { ...event, operation: "update" as const }; delete dependent.queueId;
          await queue.enqueueSyncEvent(dependent);
        }
        return queue.reconcileSyncEventsIfCurrent(...args);
      } },
      "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => { removed++; } },
    }, { navigator: { onLine: false } });
    const bill = rubberBillFromSyncEvent(event, owner)!;
    const result = hook.useRubberBillMutations(location, owner).deleteBill({ bill, deletedByName: "Test", deletedByPhone: "" });
    if (scenario === "offline") await result;
    else expect(await result.then(() => false, () => true)).toBe(true);
    const remaining = await queue.getPendingEvents(event);
    expect(remaining.some(item => item.operation === "delete")).toBe(false);
    expect(remaining.length).toBe(scenario === "offline" ? 0 : scenario === "dependent-event" ? 2 : 1);
    expect(removed).toBe(scenario === "offline" ? 1 : 0);
  });
}

for (const confirmedServerBill of [false, true]) test(`a create absent from the outbox ${confirmedServerBill ? "still permits deletion with a verified Server bill" : "cannot become a Server delete from a stale local dialog"}`, async () => {
  const event = await fixture();
  const localBill = rubberBillFromSyncEvent(event, owner)!;
  const staleBill = confirmedServerBill ? { ...localBill, id: crypto.randomUUID(), serverBillNo: "SERVER", syncStatus: "synced" as const } : localBill;
  // Both outcomes remove the local create. The second outcome also has a Server
  // bill, but this caller still has no verified Server identity/revision.
  await queue.removeSyncEvent(event.queueId!);
  let removed = 0;
  const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useQueryClient: () => client,
      useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
    "@/lib/idb-queue": queue,
    "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => { removed++; } },
  }, { navigator: { onLine: true } });
  const error = await hook.useRubberBillMutations(location, owner)
    .deleteBill({ bill: staleBill, deletedByName: "Test", deletedByPhone: "" }).then(() => null, (cause: Error) => cause.message);
  if (confirmedServerBill) expect(error).toBeNull();
  else expect(error).toBeTruthy();
  const remaining = await queue.getPendingEvents(event);
  expect(remaining).toHaveLength(confirmedServerBill ? 1 : 0);
  if (confirmedServerBill) expect(remaining[0].serverId).toBe(staleBill.id);
  expect(removed).toBe(0);
});

for (const permanent of [false, true]) test(`staged context ${permanent ? "missing OCR stops with a safe local exit" : "network failure remains retryable"}`, async () => {
  const event = await fixture();
  let requests = 0;
  const auth = { canSyncCurrentSession: async () => true, assertApiResponse: async () => {},
    authFetch: async () => { requests++; if (!permanent) throw new TypeError("offline");
      return Response.json({ generation: 0, revisionNo: 0, queueVersion: 0, ocrUploadId: null }); } };
  const commands = loadSourceModule<typeof import("../src/lib/rubber-bills/command")>("src/lib/rubber-bills/command.ts", {
    "@/lib/auth-fetch": auth,
    "@/lib/rubber-bills/preparation-failure": preparation,
  }, { navigator: { onLine: true } });
  const sync = loadSourceModule<typeof import("../src/lib/rubber-bills/central-sync")>("src/lib/rubber-bills/central-sync.ts", {
    "@/lib/idb-core": idb, "@/lib/idb-queue": queue, "@/lib/auth-fetch": auth, "./command": commands,
    "@/lib/rubber-bills/preparation-failure": preparation,
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
  }, { navigator: { onLine: true } });
  await sync.runRubberCentralQueue(client, owner);
  const [retained] = await queue.getPendingEvents(event);
  expect(retained.payload).toEqual(event.payload);
  expect(retained.serverSubmissionAttempted).toBe(false);
  expect(retained.status).toBe(permanent ? "failed" : "pending");
  expect(retained.errorMessage).toBeTruthy();
  if (!permanent) return;
  await queue.updateSyncEvent({ ...retained, nextAttemptAt: 0 } as queue.SyncEvent);
  await sync.runRubberCentralQueue(client, owner);
  expect(requests).toBe(1);
  const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useQueryClient: () => client, useMutation: (options: unknown) => options },
    "@/lib/idb-queue": queue, "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
  });
  await hook.useRubberBillMutations(location, owner).discardSyncProblem(event.id);
  expect(await queue.getPendingEvents(event)).toHaveLength(0);
});

test("accepted work shows the server wait reason on create and update without unlocking it", async () => {
  const event = await fixture();
  const feed = loadSourceModule<typeof import("../src/lib/rubber-bills/local-feed")>("src/lib/rubber-bills/local-feed.ts", {});
  const waiting = { ...event, centralAccepted: true, errorMessage: "รอปลดล็อกตรวจนับเงิน แล้วระบบจะทำต่ออัตโนมัติ" };
  expect(feed.rubberBillFromSyncEvent(waiting, owner)?.syncErrorMessage).toBe(waiting.errorMessage);
  const existing = { ...feed.rubberBillFromSyncEvent(event, owner)!, syncStatus: "synced" as const, revisionNo: 1 };
  const [merged] = feed.mergeRubberBillLocalEvents([existing], [{ ...waiting, operation: "update" }], owner);
  expect(merged.syncErrorMessage).toBe(waiting.errorMessage);
  expect(merged.serverSubmissionAttempted).toBe(true);
});

test("never discard uncertain, accepted, or server-correction work using the local exit", async () => {
  const event = await fixture();
  const failed = { ...event, status: "failed" as const, failureCode: preparation.LOCAL_OCR_SOURCE_MISSING };
  expect(preparation.isUnsubmittedRubberPreparationFailure(failed)).toBe(true);
  for (const changed of [{ serverSubmissionAttempted: true }, { serverSubmissionAttempted: undefined },
    { centralAccepted: true }, { operation: "update" as const }, { payload: { ...failed.payload, localContextPending: false } },
    { failureCode: undefined }]) {
    expect(preparation.isUnsubmittedRubberPreparationFailure({ ...failed, ...changed })).toBe(false);
  }
});

test("a new server pause reason refreshes only local status, unchanged polls refresh nothing", async () => {
  const event = await fixture(); delete event.payload.localContextPending;
  await queue.updateSyncEvent({ ...event, centralAccepted: true, serverSubmissionAttempted: true } as queue.SyncEvent);
  const invalidated: unknown[] = [];
  const sync = loadSourceModule<typeof import("../src/lib/rubber-bills/central-sync")>("src/lib/rubber-bills/central-sync.ts", {
    "@/lib/idb-core": idb, "@/lib/idb-queue": queue,
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => Response.json({
      commandId: event.payload.commandId, actorUserId: owner, locationId: location, clientTempId: event.id,
      action: "create", state: "paused", version: 1, attempts: 1, acceptedAt: "2026-10-30T00:00:00Z",
      nextAttemptAt: new Date(Date.now() + 30_000).toISOString(), errorCode: "CASH_COUNT_PAUSED", result: null,
      completedAt: null, canRetire: false }) },
  }, { navigator: { onLine: true } });
  const cache = { invalidateQueries: async (options: unknown) => { invalidated.push(options); } } as never;
  await sync.runRubberCentralQueue(cache, owner);
  expect(invalidated).toEqual([{ queryKey: ["rubberBillLocalState", owner, location] }]);
  invalidated.length = 0;
  await sync.runRubberCentralQueue(cache, owner, true);
  expect(invalidated).toEqual([]);
});

for (const priorStatus of ["failed", "pending"] as const) test(`central correction ${priorStatus === "failed" ? "unchanged receipts do not reload business queries" : "first transition still refreshes business queries"}`, async () => {
  const event = await fixture(); delete event.payload.localContextPending;
  await queue.updateSyncEvent({ ...event, status: priorStatus, centralAccepted: true, failureHttpStatus: priorStatus === "failed" ? 400 : undefined,
    errorMessage: priorStatus === "failed" ? "กรุณาแก้ไขร่างบิลเดิมแล้วส่งใหม่" : undefined, serverSubmissionAttempted: false } as queue.SyncEvent);
  const invalidated: unknown[] = [];
  const sync = loadSourceModule<typeof import("../src/lib/rubber-bills/central-sync")>("src/lib/rubber-bills/central-sync.ts", {
    "@/lib/idb-core": idb, "@/lib/idb-queue": queue,
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => Response.json({
      commandId: event.payload.commandId, actorUserId: owner, locationId: location, clientTempId: event.id,
      action: "create", state: "correction_required", version: 1, attempts: 1, acceptedAt: "2026-10-30T00:00:00Z",
      nextAttemptAt: new Date().toISOString(), errorCode: "CORRECTION_REQUIRED", result: null,
      completedAt: null, canRetire: false }) },
  }, { navigator: { onLine: true } });
  await sync.runRubberCentralQueue({ invalidateQueries: async (options: unknown) => { invalidated.push(options); } } as never, owner);
  if (priorStatus === "failed") expect(invalidated).toEqual([]);
  else expect(invalidated.length).toBeGreaterThan(0);
  const [remaining] = await queue.getPendingEvents(event);
  expect(remaining.status).toBe("failed");
  expect(remaining.payload).toEqual(event.payload);
  expect(remaining.serverSubmissionAttempted).toBe(false);
});

test("explicit retry can recheck an unsubmitted OCR failure without changing identity", async () => {
  const event = await fixture();
  await queue.updateSyncEvent({ ...event, status: "failed", failureCode: preparation.LOCAL_OCR_SOURCE_MISSING });
  let calls = 0;
  const hook = loadSourceModule<typeof import("../src/hooks/usePerRecordSyncRetry")>("src/hooks/usePerRecordSyncRetry.ts", {
    "@tanstack/react-query": { useQueryClient: () => client, useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
    "@/lib/idb-queue": queue,
    "@/lib/rubber-bills/central-sync": { isCentralRubberEvent: () => true, runRubberCentralQueue: async () => { calls++; } },
  }, { navigator: { onLine: true } });
  await hook.usePerRecordSyncRetry(location, owner).retrySyncEvent({ entity: "rubber_bills", id: event.id });
  const [retried] = await queue.getPendingEvents(event);
  expect(retried.status).toBe("pending"); expect(retried.failureCode).toBeUndefined();
  expect(retried.payload).toEqual(event.payload); expect(calls).toBe(1);
});

test("successful context preparation clears a previous wait reason even when admission response is lost", async () => {
  const event = await fixture();
  event.payload.inputMethod = "manual";
  await queue.updateSyncEvent({ ...event, errorMessage: "รอเตรียมข้อมูลบิล ระบบจะลองใหม่อัตโนมัติ" });
  const auth = { canSyncCurrentSession: async () => true, assertApiResponse: async () => {},
    authFetch: async (url: string) => { if (!url.includes("command-context")) throw new TypeError("admission response lost");
      return Response.json({ generation: 0, revisionNo: 0, queueVersion: 0 }); } };
  const commands = loadSourceModule<typeof import("../src/lib/rubber-bills/command")>("src/lib/rubber-bills/command.ts", {
    "@/lib/auth-fetch": auth,
  }, { navigator: { onLine: true } });
  const sync = loadSourceModule<typeof import("../src/lib/rubber-bills/central-sync")>("src/lib/rubber-bills/central-sync.ts", {
    "@/lib/idb-core": idb, "@/lib/idb-queue": queue, "@/lib/auth-fetch": auth, "./command": commands,
  }, { navigator: { onLine: true } });
  const invalidated: unknown[] = [];
  await sync.runRubberCentralQueue({ invalidateQueries: async (options: unknown) => { invalidated.push(options); } } as never, owner);
  const [remaining] = await queue.getPendingEvents(event);
  expect(remaining.serverSubmissionAttempted).toBe(true);
  expect(remaining.payload.localContextPending).toBeUndefined();
  expect(remaining.payload.commandId).toBe(event.payload.commandId);
  const feed = loadSourceModule<typeof import("../src/lib/rubber-bills/local-feed")>("src/lib/rubber-bills/local-feed.ts", {});
  expect(feed.rubberBillFromSyncEvent(remaining, owner)?.syncErrorMessage).toBe("รอยืนยันการรับงานจากเซิร์ฟเวอร์");
  expect(invalidated).toEqual([{ queryKey: ["rubberBillLocalState", owner, location] }]);
});

for (const rejectResume of [false, true]) test(`resume ${rejectResume ? "contains queue read failures" : "checks receipts once per burst, ignores hidden tabs and cleans up"}`, () => {
  let now = 10_000, hidden = false, calls = 0;
  let cleanup!: () => void;
  const listeners = new Map<string, () => void>();
  let handledFailures = 0;
  const surface = { addEventListener: (key: string, listener: () => void) => listeners.set(key, listener),
    removeEventListener: (key: string) => listeners.delete(key) };
  const hook = loadSourceModule<typeof import("../src/hooks/useLanFlowOfflineSyncCoordinator")>("src/hooks/useLanFlowOfflineSyncCoordinator.ts", {
    react: { useEffect: (effect: () => () => void) => { cleanup = effect(); } }, sonner: { toast: {} },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/connectivity": { isDeviceOnline: () => true, subscribeConnectivity: () => () => {} },
    "@/lib/rubber-bills/background-notifications": { registerRubberBackgroundNotifications: () => () => {} },
    "@/hooks/useIncomeExpense": { syncPendingIncomeExpense: async () => {} },
    "@/hooks/useRubberBills": { syncPendingRubberBills: async () => {} },
    "@/lib/income-expense/background-sync": { runIncomeExpenseBackground: async () => {} },
    "@/lib/rubber-bills/central-sync": { runRubberCentralQueue: (_client: unknown, _owner: string, force: boolean) => {
      if (force) calls++;
      if (!rejectResume || calls <= 1) return Promise.resolve();
      const rejected = Promise.reject(new Error("IndexedDB temporarily unavailable"));
      const catchFailure = rejected.catch.bind(rejected);
      // Observe the rejection without letting the test runner swallow the result
      // we are verifying: the production event handler must attach its own catch.
      void catchFailure(() => {});
      Object.defineProperty(rejected, "catch", { value: (handler: (error: unknown) => void) => { handledFailures++; return catchFailure(handler); } });
      return rejected;
    },
      subscribeRubberQueueActivity: () => () => {} },
  }, { Date: { now: () => now }, window: surface, document: { ...surface, get visibilityState() { return hidden ? "hidden" : "visible"; } },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} });
  hook.useLanFlowOfflineSyncCoordinator({ ownerUserId: owner, locationId: location });
  expect(calls).toBe(1);
  now += 6_000; hidden = true; listeners.get("visibilitychange")!(); expect(calls).toBe(1);
  hidden = false; listeners.get("visibilitychange")!(); listeners.get("focus")!(); expect(calls).toBe(2);
  now += 6_000; listeners.get("focus")!(); expect(calls).toBe(3);
  if (rejectResume) expect(handledFailures).toBe(2);
  cleanup(); expect(listeners.size).toBe(0);
});
