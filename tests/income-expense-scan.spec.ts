import { test, expect } from "@playwright/test";
import { QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { loadSourceModule } from "./helpers/load-source-module";
import { isCanonicalDate } from "../src/lib/income-expense/feed-cursor";
import { isIncomeExpenseSubmission } from "../src/lib/income-expense/contracts";
import type { SyncEvent } from "../src/lib/idb-queue";

const owner = "be000000-0000-4000-8000-000000000001", branch = "be000000-0000-4000-8000-000000000002";
function event(operation: "create" | "update" | "delete" = "create", status: "pending" | "failed" = "pending"): SyncEvent {
  const id = crypto.randomUUID(), revision = operation === "create" ? 0 : 1;
  return { entity: "income_expense", ownerUserId: owner, locationId: branch, id, operation, status,
    timestamp: 1, serverSubmissionAttempted: false, payload: { operation, clientTempId: id,
      expectedRevisionNo: revision, idempotencyKey: `${operation}:${id}:${revision}`, locationId: branch,
      localBillNo: "LEGACY-SCAN", type: "expense", billOption: "ค่าใช้จ่าย", txDate: "2026-11-01",
      title: "scan fixture", cost: 10, recordStatus: operation === "delete" ? "deleted" : "active",
      clientCreatedAt: "2026-11-01T00:00:00Z", clientRecordedAt: "2026-11-01T00:00:00Z" } };
}
function harness() {
  const browser = { indexedDB: new IDBFactory() }, q = new QueryClient();
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: browser });
  const scope = { entity: "income_expense" as const, ownerUserId: owner, locationId: branch };
  return { browser, q, queue, scope };
}

test("date validator rejects impossible dates without throwing and accepts leap-day controls", () => {
  expect(isCanonicalDate("2024-02-29")).toBe(true);
  expect(isCanonicalDate("2026-02-29")).toBe(false);
  for (const date of ["2026-13-01", "2026-00-10", "2026-01-32", "0000-01-01"]) expect(isCanonicalDate(date)).toBe(false);
});

for (const target of ["sync", "background", "approval"] as const) test(`${target} invalid calendar is HTTP 400 before any RPC`, async () => {
  let calls = 0;
  const file = target === "sync" ? "src/app/api/lanflow/income-expense/route.ts"
    : target === "background" ? "src/app/api/lanflow/income-expense/background/route.ts"
    : "src/app/api/lanflow/income-expense/approval-requests/route.ts";
  const route = loadSourceModule<{ POST: (request: Request) => Promise<Response> }>(file, {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { sub: owner },
      supabase: { rpc: async () => { calls++; return { data: null, error: null }; } } }) },
  });
  expect(isIncomeExpenseSubmission(event().payload)).toBe(true);
  for (const txDate of ["2026-13-01", "2026-00-10", "2026-01-32", "0000-01-01"]) {
    const response = await route.POST(new Request("http://local/sync", { method: "POST", body: JSON.stringify({ ...event().payload, txDate }) }));
    expect(response.status).toBe(400);
  }
  expect(calls).toBe(0);
});

for (const mode of ["main", "manual"] as const) for (const reply of ["empty", "wrong-revision", "failed-200", "valid"] as const) {
  test(`${mode} legacy sender retains unconfirmed work: ${reply}`, async () => {
    const h = harness(), queued = event("update", mode === "manual" ? "failed" : "pending");
    await h.queue.enqueueSyncEvent(queued);
    const result = reply === "empty" ? {} : reply === "failed-200" ? { status: "failed", errorMessage: "ยังไม่บันทึก" } : { status: "synced", id: crypto.randomUUID(), serverBillNo: "FINAL",
      revisionNo: reply === "valid" ? 2 : 1, serverReceivedAt: "2026-11-01T00:00:00Z" };
    const dependencies = {
      "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => Response.json(result) },
      ...(mode === "manual" ? { "@tanstack/react-query": { useQueryClient: () => h.q,
        useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) } } : {}),
    };
    if (mode === "main") {
      const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", dependencies,
        { window: h.browser, navigator: { onLine: true } });
      await hook.syncPendingIncomeExpense(h.q, owner, branch);
    } else {
      const hook = loadSourceModule<typeof import("../src/hooks/usePerRecordSyncRetry")>("src/hooks/usePerRecordSyncRetry.ts", dependencies,
        { window: h.browser, navigator: { onLine: true } });
      await hook.usePerRecordSyncRetry(branch, owner).retrySyncEvent({ entity: "income_expense", id: queued.id }).catch(() => {});
    }
    const remaining = await h.queue.getPendingEvents(h.scope);
    if (reply === "valid") expect(remaining).toHaveLength(0);
    else { expect(remaining).toHaveLength(1); expect(remaining[0].payload).toEqual(queued.payload); }
    h.q.clear();
  });
}

