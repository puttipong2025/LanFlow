import { NextRequest, NextResponse } from "next/server";

import { parseRubberWeightAlertCheck } from "@/lib/lanflow/rubber-weight-alert";
import { requireRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest) {
  const result = await requireRole(request, ["admin", "super_admin"]);
  if (!result.ok) return result.response;

  const { data, error } = await result.supabase.rpc("get_rubber_weight_alert_check");
  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      return errorResponse("ไม่มีสิทธิ์ตรวจการแจ้งเตือนน้ำหนัก", 403);
    }
    console.error("Rubber weight alert check failed", error.message);
    return errorResponse("ตรวจการแจ้งเตือนน้ำหนักไม่สำเร็จ", 500);
  }

  const payload = parseRubberWeightAlertCheck(data);
  if (!payload) {
    console.error("Rubber weight alert check returned an invalid payload");
    return errorResponse("ข้อมูลการแจ้งเตือนน้ำหนักไม่ถูกต้อง", 500);
  }

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
