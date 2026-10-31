import { expect, test } from "@playwright/test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { loadSourceModule } from "./helpers/load-source-module";
import * as numberingContract from "../src/lib/rubber-bills/numbering-contract";
import { buildRubberBillReceiptModel, renderRubberBillReceiptHtml, resolveRubberBillReceiptForPrint } from "../src/components/rubber-bills/bill-display";
import { immediateRubberReceipt } from "../src/lib/rubber-bills/immediate-receipt";
import type { RubberBill } from "../src/types";

const branch = "af000000-0000-4000-8000-000000000001";
function harness(gate: (call: number) => Promise<void> = async () => {}) {
  const browser = { indexedDB: new IDBFactory() }, registrations = new Map<string, { version: 1; id: string; code: string; locationId: string }>();
  let calls = 0, replace = false;
  const newTab = (oldFormat = false) => loadSourceModule<typeof import("../src/lib/rubber-bills/numbering-idb")>("src/lib/rubber-bills/numbering-idb.ts", {
    ...(oldFormat ? { "./numbering-contract": { ...numberingContract,
      rubberBaseNumber: (date: string, sequence: number, code: string) => `${date.slice(2).replaceAll("-", "")}${String(sequence).padStart(4, "0")}-${code}` } } : {}),
    "@/lib/auth-fetch": { assertApiResponse: async (r: Response) => { if (!r.ok) throw new Error("Unavailable"); },
      authFetch: async (_url: string, init: RequestInit) => {
        calls++; const body = JSON.parse(String(init.body)), key = `${body.locationId}:${body.installationId}:${body.generationId}`;
        if (!registrations.has(key) || replace) { replace = false;
          registrations.set(key, { version: 1, id: crypto.randomUUID(), code: `D${String(calls).padStart(2, "0")}`, locationId: body.locationId }); }
        const result = registrations.get(key); await gate(calls); return Response.json(result);
      } },
  }, { window: browser });
  return { module: newTab(), newTab, browser, replace: () => { replace = true; }, calls: () => calls };
}
const bill = (id = crypto.randomUUID()): RubberBill => ({ id, clientTempId: id, localBillNo: "not-issued", billNo: "not-issued",
  locationId: branch, billDate: "2026-10-31", billType: "บิลเครื่องชั่งเล็ก", weighItems: [], syncStatus: "pending" } as unknown as RubberBill);
const event = (b: RubberBill, owner = "first") => ({ id: b.id, entity: "rubber_bills" as const, operation: "create" as const,
  ownerUserId: owner, locationId: branch, timestamp: 0, status: "pending" as const, payload: { clientTempId: b.id, billDate: b.billDate } });

