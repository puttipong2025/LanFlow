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

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return false;
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day;
}

function decodeCursor(value: string): Cursor | null {
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) return null;
    const parsed = JSON.parse(decoded.toString("utf8")) as Cursor;
    return parsed.version === 1
      && typeof parsed.ownerUserId === "string"
      && typeof parsed.destinationLocationId === "string"
      && typeof parsed.search === "string"
      && typeof parsed.sameLocation === "boolean"
      && isCanonicalIsoTimestamp(parsed.verifiedAt)
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
  if (message.includes("BRANCH_RECEIPT_REMAINING_WEIGHT_REQUIRED")) {
    return NextResponse.json({ error: "กรุณากรอกน้ำหนักยางคงเหลือในลาน" }, { status: 400 });
  }
  if (message.includes("BRANCH_RECEIPT_REMAINING_WEIGHT_PRECISION")) {
    return NextResponse.json({ error: "น้ำหนักยางคงเหลือต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง" }, { status: 400 });
  }
  if (message.includes("BRANCH_RECEIPT_REMAINING_WEIGHT_INVALID")) {
    return NextResponse.json({ error: "น้ำหนักยางคงเหลือต้องมากกว่า 0 และไม่เกินน้ำหนัก REX" }, { status: 400 });
  }
  if (message.includes("BRANCH_RECEIPT_SAME_BRANCH_REQUIRED")) {
    return NextResponse.json({ error: "กรอกน้ำหนักยางคงเหลือได้เฉพาะ REX ของสาขาปัจจุบัน" }, { status: 400 });
  }
  if (message.includes("BRANCH_RECEIPT_REMAINING_VALUE_INVALID")) {
    return NextResponse.json({ error: "น้ำหนักยางคงเหลือน้อยเกินกว่าจะคำนวณมูลค่าได้" }, { status: 400 });
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
      sourceLocationName: row.source_location_name,
      verifiedAt: row.verified_at,
      currentWeight: Number(row.current_weight),
      rubberValue: Number(row.rubber_value),
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
    remainingYardWeight?: unknown;
  } | null;
  if (!isUuid(payload?.destinationLocationId) || !isUuid(payload?.sourceRubberExportId)) {
    return NextResponse.json({ error: "กรุณาเลือกรายการส่งออกยางหนึ่งรายการ" }, { status: 400 });
  }
  if (!canAccessDestination(result.auth, payload.destinationLocationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์รับยางเข้าสาขานี้" }, { status: 403 });
  }

  const hasRemainingYardWeight = payload.remainingYardWeight !== undefined
    && payload.remainingYardWeight !== null;
  if (hasRemainingYardWeight && (
    typeof payload.remainingYardWeight !== "number"
    || !Number.isFinite(payload.remainingYardWeight)
  )) {
    return NextResponse.json({ error: "น้ำหนักยางคงเหลือไม่ถูกต้อง" }, { status: 400 });
  }

  const { data, error } = hasRemainingYardWeight
    ? await result.supabase.rpc("receive_same_branch_yard_remainder", {
        p_destination_location_id: payload.destinationLocationId,
        p_source_rubber_export_id: payload.sourceRubberExportId,
        p_remaining_yard_weight: payload.remainingYardWeight as number,
      })
    : await result.supabase.rpc("receive_rubber_export", {
        p_destination_location_id: payload.destinationLocationId,
        p_source_rubber_export_id: payload.sourceRubberExportId,
      });
  if (error) return errorResponse(error.message);

  return NextResponse.json(data, {
    status: 201,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
