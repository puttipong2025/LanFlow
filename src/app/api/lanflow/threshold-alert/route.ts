import { NextRequest, NextResponse } from "next/server";

import { parseBranchThresholdCheck } from "@/lib/lanflow/branch-threshold-alert";
import { requireRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest) {
  const result = await requireRole(request, ["admin", "super_admin"]);
  if (!result.ok) return result.response;

  try {
    const { data, error } = await result.supabase.rpc("get_branch_threshold_alert_check");
    if (error) {
      if (error.message.includes("FORBIDDEN")) {
        return errorResponse("ไม่มีสิทธิ์ตรวจการแจ้งเตือน", 403);
      }
      console.error("Branch threshold alert check failed", error.message);
      return errorResponse("ตรวจการแจ้งเตือนไม่สำเร็จ", 500);
    }

    const payload = parseBranchThresholdCheck(data);
    if (!payload) {
      console.error("Branch threshold alert check returned an invalid payload");
      return errorResponse("ข้อมูลการแจ้งเตือนไม่ถูกต้อง", 500);
    }

    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch {
    return errorResponse("ติดต่อระบบแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่", 500);
  }
}
