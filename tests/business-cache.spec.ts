import { expect, test } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";
import { getSyncDb } from "../src/lib/idb-core";
import * as idbCore from "../src/lib/idb-core";
import { getRubberBillReceiptSnapshots, putRubberBillReceiptSnapshots } from "../src/lib/rubber-bill-receipts-idb";
import { rubberBillFromSyncEvent } from "../src/lib/rubber-bills/local-feed";
import type { RubberBillReceiptSnapshot } from "../src/lib/rubber-bill-receipts-idb";
import { buildRubberBillReceiptModel } from "../src/components/rubber-bills/bill-display";
import { commitCacheRefresh, readCacheMetadata } from "../src/lib/business-cache/storage";
import { validateReceiptChecks } from "../src/lib/business-cache/protocol";
import { enqueueSyncEvent, getPendingEvents } from "../src/lib/idb-queue";
import { loadSourceModule } from "./helpers/load-source-module";

export function snapshot(id = "00000000-0000-4000-8000-000000000001"): RubberBillReceiptSnapshot {
  const bill = rubberBillFromSyncEvent({ id, entity: "rubber_bills", operation: "create", ownerUserId: "owner",
    locationId: "branch", timestamp: 0, status: "pending", payload: { clientTempId: id, billDate: "2026-10-30",
      clientRecordedAt: "2026-10-30T00:00:00Z", clientCreatedAt: "2026-10-30T00:00:00Z" } }, "owner")!;
  Object.assign(bill, { id, locationId: "branch", serverBillNo: "RB1", revisionNo: 1, syncStatus: "synced" });
  return { billId: id, locationId: "branch", serverBillNo: "RB1", serverReceivedAt: "2026-10-30T00:00:00Z",
    revisionNo: 1, bill, receipt: buildRubberBillReceiptModel(bill) };
}

test.beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
});

test("controlled legacy snapshot remains available offline without positive deletion reconciliation", async () => {
  const old = snapshot();
  await putRubberBillReceiptSnapshots([old]);
  // Another device deleted the bill; a paged empty feed alone cannot prove that locally.
  await putRubberBillReceiptSnapshots([]);
  expect((await getRubberBillReceiptSnapshots("branch")).map(row => row.billId)).toEqual([old.billId]);
});

test("cache protocol fences legacy version-7 writers without deleting existing stores", async () => {
  const old = snapshot();
  await putRubberBillReceiptSnapshots([old]);
  const db = await getSyncDb();
  expect(db.objectStoreNames.contains("business_cache_meta")).toBe(true);
  db.close();
  await expect(new Promise((resolve, reject) => {
    const request = indexedDB.open("lanflow_sync_db", 7);
    request.onsuccess = () => { request.result.close(); resolve(true); };
    request.onerror = () => reject(request.error);
  })).rejects.toThrow();
  expect(await getRubberBillReceiptSnapshots("branch")).toEqual([old]);
});

const meta = { key: "rubber:branch", version: 1, updatedAt: "2026-10-30T01:00:00Z" };

test("positive deletion repairs a legacy snapshot, commits its version, and blocks stale writes", async () => {
  const old = snapshot();
  await putRubberBillReceiptSnapshots([old]);
  await enqueueSyncEvent({ id: "unsent", entity: "rubber_bills", ownerUserId: "owner", locationId: "branch",
    operation: "create", timestamp: 0, status: "failed", payload: { customerName: "retain me" } });
  await commitCacheRefresh(meta, [old], [{ billId: old.billId, state: "deleted", revisionNo: 2 }], "branch");
  await putRubberBillReceiptSnapshots([old]);
  expect(await getRubberBillReceiptSnapshots("branch")).toEqual([]);
  expect(await readCacheMetadata(meta.key)).toEqual(meta);
  expect((await getPendingEvents({ entity: "rubber_bills", ownerUserId: "owner", locationId: "branch" }))[0].payload.customerName).toBe("retain me");
});

