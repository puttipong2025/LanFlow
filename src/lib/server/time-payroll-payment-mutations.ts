import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePaymentAllocationInput, type PaymentAllocationInput } from "@/lib/time-tracking/payment-allocation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidTimePayrollPayment(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payment = value as PaymentAllocationInput;
  try {
    parsePaymentAllocationInput(payment, payment.expectedSourceAmount);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimePayrollPaymentChange(payload: Record<string, any>) {
  return ["transaction", "payroll_slip"].includes(payload.source_type)
    && typeof payload.source_id === "string" && UUID_PATTERN.test(payload.source_id)
    && payload.expense_location_id === undefined
    && isValidTimePayrollPayment(payload.payment)
    && (payload.admin_comment == null || typeof payload.admin_comment === "string");
}

export function isValidPayrollSlipCreationPayment(payload: Record<string, any>) {
  const expectedNetPay = payload.expected_net_pay;
  if (typeof expectedNetPay !== "number" || !Number.isFinite(expectedNetPay) || expectedNetPay < 0) return false;
  if (expectedNetPay === 0) return payload.payment == null;
  try {
    parsePaymentAllocationInput(payload.payment, expectedNetPay);
    return true;
  } catch {
    return false;
  }
}

export function createTimePayrollTransaction(
  supabase: SupabaseClient,
  action: "CREATE_DEBT" | "ADMIN_REQUEST_WITHDRAWAL",
  payload: Record<string, any>,
) {
  if (action === "ADMIN_REQUEST_WITHDRAWAL") {
    return supabase.rpc("create_time_tracking_withdrawal_with_payment", {
      p_profile_id: payload.user_id, p_amount: payload.amount,
      p_effective_date: payload.effective_date, p_description: payload.description || null,
      p_payment: payload.payment, p_comment: payload.admin_comment ?? null,
    });
  }
  return supabase.rpc("create_time_tracking_transaction", {
    p_profile_id: payload.user_id,
    p_type: "DEBT",
    p_amount: payload.amount, p_effective_date: payload.effective_date,
    p_description: payload.description || null,
    p_expense_location_id: null,
    p_comment: payload.admin_comment ?? null,
  });
}

export function decideTimePayrollPayment(
  supabase: SupabaseClient,
  sourceType: "transaction" | "payroll_slip",
  sourceId: string,
  payload: Record<string, any>,
) {
  if (payload.status === "APPROVED") {
    return supabase.rpc("decide_time_tracking_approval_with_payment", {
      p_source_type: sourceType, p_source_id: sourceId, p_decision: payload.status,
      p_comment: payload.admin_comment || null, p_payment: payload.payment,
    });
  }
  return supabase.rpc("decide_time_tracking_approval", {
    p_source_type: sourceType, p_source_id: sourceId, p_decision: payload.status,
    p_comment: payload.admin_comment || null,
    p_expense_location_id: null,
  });
}

export function changeTimePayrollPayment(supabase: SupabaseClient, payload: Record<string, any>) {
  return supabase.rpc("change_time_tracking_payment", {
    p_source_type: payload.source_type, p_source_id: payload.source_id,
    p_payment: payload.payment, p_comment: payload.admin_comment || null,
  });
}

export function createTimePayrollSlip(supabase: SupabaseClient, payload: Record<string, any>) {
  const base = {
    p_profile_id: payload.user_id, p_month: payload.month,
    p_auto_start_next_month: false, p_comment: payload.admin_comment ?? null,
    p_expected_net_pay: payload.expected_net_pay ?? null,
  };
  return supabase.rpc("create_time_tracking_payroll_slip_with_payment", {
    ...base,
    p_payment: payload.payment ?? null,
  });
}
