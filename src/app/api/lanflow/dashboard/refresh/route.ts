import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;

  const body = (await request.json().catch(() => null)) as {
    locationId?: unknown;
  } | null;
  if (typeof body?.locationId !== "string" || !UUID.test(body.locationId)) {
    return NextResponse.json({ error: "สาขาไม่ถูกต้อง" }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("queue_dashboard_refresh", {
    p_location_id: body.locationId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
