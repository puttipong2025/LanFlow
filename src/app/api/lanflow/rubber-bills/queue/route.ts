import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isIsoTimestamp, isJsonObject, isUuid } from "@/lib/server/management-route-error";
import { isRubberQueueRow, isRubberQueueSubmission } from "@/lib/rubber-bills/central-queue-contract";
import { processRubberQueueImmediately } from "@/lib/server/rubber-queue-immediate";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
const failure = (status = 503) => NextResponse.json({ errorMessage: "ยังยืนยันสถานะคิวซิงก์ไม่ได้ กรุณาลองใหม่" }, { status, headers });

async function boundedJson(request: Request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
  } catch { return null; } finally { reader.releaseLock(); }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const params = new URL(request.url).searchParams;
    const locationId = params.get("locationId");
    const commandId = params.get("commandId");
    const before = params.get("before");
    const draftCommandId = params.get("draftCommandId");
    const beforeId = params.get("beforeId");
    if (!isUuid(locationId) || (commandId !== null && !isUuid(commandId))
      || (before !== null && !isIsoTimestamp(before)) || (draftCommandId !== null && !isUuid(draftCommandId))
      || (beforeId !== null && !isUuid(beforeId))) return failure(400);
    if (draftCommandId) {
      const { data, error } = await auth.supabase.rpc("get_rubber_queue_draft", { p_command_id: draftCommandId });
      if (error) return failure(error.message === "FORBIDDEN" ? 403 : 503);
      if (!isJsonObject(data) || data.commandId !== draftCommandId || data.locationId !== locationId
        || typeof data.clientTempId !== "string" || !isJsonObject(data.payload)) return failure();
      return NextResponse.json(data, { headers });
    }
    const { data, error } = commandId
      ? await auth.supabase.rpc("get_rubber_queue", { p_location_id: locationId, p_command_id: commandId })
      : await auth.supabase.rpc("list_rubber_queue", { p_location_id: locationId, p_history: params.get("history") === "true",
        p_before: before, p_before_id: beforeId, p_limit: 50, p_search: (params.get("search") ?? "").slice(0, 512) });
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
    if (!isRubberQueueSubmission(payload)) return failure(400);
    if (payload.actorUserId !== auth.auth.sub) return failure(403);
    const { data, error } = await auth.supabase.rpc("submit_rubber_queue", { payload });
    if (error) return failure(error.message.startsWith("FORBIDDEN") ? 403
      : ["COMMAND_MISMATCH", "REQUEST_CHANGED", "INVALID_COMMAND"].includes(error.message) ? 409 : 503);
    if (!isRubberQueueRow(data) || data.commandId !== payload.commandId || data.actorUserId !== auth.auth.sub
      || data.locationId !== payload.locationId || data.clientTempId !== payload.clientTempId
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
    if (!isJsonObject(payload) || !isUuid(payload.commandId) || !Number.isSafeInteger(payload.version)
      || Number(payload.version) < 1 || typeof payload.action !== "string" || !["retry", "retire"].includes(payload.action)) return failure(400);
    const { data, error } = await auth.supabase.rpc("manage_rubber_queue", {
      p_command_id: payload.commandId, p_version: payload.version, p_action: payload.action,
    });
    if (error) return failure(error.message.startsWith("FORBIDDEN") ? 403 : error.message === "QUEUE_CHANGED" ? 409 : 503);
    if (!isRubberQueueRow(data) || data.commandId !== payload.commandId) return failure();
    return NextResponse.json(data, { headers });
  } catch { return failure(); }
}
