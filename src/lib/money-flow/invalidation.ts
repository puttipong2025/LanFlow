import type { QueryClient } from "@tanstack/react-query";

import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";

export function invalidateMoneyFlowLocation(
  queryClient: QueryClient,
  scope: { ownerUserId: string; locationId: string },
) {
  const { ownerUserId, locationId } = scope;
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...moneyFlowQueryKeys.rubberBillOperationalFeedRoot(), ownerUserId, locationId],
    }),
    queryClient.invalidateQueries({
      queryKey: moneyFlowQueryKeys.rubberBillWorkCounts(ownerUserId, locationId),
    }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.rubberBillApprovalMarkers(locationId) }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.rubberBillApprovalRequests() }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpenseFeed(ownerUserId, locationId) }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpensePending(ownerUserId, locationId) }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.moneyTransfers(locationId) }),
    queryClient.invalidateQueries({ queryKey: [...moneyFlowQueryKeys.moneyTransferListRoot(), locationId] }),
    queryClient.invalidateQueries({ queryKey: ["moneyTransferDetail"] }),
    queryClient.invalidateQueries({ queryKey: [...moneyFlowQueryKeys.moneyTransferSourcesRoot(), locationId] }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.stock(locationId) }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardOverview(locationId) }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardSnapshot(locationId) }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardMoneyHistory(locationId) }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardBranchSummaries() }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.actionableBadges() }),
  ]);
}
