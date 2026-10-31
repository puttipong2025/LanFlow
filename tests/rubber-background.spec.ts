import { expect, test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { getSyncDb, SYNC_QUEUE_STORE } from "../src/lib/idb-core";
import { IDBFactory } from "fake-indexeddb";
import * as queue from "../src/lib/idb-queue";
import { completeRubberCommand } from "../src/lib/rubber-bills/complete-command";
import * as notifications from "../src/lib/rubber-bills/background-notifications";
const { registerRubberBackgroundNotifications, notifyRubberBackgroundFailure } = notifications;
import { loadSourceModule } from "./helpers/load-source-module";
import { rubberBillFromSyncEvent, mergeRubberBillLocalEvents } from "../src/lib/rubber-bills/local-feed";

const serverId = "71000000-0000-4000-8000-000000000021";

test("manager outcome feedback is scoped to the active owner and branch and distinguishes success from retirement", async () => {
  const event = await fixture(); event.payload.queueAction = "approve";
  const notices: Array<[string, string | undefined]> = [];
  const stop = registerRubberBackgroundNotifications("owner", "location", (message, kind) => notices.push([message, kind]));
  notifications.notifyRubberManagerOutcome({ ...event, ownerUserId: "other" }, "wrong owner", true);
  notifications.notifyRubberManagerOutcome({ ...event, locationId: "other" }, "wrong branch", true);
  notifications.notifyRubberManagerOutcome(event, "confirmed", true);
  notifications.notifyRubberManagerOutcome(event, "request changed", false);
  stop(); notifications.notifyRubberManagerOutcome(event, "unmounted", true);
  expect(notices).toEqual([["confirmed", "success"], ["request changed", "error"]]);
});
test("delete confirmation blocks same-render reentry and unlocks after rejection", async () => {
  let calls = 0;
  let reject!: (cause: Error) => void;
  const { RubberBillDeleteDialog } = loadSourceModule<typeof import("../src/components/rubber-bills/RubberBillDeleteDialog")>("src/components/rubber-bills/RubberBillDeleteDialog.tsx", {
    react: { useState: (value: unknown) => [value, () => {}], useRef: (value: unknown) => ({ current: value }) },
    "@/components/shared/AlertDialog": { AlertDialog: () => null },
  });
  const dialog = RubberBillDeleteDialog({ bill: { syncStatus: "synced" } as never, onClose: () => {}, onConfirm: () => {
    calls++; return new Promise((_, fail) => { reject = fail; });
  } });
  dialog.props.onConfirm(); dialog.props.onConfirm();
  expect(calls).toBe(1);
  reject(new Error("storage unavailable"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  dialog.props.onConfirm();
  expect(calls).toBe(2);
  reject(new Error("storage unavailable"));
});
async function fixture(operation: "update" | "delete" = "delete") {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  const event: queue.SyncEvent = { id: "local", entity: "rubber_bills", ownerUserId: "owner", locationId: "location", operation,
    serverId, timestamp: 1, status: "pending", payload: { contractVersion: 2, commandId: "a", idempotencyKey: "a", background: true,
      expectedCommandGeneration: 0, expectedRevisionNo: 1, operation, clientTempId: "local", locationId: "location",
      clientRecordedAt: "2026-10-28T01:00:00Z", billDate: "2026-10-28", items: [] } };
  event.queueId = await queue.enqueueSyncEvent(event);
  return event;
}

for (const operation of ["update", "delete"] as const) {
  test(`${operation} returns after durable acceptance without waiting for a POST`, async () => {
    const event = await fixture(operation);
    await queue.removeSyncEvent(event.queueId!);
    const bill = { ...rubberBillFromSyncEvent(event, "owner")!, revisionNo: 1 };
    let posts = 0;
    const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>(process.env.RUBBER_ACCEPTANCE_SOURCE || "src/hooks/useRubberBills.ts", {
      "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (o: { mutationFn: (v: unknown) => Promise<unknown> }) => ({ mutateAsync: o.mutationFn }) },
      "@/lib/idb-queue": queue,
      "@/lib/auth-fetch": { authFetch: async (url: string) => {
        if (url.includes("command-context")) return Response.json({ generation: 0, revisionNo: 1, recordStatus: "active" });
        posts++; return new Promise(() => {});
      }, assertApiResponse: async () => {} },
      "sonner": { toast: {} },
      "@/lib/money-flow/invalidation": {}, "@/lib/rubber-bills/feed-cache": {},
    }, { navigator: { onLine: true } });
    const mutations = hook.useRubberBillMutations("location", "owner");
    const saving = operation === "update" ? mutations.updateBill(bill) : mutations.deleteBill({ bill, deletedByName: "Operator", deletedByPhone: "0000000000" });
    const accepted = await Promise.race([saving.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 300))]);
    expect(accepted).toBe(true);
    expect(posts).toBe(0);
    const persisted = await queue.getPendingEvents(event);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].payload.background).toBe(true);
    expect(persisted[0].payload.contractVersion).toBe(2);
  });
}

