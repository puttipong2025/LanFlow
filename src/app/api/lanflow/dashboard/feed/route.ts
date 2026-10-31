import { NextRequest, NextResponse } from "next/server";

import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import { isIsoTimestamp } from "@/lib/validation/primitives";
import type {
  DashboardMoneyHistory,
  DashboardMoneyHistoryAction,
} from "@/types/dashboard";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

type RawHistory = Omit<DashboardMoneyHistory, "nextCursor"> & {
  nextCursor: { at: string; id: string } | null;
};

function decodeCursor(cursor: string | null) {
  if (!cursor) return { at: null, id: null };
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const separator = decoded.indexOf("|");
    const at = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (
      separator < 1 ||
      !UUID.test(id) ||
      !isIsoTimestamp(at)
    ) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    return await readMoneyHistory(request);
  } catch {
    console.error("Dashboard money history request failed");
    return NextResponse.json(
      { error: "โหลดรายการเงินล่าสุดไม่สำเร็จ" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

async function readMoneyHistory(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;
  const rawPage = request.nextUrl.searchParams.get("page");
  const page = rawPage === null ? null : Number(rawPage);
  if (rawPage !== null && (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || page! > 2147483647 || request.nextUrl.searchParams.has("cursor"))) {
    return NextResponse.json({ error: "เลขหน้าไม่ถูกต้อง" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const locationId = request.nextUrl.searchParams.get("locationId");
  const canAccess =
    locationId &&
    UUID.test(locationId) &&
    (hasSystemManagerAccess(result.auth) ||
      result.auth.locationIds.includes(locationId));
  if (!canAccess) {
    return NextResponse.json(
      { error: "ไม่มีสิทธิ์เข้าถึงสาขา" },
      { status: 403 },
    );
  }

  const cursor = decodeCursor(request.nextUrl.searchParams.get("cursor"));
  if (!cursor) {
    return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
  }

  const eventDate = request.nextUrl.searchParams.get("date");
  if (eventDate !== null && !isIsoTimestamp(`${eventDate}T00:00:00Z`)) {
    return NextResponse.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 });
  }

  const action = request.nextUrl.searchParams.get("action") ?? "all";
  if (!["all", "create", "update", "delete"].includes(action)) {
    return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc(
    "get_dashboard_money_history",
    {
      p_location_id: locationId,
      ...(page === null ? {} : { p_page: page }),
      p_event_date: eventDate,
      p_action: action as DashboardMoneyHistoryAction,
      p_cursor_at: cursor.at,
      p_cursor_id: cursor.id,
      p_page_size: 10,
    },
  );
  if (error) {
    if (error.message.includes("outside retention window")) {
      return NextResponse.json(
        { error: "วันที่อยู่นอกช่วงเก็บประวัติที่กำหนด" },
        { status: 400 },
      );
    }
    console.error("Dashboard money feed error:", error.message);
    return NextResponse.json(
      { error: "โหลดรายการเงินล่าสุดไม่สำเร็จ" },
      { status: 500 },
    );
  }

  const payload = data as RawHistory | null;
  if (!payload || !Array.isArray(payload.rows) || !payload.counts) {
    return NextResponse.json(
      { error: "ข้อมูลรายการเงินไม่สมบูรณ์" },
      { status: 500 },
    );
  }

  const nextCursor = payload.nextCursor
    ? Buffer.from(
        `${payload.nextCursor.at}|${payload.nextCursor.id}`,
        "utf8",
      ).toString("base64")
    : null;

  return NextResponse.json(
    { ...payload, nextCursor } satisfies DashboardMoneyHistory,
    { headers: NO_STORE_HEADERS },
  );
}
