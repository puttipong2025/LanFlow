export type ApprovalType = "TRANSACTION" | "SLIP";
export type { PaymentAllocationInput } from "@/lib/time-tracking/payment-allocation";
export type AttendanceDeductionResult = {
  deductionsChanged?: boolean;
  oldOpenDeduction?: number;
  newOpenDeduction?: number;
};