test("stale queue coalescing cannot recreate a cancelled pair of pending creates", async () => {
  const h = harness(), original = event();
  await h.queue.enqueueSyncEvent(original); await h.queue.enqueueSyncEvent({ ...original, timestamp: 2 });
  const cancel = loadSourceModule<typeof import("../src/lib/income-expense/cancel-local-create")>("src/lib/income-expense/cancel-local-create.ts", {}, { window: h.browser });
  let firstRead = true, posts = 0;
  const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
    "@/lib/idb-queue": { ...h.queue, getPendingEvents: async (...args: Parameters<typeof h.queue.getPendingEvents>) => {
      const rows = await h.queue.getPendingEvents(...args);
      if (firstRead) { firstRead = false; await cancel.cancelUnsubmittedIncomeCreate(rows); }
      return rows;
    } },
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true,
      authFetch: async () => { posts++; return Response.json({}, { status: 503 }); } },
  }, { window: h.browser, navigator: { onLine: true } });
  await hook.syncPendingIncomeExpense(h.q, owner, branch);
  expect(posts).toBe(0); expect(await h.queue.getPendingEvents(h.scope)).toHaveLength(0);
  h.q.clear();
});

test("legacy manual retry cannot recreate work discarded after its snapshot was read", async () => {
  const h = harness(), original = event("update", "failed");
  await h.queue.enqueueSyncEvent(original);
  let posts = 0;
  const hook = loadSourceModule<typeof import("../src/hooks/usePerRecordSyncRetry")>("src/hooks/usePerRecordSyncRetry.ts", {
    "@tanstack/react-query": { useQueryClient: () => h.q,
      useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
    "@/lib/idb-queue": { ...h.queue, getPendingEvents: async (...args: Parameters<typeof h.queue.getPendingEvents>) => {
      const rows = await h.queue.getPendingEvents(...args);
      await h.queue.reconcileSyncEventsIfCurrent(rows, undefined, true);
      return rows;
    } },
    "@/lib/auth-fetch": { authFetch: async () => { posts++; return Response.json({}, { status: 503 }); } },
  }, { window: h.browser, navigator: { onLine: true } });
  await hook.usePerRecordSyncRetry(branch, owner).retrySyncEvent({ entity: "income_expense", id: original.id }).catch(() => {});
  expect(posts).toBe(0); expect(await h.queue.getPendingEvents(h.scope)).toHaveLength(0);
});

test("a late legacy acknowledgement cannot delete a newer command in the same outbox slot", async () => {
  const h = harness(), original = event("update");
  await h.queue.enqueueSyncEvent(original);
  const [snapshot] = await h.queue.getPendingEvents(h.scope);
  const newer = { ...snapshot, timestamp: 2, payload: { ...snapshot.payload, title: "newer intent" } };
  const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => {
      await h.queue.updateSyncEvent(newer);
      return Response.json({ status: "synced", id: crypto.randomUUID(), serverBillNo: "FINAL", revisionNo: 2,
        serverReceivedAt: "2026-11-01T00:00:00Z" });
    } },
  }, { window: h.browser, navigator: { onLine: true } });
  await hook.syncPendingIncomeExpense(h.q, owner, branch);
  expect(await h.queue.getPendingEvents(h.scope)).toMatchObject([{ payload: { title: "newer intent" } }]);
});
