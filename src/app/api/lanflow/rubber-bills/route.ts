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
const MAX_SYNC_REQUEST_BYTES = 1024 * 1024;
const DATABASE_ERROR_DETAIL_PATTERN = /(?:\b(?:relation|column|constraint|schema|table|function|operator|sequence|trigger)\b.*\b(?:does not exist|violates|already exists|not found)\b)|(?:duplicate key value|invalid input syntax|permission denied|sqlstate|syntax error at or near|division by zero|numeric field overflow|value too long|deadlock detected|could not serialize|current transaction is aborted)|(?:\b(?:private|public|auth|storage)\.[a-z_][a-z0-9_]*)|(?:\b[a-z][a-z0-9_]*(?:_pkey|_key|_fkey|_check)\b)/i;

type BoundedRequestText =
  | { ok: true; text: string }
  | { ok: false };

async function readBoundedRequestText(request: Request): Promise<BoundedRequestText> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_SYNC_REQUEST_BYTES) {
      return { ok: false };
    }
  }

  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_SYNC_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks, receivedBytes).toString("utf8");
    return { ok: true, text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
  } finally {
    reader.releaseLock();
  }
}

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

function isSameUuid(left: unknown, right: unknown) {
  return isUuid(left) && isUuid(right) && left.toLowerCase() === right.toLowerCase();
}

function isRubberBillSubmissionIdentity(value: Record<string, unknown>) {
  const operation = value.operation;
  const expectedRevisionNo = value.expectedRevisionNo;
  const expectedServerId = value.expectedServerId;
  return (operation === "create" || operation === "update" || operation === "delete")
    && isUuid(value.locationId)
    && typeof value.clientTempId === "string"
    && value.clientTempId.trim().length > 0
    && typeof value.idempotencyKey === "string"
    && value.idempotencyKey.trim().length > 0
    && isNonNegativePostgresInteger(expectedRevisionNo)
    && (expectedServerId === undefined
      || (operation !== "create" && isUuid(expectedServerId)))
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
      && (operation === "create"
        || expectedSubmission.expectedServerId === undefined
        || isSameUuid(value.id, expectedSubmission.expectedServerId))
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
  if (value.status === "discarded") {
    return (value.operation === "create" || value.operation === "update" || value.operation === "delete")
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

    const requestText = await readBoundedRequestText(request);
    if (!requestText.ok) {
      return NextResponse.json(
        { status: "failed", errorMessage: "ข้อมูลบิลยางมีขนาดใหญ่เกินกำหนด" },
        { status: 413, headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }
    const raw = requestText.text;
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

    if (payload.expectedServerId !== undefined) {
      const expectedBill = await authResult.supabase
        .from("rubber_bills")
        .select("id")
        .eq("client_temp_id", String(payload.clientTempId))
        .eq("location_id", String(payload.locationId))
        .maybeSingle();
      if (expectedBill.error) {
        console.error("Rubber Bill identity lookup failed", expectedBill.error.code ?? "unknown");
        return NextResponse.json(
          { status: "failed", errorMessage: "ตรวจสอบข้อมูลอ้างอิงบิลยางไม่สำเร็จ" },
          { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
        );
      }
      if (!isSameUuid(expectedBill.data?.id, payload.expectedServerId)) {
        return NextResponse.json(
          { status: "conflict", errorMessage: "ข้อมูลอ้างอิงบิลยางไม่ตรงกับ Server" },
          { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } },
        );
      }
    }

    const rpcPayload = { ...payload };
    delete rpcPayload.expectedServerId;
    const { data, error } = await authResult.supabase.rpc("sync_rubber_bill", { payload: rpcPayload });
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
    if (data.status === "synced" && payload.operation === "create") {
      const persistedBill = await authResult.supabase
        .from("rubber_bills")
        .select("id")
        .eq("client_temp_id", String(payload.clientTempId))
        .eq("location_id", String(payload.locationId))
        .maybeSingle();
      if (persistedBill.error) {
        console.error("Rubber Bill create identity lookup failed", persistedBill.error.code ?? "unknown");
        return NextResponse.json(
          { status: "failed", errorMessage: "ตรวจสอบข้อมูลอ้างอิงบิลยางไม่สำเร็จ" },
          { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
        );
      }
      if (!isSameUuid(persistedBill.data?.id, data.id)) {
        return NextResponse.json(
          { status: "failed", errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับตามรูปแบบที่กำหนด" },
          { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
        );
      }
    }
    const result = data.status === "failed" || data.status === "conflict"
      ? { ...data, errorMessage: publicSyncErrorMessage(data.errorMessage) }
      : data;
    const status = result.status;
    const responseStatus = status === "conflict"
      ? 409
      : status === "failed"
        ? result.errorMessage === GENERIC_SYNC_FAILURE_MESSAGE ? 503 : 400
        : 200;
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
