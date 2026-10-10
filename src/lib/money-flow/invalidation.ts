import type { InvalidateOptions, QueryClient } from "@tanstack/react-query";

import { moneyFlowQueryKeys } from "@/lib/money-flow/query-keys";

export function invalidateMoneyFlowLocation(
  queryClient: QueryClient,
  scope: { ownerUserId: string; locationId: string },
  options?: InvalidateOptions,
) {
  const { ownerUserId, locationId } = scope;
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...moneyFlowQueryKeys.rubberBillOperationalFeedRoot(), ownerUserId, locationId],
    }, options),
    queryClient.invalidateQueries({
      queryKey: moneyFlowQueryKeys.rubberBillWorkCounts(ownerUserId, locationId),
    }, options),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpenseFeed(ownerUserId, locationId) }, options),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpensePending(ownerUserId, locationId) }, options),
    queryClient.invalidateQueries({ queryKey: [...moneyFlowQueryKeys.moneyTransferListRoot(), locationId] }, options),
    queryClient.invalidateQueries({ queryKey: ["moneyTransferDetail"] }, options),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.branchMoneyTransferReceiptsRoot() }, options),
    queryClient.invalidateQueries({ queryKey: [...moneyFlowQueryKeys.moneyTransferSourcesRoot(), locationId] }, options),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.stock(locationId) }, options),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardSnapshot(locationId) }, options),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardMoneyHistory(locationId) }, options),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardBranchSummaries() }, options),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.actionableBadges() }, options),
  ]);
}

export function invalidateMoneyFlowLocations(
  queryClient: QueryClient,
  ownerUserId: string,
  locationIds: Array<string | null | undefined>,
) {
  const uniqueLocationIds = [...new Set(locationIds.filter((locationId): locationId is string => Boolean(locationId)))];
  return Promise.all(uniqueLocationIds.map((locationId) =>
    invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId })
  ));
}

export function invalidateBranchTransferDeletionViews(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.incomeExpenseFeedRoot() }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.moneyTransferListRoot() }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.branchMoneyTransferReceiptsRoot() }),
    queryClient.invalidateQueries({ queryKey: ["dashboardSnapshot"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboardMoneyHistory"] }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.dashboardBranchSummaries() }),
    queryClient.invalidateQueries({ queryKey: moneyFlowQueryKeys.actionableBadges() }),
  ]);
}
