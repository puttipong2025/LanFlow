import { NextResponse } from "next/server";
import { getSmsIdentity, isSmsMutationAllowed, smsError, SMS_HEADERS } from "@/lib/server/sms-otp";

async function retired(request: Request) {
  try {
    const identity = await getSmsIdentity(request);
    if (!identity) return smsError("SESSION_REVOKED", 401);
    if (request.method !== "GET" && !isSmsMutationAllowed(request)) return smsError("FORBIDDEN", 403);
    return NextResponse.json({ error: "เปลี่ยนเป็นการอนุมัติเบราว์เซอร์แล้ว กรุณาโหลดหน้าใหม่" }, { status: 410, headers: SMS_HEADERS });
  } catch { return smsError("UNAVAILABLE", 503); }
}
export async function GET(request: Request) { return retired(request); }
export async function POST(request: Request) { return retired(request); }
