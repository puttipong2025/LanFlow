import { NextRequest, NextResponse } from "next/server";

import { hasSystemManagerAccess, requireAuth } from "@/lib/server/auth";
import type { DashboardSnapshot } from "@/types/dashboard";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

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

  const { data, error } = await result.supabase.rpc("get_dashboard_snapshot", {
    p_location_id: locationId,
  });
  if (error) {
    console.error("Dashboard snapshot error:", error.message);
    return NextResponse.json(
      { error: "โหลดผลคำนวณ Dashboard ไม่สำเร็จ" },
      { status: 500 },
    );
  }

  return NextResponse.json(data as DashboardSnapshot, {
    headers: NO_STORE_HEADERS,
  });
}
