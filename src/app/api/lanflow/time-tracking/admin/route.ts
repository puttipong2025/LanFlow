import { NextRequest, NextResponse } from "next/server";
import { bangkokDateString } from "@/lib/bangkok-date";
import { requireAuth } from "@/lib/server/auth";
import { buildPayrollPeriodState, type PayrollPeriodRow } from "@/lib/time-tracking/period-state";
import { parseDailyWageInput } from "@/lib/time-tracking/wage";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function rpcErrorStatus(message: string) {
  if (/Authentication required/i.test(message)) return 401;
  if (/Forbidden|access denied/i.test(message)) return 403;
  if (/MONTH_CLOSED|PENDING_PERIOD_ACTION|DEDUCTION_LOCKED|DEDUCTION_WAGE_LOCKED|PENDING_BLOCKER|OLDER_WORK_MONTH|DELETE_NEWER_SLIP_FIRST|REPORT_LOCKED|NO_PERIOD_HISTORY_TO_RESUME|RESUME_BEFORE_LAST_END_DATE|PERIOD_START_CORRECTION_STALE|already been decided/i.test(message)) return 409;
  return 400;
}

function rpcErrorMessage(message: string) {
  const reportLock = message.match(/REPORT_LOCKED:([A-Z0-9-]+)(?::PAYROLL_SLIP:([0-9]{4}-[0-9]{2}):([A-Z]+):([0-9a-f-]+))?/i);
  if (reportLock) {
    return reportLock[2]
      ? `เดือน ${reportLock[2]} ล็อกโดยรายงาน ${reportLock[1]} (${reportLock[3]}) — ต้องลบรายงานล่าสุดตามลำดับก่อน`
      : `ล็อกโดยรายงาน ${reportLock[1]} — ต้องลบรายงานล่าสุดตามลำดับก่อน`;
  }

  const closed = message.match(/MONTH_CLOSED:([0-9]{4}-[0-9]{2})(?::PAYROLL_SLIP:([A-Z]+):([0-9a-f-]+))?/i);
  if (closed) {
    return closed[2]
      ? `เดือน ${closed[1]} มีสลิปเงินเดือนสถานะ ${closed[2]} (รายการ ${closed[3]}) กรุณาลบสลิปก่อน`
      : `เดือน ${closed[1]} มีสลิปเงินเดือนแล้ว กรุณาลบสลิปก่อน`;
  }

  const pendingPeriodMonth = message.match(/PENDING_PERIOD_ACTION:([0-9]{4}-[0-9]{2})/)?.[1];
  if (pendingPeriodMonth) return `เดือน ${pendingPeriodMonth} มีการเปลี่ยนสถานะเงินเดือนรอมีผล กรุณายกเลิกหรือเปลี่ยนกำหนดการก่อนสร้างสลิป`;

  const deduction = message.match(/DEDUCTION_LOCKED:([0-9]{4}-[0-9]{2})(?::([A-Z_]+):([0-9a-f-]+))?/i);
  if (deduction) {
    const label = deduction[2] === "WITHDRAWAL_DEDUCTION" ? "หักเงินเบิก" : "หักหนี้";
    return deduction[3]
      ? `เดือน ${deduction[1]} มีรายการ${label}เงินจริงแล้ว (รายการ ${deduction[3]}) จึงแก้วันทำงานย้อนหลังไม่ได้`
      : `เดือน ${deduction[1]} มีรายการหักเงินจริงแล้ว จึงแก้วันทำงานย้อนหลังไม่ได้`;
  }
  if (/DEDUCTION_WAGE_LOCKED/i.test(message)) return "มีเดือนที่หักเงินจริงแล้วแต่ยังไม่ได้ออกสลิป จึงแก้ค่าแรงไม่ได้";

  const pending = message.match(/PENDING_BLOCKER:(DEBT|WITHDRAWAL):([0-9a-f-]+):([0-9]{4}-[0-9]{2})/i);
  if (pending) {
    const label = pending[1].toUpperCase() === "DEBT" ? "หนี้" : "เบิกเงิน";
    return `ยังมีรายการ${label}เดือน ${pending[3]} รออนุมัติ กรุณาอนุมัติ ปฏิเสธ หรือลบก่อน`;
  }

  const olderMonth = message.match(/OLDER_WORK_MONTH:([0-9]{4}-[0-9]{2})/)?.[1];
  if (olderMonth) return `ต้องสร้างสลิปเดือน ${olderMonth} ก่อน`;

  const newerMonth = message.match(/DELETE_NEWER_SLIP_FIRST:([0-9]{4}-[0-9]{2})/)?.[1];
  if (newerMonth) return `ต้องลบสลิปเดือน ${newerMonth} ก่อน`;

  const noWorkMonth = message.match(/NO_WORK_MONTH:([0-9]{4}-[0-9]{2})/)?.[1];
  if (noWorkMonth) return `เดือน ${noWorkMonth} ไม่มีวันทำงาน จึงไม่ต้องสร้างสลิป`;

  if (/FUTURE_EFFECTIVE_DATE/i.test(message)) return "วันที่รายการต้องไม่เกินวันปัจจุบัน";
  if (/END_DATE_IN_PAST/i.test(message)) return "สิ้นสุดงานย้อนหลังไม่ได้ กรุณาเลือกวันนี้หรือวันในอนาคต";
  const overlapEnd = message.match(/RESUME_OVERLAPS_PREVIOUS_PERIOD:([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
  if (overlapEnd) return `วันที่กลับเข้าทำงานต้องหลังช่วงเดิมซึ่งสิ้นสุด ${overlapEnd}`;
  const lastEndDate = message.match(/RESUME_BEFORE_LAST_END_DATE:([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
  if (lastEndDate) return `วันที่กลับเข้าทำงานต้องไม่ก่อนวันที่สิ้นสุดล่าสุด ${lastEndDate}`;
  if (/NO_PERIOD_HISTORY_TO_RESUME/i.test(message)) return "ไม่พบประวัติช่วงทำงานเดิม กรุณาใช้เปิดใช้เงินเดือน";
  if (/NO_RESUME_PERIOD_TO_CORRECT/i.test(message)) return "แก้ได้เฉพาะช่วงทำงานปัจจุบันที่สร้างจากการกลับเข้าทำงานล่าสุด";
  if (/INVALID_RESUME_CORRECTION/i.test(message)) return "กรุณาเลือกวันกลับเข้าทำงานใหม่ที่ต่างจากวันเดิม";
  if (/RESUME_CORRECTION_DATE_IN_FUTURE/i.test(message)) return "วันกลับเข้าทำงานใหม่ต้องไม่เกินวันนี้";
  if (/RESUME_CORRECTION_AFTER_PENDING_ACTION/i.test(message)) return "วันกลับเข้าทำงานใหม่ต้องอยู่ก่อนกำหนดการพักหรือสิ้นสุดงาน";
  if (/PERIOD_START_CORRECTION_STALE/i.test(message)) return "ช่วงทำงานเปลี่ยนแล้ว กรุณารีเฟรชและตรวจสอบช่วงล่าสุดอีกครั้ง";
  if (/NO_PERIOD_START_TO_CORRECT/i.test(message)) return "ไม่พบช่วงทำงานล่าสุดที่แก้วันเริ่มได้ กรุณารีเฟรชข้อมูล";
  if (/INVALID_PERIOD_START_CORRECTION/i.test(message)) return "กรุณาเลือกวันเริ่มใหม่ที่ต่างจากวันเดิม";
  const periodOverlapEnd = message.match(/PERIOD_START_OVERLAPS_PREVIOUS:([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
  if (periodOverlapEnd) return `วันเริ่มใหม่ต้องหลังช่วงก่อนหน้าซึ่งสิ้นสุด ${periodOverlapEnd}`;
  if (/PERIOD_START_CORRECTION_DATE_IN_FUTURE/i.test(message)) return "วันเริ่มใหม่ต้องไม่เกินวันนี้";
  const correctionEnd = message.match(/PERIOD_START_CORRECTION_AFTER_END:([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
  if (correctionEnd) return `วันเริ่มใหม่ต้องไม่เกินวันสิ้นสุดช่วง ${correctionEnd}`;
  if (/FUTURE_ATTENDANCE_DATE/i.test(message)) return "ช่วงวันที่แก้ปฏิทินต้องไม่เกินวันปัจจุบัน";
  if (/ACTIVE_PERIOD_ALREADY_OPEN/i.test(message)) return "พนักงานคนนี้มีช่วงทำงานที่เปิดอยู่แล้ว กรุณารีเฟรชข้อมูล";
  if (/NO_OPEN_ACTIVE_PERIOD/i.test(message)) return "ไม่พบช่วงทำงานที่เปิดอยู่ หรือวันที่มีผลไม่ต่อเนื่องกับช่วงเดิม";
  if (/NO_PENDING_PERIOD_ACTION/i.test(message)) return "ไม่พบกำหนดการรอมีผล กรุณารีเฟรชข้อมูล";
  if (/DATE_OUTSIDE_ACTIVE_PERIOD/i.test(message)) return "ช่วงวันที่อยู่นอกช่วงทำงานของพนักงาน กรุณาเปิดหรือกลับเข้าทำงานก่อน";
  if (/PRIMARY_BRANCH_REQUIRED/i.test(message)) return "พนักงานบางคนไม่มีสาขาหลักที่ใช้งานอยู่ กรุณาตั้งค่าสาขาหลักก่อน";
  if (/DESCRIPTION_REQUIRED/i.test(message)) return "กรุณาระบุรายละเอียดหนี้";
  if (/INVALID_WAGE_PRECISION|INVALID_WAGE/i.test(message)) return "ค่าแรงต้องเป็น 0 ขึ้นไปและมีทศนิยมไม่เกิน 4 ตำแหน่ง";
  if (/INVALID_AMOUNT/i.test(message)) return "จำนวนเงินต้องมากกว่า 0";
  if (/INVALID_MONTH/i.test(message)) return "เดือนไม่ถูกต้องหรือเป็นเดือนในอนาคต";
  if (/Expense location.*access denied|New expense location access denied/i.test(message)) return "คุณไม่มีสิทธิ์ดูแลสาขาค่าใช้จ่ายที่เลือก";
  if (/Expense location is not valid/i.test(message)) return "รายการนี้ไม่ต้องเลือกสาขาค่าใช้จ่าย";
  if (/already been decided/i.test(message)) return "รายการนี้ถูกตัดสินแล้ว กรุณารีเฟรชข้อมูล";
  if (/Forbidden/i.test(message)) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  return "ไม่สามารถทำรายการได้ กรุณาลองใหม่";
}

function rpcFailure(error: { message: string }) {
  return NextResponse.json(
    { error: rpcErrorMessage(error.message) },
    { status: rpcErrorStatus(error.message) },
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
    const canDecide = result.auth.canAccessSystemManager;
    const [
      usersResult,
      pendingTransactionsResult,
      pendingSlipsResult,
      managersResult,
      paymentLocationsResult,
      settingsResult,
      activePeriodsResult,
    ] = await Promise.all([
      result.supabase.from("profiles").select(`
        id, name, phone, daily_wage, role, is_active, can_access_super_admin_features,
        user_locations!user_locations_user_id_fkey(location_id, is_primary, locations!inner(is_active))
      `),
      result.supabase
        .from("financial_transactions")
        .select("id, profile_id, amount, effective_date, created_at, type, description, profiles!financial_transactions_profile_id_fkey!inner(name, role)")
        .eq("status", "PENDING")
        .in("type", ["DEBT", "WITHDRAWAL"])
        .order("effective_date", { ascending: true })
        .order("created_at", { ascending: true }),
      result.supabase
        .from("payroll_slips")
        .select("id, profile_id, month, net_pay, created_at, profiles!payroll_slips_profile_id_fkey!inner(name, role)")
        .eq("status", "PENDING"),
      result.supabase
        .from("profiles")
        .select("id, name, role, can_access_super_admin_features")
        .eq("is_active", true),
      result.supabase.rpc("get_time_payroll_payment_locations"),
      result.supabase.rpc("get_time_payroll_settings"),
      result.supabase
        .from("time_payroll_active_periods")
        .select("id, profile_id, start_on, end_on, scheduled_action, scheduled_effective_on, scheduled_activation_on")
        .order("start_on", { ascending: false }),
    ]);

    if (usersResult.error) throw usersResult.error;
    if (pendingTransactionsResult.error) throw pendingTransactionsResult.error;
    if (pendingSlipsResult.error) throw pendingSlipsResult.error;
    if (managersResult.error) throw managersResult.error;
    if (paymentLocationsResult.error) throw paymentLocationsResult.error;
    if (settingsResult.error) throw settingsResult.error;
    if (activePeriodsResult.error) throw activePeriodsResult.error;

    const users = (usersResult.data || []).filter((user) => {
      if (user.id === result.auth.sub) return true;
      if (result.auth.canAccessSystemManager) return true;
      const primaryLocationId = activePrimaryLocationId(user.user_locations);
      return ["user", "admin"].includes(user.role)
        && user.can_access_super_admin_features !== true
        && !!primaryLocationId
        && result.auth.locationIds.includes(primaryLocationId);
    });
    const userIds = users.map((user) => user.id);
    const allowedUserIds = new Set(userIds);
    const debtTotals = new Map<string, number>();

    if (userIds.length > 0) {
      const { data: activeDebts, error } = await result.supabase
        .from("financial_transactions")
        .select("profile_id, remaining_amount")
        .in("profile_id", userIds)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .eq("status", "APPROVED")
        .gt("remaining_amount", 0);
      if (error) throw error;

      for (const debt of activeDebts || []) {
        debtTotals.set(
          debt.profile_id,
          (debtTotals.get(debt.profile_id) || 0) + Number(debt.remaining_amount || 0),
        );
      }

    }

    const periodsByUser = new Map<string, PayrollPeriodRow[]>();
    for (const period of activePeriodsResult.data || []) {
      const periods = periodsByUser.get(period.profile_id) || [];
      periods.push(period as PayrollPeriodRow);
      periodsByUser.set(period.profile_id, periods);
    }
    const today = bangkokDateString();

    return NextResponse.json({
      settings: settingsResult.data,
      permissions: {
        canManage: result.auth.canManageTimePayroll,
        canDecide,
        canConfigure: canDecide,
      },
      users: users.map((user) => {
        const periodState = buildPayrollPeriodState(periodsByUser.get(user.id) || [], today);
        return {
          ...user,
          primary_location_id: activePrimaryLocationId(user.user_locations),
          user_locations: undefined,
          debt_remaining_amount: debtTotals.get(user.id) || 0,
          period_state: periodState,
        };
      }),
      pendingTransactions: canDecide
        ? (pendingTransactionsResult.data || []).filter((item) => allowedUserIds.has(item.profile_id))
        : [],
      pendingSlips: canDecide
        ? (pendingSlipsResult.data || []).filter((item) => allowedUserIds.has(item.profile_id))
        : [],
      admins: result.auth.canAccessSystemManager ? (managersResult.data || [])
        .filter((profile) => profile.role === "super_admin" || profile.can_access_super_admin_features === true)
        .map(({ id, name }) => ({ id, name })) : [{ id: result.auth.sub, name: result.auth.name }],
      paymentLocations: paymentLocationsResult.data || [],
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String(error.message)
        : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  if (!result.auth.canManageTimePayroll) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: { action?: string; payload?: Record<string, any> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const payload = body?.payload || {};
  const supabase = result.supabase;

  try {
    if (body.action === "GET_AUDIT_LOGS") {
      if (!result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      const { admin_user_id, target_user_id, action_filter } = payload;
      let query = supabase
        .from("time_tracking_audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (admin_user_id) query = query.eq("admin_id", admin_user_id);
      if (target_user_id) query = query.eq("record_id", target_user_id);
      if (action_filter) query = query.eq("action", action_filter);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ logs: data || [] });
    }

    if (body.action === "CREATE_DEBT" || body.action === "ADMIN_REQUEST_WITHDRAWAL") {
      const { user_id, amount, effective_date, description } = payload;
      if (!isUuid(user_id) || typeof amount !== "number" || typeof effective_date !== "string") {
        return NextResponse.json({ error: "ข้อมูลรายการไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("create_time_tracking_transaction", {
        p_profile_id: user_id,
        p_type: body.action === "CREATE_DEBT" ? "DEBT" : "WITHDRAWAL",
        p_amount: amount,
        p_effective_date: effective_date,
        p_description: description || null,
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
      if (body.action === "DELETE_TRANSACTION" && !result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      if (body.action === "DELETE_PAYROLL_SLIP" && !result.auth.canAccessSystemManager) {
        const { data: pendingSlip, error: pendingSlipError } = await supabase
          .from("payroll_slips")
          .select("status, created_by")
          .eq("id", sourceId)
          .maybeSingle();
        if (
          pendingSlipError
          || pendingSlip?.status !== "PENDING"
          || pendingSlip.created_by !== result.auth.sub
        ) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
      }
      const { data, error } = await supabase.rpc("delete_time_tracking_source_permanently", {
        p_source_type: body.action === "DELETE_TRANSACTION" ? "transaction" : "payroll_slip",
        p_source_id: sourceId,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, deleted: true, result: data });
    }

    if (body.action === "APPROVE_TRANSACTION" || body.action === "APPROVE_PAYROLL_SLIP") {
      if (!result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      const sourceId = body.action === "APPROVE_TRANSACTION"
        ? payload.transaction_id
        : payload.slip_id;
      const { status, admin_comment, expense_location_id } = payload;
      if (
        !isUuid(sourceId)
        || !["APPROVED", "REJECTED"].includes(status)
        || (expense_location_id !== null && expense_location_id !== undefined && !isUuid(expense_location_id))
      ) {
        return NextResponse.json({ error: "ข้อมูลการอนุมัติไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("decide_time_tracking_approval", {
        p_source_type: body.action === "APPROVE_TRANSACTION" ? "transaction" : "payroll_slip",
        p_source_id: sourceId,
        p_decision: status,
        p_comment: admin_comment || null,
        p_expense_location_id: expense_location_id ?? null,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "CHANGE_EXPENSE_LOCATION") {
      if (!result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      const { source_type, source_id, expense_location_id, admin_comment } = payload;
      if (
        !["transaction", "payroll_slip"].includes(source_type)
        || !isUuid(source_id)
        || (expense_location_id !== null && !isUuid(expense_location_id))
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

    if (body.action === "UPDATE_WAGE") {
      if (!result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
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

    if (body.action === "REPLACE_ATTENDANCE_EXCEPTIONS") {
      const { user_id, month, selections } = payload;
      if (!isUuid(user_id) || typeof month !== "string" || !Array.isArray(selections)) {
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
      if (!result.auth.canAccessSystemManager) {
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
      if (!result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
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
      if (!result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
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
      if (!result.auth.canAccessSystemManager) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
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

    if (body.action === "CREATE_PAYROLL_SLIP") {
      const { user_id, month } = payload;
      if (!isUuid(user_id) || typeof month !== "string") {
        return NextResponse.json({ error: "ข้อมูลสลิปไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: user_id,
        p_month: month,
        p_auto_start_next_month: false,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, slip: data });
    }

    if (body.action === "LIST_PAYROLL_SLIPS") {
      const { user_id } = payload;
      if (!isUuid(user_id)) {
        return NextResponse.json({ error: "รหัสพนักงานไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase
        .from("payroll_slips")
        .select("id, profile_id, month, gross_pay, total_deductions, net_pay, status, created_at, approved_at, cancelled_at, expense_location_id, admin_comment, report_lock_no, approver:profiles!payroll_slips_approved_by_fkey(name)")
        .eq("profile_id", user_id)
        .order("month", { ascending: false });
      if (error) throw error;
      return NextResponse.json({ slips: data || [] });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
