import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  isSafePositiveInteger,
  isUuid,
  managementAuthFailure,
  managementErrorResponse,
} from "@/lib/server/management-route-error";
import {
  isRubberApprovalGroupDeleteResult,
  isRubberApprovalGroupMutationResult,
  parseRubberApprovalGroupBody,
} from "@/lib/server/rubber-approval-groups";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสกลุ่มไม่ถูกต้อง" }, { status: 400 });
  const groupId = id.toLowerCase();

  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ errorMessage: "ข้อมูลกลุ่มไม่ถูกต้อง" }, { status: 400 });
  }
  const parsed = parseRubberApprovalGroupBody(body);
  if ("errorMessage" in parsed) {
    return NextResponse.json({ errorMessage: parsed.errorMessage }, { status: 400 });
  }
  if (parsed.value.revisionNo === undefined) {
    return NextResponse.json({ errorMessage: "ต้องระบุ revision ของกลุ่ม" }, { status: 400 });
  }
  const { data, error } = await authCheck.supabase.rpc("update_rubber_approval_group_v2", {
    p_group_id: groupId,
    p_location_ids: parsed.value.locationIds,
    p_edit_window_minutes: parsed.value.editWindowMinutes,
    p_price_allowance: parsed.value.priceAllowance,
    p_expected_revision: parsed.value.revisionNo,
    p_expected_source_revisions: parsed.value.sourceGroupRevisions,
  });
  if (error) return managementErrorResponse(error, "แก้ไขกลุ่มไม่สำเร็จ");
  if (!isRubberApprovalGroupMutationResult(data, { ...parsed.value, groupId })) {
    return NextResponse.json({ errorMessage: "ระบบไม่ตอบกลับผลการแก้ไขกลุ่ม" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ errorMessage: "รหัสกลุ่มไม่ถูกต้อง" }, { status: 400 });
  const groupId = id.toLowerCase();
  const revision = Number(request.nextUrl.searchParams.get("revision"));
  if (!isSafePositiveInteger(revision)) {
    return NextResponse.json({ errorMessage: "ต้องระบุ revision ของกลุ่ม" }, { status: 400 });
  }
  const { data, error } = await authCheck.supabase.rpc("delete_rubber_approval_group_v2", {
    p_group_id: groupId,
    p_expected_revision: revision,
  });
  if (error) return managementErrorResponse(error, "ลบกลุ่มไม่สำเร็จ");
  if (!isRubberApprovalGroupDeleteResult(data)) {
    return NextResponse.json({ errorMessage: "ระบบไม่ตอบกลับผลการลบกลุ่ม" }, { status: 500 });
  }
  return NextResponse.json(data);
}
