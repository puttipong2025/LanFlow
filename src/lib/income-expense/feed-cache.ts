import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { IncomeExpense } from "@/types";
import type { SyncEvent } from "@/lib/idb-queue";
import { incomeExpenseFromSyncEvent, mergeIncomeExpenseLocalEvents, type IncomeExpenseOperationalFeedPage } from "./operational-list";
import { INCOME_EXPENSE_FEED_QUERY_KEY, incomeExpenseOperationalQueryKeys } from "./query-keys";
import { patchIncomeExpenseHistory } from "@/lib/income-expense/history-idb";

export type IncomeExpenseSyncReceipt = {
  id: string;
  serverBillNo: string;
  revisionNo: number;
  serverReceivedAt?: string;
  title?: string;
  cost?: number;
  saleLineCount?: number;
  saleLines?: IncomeExpense["saleLines"];
};

export function incomeExpenseFromReceipt(event: SyncEvent, receipt: IncomeExpenseSyncReceipt,
  existing?: IncomeExpense): IncomeExpense {
  const optimistic = incomeExpenseFromSyncEvent(event);
  return {
    ...existing, ...optimistic, id: receipt.id, serverBillNo: receipt.serverBillNo, number: receipt.serverBillNo,
    syncStatus: "synced", revisionNo: receipt.revisionNo, serverReceivedAt: receipt.serverReceivedAt,
    title: receipt.title ?? optimistic.title, cost: receipt.cost ?? optimistic.cost,
    saleLineCount: receipt.saleLineCount ?? optimistic.saleLineCount,
    saleLines: receipt.saleLines ?? optimistic.saleLines, syncErrorMessage: undefined,
    serverSubmissionAttempted: false, approvalPending: undefined, approvalRequestId: undefined,
    approvalRequestType: undefined, approvalOperation: undefined, approvalReasons: undefined,
  };
}

function patchFeedCache(queryClient: QueryClient, owner: string, branch: string, clientTempId: string,
  confirmed?: (existing?: IncomeExpense) => IncomeExpense) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY, owner, branch] })) {
    const mode = query.queryKey[4];
    if (query.queryKey[3] !== "operational" || (mode !== "latest" && mode !== "pending_approval")) continue;
    queryClient.setQueryData<InfiniteData<IncomeExpenseOperationalFeedPage>>(query.queryKey, (cached) => {
      if (!cached?.pages.length) return cached;
      const existing = cached.pages.flatMap((page) => page.rows).find((row) => row.clientTempId === clientTempId);
      const row = confirmed?.(existing);
      const search = typeof query.queryKey[5] === "string" ? query.queryKey[5] : "";
      return { ...cached, pages: cached.pages.map((page, index) => ({
        ...page,
        pendingApprovalCount: Math.max(0, page.pendingApprovalCount - (existing?.approvalPending ? 1 : 0)),
        rows: mode === "pending_approval" ? page.rows.filter((item) => item.clientTempId !== clientTempId) : mergeIncomeExpenseLocalEvents([
          ...page.rows.filter((item) => item.clientTempId !== clientTempId),
          ...(index === 0 && mode === "latest" && row ? [row] : []),
        ], [], search),
      })) };
    });
  }
}

export function removeFromFeedCache(queryClient: QueryClient, owner: string, branch: string, clientTempId: string) {
  patchFeedCache(queryClient, owner, branch, clientTempId);
}

export function upsertSyncedIntoFeedCache(queryClient: QueryClient, owner: string, branch: string,
  event: SyncEvent, receipt: IncomeExpenseSyncReceipt) {
  patchFeedCache(queryClient, owner, branch, event.id, (existing) => incomeExpenseFromReceipt(event, receipt, existing));
}

export async function cacheConfirmedIncomeExpense(queryClient: QueryClient, owner: string, branch: string,
  event: SyncEvent, receipt?: IncomeExpenseSyncReceipt) {
  await queryClient.cancelQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY, owner, branch] });
  if (receipt && event.operation !== "delete") upsertSyncedIntoFeedCache(queryClient, owner, branch, event, receipt);
  else removeFromFeedCache(queryClient, owner, branch, event.id);
  await patchIncomeExpenseHistory(owner, branch, event.id,
    receipt && event.operation !== "delete" ? incomeExpenseFromReceipt(event, receipt) : undefined);
  await queryClient.invalidateQueries({ queryKey: incomeExpenseOperationalQueryKeys.history(owner, branch) });
}
