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
export type RubberMaxPriceAllowanceSetting = {
  value: number;
  updatedByName: string;
  updatedByPhone?: string | null;
  updatedAt: string;
};

export type RubberMaxPriceAllowanceConflict = {
  scope: "group" | "ungrouped";
  groupId?: string;
  locationIds: string[];
  allowance: number;
};
