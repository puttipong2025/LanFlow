import { expect, test } from "@playwright/test";
import { NextRequest, NextResponse } from "next/server";
import { loadSourceModule } from "../helpers/load-source-module";
import { CASH_COUNT_OVERDUE_CODE, parseCashCountLocks } from "../../src/lib/cash-count-lock";
import { isCashCountLockSyncResponse, isRetryableSyncResponse } from "../../src/lib/sync-response";
import type { SyncEvent } from "../../src/lib/idb-queue";

const id = "cc260000-0000-4000-8000-000000000011";
test("group routes hide database diagnostics and preserve permission failures", async () => {
  for (const { error, status, publicMessage } of [
    { error: { code: "XX000", message: "internal connection diagnostic secret" }, status: 503, publicMessage: false },
    { error: { code: "P0001", message: "unexpected private diagnostic" }, status: 503, publicMessage: false },
    { error: { code: "P0001", message: "FORBIDDEN" }, status: 403, publicMessage: false },
    { error: { code: "P0001", message: "ไม่พบกลุ่ม" }, status: 404, publicMessage: true },
    { error: { code: "P0001", message: "สาขาอยู่ในกลุ่มอื่นแล้ว กรุณานำออกจากกลุ่มเดิมก่อน" }, status: 409, publicMessage: true },
    { error: { code: "23514", message: "private constraint detail" }, status: 400, publicMessage: false },
  ]) {
    const route = loadSourceModule<{ GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response>; DELETE: (r: Request) => Promise<Response> }>("src/app/api/lanflow/cash-count-alert/groups/route.ts", {
      "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true, supabase: { rpc: async () => ({ data: null, error }) } }) },
    });
    const responses = [
      await route.GET(new Request("http://localhost")),
      await route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ locationIds: [id], dueDays: 2 }) })),
      await route.DELETE(new Request(`http://localhost?id=${id}`, { method: "DELETE" })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(status);
      const body = JSON.stringify(await response.json());
      if (publicMessage) expect(body).toContain(error.message);
      else expect(body).not.toContain(error.message);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
  }
});
test("only the dedicated business lock 409 is retryable", () => {
  expect(isRetryableSyncResponse(409, { errorCode: CASH_COUNT_OVERDUE_CODE })).toBe(true);
  for (const body of [{}, null, { errorCode: "CONFLICT" }]) expect(isRetryableSyncResponse(409, body)).toBe(false);
  expect(isRetryableSyncResponse(400, { errorCode: CASH_COUNT_OVERDUE_CODE })).toBe(false);
  expect(isRetryableSyncResponse(503)).toBe(true);
});
test("lock parser rejects missing or ambiguous permission and time data", () => {
  const state = { locationId: id, locationName: "A", groupId: id, enabled: true, locked: true,
    dueDate: "2026-10-26", lockAt: "2026-10-27T01:00:00Z", unlockedUntil: null, unlockedAt: null,
    unlockedByName: null, canUnlock: false, contacts: [{ id, name: "Manager" }] };
  const body = { states: [state], serverNow: "2026-10-27T02:00:00Z" };
  expect(parseCashCountLocks(body)).toEqual(body);
  for (const patch of [{ locked: "true" }, { canUnlock: null }, { lockAt: "invalid" }, { contacts: [{}] }]) {
    expect(parseCashCountLocks({ ...body, states: [{ ...state, ...patch }] })).toBeNull();
  }
});
test("lock endpoint preserves role denial, validates scope and hides transport diagnostics", async () => {
  const route = loadSourceModule<{ GET: (r: NextRequest) => Promise<Response>; POST: (r: Request) => Promise<Response> }>("src/app/api/lanflow/cash-counts/lock/route.ts", {
    "@/lib/server/auth": {
      requireSystemManager: async () => ({ ok: false, response: NextResponse.json({ error: "denied" }, { status: 403 }) }),
      requireAuth: async () => ({ ok: true, supabase: { rpc: async () => { throw new Error("private diagnostic"); } } }),
    },
  });
  expect((await route.POST(new Request("http://localhost", { method: "POST" }))).status).toBe(403);
  expect((await route.GET(new NextRequest("http://localhost?locationId=bad"))).status).toBe(400);
  const response = await route.GET(new NextRequest("http://localhost"));
  expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(JSON.stringify(await response.json())).not.toContain("private");
});
test("legacy settings omissions are forwarded as null, explicit false is retained", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const route = loadSourceModule<{ POST: (r: Request) => Promise<Response> }>("src/app/api/lanflow/cash-count-alert/groups/route.ts", {
    "@/lib/server/auth": { requireSystemManager: async () => ({ ok: true, supabase: { rpc: async (_name: string, args: Record<string, unknown>) => { calls.push(args); return { data: { id }, error: null }; } } }) },
  });
  const send = (patch: Record<string, unknown>) => route.POST(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, locationIds: [id], dueDays: 2, ...patch }) }));
  expect((await send({})).status).toBe(200);
  expect(calls[0]).toMatchObject({ p_lock_enabled: null, p_grace_hours: null, p_unlock_hours: null });
  expect((await send({ lockEnabled: false })).status).toBe(200); expect(calls[1].p_lock_enabled).toBe(false);
  for (const patch of [{ lockEnabled: null }, { graceHours: 0 }, { graceHours: 49 }, { unlockHours: 1.5 }, { unlockHours: null }]) expect((await send(patch)).status).toBe(400);
  expect(calls).toHaveLength(2);
});
test("all financial response mappers preserve the dedicated lock contract", () => {
  for (const [file, exported] of [
    ["src/lib/server/cash-branch-transfer-response.ts", "cashTransferErrorResponse"],
    ["src/lib/server/report-response.ts", "reportErrorResponse"],
    ["src/lib/server/rubber-export-response.ts", "rubberExportErrorResponse"],
  ]) {
    const module = loadSourceModule<Record<string, (message: string) => Response>>(file, { "@/lib/server/auth": {} });
    expect(module[exported](`${CASH_COUNT_OVERDUE_CODE}: safe business error`).status).toBe(409);
  }
});
for (const entity of ["income_expense", "rubber_bills"] as const) {
  test(`${entity} retains the same queued command during lock and removes it once after unlock`, async () => {
    let event: SyncEvent | null = { queueId: 1, id: "command", entity, ownerUserId: "owner", locationId: id,
      operation: "create", timestamp: 1, status: "pending", payload: { clientTempId: "command", locationId: id, cost: 100, localBillNo: "LOCAL-1" } };
    let locked = true; let writes = 0; let removed = 0;
    const hook = loadSourceModule<Record<string, (client: unknown, user: string, location: string) => Promise<unknown>>>(entity === "income_expense" ? "src/hooks/useIncomeExpense.ts" : "src/hooks/useRubberBills.ts", {
      "@tanstack/react-query": {},
      "@/hooks/useIncomeExpenseOperationalList": {},
      "@/lib/income-expense/build-income-expense-payload": {},
      "@/lib/rubber-bills/approval": {}, "@/lib/rubber-bills/submission": {}, "@/lib/rubber-bills/feed-cache": {},
      "@/lib/coalesceQueueGroup": {},
      "@/lib/idb-queue": {
        getPendingEvents: async () => event ? [structuredClone(event)] : [],
        updateSyncEvent: async (next: SyncEvent) => { event = structuredClone(next); },
        updateSyncEventIfCurrent: async (next: SyncEvent) => { event = structuredClone(next); return true; },
        reconcileSyncEventsIfCurrent: async (_expected: unknown, keeper: SyncEvent) => { event = structuredClone(keeper); return true; },
        removeSyncEvent: async () => { event = null; removed++; },
        removeSyncEventIfCurrent: async () => { event = null; removed++; return true; },
      },
      "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => {
        writes++;
        return locked ? Response.json({ status: "failed", errorCode: CASH_COUNT_OVERDUE_CODE, errorMessage: "temporary lock" }, { status: 409 })
          : Response.json({ status: "synced", id: "saved", serverBillNo: "SAVED-1", revisionNo: 1 });
      } },
      "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => undefined },
    }, { navigator: { onLine: true } });
    const sync = hook[entity === "income_expense" ? "syncPendingIncomeExpense" : "syncPendingRubberBills"];
    const client = { cancelQueries: async () => undefined, setQueriesData: () => undefined };
    await sync(client, "owner", id);
    expect(event).toMatchObject({ id: "command", status: "pending", payload: { cost: 100 } });
    expect(removed).toBe(0);
    locked = false; await sync(client, "owner", id); await sync(client, "owner", id);
    expect(event).toBeNull(); expect(writes).toBe(2); expect(removed).toBe(1);
  });
}
test("manual retry keeps a lock-blocked command pending and preserves ordinary conflicts", async () => {
  for (const locked of [true, false]) {
    let event: SyncEvent = { queueId: 1, id: "command", entity: "income_expense", ownerUserId: "owner", locationId: id,
      operation: "create", timestamp: 1, status: "failed", payload: { cost: 100 } };
    const hook = loadSourceModule<{ usePerRecordSyncRetry: (location: string, owner: string) => { retrySyncEvent: (value: { entity: string; id: string }) => Promise<unknown> } }>("src/hooks/usePerRecordSyncRetry.ts", {
      "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (options: { mutationFn: (value: unknown) => Promise<unknown> }) => ({ mutateAsync: options.mutationFn }) },
      "@/lib/idb-queue": { getPendingEvents: async () => [event], updateSyncEvent: async () => undefined, updateSyncEventIfCurrent: async (next: SyncEvent) => { event = next; return true; } },
      "@/lib/sync-response": { isCashCountLockSyncResponse, isRetryableSyncResponse },
      "@/lib/auth-fetch": { authFetch: async () => Response.json({ status: locked ? "failed" : "conflict", errorCode: locked ? CASH_COUNT_OVERDUE_CODE : "CONFLICT", errorMessage: "retry denied" }, { status: 409 }) },
      "@/lib/money-flow/invalidation": { invalidateMoneyFlowLocation: async () => undefined }, "@/lib/rubber-bills/feed-cache": {},
    });
    const message = await hook.usePerRecordSyncRetry(id, "owner").retrySyncEvent({ entity: "income_expense", id: "command" })
      .then(() => null, (cause: Error) => cause.message);
    expect(message).toBe("retry denied");
    expect(event).toMatchObject({ status: locked ? "pending" : "conflict", queueId: 1, payload: { cost: 100 } });
  }
});
