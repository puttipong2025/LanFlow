import { NextRequest, NextResponse } from "next/server";
import { requireAuth, hasSystemManagerAccess } from "@/lib/server/auth";
import type { AuthTokenPayload } from "@/lib/server/auth";
import {
  reportCreateErrorResponse,
  reportErrorResponse,
} from "@/lib/server/report-response";

export const dynamic = "force-dynamic";

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

  const { data, error } = await result.supabase
    .from("report_batches")
    .select("id, report_no, location_id, cutoff_at, status, created_by_name, created_at, deleted_at, rubber_export_lock_no, has_cash_count, cash_count_link_id, cash_count_checker_name, cash_count_submitted_at, report_items(count), locations(name)")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) return reportErrorResponse(error.message);

  const latestActiveId = data?.find((row) => row.status === "active")?.id;
  const reports = (data ?? []).map((row) => {
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

  return NextResponse.json({ reports }, {
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