test("deleted proof needs the exact Server bill and an authorized successful response", async () => {
  const event = await fixture();
  for (const [status, identity, expected] of [[200, serverId, true], [200, "other", false], [403, serverId, false], [503, serverId, false]] as const) {
    const sender = loadSourceModule<typeof import("../src/lib/rubber-bills/sync-request")>("src/lib/rubber-bills/sync-request.ts", {
      "@/lib/auth-fetch": { authFetch: async () => Response.json({ recordStatus: "deleted", serverId: identity }, { status }) },
    });
    expect(Boolean(await sender.probeDeletedRubberCommand(event))).toBe(expected);
  }
  const mismatch = { ...event, payload: { ...event.payload, clientTempId: "another-bill" } };
  const sender = loadSourceModule<typeof import("../src/lib/rubber-bills/sync-request")>("src/lib/rubber-bills/sync-request.ts", {
    "@/lib/auth-fetch": { authFetch: async () => Response.json({ recordStatus: "deleted", serverId }) },
  });
  expect(await sender.probeDeletedRubberCommand(mismatch)).toBeNull();
});

for (const fault of ["context", "storage"] as const) {
  test(`a ${fault} failure cannot acknowledge background acceptance`, async () => {
    const event = await fixture("update"); await queue.removeSyncEvent(event.queueId!);
    const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
      "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (o: { mutationFn: (v: unknown) => Promise<unknown> }) => ({ mutateAsync: o.mutationFn }) },
      "@/lib/idb-queue": { ...queue, enqueueSyncEvent: async () => { throw new Error("storage unavailable"); } },
      "@/lib/auth-fetch": { authFetch: async () => Response.json({ generation: 0, revisionNo: fault === "context" ? 9 : 1 }), assertApiResponse: async () => {} },
      "sonner": { toast: {} }, "@/lib/money-flow/invalidation": {}, "@/lib/rubber-bills/feed-cache": {},
    }, { navigator: { onLine: true } });
    let rejected = false;
    await hook.useRubberBillMutations("location", "owner").updateBill({ ...rubberBillFromSyncEvent(event, "owner")!, revisionNo: 1 }).catch(() => { rejected = true; });
    expect(rejected).toBe(true);
    expect(await queue.getPendingEvents(event)).toHaveLength(0);
  });
}

test("correcting a rejected v2 draft uses its original server revision and a new command", async () => {
  const event = await fixture("update"); event.status = "failed"; event.failureHttpStatus = 400;
  await queue.updateSyncEvent(event);
  const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>(process.env.RUBBER_CORRECTION_SOURCE || "src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (o: { mutationFn: (v: unknown) => Promise<unknown> }) => ({ mutateAsync: o.mutationFn }) },
    "@/lib/idb-queue": queue,
    "@/lib/auth-fetch": { authFetch: async () => Response.json({ generation: 0, revisionNo: 1 }), assertApiResponse: async () => {} },
    "sonner": { toast: {} }, "@/lib/money-flow/invalidation": {}, "@/lib/rubber-bills/feed-cache": {},
  }, { navigator: { onLine: true } });
  await hook.useRubberBillMutations("location", "owner").updateBill({ ...rubberBillFromSyncEvent(event, "owner")!, customerName: "Corrected" });
  const current = (await queue.getPendingEvents(event))[0];
  expect(current.payload.expectedRevisionNo).toBe(1);
  expect(current.payload.commandId).not.toBe(event.payload.commandId);
  expect(current.payload.background).toBe(true);
});