test("incomplete, unknown, wrong branch, and older revisions preserve both cache and version", async () => {
  const old = snapshot(); await putRubberBillReceiptSnapshots([old]);
  for (const checks of [[], [{ billId: old.billId, state: "unknown" }],
    [{ billId: old.billId, state: "active", snapshot: { ...old, locationId: "other" } }],
    [{ billId: old.billId, state: "deleted", revisionNo: 0 }]]) {
    expect(() => validateReceiptChecks(checks, [old], "branch")).toThrow();
  }
  expect(await getRubberBillReceiptSnapshots("branch")).toEqual([old]);
  expect(await readCacheMetadata(meta.key)).toBeNull();
});

test("concurrent receipt update aborts the entire batch and never commits a misleading version", async () => {
  const a = snapshot(), b = snapshot("00000000-0000-4000-8000-000000000002");
  await putRubberBillReceiptSnapshots([a, b]);
  const newer = { ...b, revisionNo: 3, bill: { ...b.bill, revisionNo: 3 } };
  await putRubberBillReceiptSnapshots([newer]);
  await expect(commitCacheRefresh(meta, [a, b], [
    { billId: a.billId, state: "deleted", revisionNo: 2 }, { billId: b.billId, state: "deleted", revisionNo: 2 },
  ], "branch")).rejects.toThrow();
  expect((await getRubberBillReceiptSnapshots("branch")).map(row => row.billId).sort()).toEqual([a.billId, b.billId].sort());
  expect(await readCacheMetadata(meta.key)).toBeNull();
});

test("aborted refresh and duplicate IDs never change receipts", async () => {
  const old = snapshot(); await putRubberBillReceiptSnapshots([old]);
  const signal = new AbortController(); signal.abort();
  await expect(commitCacheRefresh(meta, [old], [{ billId: old.billId, state: "deleted", revisionNo: 2 }], "branch", signal.signal)).rejects.toThrow();
  expect(() => validateReceiptChecks([{ billId: old.billId, state: "deleted", revisionNo: 2 },
    { billId: old.billId, state: "deleted", revisionNo: 2 }], [old, snapshot("other")], "branch")).toThrow();
  expect(await getRubberBillReceiptSnapshots("branch")).toEqual([old]);
});

test("an authoritative empty scope can commit without touching another branch", async () => {
  const old = snapshot(); await putRubberBillReceiptSnapshots([old]);
  await commitCacheRefresh({ ...meta, key: "rubber:empty-branch" });
  expect(await getRubberBillReceiptSnapshots("branch")).toEqual([old]);
});

test("a slow older repair cannot overwrite a newer version committed by another tab", async () => {
  const receipt = snapshot();
  await putRubberBillReceiptSnapshots([receipt]);
  const newer = { ...meta, version: 3 };
  await commitCacheRefresh(newer);
  await expect(commitCacheRefresh({ ...meta, version: 2 }, [receipt],
    [{ billId: receipt.billId, state: "deleted", revisionNo: 2 }], "branch")).rejects.toThrow();
  expect(await readCacheMetadata(meta.key)).toEqual(newer);
  expect(await getRubberBillReceiptSnapshots("branch")).toEqual([receipt]);
});

test("malformed batch JSON returns a client error without querying storage", async () => {
  let calls = 0;
  const api = loadSourceModule<typeof import("../src/app/api/lanflow/business-cache/route")>("src/app/api/lanflow/business-cache/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { locationIds: [] }, supabase: {
      rpc: () => { calls++; },
    } }) },
  });
  const response = await api.POST(new Request("http://localhost", { method: "POST", body: "{" }));
  expect(response.status).toBe(400);
  expect(calls).toBe(0);
});

test("business cache routes reject other branches and oversized batches before reading data", async () => {
  let reads = 0;
  const api = loadSourceModule<typeof import("../src/app/api/lanflow/business-cache/route")>("src/app/api/lanflow/business-cache/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { locationIds: [] }, supabase: { from: () => { reads++; } } }) },
  });
  const branch = "00000000-0000-4000-8000-000000000003";
  expect((await api.GET(new Request(`http://localhost/api/lanflow/business-cache?locationId=${branch}`))).status).toBe(403);
  expect((await api.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ locationId: branch, ids: Array(101).fill(branch) }) }))).status).toBe(400);
  expect(reads).toBe(0);
});

