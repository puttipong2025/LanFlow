import { expect, test } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";
import { IDBFactory } from "fake-indexeddb";
import * as queue from "../src/lib/idb-queue";
import { immediateRubberReceipt, rubberReceiptEligibility } from "../src/lib/rubber-bills/immediate-receipt";
import { loadCashLockSnapshot, saveCashLockSnapshot } from "../src/lib/cash-counts/lock-cache";
import type { EffectiveRubberApprovalSettings, RubberBill } from "../src/types";
import { bangkokDateString } from "../src/lib/bangkok-date";
import { resolveRubberBillReceiptForPrint } from "../src/components/rubber-bills/bill-display";

const owner = "ad000000-0000-4000-8000-000000000001", branch = "ad000000-0000-4000-8000-000000000002";

test("deferred deletion preserves the revision confirmed by the user", async () => {
  const command = loadSourceModule<typeof import("../src/lib/rubber-bills/command")>("src/lib/rubber-bills/command.ts", {
    "@/lib/auth-fetch": { authFetch: async () => Response.json({ generation: 1, queueVersion: 1, revisionNo: 99 }), assertApiResponse: async () => {} },
  }, { navigator: { onLine: true } });
  const prepared = await command.prepareRubberBillCommand({ operation: "delete", locationId: branch, clientTempId: "local", expectedRevisionNo: 1 }, owner, { completingLocal: true });
  expect(prepared).toMatchObject({ expectedRevisionNo: 1 });
});
const settings: EffectiveRubberApprovalSettings = { locationId: branch, centralPrice: 40, priceAllowance: 0,
  effectivePriceCap: 40, editWindowMinutes: 60, priceRuleRevision: 1, nonCurrentDateRequiresApproval: true, groupId: null, ruleSource: "ungrouped" };
function bill(update = false): RubberBill {
  return { id: update ? "ad000000-0000-4000-8000-000000000003" : "local", clientTempId: "local", localBillNo: "LOCAL-PDF",
    serverBillNo: update ? "SERVER-OLD" : undefined, serverCreatedAt: new Date().toISOString(), revisionNo: update ? 1 : 0,
    billDate: bangkokDateString(), locationId: branch, customerName: "New customer", billType: "บิลเครื่องชั่งเล็ก",
    syncStatus: update ? "synced" : "pending", recordStatus: "active", approvalState: "approved", approvalRevisionNo: 1,
    approvalApprovedByName: "Old approver", configuredPriceSnapshot: 40, weighItems: [{ id: "w", label: "1", inWeight: 10, outWeight: 0, netWeight: 10, price: 30 }],
    acidItems: [], debtItems: [], weight: 10, netWeight: 10, deductWeight: 0, rubberValue: 300, price: 30,
    weighValueTotal: 300, netTotal: 300, payableBeforeRounding: 300, deductionTotal: 0, acidPackCount: 0,
    createdByUserId: owner, createdByName: "Operator", createdByPhone: "000", clientCreatedAt: new Date().toISOString(),
    clientRecordedAt: new Date().toISOString(), idempotencyKey: "local", billNo: "LOCAL-PDF" };
}

test("local receipt eligibility rejects approval and unknown policy for both create and update", () => {
  for (const update of [false, true]) {
    const source = bill(update);
    expect(rubberReceiptEligibility(source, settings)).toBe("allowed");
    expect(rubberReceiptEligibility(source, null)).toBe("unknown");
    expect(rubberReceiptEligibility(source, { ...settings, locationId: "other" })).toBe("unknown");
    expect(rubberReceiptEligibility({ ...source, approvalPending: true }, settings)).toBe("approval_required");
    expect(rubberReceiptEligibility({ ...source, billDate: "2000-01-01" }, settings)).toBe("approval_required");
    expect(rubberReceiptEligibility({ ...source, weighItems: [{ ...source.weighItems![0], price: 41 }] }, settings)).toBe("approval_required");
  }
  expect(rubberReceiptEligibility({ ...bill(true), serverCreatedAt: undefined }, settings)).toBe("unknown");
  expect(rubberReceiptEligibility({ ...bill(true), serverCreatedAt: "2000-01-01" }, settings)).toBe("approval_required");
});

test("the edited receipt is immutable, uses local reference and cannot reuse an approved Server snapshot", () => {
  const source = bill(true), snapshot = immediateRubberReceipt(source, settings)!;
  source.customerName = "Later Server response"; source.weighItems![0].price = 99;
  const receipt = resolveRubberBillReceiptForPrint(snapshot, { revisionNo: 1, receipt: { customerName: "Old Server" } as never }, false);
  expect(receipt.customerName).toBe("New customer"); expect(receipt.referenceNo).toBe("LOCAL-PDF");
  expect(receipt.approvalLabel).not.toContain("Old approver"); expect(receipt.weighItems[0].price).toBe(30);
});

