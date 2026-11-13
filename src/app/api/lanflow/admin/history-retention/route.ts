import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import { readBoundedUtf8Body } from "@/lib/server/bounded-utf8-body";
import { validRetentionDate, validRetentionOverview, validRetentionReceipt,
  validRetentionStatus } from "@/lib/server/history-retention-response";
import { isIsoTimestamp } from "@/lib/validation/primitives";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const RELOAD_MESSAGE = "ระบบเก็บประวัติมีการอัปเดต กรุณาโหลดหน้าเว็บใหม่";
const MAX_RETENTION_BODY_BYTES = 4 * 1024;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function retentionError(message: string, code?: string) {
  if (code === "57014" || code === "55P03") {
    return errorResponse("ระบบเก็บประวัติไม่พร้อมชั่วคราว กรุณาลองใหม่", 503);
  }
  if (message.includes("HISTORY_RETENTION_CONFLICT")) {
    return errorResponse("การตั้งค่าถูกเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด", 409);
  }
  if (message.includes("HISTORY_RETENTION_INVALID")) {
    return errorResponse("จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365", 400);
  }
  if (message.includes("FORBIDDEN")) return errorResponse("ไม่มีสิทธิ์จัดการการตั้งค่านี้", 403);
  console.error("History retention error:", message);
  return errorResponse("จัดการระยะเก็บประวัติไม่สำเร็จ", 500);
}

function retentionResponse(data: unknown, valid: (value: unknown) => boolean, status = 200, nullableCounts = true) {
  if (!valid(data)) {
    return errorResponse("อ่านผลจากระบบเก็บประวัติไม่สำเร็จ กรุณาลองใหม่", 503);
  }
  if (!nullableCounts && data !== null && typeof data === "object"
    && "totalEligible" in data && data.totalEligible === null) return errorResponse(RELOAD_MESSAGE, 503);
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

async function getHistoryRetention(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const statusOnly = request.nextUrl.searchParams.get("view") === "status";
  const { data, error } = await result.supabase.rpc(
    statusOnly
      ? "get_history_cleanup_status" : "get_history_retention_overview",
  );
  if (error) return retentionError(error.message, error.code);
  return retentionResponse(data, statusOnly ? validRetentionStatus : validRetentionOverview, 200,
    request.nextUrl.searchParams.get("counts") === "nullable");
}

async function updateHistoryRetention(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const input = await readBoundedUtf8Body(request, MAX_RETENTION_BODY_BYTES);
  if (input.status === "too_large") return errorResponse("คำขอตั้งค่าประวัติมีขนาดใหญ่เกินไป", 413);
  if (input.status !== "ok") return errorResponse("คำขอไม่ถูกต้อง");
  let body: { action?: unknown; retentionDays?: unknown; expectedUpdatedAt?: unknown;
    requestId?: unknown; cutoffDate?: unknown } | null;
  try { body = JSON.parse(input.text); }
  catch { return errorResponse("คำขอไม่ถูกต้อง"); }
  if (body?.action === "cleanup") {
    if (typeof body.requestId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)
      || !isIsoTimestamp(body.expectedUpdatedAt) || !validRetentionDate(body.cutoffDate)) {
      return errorResponse("คำขอล้างประวัติไม่ถูกต้อง");
    }
    const { data, error } = await result.supabase.rpc("request_history_retention_cleanup", {
      p_request_id: body.requestId,
      p_expected_updated_at: body.expectedUpdatedAt,
      p_expected_cutoff_date: body.cutoffDate,
    });
    if (error) return retentionError(error.message, error.code);
    return retentionResponse(data, validRetentionReceipt, 202);
  }
  const retentionDays = body?.retentionDays;
  if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays)
    || retentionDays < 1 || retentionDays > 365) {
    return errorResponse("จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365");
  }
  if (body?.action === "preview") {
    const { data, error } = await result.supabase.rpc("get_history_retention_overview", {
      p_retention_days: retentionDays,
    });
    if (error) return retentionError(error.message, error.code);
    return retentionResponse(data, validRetentionOverview, 200, request.nextUrl.searchParams.get("counts") === "nullable");
  }
  if (body?.action !== "save" || !isIsoTimestamp(body.expectedUpdatedAt)) {
    return errorResponse("คำขอไม่ถูกต้อง");
  }
  // A previously opened dialog must not commit a change its old UI cannot read.
  if (request.nextUrl.searchParams.get("counts") !== "nullable") return errorResponse(RELOAD_MESSAGE, 503);
  const { data, error } = await result.supabase.rpc("save_history_retention_settings", {
    p_retention_days: retentionDays,
    p_expected_updated_at: body.expectedUpdatedAt,
  });
  if (error) return retentionError(error.message, error.code);
  return retentionResponse(data, validRetentionOverview);
}

export async function GET(request: NextRequest) {
  try { return await getHistoryRetention(request); }
  catch { return errorResponse("ติดต่อระบบเก็บประวัติไม่สำเร็จ กรุณาลองใหม่", 503); }
}

export async function POST(request: NextRequest) {
  try { return await updateHistoryRetention(request); }
  catch { return errorResponse("ติดต่อระบบเก็บประวัติไม่สำเร็จ กรุณาลองใหม่", 503); }
}
