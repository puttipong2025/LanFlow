import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import { summarizeUpstreamError } from "@/lib/server/auth-access-failure";
import {
  isIsoTimestamp,
  isJsonObject,
  isUuid,
  managementAuthFailure,
} from "@/lib/server/management-route-error";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const BADGE_KEY_PATTERN = /^[a-z0-9_]+$/;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isTelegramConfigPayload(value: unknown): value is Record<string, unknown> {
  if (!isJsonObject(value) || "botToken" in value) return false;
  return (
    typeof value.enabled === "boolean"
    && typeof value.chatId === "string"
    && typeof value.startTime === "string"
    && TIME_PATTERN.test(value.startTime)
    && typeof value.endTime === "string"
    && TIME_PATTERN.test(value.endTime)
    && value.startTime < value.endTime
    && Number.isInteger(value.intervalMinutes)
    && Number(value.intervalMinutes) >= 10
    && Number(value.intervalMinutes) <= 240
    && Array.isArray(value.enabledBadgeKeys)
    && value.enabledBadgeKeys.every(
      (key) => typeof key === "string" && BADGE_KEY_PATTERN.test(key),
    )
    && typeof value.evidenceEnabled === "boolean"
    && Number.isInteger(value.evidenceIntervalMinutes)
    && Number(value.evidenceIntervalMinutes) >= 30
    && Number(value.evidenceIntervalMinutes) <= 1440
    && typeof value.evidenceAllLocations === "boolean"
    && Array.isArray(value.evidenceLocationIds)
    && value.evidenceLocationIds.every(isUuid)
    && Array.isArray(value.evidenceLocations)
    && value.evidenceLocations.every(
      (location) => isJsonObject(location)
        && isUuid(location.id)
        && typeof location.name === "string",
    )
    && typeof value.tokenConfigured === "boolean"
    && Array.isArray(value.catalog)
    && value.catalog.every(
      (item) => isJsonObject(item)
        && typeof item.key === "string"
        && BADGE_KEY_PATTERN.test(item.key)
        && typeof item.moduleLabel === "string"
        && typeof item.statusLabel === "string"
        && Number.isInteger(item.sortOrder),
    )
    && isNullableIsoTimestamp(value.lastAttemptAt)
    && isNullableIsoTimestamp(value.lastSuccessAt)
    && isNullableString(value.lastError)
    && isIsoTimestamp(value.updatedAt)
    && isNullableString(value.updatedByName)
  );
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { errorMessage: message },
    { status, headers: NO_STORE_HEADERS },
  );
}

function rpcErrorResponse(
  error: { code?: string; message?: string } | null | undefined,
  message: string,
) {
  console.error("Telegram badge config unavailable", summarizeUpstreamError(error));
  return errorResponse(message, error?.code === "P0001" ? 400 : 500);
}

export async function GET(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);

  let configResult;
  let locationResult;
  try {
    [configResult, locationResult] = await Promise.all([
      authCheck.supabase.rpc("get_telegram_badge_config"),
      authCheck.supabase.rpc("get_telegram_evidence_location_config"),
    ]);
  } catch (error) {
    console.error("Telegram badge config read failed", summarizeUpstreamError(error));
    return errorResponse("โหลดการตั้งค่า Telegram ไม่สำเร็จ", 500);
  }
  if (configResult.error || locationResult.error) {
    return rpcErrorResponse(
      configResult.error ?? locationResult.error,
      "โหลดการตั้งค่า Telegram ไม่สำเร็จ",
    );
  }
  if (!isJsonObject(configResult.data) || !isJsonObject(locationResult.data)) {
    console.error("Telegram badge config read returned an invalid payload");
    return errorResponse("โหลดการตั้งค่า Telegram ไม่สำเร็จ", 500);
  }
  const payload = {
    ...configResult.data,
    evidenceAllLocations: locationResult.data.allLocations,
    evidenceLocationIds: locationResult.data.locationIds,
    evidenceLocations: locationResult.data.locations,
  };
  if (!isTelegramConfigPayload(payload)) {
    console.error("Telegram badge config read returned an invalid payload");
    return errorResponse("โหลดการตั้งค่า Telegram ไม่สำเร็จ", 500);
  }
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

export async function PUT(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("ข้อมูลการตั้งค่าไม่ถูกต้อง", 400);
  }
  if (!isJsonObject(body)) {
    return errorResponse("ข้อมูลการตั้งค่าไม่ถูกต้อง", 400);
  }

  const enabled = body.enabled;
  if (typeof body.chatId !== "string") {
    return errorResponse("Chat ID ไม่ถูกต้อง", 400);
  }
  if (body.botToken !== undefined && typeof body.botToken !== "string") {
    return errorResponse("Bot Token ไม่ถูกต้อง", 400);
  }
  const chatId = body.chatId.trim();
  const startTime = body.startTime;
  const endTime = body.endTime;
  const intervalMinutes = Number(body.intervalMinutes);
  const evidenceEnabled = body.evidenceEnabled;
  const evidenceIntervalMinutes = Number(body.evidenceIntervalMinutes);
  let evidenceAllLocations = body.evidenceAllLocations;
  let evidenceLocationIds = body.evidenceLocationIds;
  const botToken = body.botToken?.trim() ?? "";
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
    let currentResult;
    try {
      currentResult = await authCheck.supabase.rpc("get_telegram_evidence_location_config");
    } catch (error) {
      console.error("Telegram evidence locations read failed", summarizeUpstreamError(error));
      return errorResponse("โหลดสาขาหลักฐานไม่สำเร็จ", 500);
    }
    if (currentResult.error) {
      return rpcErrorResponse(currentResult.error, "โหลดสาขาหลักฐานไม่สำเร็จ");
    }
    const current = (currentResult.data ?? {}) as Record<string, unknown>;
    evidenceAllLocations = current.allLocations;
    evidenceLocationIds = current.locationIds;
  }
  if (typeof evidenceAllLocations !== "boolean") {
    return errorResponse("รูปแบบการเลือกสาขาหลักฐานไม่ถูกต้อง", 400);
  }
  if (!Array.isArray(evidenceLocationIds) || !evidenceLocationIds.every(
    (id): id is string => isUuid(id),
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
  if (
    !Array.isArray(rawKeys)
    || !rawKeys.every(
      (key): key is string =>
        typeof key === "string" && BADGE_KEY_PATTERN.test(key),
    )
  ) {
    return errorResponse("ประเภท Badge ไม่ถูกต้อง", 400);
  }
  if (enabled && chatId.length === 0) {
    return errorResponse("กรุณาระบุ Chat ID", 400);
  }
  if (chatId.length > 128 || botToken.length > 256) {
    return errorResponse("ข้อมูล Telegram ยาวเกินกำหนด", 400);
  }

  let result;
  try {
    result = await authCheck.supabase.rpc(
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
  } catch (error) {
    console.error("Telegram badge config save failed", summarizeUpstreamError(error));
    return errorResponse("บันทึกการตั้งค่า Telegram ไม่สำเร็จ", 500);
  }

  if (result.error) {
    return rpcErrorResponse(
      result.error,
      "บันทึกการตั้งค่า Telegram ไม่สำเร็จ",
    );
  }
  if (!isTelegramConfigPayload(result.data)) {
    console.error("Telegram badge config save returned an invalid payload");
    return errorResponse("บันทึกการตั้งค่า Telegram ไม่สำเร็จ", 500);
  }
  return NextResponse.json(result.data, { headers: NO_STORE_HEADERS });
}
