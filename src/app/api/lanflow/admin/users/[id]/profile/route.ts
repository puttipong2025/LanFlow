import { NextRequest, NextResponse } from "next/server";

import { requireRoleOrSystemManager } from "@/lib/server/auth";
import {
  isUuid,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import type { AdminUserProfileUpdateRequest, AdminUserProfileUpdateResponse } from "@/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireRoleOrSystemManager(request, ["super_admin", "admin"]);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสพนักงานไม่ถูกต้อง" }, { status: 400 });

  try {
    const body = await request.json() as Partial<AdminUserProfileUpdateRequest>;
    if (typeof body.name !== "string"
        || !Array.isArray(body.locationIds)
        || !body.locationIds.every(isUuid)
        || new Set(body.locationIds).size !== body.locationIds.length
        || !(body.primaryLocationId === null || isUuid(body.primaryLocationId))) {
      return NextResponse.json({ errorMessage: "ข้อมูลพนักงานไม่ถูกต้อง" }, { status: 400 });
    }
    const { data, error } = await authCheck.supabase.rpc("update_admin_user_profile", {
      p_user_id: id,
      p_name: body.name,
      p_location_ids: body.locationIds,
      p_primary_location_id: body.primaryLocationId,
    });
    if (error) return managementErrorResponse(error, "บันทึกข้อมูลพนักงานไม่สำเร็จ");
    return NextResponse.json(data as AdminUserProfileUpdateResponse);
  } catch {
    return NextResponse.json({ errorMessage: "ข้อมูลพนักงานไม่ถูกต้อง" }, { status: 400 });
  }
}
