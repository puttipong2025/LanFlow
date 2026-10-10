export type MoneyTransferVirtualStatus =
  | "pending"
  | "paid"
  | "partial"
  | "overpaid"
  | "branch_and_transfer"
  | "advance_payment"
  | "cancelled"
  | "branch_pending_receipt"
  | "branch_received";

export type MoneyTransferBranchReceiptFields = {
  accountingDate?: string | null;
  receiptContractVersion?: 1 | null;
  branchReceiptStatus?: "pending_receipt" | "received" | null;
  branchReceivedByName?: string | null;
  branchReceivedAt?: string | null;
  virtualStatus?: MoneyTransferVirtualStatus;
};

export type BranchMoneyTransferSummary = {
  id: string;
  netAmountToPay: number;
  createdByName: string;
};

export type BranchTransferDeleteRequest = {
  id: string;
  locationId: string;
  locationName: string;
  transferDisplayNo: string;
  amount: number;
  requestStatus: "pending" | "approved" | "rejected";
  requestedByName: string;
  requestedByPhone: string;
  decidedByName: string | null;
  decidedByPhone: string | null;
  createdAt: string;
};
