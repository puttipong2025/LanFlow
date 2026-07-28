import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import type { DashboardManagerConfig } from "@/types/dashboard";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;

  const locationId = request.nextUrl.searchParams.get("locationId");
  if (!locationId || !UUID.test(locationId)) {
    return NextResponse.json({ error: "สาขาไม่ถูกต้อง" }, { status: 400 });
  }

  const [
    settingsResult,
    thresholdsResult,
    locationsResult,
    snapshotResult,
  ] = await Promise.all([
    result.supabase.rpc("get_dashboard_refresh_settings"),
    result.supabase.rpc("get_dashboard_alert_thresholds", {
      p_location_id: locationId,
    }),
    result.supabase
      .from("locations")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    result.supabase.rpc("get_dashboard_snapshot", {
      p_location_id: locationId,
    }),
  ]);
  const error =
    settingsResult.error ||
    thresholdsResult.error ||
    locationsResult.error ||
    snapshotResult.error;
  if (error) {
    console.error("Dashboard config error:", error.message);
    return NextResponse.json(
      { error: "โหลดการตั้งค่า Dashboard ไม่สำเร็จ" },
      { status: 500 },
    );
  }

  const settings = settingsResult.data as Omit<
    DashboardManagerConfig,
    "thresholds" | "locations" | "snapshot"
  >;
  return NextResponse.json(
    {
      ...settings,
      thresholds: thresholdsResult.data,
      locations: locationsResult.data ?? [],
      snapshot: snapshotResult.data,
    } satisfies DashboardManagerConfig,
    { headers: NO_STORE_HEADERS },
  );
}

export async function PUT(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;

  const body = (await request.json().catch(() => null)) as {
    locationId?: unknown;
    intervalMinutes?: unknown;
    purchaseAverageMin?: unknown;
    netCashMin?: unknown;
    stockItems?: unknown;
  } | null;
  const locationId = body?.locationId;
  const intervalMinutes = Number(body?.intervalMinutes);
  const purchaseAverageMin = Number(body?.purchaseAverageMin);
  const netCashMin = Number(body?.netCashMin);
  const stockItems = body?.stockItems;

  if (typeof locationId !== "string" || !UUID.test(locationId)) {
    return NextResponse.json({ error: "สาขาไม่ถูกต้อง" }, { status: 400 });
  }
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 10 ||
    intervalMinutes > 1440
  ) {
    return NextResponse.json(
      { error: "รอบคำนวณต้องอยู่ระหว่าง 10 ถึง 1,440 นาที" },
      { status: 400 },
    );
  }
  if (
    !Number.isFinite(purchaseAverageMin) ||
    purchaseAverageMin < 0 ||
    !Number.isFinite(netCashMin) ||
    netCashMin < 0
  ) {
    return NextResponse.json(
      { error: "ยอดขั้นต่ำต้องไม่ติดลบ" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(stockItems) ||
    !stockItems.every(
      (item) =>
        item &&
        typeof item === "object" &&
        "productId" in item &&
        typeof item.productId === "string" &&
        UUID.test(item.productId) &&
        "minimumBalance" in item &&
        (item.minimumBalance === null ||
          (Number.isFinite(Number(item.minimumBalance)) &&
            Number(item.minimumBalance) >= 0)),
    )
  ) {
    return NextResponse.json(
      { error: "เกณฑ์สต็อกไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const saveResult = await result.supabase.rpc(
    "save_dashboard_manager_config",
    {
      p_location_id: locationId,
      p_interval_minutes: intervalMinutes,
      p_purchase_average_min: purchaseAverageMin,
      p_net_cash_min: netCashMin,
      p_stock_items: stockItems,
    },
  );
  if (saveResult.error) {
    return NextResponse.json(
      { error: saveResult.error.message },
      { status: 400 },
    );
  }

  return GET(request);
}
