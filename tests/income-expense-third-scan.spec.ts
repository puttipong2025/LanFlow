import { expect, test } from "@playwright/test";
import { QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import type { IncomeExpense } from "../src/types";
import { buildIncomeExpensePayload } from "../src/lib/income-expense/build-income-expense-payload";
import { loadSourceModule } from "./helpers/load-source-module";

const owner = "cf000000-0000-4000-8000-000000000001", branch = "cf000000-0000-4000-8000-000000000002";
function sale(synced: boolean): IncomeExpense {
  const clientTempId = crypto.randomUUID();
  return { id: synced ? crypto.randomUUID() : clientTempId, clientTempId,
    localBillNo: "SALE-1", ...(synced ? { serverBillNo: "SALE-1-1" } : {}),
    syncStatus: synced ? "synced" : "pending", idempotencyKey: `create:${clientTempId}:0`,
    locationId: branch, type: "income", number: "1", txDate: "2026-11-01",
    title: "บิลขาย", cost: 10, billOption: "บิลขาย", saleLines: [],
    createdByUserId: owner, createdByName: "test", createdByPhone: "0800000000",
    clientCreatedAt: "2026-11-01T00:00:00Z", clientRecordedAt: "2026-11-01T00:00:00Z",
    revisionNo: synced ? 1 : 0, recordStatus: "active" };
}

for (const action of ["save", "delete"] as const) {
  for (const concurrent of [false, true]) test(`sale ${action} rechecks an empty queue, concurrent=${concurrent}`, async () => {
    const browser = { indexedDB: new IDBFactory() }, q = new QueryClient(), row = sale(action === "delete");
    const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: browser });
    const scope = { entity: "income_expense" as const, ownerUserId: owner, locationId: branch };
    const operation = action === "delete" ? "update" : "create";
    const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
      "@tanstack/react-query": { useQueryClient: () => q, useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
      "@/hooks/useIncomeExpenseOperationalList": { useIncomeExpenseOperationalList: () => ({ rows: [row] }) },
      "@/lib/idb-queue": { ...queue, getPendingEvents: async (...args: Parameters<typeof queue.getPendingEvents>) => {
        const snapshot = await queue.getPendingEvents(...args);
        if (concurrent) await queue.enqueueSyncEvent({ ...scope, id: row.clientTempId, operation,
          payload: buildIncomeExpensePayload(row, operation), timestamp: 1, status: "pending", serverSubmissionAttempted: true });
        return snapshot;
      } },
    }, { window: browser, navigator: { onLine: true } });
    const actions = hook.useIncomeExpense(branch, owner);
    const result = await (action === "save" ? actions.addTransaction({ ...row, cost: 20 })
      : actions.deleteTransaction({ clientTempId: row.clientTempId, deletedByName: "test", deletedByPhone: "0800000000" }))
      .then(() => "accepted", error => error.message);
    const current = await queue.getPendingEvents(scope);
    expect(current).toHaveLength(1);
    if (concurrent) {
      expect(result).not.toBe("accepted");
      expect(current[0]).toMatchObject({ operation, serverSubmissionAttempted: true, payload: { cost: 10 } });
    } else { expect(result).toBe("accepted"); expect(current[0].operation).toBe(action === "save" ? "create" : "delete"); }
    q.clear();
  });
}

for (const action of ["save", "cancel", "delete"] as const) {
  for (const concurrent of [false, true]) test(`sale ${action} preserves an in-flight command, concurrent=${concurrent}`, async () => {
    const browser = { indexedDB: new IDBFactory() }, q = new QueryClient(), row = sale(action === "delete");
    const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: browser });
    const operation = action === "delete" ? "update" : "create";
    await queue.enqueueSyncEvent({ entity: "income_expense", id: row.clientTempId, ownerUserId: owner,
      locationId: branch, operation, status: "pending", timestamp: 1, serverSubmissionAttempted: false,
      payload: buildIncomeExpensePayload(row, operation) });
    const scope = { entity: "income_expense" as const, ownerUserId: owner, locationId: branch };
    const initial = await queue.getPendingEvents(scope);
    const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
      "@tanstack/react-query": { useQueryClient: () => q, useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
      "@/hooks/useIncomeExpenseOperationalList": { useIncomeExpenseOperationalList: () => ({ rows: [row], refresh: async () => {} }) },
      "@/lib/idb-queue": { ...queue, getPendingEvents: async (...args: Parameters<typeof queue.getPendingEvents>) => {
        const snapshot = await queue.getPendingEvents(...args);
        if (concurrent) await queue.updateSyncEvent({ ...snapshot[0], serverSubmissionAttempted: true });
        return snapshot;
      } },
    }, { window: browser, navigator: { onLine: true } });
    const actions = hook.useIncomeExpense(branch, owner);
    const result = await (action === "save"
      ? actions.addTransaction({ ...row, title: "changed", cost: 20 })
      : actions.deleteTransaction({ clientTempId: row.clientTempId, deletedByName: "test", deletedByPhone: "0800000000" }))
      .then(() => "accepted", error => error.message);
    const current = await queue.getPendingEvents(scope);
    if (concurrent) {
      expect(result).not.toBe("accepted");
      expect(current).toEqual([{ ...initial[0], serverSubmissionAttempted: true }]);
    } else {
      expect(result).toBe("accepted");
      if (action === "cancel") expect(current).toHaveLength(0);
      else expect(current).toMatchObject([{ operation: action === "save" ? "create" : "delete",
        payload: { ...(action === "save" ? { title: "changed", cost: 20 } : { recordStatus: "deleted", expectedRevisionNo: 1 }) } }]);
    }
    q.clear();
  });
}
