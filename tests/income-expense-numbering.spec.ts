import { test, expect } from "@playwright/test";
import { QueryClient } from "@tanstack/react-query";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { loadSourceModule } from "./helpers/load-source-module";
import type { IncomeExpense, RubberBill } from "../src/types";
import { buildIncomeExpensePayload } from "../src/lib/income-expense/build-income-expense-payload";
import { isIncomeExpenseSyncResult } from "../src/lib/income-expense/contracts";
import { incomeApprovalBillNumber } from "../src/lib/income-expense/numbering-contract";

const branch = "ae000000-0000-4000-8000-000000000001", owner = "ae000000-0000-4000-8000-000000000002";
function fixture(shared = false) {
  const browser = { indexedDB: new IDBFactory() }; let registrations = 0;
  const codes = new Map<string, string>();
  const deps = { "@/lib/auth-fetch": { assertApiResponse: async () => {}, authFetch: async (_url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)), key = `${input.installationId}:${input.generationId}`;
    if (!codes.has(key)) codes.set(key, `D${String(codes.size + 1).padStart(2,"0")}`);
    registrations++; return Response.json({ version: 1, id: crypto.randomUUID(), code: shared ? codes.get(key) : `D0${registrations}`, locationId: input.locationId, deviceId: input.generationId });
  } } };
  const load = <T,>(path: string) => loadSourceModule<T>(path, deps, { window: browser });
  const issuer = load<typeof import("../src/lib/rubber-bills/numbering-idb")>("src/lib/rubber-bills/numbering-idb.ts");
  const fresh = () => load<typeof import("../src/lib/income-expense/numbering-idb")>("src/lib/income-expense/numbering-idb.ts");
  const core = load<typeof import("../src/lib/idb-core")>("src/lib/idb-core.ts");
  const receipts = load<typeof import("../src/lib/income-expense/numbering-receipts")>("src/lib/income-expense/numbering-receipts.ts");
  return { browser, issuer, fresh, core, receipts };
}
function row(type: "income" | "expense" = "expense", txDate = "2026-10-31"): IncomeExpense {
  const id = crypto.randomUUID();
  return { id, clientTempId: id, localBillNo: "unallocated", syncStatus: "pending", idempotencyKey: `create:${id}:0`,
    locationId: branch, type, number: "unallocated", txDate, title: "numbered fixture", cost: 50,
    billOption: type === "income" ? "รายรับ" : "ค่าใช้จ่าย", createdByUserId: owner, createdByName: "fixture", createdByPhone: "000",
    clientCreatedAt: "2026-10-31T01:00:00Z", clientRecordedAt: "2026-10-31T01:00:00Z", revisionNo: 0, recordStatus: "active" };
}
test("unregistered income cannot claim a number or acceptance", async () => {
  const h = fixture(); expect(await h.fresh().enqueueNumberedIncomeCreate(row(), owner).then(() => "unexpected", e => String(e.message))).toContain("รหัสเครื่อง");
});