test("atomic terminal cleanup preserves dependent work and permanently tombstones a deleted receipt", async () => {
  const event = await fixture();
  const bill = rubberBillFromSyncEvent(event, "owner")!;
  const snapshot = { billId: serverId, locationId: "location", serverBillNo: "RB", serverReceivedAt: "2026-10-28T00:00:00Z", revisionNo: 1, bill, receipt: {} as never };
  await queue.putRubberBillReceiptSnapshots([snapshot]);
  const { queueId: _queueId, ...dependent } = event;
  await queue.enqueueSyncEvent({ ...dependent, payload: { ...dependent.payload, commandId: "dependent" } });
  expect(await completeRubberCommand(event, true)).toBe(true);
  expect((await queue.getPendingEvents(event)).map((e) => e.payload.commandId)).toEqual(["dependent"]);
  await queue.putRubberBillReceiptSnapshots([snapshot]);
  expect(await queue.getRubberBillReceiptSnapshots("location")).toHaveLength(0);
});

for (const outcome of ["replay", "new-command", "pending-approval"] as const) test(`restarting a legacy delete reconciles its receipt for ${outcome}`, async () => {
  const event = await fixture();
  delete event.payload.contractVersion;
  delete event.payload.background;
  event.status = "failed";
  await queue.updateSyncEvent(event);
  const bill = { ...rubberBillFromSyncEvent(event, "owner")!, revisionNo: 1 };
  expect(bill.canRestartDelete).toBe(true);
  const snapshot = { billId: serverId, locationId: "location", serverBillNo: "RB", serverReceivedAt: "2026-10-28T00:00:00Z", revisionNo: 1, bill, receipt: {} as never };
  await queue.putRubberBillReceiptSnapshots([snapshot]);
  let sends = 0;
  const restart = loadSourceModule<typeof import("../src/lib/rubber-bills/restart-delete")>("src/lib/rubber-bills/restart-delete.ts", {
    "@/lib/idb-queue": queue,
    "@/lib/idb-core": { getSyncDb, SYNC_QUEUE_STORE, RUBBER_BILL_RECEIPT_STORE: "rubber_bill_receipts", RUBBER_BILL_RECEIPT_TOMBSTONE_STORE: "rubber_bill_receipt_tombstones" },
    "./command": { prepareRubberBillCommand: async (payload: Record<string, unknown>) => ({ ...payload, contractVersion: 2, commandId: "fresh", idempotencyKey: "fresh" }) },
    "./sync-request": { probeDeletedRubberCommand: async () => null, sendRubberBillCommand: async (current: queue.SyncEvent) => {
      sends++;
      return Response.json(outcome === "pending-approval"
        ? { status: "pending_approval", operation: "delete", clientTempId: event.id, requestId: serverId }
        : outcome === "new-command" && sends === 1
          ? { status: "discarded", operation: "delete", clientTempId: event.id }
          : { status: "synced", commandId: current.payload.commandId, id: serverId, revisionNo: 2, serverBillNo: "RB", serverReceivedAt: "2026-10-31T00:00:00Z" });
    } },
  }, { navigator: { onLine: true } });
  expect(await restart.restartRubberDelete("owner", "location", event.id)).toBe(outcome === "pending-approval" ? "pending_approval" : "synced");
  expect(sends).toBe(outcome === "new-command" ? 2 : 1);
  expect(await queue.getPendingEvents(event)).toHaveLength(0);
  expect(await queue.getRubberBillReceiptSnapshots("location")).toHaveLength(outcome === "pending-approval" ? 1 : 0);
  await queue.putRubberBillReceiptSnapshots([snapshot]);
  expect(await queue.getRubberBillReceiptSnapshots("location")).toHaveLength(outcome === "pending-approval" ? 1 : 0);
});

test("an old acknowledgement cannot remove a changed event", async () => {
  const event = await fixture();
  await queue.updateSyncEvent({ ...event, payload: { ...event.payload, commandId: "new" } });
  expect(await completeRubberCommand(event, true)).toBe(false);
  expect(await queue.getPendingEvents(event)).toHaveLength(1);
});

