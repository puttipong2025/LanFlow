import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/management-route-error";
import { isSmsMutationAllowed, SMS_HEADERS } from "@/lib/server/sms-otp";
import { isRubberBillIssuer } from "@/lib/rubber-bills/numbering-contract";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    if (!isSmsMutationAllowed(request)) return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!isUuid(body?.locationId) || !isUuid(body?.installationId) || !isUuid(body?.generationId)) {
      return NextResponse.json({ error: "ข้อมูลลงทะเบียนไม่ถูกต้อง" }, { status: 400 });
    }
    const ua = request.headers.get("user-agent") ?? "";
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const platform = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "ไม่ระบุ";
    const result = await auth.supabase.rpc("register_rubber_bill_issuer", {
      p_location_id: body.locationId, p_installation_id: body.installationId, p_generation_id: body.generationId,
      p_browser: browser, p_platform: platform,
    });
    if (result.error || !isRubberBillIssuer(result.data)) return NextResponse.json({ error: "ยังเตรียมรหัสเครื่องไม่สำเร็จ กรุณาลองใหม่" }, { status: result.error?.code === "42501" ? 403 : 503, headers: SMS_HEADERS });
    return NextResponse.json(result.data, { headers: SMS_HEADERS });
  } catch { return NextResponse.json({ error: "ยังเตรียมรหัสเครื่องไม่สำเร็จ" }, { status: 503, headers: SMS_HEADERS }); }
}
