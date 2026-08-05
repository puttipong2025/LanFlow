export type RubberExportStatus = "draft" | "verified" | "deleted";
export type RubberExportExpenseDestination = "branch" | "external";

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
  deletedByName?: string | null;
  deletedAt?: string | null;
  itemCount: number;
  reportLockNo?: string | null;
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
  items: Array<{
    reportItemId: string;
    billId: string;
    billDate: string;
    billNo: string;
    customerName: string;
    eligibilityAt: string;
    netWeight: number;
    paidAmount: number;
  }>;
};
