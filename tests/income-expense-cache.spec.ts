import { test, expect } from "@playwright/test";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { loadSourceModule } from "./helpers/load-source-module";
import type { IncomeExpense } from "../src/types";
import type { IncomeExpenseOperationalFeedPage as FeedPage } from "../src/lib/income-expense/operational-list";
import { isIncomeExpenseFeedPayload } from "../src/lib/income-expense/contracts";

const owner = "ba000000-0000-4000-8000-000000000001", branch = "ba000000-0000-4000-8000-000000000002";

for (const scenario of ["latest", "pending-unrelated", "pending-approved-same", "latest-approved-same", "search-unrelated"]) {
  test(`confirmed sync preserves feed membership: ${scenario}`, async () => {
    const browser = { indexedDB: new IDBFactory() }, q = new QueryClient();
    const id = crypto.randomUUID(), server = crypto.randomUUID();
    const payload = { operation: "create", expectedRevisionNo: 0, clientTempId: id, idempotencyKey: `create:${id}:0`,
      locationId: branch, localBillNo: "LEGACY-CACHE-CONTROL", type: "income", txDate: "2026-11-01",
      title: "newly synced record", cost: 10, billOption: "รายรับ", recordStatus: "active",
      createdByUserId: owner, createdByName: "fixture", createdByPhone: "000",
      clientCreatedAt: "2026-11-01T00:00:00Z", clientRecordedAt: "2026-11-01T00:00:00Z" };
    const mode = scenario.startsWith("pending") ? "pending_approval" : "latest";
    const search = scenario === "search-unrelated" ? "unrelated" : "";
    const key = ["incomeExpenseFeed", owner, branch, "operational", mode, search];
    const before = { ...payload, id: "pending-id", clientTempId: scenario.endsWith("same") ? id : "another-pending",
      title: "real pending request", number: payload.localBillNo, revisionNo: 0, approvalPending: true,
      approvalRequestId: crypto.randomUUID(), approvalRequestType: "income_expense", approvalReasons: ["amount_threshold"],
      approvalOperation: "create", syncStatus: "pending", serverReceivedAt: "2026-11-01T00:00:00Z" } as IncomeExpense;
    const page = (rows: IncomeExpense[]): InfiniteData<FeedPage> => ({
      pages: [{ rows, nextCursor: null, hasMore: false, pendingApprovalCount: rows.length }], pageParams: [null],
    });
    const initial = page(scenario === "latest" || scenario === "search-unrelated" ? [] : [before]);
    expect(isIncomeExpenseFeedPayload(initial.pages[0], branch, mode, search)).toBe(true);
    q.setQueryData(key, initial);
    const otherKeys = [
      ["incomeExpenseFeed", "other-owner", branch, "operational", "pending_approval", ""],
      ["incomeExpenseFeed", owner, "other-branch", "operational", "latest", ""],
    ];
    for (const otherKey of otherKeys) q.setQueryData(otherKey, page([before]));
    const queue = loadSourceModule<typeof import("../src/lib/idb-queue")>("src/lib/idb-queue.ts", {}, { window: browser });
    await queue.enqueueSyncEvent({ id, entity: "income_expense", operation: "create", ownerUserId: owner,
      locationId: branch, payload, status: "pending", timestamp: 1 });
    const hook = loadSourceModule<typeof import("../src/hooks/useIncomeExpense")>("src/hooks/useIncomeExpense.ts", {
      "@/lib/auth-fetch": { canSyncCurrentSession: async () => true, authFetch: async () => Response.json({
        status: "synced", id: server, serverBillNo: "2611010001", revisionNo: 1, serverReceivedAt: "2026-11-01T00:00:00Z",
      }) },
    }, { window: browser, navigator: { onLine: true } });
    await hook.syncPendingIncomeExpense(q, owner, branch);
    const rows = q.getQueryData<InfiniteData<FeedPage>>(key)!.pages.flatMap((p) => p.rows);
    for (const otherKey of otherKeys) expect(q.getQueryData(otherKey)).toEqual(page([before]));
    if (scenario === "latest" || scenario === "latest-approved-same") {
      expect(rows).toMatchObject([{ clientTempId: id, syncStatus: "synced", serverBillNo: "2611010001" }]);
      expect(rows[0].approvalPending).toBeUndefined();
      expect(rows[0].approvalRequestId).toBeUndefined();
    } else expect(rows.some((row) => row.clientTempId === id)).toBe(false);
    expect(await queue.getPendingEvents({ entity: "income_expense", ownerUserId: owner, locationId: branch })).toHaveLength(0);
    const history = loadSourceModule<typeof import("../src/lib/income-expense/history-idb")>("src/lib/income-expense/history-idb.ts", {}, { window: browser });
    expect((await history.readIncomeExpenseHistory(owner, branch))?.rows).toMatchObject([{ id: server, clientTempId: id }]);
    q.clear();
  });
}
