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
  const result = await requireAuth(request, { allowUserLanflow: true });
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
              : "ไม่มีการจ่าย (ยอดสุทธิ 0.00 บาท)"
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
    const [metadata, totalsResponse, attendanceResponse] = await Promise.all([
      sourceMetadata(result.supabase, source),
      result.supabase.rpc("get_time_payroll_user_totals", {
        p_profile_id: source.profile_id,
        p_month: month,
      }),
      result.supabase.rpc("get_time_payroll_attendance_month", {
        p_profile_id: source.profile_id,
        p_month: month,
      }),
    ]);
    if (!metadata) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 });
    if (totalsResponse.error) throw totalsResponse.error;
    if (attendanceResponse.error) throw attendanceResponse.error;
    if (attendanceResponse.data?.mode !== "EXCEPTIONS") {
      throw new Error("Unsupported attendance mode");
    }

    const existingDeductions = Number(totalsResponse.data?.usedThisMonth || 0);
    return NextResponse.json(buildWithdrawalSlipDocument({
      source: {
        ...source,
        status: source.status as "PENDING" | "APPROVED",
        approver_name: metadata.approverName,
        payment_label: source.status === "APPROVED" ? metadata.paymentLabel : null,
      },
      employeeName: metadata.employeeName,
      dailyWage: metadata.dailyWage,
      totalPaidDays: Number(attendanceResponse.data?.summary?.paidDays) || 0,
      existingDeductions,
      segments: [],
      attendance: attendanceResponse.data,
      generatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.error("Failed to build time/payroll document:", error);
    return NextResponse.json({ error: "สร้างข้อมูลเอกสารไม่สำเร็จ" }, { status: 500 });
  }
}
