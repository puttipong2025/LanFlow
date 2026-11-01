import { test, expect } from "@playwright/test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { buildIncomeExpensePayload } from "../src/lib/income-expense/build-income-expense-payload";
import { loadSourceModule } from "./helpers/load-source-module";
import { mergeIncomeExpenseLocalEvents } from "../src/lib/income-expense/operational-list";
import type { IncomeExpense } from "../src/types";
import type { SyncEvent } from "../src/lib/idb-queue";

const owner = "bc000000-0000-4000-8000-000000000001", branch = "bc000000-0000-4000-8000-000000000002";
function fixture() {
  const browser = { indexedDB: new IDBFactory() };
  const load = <T,>(file: string) => loadSourceModule<T>(file, {}, { window: browser });
  const history = () => load<typeof import("../src/lib/income-expense/history-idb")>("src/lib/income-expense/history-idb.ts");
  const core = load<typeof import("../src/lib/idb-core")>("src/lib/idb-core.ts");
  return { browser, history, core };
}
function row(index = 1, patch: Partial<IncomeExpense> = {}): IncomeExpense {
  return { id: `server-${index}`, clientTempId: `client-${index}`, localBillNo: `LOCAL-${index}`,
    serverBillNo: `FINAL-${index}`, number: `FINAL-${index}`, idempotencyKey: `create:client-${index}:0`,
    locationId: branch, syncStatus: "synced", type: "expense", billOption: "ค่าใช้จ่าย", txDate: "2026-11-01",
    title: `ค่าใช้จ่าย ${index}`, cost: 50, revisionNo: 1, recordStatus: "active", createdByUserId: owner,
    createdByName: "fixture", createdByPhone: "000", clientCreatedAt: "2026-11-01T00:00:00Z",
    clientRecordedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString(), ...patch };
}

test("retains only 100 confirmed summaries across reload, separately by account/branch", async () => {
  const h = fixture(), history = h.history();
  const input = [...Array.from({ length: 101 }, (_, i) => row(i)), row(200, { syncStatus: "pending" })];
  const ticket = await history.startIncomeExpenseHistoryRefresh(owner, branch);
  await history.saveIncomeExpenseHistoryPage(owner, branch, ticket, input);
  const saved = await h.history().readIncomeExpenseHistory(owner, branch.toUpperCase());
  expect(saved?.rows).toHaveLength(100);
  expect(saved?.rows[0].clientTempId).toBe("client-100");
  expect(saved?.rows.some((item) => item.clientTempId === "client-0" || item.clientTempId === "client-200")).toBe(false);
  expect(await history.readIncomeExpenseHistory("other-owner", branch)).toBeNull();
  const otherBranch = "bc000000-0000-4000-8000-000000000003";
  await history.patchIncomeExpenseHistory(owner, otherBranch, "client-1", row(1, { locationId: otherBranch }));
  await history.patchIncomeExpenseHistory("other-owner", branch, "client-1", row());
  await history.patchIncomeExpenseHistory(owner, branch, "client-100");
  expect((await history.readIncomeExpenseHistory(owner, otherBranch))?.rows).toHaveLength(1);
  expect((await history.readIncomeExpenseHistory("other-owner", branch))?.rows).toHaveLength(1);
});

test("late pages cannot resurrect a confirmed delete or overwrite a newer request/update", async () => {
  const history = fixture().history();
  await history.patchIncomeExpenseHistory(owner, branch, "client-1", row());
  const old = await history.startIncomeExpenseHistoryRefresh(owner, branch);
  await history.patchIncomeExpenseHistory(owner, branch, "client-1");
  expect(await history.saveIncomeExpenseHistoryPage(owner, branch, old, [row()])).toBeNull();
  expect((await history.readIncomeExpenseHistory(owner, branch))?.rows).toHaveLength(0);
  const first = await history.startIncomeExpenseHistoryRefresh(owner, branch);
  const second = await history.startIncomeExpenseHistoryRefresh(owner, branch);
  await history.saveIncomeExpenseHistoryPage(owner, branch, second, [row(2)]);
  expect(await history.saveIncomeExpenseHistoryPage(owner, branch, first, [row()])).toBeNull();
  const third = await history.startIncomeExpenseHistoryRefresh(owner, branch);
  await history.patchIncomeExpenseHistory(owner, branch, "client-2", row(2, { revisionNo: 2, title: "แก้ไขแล้ว" }));
  await history.saveIncomeExpenseHistoryPage(owner, branch, third, [row(2)]);
  expect((await history.readIncomeExpenseHistory(owner, branch))?.rows[0]).toMatchObject({ revisionNo: 2, title: "แก้ไขแล้ว" });
  await history.patchIncomeExpenseHistory(owner, branch, "client-2", row(2));
  expect((await history.readIncomeExpenseHistory(owner, branch))?.rows[0].revisionNo).toBe(2);
});

