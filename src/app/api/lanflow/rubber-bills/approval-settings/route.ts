import { NextRequest, NextResponse } from "next/server";

import { requireAuth, requireSystemManager } from "@/lib/server/auth";
import {
  isUuid,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";

function locationIdFrom(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId");
  return isUuid(locationId) ? locationId : null;
}

export async function GET(request: NextRequest) {
  const authCheck = await requireAuth(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);

  const locationId = locationIdFrom(request);
  if (!locationId) {
    return NextResponse.json({ errorMessage: "ต้องระบุสาขา" }, { status: 400 });
  }
  const { data, error } = await authCheck.supabase.rpc(
    "get_effective_rubber_approval_settings",
    { p_location_id: locationId },
  );
  if (error) return managementErrorResponse(error, "โหลดการตั้งค่าไม่สำเร็จ");
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);

  try {
    const locationId = locationIdFrom(request);
    if (!locationId) {
      return NextResponse.json({ errorMessage: "ต้องระบุสาขา" }, { status: 400 });
    }
    const body = await request.json() as { nonCurrentDateRequiresApproval?: unknown };
    if (typeof body.nonCurrentDateRequiresApproval !== "boolean") {
      return NextResponse.json({ errorMessage: "ต้องระบุกฎวันที่บิล" }, { status: 400 });
    }
    const saved = await authCheck.supabase.rpc("save_rubber_bill_date_approval_setting", {
      p_non_current_date_requires_approval: body.nonCurrentDateRequiresApproval,
    });
    if (saved.error) return managementErrorResponse(saved.error, "บันทึกการตั้งค่าไม่สำเร็จ");

    const effective = await authCheck.supabase.rpc("get_effective_rubber_approval_settings", {
      p_location_id: locationId,
    });
    if (effective.error) {
      return managementErrorResponse(effective.error, "โหลดการตั้งค่าหลังบันทึกไม่สำเร็จ");
    }
    return NextResponse.json(effective.data);
  } catch {
    return NextResponse.json(
      { errorMessage: "บันทึกการตั้งค่าไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