for (const scenario of ["create", "update", "approval_update", "delete"] as const) test(`${scenario} accepts locally before any context GET or POST`, async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  let requests = 0;
  const hook = loadSourceModule<typeof import("../src/hooks/useRubberBills")>("src/hooks/useRubberBills.ts", {
    "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (o: { mutationFn: unknown }) => ({ mutateAsync: o.mutationFn }) },
    "@/lib/idb-queue": queue,
    "@/lib/auth-fetch": { authFetch: async () => { requests++; return new Promise(() => {}); }, assertApiResponse: async () => {} },
  }, { navigator: { onLine: true } });
  const mutations = hook.useRubberBillMutations(branch, owner, scenario === "approval_update" ? { ...settings, effectivePriceCap: 1 } : settings);
  if (scenario === "delete") await mutations.deleteBill({ bill: bill(true), deletedByName: "Operator", deletedByPhone: "000" });
  else {
    const saved = await (scenario !== "create" ? mutations.updateBill(bill(true)) : mutations.addBill(bill()));
    if (scenario === "approval_update") expect(saved.immediatePdfBill).toBeNull();
    else expect(saved.immediatePdfBill?.localBillNo).toBe("LOCAL-PDF");
  }
  expect(requests).toBe(0);
  const [event] = await queue.getPendingEvents({ entity: "rubber_bills", ownerUserId: owner, locationId: branch });
  expect(event.payload.localContextPending).toBe(true); expect(event.serverSubmissionAttempted).toBe(false);
});

test("known locks persist per account and branch without cache expiry unlocking them", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) } });
  const scope = JSON.stringify([owner, "admin", [branch, "other"], false, branch]);
  const state = { locationId: branch, locationName: "Branch", groupId: "group", enabled: true, locked: true,
    dueDate: "2026-10-20", lockAt: "2026-10-21T00:00:00Z", unlockedUntil: null, unlockedAt: null,
    unlockedByName: null, canUnlock: false, contacts: [] };
  saveCashLockSnapshot({ scope, states: [state], offset: 0 });
  expect(loadCashLockSnapshot(scope)?.states[0].locked).toBe(true);
  expect(loadCashLockSnapshot(JSON.stringify([owner, "admin", [branch, "other"], false, "other"]))?.states[0].locationId).toBe(branch);
  expect(loadCashLockSnapshot(JSON.stringify(["new-owner", "admin", [branch, "other"], false, branch]))).toBeNull();
  const hook = loadSourceModule<typeof import("../src/hooks/useCashCountLocks")>("src/hooks/useCashCountLocks.ts", {
    react: { useState: (v: unknown) => [v, () => {}], useRef: (v: unknown) => ({ current: v }), useEffect: () => {}, useCallback: (f: unknown) => f },
  }, { localStorage: globalThis.localStorage });
  expect(hook.useCashCountLocks(true, scope, false, branch, true).blocked).toBe(true);
  expect(hook.useCashCountLocks(true, scope, false, "other", true).blocked).toBe(false);
  expect(loadCashLockSnapshot(JSON.stringify([owner, "staff", ["other"], false, "other"]))?.states).toEqual([]);
  saveCashLockSnapshot({ scope, states: [{ ...state, locked: false, unlockedUntil: "2026-10-21T01:00:00Z" }], offset: 0 });
  expect(hook.useCashCountLocks(true, scope, false, branch, true).blocked).toBe(true);
  values.set(`lanflow:cash-lock:v1:${owner}`, "broken json");
  expect(loadCashLockSnapshot(scope)).toBeNull();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => { throw new Error("storage unavailable"); }, setItem: () => { throw new Error("storage unavailable"); },
  } });
  expect(loadCashLockSnapshot(scope)).toBeNull();
  expect(() => saveCashLockSnapshot({ scope, states: [state], offset: 0 })).not.toThrow();
});

test("local acceptance can defer command context without starting a network request", async () => {
  let requests = 0;
  const command = loadSourceModule<typeof import("../src/lib/rubber-bills/command")>("src/lib/rubber-bills/command.ts", {
    "@/lib/auth-fetch": { authFetch: async () => { requests++; return new Promise(() => {}); } },
  }, { navigator: { onLine: true } });
  const pending = command.prepareRubberBillCommand({ operation: "create", clientTempId: "local", locationId: "branch", expectedRevisionNo: 0 }, "owner", { deferContext: true });
  const accepted = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), 100))]);
  expect(accepted).not.toBeNull(); expect(requests).toBe(0);
});

