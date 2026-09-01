import { NextRequest, NextResponse } from "next/server";
import { bangkokDateString } from "@/lib/bangkok-date";
import { requireAuth } from "@/lib/server/auth";
import { buildPayrollPeriodState, type PayrollPeriodRow } from "@/lib/time-tracking/period-state";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcErrorStatus(message: string) {
  if (/Forbidden|access denied/i.test(message)) return 403;
  if (/MONTH_CLOSED|REPORT_LOCKED|already been decided/i.test(message)) return 409;
  return 400;
}

function rpcErrorMessage(message: string) {
  const closedMonth = message.match(/MONTH_CLOSED:([0-9]{4}-[0-9]{2})/)?.[1];
  if (closedMonth) return `เดือน ${closedMonth} มีสลิปเงินเดือนแล้ว กรุณาลบสลิปก่อน`;
  if (/FUTURE_EFFECTIVE_DATE/i.test(message)) return "วันที่รายการต้องไม่เกินวันปัจจุบัน";
  if (/INVALID_AMOUNT/i.test(message)) return "จำนวนเงินต้องมากกว่า 0";
  if (/PENDING_ONLY/i.test(message)) return "ลบได้เฉพาะรายการที่ยังรออนุมัติ";
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
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request, { allowUserLanflow: true });
  if (!result.ok) return result.response;

  const requestedUserId = new URL(request.url).searchParams.get("userId");
  const targetUserId = requestedUserId || result.auth.sub;
  if (
    !UUID_PATTERN.test(targetUserId)
    || (targetUserId !== result.auth.sub && !result.auth.canManageTimePayroll)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const month = new URL(request.url).searchParams.get("month") || bangkokCurrentMonth();
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: "เดือนไม่ถูกต้อง" }, { status: 400 });
    }
    const supabase = result.supabase;
    const [
      transactions,
      activeDebts,
      deductions,
      slips,
      attendance,
      activePeriods,
    ] = await Promise.all([
      supabase
        .from("financial_transactions")
        .select("*, report_lock_no, approver:profiles!financial_transactions_approved_by_fkey(name)")
        .eq("profile_id", targetUserId)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("financial_transactions")
        .select("id, type, amount, remaining_amount, effective_date, created_at, description")
        .eq("profile_id", targetUserId)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .eq("status", "APPROVED")
        .gt("remaining_amount", 0)
        .order("effective_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("financial_transactions")
        .select("id, type, amount, parent_debt_id, applied_month, created_at")
        .eq("profile_id", targetUserId)
        .eq("status", "APPROVED")
        .in("type", ["WITHDRAWAL_DEDUCTION", "DEBT_DEDUCTION"])
        .order("applied_month", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("payroll_slips")
        .select("*, report_lock_no, approver:profiles!payroll_slips_approved_by_fkey(name)")
        .eq("profile_id", targetUserId)
        .order("month", { ascending: false }),
      supabase.rpc("get_time_payroll_attendance_month", {
        p_profile_id: targetUserId,
        p_month: month,
      }),
      supabase
        .from("time_payroll_active_periods")
        .select("id, start_on, end_on, scheduled_action, scheduled_effective_on, scheduled_activation_on")
        .eq("profile_id", targetUserId)
        .order("start_on", { ascending: false }),
    ]);

    for (const response of [
      transactions,
      activeDebts,
      deductions,
      slips,
      attendance,
      activePeriods,
    ]) {
      if (response.error) throw response.error;
    }

    const totalDays = Number(attendance.data?.summary?.paidDays || 0);
    const grossPay = Number(attendance.data?.summary?.grossPay || 0);
    const usedThisMonth = (deductions.data || []).reduce(
      (sum, transaction) => transaction.applied_month === `${month}-01`
        ? sum + Number(transaction.amount || 0)
        : sum,
      0,
    );
    const totalDebt = (activeDebts.data || []).reduce(
      (sum, transaction) => sum + Number(transaction.remaining_amount || 0),
      0,
    );

    return NextResponse.json({
      wageInfo: {
        totalDays,
        grossPay,
        remainingBalance: Math.max(grossPay - usedThisMonth, 0),
        totalDebt,
      },
      attendance: attendance.data,
      periodState: buildPayrollPeriodState(
        (activePeriods.data || []) as PayrollPeriodRow[],
        bangkokDateString(),
      ),
      debts: activeDebts.data || [],
      transactions: result.auth.canManageTimePayroll
        ? transactions.data || []
        : (transactions.data || []).filter((item) => item.status !== "REJECTED"),
      deductions: deductions.data || [],
      slips: slips.data || [],
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
  const result = await requireAuth(request, { allowUserLanflow: true });
  if (!result.ok) return result.response;

  let body: { action?: string; payload?: Record<string, any> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const payload = body?.payload || {};
  const supabase = result.supabase;

  if (body.action === "REQUEST_WITHDRAWAL") {
    const { amount } = payload;
    if (typeof amount !== "number") {
      return NextResponse.json({ error: "ข้อมูลรายการไม่ถูกต้อง" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("request_time_tracking_withdrawal", {
      p_amount: amount,
    });
    if (error) return rpcFailure(error);
    return NextResponse.json({ success: true, result: data });
  }

  if (body.action === "DELETE_TRANSACTION") {
    const { transaction_id } = payload;
    if (typeof transaction_id !== "string" || !UUID_PATTERN.test(transaction_id)) {
      return NextResponse.json({ error: "รหัสรายการไม่ถูกต้อง" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("delete_time_tracking_source_permanently", {
      p_source_type: "transaction",
      p_source_id: transaction_id,
    });
    if (error) return rpcFailure(error);
    return NextResponse.json({ success: true, deleted: true, result: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
