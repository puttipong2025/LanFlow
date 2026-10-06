import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  isUuid,
  managementAuthFailure,
} from "@/lib/server/management-route-error";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ errorMessage: "รหัสคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const { error } = await authCheck.supabase.rpc(
    "delete_rubber_bill_approval_request",
    { p_request_id: id }
  );

  if (error) {
    return NextResponse.json({ errorMessage: "ลบคำขอไม่สำเร็จ" }, { status: 400 });
  }

  return NextResponse.json({ status: "deleted", requestId: id });
}
