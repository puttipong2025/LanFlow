export type HistoryRetentionGroup = {
  key: string;
  eligibleCount: number | null;
  oldestDate: string | null;
};

export type HistoryCleanupSummary = {
  id: string;
  source: "manual" | "automatic";
  status: "running" | "succeeded" | "failed";
  retentionDays: number;
  cutoffDate: string;
  deletedCounts: Record<string, number>;
  remainingCounts: Record<string, number>;
  countsAsOf: string | null;
  batches: number;
  hasMore: boolean | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type HistoryRetentionOverview = {
  currentDays: number;
  requestedDays: number;
  cutoffDate: string;
  updatedAt: string;
  updatedByName: string | null;
  totalEligible: number | null;
  groups: HistoryRetentionGroup[];
  lastCleanup: HistoryCleanupSummary | null;
};

export type HistoryCleanupStatus = Pick<HistoryRetentionOverview,
  "currentDays" | "cutoffDate" | "updatedAt" | "lastCleanup">;
