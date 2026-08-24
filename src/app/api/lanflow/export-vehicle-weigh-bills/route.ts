import { NextRequest } from "next/server";

import { requireAuth } from "@/lib/server/auth";
import {
  canManageExportVehicleWeighBills,
  exportVehicleWeighBillErrorResponse,
  exportVehicleWeighBillJson,
  isWexUuid,
  mapExportVehicleWeighBillSummary,
  parseCreateExportVehicleWeighBillPayload,
  withExportVehicleWeighBillNoStore,
} from "@/lib/server/export-vehicle-weigh-bill-response";

export const dynamic = "force-dynamic";

const listColumns = `
  id, wex_no, location_id, revision, created_by_name, created_at, updated_at,
  locations(name),
  export_vehicle_weigh_lines(id, net_weight),
  export_vehicle_weigh_bill_reservations(id, current_weight)
`;

type Cursor = {
  version: 1;
  ownerUserId: string;
  locationId: string;
  createdAt: string;
  id: string;
};

function decodeCursor(value: string): Cursor | null {
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    return cursor.version === 1
      && typeof cursor.ownerUserId === "string"
      && isWexUuid(cursor.locationId)
      && typeof cursor.createdAt === "string"
      && Number.isFinite(Date.parse(cursor.createdAt))
      && isWexUuid(cursor.id)
      ? cursor as Cursor
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(value: Cursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return withExportVehicleWeighBillNoStore(result.response);

  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!isWexUuid(locationId)) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_LOCATION: กรุณาระบุสาขาให้ถูกต้อง");
  }
  if (!canManageExportVehicleWeighBills(result.auth, locationId)) {
    return exportVehicleWeighBillErrorResponse("WEX_FORBIDDEN: ไม่มีสิทธิ์ดูบิลรถส่งออกของสาขานี้");
  }

  const rawLimit = request.nextUrl.searchParams.get("limit") ?? "50";
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_PAGE: limit ไม่ถูกต้อง");
  }
  const cursorValue = request.nextUrl.searchParams.get("cursor");
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_CURSOR: cursor ไม่ถูกต้อง");
  }
  if (cursor && (cursor.ownerUserId !== result.auth.sub || cursor.locationId !== locationId)) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_CURSOR: cursor ไม่ตรงกับขอบเขตรายการ");
  }

  let query = result.supabase
    .from("export_vehicle_weigh_bills")
    .select(listColumns)
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }
  const { data, error } = await query;
  if (error) return exportVehicleWeighBillErrorResponse(error.message);

  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const tail = page.at(-1);
  const hasMore = rows.length > limit;
  return exportVehicleWeighBillJson({
    bills: page.map((row) => mapExportVehicleWeighBillSummary(row as Record<string, unknown>)),
    hasMore,
    nextCursor: hasMore && tail
      ? encodeCursor({
        version: 1,
        ownerUserId: result.auth.sub,
        locationId,
        createdAt: tail.created_at,
        id: tail.id,
      })
      : null,
    permissions: {
      canCreate: true,
      canEdit: true,
      canDelete: result.auth.role === "super_admin" || result.auth.canAccessSystemManager,
    },
  });
}

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return withExportVehicleWeighBillNoStore(result.response);

  const payload = parseCreateExportVehicleWeighBillPayload(await request.json().catch(() => null));
  if (!payload) {
    return exportVehicleWeighBillErrorResponse("WEX_INVALID_PAYLOAD: ข้อมูลบิลรถส่งออกไม่ถูกต้อง");
  }
  if (!canManageExportVehicleWeighBills(result.auth, payload.locationId)) {
    return exportVehicleWeighBillErrorResponse("WEX_FORBIDDEN: ไม่มีสิทธิ์สร้างบิลรถส่งออกของสาขานี้");
  }

  const { data, error } = await result.supabase.rpc("create_export_vehicle_weigh_bill", {
    p_location_id: payload.locationId,
    p_lines: payload.lines,
    p_rubber_export_ids: payload.rubberExportIds,
  });
  if (error) return exportVehicleWeighBillErrorResponse(error.message);
  return exportVehicleWeighBillJson(data, { status: 201 });
}
