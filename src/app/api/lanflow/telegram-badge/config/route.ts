import { NextRequest, NextResponse } from "next/server";

import {
  isTelegramBadgeKey,
  type TelegramBadgeKey,
} from "@/lib/telegram-badge";
import { requireSystemManager } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/weight-evidence";

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

  const [configResult, locationResult] = await Promise.all([
    authCheck.supabase.rpc("get_telegram_badge_config"),
    authCheck.supabase.rpc("get_telegram_evidence_location_config"),
  ]);
  if (configResult.error || locationResult.error) {
    return errorResponse("โหลดการตั้งค่า Telegram ไม่สำเร็จ", 500);
  }
  const locations = (locationResult.data ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    ...((configResult.data ?? {}) as Record<string, unknown>),
    evidenceAllLocations: locations.allLocations === true,
    evidenceLocationIds: locations.locationIds ?? [],
    evidenceLocations: locations.locations ?? [],
  }, { headers: NO_STORE_HEADERS });
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
  const evidenceEnabled = body.evidenceEnabled;
  const evidenceIntervalMinutes = Number(body.evidenceIntervalMinutes);
  let evidenceAllLocations = body.evidenceAllLocations;
  let evidenceLocationIds = body.evidenceLocationIds;
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
  if (evidenceAllLocations === undefined && evidenceLocationIds === undefined) {
    const currentResult = await authCheck.supabase.rpc("get_telegram_evidence_location_config");
    if (currentResult.error) return errorResponse("โหลดสาขาหลักฐานไม่สำเร็จ", 500);
    const current = (currentResult.data ?? {}) as Record<string, unknown>;
    evidenceAllLocations = current.allLocations;
    evidenceLocationIds = current.locationIds;
  }
  if (typeof evidenceAllLocations !== "boolean") {
    return errorResponse("รูปแบบการเลือกสาขาหลักฐานไม่ถูกต้อง", 400);
  }
  if (!Array.isArray(evidenceLocationIds) || !evidenceLocationIds.every(
    (id): id is string => typeof id === "string" && UUID_PATTERN.test(id),
  )) {
    return errorResponse("สาขาหลักฐานไม่ถูกต้อง", 400);
  }
  const uniqueEvidenceLocationIds = [...new Set(evidenceLocationIds as string[])];
  if (!evidenceAllLocations && uniqueEvidenceLocationIds.length === 0) {
    return errorResponse("กรุณาเลือกอย่างน้อยหนึ่งสาขา", 400);
  }
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 10 ||
    intervalMinutes > 240
  ) {
    return errorResponse("ระยะห่างต้องอยู่ระหว่าง 10 ถึง 240 นาที", 400);
  }
  if (typeof evidenceEnabled !== "boolean") {
    return errorResponse("สถานะ Telegram Evidence ไม่ถูกต้อง", 400);
  }
  if (
    !Number.isInteger(evidenceIntervalMinutes) ||
    evidenceIntervalMinutes < 30 ||
    evidenceIntervalMinutes > 1440
  ) {
    return errorResponse("ระยะห่าง Evidence ต้องอยู่ระหว่าง 30 ถึง 1,440 นาที", 400);
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
    "save_telegram_badge_config_with_evidence_locations",
    {
      payload: {
        enabled,
        chatId,
        startTime,
        endTime,
        intervalMinutes,
        evidenceEnabled,
        evidenceIntervalMinutes,
        enabledBadgeKeys: [...new Set(rawKeys)],
        ...(botToken ? { botToken } : {}),
      },
      p_all_locations: evidenceAllLocations,
      p_location_ids: uniqueEvidenceLocationIds,
    },
  );

  if (error) {
    return errorResponse(error.message, 400);
  }
  return NextResponse.json(data, { headers: NO_STORE_HEADERS });
}