test("unknown cash lock offline permits only the explicitly enabled rubber workspace", () => {
  const hook = loadSourceModule<typeof import("../src/hooks/useCashCountLocks")>("src/hooks/useCashCountLocks.ts", {
    react: { useState: (value: unknown) => [value, () => {}], useRef: (value: unknown) => ({ current: value }), useEffect: () => {}, useCallback: (fn: unknown) => fn },
  });
  expect(hook.useCashCountLocks(true, '["owner","admin",["branch"],false,"branch"]', false, "branch", true).blocked).toBe(false);
  expect(hook.useCashCountLocks(true, '["owner","admin",["branch"],false,"branch"]', false, "branch").blocked).toBe(true);
});

test("deferred context is finalized durably once before POST; replay keeps UUID and original revision", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  let contexts = 0;
  const posted: unknown[] = [];
  const auth = { canSyncCurrentSession: async () => true, assertApiResponse: async () => {}, authFetch: async (url: string, init?: RequestInit) => {
      if (url.includes("command-context")) { contexts++; return Response.json({ generation: 7, queueVersion: 9, revisionNo: 99, recordStatus: "active" }); }
      posted.push(JSON.parse(String(init?.body))); return Response.json({}, { status: 503 });
    } };
  const commands = loadSourceModule<typeof import("../src/lib/rubber-bills/command")>("src/lib/rubber-bills/command.ts", {
    "@/lib/auth-fetch": auth,
  }, { navigator: { onLine: true } });
  const module = loadSourceModule<typeof import("../src/lib/rubber-bills/central-sync")>("src/lib/rubber-bills/central-sync.ts", {
    "@/lib/idb-queue": queue, "@/lib/auth-fetch": auth, "./command": commands,
  }, { navigator: { onLine: true }, window: globalThis, indexedDB });
  const commandId = crypto.randomUUID();
  await queue.enqueueSyncEvent({ id: "local", entity: "rubber_bills", ownerUserId: owner, locationId: branch, operation: "update",
    timestamp: 1, status: "pending", serverSubmissionAttempted: false, payload: { localContextPending: true, centralQueue: true,
      contractVersion: 2, background: true, actorUserId: owner, commandId, idempotencyKey: commandId, expectedRevisionNo: 1,
      clientTempId: "local", locationId: branch, operation: "update", expectedCommandGeneration: 0, expectedQueueVersion: 0 } });
  const client = { invalidateQueries: async () => {} } as never;
  await module.runRubberCentralQueue(client, owner);
  const [prepared] = await queue.getPendingEvents({ entity: "rubber_bills", ownerUserId: owner, locationId: branch });
  expect(prepared.payload.localContextPending).toBeUndefined();
  expect(prepared.payload.commandId).toBe(commandId); expect(prepared.payload.expectedRevisionNo).toBe(1);
  expect(prepared.payload.expectedCommandGeneration).toBe(7); expect(prepared.payload.expectedQueueVersion).toBe(9);
  await queue.updateSyncEvent({ ...prepared, nextAttemptAt: 0 } as typeof prepared);
  await module.runRubberCentralQueue(client, owner);
  expect(contexts).toBe(1); expect(posted).toHaveLength(2); expect(posted[0]).toEqual(posted[1]);
});

test("losing connectivity during session validation retains staged creates until context can be read", async () => {
  for (const disconnect of [false, true]) {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
    Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
    const network = { onLine: true };
    let loseConnection = disconnect;
    let contexts = 0, posts = 0;
    const auth = { canSyncCurrentSession: async () => { if (loseConnection) network.onLine = false; return true; },
      assertApiResponse: async () => {}, authFetch: async (url: string) => {
        if (url.includes("command-context")) { contexts++; return Response.json({ generation: 7, queueVersion: 9, revisionNo: 0 }); }
        posts++; return Response.json({}, { status: 503 });
      } };
    const commands = loadSourceModule<typeof import("../src/lib/rubber-bills/command")>("src/lib/rubber-bills/command.ts", {
      "@/lib/auth-fetch": auth,
    }, { navigator: network });
    const sync = loadSourceModule<typeof import("../src/lib/rubber-bills/central-sync")>("src/lib/rubber-bills/central-sync.ts", {
      "@/lib/idb-queue": queue, "@/lib/auth-fetch": auth, "./command": commands,
    }, { navigator: network, window: globalThis, indexedDB });
    const commandId = crypto.randomUUID();
    await queue.enqueueSyncEvent({ id: "local-race", entity: "rubber_bills", ownerUserId: owner, locationId: branch,
      operation: "create", timestamp: 1, status: "pending", serverSubmissionAttempted: false,
      payload: { localContextPending: true, centralQueue: true, contractVersion: 2, actorUserId: owner, commandId,
        idempotencyKey: commandId, clientTempId: "local-race", locationId: branch, operation: "create",
        expectedRevisionNo: 0, expectedCommandGeneration: 0, expectedQueueVersion: 0 } });
    await sync.runRubberCentralQueue({ invalidateQueries: async () => {} } as never, owner);
    const [remaining] = await queue.getPendingEvents({ entity: "rubber_bills", ownerUserId: owner, locationId: branch });
    expect(remaining.payload.commandId).toBe(commandId);
    expect(contexts).toBe(disconnect ? 0 : 1);
    expect(posts).toBe(disconnect ? 0 : 1);
    expect(remaining.payload.localContextPending).toBe(disconnect ? true : undefined);
    expect(remaining.serverSubmissionAttempted).toBe(!disconnect);
    if (disconnect) {
      loseConnection = false; network.onLine = true;
      await queue.updateSyncEvent({ ...remaining, nextAttemptAt: 0 } as typeof remaining);
      await sync.runRubberCentralQueue({ invalidateQueries: async () => {} } as never, owner);
      const [resumed] = await queue.getPendingEvents({ entity: "rubber_bills", ownerUserId: owner, locationId: branch });
      expect(contexts).toBe(1); expect(posts).toBe(1);
      expect(resumed.payload.commandId).toBe(commandId);
      expect(resumed.payload.localContextPending).toBeUndefined();
      expect(resumed.payload.expectedCommandGeneration).toBe(7);
      expect(resumed.payload.expectedQueueVersion).toBe(9);
    }
  }
});

