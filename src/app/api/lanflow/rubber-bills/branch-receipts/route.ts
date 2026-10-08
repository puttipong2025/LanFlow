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

type BranchReceiptRow = {
  source_rubber_export_id: string;
  source_export_no: string;
  source_location_id: string;
  source_location_name: string;
  verified_at: string;
  current_weight: number;
  rubber_value: number;
  received_age_hours: number;
  age_is_estimated: boolean;
  is_same_location: boolean;
};

type BranchReceiptPage = {
  rows: BranchReceiptRow[];
  hasMore: boolean;
  nextSameLocation: boolean | null;
  nextVerifiedAt: string | null;
  nextId: string | null;
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

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
      && isUuid(parsed.destinationLocationId)
      && typeof parsed.search === "string"
      && typeof parsed.sameLocation === "boolean"
      && isCanonicalIsoTimestamp(parsed.verifiedAt)
      && isUuid(parsed.id)
      ? {
          ...parsed,
          destinationLocationId: parsed.destinationLocationId.toLowerCase(),
          id: parsed.id.toLowerCase(),
        }
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(value: Cursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function isBranchReceiptRow(
  value: unknown,
  destinationLocationId: string,
): value is BranchReceiptRow {
  if (!isJsonObject(value)
      || !isUuid(value.source_rubber_export_id)
      || typeof value.source_export_no !== "string"
      || value.source_export_no.trim().length === 0
      || !isUuid(value.source_location_id)
      || typeof value.source_location_name !== "string"
      || value.source_location_name.trim().length === 0
      || !isCanonicalIsoTimestamp(value.verified_at)
      || !isFiniteNumber(value.current_weight, Number.EPSILON)
      || !isFiniteNumber(value.rubber_value, Number.EPSILON)
      || !isFiniteNumber(value.received_age_hours)
      || typeof value.age_is_estimated !== "boolean"
      || typeof value.is_same_location !== "boolean") {
    return false;
  }
  return value.is_same_location
    === (value.source_location_id.toLowerCase() === destinationLocationId);
}

function hasExpectedBranchReceiptOrder(rows: BranchReceiptRow[]) {
  const timestampMicros = (value: string) => {
    const fraction = /\.(\d{1,6})/.exec(value)?.[1]?.padEnd(6, "0") ?? "000000";
    return BigInt(Date.parse(value)) * BigInt(1_000) + BigInt(fraction.slice(3) || "0");
  };
  return rows.every((row, index) => {
    if (index === 0) return true;
    const previous = rows[index - 1];
    if (row.is_same_location !== previous.is_same_location) {
      return previous.is_same_location && !row.is_same_location;
    }
    const rowTime = timestampMicros(row.verified_at);
    const previousTime = timestampMicros(previous.verified_at);
    if (rowTime !== previousTime) return rowTime < previousTime;
    return row.source_rubber_export_id.toLowerCase()
      < previous.source_rubber_export_id.toLowerCase();
  });
}

function isBranchReceiptPage(
  value: unknown,
  destinationLocationId: string,
): value is BranchReceiptPage {
  if (!isJsonObject(value)
      || !Array.isArray(value.rows)
      || value.rows.length > 50
      || !value.rows.every((row) => isBranchReceiptRow(row, destinationLocationId))
      || !hasExpectedBranchReceiptOrder(value.rows)
      || new Set(value.rows.map((row) => row.source_rubber_export_id)).size !== value.rows.length
      || typeof value.hasMore !== "boolean") {
    return false;
  }
  const hasNoCursor = value.nextSameLocation === null
    && value.nextVerifiedAt === null
    && value.nextId === null;
  const hasValidCursor = typeof value.nextSameLocation === "boolean"
    && isCanonicalIsoTimestamp(value.nextVerifiedAt)
    && isUuid(value.nextId);
  if (!hasNoCursor && !hasValidCursor) return false;
  if (!value.hasMore) return true;
  const lastRow = value.rows.at(-1);
  return value.rows.length === 50
    && hasValidCursor
    && isJsonObject(lastRow)
    && lastRow.is_same_location === value.nextSameLocation
    && lastRow.verified_at === value.nextVerifiedAt
    && typeof lastRow.source_rubber_export_id === "string"
    && typeof value.nextId === "string"
    && lastRow.source_rubber_export_id.toLowerCase() === value.nextId.toLowerCase();
}

function isBranchReceiptResult(value: unknown, expectedSourceExportId: string) {
  return isJsonObject(value)
    && value.status === "received"
    && isUuid(value.billId)
    && typeof value.billNo === "string"
    && value.billNo.trim().length > 0
    && isUuid(value.sourceExportId)
    && value.sourceExportId.toLowerCase() === expectedSourceExportId
    && typeof value.sourceExportNo === "string"
    && value.sourceExportNo.trim().length > 0
    && isCanonicalIsoTimestamp(value.receivedAt)
    && isFiniteNumber(value.receivedAgeHours);
}

function canAccessDestination(
  auth: AuthTokenPayload,
  locationId: string,
) {
  return hasSystemManagerAccess(auth) || auth.locationIds.includes(locationId);
}

function errorResponse(message: string) {
  if (message.includes("ไม่มีสิทธิ์") || message.includes("Unauthorized")) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดำเนินการกับรายการรับยางสาขานี้" }, { status: 403 });
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
  console.error("Branch receipt RPC failed", message);
  return NextResponse.json({ error: "ดำเนินการรับยางจากสาขาไม่สำเร็จ" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const rawDestinationLocationId = request.nextUrl.searchParams.get("destinationLocationId");
  if (!isUuid(rawDestinationLocationId)) {
    return NextResponse.json({ error: "สาขาปลายทางไม่ถูกต้อง" }, { status: 400 });
  }
  const destinationLocationId = rawDestinationLocationId.toLowerCase();
  if (!canAccessDestination(result.auth, destinationLocationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์รับยางเข้าสาขานี้" }, { status: 403 });
  }

  const search = (request.nextUrl.searchParams.get("search")?.trim() ?? "").toLocaleLowerCase();
  const cursorValue = request.nextUrl.searchParams.get("cursor");
  if (search.length > 200 || (cursorValue?.length ?? 0) > 4096) {
    return NextResponse.json({ error: "พารามิเตอร์รายการรับยางไม่ถูกต้อง" }, { status: 400 });
  }
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
  if (!isBranchReceiptPage(data, destinationLocationId)) {
    return NextResponse.json(
      { error: "ระบบไม่ตอบกลับรายการรับยางตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  }
  const page = data;
  const rows = page.rows;
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
    candidates: rows.map((row) => ({
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
  const destinationLocationId = payload.destinationLocationId.toLowerCase();
  const sourceRubberExportId = payload.sourceRubberExportId.toLowerCase();
  if (!canAccessDestination(result.auth, destinationLocationId)) {
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
        p_destination_location_id: destinationLocationId,
        p_source_rubber_export_id: sourceRubberExportId,
        p_remaining_yard_weight: payload.remainingYardWeight as number,
      })
    : await result.supabase.rpc("receive_rubber_export", {
        p_destination_location_id: destinationLocationId,
        p_source_rubber_export_id: sourceRubberExportId,
      });
  if (error) return errorResponse(error.message);
  if (!isBranchReceiptResult(data, sourceRubberExportId)) {
    return NextResponse.json(
      { error: "ระบบไม่ตอบกลับผลการรับยางตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  }

  return NextResponse.json(data, {
    status: 201,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
