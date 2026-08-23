import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  isUuid,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import { parseRubberApprovalGroupBody } from "@/lib/server/rubber-approval-groups";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสกลุ่มไม่ถูกต้อง" }, { status: 400 });

  try {
    const parsed = parseRubberApprovalGroupBody(await request.json());
    if ("errorMessage" in parsed) {
      return NextResponse.json({ errorMessage: parsed.errorMessage }, { status: 400 });
    }
    const { data, error } = await authCheck.supabase.rpc("update_rubber_approval_group", {
      p_group_id: id,
      p_location_ids: parsed.value.locationIds,
      p_edit_window_minutes: parsed.value.editWindowMinutes,
      p_configured_price: parsed.value.configuredPrice,
    });
    if (error) return managementErrorResponse(error, "แก้ไขกลุ่มไม่สำเร็จ");
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ errorMessage: "ข้อมูลกลุ่มไม่ถูกต้อง" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสกลุ่มไม่ถูกต้อง" }, { status: 400 });
  const { data, error } = await authCheck.supabase.rpc("delete_rubber_approval_group", {
    p_group_id: id,
  });
  if (error) return managementErrorResponse(error, "ลบกลุ่มไม่สำเร็จ");
  return NextResponse.json(data);
}
