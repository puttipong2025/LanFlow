import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import { parseRubberApprovalGroupBody } from "@/lib/server/rubber-approval-groups";

export async function GET(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { data, error } = await authCheck.supabase.rpc("list_rubber_approval_groups");
  if (error) return managementErrorResponse(error, "โหลดกลุ่มอนุมัติบิลยางไม่สำเร็จ");
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  try {
    const parsed = parseRubberApprovalGroupBody(await request.json());
    if ("errorMessage" in parsed) {
      return NextResponse.json({ errorMessage: parsed.errorMessage }, { status: 400 });
    }
    const { data, error } = await authCheck.supabase.rpc("create_rubber_approval_group", {
      p_location_ids: parsed.value.locationIds,
      p_edit_window_minutes: parsed.value.editWindowMinutes,
      p_configured_price: parsed.value.configuredPrice,
    });
    if (error) return managementErrorResponse(error, "สร้างกลุ่มไม่สำเร็จ");
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ errorMessage: "ข้อมูลกลุ่มไม่ถูกต้อง" }, { status: 400 });
  }
}
