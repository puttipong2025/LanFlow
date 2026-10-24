import { NextResponse } from "next/server";

export class CashCountInputError extends Error {}

export function cashCountUnavailableResponse() {
  return NextResponse.json({ error: "ติดต่อระบบนับเงินไม่สำเร็จ กรุณาลองใหม่" }, {
    status: 503, headers: { "Cache-Control": "private, no-store" },
  });
}

export function cashCountErrorResponse(message: string) {
  const status = message.includes("ไม่มีสิทธิ์")
    ? 403
    : message.includes("ไม่พบ")
      ? 404
      : message.includes("หมดเวลา")
        || message.includes("สิ้นสุด")
        || message.includes("CASH_COUNT_ACTIVE")
        || message.includes("ไม่มีรายการ")
        || message.includes("ล่าสุด")
        || message.includes("RUBBER_")
        ? 409
        : 400;
  return NextResponse.json({ error: message }, { status });
}
