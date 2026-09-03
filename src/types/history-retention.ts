export type HistoryRetentionGroup = {
  key: string;
  eligibleCount: number;
  oldestDate: string | null;
};

export type HistoryCleanupSummary = {
  status: "running" | "succeeded" | "failed";
  retentionDays: number;
  cutoffDate: string;
  deletedCounts: Record<string, number>;
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
  totalEligible: number;
  groups: HistoryRetentionGroup[];
  lastCleanup: HistoryCleanupSummary | null;
  cleanup?: {
    status: "succeeded" | "failed" | "skipped";
    hasMore?: boolean;
    errorMessage?: string;
  };
};
