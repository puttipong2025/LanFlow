import { NextRequest, NextResponse } from "next/server";

import {
  isTelegramBadgeKey,
  type TelegramBadgeKey,
} from "@/lib/telegram-badge";
import { requireSystemManager } from "@/lib/server/auth";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { errorMessage: message },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return authCheck.response;

  const { data, error } = await authCheck.supabase.rpc(
    "get_telegram_badge_config",
  );
  if (error) return errorResponse("โหลดการตั้งค่า Telegram ไม่สำเร็จ", 500);

  return NextResponse.json(data, { headers: NO_STORE_HEADERS });
}

export async function PUT(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return authCheck.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("ข้อมูลการตั้งค่าไม่ถูกต้อง", 400);
  }

  const enabled = body.enabled;
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const startTime = body.startTime;
  const endTime = body.endTime;
  const intervalMinutes = Number(body.intervalMinutes);
  const botToken =
    typeof body.botToken === "string" ? body.botToken.trim() : "";
  const rawKeys = body.enabledBadgeKeys;

  if (typeof enabled !== "boolean") {
    return errorResponse("สถานะเปิดใช้งานไม่ถูกต้อง", 400);
  }
  if (
    typeof startTime !== "string" ||
    !TIME_PATTERN.test(startTime) ||
    typeof endTime !== "string" ||
    !TIME_PATTERN.test(endTime) ||
    startTime >= endTime
  ) {
    return errorResponse("เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุดภายในวันเดียวกัน", 400);
  }
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 10 ||
    intervalMinutes > 240
  ) {
    return errorResponse("ระยะห่างต้องอยู่ระหว่าง 10 ถึง 240 นาที", 400);
  }
  if (!Array.isArray(rawKeys) || !rawKeys.every(
    (key): key is TelegramBadgeKey =>
      typeof key === "string" && isTelegramBadgeKey(key),
  )) {
    return errorResponse("ประเภท Badge ไม่ถูกต้อง", 400);
  }
  if (enabled && chatId.length === 0) {
    return errorResponse("กรุณาระบุ Chat ID", 400);
  }
  if (chatId.length > 128 || botToken.length > 256) {
    return errorResponse("ข้อมูล Telegram ยาวเกินกำหนด", 400);
  }

  const { data, error } = await authCheck.supabase.rpc(
    "save_telegram_badge_config",
    {
      payload: {
        enabled,
        chatId,
        startTime,
        endTime,
        intervalMinutes,
        enabledBadgeKeys: [...new Set(rawKeys)],
        ...(botToken ? { botToken } : {}),
      },
    },
  );

  if (error) {
    return errorResponse(error.message, 400);
  }
  return NextResponse.json(data, { headers: NO_STORE_HEADERS });
}