test("v10 upgrade keeps accepted submissions, outbox and shared counters and fences older writers", async () => {
  const h = fixture();
  const request = h.browser.indexedDB.open("lanflow_sync_db", 10);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(h.core.SYNC_QUEUE_STORE, { keyPath: "queueId", autoIncrement: true }).put({ id: "pending" });
    request.result.createObjectStore(h.core.INCOME_SUBMISSION_STORE, { keyPath: "key" }).put({ key: "accepted", localBillNo: "E-0007-261101-D01" });
    request.result.createObjectStore(h.core.RUBBER_NUMBER_STORE, { keyPath: "key" }).put({ key: branch, counters: { "2026-11-01": 7 } });
  };
  const legacy = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); });
  legacy.close();
  const db = await h.core.getSyncDb();
  expect(db.version).toBe(11);
  expect(db.objectStoreNames.contains(h.core.INCOME_HISTORY_STORE)).toBe(true);
  for (const store of [h.core.SYNC_QUEUE_STORE, h.core.INCOME_SUBMISSION_STORE, h.core.RUBBER_NUMBER_STORE]) {
    const get = db.transaction(store).objectStore(store).getAll();
    const rows = await new Promise<Record<string, unknown>[]>((resolve) => { get.onsuccess = () => resolve(get.result); });
    expect(rows).toHaveLength(1);
    if (store === h.core.RUBBER_NUMBER_STORE) expect(rows[0].counters).toEqual({ "2026-11-01": 7 });
  }
  db.close();
  const old = h.browser.indexedDB.open("lanflow_sync_db", 10);
  expect(await new Promise<string>((resolve) => { old.onerror = () => resolve(old.error!.name); })).toBe("VersionError");
});

for (const operation of ["update", "delete"] as const) test(`confirmed background ${operation} refreshes the offline copy`, async () => {
  const h = fixture(), history = h.history(), serverId = crypto.randomUUID();
  const original = row(1, { id: serverId });
  await history.patchIncomeExpenseHistory(owner, branch, original.clientTempId, original);
  const q = new QueryClient(), commandId = crypto.randomUUID();
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: h.browser });
  const updated = { ...original, title: "ยืนยันแก้ไขแล้ว", cost: 70 };
  const payload = { ...buildIncomeExpensePayload(updated, operation), contractVersion: 2,
    background: true, commandId, actorUserId: owner, expectedServerId: serverId };
  await queue.enqueueSyncEvent({ entity: "income_expense", id: original.clientTempId, ownerUserId: owner,
    locationId: branch, serverId, operation, status: "pending", timestamp: 1, payload });
  const worker = loadSourceModule<typeof import("../src/lib/income-expense/background-sync")>("src/lib/income-expense/background-sync.ts", {
    "./feed-cache": loadSourceModule<typeof import("../src/lib/income-expense/feed-cache")>("src/lib/income-expense/feed-cache.ts", {}, { window: h.browser }),
    "./background-idb": loadSourceModule<typeof import("../src/lib/income-expense/background-idb")>("src/lib/income-expense/background-idb.ts", {}, { window: h.browser }),
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => Response.json({
      commandId, actorUserId: owner, serverId, locationId: branch, clientTempId: original.clientTempId,
      operation, outcome: "synced", status: "synced", id: serverId, serverBillNo: original.serverBillNo,
      revisionNo: 2, serverReceivedAt: "2026-11-01T02:00:00Z",
    }) },
  }, { window: h.browser, navigator: { onLine: true } });
  await worker.runIncomeExpenseBackground(q, owner);
  expect(await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch })).toHaveLength(0);
  const saved = (await history.readIncomeExpenseHistory(owner, branch))!.rows;
  if (operation === "delete") expect(saved).toHaveLength(0);
  else expect(saved).toMatchObject([{ id: serverId, cost: 70, title: "ยืนยันแก้ไขแล้ว", revisionNo: 2 }]);
  q.clear();
});

