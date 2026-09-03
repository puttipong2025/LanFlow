import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import type { HistoryRetentionOverview } from "@/types/history-retention";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function retentionError(message: string) {
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

export async function GET(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const { data, error } = await result.supabase.rpc("get_history_retention_overview");
  if (error) return retentionError(error.message);
  return NextResponse.json(data as HistoryRetentionOverview, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;
  const body = await request.json().catch(() => null) as {
    action?: unknown;
    retentionDays?: unknown;
    expectedUpdatedAt?: unknown;
  } | null;
  const retentionDays = body?.retentionDays;
  if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays)
    || retentionDays < 1 || retentionDays > 365) {
    return errorResponse("จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365");
  }
  if (body?.action === "preview") {
    const { data, error } = await result.supabase.rpc("get_history_retention_overview", {
      p_retention_days: retentionDays,
    });
    if (error) return retentionError(error.message);
    return NextResponse.json(data as HistoryRetentionOverview, { headers: NO_STORE_HEADERS });
  }
  if (body?.action !== "save" || typeof body.expectedUpdatedAt !== "string") {
    return errorResponse("คำขอไม่ถูกต้อง");
  }
  const { data, error } = await result.supabase.rpc("save_history_retention_settings", {
    p_retention_days: retentionDays,
    p_expected_updated_at: body.expectedUpdatedAt,
  });
  if (error) return retentionError(error.message);
  return NextResponse.json(data as HistoryRetentionOverview, { headers: NO_STORE_HEADERS });
}
