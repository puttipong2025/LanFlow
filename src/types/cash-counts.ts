export const CASH_DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;
export type CashDenomination = typeof CASH_DENOMINATIONS[number];
export type CashCounts = Record<string, number>;

export type CashCountSession = {
  id: string;
  locationId: string;
  cutoffAt: string;
  expiresAt: string;
  startedAt: string;
  startedByName: string;
  isOwner: boolean;
  systemBalance: number;
};

export type CashCountReceipt = {
  hasBankAccount?: boolean;
  bankAccounts?: Array<{ id: string; position: number; amount: number }>;
  id: string;
  reportNo: string;
  cutoffAt: string;
  submittedAt: string;
  countedByName: string;
  actualCounts: CashCounts;
  actualTotal: number;
  accountBalance: number;
  countedTotal: number;
  systemBalance: number | null;
  differenceTotal: number | null;
};

export type CashCountSummary = {
  id: string;
  reportNo: string;
  locationId: string;
  cutoffAt: string;
  actualTotal: number;
  accountBalance: number;
  countedTotal: number;
  systemBalance: number | null;
  checkedByName: string | null;
  checkedAt: string | null;
  differenceTotal: number | null;
  formulaVersion: string;
  status: "active";
  createdByName: string;
  createdAt: string;
  deletedAt: string | null;
};

export type CashCountDetail = CashCountSummary & {
  hasBankAccount?: boolean;
  bankAccounts?: Array<{ id: string; position: number; amount: number }>;
  locationName: string;
  actualCounts: CashCounts;
};
