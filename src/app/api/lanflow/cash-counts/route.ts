import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireSystemManager } from "@/lib/server/auth";
import { cashCountErrorResponse } from "@/lib/server/cash-count-response";
import {
  deletionAuditColumns,
  mapDeletionAuditRow,
} from "@/lib/server/deletion-audit-response";

export const dynamic = "force-dynamic";

type AuditCursor = { version: 1; ownerUserId: string; locationId: string; at: string; id: string };
function decodeAuditCursor(value: string): AuditCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as AuditCursor;
    return parsed?.version === 1 && typeof parsed.at === "string" && typeof parsed.id === "string" ? parsed : null;
  } catch { return null; }
}
function encodeAuditCursor(value: AuditCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function GET(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId) return cashCountErrorResponse("กรุณาระบุสาขา");
  if (request.nextUrl.searchParams.get("view") === "deletions") {
    const cursorValue = request.nextUrl.searchParams.get("cursor");
    const cursor = cursorValue ? decodeAuditCursor(cursorValue) : null;
    if (cursorValue && !cursor) return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
    if (cursor && (cursor.ownerUserId !== result.auth.sub || cursor.locationId !== locationId)) {
      return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตประวัติ" }, { status: 400 });
    }
    let query = result.supabase
      .from("document_deletion_audits")
      .select(deletionAuditColumns)
      .eq("location_id", locationId)
      .eq("document_kind", "cash_count")
      .order("deleted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (cursor) query = query.or(`deleted_at.lt.${cursor.at},and(deleted_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error) return cashCountErrorResponse(error.message);
    const page = (data ?? []).slice(0, 50);
    const tail = page.at(-1);
    return NextResponse.json({
      deletions: page.map((row) => mapDeletionAuditRow(row)),
      hasMore: (data?.length ?? 0) > 50,
      nextCursor: (data?.length ?? 0) > 50 && tail ? encodeAuditCursor({
        version: 1, ownerUserId: result.auth.sub, locationId,
        at: tail.deleted_at, id: tail.id,
      }) : null,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
  const { data, error } = await result.supabase
    .from("cash_counts")
    .select("id, report_id, location_id, cutoff_at, actual_total, expected_total, difference_total, anomaly_score, confidence, analysis_status, formula_version, status, created_by_name, created_at, deleted_at, report_batches(report_no)")
    .eq("location_id", locationId)
    .eq("status", "active")
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
  if (error?.code === "57014") {
    console.error("Cash Count RPC timed out", { operation: "submit_cash_count", code: error.code });
    return NextResponse.json(
      { error: "ระบบประมวลผลผลตรวจนับเกินเวลา กรุณาลองส่งอีกครั้ง" },
      { status: 504 },
    );
  }
  if (error) return cashCountErrorResponse(error.message);
  return NextResponse.json(data, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
