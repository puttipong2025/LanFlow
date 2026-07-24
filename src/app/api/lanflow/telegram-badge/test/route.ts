import { NextRequest, NextResponse } from "next/server";

import { requireSystemManager } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { errorMessage: message },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: NextRequest) {
  const authCheck = await requireSystemManager(request);
  if (!authCheck.ok) return authCheck.response;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    "get_telegram_badge_delivery_credentials",
  );
  if (error || !data?.botToken || !data?.chatId) {
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
      `https://api.telegram.org/bot${data.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          chat_id: data.chatId,
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

  return NextResponse.json(
    { success: true },
    { headers: NO_STORE_HEADERS },
  );
}
