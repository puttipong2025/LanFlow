import { CashCountInputError, cashCountErrorResponse, cashCountUnavailableResponse } from "@/lib/server/cash-count-response";
import { after, NextRequest, NextResponse } from "next/server";
import { mapCashCount } from "@/lib/server/cash-count-row";
import { prepareCashCountSubmission } from "@/lib/server/submit-cash-count";
import { cleanupUnusedCashCountEvidence } from "@/lib/server/cash-count-evidence-cleanup";
import { validCashCountCounts } from "@/lib/cash-count-validation";
import { requireAuth, requireSystemManager } from "@/lib/server/auth";
import {
  deletionAuditColumns,
  mapDeletionAuditRow,
} from "@/lib/server/deletion-audit-response";
import { isUuid } from "@/lib/server/management-route-error";
import { pendingWorkErrorResponse } from "@/lib/server/pending-work-response";

export const dynamic = "force-dynamic";

type AuditCursor = { version: 1; ownerUserId: string; locationId: string; at: string; id: string };
function decodeAuditCursor(value: string): AuditCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as AuditCursor;
    return parsed?.version === 1
      && isUuid(parsed.ownerUserId)
      && isUuid(parsed.locationId)
      && typeof parsed.at === "string"
      && !Number.isNaN(Date.parse(parsed.at))
      && isUuid(parsed.id)
      ? parsed
      : null;
  } catch { return null; }
}
function encodeAuditCursor(value: AuditCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function GET(request: NextRequest) {
  try {
    const result = await requireSystemManager(request);
    if (!result.ok) return result.response;
    const locationId = request.nextUrl.searchParams.get("locationId");
    if (!isUuid(locationId)) return cashCountErrorResponse("กรุณาระบุสาขา");
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
    const cursorValue = request.nextUrl.searchParams.get("cursor");
    const cursor = cursorValue ? decodeAuditCursor(cursorValue) : null;
    if (cursorValue && !cursor) return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
    if (cursor && (cursor.ownerUserId !== result.auth.sub || cursor.locationId !== locationId)) {
      return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตประวัติ" }, { status: 400 });
    }
    let query = result.supabase
      .from("cash_counts")
      .select("*")
      .eq("location_id", locationId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error) return cashCountErrorResponse(error.message);
    const page = (data ?? []).slice(0, 50);
    const tail = page.at(-1);
    return NextResponse.json({
      counts: page.map(mapCashCount),
      hasMore: (data?.length ?? 0) > 50,
      nextCursor: (data?.length ?? 0) > 50 && tail ? encodeAuditCursor({
        version: 1,
        ownerUserId: result.auth.sub,
        locationId,
        at: tail.created_at,
        id: tail.id,
      }) : null,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return cashCountUnavailableResponse();
  }
}

export async function POST(request: Request) {
  try {
    const result = await requireAuth(request);
    if (!result.ok) return result.response;
    let body: { sessionId?: string; actualCounts?: Record<string, number>; evidenceIds?: string[]; evidenceId?: string | null } | null;
    try {
      body = request.headers.get("content-type")?.includes("multipart/form-data")
        ? await prepareCashCountSubmission(request, result.auth.sub)
        : await request.json().catch(() => { throw new CashCountInputError("ข้อมูลตรวจนับไม่ถูกต้อง"); });
    } catch (error) {
      return error instanceof CashCountInputError ? cashCountErrorResponse(error.message) : cashCountUnavailableResponse();
    }
    if (!isUuid(body?.sessionId) || !validCashCountCounts(body.actualCounts)) return cashCountErrorResponse("ข้อมูลตรวจนับไม่ครบ");
    const { data, error } = await result.supabase.rpc("submit_cash_count_v3", {
      p_session_id: body.sessionId,
      p_actual_counts: body.actualCounts,
      p_evidence_ids: body.evidenceIds ?? (body.evidenceId ? [body.evidenceId] : []),
    });
    if (error?.code === "57014") {
      console.error("Cash Count RPC timed out", { operation: "submit_cash_count", code: error.code });
      return NextResponse.json(
        { error: "ระบบประมวลผลผลตรวจนับเกินเวลา กรุณาลองส่งอีกครั้ง" },
        { status: 504 },
      );
    }
    if (error) {
      const blockedResponse = pendingWorkErrorResponse(error);
      if (blockedResponse) return blockedResponse;
      return cashCountErrorResponse(error.message);
    }
    after(() => cleanupUnusedCashCountEvidence(result.auth.sub).catch(() => undefined));
    return NextResponse.json(data, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return cashCountUnavailableResponse();
  }
}
