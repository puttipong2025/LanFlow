import { NextRequest, NextResponse } from "next/server";

import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import { isIsoTimestamp, isJsonObject, isSafePositiveInteger, isUuid } from "@/lib/server/management-route-error";

export const dynamic = "force-dynamic";

type Cursor = {
  version: 1;
  ownerUserId: string;
  locationId: string;
  view: string;
  search: string;
  billId: string | null;
  sortAt: string;
  cursorBillId: string;
};

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return parsed?.version === 1
      && isUuid(parsed.ownerUserId)
      && isUuid(parsed.locationId)
      && typeof parsed.view === "string"
      && typeof parsed.search === "string"
      && (parsed.billId === null || isUuid(parsed.billId))
      && isIsoTimestamp(parsed.sortAt)
      && isUuid(parsed.cursorBillId)
      ? parsed : null;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const params = request.nextUrl.searchParams;
  const locationId = params.get("locationId") ?? "";
  const view = params.get("view") ?? "pending";
  const search = (params.get("search") ?? "").trim().toLocaleLowerCase("th-TH");
  const billId = params.get("billId") || null;
  const limit = Number(params.get("limit") ?? 75);
  if (!hasSystemManagerAccess(result.auth) && !result.auth.locationIds.includes(locationId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });
  }
  if (!isUuid(locationId) || (billId !== null && !isUuid(billId))
    || !["pending", "history"].includes(view) || !Number.isInteger(limit) || limit < 1 || limit > 75) {
    return NextResponse.json({ error: "พารามิเตอร์คิวหลักฐานไม่ถูกต้อง" }, { status: 400 });
  }

  const cursorValue = params.get("cursor");
  const cursor = cursorValue ? decodeCursor(cursorValue) : null;
  if (cursorValue && !cursor) {
    return NextResponse.json({ error: "cursor ไม่ถูกต้อง", code: "INVALID_CURSOR" }, { status: 400 });
  }
  if (cursor && (cursor.ownerUserId !== result.auth.sub || cursor.locationId !== locationId
    || cursor.view !== view || cursor.search !== search || cursor.billId !== billId)) {
    return NextResponse.json({ error: "cursor ไม่ตรงกับขอบเขตคิว", code: "CURSOR_SCOPE_MISMATCH" }, { status: 400 });
  }

  const failure = () => {
    console.error("Rubber Evidence feed unavailable");
    return NextResponse.json({ error: "โหลดคิวหลักฐานไม่สำเร็จ" }, { status: 500 });
  };
  try {
    const { data, error } = await result.supabase.rpc("get_rubber_bill_evidence_feed", {
      p_location_id: locationId,
      p_view: view,
      p_search: search,
      p_bill_id: billId,
      p_cursor_sort_at: cursor?.sortAt ?? null,
      p_cursor_bill_id: cursor?.cursorBillId ?? null,
      p_page_size: limit,
    });
    if (error || !isJsonObject(data) || !Array.isArray(data.rows) || data.rows.length > limit
      || !data.rows.every((row: unknown) => isJsonObject(row) && isUuid(row.id) && isSafePositiveInteger(row.revision_no))
      || typeof data.hasMore !== "boolean") return failure();
    let nextCursor: string | null = null;
    if (data.hasMore) {
      if (data.rows.length === 0 || !isIsoTimestamp(data.nextSortAt) || !isUuid(data.nextBillId)) return failure();
      nextCursor = encodeCursor({
        version: 1, ownerUserId: result.auth.sub, locationId, view, search, billId,
        sortAt: data.nextSortAt, cursorBillId: data.nextBillId,
      });
    }
    return NextResponse.json({ rows: data.rows, hasMore: data.hasMore, nextCursor });
  } catch {
    return failure();
  }
}