for (const operation of ["update", "delete"] as const) test(`legacy manual ${operation} retry patches history after exact acknowledgement`, async () => {
  const h = fixture(), history = h.history(), q = new QueryClient(), serverId = crypto.randomUUID();
  const original = row(1, { id: serverId });
  await history.patchIncomeExpenseHistory(owner, branch, original.clientTempId, original);
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: h.browser });
  const payload = buildIncomeExpensePayload({ ...original, title: "legacy retry", cost: 70 }, operation);
  await queue.enqueueSyncEvent({ entity: "income_expense", id: original.clientTempId, ownerUserId: owner,
    locationId: branch, operation, status: "failed", timestamp: 1, payload });
  const hook = loadSourceModule<typeof import("../src/hooks/usePerRecordSyncRetry")>("src/hooks/usePerRecordSyncRetry.ts", {
    "@tanstack/react-query": { useQueryClient: () => q,
      useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
    "@/lib/auth-fetch": { authFetch: async () => Response.json({ status: "synced", id: serverId,
      serverBillNo: original.serverBillNo, revisionNo: 2, serverReceivedAt: "2026-11-01T02:00:00Z" }) },
  }, { window: h.browser, navigator: { onLine: true } });
  await hook.usePerRecordSyncRetry(branch, owner).retrySyncEvent({ entity: "income_expense", id: original.clientTempId });
  expect(await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch })).toHaveLength(0);
  const saved = (await history.readIncomeExpenseHistory(owner, branch))!.rows;
  if (operation === "delete") expect(saved).toHaveLength(0);
  else expect(saved).toMatchObject([{ id: serverId, title: "legacy retry", cost: 70, revisionNo: 2 }]);
  q.clear();
});

test("fresh empty feed removes stale copies; malformed/wrong-branch data cannot replace a valid copy", async () => {
  const h = fixture(), history = h.history();
  await history.patchIncomeExpenseHistory(owner, branch, "client-1", row());
  const ticket = await history.startIncomeExpenseHistoryRefresh(owner, branch);
  for (const invalid of [row(2, { locationId: "wrong" }), row(2, { title: "" })]) {
    expect(await history.saveIncomeExpenseHistoryPage(owner, branch, ticket, [invalid])).toBeNull();
  }
  expect((await history.readIncomeExpenseHistory(owner, branch))?.rows).toHaveLength(1);
  await history.saveIncomeExpenseHistoryPage(owner, branch, ticket, []);
  expect((await history.readIncomeExpenseHistory(owner, branch))?.rows).toHaveLength(0);
  const db = await h.core.getSyncDb(), tx = db.transaction(h.core.INCOME_HISTORY_STORE, "readwrite");
  tx.objectStore(h.core.INCOME_HISTORY_STORE).put({ key: JSON.stringify([owner, branch]), version: 1, rows: "bad" });
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); }); db.close();
  expect(await history.readIncomeExpenseHistory(owner, branch)).toBeNull();
});

test("optional history quota failure retains outbox, receipts and numbering state", async () => {
  const h = fixture(), db = await h.core.getSyncDb();
  const stores = [h.core.SYNC_QUEUE_STORE, h.core.RUBBER_NUMBER_STORE, h.core.RUBBER_BILL_RECEIPT_STORE, h.core.INCOME_SUBMISSION_STORE];
  const values = [{ id: "pending", status: "pending" }, { key: branch, counter: 7 }, { billId: "rubber-receipt" }, { key: "accepted", status: "pending" }];
  const tx = db.transaction(stores, "readwrite");
  stores.forEach((store, index) => tx.objectStore(store).put(values[index]));
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); }); db.close();
  const original = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === h.core.INCOME_HISTORY_STORE) throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
    expect(await h.history().patchIncomeExpenseHistory(owner, branch, "client-1", row())).toBeNull();
  } finally { IDBObjectStore.prototype.put = original; }
  const check = await h.core.getSyncDb();
  for (const store of stores) {
    const request = check.transaction(store).objectStore(store).getAll();
    const all = await new Promise<unknown[]>((resolve) => { request.onsuccess = () => resolve(request.result); });
    expect(all).toHaveLength(1);
  }
  check.close();
});

test("offline summary search merges queued creates and never applies unconfirmed background edits", async () => {
  const history = fixture().history();
  await history.patchIncomeExpenseHistory(owner, branch, "client-1", row());
  const background = { id: "client-1", entity: "income_expense", ownerUserId: owner, locationId: branch,
    serverId: "bc000000-0000-4000-8000-000000000009", operation: "update", status: "pending", timestamp: 1,
    payload: { operation: "update", clientTempId: "client-1", locationId: branch, contractVersion: 2, background: true,
      commandId: crypto.randomUUID(), actorUserId: owner, expectedServerId: "bc000000-0000-4000-8000-000000000009",
      billOption: "ค่าใช้จ่าย", title: "NOT CONFIRMED", cost: 999 } } as SyncEvent;
  const rows = mergeIncomeExpenseLocalEvents((await history.readIncomeExpenseHistory(owner, branch))!.rows, [background], "FINAL-1");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ cost: 50, title: "ค่าใช้จ่าย 1", syncStatus: "pending" });
  expect(mergeIncomeExpenseLocalEvents(rows, [], "NOT CONFIRMED")).toHaveLength(0);
});
