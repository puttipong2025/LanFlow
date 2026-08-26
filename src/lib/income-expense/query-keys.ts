export const INCOME_EXPENSE_FEED_QUERY_KEY = "incomeExpenseFeed" as const;
export const CASH_BRANCH_TRANSFERS_QUERY_KEY = "cashBranchTransfers" as const;

export const cashBranchTransferQueryKeys = {
  root: () => [CASH_BRANCH_TRANSFERS_QUERY_KEY] as const,
  pending: (ownerUserId: string, locationId: string) =>
    [CASH_BRANCH_TRANSFERS_QUERY_KEY, ownerUserId, "pending", locationId] as const,
  detail: (ownerUserId: string, locationId: string, detailId: string) =>
    [CASH_BRANCH_TRANSFERS_QUERY_KEY, ownerUserId, "detail", locationId, detailId] as const,
};

export const incomeExpenseOperationalQueryKeys = {
  root: () => [INCOME_EXPENSE_FEED_QUERY_KEY] as const,
  feed: (ownerUserId: string, locationId: string, mode: "latest" | "pending_approval", normalizedSearch: string) =>
    [INCOME_EXPENSE_FEED_QUERY_KEY, ownerUserId, locationId, "operational", mode, normalizedSearch] as const,
  pending: (ownerUserId: string, locationId: string) =>
    ["incomeExpensePending", ownerUserId, locationId] as const,
};
