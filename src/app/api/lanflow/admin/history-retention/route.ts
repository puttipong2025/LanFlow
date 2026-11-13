import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !value.startsWith("0000") && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && validDate(value.slice(0, 10))
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.test(value)
    && Number.isFinite(Date.parse(value));
}

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

function retentionResponse(data: unknown, status = 200) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return errorResponse("อ่านผลจากระบบเก็บประวัติไม่สำเร็จ กรุณาลองใหม่", 503);
  }
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

async function getHistoryRetention(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const { data, error } = await result.supabase.rpc(
    request.nextUrl.searchParams.get("view") === "status"
      ? "get_history_cleanup_status" : "get_history_retention_overview",
  );
  if (error) return retentionError(error.message, error.code);
  return retentionResponse(data);
}

async function updateHistoryRetention(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const body = await request.json().catch(() => null) as {
    action?: unknown;
    retentionDays?: unknown;
    expectedUpdatedAt?: unknown;
    requestId?: unknown;
    cutoffDate?: unknown;
  } | null;
  if (body?.action === "cleanup") {
    if (typeof body.requestId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)
      || !validTimestamp(body.expectedUpdatedAt) || !validDate(body.cutoffDate)) {
      return errorResponse("คำขอล้างประวัติไม่ถูกต้อง");
    }
    const { data, error } = await result.supabase.rpc("request_history_retention_cleanup", {
      p_request_id: body.requestId,
      p_expected_updated_at: body.expectedUpdatedAt,
      p_expected_cutoff_date: body.cutoffDate,
    });
    if (error) return retentionError(error.message, error.code);
    return retentionResponse(data, 202);
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
    return retentionResponse(data);
  }
  if (body?.action !== "save" || !validTimestamp(body.expectedUpdatedAt)) {
    return errorResponse("คำขอไม่ถูกต้อง");
  }
  const { data, error } = await result.supabase.rpc("save_history_retention_settings", {
    p_retention_days: retentionDays,
    p_expected_updated_at: body.expectedUpdatedAt,
  });
  if (error) return retentionError(error.message, error.code);
  return retentionResponse(data);
}

export async function GET(request: NextRequest) {
  try { return await getHistoryRetention(request); }
  catch { return errorResponse("ติดต่อระบบเก็บประวัติไม่สำเร็จ กรุณาลองใหม่", 503); }
}

export async function POST(request: NextRequest) {
  try { return await updateHistoryRetention(request); }
  catch { return errorResponse("ติดต่อระบบเก็บประวัติไม่สำเร็จ กรุณาลองใหม่", 503); }
}