test("a crash before terminal transaction commit leaves the queue and receipt intact", async () => {
  const event = await fixture();
  const bill = rubberBillFromSyncEvent(event, "owner")!;
  await queue.putRubberBillReceiptSnapshots([{ billId: serverId, locationId: "location", serverBillNo: "RB", serverReceivedAt: "2026-10-28T00:00:00Z", revisionNo: 1, bill, receipt: {} as never }]);
  const db = await getSyncDb();
  const transaction = db.transaction.bind(db);
  db.transaction = ((...args: Parameters<typeof db.transaction>) => {
    const tx = transaction(...args);
    const store = tx.objectStore(SYNC_QUEUE_STORE);
    const remove = store.delete.bind(store);
    store.delete = (key) => { const request = remove(key); tx.abort(); return request; };
    return tx;
  }) as typeof db.transaction;
  const module = loadSourceModule<typeof import("../src/lib/rubber-bills/complete-command")>("src/lib/rubber-bills/complete-command.ts", {
    "@/lib/idb-core": { getSyncDb: async () => db, SYNC_QUEUE_STORE, RUBBER_BILL_RECEIPT_STORE: "rubber_bill_receipts", RUBBER_BILL_RECEIPT_TOMBSTONE_STORE: "rubber_bill_receipt_tombstones" },
  });
  let failed = false;
  await module.completeRubberCommand(event, true).catch(() => { failed = true; });
  expect(failed).toBe(true);
  expect(await queue.getPendingEvents(event)).toHaveLength(1);
  expect(await queue.getRubberBillReceiptSnapshots("location")).toHaveLength(1);
  expect(await completeRubberCommand(event, true)).toBe(true);
});

test("failure notices are durable, scope-bound and once per new reason", async () => {
  const event = await fixture();
  event.status = "failed"; event.errorMessage = "Locked";
  await queue.updateSyncEvent(event);
  const notices: string[] = [];
  const stop = registerRubberBackgroundNotifications("owner", "location", (m) => notices.push(m));
  await Promise.all([notifyRubberBackgroundFailure(event), notifyRubberBackgroundFailure(event)]);
  stop();
  const stopAgain = registerRubberBackgroundNotifications("owner", "location", (m) => notices.push(m));
  await notifyRubberBackgroundFailure(event);
  event.errorMessage = "New reason"; await queue.updateSyncEvent(event);
  await notifyRubberBackgroundFailure(event);
  const previous = (await queue.getPendingEvents(event))[0];
  event.payload = { ...event.payload, commandId: "corrected" };
  await queue.updateSyncEvent({ ...previous, ...event });
  await notifyRubberBackgroundFailure(event);
  stopAgain();
  const stopOther = registerRubberBackgroundNotifications("other", "location", (m) => notices.push(m));
  await notifyRubberBackgroundFailure(event); stopOther();
  expect(notices).toEqual(["Locked", "New reason", "New reason"]);
});

test("a request already started in another branch finishes without starting its unsent successor", async () => {
  const event = await fixture();
  const { queueId: _queueId, ...next } = event;
  await queue.enqueueSyncEvent({ ...next, id: "next", payload: { ...next.payload, clientTempId: "next", commandId: "next" } });
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => { started = r; });
  const gate = new Promise<void>((r) => { release = r; });
  let sent = 0;
  const stop = registerRubberBackgroundNotifications("owner", "location", () => {});
  const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": {}, "@/lib/idb-queue": queue,
    "@/lib/rubber-bills/background-notifications": notifications,
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true },
    "@/lib/rubber-bills/normalize-sync-queue": { normalizeRubberBillQueueBeforeSync: async () => true },
    "@/lib/rubber-bills/command": {
      sendRubberBillCommand: async () => { sent++; started(); await gate; return Response.json({ status: "pending_approval", silent: true }); },
      isConfirmedRubberSyncResult: () => true,
      acknowledgeRubberCommand: async (current: queue.SyncEvent) => completeRubberCommand(current, false),
    },
    "sonner": { toast: {} }, "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
  }, { navigator: { onLine: true } });
  const syncing = hook.syncPendingRubberBills({} as never, "owner", "location");
  await waiting;
  const stopNew = registerRubberBackgroundNotifications("owner", "new-branch", () => {});
  release(); await syncing;
  expect(sent).toBe(1);
  expect((await queue.getPendingEvents(event)).map((e) => e.id)).toEqual(["next"]);
  stopNew(); stop();
});

