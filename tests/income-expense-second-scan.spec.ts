import { expect, test } from "@playwright/test";
import { QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { loadSourceModule } from "./helpers/load-source-module";
import { confirmedIncomeExpenseBackgroundOutcome } from "../src/lib/income-expense/background-command";
import type { SyncEvent } from "../src/lib/idb-queue";

const owner = "bf000000-0000-4000-8000-000000000001", branch = "bf000000-0000-4000-8000-000000000002";
const serverId = "bf000000-0000-4000-8000-000000000003";
function command(numbered = false): SyncEvent {
  const id = crypto.randomUUID();
  return { entity: "income_expense", id, ownerUserId: owner, locationId: branch, serverId,
    operation: "update", status: "pending", timestamp: 1, serverSubmissionAttempted: false,
    payload: { contractVersion: 2, background: true, commandId: crypto.randomUUID(), actorUserId: owner,
      expectedServerId: serverId, expectedRevisionNo: 1, operation: "update", clientTempId: id,
      idempotencyKey: `update:${id}:1`, locationId: branch, localBillNo: numbered ? "E-0001-261101-D01" : "LEGACY",
      ...(numbered ? { billNumbering: { version: 1, issuerId: crypto.randomUUID(), date: "2026-11-01", sequence: 1 } } : {}),
      billOption: "ค่าใช้จ่าย", type: "expense", cost: 10, title: "second scan", recordStatus: "active",
      txDate: "2026-11-01", clientCreatedAt: "2026-11-01T00:00:00Z", clientRecordedAt: "2026-11-01T00:00:00Z" } };
}
function receipt(event: SyncEvent, patch: Record<string, unknown> = {}) {
  return { commandId: event.payload.commandId, actorUserId: owner, serverId, clientTempId: event.id,
    locationId: branch, operation: event.operation, localBillNo: event.payload.localBillNo,
    ...(event.payload.billNumbering ? { billNumbering: event.payload.billNumbering } : {}),
    outcome: "synced", status: "synced", id: serverId, serverBillNo: event.payload.localBillNo + "-1",
    revisionNo: 2, serverReceivedAt: "2026-11-01T00:00:00Z", ...patch };
}

test("background controls preserve real pending-to-approved replay and bound terminal outcomes", () => {
  for (const numbered of [false, true]) {
    const event = command(numbered);
    expect(confirmedIncomeExpenseBackgroundOutcome(event, receipt(event))).toBe("synced");
    for (const outcome of ["pending_approval", "synced"]) {
      expect(confirmedIncomeExpenseBackgroundOutcome(event, receipt(event, { outcome, status: "pending_approval",
        requestId: crypto.randomUUID(), matchedReasons: ["amount_threshold"] }))).toBe(outcome);
    }
    for (const outcome of ["deleted", "revision_conflict", "rejected"]) {
      expect(confirmedIncomeExpenseBackgroundOutcome(event, receipt(event, { outcome, status: undefined }))).toBe(outcome);
    }
  }
});

const invalid = [
  { status: undefined, revisionNo: undefined },
  { revisionNo: 3 },
  { status: "failed", errorMessage: "ยังไม่สำเร็จ" },
  { outcome: "pending_approval", status: "pending_approval", requestId: undefined },
  { outcome: "pending_approval", status: "synced" },
];
for (const numbered of [false, true]) for (const [index, patch] of invalid.entries()) {
  test(`background acknowledgement rejects contradictory/incomplete result ${index}, numbered=${numbered}`, () => {
    const event = command(numbered);
    expect(confirmedIncomeExpenseBackgroundOutcome(event, receipt(event, patch))).toBeNull();
  });
}

test("background route fails closed before publishing an incomplete legacy acknowledgement", async () => {
  const event = command();
  const route = loadSourceModule<typeof import("../src/app/api/lanflow/income-expense/background/route")>("src/app/api/lanflow/income-expense/background/route.ts", {
    "@/lib/server/auth": { requireAuth: async () => ({ ok: true, auth: { sub: owner },
      supabase: { rpc: async () => ({ data: receipt(event, { status: undefined, revisionNo: undefined }), error: null }) } }) },
  });
  const response = await route.POST(new Request("http://local/background", { method: "POST", body: JSON.stringify(event.payload) }));
  expect(response.status).toBe(503);
});

test("background worker retains a command when its HTTP-200 receipt has no business result", async () => {
  const browser = { indexedDB: new IDBFactory() }, q = new QueryClient(), event = command();
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: browser });
  await queue.enqueueSyncEvent(event);
  const worker = loadSourceModule<typeof import("../src/lib/income-expense/background-sync")>("src/lib/income-expense/background-sync.ts", {
    "./background-idb": loadSourceModule<typeof import("../src/lib/income-expense/background-idb")>("src/lib/income-expense/background-idb.ts", {}, { window: browser }),
    "@/lib/auth-fetch": { canSyncCurrentSession: async () => true,
      authFetch: async () => Response.json(receipt(event, { status: undefined, revisionNo: undefined })) },
  }, { window: browser, navigator: { onLine: true } });
  await worker.runIncomeExpenseBackground(q, owner);
  const rows = await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch });
  expect(rows).toMatchObject([{ id: event.id, serverSubmissionAttempted: true, status: "pending" }]);
  q.clear();
});

for (const concurrent of [false, true]) test(`discard rechecks the exact legacy queue before removal, concurrent=${concurrent}`, async () => {
  const browser = { indexedDB: new IDBFactory() }, q = new QueryClient();
  const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: browser });
  const original = command(), event = { ...original, status: "failed" as const,
    payload: { ...original.payload, background: undefined, contractVersion: undefined } };
  await queue.enqueueSyncEvent(event);
  const scope = { entity: "income_expense" as const, ownerUserId: owner, locationId: branch };
  const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
    "@tanstack/react-query": { useQueryClient: () => q, useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
    "@/hooks/useIncomeExpenseOperationalList": { useIncomeExpenseOperationalList: () => ({ rows: [], refresh: async () => {} }) },
    "@/lib/idb-queue": { ...queue, getPendingEvents: async (...args: Parameters<typeof queue.getPendingEvents>) => {
      const snapshot = await queue.getPendingEvents(...args);
      if (concurrent) await queue.updateSyncEvent({ ...snapshot[0], status: "pending", serverSubmissionAttempted: true });
      return snapshot;
    } },
  }, { window: browser, navigator: { onLine: true } });
  const result = await hook.useIncomeExpense(branch, owner).discardFailedTransaction(event.id).then(() => "discarded", error => error.message);
  if (concurrent) {
    expect(result).not.toBe("discarded");
    expect(await queue.getPendingEvents(scope)).toMatchObject([{ id: event.id, serverSubmissionAttempted: true }]);
  } else { expect(result).toBe("discarded"); expect(await queue.getPendingEvents(scope)).toHaveLength(0); }
  q.clear();
});
