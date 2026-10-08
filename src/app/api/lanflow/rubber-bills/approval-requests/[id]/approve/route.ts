import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import {
  isIsoTimestamp,
  isJsonObject,
  isSafePositiveInteger,
  isUuid,
  managementAuthFailure,
  opaqueRpcErrorResponse,
} from "@/lib/server/management-route-error";

function isRubberBillApprovalResult(value: unknown, expectedRequestId: string) {
  if (!isJsonObject(value)
      || value.status !== "approved"
      || !isUuid(value.requestId)
      || value.requestId.toLowerCase() !== expectedRequestId
      || (value.operation !== "create" && value.operation !== "update" && value.operation !== "delete")
      || !isUuid(value.billId)
      || !isJsonObject(value.syncResult)) {
    return false;
  }

  return value.syncResult.status === "synced"
    && isUuid(value.syncResult.id)
    && value.syncResult.id.toLowerCase() === value.billId.toLowerCase()
    && typeof value.syncResult.serverBillNo === "string"
    && value.syncResult.serverBillNo.trim().length > 0
    && isSafePositiveInteger(value.syncResult.revisionNo)
    && (value.operation !== "create" || value.syncResult.revisionNo === 1)
    && isIsoTimestamp(value.syncResult.serverReceivedAt);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ errorMessage: "รหัสคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const requestId = id.toLowerCase();
  const { data, error } = await authCheck.supabase.rpc(
    "approve_rubber_bill_approval_request",
    { p_request_id: requestId }
  );

  if (error) {
    return opaqueRpcErrorResponse(error, "อนุมัติคำขอไม่สำเร็จ", ["P0001"]);
  }
  if (!isRubberBillApprovalResult(data, requestId)) {
    return NextResponse.json(
      { errorMessage: "ระบบไม่ตอบกลับผลการอนุมัติตามรูปแบบที่กำหนด" },
      { status: 500 },
    );
  }

  return NextResponse.json(data);
}
