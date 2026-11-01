import { expect, test } from "@playwright/test";
import { QueryClient } from "@tanstack/react-query";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { loadSourceModule } from "./helpers/load-source-module";
import type { IncomeExpense } from "../src/types";
import { getIncomeExpenseSyncActionBlockReason, getRubberBillSyncActionBlockReason } from "../src/lib/record-action-locks";
import { incomeExpenseFromSyncEvent } from "../src/lib/income-expense/operational-list";
import { buildIncomeExpensePayload } from "../src/lib/income-expense/build-income-expense-payload";

const owner = "bd000000-0000-4000-8000-000000000001", branch = "bd000000-0000-4000-8000-000000000002";
function row(): IncomeExpense {
  const id = crypto.randomUUID();
  return { id, clientTempId: id, localBillNo: "new", number: "new", idempotencyKey: `create:${id}:0`,
    locationId: branch, type: "income", billOption: "รายรับ", title: "action fixture", cost: 10,
    txDate: "2026-11-01", clientCreatedAt: "2026-11-01T00:00:00Z", clientRecordedAt: "2026-11-01T00:00:00Z",
    createdByUserId: owner, createdByName: "fixture", createdByPhone: "000", syncStatus: "pending",
    recordStatus: "active", revisionNo: 0 };
}
async function fixture() {
  const browser = { indexedDB: new IDBFactory() }, queryClient = new QueryClient();
  const globals = { window: browser, navigator: { onLine: false } };
  const load = <T,>(path: string) => loadSourceModule<T>(path, {}, globals);
  const issuer = loadSourceModule<typeof import("../src/lib/rubber-bills/numbering-idb")>("src/lib/rubber-bills/numbering-idb.ts", {
    "@/lib/auth-fetch": { assertApiResponse: async () => {}, authFetch: async (_url: string, init: RequestInit) => Response.json({
      version: 1, id: crypto.randomUUID(), code: "D01", locationId: branch,
      deviceId: JSON.parse(String(init.body)).generationId,
    }) },
  }, globals);
  await issuer.prepareRubberBillIssuer(branch);
  const numbers = load<typeof import("../src/lib/income-expense/numbering-idb")>("src/lib/income-expense/numbering-idb.ts");
  const queue = load<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts");
  const scope = { entity: "income_expense" as const, ownerUserId: owner, locationId: branch };
  const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
    "@tanstack/react-query": { useQueryClient: () => queryClient,
      useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
    "@/hooks/useIncomeExpenseOperationalList": { useIncomeExpenseOperationalList: () => ({ rows: [], refresh: async () => {} }) },
  }, globals).useIncomeExpense(branch, owner);
  return { browser, queryClient, globals, load, numbers, queue, scope, hook };
}

test("accepted pending rows cannot be edited, but a new row and partial-form retry still work", async () => {
  const h = await fixture(), original = row(), accepted = await h.hook.addTransaction(original);
  expect(await h.hook.updateTransaction({ ...accepted, title: "changed" }).then(() => "allowed", error => error.message)).toContain("รอซิงก์");
  expect(await h.hook.addTransaction(original)).toEqual(accepted);
  expect((await h.hook.addTransaction(row())).localBillNo).toBe("I-0002-261101-D01");
  expect((await h.queue.getPendingEvents(h.scope))[0].payload.title).toBe(original.title);
  h.queryClient.clear();
});

test("cancelled unsubmitted create cannot reappear from an old accepted form or stale sender", async () => {
  const h = await fixture(), original = row(), accepted = await h.hook.addTransaction(original);
  const [snapshot] = await h.queue.getPendingEvents(h.scope);
  const other = { ...snapshot, id: "other-account", ownerUserId: "other-owner" };
  delete other.queueId;
  await h.queue.enqueueSyncEvent(other);
  await h.hook.deleteTransaction({ clientTempId: accepted.clientTempId, deletedByName: "fixture", deletedByPhone: "000" });
  expect(await h.queue.getPendingEvents(h.scope)).toHaveLength(0);
  expect(await h.queue.getPendingEvents({ ...h.scope, ownerUserId: "other-owner" })).toHaveLength(1);
  expect(await h.numbers.readIncomeSubmission(owner, branch, accepted.clientTempId)).toMatchObject({ cancelled: true });
  expect(await h.queue.reconcileSyncEventsIfCurrent([snapshot], { ...snapshot, serverSubmissionAttempted: true })).toBe(false);
  expect(await h.hook.addTransaction(original).then(() => "allowed", error => error.message)).toContain("ยกเลิกแล้ว");
  expect(await h.hook.addTransaction(accepted).then(() => "allowed", error => error.message)).toContain("ยกเลิกแล้ว");
  expect((await h.hook.addTransaction(row())).localBillNo).toBe("I-0002-261101-D01");
  h.queryClient.clear();
});

