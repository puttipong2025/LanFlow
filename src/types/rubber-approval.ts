export type RubberBillApprovalOperation = "create" | "update" | "delete";
export type RubberBillApprovalReason = "price" | "time" | "non_current_date";

export type EffectiveRubberApprovalSettings = {
  locationId: string;
  groupId: string | null;
  ruleSource: "group" | "ungrouped";
  editWindowMinutes: number;
  centralPrice: number;
  priceAllowance: number;
  effectivePriceCap: number;
  priceRuleRevision: number;
  nonCurrentDateRequiresApproval: boolean;
  updatedByName?: string | null;
  updatedByPhone?: string | null;
  updatedAt?: string | null;
};

export type RubberApprovalGroup = {
  id: string;
  locationIds: string[];
  editWindowMinutes: number;
  priceAllowance: number;
  revisionNo: number;
  updatedByName?: string | null;
  updatedByPhone?: string | null;
  updatedAt: string;
};

export type RubberCentralPriceSetting = { value: number; revision: number; updatedByName: string; updatedByPhone?: string | null; updatedAt: string };
export type RubberUngroupedDefaults = { locationIds: string[]; editWindowMinutes: number; priceAllowance: number; revision: number; updatedByName: string; updatedByPhone?: string | null; updatedAt: string };
export type RubberAdminQuotaSetting = { limitPerAdmin: number; maxPriceAllowance: number; roundId: string; updatedByName: string; updatedByPhone?: string | null; updatedAt: string };

export type RubberSubmissionDecision = {
  disposition: "direct" | "approval_required" | "quota_confirmation_required" | "failed";
  priceDecision: "not_applicable" | "unchanged" | "within_central" | "above_cap" | "quota_unavailable" | "quota_exhausted" | "quota_available";
  priceChanged: boolean;
  centralPrice: number;
  priceAllowance: number;
  effectivePriceCap: number;
  priceRuleRevision: number;
  quotaRoundId: string;
  decisionFingerprint?: string;
  ruleSource: "group" | "ungrouped";
  maxPrice: number | null;
  remainingAfterConfirm?: number;
  errorMessage?: string;
};

export type RubberQuotaConfirmation = { priceRuleRevision: number; quotaRoundId: string; decisionFingerprint: string };
