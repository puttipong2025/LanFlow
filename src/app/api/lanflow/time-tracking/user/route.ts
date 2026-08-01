import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

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

function bangkokMonthBounds() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const start = `${year}-${String(month).padStart(2, "0")}-01T00:00:00+07:00`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+07:00`;
  return { start, end, month: `${year}-${String(month).padStart(2, "0")}` };
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
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
    const { start, end, month } = bangkokMonthBounds();
    const supabase = result.supabase;
    const [
      activeSegment,
      transactions,
      profile,
      paidDays,
      activeDebts,
      deductions,
      slips,
      resumeSchedule,
    ] = await Promise.all([
      supabase
        .from("time_segments")
        .select("id, start_time, end_time, report_lock_no")
        .eq("profile_id", targetUserId)
        .is("end_time", null)
        .maybeSingle(),
      supabase
        .from("financial_transactions")
        .select("*, report_lock_no, approver:profiles!financial_transactions_approved_by_fkey(name)")
        .eq("profile_id", targetUserId)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("profiles").select("daily_wage").eq("id", targetUserId).single(),
      supabase.rpc("calculate_paid_work_days", {
        p_profile_id: targetUserId,
        p_period_start: start,
        p_period_end: end,
      }),
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
      supabase
        .from("time_tracking_resume_schedules")
        .select("profile_id, payroll_slip_id, resume_at")
        .eq("profile_id", targetUserId)
        .maybeSingle(),
    ]);

    for (const response of [
      activeSegment,
      transactions,
      profile,
      paidDays,
      activeDebts,
      deductions,
      slips,
      resumeSchedule,
    ]) {
      if (response.error) throw response.error;
    }

    const totalDays = Number(paidDays.data || 0);
    const grossPay = totalDays * Number(profile.data?.daily_wage || 0);
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
      timeTracking: {
        status: activeSegment.data ? "RUNNING" : "PAUSED",
        start_time: activeSegment.data?.start_time || null,
        resume_schedule: resumeSchedule.data || null,
      },
      wageInfo: {
        totalDays,
        grossPay,
        remainingBalance: Math.max(grossPay - usedThisMonth, 0),
        totalDebt,
      },
      debts: activeDebts.data || [],
      transactions: transactions.data || [],
      deductions: deductions.data || [],
      slips: slips.data || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const body = await request.json();
  const payload = body?.payload || {};
  const supabase = result.supabase;

  if (body.action === "REQUEST_WITHDRAWAL") {
    const { amount, effective_date } = payload;
    if (typeof amount !== "number" || typeof effective_date !== "string") {
      return NextResponse.json({ error: "ข้อมูลรายการไม่ถูกต้อง" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("create_time_tracking_transaction", {
      p_profile_id: result.auth.sub,
      p_type: "WITHDRAWAL",
      p_amount: amount,
      p_effective_date: effective_date,
      p_description: null,
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