test("reopening after a lost response replays the same persisted command", async () => {
  const event = await fixture();
  const keys: string[] = [];
  const dependencies = { "@/lib/auth-fetch": { authFetch: async (url: string, init: RequestInit) => {
    if (url.includes("command-context")) return Response.json({ recordStatus: "active", serverId });
    const payload = JSON.parse(String(init.body)); keys.push(payload.commandId);
    return Response.json({ status: "synced", commandId: payload.commandId, id: serverId, serverBillNo: "RB", revisionNo: 2, serverReceivedAt: "2026-10-28T00:00:00Z" });
  } } };
  const first = loadSourceModule<typeof import("../src/lib/rubber-bills/sync-request")>("src/lib/rubber-bills/sync-request.ts", dependencies);
  await first.sendRubberBillCommand(event, event.payload); // response lost before local acknowledgement
  const restored = (await queue.getPendingEvents(event))[0];
  const reopened = loadSourceModule<typeof import("../src/lib/rubber-bills/sync-request")>("src/lib/rubber-bills/sync-request.ts", dependencies);
  const response = await reopened.sendRubberBillCommand(restored, restored.payload);
  expect((await response.json()).status).toBe("synced");
  expect(keys).toEqual([event.payload.commandId, event.payload.commandId]);
  expect(await completeRubberCommand(restored, true)).toBe(true);
});


test("controlled latency samples distinguish queue acceptance from delayed submission", async () => {
  const samples: Record<string, number[]> = { update: [], delete: [] };
  for (const operation of ["update", "delete"] as const) {
    for (let i = 0; i < 7; i++) {
      const event = await fixture(operation);
      await queue.removeSyncEvent(event.queueId!);
      const bill = { ...rubberBillFromSyncEvent(event, "owner")!, revisionNo: 1 };
      const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>(process.env.RUBBER_BENCHMARK_SOURCE || "src/hooks/useRubberBills.ts", {
        "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (o: { mutationFn: (v: unknown) => Promise<unknown> }) => ({ mutateAsync: o.mutationFn }) },
        "@/lib/idb-queue": queue,
        "@/lib/auth-fetch": { authFetch: async (url: string, init: RequestInit) => {
          if (url.includes("command-context")) { await new Promise((r) => setTimeout(r, 10)); return Response.json({ generation: 0, revisionNo: 1, recordStatus: "active" }); }
          await new Promise((r) => setTimeout(r, 150));
          const payload = JSON.parse(String(init.body));
          return Response.json({ status: "synced", commandId: payload.commandId, id: serverId, serverBillNo: "RB", revisionNo: 2, serverReceivedAt: "2026-10-28T00:00:00Z" });
        }, assertApiResponse: async () => {} },
        "sonner": { toast: {} }, "@/lib/money-flow/invalidation": {},
        "@/lib/rubber-bills/feed-cache": { removeConfirmedRubberBillLocally: async () => {} },
      }, { navigator: { onLine: true } });
      const mutations = hook.useRubberBillMutations("location", "owner");
      const start = performance.now();
      if (operation === "update") await mutations.updateBill(bill);
      else await mutations.deleteBill({ bill, deletedByName: "Operator", deletedByPhone: "0000000000" });
      samples[operation].push(performance.now() - start);
    }
  }
  const summary = Object.fromEntries(Object.entries(samples).map(([op, values]) => {
    const sorted = [...values].sort((a,b) => a-b);
    return [op, { n: sorted.length, p50: sorted[3], p95: sorted[6] }];
  }));
  mkdirSync("output", { recursive: true });
  writeFileSync(process.env.RUBBER_BENCHMARK_SOURCE ? "output/background-latency-before.json" : "output/background-latency-after.json", JSON.stringify(summary, null, 2));
  expect(samples.update).toHaveLength(7);
  expect(samples.delete).toHaveLength(7);
});


test("background overlays do not invent duplicate rows outside the loaded authoritative page", async () => {
  const event = await fixture("update"); event.payload.customerName = "Unconfirmed";
  const server = { ...rubberBillFromSyncEvent(event, "owner")!, customerName: "Server value", syncStatus: "synced" as const };
  expect(mergeRubberBillLocalEvents([], [event], "owner")).toHaveLength(0);
  const page = mergeRubberBillLocalEvents([server], [event], "owner", "suppress");
  expect(page).toHaveLength(1);
  expect(page[0].customerName).toBe("Server value");
  expect(page[0].syncStatus).toBe("pending");
  expect(page[0].serverSubmissionAttempted).toBe(true);
});
