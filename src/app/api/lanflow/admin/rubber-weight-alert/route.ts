import { NextRequest, NextResponse } from "next/server";

import {
  parseRubberWeightAlertConfig,
  validRubberWeightAlertInterval,
} from "@/lib/lanflow/rubber-weight-alert";
import { requireSystemManager } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function PUT(request: NextRequest) {
  const result = await requireSystemManager(request);
  if (!result.ok) return result.response;

  const body = await request.json().catch(() => null) as {
    thresholdKg?: unknown;
    intervalMinutes?: unknown;
  } | null;
  if (body && Object.prototype.hasOwnProperty.call(body, "thresholdKg")) {
    return errorResponse("การตั้งค่าเกณฑ์เปลี่ยนเป็นแบบกลุ่มแล้ว กรุณาโหลดหน้าใหม่", 409);
  }
  if (!validRubberWeightAlertInterval(body?.intervalMinutes)) {
    return errorResponse(
      "รอบตรวจต้องอยู่ระหว่าง 1–1,440 นาที",
      400,
    );
  }

  const { data, error } = await result.supabase.rpc(
    "save_rubber_weight_alert_interval",
    {
      p_interval_minutes: body.intervalMinutes,
    },
  );
  if (error) {
    if (error.message.includes("ไม่มีสิทธิ์") || error.message.includes("FORBIDDEN")) {
      return errorResponse("ไม่มีสิทธิ์จัดการการตั้งค่านี้", 403);
    }
    if (error.message.includes("RUBBER_WEIGHT_ALERT_INVALID")) {
      return errorResponse(
        "รอบตรวจต้องอยู่ระหว่าง 1–1,440 นาที",
        400,
      );
    }
    console.error("Rubber weight alert config save failed", error.message);
    return errorResponse("บันทึกการแจ้งเตือนน้ำหนักไม่สำเร็จ", 500);
  }

  const config = parseRubberWeightAlertConfig(data);
  if (!config) {
    console.error("Rubber weight alert config save returned an invalid payload");
    return errorResponse("ข้อมูลการแจ้งเตือนน้ำหนักไม่ถูกต้อง", 500);
  }

  return NextResponse.json(config, { headers: NO_STORE_HEADERS });
}
