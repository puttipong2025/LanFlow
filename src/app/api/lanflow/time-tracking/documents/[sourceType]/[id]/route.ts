import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAuth } from "@/lib/server/auth";
import {
  buildPayrollSlipDocument,
  buildWithdrawalSlipDocument,
  canCreateSlipDocument,
} from "@/lib/time-tracking/slip-document";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    start: `${month}-01T00:00:00+07:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+07:00`,
  };
}

function clipSegments(
  segments: Array<{ start_time: string; end_time: string | null }>,
  start: string,
  end: string,
) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return segments.flatMap((segment) => {
    if (!segment.end_time) return [];
    const clippedStart = Math.max(new Date(segment.start_time).getTime(), startMs);
    const clippedEnd = Math.min(new Date(segment.end_time).getTime(), endMs);
    if (clippedEnd <= clippedStart) return [];
    return [{
      start_time: new Date(clippedStart).toISOString(),
      end_time: new Date(clippedEnd).toISOString(),
    }];
  });
}

async function sourceMetadata(
  supabase: SupabaseClient,
  source: {
    profile_id: string;
    approved_by: string | null;
    expense_location_id: string | null;
  },
) {
  const [profile, approver, location] = await Promise.all([
    supabase.from("profiles").select("name, daily_wage").eq("id", source.profile_id).maybeSingle(),
    source.approved_by
      ? supabase.from("profiles").select("name").eq("id", source.approved_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    source.expense_location_id
      ? supabase.from("locations").select("name").eq("id", source.expense_location_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (profile.error) throw profile.error;
  if (approver.error) throw approver.error;
  if (location.error) throw location.error;
  if (!profile.data) return null;

  return {
    employeeName: profile.data.name as string,
    dailyWage: Number(profile.data.daily_wage) || 0,
    approverName: approver.data?.name as string | undefined,
    paymentLabel: location.data?.name
      ? `จ่ายโดยสาขา ${location.data.name}`
      : "ส่วนกลางจ่าย (จ่ายนอกระบบ)",
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceType: string; id: string }> },
) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const { sourceType, id } = await params;
  if (!UUID_PATTERN.test(id) || (sourceType !== "withdrawal" && sourceType !== "payroll")) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
  }

  try {
    if (sourceType === "payroll") {
      const sourceResponse = await result.supabase
        .from("payroll_slips")
        .select("id, profile_id, month, gross_pay, total_deductions, net_pay, total_days, daily_wage, slip_data, status, approved_by, admin_comment, created_at, expense_location_id, approved_at, cancelled_at")
        .eq("id", id)
        .maybeSingle();
      if (sourceResponse.error) throw sourceResponse.error;
      const source = sourceResponse.data;
      if (!source || !canCreateSlipDocument(source.status, source.cancelled_at)) {
        return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
      }

      const metadata = await sourceMetadata(result.supabase, source);
      if (!metadata) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });

      return NextResponse.json(buildPayrollSlipDocument({
        source: {
          ...source,
          status: source.status as "PENDING" | "APPROVED",
          approver_name: metadata.approverName,
          payment_label: source.status === "APPROVED"
            ? Number(source.net_pay) > 0
              ? metadata.paymentLabel
              : "ไม่มีการจ่าย (ยอดสุทธิ 0 บาท)"
            : null,
        },
        employeeName: metadata.employeeName,
        generatedAt: new Date().toISOString(),
      }));
    }

    const sourceResponse = await result.supabase
      .from("financial_transactions")
      .select("id, profile_id, type, amount, status, admin_comment, created_at, remaining_amount, approved_by, expense_location_id, approved_at, cancelled_at, effective_date, description")
      .eq("id", id)
      .eq("type", "WITHDRAWAL")
      .maybeSingle();
    if (sourceResponse.error) throw sourceResponse.error;
    const source = sourceResponse.data;
    if (!source || !canCreateSlipDocument(source.status, source.cancelled_at)) {
      return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
    }

    const month = source.effective_date.slice(0, 7);
    const { start, end } = monthBounds(month);
    const [metadata, paidDays, segmentsResponse, deductionsResponse] = await Promise.all([
      sourceMetadata(result.supabase, source),
      result.supabase.rpc("calculate_paid_work_days", {
        p_profile_id: source.profile_id,
        p_period_start: start,
        p_period_end: end,
      }),
      result.supabase
        .from("time_segments")
        .select("start_time, end_time")
        .eq("profile_id", source.profile_id)
        .not("end_time", "is", null)
        .gt("end_time", start)
        .lt("start_time", end)
        .order("start_time", { ascending: true }),
      result.supabase
        .from("financial_transactions")
        .select("amount")
        .eq("profile_id", source.profile_id)
        .eq("status", "APPROVED")
        .in("type", ["WITHDRAWAL_DEDUCTION", "DEBT_DEDUCTION"])
        .eq("applied_month", `${month}-01`),
    ]);
    if (!metadata) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
    if (paidDays.error) throw paidDays.error;
    if (segmentsResponse.error) throw segmentsResponse.error;
    if (deductionsResponse.error) throw deductionsResponse.error;

    const existingDeductions = (deductionsResponse.data || []).reduce(
      (sum, deduction) => sum + Number(deduction.amount || 0),
      0,
    );
    return NextResponse.json(buildWithdrawalSlipDocument({
      source: {
        ...source,
        status: source.status as "PENDING" | "APPROVED",
        approver_name: metadata.approverName,
        payment_label: source.status === "APPROVED" ? metadata.paymentLabel : null,
      },
      employeeName: metadata.employeeName,
      dailyWage: metadata.dailyWage,
      totalPaidDays: Number(paidDays.data) || 0,
      existingDeductions,
      segments: clipSegments(segmentsResponse.data || [], start, end),
      generatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.error("Failed to build time/payroll document:", error);
    return NextResponse.json({ error: "สร้างข้อมูลเอกสารไม่สำเร็จ" }, { status: 500 });
  }
}
