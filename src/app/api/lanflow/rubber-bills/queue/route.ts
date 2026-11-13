import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isIsoTimestamp, isJsonObject, isSafePositiveInteger, isUuid } from "@/lib/server/management-route-error";
import { isRubberQueueDraft, isRubberQueueRow, isRubberQueueSubmission } from "@/lib/rubber-bills/central-queue-contract";
import { processRubberQueueImmediately } from "@/lib/server/rubber-queue-immediate";
import { readBoundedUtf8Body } from "@/lib/server/bounded-utf8-body";
import { isPostgresText, sameUuid } from "@/lib/validation/primitives";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
const failure = (status = 503) => NextResponse.json({ errorMessage: "ยังยืนยันสถานะคิวซิงก์ไม่ได้ กรุณาลองใหม่" }, { status, headers });
const rejectNumbering = (payload: Record<string, unknown>, status = 400) => NextResponse.json({
  errorCode: "NUMBERING_REJECTED", commandId: payload.commandId, clientTempId: payload.clientTempId, operation: payload.operation,
  errorMessage: "เลขบิลไม่ตรงกับทะเบียน กรุณาตรวจสอบกับผู้ดูแลก่อนลองใหม่",
}, { status, headers });

async function boundedJson(request: Request) {
  try {
    const body = await readBoundedUtf8Body(request, 1024 * 1024);
    return body.status === "ok" ? JSON.parse(body.text) : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const params = new URL(request.url).searchParams;
    const locationId = params.get("locationId")?.toLowerCase() ?? null;
    const commandId = params.get("commandId")?.toLowerCase() ?? null;
    const before = params.get("before");
    const draftCommandId = params.get("draftCommandId")?.toLowerCase() ?? null;
    const beforeId = params.get("beforeId")?.toLowerCase() ?? null;
    const search = params.get("search") ?? "";
    if (!isUuid(locationId) || (commandId !== null && !isUuid(commandId))
      || (before !== null && !isIsoTimestamp(before)) || (draftCommandId !== null && !isUuid(draftCommandId))
      || (beforeId !== null && (before === null || !isUuid(beforeId)))
      || (commandId !== null && draftCommandId !== null)
      || (!commandId && !draftCommandId && !isPostgresText(search))) return failure(400);
    if (draftCommandId) {
      const { data, error } = await auth.supabase.rpc("get_rubber_queue_draft", { p_command_id: draftCommandId });
      if (error) return failure(error.message === "FORBIDDEN" ? 403 : 503);
      if (!isRubberQueueDraft(data) || data.commandId !== draftCommandId || data.locationId !== locationId) return failure();
      return NextResponse.json(data, { headers });
    }
    const { data, error } = commandId
      ? await auth.supabase.rpc("get_rubber_queue", { p_location_id: locationId, p_command_id: commandId })
      : await auth.supabase.rpc("list_rubber_queue", { p_location_id: locationId, p_history: params.get("history") === "true",
        p_before: before, p_before_id: beforeId, p_limit: 50, p_search: Array.from(search).slice(0, 512).join("") });
    if (error) return failure(error.message === "FORBIDDEN" ? 403 : 503);
    if (commandId) {
      if (data === null) return failure(404);
      if (!isRubberQueueRow(data) || data.commandId !== commandId || data.locationId !== locationId) return failure();
    } else if (!isJsonObject(data) || !Array.isArray(data.rows) || data.rows.length > 50
      || !data.rows.every(row => isRubberQueueRow(row) && row.locationId === locationId)
      || !isJsonObject(data.counts) || !Number.isSafeInteger(data.counts.pending) || Number(data.counts.pending) < 0
      || !Number.isSafeInteger(data.counts.attention) || Number(data.counts.attention) < 0
      || (data.notices !== undefined && (!Array.isArray(data.notices) || data.notices.length > 5
        || !data.notices.every(row => isRubberQueueRow(row) && row.locationId === locationId && row.state === "done")))) return failure();
    return NextResponse.json(data, { headers });
  } catch { return failure(); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const payload = await boundedJson(request);
    if (!isRubberQueueSubmission(payload)) {
      if (isJsonObject(payload) && payload.billNumbering !== undefined
        && isRubberQueueSubmission({ ...payload, billNumbering: undefined })) {
        if (!sameUuid(payload.actorUserId, auth.auth.sub)) return failure(403);
        return rejectNumbering(payload);
      }
      return failure(400);
    }
    if (!sameUuid(payload.actorUserId, auth.auth.sub)) return failure(403);
    const commandId = payload.commandId.toLowerCase();
    const managerTarget = (payload.queueAction === "approve" || payload.queueAction === "cancel")
      && isUuid(payload.targetRequestId) ? payload.targetRequestId.toLowerCase() : null;
    const clientTempId = managerTarget ? `request:${managerTarget}` : payload.clientTempId;
    // The database compares the idempotency key with the canonical UUID text.
    const { data, error } = await auth.supabase.rpc(payload.billNumbering ? "submit_numbered_rubber_queue" : "submit_rubber_queue", {
      payload: { ...payload, commandId, idempotencyKey: commandId, clientTempId,
        ...(managerTarget ? { targetRequestId: managerTarget } : {}) },
    });
    if (payload.billNumbering && error && ["INVALID_BILL_NUMBER", "BILL_NUMBER_CHANGED"].includes(error.message)) {
      return rejectNumbering(payload, error.message === "BILL_NUMBER_CHANGED" ? 409 : 400);
    }
    if (error?.message === "REQUEST_CHANGED" && (payload.queueAction === "approve" || payload.queueAction === "cancel")) {
      return NextResponse.json({
        errorCode: "REQUEST_CHANGED", commandId: payload.commandId, clientTempId: payload.clientTempId,
        queueAction: payload.queueAction, targetRequestId: payload.targetRequestId,
        errorMessage: "คำขอเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุด",
      }, { status: 409, headers });
    }
    if (error) return failure(error.message.startsWith("FORBIDDEN") ? 403
      : ["COMMAND_MISMATCH", "REQUEST_CHANGED", "INVALID_COMMAND"].includes(error.message) ? 409 : 503);
    if (!isRubberQueueRow(data) || !sameUuid(data.commandId, payload.commandId) || !sameUuid(data.actorUserId, auth.auth.sub)
      || !sameUuid(data.locationId, payload.locationId) || data.clientTempId !== clientTempId
      || data.action !== (payload.queueAction ?? payload.operation)) return failure();
    let receipt = data;
    try {
      if (data.state === "queued" && await processRubberQueueImmediately(data.locationId)) {
        const refreshed = await auth.supabase.rpc("get_rubber_queue", { p_location_id: data.locationId, p_command_id: data.commandId });
        if (!refreshed.error && isRubberQueueRow(refreshed.data) && refreshed.data.commandId === data.commandId
          && refreshed.data.actorUserId === data.actorUserId && refreshed.data.locationId === data.locationId
          && refreshed.data.clientTempId === data.clientTempId && refreshed.data.action === data.action) receipt = refreshed.data;
      }
    } catch { /* Admission is already committed; cron and receipt polling retain ownership. */ }
    return NextResponse.json(receipt, { status: receipt.state === "done" ? 200 : 202, headers });
  } catch { return failure(); }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const payload = await boundedJson(request);
    if (!isJsonObject(payload) || !isUuid(payload.commandId) || !isSafePositiveInteger(payload.version)
      || (payload.action !== "retry" && payload.action !== "retire")) return failure(400);
    const { data, error } = await auth.supabase.rpc("manage_rubber_queue", {
      p_command_id: payload.commandId, p_version: payload.version, p_action: payload.action,
    });
    if (error) return failure(error.message.startsWith("FORBIDDEN") ? 403 : error.message === "QUEUE_CHANGED" ? 409 : 503);
    if (!isRubberQueueRow(data) || !sameUuid(data.commandId, payload.commandId)
      || data.version !== payload.version + 1) return failure();
    if (payload.action === "retry" ? data.state !== "queued"
      : data.state !== "done" || data.result?.status !== "discarded") return failure();
    return NextResponse.json(data, { headers });
  } catch { return failure(); }
}
