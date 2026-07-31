import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function rpcErrorStatus(message: string) {
  if (/Authentication required/i.test(message)) return 401;
  if (/Forbidden|access denied/i.test(message)) return 403;
  if (/MONTH_CLOSED|DEDUCTION_LOCKED|DEDUCTION_WAGE_LOCKED|PENDING_BLOCKER|OLDER_WORK_MONTH|DELETE_NEWER_SLIP_FIRST|REPORT_LOCKED|already been decided/i.test(message)) return 409;
  return 400;
}

function rpcErrorMessage(message: string) {
  const reportNo = message.match(/REPORT_LOCKED:([A-Z0-9-]+)/i)?.[1];
  if (reportNo) return `ล็อกโดยรายงาน ${reportNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`;

  const closedMonth = message.match(/MONTH_CLOSED:([0-9]{4}-[0-9]{2})/)?.[1];
  if (closedMonth) return `เดือน ${closedMonth} มีสลิปเงินเดือนแล้ว กรุณาลบสลิปก่อน`;

  const deductionMonth = message.match(/DEDUCTION_LOCKED:([0-9]{4}-[0-9]{2})/)?.[1];
  if (deductionMonth) return `เดือน ${deductionMonth} มีรายการหักเงินจริงแล้ว จึงแก้วันทำงานย้อนหลังไม่ได้`;
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
  if (/DESCRIPTION_REQUIRED/i.test(message)) return "กรุณาระบุรายละเอียดหนี้";
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

function bangkokCurrentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  if (!result.auth.canAccessSystemManager) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const [
      usersResult,
      pendingTransactionsResult,
      pendingSlipsResult,
      managersResult,
      schedulesResult,
      currentSlipsResult,
    ] = await Promise.all([
      result.supabase.from("profiles").select(`
        id, name, phone, daily_wage, role, is_active,
        time_segments(id, start_time, end_time, report_lock_no)
      `),
      result.supabase
        .from("financial_transactions")
        .select("id, profile_id, amount, effective_date, created_at, type, description, profiles!inner!financial_transactions_profile_id_fkey(name, role)")
        .eq("status", "PENDING")
        .in("type", ["DEBT", "WITHDRAWAL"])
        .order("effective_date", { ascending: true })
        .order("created_at", { ascending: true }),
      result.supabase
        .from("payroll_slips")
        .select("id, profile_id, month, net_pay, created_at, profiles!inner!payroll_slips_profile_id_fkey(name, role)")
        .eq("status", "PENDING"),
      result.supabase
        .from("profiles")
        .select("id, name, role, can_access_super_admin_features")
        .eq("is_active", true),
      result.supabase
        .from("time_tracking_resume_schedules")
        .select("profile_id, payroll_slip_id, resume_at"),
      result.supabase
        .from("payroll_slips")
        .select("profile_id")
        .eq("month", bangkokCurrentMonth()),
    ]);

    if (usersResult.error) throw usersResult.error;
    if (pendingTransactionsResult.error) throw pendingTransactionsResult.error;
    if (pendingSlipsResult.error) throw pendingSlipsResult.error;
    if (managersResult.error) throw managersResult.error;
    if (schedulesResult.error) throw schedulesResult.error;
    if (currentSlipsResult.error) throw currentSlipsResult.error;

    const users = usersResult.data || [];
    const userIds = users.map((user) => user.id);
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

    const schedules = new Map(
      (schedulesResult.data || []).map((schedule) => [schedule.profile_id, schedule]),
    );
    const currentClosedProfiles = new Set(
      (currentSlipsResult.data || []).map((slip) => slip.profile_id),
    );

    return NextResponse.json({
      users: users.map((user) => ({
        ...user,
        debt_remaining_amount: debtTotals.get(user.id) || 0,
        resume_schedule: schedules.get(user.id) || null,
        current_month_closed: currentClosedProfiles.has(user.id),
      })),
      pendingTransactions: pendingTransactionsResult.data || [],
      pendingSlips: pendingSlipsResult.data || [],
      admins: (managersResult.data || [])
        .filter((profile) => profile.role === "super_admin" || profile.can_access_super_admin_features === true)
        .map(({ id, name }) => ({ id, name })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  if (!result.auth.canAccessSystemManager) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const payload = body?.payload || {};
  const supabase = result.supabase;

  try {
    if (body.action === "GET_AUDIT_LOGS") {
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

    if (body.action === "TOGGLE_TRACKING") {
      const { user_id, status } = payload;
      if (!isUuid(user_id) || !["RUNNING", "PAUSED"].includes(status)) {
        return NextResponse.json({ error: "ข้อมูลสถานะเวลาไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("set_time_tracking_status", {
        p_profile_id: user_id,
        p_status: status,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "CUTOFF_TRACKING") {
      const { user_id, cutoff_time } = payload;
      if (!isUuid(user_id) || typeof cutoff_time !== "string") {
        return NextResponse.json({ error: "ข้อมูลตัดรอบเวลาไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("cutoff_time_tracking", {
        p_profile_id: user_id,
        p_cutoff_time: cutoff_time,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
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
      const { status, admin_comment, expense_location_id } = payload;
      if (
        !isUuid(sourceId)
        || !["APPROVED", "REJECTED"].includes(status)
        || (expense_location_id && !isUuid(expense_location_id))
      ) {
        return NextResponse.json({ error: "ข้อมูลการอนุมัติไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("decide_time_tracking_approval", {
        p_source_type: body.action === "APPROVE_TRANSACTION" ? "transaction" : "payroll_slip",
        p_source_id: sourceId,
        p_decision: status,
        p_comment: admin_comment || null,
        p_expense_location_id: expense_location_id || null,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "CHANGE_EXPENSE_LOCATION") {
      const { source_type, source_id, expense_location_id, admin_comment } = payload;
      if (
        !["transaction", "payroll_slip"].includes(source_type)
        || !isUuid(source_id)
        || !isUuid(expense_location_id)
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
      const { user_id, daily_wage } = payload;
      if (!isUuid(user_id) || typeof daily_wage !== "number") {
        return NextResponse.json({ error: "ข้อมูลค่าแรงไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("update_time_tracking_wage", {
        p_profile_id: user_id,
        p_daily_wage: daily_wage,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "GET_LOCKED_DATES") {
      const { user_id } = payload;
      if (!isUuid(user_id)) {
        return NextResponse.json({ error: "รหัสพนักงานไม่ถูกต้อง" }, { status: 400 });
      }

      const lockedDates: Record<string, string> = {};
      const [{ data: deductions, error: deductionError }, { data: slips, error: slipError }, { data: segments, error: segmentError }] = await Promise.all([
        supabase
          .from("financial_transactions")
          .select("applied_month")
          .eq("profile_id", user_id)
          .eq("status", "APPROVED")
          .in("type", ["DEBT_DEDUCTION", "WITHDRAWAL_DEDUCTION"])
          .not("applied_month", "is", null),
        supabase.from("payroll_slips").select("month").eq("profile_id", user_id),
        supabase
          .from("time_segments")
          .select("start_time, report_lock_no")
          .eq("profile_id", user_id)
          .not("end_time", "is", null),
      ]);
      if (deductionError) throw deductionError;
      if (slipError) throw slipError;
      if (segmentError) throw segmentError;

      const deductionMonths = new Set(
        (deductions || []).map((item) => item.applied_month?.slice(0, 7)).filter(Boolean),
      );
      for (const month of deductionMonths) {
        const [year, monthNumber] = month!.split("-").map(Number);
        const daysInMonth = new Date(year, monthNumber, 0).getDate();
        for (let day = 1; day <= daysInMonth; day += 1) {
          lockedDates[`${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`] = "DEDUCTION";
        }
      }
      for (const segment of segments || []) {
        const date = new Date(segment.start_time)
          .toLocaleString("sv", { timeZone: "Asia/Bangkok" })
          .split(" ")[0];
        const month = date.slice(0, 7);
        if (segment.report_lock_no) lockedDates[date] = `REPORT:${segment.report_lock_no}`;
      }

      for (const slip of slips || []) {
        const [year, month] = slip.month.split("-").map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let day = 1; day <= daysInMonth; day += 1) {
          lockedDates[`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`] = "SLIP";
        }
      }

      return NextResponse.json({ lockedDates });
    }

    if (body.action === "ADD_BULK_SEGMENTS") {
      const { user_id, selections, full_snapshot, admin_comment } = payload;
      if (!isUuid(user_id) || !Array.isArray(selections)) {
        return NextResponse.json({ error: "ข้อมูลวันทำงานไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("replace_time_tracking_segments", {
        p_profile_id: user_id,
        p_selections: selections,
        p_full_snapshot: full_snapshot || {},
        p_comment: admin_comment || null,
      });
      if (error) return rpcFailure(error);
      return NextResponse.json({ success: true, result: data });
    }

    if (body.action === "CREATE_PAYROLL_SLIP") {
      const { user_id, month, auto_start_next_month } = payload;
      if (!isUuid(user_id) || typeof month !== "string") {
        return NextResponse.json({ error: "ข้อมูลสลิปไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("create_time_tracking_payroll_slip", {
        p_profile_id: user_id,
        p_month: month,
        p_auto_start_next_month: auto_start_next_month !== false,
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
        .select("*, report_lock_no, approver:profiles!payroll_slips_approved_by_fkey(name)")
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