test("cancellation rolls back its outbox removal if the durable cancelled marker cannot be saved", async () => {
  const h = await fixture(), accepted = await h.hook.addTransaction(row());
  const original = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === "income_expense_submissions") throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
    expect(await h.hook.deleteTransaction({ clientTempId: accepted.clientTempId, deletedByName: "fixture", deletedByPhone: "000" })
      .then(() => "allowed", error => error.message)).toContain("ยังยกเลิกรายการไม่ได้");
  } finally { IDBObjectStore.prototype.put = original; }
  expect(await h.queue.getPendingEvents(h.scope)).toHaveLength(1);
  expect((await h.numbers.readIncomeSubmission(owner, branch, accepted.clientTempId))?.cancelled).not.toBe(true);
});

test("an explicitly unsent legacy create is cancelled durably without inventing a new number", async () => {
  const h = await fixture(), original = row();
  await h.queue.enqueueSyncEvent({ entity: "income_expense", id: original.clientTempId, ownerUserId: owner,
    locationId: branch, operation: "create", status: "pending", timestamp: 1, serverSubmissionAttempted: false,
    payload: buildIncomeExpensePayload(original, "create") });
  await h.hook.deleteTransaction({ clientTempId: original.clientTempId, deletedByName: "fixture", deletedByPhone: "000" });
  expect(await h.queue.getPendingEvents(h.scope)).toHaveLength(0);
  expect(await h.hook.addTransaction(original).then(() => "allowed", error => error.message)).toContain("ยกเลิกแล้ว");
  expect((await h.hook.addTransaction(row())).localBillNo).toBe("I-0001-261101-D01");
});

for (const marker of [true, undefined]) test(`delete fails closed when the durable sent marker is ${marker}`, async () => {
  const h = await fixture(), accepted = await h.hook.addTransaction(row());
  const [event] = await h.queue.getPendingEvents(h.scope);
  await h.queue.updateSyncEvent({ ...event, serverSubmissionAttempted: marker });
  expect(await h.hook.deleteTransaction({ clientTempId: accepted.clientTempId, deletedByName: "fixture", deletedByPhone: "000" })
    .then(() => "allowed", error => error.message)).not.toBe("allowed");
  expect(await h.queue.getPendingEvents(h.scope)).toHaveLength(1);
  expect((await h.numbers.readIncomeSubmission(owner, branch, accepted.clientTempId))?.cancelled).not.toBe(true);
  h.queryClient.clear();
});

test("ordinary income/expense uses the same pending action matrix as Rubber", () => {
  for (const status of ["pending", "synced"] as const) for (const server of [false, true]) {
    for (const marker of [false, true, undefined]) for (const action of ["edit", "delete"] as const) {
      const record = { ...row(), syncStatus: status, serverSubmissionAttempted: marker,
        ...(server ? { id: "server-id", serverBillNo: "FINAL" } : {}) };
      expect(getIncomeExpenseSyncActionBlockReason(record, action)).toBe(getRubberBillSyncActionBlockReason(record, action));
    }
  }
});

test("unknown legacy submission state is not presented as proven unsent", async () => {
  const h = await fixture(); await h.hook.addTransaction(row());
  const [event] = await h.queue.getPendingEvents(h.scope);
  const projected = incomeExpenseFromSyncEvent({ ...event, serverSubmissionAttempted: undefined });
  expect(projected.serverSubmissionAttempted).toBeUndefined();
  expect(getIncomeExpenseSyncActionBlockReason(projected, "delete")).not.toBeNull();
});

test("stale cancellation loses to a sender claim and leaves the original command and acceptance intact", async () => {
  const h = await fixture(), accepted = await h.hook.addTransaction(row());
  const [snapshot] = await h.queue.getPendingEvents(h.scope);
  const cancel = h.load<typeof import("../src/lib/income-expense/cancel-local-create")>("src/lib/income-expense/cancel-local-create.ts");
  expect(await h.queue.reconcileSyncEventsIfCurrent([snapshot], { ...snapshot, serverSubmissionAttempted: true })).toBe(true);
  expect(await cancel.cancelUnsubmittedIncomeCreate([snapshot]).then(() => "allowed", error => error.message)).not.toBe("allowed");
  expect(await h.queue.getPendingEvents(h.scope)).toMatchObject([{ id: snapshot.id, serverSubmissionAttempted: true }]);
  expect((await h.numbers.readIncomeSubmission(owner, branch, accepted.clientTempId))?.cancelled).not.toBe(true);
});

test("actual sender skips a cancelled stale snapshot instead of recreating or posting it", async () => {
  const h = await fixture(), accepted = await h.hook.addTransaction(row());
  let reads = 0, posts = 0;
  const module = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
    "@/lib/idb-queue": { ...h.queue, getPendingEvents: async (...args: Parameters<typeof h.queue.getPendingEvents>) => {
      const events = await h.queue.getPendingEvents(...args);
      if (++reads === 2) await h.hook.deleteTransaction({ clientTempId: accepted.clientTempId, deletedByName: "fixture", deletedByPhone: "000" });
      return events;
    } },
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => { posts++; return Response.json({}); } },
  }, { window: h.browser, navigator: { onLine: true } });
  await module.syncPendingIncomeExpense(h.queryClient, owner, branch);
  expect(posts).toBe(0);
  expect(await h.queue.getPendingEvents(h.scope)).toHaveLength(0);
});
