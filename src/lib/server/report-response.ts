import { NextResponse } from "next/server";

export function reportErrorResponse(message: string) {
  if (message.includes("ไม่มีสิทธิ์") || message.includes("access denied")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  if (
    message.includes("ไม่มีรายการ") ||
    message.includes("ล่าสุด") ||
    message.includes("REPORT_LOCKED") ||
    message.includes("active")
  ) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}
