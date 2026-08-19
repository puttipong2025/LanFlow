import { NextRequest, NextResponse } from "next/server";
import {
  hasSystemManagerAccess,
  requireAuth,
  type AuthTokenPayload,
} from "@/lib/server/auth";
import { isUuid } from "@/lib/server/rubber-export-response";

export const dynamic = "force-dynamic";

type Cursor = {
  version: 1;
  ownerUserId: string;
  destinationLocationId: string;
  search: string;
  sameLocation: boolean;
  verifiedAt: string;
  id: string;
};

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return parsed.version === 1
      && typeof parsed.ownerUserId === "string"
      && typeof parsed.destinationLocationId === "string"
      && typeof parsed.search === "string"
      && typeof parsed.sameLocation === "boolean"
      && typeof parsed.verifiedAt === "string"
      && isUuid(parsed.id) ? parsed : null;
  } catch {
    return null;
  }
}

function encodeCursor(value: Cursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

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

  const search = (request.nextUrl.searchParams.get("search")?.trim() ?? "").toLocaleLowerCase();
  const cursorValue = request.nextUrl.searchParams.get("cursor");
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) {
    return NextResponse.json({ error: "เคอร์เซอร์ไม่ถูกต้อง" }, { status: 400 });
  }
  if (cursor && (
    cursor.ownerUserId !== result.auth.sub
    || cursor.destinationLocationId !== destinationLocationId
    || cursor.search !== search
  )) {
    return NextResponse.json({ error: "เคอร์เซอร์ไม่ตรงกับขอบเขตรายการ" }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("get_receivable_rubber_exports_page", {
    p_destination_location_id: destinationLocationId,
    p_search: search,
    p_cursor_same_location: cursor?.sameLocation ?? null,
    p_cursor_verified_at: cursor?.verifiedAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: 50,
  });
  if (error) return errorResponse(error.message);
  const page = (data ?? {}) as Record<string, any>;
  const rows = Array.isArray(page.rows) ? page.rows : [];
  const nextCursor = page.hasMore === true && page.nextSameLocation !== null
    && page.nextVerifiedAt && isUuid(page.nextId)
    ? encodeCursor({
      version: 1,
      ownerUserId: result.auth.sub,
      destinationLocationId,
      search,
      sameLocation: page.nextSameLocation === true,
      verifiedAt: String(page.nextVerifiedAt),
      id: String(page.nextId),
    })
    : null;

  return NextResponse.json({
    candidates: rows.map((row: Record<string, any>) => ({
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
      isSameLocation: row.source_location_id === destinationLocationId,
    })),
    hasMore: page.hasMore === true,
    nextCursor,
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
