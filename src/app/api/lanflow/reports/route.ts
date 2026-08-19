import { NextRequest, NextResponse } from "next/server";
import { requireAuth, hasSystemManagerAccess } from "@/lib/server/auth";
import type { AuthTokenPayload } from "@/lib/server/auth";
import {
  reportCreateErrorResponse,
  reportErrorResponse,
} from "@/lib/server/report-response";
import {
  deletionAuditColumns,
  mapDeletionAuditRow,
} from "@/lib/server/deletion-audit-response";
import { isUuid } from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

type Cursor = {
  version: 1;
  ownerUserId: string;
  locationId: string;
  view: "current" | "deletions";
  at: string;
  id: string;
};

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return parsed?.version === 1 && isUuid(parsed.id) && typeof parsed.at === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function encodeCursor(value: Cursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function canAccessReports(
  auth: AuthTokenPayload,
  locationId: string
) {
  return hasSystemManagerAccess(auth)
    || (auth.role === "admin" && auth.locationIds.includes(locationId));
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId || !canAccessReports(result.auth, locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูรายงานของสาขานี้" }, { status: 403 });
  }

  const view = request.nextUrl.searchParams.get("view") === "deletions" ? "deletions" : "current";
  const cursorValue = request.nextUrl.searchParams.get("cursor");
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) {
    return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
  }
  if (cursor && (cursor.ownerUserId !== result.auth.sub || cursor.locationId !== locationId || cursor.view !== view)) {
    return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตรายงาน" }, { status: 400 });
  }

  if (view === "deletions") {
    if (!hasSystemManagerAccess(result.auth)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์ดูประวัติการลบ" }, { status: 403 });
    }
    let query = result.supabase
      .from("document_deletion_audits")
      .select(deletionAuditColumns)
      .eq("location_id", locationId)
      .eq("document_kind", "report_batch")
      .order("deleted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (cursor) query = query.or(`deleted_at.lt.${cursor.at},and(deleted_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error) return reportErrorResponse(error.message);
    const page = (data ?? []).slice(0, 50);
    const tail = page.at(-1);
    return NextResponse.json({
      deletions: page.map((row) => mapDeletionAuditRow(row)),
      hasMore: (data?.length ?? 0) > 50,
      nextCursor: (data?.length ?? 0) > 50 && tail ? encodeCursor({
        version: 1, ownerUserId: result.auth.sub, locationId, view,
        at: tail.deleted_at, id: tail.id,
      }) : null,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  let reportsQuery = result.supabase
    .from("report_batches")
    .select("id, report_no, location_id, cutoff_at, status, created_by_name, created_at, deleted_at, rubber_export_lock_no, has_cash_count, cash_count_link_id, cash_count_checker_name, cash_count_submitted_at, report_items(count), locations(name)")
    .eq("location_id", locationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(51);
  if (cursor) reportsQuery = reportsQuery.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
  const [{ data, error }, latestResult] = await Promise.all([
    reportsQuery,
    result.supabase
      .from("report_batches")
      .select("id")
      .eq("location_id", locationId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (error) return reportErrorResponse(error.message);
  if (latestResult.error) return reportErrorResponse(latestResult.error.message);

  const latestActiveId = latestResult.data?.id;
  const page = (data ?? []).slice(0, 50);
  const reports = page.map((row) => {
    const location = Array.isArray(row.locations) ? row.locations[0] : row.locations;
    const count = Array.isArray(row.report_items) ? row.report_items[0]?.count : 0;
    return {
      id: row.id,
      reportNo: row.report_no,
      locationId: row.location_id,
      locationName: location?.name ?? "",
      cutoffAt: row.cutoff_at,
      status: row.status,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      itemCount: Number(count ?? 0),
      isLatestActive: row.id === latestActiveId,
      rubberExportLockNo: row.rubber_export_lock_no,
      hasCashCount: row.has_cash_count === true,
      cashCountId: row.cash_count_link_id,
      cashCountCheckerName: row.cash_count_checker_name,
      cashCountSubmittedAt: row.cash_count_submitted_at,
    };
  });

  const tail = page.at(-1);
  return NextResponse.json({
    reports,
    hasMore: (data?.length ?? 0) > 50,
    nextCursor: (data?.length ?? 0) > 50 && tail ? encodeCursor({
      version: 1, ownerUserId: result.auth.sub, locationId, view,
      at: tail.created_at, id: tail.id,
    }) : null,
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const payload = await request.json().catch(() => null) as { locationId?: string } | null;
  const locationId = payload?.locationId;

  if (!locationId || !canAccessReports(result.auth, locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์สร้างรายงานของสาขานี้" }, { status: 403 });
  }

  const { data, error } = await result.supabase.rpc("create_report_batch", {
    p_location_id: locationId,
  });
  if (error) {
    const diagnostic = [error.message, error.details, error.hint]
      .filter(Boolean)
      .join("\n");
    const response = reportCreateErrorResponse(diagnostic);
    if (response.status !== 403 && !diagnostic.includes("ไม่มีรายการ") && !diagnostic.includes("CASH_COUNT_ACTIVE")) {
      console.error("create_report_batch failed", {
        locationId,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
    }
    return response;
  }

  return NextResponse.json(data, {
    status: 201,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
