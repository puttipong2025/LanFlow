import { NextRequest, NextResponse } from "next/server";

import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import type {
  DashboardMoneyHistory,
  DashboardMoneyHistoryAction,
} from "@/types/dashboard";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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
      Number.isNaN(Date.parse(at))
    ) return null;
    return { at, id };
  } catch {
    return null;
  }
}

function isValidDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

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
  if (eventDate && !isValidDate(eventDate)) {
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
        { error: "วันที่อยู่นอกช่วงประวัติ 15 วัน" },
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
