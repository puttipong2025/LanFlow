import { NextRequest, NextResponse } from "next/server";
import { bangkokDateString } from "@/lib/bangkok-date";
import { requireAuth } from "@/lib/server/auth";
import { chunkUniqueIds } from "@/lib/server/chunk-ids";
import { buildPayrollPeriodState, type PayrollPeriodRow } from "@/lib/time-tracking/period-state";
import { readAllSupabaseRows } from "@/lib/supabase-pages";
import { readTimeTrackingActionRequest } from "../action-request";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcErrorStatus(message: string) {
  if (/Forbidden|access denied/i.test(message)) return 403;
  if (/MONTH_CLOSED|REPORT_LOCKED|ADJUSTMENT_(STALE|NO_OP|PENDING_EXISTS|ALREADY_DECIDED|BELOW_CLOSED_FLOOR)|already been decided/i.test(message)) return 409;
  return 400;
}

function rpcErrorMessage(message: string) {
  const closedMonth = message.match(/MONTH_CLOSED:([0-9]{4}-[0-9]{2})/)?.[1];
  if (closedMonth) return `เดือน ${closedMonth} มีสลิปเงินเดือนแล้ว กรุณาลบสลิปก่อน`;
  if (/FUTURE_EFFECTIVE_DATE/i.test(message)) return "วันที่รายการต้องไม่เกินวันปัจจุบัน";
  if (/INVALID_AMOUNT/i.test(message)) return "จำนวนเงินต้องมากกว่า 0";
  if (/INVALID_ADJUSTMENT_TARGET/i.test(message)) return "ยอดเบิกใหม่ต้องเป็น 0 ขึ้นไปและมีทศนิยมไม่เกิน 2 ตำแหน่ง";
  if (/WITHDRAWAL_NOT_REPORT_LOCKED/i.test(message)) return "ปรับยอดได้เฉพาะรายการเบิกที่ถูกล็อกโดยรายงานแล้ว";
  if (/ADJUSTMENT_PENDING_EXISTS/i.test(message)) return "รายการเบิกนี้มีคำขอปรับยอดรออนุมัติอยู่แล้ว";
  if (/ADJUSTMENT_NO_OP/i.test(message)) return "ยอดเบิกใหม่ต้องต่างจากยอดปัจจุบัน";
  if (/ADJUSTMENT_STALE/i.test(message)) return "ยอดเบิกปัจจุบันเปลี่ยนแล้ว กรุณารีเฟรชและตรวจยอดใหม่";
  const adjustmentFloor = message.match(/ADJUSTMENT_BELOW_CLOSED_FLOOR:([0-9.]+)/i)?.[1];
  if (adjustmentFloor) return `ยอดเบิกใหม่ต้องไม่น้อยกว่ายอดที่ปิดสลิปแล้ว ${adjustmentFloor} บาท`;
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
    if (!/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: "เดือนไม่ถูกต้อง" }, { status: 400 });
    }
    const supabase = result.supabase;
    const [
      transactions,
      actionableTransactions,
      activeDebts,
      deductions,
      slips,
      attendance,
      activePeriods,
      totals,
      adjustments,
      adjustmentSummaries,
    ] = await Promise.all([
      supabase
        .from("financial_transactions")
        .select("*, expense_location_name, report_lock_no, approver:profiles!financial_transactions_approved_by_fkey(name)")
        .eq("profile_id", targetUserId)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50),
      readAllSupabaseRows((from, to) => supabase
        .from("financial_transactions")
        .select("*, expense_location_name, report_lock_no, approver:profiles!financial_transactions_approved_by_fkey(name)")
        .eq("profile_id", targetUserId)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .eq("status", "PENDING")
        .is("cancelled_at", null)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)),
      readAllSupabaseRows((from, to) => supabase
        .from("financial_transactions")
        .select("id, type, amount, remaining_amount, effective_date, created_at, description")
        .eq("profile_id", targetUserId)
        .in("type", ["DEBT", "WITHDRAWAL"])
        .eq("status", "APPROVED")
        .is("cancelled_at", null)
        .gt("remaining_amount", 0)
        .order("effective_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)),
      readAllSupabaseRows((from, to) => supabase
        .from("financial_transactions")
        .select("id, type, amount, parent_debt_id, applied_month, created_at")
        .eq("profile_id", targetUserId)
        .eq("status", "APPROVED")
        .is("cancelled_at", null)
        .in("type", ["WITHDRAWAL_DEDUCTION", "DEBT_DEDUCTION"])
        .order("applied_month", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)),
      readAllSupabaseRows((from, to) => supabase
        .from("payroll_slips")
        .select("id, profile_id, month, gross_pay, total_deductions, net_pay, status, created_at, approved_at, cancelled_at, expense_location_id, expense_location_name, payment_channel, payment_transfer_amount, admin_comment, report_lock_no, approver:profiles!payroll_slips_approved_by_fkey(name)")
        .eq("profile_id", targetUserId)
        .order("month", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)),
      supabase.rpc("get_time_payroll_attendance_month", {
        p_profile_id: targetUserId,
        p_month: month,
      }),
      readAllSupabaseRows((from, to) => supabase
        .from("time_payroll_active_periods")
        .select("id, start_on, end_on, scheduled_action, scheduled_effective_on, scheduled_activation_on")
        .eq("profile_id", targetUserId)
        .order("start_on", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)),
      supabase.rpc("get_time_payroll_user_totals", {
        p_profile_id: targetUserId,
        p_month: month,
      }),
      readAllSupabaseRows((from, to) => supabase
        .from("financial_transactions")
        .select("id, parent_debt_id, amount, adjustment_base_amount, status, description, created_at, approved_at")
        .eq("profile_id", targetUserId)
        .eq("type", "ADJUSTMENT")
        .is("cancelled_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)),
      supabase.rpc("get_withdrawal_adjustment_summaries", {
        p_profile_id: targetUserId,
      }),
    ]);

    for (const response of [transactions, attendance, totals, adjustmentSummaries]) {
      if (response.error) throw response.error;
    }

    const recentTransactionRows = transactions.data || [];
    const actionableIds = new Set(actionableTransactions.map((row) => row.id));
    const transactionRows = [
      ...actionableTransactions,
      ...recentTransactionRows.filter((row) => !actionableIds.has(row.id)),
    ];
    const visibleIds = new Set(transactionRows.map((row) => row.id));
    const missingAdjustmentSourceIds = [...new Set(adjustments
      .map((row) => row.parent_debt_id)
      .filter((id): id is string => typeof id === "string" && !visibleIds.has(id)))];
    let adjustmentSourceRows: typeof transactionRows = [];
    if (missingAdjustmentSourceIds.length > 0) {
      const sourceChunks = await Promise.all(chunkUniqueIds(missingAdjustmentSourceIds).map(async (ids) => {
        const adjustmentSources = await supabase
          .from("financial_transactions")
          .select("*, expense_location_name, report_lock_no, approver:profiles!financial_transactions_approved_by_fkey(name)")
          .eq("profile_id", targetUserId)
          .eq("type", "WITHDRAWAL")
          .eq("status", "APPROVED")
          .in("id", ids);
        if (adjustmentSources.error) throw adjustmentSources.error;
        return adjustmentSources.data || [];
      }));
      adjustmentSourceRows = sourceChunks.flat();
    }

    const totalDays = Number(attendance.data?.summary?.paidDays || 0);
    const grossPay = Number(attendance.data?.summary?.grossPay || 0);
    const usedThisMonth = Number(totals.data?.usedThisMonth || 0);
    const totalDebt = Number(totals.data?.totalDebt || 0);
    const periodState = buildPayrollPeriodState(
      activePeriods as PayrollPeriodRow[],
      bangkokDateString(),
    );

    if (!periodState.hasPeriodHistory) {
      const lastEndDate = attendance.data?.lastEndOn;
      if (typeof lastEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lastEndDate)) {
        periodState.hasPeriodHistory = true;
        periodState.resumeEarliestOn = lastEndDate;
      }
    }

    return NextResponse.json({
      wageInfo: {
        totalDays,
        grossPay,
        remainingBalance: Math.max(grossPay - usedThisMonth, 0),
        totalDebt,
      },
      attendance: attendance.data,
      periodState,
      debts: activeDebts,
      transactions: result.auth.canManageTimePayroll
        ? [...transactionRows, ...adjustmentSourceRows]
        : [...transactionRows.filter((item) => item.status !== "REJECTED"), ...adjustmentSourceRows],
      deductions,
      slips: result.auth.canManageTimePayroll
        ? slips
        : slips.filter((item) => item.status !== "REJECTED"),
      adjustments,
      adjustmentSummaries: adjustmentSummaries.data || [],
    });
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "message" in error
      && typeof error.message === "string"
      && rpcErrorStatus(error.message) === 403
    ) {
      return rpcFailure({ message: error.message });
    }
    console.error("Failed to load employee time/payroll data:", error);
    return NextResponse.json(
      { error: "โหลดข้อมูลเวลาและเงินเดือนไม่สำเร็จ" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const result = await requireAuth(request, { allowUserLanflow: true });
  if (!result.ok) return result.response;

  const body = await readTimeTrackingActionRequest(request);
  if (!body) {
    return NextResponse.json({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const payload = body.payload;
  const supabase = result.supabase;

  if (body.action === "REQUEST_WITHDRAWAL") {
    const { amount } = payload;
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "ข้อมูลรายการไม่ถูกต้อง" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("request_time_tracking_withdrawal", {
      p_amount: amount,
    });
    if (error) return rpcFailure(error);
    return NextResponse.json({ success: true, result: data });
  }

  if (body.action === "REQUEST_WITHDRAWAL_ADJUSTMENT") {
    const { withdrawal_id, target_amount, reason } = payload;
    if (
      typeof withdrawal_id !== "string"
      || !UUID_PATTERN.test(withdrawal_id)
      || typeof target_amount !== "number"
      || !Number.isFinite(target_amount)
      || (reason != null && typeof reason !== "string")
    ) {
      return NextResponse.json({ error: "ข้อมูลปรับยอดเบิกไม่ถูกต้อง" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("request_time_tracking_withdrawal_adjustment", {
      p_withdrawal_id: withdrawal_id,
      p_target_amount: target_amount,
      p_expense_location_id: null,
      p_reason: typeof reason === "string" ? reason.slice(0, 500) : null,
    });
    if (error) return rpcFailure(error);
    return NextResponse.json({ success: true, result: data });
  }

  if (body.action === "WITHDRAW_WITHDRAWAL_ADJUSTMENT") {
    const { adjustment_id } = payload;
    if (typeof adjustment_id !== "string" || !UUID_PATTERN.test(adjustment_id)) {
      return NextResponse.json({ error: "รหัสคำขอไม่ถูกต้อง" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("withdraw_time_tracking_withdrawal_adjustment", {
      p_adjustment_id: adjustment_id,
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
