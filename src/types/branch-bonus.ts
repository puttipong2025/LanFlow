export const BONUS_METRICS = ["burden", "loss", "counts"] as const;
export type BonusMetricKey = typeof BONUS_METRICS[number];
export type BonusSettings = {
  exportIds: string[];
  excludedKeys: string[];
  excludedGroups: string[];
  rate: number;
  metrics: Record<BonusMetricKey, { weight: number; target: number | null }>;
};
export type BonusExport = {
  id: string; exportNo: string; createdAt: string;
  originalWeight: number; currentWeight: number | null; lossPercent: number | null;
  ready?: boolean; bonusId?: string | null;
};
export type BonusSource = {
  key: string; id: string; kind: string; date: string; occurredAt: string;
  label: string; amount: number; included: boolean;
};
export type BonusSourceSection = "expenses" | "purchases" | "counts";
export type BonusMetric = {
  key: BonusMetricKey; weight: number; target: number | null; actual: number | null;
  relative: number | null; adjustment: number | null;
};
export type BonusPreview = {
  requestVersion?: "batch-v1";
  periodStart: string; periodEnd: string; periodDays: number; asOf: string; formulaVersion: string;
  sourceFingerprint: string; complete: boolean; overlap: boolean; gaps: Array<{ kind: string; date: string }>;
  exports: BonusExport[]; expenses: BonusSource[]; purchases: BonusSource[]; counts: BonusSource[];
  sourceCounts: Record<BonusSourceSection, number>;
  selectedSourceCounts: Record<BonusSourceSection, number>;
  changes: BonusChange[]; changeCount: number;
  expenseGroups: Array<{ kind: string; amount: number; includedAmount: number }>;
  weight: number; expenseTotal: number; purchaseTotal: number; countTotal: number;
  burdenActual: number | null; countActual: number | null; lossActual: number; metrics: BonusMetric[];
  rate: number; base: number; adjustment: number; suggestedAmount: number;
  scenarios: Array<{ rate: number; base: number; adjustmentAmount: number; amount: number }>;
  canConfirm: boolean; issues: string[];
};
export type BonusDetail = BonusPreview & {
  id: string; input: BonusSettings; finalAmount: number; createdAt: string; createdByName: string;
};
export type BonusListRow = Pick<BonusDetail, "id" | "periodStart" | "periodEnd" | "createdAt" | "createdByName" | "finalAmount" | "suggestedAmount" | "weight">;
export type BonusChange = {
  bonus_id: string; source_key: string; label: string; old_amount: number | null;
  new_amount: number | null; unknown: boolean; old_included: boolean | null;
  period_start: string; period_end: string; old_date: string | null; new_date: string | null;
};
export type BonusPage<T> = { rows: T[]; hasMore: boolean };

export type BonusRequiredExport = BonusExport & {
  kind: "required" | "self" | "leftover"; history: boolean; issues: string[]; windowKey: number;
};
export type BonusPeriod = { key: string; exportIds: string[]; periodStart: string; periodEnd: string; periodDays: number };
export type BonusReview = { rows: BonusRequiredExport[]; periods: BonusPeriod[]; requiredCount: number; blockedCount: number; fingerprint: string };
export type BonusBatchPart = { key: string; input: BonusSettings; expected?: string; finalAmount?: number | null };
export type BonusBatchPreview = { periods: Array<{ key: string; preview: BonusPreview }> };
export type BonusBatchResult = { id: string; results: BonusDetail[]; deletedIds: string[] };
export type BonusBatchIntent = { version: 1; id: string; ownerId: string; locationId: string; review: string; periods: BonusBatchPart[] };
