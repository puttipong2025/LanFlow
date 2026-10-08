import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import {
  isRubberApprovalGroupMutationResult,
  isRubberApprovalGroupsResult,
  parseRubberApprovalGroupBody,
} from "@/lib/server/rubber-approval-groups";

export async function GET(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { data, error } = await authCheck.supabase.rpc("list_rubber_approval_groups");
  if (error) return managementErrorResponse(error, "โหลดกลุ่มอนุมัติบิลยางไม่สำเร็จ");
  if (!isRubberApprovalGroupsResult(data)) {
    return NextResponse.json({ errorMessage: "ระบบไม่ตอบกลับข้อมูลกลุ่มตามรูปแบบที่กำหนด" }, { status: 500 });
  }
  return NextResponse.json({
    ...data,
    canEditMaxPriceAllowance: authCheck.auth.role === "super_admin",
  });
}

export async function POST(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ errorMessage: "ข้อมูลกลุ่มไม่ถูกต้อง" }, { status: 400 });
  }
  const parsed = parseRubberApprovalGroupBody(body);
  if ("errorMessage" in parsed) {
    return NextResponse.json({ errorMessage: parsed.errorMessage }, { status: 400 });
  }
  const { data, error } = await authCheck.supabase.rpc("create_rubber_approval_group_v2", {
    p_location_ids: parsed.value.locationIds,
    p_edit_window_minutes: parsed.value.editWindowMinutes,
    p_price_allowance: parsed.value.priceAllowance,
  });
  if (error) return managementErrorResponse(error, "สร้างกลุ่มไม่สำเร็จ");
  if (!isRubberApprovalGroupMutationResult(data, parsed.value)) {
    return NextResponse.json({ errorMessage: "ระบบไม่ตอบกลับผลการสร้างกลุ่ม" }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