test("business cache routes contain unexpected auth transport failures without leaking diagnostics", async () => {
  const api = loadSourceModule<typeof import("../src/app/api/lanflow/business-cache/route")>("src/app/api/lanflow/business-cache/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => { throw new Error("private diagnostic"); } },
  });
  for (const response of [await api.GET(new Request("http://localhost")),
    await api.POST(new Request("http://localhost", { method: "POST", body: "{}" }))]) {
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private diagnostic");
  }
});

test("cache reads preserve live permission denial instead of reporting a service outage", async () => {
  const branch = "00000000-0000-4000-8000-000000000003";
  let code = "42501";
  const auth = { requireAuth: async () => ({ ok: true, auth: { locationIds: [branch] }, supabase: {
    rpc: async () => ({ data: null, error: { code, message: "private diagnostic" } }),
  } }) };
  const api = loadSourceModule<typeof import("../src/app/api/lanflow/business-cache/route")>("src/app/api/lanflow/business-cache/route.ts", {
    "@/lib/server/auth": auth,
  });
  const settings = loadSourceModule<typeof import("../src/app/api/lanflow/business-cache/settings/route")>("src/app/api/lanflow/business-cache/settings/route.ts", {
    "@/lib/server/auth": auth,
  });
  const request = () => new Request(`http://localhost/api/lanflow/business-cache?locationId=${branch}`);
  for (const [errorCode, status] of [["08006", 503], ["42501", 403]] as const) {
    code = errorCode;
    const responses = [await api.GET(request()), await settings.GET(request()), await api.POST(new Request("http://localhost", {
      method: "POST", body: JSON.stringify({ locationId: branch, ids: [snapshot().billId] }),
    }))];
    for (const response of responses) {
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(JSON.stringify(await response.json())).not.toContain("private diagnostic");
    }
  }
});

test("batch route distinguishes positive deletion from an invisible or missing row", async () => {
  const id = snapshot().billId;
  const branch = "00000000-0000-4000-8000-000000000003";
  const missing = "00000000-0000-4000-8000-000000000004";
  const api = loadSourceModule<typeof import("../src/app/api/lanflow/business-cache/route")>("src/app/api/lanflow/business-cache/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { locationIds: [branch] }, supabase: {
      rpc: async () => ({ data: [{ id, record_status: "deleted", revision_no: 2 }], error: null }),
    } }) },
  });
  const response = await api.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ locationId: branch, ids: [id, missing] }) }));
  expect((await response.json()).checks).toEqual([{ billId: id, state: "deleted", revisionNo: 2 }, { billId: missing, state: "unknown" }]);
});

test("receipt repair uses server-decorated approval/relation restrictions and rebuilds its matching receipt", async () => {
  const old = snapshot();
  old.bill.approvalPending = true; old.bill.approvalRequestId = "request";
  old.bill.reportLockNo = "REPORT-LOCK"; old.bill.transferLockId = "transfer";
  await putRubberBillReceiptSnapshots([old]);
  const active = { ...snapshot(), revisionNo: 2, bill: { ...old.bill, revisionNo: 2 } };
  await commitCacheRefresh(meta, [old], [{ billId: old.billId, state: "active", snapshot: active }], "branch");
  const [saved] = await getRubberBillReceiptSnapshots("branch");
  expect(saved.bill.approvalPending).toBe(true); expect(saved.bill.reportLockNo).toBe("REPORT-LOCK");
  expect(saved.bill.transferLockId).toBe("transfer"); expect(saved.receipt).toEqual(buildRubberBillReceiptModel(saved.bill));
});

test("prune cannot delete a receipt updated after its initial read", async () => {
  const old = snapshot(); await putRubberBillReceiptSnapshots([old]);
  let calls = 0;
  const source = loadSourceModule<typeof import("../src/lib/rubber-bill-receipts-idb")>("src/lib/rubber-bill-receipts-idb.ts", {
    "@/lib/idb-core": { ...idbCore, getSyncDb: async () => {
      if (++calls === 2) await putRubberBillReceiptSnapshots([{ ...old, revisionNo: 2, bill: { ...old.bill, revisionNo: 2 } }]);
      return getSyncDb();
    } },
  });
  await source.pruneRubberBillReceiptSnapshots("branch", 0);
  expect((await getRubberBillReceiptSnapshots("branch"))[0].revisionNo).toBe(2);
});