test("a failed context read defers its branch while another branch can still upload", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  const other = "ad000000-0000-4000-8000-000000000099";
  const reads: string[] = [], posts: string[] = [];
  const auth = { canSyncCurrentSession: async () => true, assertApiResponse: async () => {},
    authFetch: async (url: string, init?: RequestInit) => {
      if (url.includes("command-context")) {
        const location = new URL(url, "https://test.local").searchParams.get("locationId")!;
        reads.push(location);
        if (location === branch) throw new Error("context timed out");
        return Response.json({ generation: 0, queueVersion: 0, revisionNo: 0 });
      }
      posts.push(JSON.parse(String(init?.body)).locationId); return Response.json({}, { status: 503 });
    } };
  const commands = loadSourceModule<typeof import("../src/lib/rubber-bills/command")>("src/lib/rubber-bills/command.ts", {
    "@/lib/auth-fetch": auth,
  }, { navigator: { onLine: true } });
  const sync = loadSourceModule<typeof import("../src/lib/rubber-bills/central-sync")>("src/lib/rubber-bills/central-sync.ts", {
    "@/lib/idb-queue": queue, "@/lib/auth-fetch": auth, "./command": commands,
  }, { navigator: { onLine: true }, window: globalThis, indexedDB });
  for (const [index, locationId] of [branch, branch, other].entries()) {
    const commandId = crypto.randomUUID(), id = `context-${index}`;
    await queue.enqueueSyncEvent({ id, entity: "rubber_bills", ownerUserId: owner, locationId,
      operation: "create", timestamp: index, status: "pending", payload: { localContextPending: true,
        centralQueue: true, contractVersion: 2, actorUserId: owner, commandId, idempotencyKey: commandId,
        clientTempId: id, locationId, operation: "create", expectedRevisionNo: 0 } });
  }
  await sync.runRubberCentralQueue({ invalidateQueries: async () => {} } as never, owner);
  expect(reads).toEqual([branch, other]);
  expect(posts).toEqual([other]);
  const waiting = await queue.getPendingEvents({ entity: "rubber_bills", ownerUserId: owner, locationId: branch });
  expect(waiting).toHaveLength(2);
  expect(waiting.every(event => event.payload.localContextPending === true && !event.serverSubmissionAttempted)).toBe(true);
});

test("local receipts serialize without waiting for completion and completion cannot share them again", async () => {
  const prints = loadSourceModule<typeof import("../src/lib/rubber-bills/central-print")>("src/lib/rubber-bills/central-print.ts", {}, { setTimeout });
  const calls: string[] = [];
  const stop = prints.registerRubberQueuePrinter(owner, branch, async snapshot => { calls.push(snapshot.customerName); });
  const first = bill(), next = { ...bill(), clientTempId: "next", customerName: "Next" };
  prints.printAcceptedRubberReceipt(owner, branch, first); first.customerName = "Changed";
  prints.printAcceptedRubberReceipt(owner, branch, next);
  await expect.poll(() => calls.length).toBe(2);
  expect(calls).toEqual(["New customer", "Next"]);
  await Promise.resolve(); expect(calls).toHaveLength(2);
  prints.printAcceptedRubberReceipt("other-owner", branch, next);
  prints.printAcceptedRubberReceipt(owner, "other-branch", next);
  stop(); await Promise.resolve(); expect(calls).toHaveLength(2);
});
