import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import {
  isIsoTimestamp,
  isJsonObject,
  isNonNegativePostgresInteger,
  isSafePositiveInteger,
  isUuid,
} from "@/lib/server/management-route-error";

const GENERIC_SYNC_FAILURE_MESSAGE = "บันทึกบิลยางไม่สำเร็จ";
const DATABASE_ERROR_DETAIL_PATTERN = /(?:\b(?:relation|column|constraint|schema|table|function|operator|sequence|trigger)\b.*\b(?:does not exist|violates|already exists|not found)\b)|(?:duplicate key value|invalid input syntax|permission denied|sqlstate|syntax error at or near|division by zero|numeric field overflow|value too long|deadlock detected|could not serialize|current transaction is aborted)|(?:\b(?:private|public|auth|storage)\.[a-z_][a-z0-9_]*)|(?:\b[a-z][a-z0-9_]*(?:_pkey|_key|_fkey|_check)\b)/i;

function publicSyncErrorMessage(value: unknown) {
  if (typeof value !== "string"
      || value.trim().length === 0
      || value.length > 500
      || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)
      || DATABASE_ERROR_DETAIL_PATTERN.test(value)) {
    return GENERIC_SYNC_FAILURE_MESSAGE;
  }
  return value;
}

function isRubberBillSubmissionIdentity(value: Record<string, unknown>) {
  const operation = value.operation;
  const expectedRevisionNo = value.expectedRevisionNo;
  return (operation === "create" || operation === "update" || operation === "delete")
    && isUuid(value.locationId)
    && typeof value.clientTempId === "string"
    && value.clientTempId.trim().length > 0
    && typeof value.idempotencyKey === "string"
    && value.idempotencyKey.trim().length > 0
    && isNonNegativePostgresInteger(expectedRevisionNo)
    && (operation === "create" ? expectedRevisionNo === 0 : expectedRevisionNo > 0);
}

function isRubberBillSyncResult(
  value: unknown,
  expectedSubmission: Record<string, unknown>,
): value is Record<string, unknown> {
  if (!isJsonObject(value)) return false;
  if (value.status === "synced") {
    const operation = expectedSubmission.operation;
    const expectedRevisionNo = expectedSubmission.expectedRevisionNo;
    const hasValidRevision = operation === "create" && expectedRevisionNo === 0
      ? isSafePositiveInteger(value.revisionNo)
      : (operation === "update" || operation === "delete")
        && isSafePositiveInteger(expectedRevisionNo)
        && value.revisionNo === expectedRevisionNo + 1;
    return hasValidRevision
      && isUuid(value.id)
      && typeof value.serverBillNo === "string"
      && value.serverBillNo.trim().length > 0
      && isIsoTimestamp(value.serverReceivedAt);
  }
  if (value.status === "pending_approval") {
    return isUuid(value.requestId)
      && (value.operation === "create" || value.operation === "update" || value.operation === "delete")
      && value.operation === expectedSubmission.operation
      && typeof value.clientTempId === "string"
      && value.clientTempId.length > 0
      && value.clientTempId === expectedSubmission.clientTempId;
  }
  if (value.status === "conflict" || value.status === "failed") {
    return typeof value.errorMessage === "string" && value.errorMessage.length > 0;
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth(request);
    if (!authResult.ok) {
      return authResult.response;
    }

    const raw = await request.text();
    if (!raw) {
      return NextResponse.json({ status: "failed", errorMessage: "ไม่มีข้อมูลบิลยางสำหรับซิงก์" }, { status: 400 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ status: "failed", errorMessage: "รูปแบบข้อมูลบิลยางไม่ถูกต้อง" }, { status: 400 });
    }
    if (!isJsonObject(payload)) {
      return NextResponse.json({ status: "failed", errorMessage: "ข้อมูลบิลยางสำหรับซิงก์ไม่ถูกต้อง" }, { status: 400 });
    }
    if (!isRubberBillSubmissionIdentity(payload)) {
      return NextResponse.json(
        { status: "failed", errorMessage: "ข้อมูลอ้างอิงการซิงก์บิลยางไม่ถูกต้อง" },
        { status: 400 },
      );
    }

    const { data, error } = await authResult.supabase.rpc("sync_rubber_bill", { payload });
    if (error) {
      console.error("Rubber Bill sync RPC failed", error.code ?? "unknown");
      return NextResponse.json(
        { status: "failed", errorMessage: "ระบบซิงก์บิลยางไม่พร้อมใช้งานชั่วคราว" },
        { status: 503 },
      );
    }
    if (!isRubberBillSyncResult(data, payload)) {
      return NextResponse.json(
        { status: "failed", errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด" },
        { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }
    const result = data.status === "failed" || data.status === "conflict"
      ? { ...data, errorMessage: publicSyncErrorMessage(data.errorMessage) }
      : data;
    const status = result.status;
    const responseStatus = status === "conflict" ? 409 : status === "failed" ? 400 : 200;
    return NextResponse.json(result, {
      status: responseStatus,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Rubber Bill sync route failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json(
      { status: "failed", errorMessage: "ระบบซิงก์บิลยางไม่พร้อมใช้งานชั่วคราว" },
      { status: 503 },
    );
  }
}
