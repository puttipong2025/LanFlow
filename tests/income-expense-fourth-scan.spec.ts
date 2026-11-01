import { test, expect } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";
import type { IncomeExpense } from "../src/types";
import { loadSourceModule } from "./helpers/load-source-module";

const branch = "df000000-0000-4000-8000-000000000001", owner = "df000000-0000-4000-8000-000000000002";
for (const status of ["synced", "pending_approval"] as const) for (const full of [false, true]) {
  test(`accepted create retry never requeues a confirmed handoff, status=${status}, full=${full}`, async () => {
    const browser = { indexedDB: new IDBFactory() }, globals = { window: browser, navigator: { onLine: false } };
    const issuer = loadSourceModule<typeof import("../src/lib/rubber-bills/numbering-idb")>("src/lib/rubber-bills/numbering-idb.ts", {
      "@/lib/auth-fetch": { assertApiResponse: async () => {}, authFetch: async (_url: string, init: RequestInit) => Response.json({
        version: 1, id: crypto.randomUUID(), code: "D01", locationId: branch, deviceId: JSON.parse(String(init.body)).generationId,
      }) },
    }, globals);
    await issuer.prepareRubberBillIssuer(branch);
    const load = <T,>(path: string) => loadSourceModule<T>(path, {}, globals);
    const numbers = load<typeof import("../src/lib/income-expense/numbering-idb")>("src/lib/income-expense/numbering-idb.ts");
    const queue = load<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts");
    const id = crypto.randomUUID();
    const original: IncomeExpense = { id, clientTempId: id, locationId: branch, localBillNo: "unallocated", number: "new",
      idempotencyKey: `create:${id}:0`, syncStatus: "pending", type: "expense", billOption: "ค่าใช้จ่าย", title: "original", cost: 10,
      txDate: "2026-11-01", createdByUserId: owner, createdByName: "test", createdByPhone: "000", revisionNo: 0, recordStatus: "active",
      clientCreatedAt: "2026-11-01T00:00:00Z", clientRecordedAt: "2026-11-01T00:00:00Z" };
    const accepted = await numbers.enqueueNumberedIncomeCreate(original, owner);
    const scope = { entity: "income_expense" as const, ownerUserId: owner, locationId: branch };
    const [event] = await queue.getPendingEvents(scope);
    const receipts = load<typeof import("../src/lib/income-expense/numbering-receipts")>("src/lib/income-expense/numbering-receipts.ts");
    const result = { status, clientTempId: id, operation: "create", locationId: branch, localBillNo: accepted.localBillNo,
      billNumbering: accepted.billNumbering, ...(status === "synced" ? { id: crypto.randomUUID(), serverBillNo: `${accepted.localBillNo}-1`,
        revisionNo: 1, serverReceivedAt: original.clientRecordedAt } : { requestId: crypto.randomUUID(), matchedReasons: ["amount_threshold"] }) };
    expect(await receipts.confirmIncomeNumberedEvent(event, result)).toBe(true);
    const before = await numbers.readIncomeSubmission(owner, branch, id);
    const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
      "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }) },
      "@/hooks/useIncomeExpenseOperationalList": { useIncomeExpenseOperationalList: () => ({ rows: [] }) },
    }, globals).useIncomeExpense(branch, owner);
    const retry = await hook.addTransaction({ ...(full ? accepted : original), title: "changed retry", cost: 999 });
    expect(retry).toEqual(accepted);
    expect(await queue.getPendingEvents(scope)).toEqual([]);
    expect(await numbers.readIncomeSubmission(owner, branch, id)).toEqual(before);
    const nextId = crypto.randomUUID();
    const next = await hook.addTransaction({ ...original, id: nextId, clientTempId: nextId, idempotencyKey: `create:${nextId}:0` });
    expect(next.billNumbering?.sequence).toBe(2);
  });
}
