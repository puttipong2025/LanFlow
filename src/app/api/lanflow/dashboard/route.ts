import { NextRequest, NextResponse } from "next/server";
import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import type { DashboardOverview } from "@/types/dashboard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RawDashboardOverview = Omit<DashboardOverview, "nextCursor"> & {
  nextCursor: { at: string; key: string } | null;
};

function decodeCursor(cursor: string | null) {
  if (!cursor) return { at: null, key: null };
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const separator = decoded.indexOf("|");
    const at = decoded.slice(0, separator);
    const key = decoded.slice(separator + 1);
    if (separator < 1 || !key || Number.isNaN(Date.parse(at))) return null;
    return { at, key };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  const locationId = request.nextUrl.searchParams.get("locationId");
  if (
    !locationId ||
    !UUID.test(locationId) ||
    (!hasSystemManagerAccess(result.auth) &&
      !result.auth.locationIds.includes(locationId))
  ) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงสาขา" }, { status: 403 });
  }

  const cursor = decodeCursor(request.nextUrl.searchParams.get("cursor"));
  if (!cursor) {
    return NextResponse.json({ error: "cursor ไม่ถูกต้อง" }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("get_dashboard_overview", {
    p_location_id: locationId,
    p_cursor_at: cursor.at,
    p_cursor_key: cursor.key,
    p_page_size: 10,
  });

  if (error) {
    console.error("Dashboard overview error:", error.message);
    return NextResponse.json({ error: "โหลดข้อมูลภาพรวมไม่สำเร็จ" }, { status: 500 });
  }

  const payload = data as RawDashboardOverview | null;
  if (!payload?.summary || !Array.isArray(payload.rows)) {
    return NextResponse.json({ error: "ข้อมูลภาพรวมไม่สมบูรณ์" }, { status: 500 });
  }

  const nextCursor = payload.nextCursor
    ? Buffer.from(`${payload.nextCursor.at}|${payload.nextCursor.key}`, "utf8").toString("base64")
    : null;

  return NextResponse.json({
    ...payload,
    nextCursor,
  } satisfies DashboardOverview, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
