import { NextRequest, NextResponse } from "next/server";

import {
  hasSystemManagerAccess,
  requireRoleOrSystemManager,
} from "@/lib/server/auth";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const result = await requireRoleOrSystemManager(request, ["admin"]);
  if (!result.ok) return result.response;

  const body = (await request.json().catch(() => null)) as {
    locationId?: unknown;
  } | null;
  if (typeof body?.locationId !== "string" || !UUID.test(body.locationId)) {
    return NextResponse.json({ error: "สาขาไม่ถูกต้อง" }, { status: 400 });
  }

  if (
    !hasSystemManagerAccess(result.auth) &&
    !result.auth.locationIds.includes(body.locationId)
  ) {
    return NextResponse.json(
      { error: "ไม่มีสิทธิ์คำนวณ Dashboard สำหรับสาขานี้" },
      { status: 403 },
    );
  }

  const { data, error } = await result.supabase.functions.invoke(
    "dashboard-refresh",
    {
      body: { locationId: body.locationId },
    },
  );
  if (error) {
    console.error("Dashboard immediate refresh error:", error.message);
    return NextResponse.json(
      { error: "เริ่มคำนวณ Dashboard ไม่สำเร็จ" },
      { status: 502 },
    );
  }

  return NextResponse.json(data, {
    status: 202,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
