export type DashboardStockItem = {
  productId: string;
  name: string;
  unit: string;
  balance: number;
};

export type DashboardRubberMetrics = {
  billCount: number;
  netWeight: number;
  averagePrice: number | null;
  rubberValue: number;
  deductionTotal: number;
  unpricedBillCount: number;
  pendingApprovalCount: number;
};

export type DashboardSummary = {
  purchaseToday: DashboardRubberMetrics & {
    paidTotal: number;
  };
  rubberRemaining: DashboardRubberMetrics;
  purchase7Days: {
    paidTotal: number;
    dailyAverage: number;
    netWeight: number;
    averageCostPerKg: number | null;
  };
  cashToday: {
    income: number;
    expense: number;
    net: number;
  };
  netCashFlow: number;
  operatingExpenseAccumulated: number;
  payablePurchaseAccumulated: number;
  operatingBurdenPercent: number | null;
  rubberInventoryWeight: number;
  waterLoss7Days: {
    exportCount: number;
    weight: number;
    percent: number | null;
  };
  stock: {
    inStockCount: number;
    outOfStockCount: number;
    items: DashboardStockItem[];
  };
};

export type DashboardRow = {
  id: string;
  kind: string;
  number: string;
  title: string;
  direction: "income" | "expense";
  amount: number;
  occurredAt: string;
  createdByName: string;
};

export type DashboardSnapshot = {
  status: "dirty" | "queued" | "running" | "ready" | "failed";
  sourceVersion: number;
  snapshotVersion: number;
  summary: DashboardSummary | null;
  calculatedAt: string | null;
  manualRequestedAt: string | null;
  lastError: string | null;
};

export type DashboardRefreshRequest = DashboardSnapshot & {
  requestedVersion: number;
};

export type DashboardMoneyFeed = {
  rows: DashboardRow[];
  nextCursor: string | null;
};

export type DashboardMoneyHistoryAction = "all" | "create" | "update" | "delete";

export type DashboardMoneyHistoryRow = {
  id: string;
  sourceType: string;
  action: Exclude<DashboardMoneyHistoryAction, "all">;
  kind: string;
  number: string;
  title: string;
  direction: "income" | "expense";
  amount: number;
  actorName: string;
  occurredAt: string;
};

export type DashboardMoneyHistory = {
  selectedDate: string;
  availableFrom: string;
  availableTo: string;
  counts: Record<DashboardMoneyHistoryAction, number>;
  latestAt: string | null;
  rows: DashboardMoneyHistoryRow[];
  nextCursor: string | null;
};

export type DashboardLegacySummary = Omit<
  DashboardSummary,
  "purchaseToday" | "rubberRemaining" | "cashToday"
> & {
  purchaseToday: Pick<
    DashboardSummary["purchaseToday"],
    "billCount" | "netWeight" | "paidTotal"
  >;
};

export type DashboardOverview = DashboardMoneyFeed & {
  summary: DashboardLegacySummary;
};

export type DashboardBranchCashStatus =
  | "low"
  | "normal"
  | "unconfigured"
  | "no_data";

export type DashboardBranchSummary = {
  locationId: string;
  snapshotStatus: DashboardSnapshot["status"] | null;
  calculatedAt: string | null;
  cashStatus: DashboardBranchCashStatus;
  summary: Pick<
    DashboardSummary,
    "netCashFlow" | "rubberInventoryWeight" | "purchaseToday"
  > | null;
};

export type DashboardStockThreshold = {
  productId: string;
  name: string;
  unit: string;
  minimumBalance: number | null;
};

export type DashboardAlertThresholds = {
  locationId: string;
  purchaseAverageMin: number;
  netCashMin: number;
  stockItems: DashboardStockThreshold[];
  updatedAt: string | null;
  updatedByName: string | null;
};

export type DashboardManagerConfig = {
  intervalMinutes: number;
  updatedAt: string;
  updatedByName: string | null;
  thresholds: DashboardAlertThresholds;
  locations: Array<{ id: string; name: string }>;
  snapshot: DashboardSnapshot;
};
