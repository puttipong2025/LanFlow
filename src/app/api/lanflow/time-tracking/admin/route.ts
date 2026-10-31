import { NextRequest, NextResponse } from "next/server";
import { rpcErrorMessage, rpcErrorStatus } from "@/lib/server/time-payroll-rpc-errors";
import { bangkokDateString } from "@/lib/bangkok-date";
import { requireAuth } from "@/lib/server/auth";
import { readActionablePendingAdjustments } from "@/lib/server/time-payroll-pending-adjustments";
import { mapTimePayrollPaymentRpcError } from "@/lib/server/time-payroll-payment-errors";
import { cashCountLockResponse } from "@/lib/server/cash-count-lock-response";
import { changeTimePayrollPayment, createTimePayrollSlip, createTimePayrollTransaction, decideTimePayrollPayment, isValidPayrollSlipCreationPayment, isValidTimePayrollPayment, isValidTimePayrollPaymentChange } from "@/lib/server/time-payroll-payment-mutations";
import { readAllSupabaseRows } from "@/lib/supabase-pages";
import { buildPayrollPeriodState, type PayrollPeriodRow } from "@/lib/time-tracking/period-state";
import { parseDailyWageInput } from "@/lib/time-tracking/wage";
import { readTimeTrackingActionRequest } from "../action-request";
export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ISO_MONTH_PATTERN = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function hasValidAttendanceSelections(value: unknown, month: string) {
  if (!Array.isArray(value) || value.length > 31) return false;
  const dates = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const selection = item as Record<string, unknown>;
    if (
      !isIsoDate(selection.date)
      || selection.date.slice(0, 7) !== month
      || (selection.status !== "HALF_DAY" && selection.status !== "OFF")
      || dates.has(selection.date)
    ) return false;
    dates.add(selection.date);
  }
  return true;
}

function rpcFailure(error: { message: string }) {
  const locked = cashCountLockResponse(error.message); if (locked) return locked;
  const paymentError = mapTimePayrollPaymentRpcError(error.message);
  const code = error.message.match(/WAGE_PREVIEW_STALE|WAGE_PREVIEW_REQUIRED/)?.[0] ?? null;
  return NextResponse.json(
    { error: paymentError?.message ?? rpcErrorMessage(error.message), ...(code ? { code } : {}) },
    { status: paymentError?.status ?? rpcErrorStatus(error.message) },
  );
}
type UserLocationAssignment = {
  location_id: string;
  is_primary: boolean;
  locations: { is_active: boolean } | Array<{ is_active: boolean }> | null;
};

