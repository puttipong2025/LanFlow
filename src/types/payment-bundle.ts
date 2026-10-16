export type MoneyTransferBundleStatus =
  | "pending" | "paid" | "partial" | "overpaid" | "branch_and_transfer"
  | "advance_payment" | "cancelled";

export type MoneyTransferBundleSummary = {
  childCount: number;
  originalTotal: number;
  childPaidTotal: number;
  amountDue: number;
  bundlePaidTotal: number;
  allocatedTotal: number;
  branchPaidAmount: number;
  remaining: number;
  overpayment: number;
  status: MoneyTransferBundleStatus;
};

export type MoneyTransferBundleFields = {
  isPaymentBundle?: boolean;
  bundleParentId?: string | null;
  bundleFrozenAt?: string | null;
  bundleSummary?: MoneyTransferBundleSummary;
  outstandingAmount?: number;
  bundleAllocatedAmount?: number;
  bundleRemainingAmount?: number;
  matchedChildId?: string | null;
};
