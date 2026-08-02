import { NextResponse } from "next/server";
import { requireSystemManager } from "@/lib/server/auth";
import { cashCountErrorResponse } from "@/lib/server/cash-count-response";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ countId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const { countId } = await context.params;
  const locationId = new URL(request.url).searchParams.get("locationId");
  if (!locationId) return cashCountErrorResponse("กรุณาระบุสาขา");
  const { data: row, error } = await result.supabase
    .from("cash_counts")
    .select("*, report_batches(report_no,status), locations(name)")
    .eq("id", countId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) return cashCountErrorResponse(error.message);
  if (!row) return cashCountErrorResponse("ไม่พบผลตรวจนับ");
  const report = Array.isArray((row as any).report_batches) ? (row as any).report_batches[0] : (row as any).report_batches;
  const location = Array.isArray((row as any).locations) ? (row as any).locations[0] : (row as any).locations;
  return NextResponse.json({
    id: row.id, reportId: row.report_id, reportNo: report?.report_no ?? "", locationId: row.location_id,
    locationName: location?.name ?? "", cutoffAt: row.cutoff_at, actualCounts: row.actual_counts,
    actualTotal: Number(row.actual_total), expectedCounts: row.expected_counts, expectedTotal: Number(row.expected_total),
    differenceCounts: row.difference_counts, differenceTotal: Number(row.difference_total), anomalyScore: row.anomaly_score,
    confidence: row.confidence, analysisStatus: row.analysis_status, formulaVersion: row.formula_version,
    evidence: row.evidence, status: row.status, createdByName: row.created_by_name, createdAt: row.created_at, deletedAt: row.deleted_at,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function DELETE(request: Request, context: RouteContext) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const { countId } = await context.params;
  const locationId = new URL(request.url).searchParams.get("locationId");
  if (!locationId) return cashCountErrorResponse("กรุณาระบุสาขา");
  const { data: count, error: lookupError } = await result.supabase
    .from("cash_counts")
    .select("id")
    .eq("id", countId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (lookupError) return cashCountErrorResponse(lookupError.message);
  if (!count) return cashCountErrorResponse("ไม่พบผลตรวจนับในสาขาปัจจุบัน");
  const { data, error } = await result.supabase.rpc("delete_cash_count", { p_cash_count_id: countId });
  if (error) return cashCountErrorResponse(error.message);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
