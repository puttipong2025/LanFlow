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
};

export type CashCountReceipt = {
  id: string;
  reportId: string;
  reportNo: string;
  cutoffAt: string;
  submittedAt: string;
  countedByName: string;
  actualCounts: CashCounts;
  actualTotal: number;
};

export type CashCountSummary = {
  id: string;
  reportId: string;
  reportNo: string;
  locationId: string;
  cutoffAt: string;
  actualTotal: number;
  expectedTotal: number;
  differenceTotal: number;
  anomalyScore: number | null;
  confidence: number | null;
  analysisStatus: string | null;
  formulaVersion: string;
  status: "active" | "deleted";
  createdByName: string;
  createdAt: string;
  deletedAt: string | null;
};

export type CashCountDetail = CashCountSummary & {
  locationName: string;
  actualCounts: CashCounts;
  expectedCounts: CashCounts;
  differenceCounts: CashCounts;
  evidence: {
    highlights?: string[];
    limitations?: string[];
    references?: Array<Record<string, unknown>>;
    components?: Record<string, number | null>;
  };
};