function activePrimaryLocationId(assignments: UserLocationAssignment[] | null | undefined) {
  return assignments?.find((assignment) => {
    const linkedLocations = Array.isArray(assignment.locations)
      ? assignment.locations
      : [assignment.locations];
    return assignment.is_primary === true
      && linkedLocations.some((location) => location?.is_active === true);
  })?.location_id ?? null;
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  if (!result.auth.canManageTimePayroll) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const [
      userRows,
      pendingTransactions,
      pendingAdjustments,
      pendingSlips,
      paymentLocationsResult,
      settingsResult,
      activePeriods,
      managerOverviewResult,
    ] = await Promise.all([
      readAllSupabaseRows((from, to) => result.supabase.from("profiles").select(`
          id, name, phone, daily_wage, role, is_active, can_access_super_admin_features,
          user_locations!user_locations_user_id_fkey(location_id, is_primary, locations!inner(is_active))
        `)
        .order("id", { ascending: true })
        .range(from, to)),
      readAllSupabaseRows((from, to) => result.supabase
        .from("financial_transactions")
        .select("profile_id")
        .eq("status", "PENDING").is("cancelled_at", null)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .order("id", { ascending: true })
        .range(from, to)),
      readActionablePendingAdjustments(result.supabase),
      readAllSupabaseRows((from, to) => result.supabase
        .from("payroll_slips")
        .select("profile_id")
        .eq("status", "PENDING").is("cancelled_at", null)
        .order("id", { ascending: true })
        .range(from, to)),
      result.supabase.rpc("get_time_payroll_payment_locations"),
      result.supabase.rpc("get_time_payroll_settings"),
      readAllSupabaseRows((from, to) => result.supabase
        .from("time_payroll_active_periods")
        .select("id, profile_id, start_on, end_on, scheduled_action, scheduled_effective_on, scheduled_activation_on")
        .order("start_on", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)),
      result.supabase.rpc("get_time_payroll_manager_overview"),
    ]);

    if (paymentLocationsResult.error) throw paymentLocationsResult.error;
    if (settingsResult.error) throw settingsResult.error;
    if (managerOverviewResult.error) throw managerOverviewResult.error;

    const users = userRows.filter((user) => {
      if (!user.is_active) return false;
      if (result.auth.canAccessSystemManager) return true;
      const primaryLocationId = activePrimaryLocationId(user.user_locations);
      return ["user", "admin"].includes(user.role)
        && user.can_access_super_admin_features !== true
        && !!primaryLocationId
        && result.auth.locationIds.includes(primaryLocationId);
    });
    const userIds = users.map((user) => user.id);
    const allowedUserIds = new Set(userIds);
    const managerOverview = new Map(
      ((managerOverviewResult.data || []) as Array<{ profileId: string; debtAmount: number; missingPayrollMonths: string[] }>)
        .map((row) => [row.profileId, row]),
    );
    const periodsByUser = new Map<string, PayrollPeriodRow[]>();
    for (const period of activePeriods) {
      const periods = periodsByUser.get(period.profile_id) || [];
      periods.push(period as PayrollPeriodRow);
      periodsByUser.set(period.profile_id, periods);
    }
    const today = bangkokDateString();

    return NextResponse.json({
      settings: settingsResult.data,
      permissions: {
        canManage: result.auth.canManageTimePayroll,
        canDecide: true,
        canConfigure: true,
        canEditGlobalConfig: result.auth.role === "super_admin",
        canViewAudit: result.auth.canAccessSystemManager,
      },
      users: users.map((user) => {
        const periodState = buildPayrollPeriodState(periodsByUser.get(user.id) || [], today);
        return {
          ...user,
          primary_location_id: activePrimaryLocationId(user.user_locations),
          user_locations: undefined,
          debt_remaining_amount: Number(managerOverview.get(user.id)?.debtAmount || 0),
          missing_payroll_months: managerOverview.get(user.id)?.missingPayrollMonths || [],
          period_state: periodState,
        };
      }),
      pendingTransactions: [...pendingTransactions, ...pendingAdjustments]
        .filter((item) => allowedUserIds.has(item.profile_id)),
      pendingSlips: pendingSlips.filter((item) => allowedUserIds.has(item.profile_id)),
      admins: result.auth.canAccessSystemManager ? userRows
        .filter((profile) => profile.role === "admin" || profile.role === "super_admin")
        .map(({ id, name }) => ({ id, name })) : [],
      paymentLocations: paymentLocationsResult.data || [],
    });
  } catch (error) {
    if (
      error && typeof error === "object"
      && "message" in error && typeof error.message === "string"
      && [401, 403].includes(rpcErrorStatus(error.message))
    ) {
      return rpcFailure({ message: error.message });
    }
    console.error("Failed to load admin time/payroll data:", error);
    return NextResponse.json(
      { error: "โหลดข้อมูลจัดการเงินเดือนไม่สำเร็จ" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  if (!result.auth.canManageTimePayroll) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await readTimeTrackingActionRequest(request);
  if (!body) return NextResponse.json({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, { status: 400 });
  const payload = body.payload;
  const supabase = result.supabase;

  try {
    if (body.action === "GET_AUDIT_LOGS") {
      if (!result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      if (payload.admin_user_id != null && !isUuid(payload.admin_user_id)) {
        return NextResponse.json({ error: "ตัวกรองประวัติไม่ถูกต้อง" }, { status: 400 });
      }
      const { admin_user_id } = payload;
      let query = supabase
        .from("time_tracking_audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (admin_user_id) query = query.eq("admin_id", admin_user_id);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ logs: data || [] });
    }

    if (body.action === "CREATE_DEBT" || body.action === "ADMIN_REQUEST_WITHDRAWAL") {
      const { user_id, amount, effective_date, description } = payload;
      if (!isUuid(user_id) || typeof amount !== "number" || !Number.isFinite(amount) || !isIsoDate(effective_date)
        || (description != null && typeof description !== "string")
        || payload.expense_location_id !== undefined
        || (body.action === "CREATE_DEBT" && payload.payment !== undefined)
        || (payload.admin_comment != null && typeof payload.admin_comment !== "string")) {
        return NextResponse.json({ error: "ข้อมูลรายการไม่ถูกต้อง" }, { status: 400 });
      }
      const payment = payload.payment;
      if (body.action === "ADMIN_REQUEST_WITHDRAWAL" && !isValidTimePayrollPayment(payment)) {
        return NextResponse.json({ error: "ข้อมูลวิธีจ่ายไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await createTimePayrollTransaction(supabase, body.action, payload);
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "ADMIN_REQUEST_WITHDRAWAL_ADJUSTMENT") {
      const { withdrawal_id, target_amount, expense_location_id, reason } = payload;
      if (
        !isUuid(withdrawal_id)
        || typeof target_amount !== "number"
        || !Number.isFinite(target_amount)
        || (expense_location_id !== null && !isUuid(expense_location_id))
        || (reason != null && typeof reason !== "string")
      ) {
        return NextResponse.json({ error: "ข้อมูลปรับยอดเบิกไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("request_time_tracking_withdrawal_adjustment", {
        p_withdrawal_id: withdrawal_id,
        p_target_amount: target_amount,
        p_expense_location_id: expense_location_id,
        p_reason: typeof reason === "string" ? reason.slice(0, 500) : null,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "DECIDE_WITHDRAWAL_ADJUSTMENT") {
      const { adjustment_id, status, expense_location_id, admin_comment } = payload;
      if (
        !isUuid(adjustment_id)
        || !["APPROVED", "REJECTED"].includes(status)
        || (status === "APPROVED" && expense_location_id !== null && !isUuid(expense_location_id))
        || (admin_comment != null && typeof admin_comment !== "string")
      ) {
        return NextResponse.json({ error: "ข้อมูลตัดสินคำขอปรับยอดไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("decide_time_tracking_withdrawal_adjustment", {
        p_adjustment_id: adjustment_id,
        p_decision: status,
        p_expense_location_id: status === "APPROVED" ? expense_location_id : null,
        p_comment: typeof admin_comment === "string" ? admin_comment.slice(0, 500) : null,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "DELETE_TRANSACTION" || body.action === "DELETE_PAYROLL_SLIP") {
      const sourceId = body.action === "DELETE_TRANSACTION"
        ? payload.transaction_id
        : payload.slip_id;
      if (!isUuid(sourceId)) {
        return NextResponse.json({ error: "รหัสรายการไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("delete_time_tracking_source_permanently", {
        p_source_type: body.action === "DELETE_TRANSACTION" ? "transaction" : "payroll_slip",
        p_source_id: sourceId,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, deleted: true, result: data });
    }

    if (body.action === "APPROVE_TRANSACTION" || body.action === "APPROVE_PAYROLL_SLIP") {
      const sourceId = body.action === "APPROVE_TRANSACTION"
        ? payload.transaction_id
        : payload.slip_id;
      const { status, admin_comment, expense_location_id, payment } = payload;
      if (
        !isUuid(sourceId)
        || !["APPROVED", "REJECTED"].includes(status)
        || expense_location_id !== undefined
        || (admin_comment != null && typeof admin_comment !== "string")
        || (status === "REJECTED" && payment != null)
        || (status === "APPROVED" && payment != null && !isValidTimePayrollPayment(payment))
      ) {
        return NextResponse.json({ error: "ข้อมูลการอนุมัติไม่ถูกต้อง" }, { status: 400 });
      }
      const sourceType = body.action === "APPROVE_TRANSACTION" ? "transaction" : "payroll_slip";
      const { data, error } = await decideTimePayrollPayment(supabase, sourceType, sourceId, payload);
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "CHANGE_EXPENSE_LOCATION") {
      const { source_type, source_id, expense_location_id, admin_comment } = payload;
      if (
        !["transaction", "payroll_slip"].includes(source_type)
        || !isUuid(source_id)
        || (expense_location_id !== null && !isUuid(expense_location_id))
        || payload.payment !== undefined
        || (admin_comment != null && typeof admin_comment !== "string")
      ) {
        return NextResponse.json({ error: "ข้อมูลการเปลี่ยนสาขาไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("change_time_tracking_expense_location", {
        p_source_type: source_type,
        p_source_id: source_id,
        p_expense_location_id: expense_location_id,
        p_comment: admin_comment || null,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "CHANGE_PAYMENT_ALLOCATION") {
      if (!isValidTimePayrollPaymentChange(payload)) {
        return NextResponse.json({ error: "ข้อมูลการเปลี่ยนวิธีจ่ายไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await changeTimePayrollPayment(supabase, payload);
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "UPDATE_WAGE") {
      const { user_id, daily_wage } = payload;
      const parsedDailyWage = parseDailyWageInput(daily_wage);
      if (!isUuid(user_id) || parsedDailyWage === null) {
        return NextResponse.json({ error: "ข้อมูลค่าแรงไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("update_time_tracking_wage", {
        p_profile_id: user_id,
        p_daily_wage: parsedDailyWage,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "PREVIEW_WAGE_RECALCULATION") {
      const { user_id, daily_wage } = payload;
      const parsedDailyWage = parseDailyWageInput(daily_wage);
      if (!isUuid(user_id) || parsedDailyWage === null) {
        return NextResponse.json({ error: "ข้อมูลค่าแรงไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("preview_time_tracking_wage_recalculation", {
        p_profile_id: user_id,
        p_daily_wage: parsedDailyWage,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ preview: data });
    }

    if (body.action === "COMMIT_WAGE_RECALCULATION") {
      const { user_id, daily_wage, expected_digest } = payload;
      const parsedDailyWage = parseDailyWageInput(daily_wage);
      if (
        !isUuid(user_id)
        || parsedDailyWage === null
        || typeof expected_digest !== "string"
        || !SHA256_PATTERN.test(expected_digest)
      ) {
        return NextResponse.json({ error: "ข้อมูลยืนยันค่าแรงไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("commit_time_tracking_wage_recalculation", {
        p_profile_id: user_id,
        p_daily_wage: parsedDailyWage,
        p_expected_digest: expected_digest,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "REPLACE_ATTENDANCE_EXCEPTIONS") {
      const { user_id, month, selections } = payload;
      if (
        !isUuid(user_id)
        || typeof month !== "string"
        || !ISO_MONTH_PATTERN.test(month)
        || !hasValidAttendanceSelections(selections, month)
      ) {
        return NextResponse.json({ error: "ข้อมูลข้อยกเว้นวันทำงานไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("replace_time_payroll_attendance_exceptions", {
        p_profile_id: user_id,
        p_month: month,
        p_selections: selections,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "UPDATE_TIME_PAYROLL_CONFIG") {
      if (result.auth.role !== "super_admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      const { workday_end_time } = payload;
      if (typeof workday_end_time !== "string") {
        return NextResponse.json({ error: "เวลาสิ้นสุดวันไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("update_time_payroll_config", {
        p_workday_end_time: workday_end_time,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, settings: data });
    }

    if (body.action === "SET_PAYROLL_ACTIVE_PERIOD") {
      const { user_id, action, effective_date } = payload;
      if (
        !isUuid(user_id)
        || !["ENABLE", "PAUSE", "RESUME", "END"].includes(action)
        || !isIsoDate(effective_date)
      ) {
        return NextResponse.json({ error: "ข้อมูลช่วงเงินเดือนไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("set_time_payroll_active_period", {
        p_profile_id: user_id,
        p_action: action,
        p_effective_date: effective_date,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "CORRECT_PAYROLL_PERIOD_START") {
      const { user_id, period_id, start_on } = payload;
      if (!isUuid(user_id) || !isUuid(period_id) || !isIsoDate(start_on)) {
        return NextResponse.json({ error: "ข้อมูลวันเริ่มช่วงทำงานไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("correct_time_payroll_period_start", {
        p_profile_id: user_id,
        p_period_id: period_id,
        p_start_on: start_on,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "CANCEL_PAYROLL_ACTIVE_PERIOD_SCHEDULE") {
      const { user_id } = payload;
      if (!isUuid(user_id)) {
        return NextResponse.json({ error: "รหัสพนักงานไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("cancel_time_payroll_active_period_schedule", {
        p_profile_id: user_id,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "PREVIEW_PAYROLL_SLIP") {
      if (!isUuid(payload.user_id) || typeof payload.month !== "string" || !ISO_MONTH_PATTERN.test(payload.month)) {
        return NextResponse.json({ error: "ข้อมูลสลิปไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("preview_time_tracking_payroll_slip", {
        p_profile_id: payload.user_id,
        p_month: payload.month,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ preview: data });
    }

    if (body.action === "CREATE_PAYROLL_SLIP") {
      const { user_id, month } = payload;
      if (!isUuid(user_id) || typeof month !== "string" || !ISO_MONTH_PATTERN.test(month)
        || payload.expense_location_id !== undefined
        || (payload.admin_comment != null && typeof payload.admin_comment !== "string")
        || !isValidPayrollSlipCreationPayment(payload)) {
        return NextResponse.json({ error: "ข้อมูลสลิปไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await createTimePayrollSlip(supabase, payload);
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, slip: data });
    }

    if (body.action === "LIST_PAYROLL_SLIPS") {
      const { user_id } = payload;
      if (!isUuid(user_id)) {
        return NextResponse.json({ error: "รหัสพนักงานไม่ถูกต้อง" }, { status: 400 });
      }
      const slips = await readAllSupabaseRows((from, to) => supabase
        .from("payroll_slips")
        .select("id, profile_id, month, gross_pay, total_deductions, net_pay, status, created_at, history_creator_name, approved_at, cancelled_at, expense_location_id, expense_location_name, payment_channel, payment_transfer_amount, admin_comment, report_lock_no")
        .eq("profile_id", user_id)
        .order("month", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to));
      return NextResponse.json({ slips });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to mutate admin time/payroll data:", error);
    return NextResponse.json(
      { error: "ดำเนินการข้อมูลเวลาและเงินเดือนไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