test("income and expense share the browser code across branches with separate branch counters", async () => {
  const h=fixture(true), other=crypto.randomUUID();
  await Promise.all([h.issuer.prepareRubberBillIssuer(branch),h.issuer.prepareRubberBillIssuer(other)]);
  const first=await h.fresh().enqueueNumberedIncomeCreate(row(),owner);
  const second=await h.fresh().enqueueNumberedIncomeCreate({...row(),locationId:other},owner);
  expect(first.localBillNo).toBe("E-0001-261031-D01");
  expect(second.localBillNo).toBe(first.localBillNo);
  expect(second.billNumbering?.issuerId).not.toBe(first.billNumbering?.issuerId);
  expect((await h.fresh().enqueueNumberedIncomeCreate(row(),owner)).localBillNo).toBe("E-0002-261031-D01");
  expect((await h.fresh().enqueueNumberedIncomeCreate({...row("income"),locationId:other},owner)).localBillNo).toBe("I-0001-261031-D01");
});
test("parallel tabs and accounts use one issuer but independent daily income/expense/rubber counters", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const result = await Promise.all(Array.from({ length: 12 }, (_, i) => h.fresh().enqueueNumberedIncomeCreate(row(), i % 2 ? owner : "another-owner")));
  expect(result.map(v => v.billNumbering?.sequence).sort((a,b) => a! - b!)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect((await h.fresh().enqueueNumberedIncomeCreate(row("income"), owner)).localBillNo).toBe("I-0001-261031-D01");
  expect((await h.fresh().enqueueNumberedIncomeCreate(row("expense", "2026-11-01"), owner)).localBillNo).toBe("E-0001-261101-D01");
  expect((await h.fresh().enqueueNumberedIncomeCreate(row(), owner)).localBillNo).toBe("E-0013-261031-D01");
  const db = await h.core.getSyncDb(); const tx = db.transaction(h.core.RUBBER_NUMBER_STORE);
  const read = tx.objectStore(h.core.RUBBER_NUMBER_STORE).get(branch);
  await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
  expect(read.result.counters).toEqual({}); db.close();
});
test("accepted rows survive module reload and changed retry form values without allocating or queuing twice", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const first = row(), accepted = await h.fresh().enqueueNumberedIncomeCreate(first, owner);
  const retry = await h.fresh().enqueueNumberedIncomeCreate({ ...first, txDate: "2026-11-01", title: "changed" }, owner);
  expect(retry).toEqual(accepted);
  expect((await h.fresh().readIncomeSubmission(owner, branch, first.clientTempId))?.transaction).toEqual(accepted);
  expect(await h.fresh().readIncomeSubmission("other", branch, first.clientTempId)).toBeUndefined();
});
test("simultaneous rubber, income and expense writes keep three independent counters under one issuer", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch); const id = crypto.randomUUID();
  const rubber = { id, clientTempId: id, locationId: branch, billDate: "2026-10-31" } as RubberBill;
  const [income, expense, rubberResult] = await Promise.all([
    h.fresh().enqueueNumberedIncomeCreate(row("income"), owner), h.fresh().enqueueNumberedIncomeCreate(row(), owner),
    h.issuer.enqueueNumberedRubberCreate({ id, entity: "rubber_bills", ownerUserId: owner, locationId: branch,
      operation: "create", timestamp: 0, status: "pending", payload: { clientTempId: id } }, rubber),
  ]);
  expect([income.localBillNo, expense.localBillNo, rubberResult.bill.localBillNo]).toEqual(["I-0001-261031-D01", "E-0001-261031-D01", "0001-261031-D01"]);
});
test("missing backend capability and wrong acknowledgements preserve the original numbered outbox", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const accepted = await h.fresh().enqueueNumberedIncomeCreate(row(), owner); let wrong = false;
  const module = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => wrong
      ? Response.json({ status: "synced", clientTempId: "wrong" }) : Response.json({ status: "failed" }, { status: 503 }) },
    "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => {} },
  }, { window: h.browser, navigator: { onLine: true } });
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: h.browser });
  const scope = { entity: "income_expense" as const, ownerUserId: owner, locationId: branch }, [before] = await queue.getPendingEvents(scope);
  for (const mode of [false, true]) {
    wrong = mode; await module.syncPendingIncomeExpense(new QueryClient(), owner, branch);
    const after = await queue.getPendingEvents(scope); expect(after).toHaveLength(1);
    expect(after[0].payload).toEqual(before.payload); expect(after[0].serverSubmissionAttempted).toBe(true);
    expect((await h.fresh().readIncomeSubmission(owner, branch, accepted.clientTempId))?.transaction).toEqual(accepted);
  }
});
test("a partially accepted form can finish remaining rows while the first row awaits its server acknowledgement", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const first = row(), accepted = await h.fresh().enqueueNumberedIncomeCreate(first, owner);
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: h.browser });
  const [event] = await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch });
  await queue.updateSyncEvent({ ...event, serverSubmissionAttempted: true });
  const module = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
    "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
    "@/hooks/useIncomeExpenseOperationalList": { useIncomeExpenseOperationalList: () => ({ rows: [] }) },
  }, { window: h.browser, navigator: { onLine: false } });
  const hook = module.useIncomeExpense(branch, owner);
  expect(await hook.addTransaction({ ...first, title: "changed retry" })).toEqual(accepted);
  expect((await hook.addTransaction(row())).localBillNo).toBe("E-0002-261031-D01");
  const after = await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch });
  expect(after).toHaveLength(2); expect(after.find(item => item.id === event.id)?.payload).toEqual(event.payload);
});
test("outbox abort rolls back acceptance, reservation and counter", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch); const first = row();
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) { const request = original.apply(this, args);
    if (this.name === "sync_queue") request.addEventListener("success", () => this.transaction.abort()); return request; };
  try { expect(await h.fresh().enqueueNumberedIncomeCreate(first, owner).then(() => false, () => true)).toBe(true); }
  finally { IDBObjectStore.prototype.add = original; }
  expect(await h.fresh().readIncomeSubmission(owner, branch, first.clientTempId)).toBeUndefined();
  expect((await h.fresh().enqueueNumberedIncomeCreate(first, owner)).localBillNo).toBe("E-0001-261031-D01");
});
test("synchronous storage quota failure aborts acceptance and gives a readable recovery message", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch); const first = row();
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === "sync_queue") throw Object.assign(new Error("fixture quota"), { name: "QuotaExceededError" });
    return original.apply(this, args);
  };
  let message = "";
  try { message = await h.fresh().enqueueNumberedIncomeCreate(first, owner).then(() => "unexpected", error => String(error.message)); }
  finally { IDBObjectStore.prototype.add = original; }
  expect(message).toContain("พื้นที่ว่าง");
  expect(await h.fresh().readIncomeSubmission(owner, branch, first.clientTempId)).toBeUndefined();
  expect((await h.fresh().enqueueNumberedIncomeCreate(first, owner)).localBillNo).toBe("E-0001-261031-D01");
});
for (const damage of ["counter", "state", "counter-and-reservations", "base-type"]) test(`lost income ${damage} with surviving issuer cannot restart old code`, async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch); await h.fresh().enqueueNumberedIncomeCreate(row(), owner);
  const db = await h.core.getSyncDb(), tx = db.transaction(h.core.RUBBER_NUMBER_STORE, "readwrite"), store = tx.objectStore(h.core.RUBBER_NUMBER_STORE);
  const read = store.get(branch); read.onsuccess = () => { const state = read.result;
    if (damage === "base-type") Object.values(state.incomeExpense.reservations).forEach(value => { (value as { base: unknown }).base = 15; });
    else if (damage === "state") delete state.incomeExpense;
    else { state.incomeExpense.counters = {}; if (damage === "counter-and-reservations") state.incomeExpense.reservations = {}; } store.put(state); };
  await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  expect(await h.issuer.rubberNumberingReady(branch)).toBe(false);
  expect(await h.fresh().enqueueNumberedIncomeCreate(row(), owner).then(() => false, () => true)).toBe(true);
  await h.issuer.prepareRubberBillIssuer(branch);
  expect((await h.fresh().enqueueNumberedIncomeCreate(row(), owner)).localBillNo).toBe("E-0001-261031-D02");
});
test("receipt confirmation persists approval handoff before removing exact queued command", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const accepted = await h.fresh().enqueueNumberedIncomeCreate(row(), owner);
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: h.browser });
  const event = (await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch }))[0];
  const result = { status: "pending_approval", requestId: crypto.randomUUID(), matchedReasons: ["amount_threshold"],
    clientTempId: accepted.clientTempId, operation: "create", locationId: branch, localBillNo: accepted.localBillNo, billNumbering: accepted.billNumbering };
  expect(await h.receipts.confirmIncomeNumberedEvent(event, { ...result, clientTempId: "wrong" })).toBe(false);
  expect((await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch }))).toHaveLength(1);
  expect(await h.receipts.confirmIncomeNumberedEvent(event, result)).toBe(true);
  expect((await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch }))).toHaveLength(0);
  expect(await h.fresh().readIncomeSubmission(owner, branch, accepted.clientTempId)).toMatchObject({ result });
});
test("shared issuer rotation leaves accepted old-code work intact and starts only new work under the replacement", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const original = row(), first = await h.fresh().enqueueNumberedIncomeCreate(original, owner);
  await h.issuer.prepareRubberBillIssuer(branch, true);
  expect((await h.fresh().enqueueNumberedIncomeCreate(row(), owner)).localBillNo).toBe("E-0001-261031-D02");
  expect(await h.fresh().enqueueNumberedIncomeCreate(original, owner)).toEqual(first);
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: h.browser });
  const events = await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch });
  expect(events).toHaveLength(2);
  expect(events.find(event => event.id === first.clientTempId)?.payload.localBillNo).toBe("E-0001-261031-D01");
});
test("numbered result rejects mismatching final and identity while preserving legacy receipt contract", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const accepted = await h.fresh().enqueueNumberedIncomeCreate(row(), owner), payload = buildIncomeExpensePayload(accepted, "create");
  const result = { status: "synced", id: crypto.randomUUID(), serverBillNo: accepted.localBillNo + "-1", revisionNo: 1,
    serverReceivedAt: "2026-10-31T01:00:00Z", clientTempId: accepted.clientTempId, operation: "create", locationId: branch,
    localBillNo: accepted.localBillNo, billNumbering: accepted.billNumbering };
  expect(isIncomeExpenseSyncResult(result, payload)).toBe(true);
  expect(isIncomeExpenseSyncResult({ ...result, serverBillNo: "legacy" }, payload)).toBe(false);
  expect(isIncomeExpenseSyncResult({ ...result, locationId: crypto.randomUUID() }, payload)).toBe(false);
  expect(isIncomeExpenseSyncResult({ ...result, serverBillNo: "legacy" }, { ...payload, billNumbering: undefined })).toBe(true);
  expect(incomeApprovalBillNumber(payload, undefined)).toBe(accepted.localBillNo);
  expect(incomeApprovalBillNumber(payload, result.serverBillNo)).toBe(result.serverBillNo);
  expect(incomeApprovalBillNumber(payload, "wrong-base-1")).toBe(accepted.localBillNo);
  expect(incomeApprovalBillNumber({ ...payload, billNumbering: undefined }, "legacy")).toBeUndefined();
});
test("v9 uploaders are fenced without clearing v10 queued work or its accepted snapshot", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const accepted = await h.fresh().enqueueNumberedIncomeCreate(row(), owner);
  const outcome = await new Promise<string>(resolve => {
    const old = h.browser.indexedDB.open("lanflow_sync_db", 9);
    old.onerror = () => resolve(old.error?.name ?? "unknown");
    old.onsuccess = () => { old.result.close(); resolve("unexpected success"); };
  });
  expect(outcome).toBe("VersionError");
  expect((await h.fresh().readIncomeSubmission(owner, branch, accepted.clientTempId))?.transaction.localBillNo).toBe(accepted.localBillNo);
});
test("numbered route requires the dedicated backend capability and rejects a wrong-base acknowledgement", async () => {
  const h = fixture(); await h.issuer.prepareRubberBillIssuer(branch);
  const accepted = await h.fresh().enqueueNumberedIncomeCreate(row(), owner), payload = buildIncomeExpensePayload(accepted, "create");
  const calls: string[] = []; let mode = "missing";
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/route")>("src/app/api/lanflow/income-expense/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, supabase: { rpc: async (name: string) => {
      calls.push(name);
      if (mode === "missing") return { data: null, error: { code: "PGRST202", message: "Numbered capability unavailable" } };
      return { error: null, data: { status: "synced", id: crypto.randomUUID(), serverBillNo: "wrong-base-1", revisionNo: 1,
        serverReceivedAt: accepted.clientRecordedAt, clientTempId: payload.clientTempId, operation: "create", locationId: branch,
        localBillNo: payload.localBillNo, billNumbering: payload.billNumbering } };
    } } }) },
  });
  const request = () => new Request("http://localhost/api/lanflow/income-expense", { method: "POST", body: JSON.stringify(payload) });
  expect((await route.POST(request())).status).toBe(503); mode = "wrong";
  expect((await route.POST(request())).status).toBe(503);
  expect(calls).toEqual(["sync_numbered_income_expense", "sync_numbered_income_expense"]);
});
