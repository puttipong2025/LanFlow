export type ApprovalType = "TRANSACTION" | "SLIP";
export type AttendanceDeductionResult = {
  deductionsChanged?: boolean;
  oldOpenDeduction?: number;
  newOpenDeduction?: number;
};

