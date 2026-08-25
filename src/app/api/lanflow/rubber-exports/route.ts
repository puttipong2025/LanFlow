import { NextRequest, NextResponse } from "next/server";
import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import {
  canManageRubberExports,
  isUuid,
  mapRubberExportRow,
  rubberExportErrorResponse,
} from "@/lib/server/rubber-export-response";
import {
  deletionAuditColumns,
  mapDeletionAuditRow,
} from "@/lib/server/deletion-audit-response";

export const dynamic = "force-dynamic";

const columns = `
  id, export_no, location_id, status, previous_status,
  original_weight_total, paid_total, rubber_value_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_name, created_at, verified_by_name,
  verified_at, sold_out_at, sold_out_by_name,
  deleted_by_name, deleted_at, report_lock_no, age_cutoff_at,
  average_age_hours, oldest_age_hours, estimated_age_item_count,
  rubber_export_items(count), export_vehicle_weigh_bill_reservations(count), locations(name)
`;

type Cursor = { version: 1; ownerUserId: string; locationId: string; view: string; createdAt: string; id: string };
function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return parsed?.version === 1 ? parsed : null;
  } catch { return null; }
}
function encodeCursor(value: Cursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId || !canManageRubberExports(result.auth, locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูรายการส่งออกของสาขานี้" }, { status: 403 });
  }

  if (request.nextUrl.searchParams.get("view") === "deletions") {
    if (!hasSystemManagerAccess(result.auth)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์ดูประวัติการลบ" }, { status: 403 });
    }
    const cursorValue = request.nextUrl.searchParams.get("cursor");
    const cursor = cursorValue ? decodeCursor(cursorValue) : null;
    if (cursorValue && !cursor) return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
    if (cursor && (cursor.ownerUserId !== result.auth.sub || cursor.locationId !== locationId || cursor.view !== "deletions")) {
      return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตประวัติ" }, { status: 400 });
    }
    let query = result.supabase
      .from("document_deletion_audits")
      .select(deletionAuditColumns)
      .eq("location_id", locationId)
      .eq("document_kind", "rubber_export")
      .order("deleted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (cursor) query = query.or(`deleted_at.lt.${cursor.createdAt},and(deleted_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error) return rubberExportErrorResponse(error.message);
    const page = (data ?? []).slice(0, 50);
    const tail = page.at(-1);
    return NextResponse.json({
      deletions: page.map((row) => mapDeletionAuditRow(row)),
      hasMore: (data?.length ?? 0) > 50,
      nextCursor: (data?.length ?? 0) > 50 && tail ? encodeCursor({
        version: 1, ownerUserId: result.auth.sub, locationId, view: "deletions",
        createdAt: tail.deleted_at, id: tail.id,
      }) : null,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  const view = request.nextUrl.searchParams.get("view") ?? "active";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  if (!["active", "history"].includes(view) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "พารามิเตอร์รายการส่งออกไม่ถูกต้อง" }, { status: 400 });
  }
  const cursorValue = request.nextUrl.searchParams.get("cursor");
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
  if (cursor && (cursor.ownerUserId !== result.auth.sub || cursor.locationId !== locationId || cursor.view !== view)) {
    return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตรายการ" }, { status: 400 });
  }

  const pageResult = await result.supabase.rpc("get_rubber_export_page_ids", {
    p_location_id: locationId,
    p_view: view,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: limit,
  });
  if (pageResult.error) return rubberExportErrorResponse(pageResult.error.message);
  const page = (pageResult.data ?? {}) as {
    ids?: string[]; hasMore?: boolean; nextCreatedAt?: string | null; nextId?: string | null;
  };
  const ids = page.ids ?? [];
  const [{ data: rows, error }, { data: ages, error: agesError }] = ids.length === 0
    ? [{ data: [], error: null }, { data: [], error: null }]
    : await Promise.all([
      result.supabase
      .from("rubber_exports")
      .select(columns)
      .eq("location_id", locationId)
      .in("id", ids),
      result.supabase.rpc("get_rubber_export_age_summaries_for_ids", {
        p_location_id: locationId,
        p_export_ids: ids,
      }),
    ] as const);

  if (error) return rubberExportErrorResponse(error.message);
  if (agesError) return rubberExportErrorResponse(agesError.message);

  const agesByExport = new Map<string, Record<string, any>>(
    (ages ?? []).map((age: Record<string, any>) => [age.export_id as string, age]),
  );

  const canVerifyOrDelete = hasSystemManagerAccess(result.auth);
  const rowsById = new Map((rows ?? []).map((row) => [row.id, row]));

  return NextResponse.json({
    exports: ids.flatMap((id) => {
      const row = rowsById.get(id);
      return row ? [mapRubberExportRow({
      ...(row as Record<string, any>),
      official_age_cutoff_at: row.age_cutoff_at,
      official_average_age_hours: row.average_age_hours,
      official_oldest_age_hours: row.oldest_age_hours,
      official_estimated_age_item_count: row.estimated_age_item_count,
      ...(agesByExport.get(row.id) ?? {}),
      age_calculated_at: agesByExport.get(row.id)?.calculated_at ?? null,
      })] : [];
    }),
    hasMore: Boolean(page.hasMore),
    nextCursor: page.hasMore && page.nextCreatedAt && page.nextId ? encodeCursor({
      version: 1, ownerUserId: result.auth.sub, locationId, view,
      createdAt: page.nextCreatedAt, id: page.nextId,
    }) : null,
    permissions: {
      canVerify: canVerifyOrDelete,
      canDelete: canVerifyOrDelete,
    },
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const payload = await request.json().catch(() => null) as {
    locationId?: string;
    selectedReportItemIds?: string[];
  } | null;
  const selectedIds = payload?.selectedReportItemIds;
  if (
    !isUuid(payload?.locationId)
    || !Array.isArray(selectedIds)
    || selectedIds.length === 0
    || selectedIds.some((id) => !isUuid(id))
    || new Set(selectedIds).size !== selectedIds.length
  ) {
    return NextResponse.json({ error: "กรุณาเลือกบิลอย่างน้อย 1 ใบและห้ามเลือกซ้ำ" }, { status: 400 });
  }
  if (!canManageRubberExports(result.auth, payload.locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้" }, { status: 403 });
  }

  const { data, error } = await result.supabase.rpc("create_rubber_export", {
    p_location_id: payload.locationId,
    p_selected_report_item_ids: selectedIds,
  });
  if (error) return rubberExportErrorResponse(error.message);
  return NextResponse.json(data, {
    status: 201,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
