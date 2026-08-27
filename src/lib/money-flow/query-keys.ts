export const moneyFlowQueryKeys = {
  incomeExpenseFeedRoot: () => ["incomeExpenseFeed"] as const,
  moneyTransfersRoot: () => ["moneyTransfers"] as const,
  moneyTransferListRoot: () => ["moneyTransferList"] as const,
  moneyTransferSourcesRoot: () => ["moneyTransferSources"] as const,
  rubberBillsRoot: () => ["rubberBills"] as const,
  rubberBillOperationalFeedRoot: () => ["rubberBillOperationalFeed"] as const,
  rubberBillWorkCountsRoot: () => ["rubberBillWorkCounts"] as const,
  stockRoot: () => ["stock"] as const,
  actionableBadges: () => ["actionableBadges"] as const,
  dashboardBranchSummaries: () => ["dashboardBranchSummaries"] as const,
  dashboardMoneyHistory: (locationId: string) => ["dashboardMoneyHistory", locationId] as const,
  dashboardOverview: (locationId: string) => ["dashboardOverview", locationId] as const,
  dashboardSnapshot: (locationId: string) => ["dashboardSnapshot", locationId] as const,
  incomeExpenseFeed: (ownerUserId: string, locationId: string) =>
    ["incomeExpenseFeed", ownerUserId, locationId] as const,
  incomeExpensePending: (ownerUserId: string, locationId: string) =>
    ["incomeExpensePending", ownerUserId, locationId] as const,
  moneyTransfers: (locationId: string) => ["moneyTransfers", locationId] as const,
  moneyTransferList: (locationId: string, status: string, search: string) =>
    ["moneyTransferList", locationId, status, search] as const,
  moneyTransferDetail: (transferId: string) => ["moneyTransferDetail", transferId] as const,
  moneyTransferSources: (locationId: string, sourceType: string, search: string) =>
    ["moneyTransferSources", locationId, sourceType, search] as const,
  rubberBillApprovalMarkers: (locationId: string) =>
    ["rubberBillApprovalMarkers", locationId] as const,
  rubberBillApprovalRequests: () => ["rubberBillApprovalRequests"] as const,
  rubberBills: (ownerUserId: string, locationId: string) =>
    ["rubberBills", ownerUserId, locationId] as const,
  rubberBillOperationalFeed: (
    ownerUserId: string,
    locationId: string,
    mode: string,
    documentStatus: string,
    search: string,
  ) => ["rubberBillOperationalFeed", ownerUserId, locationId, mode, documentStatus, search] as const,
  rubberBillWorkCounts: (ownerUserId: string, locationId: string) =>
    ["rubberBillWorkCounts", ownerUserId, locationId] as const,
  stock: (locationId: string) => ["stock", locationId] as const,
};
