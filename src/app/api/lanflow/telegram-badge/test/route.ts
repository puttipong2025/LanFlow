import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import { summarizeUpstreamError } from "@/lib/server/auth-access-failure";
import { isJsonObject, managementAuthFailure } from "@/lib/server/management-route-error";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

type TelegramDeliveryCredentials = {
  botToken: string | null;
  chatId: string | null;
};

function isTelegramDeliveryCredentials(
  value: unknown,
): value is TelegramDeliveryCredentials {
  if (!isJsonObject(value)) return false;
  return (
    (value.botToken === null || typeof value.botToken === "string")
    && (value.chatId === null || typeof value.chatId === "string")
  );
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { errorMessage: message },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return managementAuthFailure(authCheck.response);

  let data;
  let error;
  try {
    const admin = createSupabaseAdminClient();
    const result = await admin.rpc("get_telegram_badge_delivery_credentials");
    data = result.data;
    error = result.error;
  } catch (cause) {
    console.error("Telegram credentials read failed", summarizeUpstreamError(cause));
    return errorResponse("โหลดข้อมูลเชื่อมต่อ Telegram ไม่สำเร็จ", 500);
  }
  if (error) {
    console.error("Telegram credentials unavailable", summarizeUpstreamError(error));
    return errorResponse("โหลดข้อมูลเชื่อมต่อ Telegram ไม่สำเร็จ", 500);
  }
  if (!isTelegramDeliveryCredentials(data)) {
    console.error("Telegram credentials read returned an invalid payload");
    return errorResponse("โหลดข้อมูลเชื่อมต่อ Telegram ไม่สำเร็จ", 500);
  }
  const botToken = data.botToken?.trim();
  const chatId = data.chatId?.trim();
  if (!botToken || !chatId) {
    return errorResponse("กรุณาบันทึก Bot Token และ Chat ID ก่อนทดสอบ", 400);
  }

  const sentAt = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  let telegramResponse: Response;
  try {
    telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          chat_id: chatId,
          text: `✅ ทดสอบการแจ้งเตือน LanFlow\nเชื่อมต่อสำเร็จเมื่อ ${sentAt}`,
          disable_web_page_preview: true,
        }),
        cache: "no-store",
      },
    );
  } catch {
    return errorResponse("เชื่อมต่อ Telegram ไม่สำเร็จ กรุณาลองใหม่", 502);
  }

  if (!telegramResponse.ok) {
    return errorResponse(
      `Telegram ปฏิเสธการส่ง (HTTP ${telegramResponse.status})`,
      502,
    );
  }

  let telegramPayload: unknown;
  try {
    telegramPayload = await telegramResponse.json();
  } catch {
    return errorResponse("Telegram ปฏิเสธการส่ง", 502);
  }
  if (
    !isJsonObject(telegramPayload)
    || telegramPayload.ok !== true
    || !isJsonObject(telegramPayload.result)
  ) {
    return errorResponse("Telegram ปฏิเสธการส่ง", 502);
  }

  return NextResponse.json(
    { success: true },
    { headers: NO_STORE_HEADERS },
  );
}
