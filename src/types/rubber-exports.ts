export type RubberExportStatus = "draft" | "verified";
export type RubberExportExpenseDestination = "branch" | "external";

export type RubberExportPermissions = {
  canVerify: boolean;
  canDelete: boolean;
};

export type RubberExportItem = {
  id: string;
  sourceReportItemId: string;
  sourceBillId: string;
  billDate: string;
  billNo: string;
  customerName: string;
  eligibilityAt: string;
  netWeight: number;
  paidAmount: number;
  ageHours: number | null;
  officialAgeHours?: number | null;
  ageIsEstimated: boolean;
};

export type RubberExportSummary = {
  id: string;
  exportNo: string;
  locationId: string;
  locationName: string;
  status: RubberExportStatus;
  previousStatus?: "draft" | "verified" | null;
  originalWeightTotal: number;
  paidTotal: number;
  averagePrice: number;
  currentWeight?: number | null;
  weightLossPercent?: number | null;
  workRate?: number | null;
  otherOperatingCost: number;
  workTotal?: number | null;
  expenseDestination?: RubberExportExpenseDestination | null;
  createdByName: string;
  createdAt: string;
  verifiedByName?: string | null;
  verifiedAt?: string | null;
  soldOutAt?: string | null;
  soldOutByName?: string | null;
  deletedByName?: string | null;
  deletedAt?: string | null;
  itemCount: number;
  reportLockNo?: string | null;
  ageCalculatedAt: string | null;
  averageAgeHours: number | null;
  oldestAgeHours: number | null;
  estimatedAgeItemCount: number | null;
  officialAgeCutoffAt?: string | null;
  officialAverageAgeHours?: number | null;
  officialOldestAgeHours?: number | null;
  officialEstimatedAgeItemCount?: number | null;
  receiptBillId?: string | null;
  receiptBillNo?: string | null;
  receiptLocationName?: string | null;
};

export type RubberExportDetails = RubberExportSummary & {
  items: RubberExportItem[];
};

export type RubberExportAvailableBill = {
  reportItemId: string;
  billId: string;
  billDate: string;
  billNo: string;
  customerName: string;
  eligibilityAt: string;
  netWeight: number;
  paidAmount: number;
};

export type RubberExportPreview = {
  itemCount: number;
  originalWeightTotal: number;
  paidTotal: number;
  averagePrice: number;
  calculatedAt: string;
  averageAgeHours: number;
  oldestAgeHours: number;
  estimatedAgeItemCount: number;
  items: Array<{
    reportItemId: string;
    billId: string;
    billDate: string;
    billNo: string;
    customerName: string;
    eligibilityAt: string;
    netWeight: number;
    paidAmount: number;
    ageHours: number;
    ageIsEstimated: boolean;
  }>;
};
