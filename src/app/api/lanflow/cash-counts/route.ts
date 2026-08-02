import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireSystemManager } from "@/lib/server/auth";
import { cashCountErrorResponse } from "@/lib/server/cash-count-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) return cashCountErrorResponse("กรุณาระบุสาขา");
  const { data, error } = await result.supabase
    .from("cash_counts")
    .select("id, report_id, location_id, cutoff_at, actual_total, expected_total, difference_total, anomaly_score, confidence, analysis_status, formula_version, status, created_by_name, created_at, deleted_at, report_batches(report_no,status)")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) return cashCountErrorResponse(error.message);
  return NextResponse.json({ counts: (data ?? []).map((row: any) => ({
    id: row.id, reportId: row.report_id, reportNo: (Array.isArray(row.report_batches) ? row.report_batches[0] : row.report_batches)?.report_no ?? "",
    locationId: row.location_id, cutoffAt: row.cutoff_at, actualTotal: Number(row.actual_total), expectedTotal: Number(row.expected_total),
    differenceTotal: Number(row.difference_total), anomalyScore: row.anomaly_score, confidence: row.confidence,
    analysisStatus: row.analysis_status, formulaVersion: row.formula_version, status: row.status,
    createdByName: row.created_by_name, createdAt: row.created_at, deletedAt: row.deleted_at,
  })) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const body = await request.json().catch(() => null) as { sessionId?: string; actualCounts?: Record<string, number> } | null;
  if (!body?.sessionId || !body.actualCounts) return cashCountErrorResponse("ข้อมูลตรวจนับไม่ครบ");
  const { data, error } = await result.supabase.rpc("submit_cash_count", {
    p_session_id: body.sessionId,
    p_actual_counts: body.actualCounts,
  });
  if (error) return cashCountErrorResponse(error.message);
  return NextResponse.json(data, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
