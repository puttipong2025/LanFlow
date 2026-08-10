import { NextRequest, NextResponse } from "next/server";
import {
  hasSystemManagerAccess,
  requireAuth,
  type AuthTokenPayload,
} from "@/lib/server/auth";
import { isUuid } from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

function canAccessDestination(
  auth: AuthTokenPayload,
  locationId: string,
) {
  return hasSystemManagerAccess(auth) || auth.locationIds.includes(locationId);
}

function errorResponse(message: string) {
  if (message.includes("ไม่มีสิทธิ์") || message.includes("Unauthorized")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  if (
    message.includes("BRANCH_RECEIPT_ALREADY_EXISTS")
    || message.includes("BRANCH_RECEIPT_SOURCE_STALE")
    || message.includes("BRANCH_RECEIPT_SOURCE_NOT_FOUND")
  ) {
    return NextResponse.json(
      { error: "รายการนี้ไม่พร้อมรับแล้ว กรุณารีเฟรชและเลือกใหม่" },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const destinationLocationId = request.nextUrl.searchParams.get("destinationLocationId");
  if (!isUuid(destinationLocationId)) {
    return NextResponse.json({ error: "สาขาปลายทางไม่ถูกต้อง" }, { status: 400 });
  }
  if (!canAccessDestination(result.auth, destinationLocationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์รับยางเข้าสาขานี้" }, { status: 403 });
  }

  const { data, error } = await result.supabase.rpc("get_receivable_rubber_exports", {
    p_destination_location_id: destinationLocationId,
  });
  if (error) return errorResponse(error.message);

  return NextResponse.json({
    candidates: (data ?? []).map((row: Record<string, any>) => ({
      sourceRubberExportId: row.source_rubber_export_id,
      sourceExportNo: row.source_export_no,
      sourceLocationId: row.source_location_id,
      sourceLocationName: row.source_location_name,
      verifiedAt: row.verified_at,
      currentWeight: Number(row.current_weight),
      rubberValue: Number(row.rubber_value),
      sourceAverageAgeHours: Number(row.source_average_age_hours),
      receivedAgeHours: Number(row.received_age_hours),
      ageIsEstimated: row.age_is_estimated === true,
    })),
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const payload = await request.json().catch(() => null) as {
    destinationLocationId?: string;
    sourceRubberExportId?: string;
  } | null;
  if (!isUuid(payload?.destinationLocationId) || !isUuid(payload?.sourceRubberExportId)) {
    return NextResponse.json({ error: "กรุณาเลือกรายการส่งออกยางหนึ่งรายการ" }, { status: 400 });
  }
  if (!canAccessDestination(result.auth, payload.destinationLocationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์รับยางเข้าสาขานี้" }, { status: 403 });
  }

  const { data, error } = await result.supabase.rpc("receive_rubber_export", {
    p_destination_location_id: payload.destinationLocationId,
    p_source_rubber_export_id: payload.sourceRubberExportId,
  });
  if (error) return errorResponse(error.message);

  return NextResponse.json(data, {
    status: 201,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