test("numbering has no truncation after four local digits or two issuer digits", () => {
  expect(numberingContract.rubberBaseNumber("2026-10-31", 10000, "D100")).toBe("10000-261031-D100");
});
test("unregistered devices cannot create a base or claim readiness", async () => {
  const h = harness(), b = bill();
  expect(await h.module.rubberNumberingReady(branch)).toBe(false);
  expect(await h.module.enqueueNumberedRubberCreate(event(b), b).then(() => "unexpected success", e => String(e.message))).toContain("เชื่อมต่ออินเทอร์เน็ต");
  expect(h.calls()).toBe(0);
});
test("parallel saves and account changes share one durable counter without network", async () => {
  const h = harness(); await Promise.all([h.module.prepareRubberBillIssuer(branch), h.module.prepareRubberBillIssuer(branch)]);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => { const b = bill(); return h.module.enqueueNumberedRubberCreate(event(b, String(i % 2)), b); }));
  expect(new Set(results.map(r => r.bill.localBillNo)).size).toBe(12);
  expect(results.map(r => r.bill.billNumbering!.sequence).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect(h.calls()).toBe(1);
  for (const result of results) expect(result.event.payload.localBillNo).toBe(result.bill.localBillNo);
});
test("duplicate local intent aborts without allocating a second number", async () => {
  const h = harness(); await h.module.prepareRubberBillIssuer(branch);
  const b = bill(); await h.module.enqueueNumberedRubberCreate(event(b), b);
  expect(await h.module.enqueueNumberedRubberCreate(event(b), b).then(() => "unexpected success", e => String(e.message))).toContain("อีกแท็บ");
  const next = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(next), next)).bill.billNumbering?.sequence).toBe(2);
});
test("a lost first registration response retries the same installation without replacing its code", async () => {
  const h = harness(async call => { if (call === 1) throw new Error("registration response lost"); });
  expect(await h.module.prepareRubberBillIssuer(branch).then(() => false, () => true)).toBe(true);
  expect(await h.module.rubberNumberingReady(branch)).toBe(false);
  await h.module.prepareRubberBillIssuer(branch);
  const b = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(b), b)).bill.localBillNo).toBe("0001-261031-D01");
  expect(h.calls()).toBe(2);
});
for (const damage of ["base", "missing-issuer", "invalid-issuer", "wrong-branch"]) test(`damaged numbering state recovers under a fresh code without rewriting the outbox (${damage})`, async () => {
  const h = harness(); await h.module.prepareRubberBillIssuer(branch);
  const b = bill(), saved = await h.module.enqueueNumberedRubberCreate(event(b), b);
  await new Promise<void>((resolve, reject) => {
    const request = h.browser.indexedDB.open("lanflow_sync_db");
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("rubber_bill_numbers", "readwrite"), store = tx.objectStore("rubber_bill_numbers");
      const read = store.get(branch); read.onsuccess = () => {
        const state = read.result;
        if (damage === "base") state.reservations[b.id].base = "damaged";
        else if (damage === "missing-issuer") delete state.issuer;
        else if (damage === "wrong-branch") state.issuer.locationId = crypto.randomUUID();
        else state.issuer = false;
        store.put(state);
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  });
  expect(await h.module.rubberNumberingReady(branch)).toBe(false);
  await h.module.prepareRubberBillIssuer(branch);
  const next = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(next), next)).bill.localBillNo).toBe("0001-261031-D02");
  const queued = await new Promise<unknown[]>((resolve, reject) => {
    const request = h.browser.indexedDB.open("lanflow_sync_db"); request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result, tx = db.transaction("sync_queue"), read = tx.objectStore("sync_queue").getAll();
      read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); };
  });
  expect(queued[0]).toEqual(saved.event);
});
test("date counters resume independently and a different branch requires its own registration", async () => {
  const h = harness(); await h.module.prepareRubberBillIssuer(branch);
  const first = bill(); await h.module.enqueueNumberedRubberCreate(event(first), first);
  const yesterday = { ...bill(), billDate: "2026-10-30" };
  expect((await h.module.enqueueNumberedRubberCreate(event(yesterday), yesterday)).bill.localBillNo).toBe("0001-261030-D01");
  const next = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(next), next)).bill.localBillNo).toBe("0002-261031-D01");
  const otherBranch = crypto.randomUUID();
  expect(await h.module.rubberNumberingReady(otherBranch)).toBe(false);
  await h.module.prepareRubberBillIssuer(otherBranch);
  const other = { ...bill(), locationId: otherBranch };
  expect((await h.module.enqueueNumberedRubberCreate({ ...event(other), locationId: otherBranch }, other)).bill.billNumbering?.sequence).toBe(1);
});
test("replacement changes only new bills, preserving queued old numbers", async () => {
  const h = harness(); await h.module.prepareRubberBillIssuer(branch);
  const b = bill(), original = await h.module.enqueueNumberedRubberCreate(event(b), b);
  h.replace(); await h.module.prepareRubberBillIssuer(branch, true);
  const next = bill(), replacement = await h.module.enqueueNumberedRubberCreate(event(next), next);
  expect(original.event.payload.localBillNo).toBe("0001-261031-D01");
  expect(replacement.bill.localBillNo).toBe("0001-261031-D02");
  expect(original.event.payload.billNumbering.issuerId).not.toBe(replacement.bill.billNumbering?.issuerId);
});
test("missing allocator root receives a new registration rather than resetting the old code", async () => {
  const h = harness(); await h.module.prepareRubberBillIssuer(branch);
  const old = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(old), old)).bill.localBillNo).toContain("D01");
  h.browser.indexedDB = new IDBFactory();
  expect(await h.module.rubberNumberingReady(branch)).toBe(false);
  await h.module.prepareRubberBillIssuer(branch);
  const next = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(next), next)).bill.localBillNo).toBe("0001-261031-D02");
});
test("an older registration response cannot downgrade a replacement or its counter", async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const h = harness(async call => { if (call === 1) await held; });
  const first = h.module.prepareRubberBillIssuer(branch);
  await expect.poll(h.calls).toBe(1);
  h.replace(); const secondTab = h.newTab(); await secondTab.prepareRubberBillIssuer(branch, true);
  const b = bill(); expect((await secondTab.enqueueNumberedRubberCreate(event(b), b)).bill.localBillNo).toBe("0001-261031-D02");
  release(); await first;
  const next = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(next), next)).bill.localBillNo).toBe("0002-261031-D02");
});
test("a counter removed while its registration survives cannot reset an issued code", async () => {
  const h = harness(); await h.module.prepareRubberBillIssuer(branch);
  const b = bill(); await h.module.enqueueNumberedRubberCreate(event(b), b);
  await new Promise<void>((resolve, reject) => {
    const request = h.browser.indexedDB.open("lanflow_sync_db");
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("rubber_bill_numbers", "readwrite"), store = tx.objectStore("rubber_bill_numbers");
      const read = store.get(branch); read.onsuccess = () => { const row = read.result; row.counters = {}; store.put(row); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
  expect(await h.module.rubberNumberingReady(branch)).toBe(false);
  await h.module.prepareRubberBillIssuer(branch);
  const next = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(next), next)).bill.localBillNo).toBe("0001-261031-D02");
});
test("aborting the outbox commit rolls back the counter and reservation too", async () => {
  const h = harness(); await h.module.prepareRubberBillIssuer(branch);
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (...args) {
    const request = original.apply(this, args);
    if (this.name === "sync_queue") request.addEventListener("success", () => this.transaction.abort());
    return request;
  };
  try {
    const b = bill(); expect(await h.module.enqueueNumberedRubberCreate(event(b), b).then(() => false, () => true)).toBe(true);
  } finally { IDBObjectStore.prototype.add = original; }
  const next = bill(); expect((await h.module.enqueueNumberedRubberCreate(event(next), next)).bill.localBillNo).toBe("0001-261031-D01");
});
test("switching from the old layout continues at 0016 and leaves all old queued commands frozen", async () => {
  const h = harness(), oldTab = h.newTab(true);
  await oldTab.prepareRubberBillIssuer(branch);
  const old = [];
  for (let i = 0; i < 15; i++) { const b = bill(); old.push(await oldTab.enqueueNumberedRubberCreate(event(b), b)); }
  expect(old[14].bill.localBillNo).toBe("2610310015-D01");
  const next = bill(), saved = await h.module.enqueueNumberedRubberCreate(event(next), next);
  expect(saved.bill.localBillNo).toBe("0016-261031-D01");
  expect(saved.bill.billNumbering?.sequence).toBe(16);
  expect(saved.bill.billNumbering?.issuerId).toBe(old[14].bill.billNumbering?.issuerId);
  const queued = await new Promise<unknown[]>((resolve, reject) => {
    const request = h.browser.indexedDB.open("lanflow_sync_db");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("sync_queue"), read = tx.objectStore("sync_queue").getAll();
      read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close();
    };
  });
  expect(queued.slice(0, 15)).toEqual(old.map(result => result.event));
  expect(h.calls()).toBe(1);
});
for (const base of ["2610310001-D01", "0001-261031-D01"]) test(`PDF preserves ${base} before sync and its final in cache and edits`, () => {
  const b: RubberBill = { ...bill(), localBillNo: base, billNo: base, recordStatus: "active", netTotal: 1,
    billNumbering: { version: 1 as const, issuerId: crypto.randomUUID(), date: "2026-10-31", sequence: 1 }, weighItems: [{ id: "1", label: "1", inWeight: 1, outWeight: 0, netWeight: 1, price: 1 }] };
  expect(buildRubberBillReceiptModel(b)).toMatchObject({ referenceLabel: "เลขที่บิล", referenceNo: b.localBillNo, localReferenceNo: undefined });
  const synced = { ...b, syncStatus: "synced" as const, serverBillNo: `${b.localBillNo}-1`, billNo: `${b.localBillNo}-1`, revisionNo: 1, serverCreatedAt: new Date().toISOString() };
  const old = buildRubberBillReceiptModel(b);
  expect(renderRubberBillReceiptHtml(old)).toContain("รอเลขท้ายจากส่วนกลาง");
  const confirmed = resolveRubberBillReceiptForPrint(synced, { revisionNo: 1, receipt: old }, false);
  expect(confirmed.referenceNo).toBe(synced.serverBillNo);
  expect(renderRubberBillReceiptHtml(confirmed)).not.toContain("รอเลขท้ายจากส่วนกลาง");
  const edited = immediateRubberReceipt(synced, { locationId: branch, effectivePriceCap: 40, editWindowMinutes: 60,
    priceRuleRevision: 1, centralPrice: 40, priceAllowance: 0, ruleSource: "ungrouped", groupId: null, nonCurrentDateRequiresApproval: false });
  expect(edited).not.toBeNull();
  expect(buildRubberBillReceiptModel(edited!).referenceNo).toBe(synced.serverBillNo);
  expect(buildRubberBillReceiptModel(edited!).finalNumberPending).toBe(false);
});
