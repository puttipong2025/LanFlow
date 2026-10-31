import { NextResponse } from "next/server";
import { requireAuth, hasSystemManagerAccess } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/management-route-error";
import { isSmsMutationAllowed, SMS_HEADERS } from "@/lib/server/sms-otp";
import { isIssuerPage } from "@/lib/rubber-bills/issuer-management-contract";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    if (!hasSystemManagerAccess(auth.auth)) return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
    const params = new URL(request.url).searchParams, location = params.get("locationId") || null, search = params.get("search") ?? "", status = params.get("status") ?? "all";
    const offset = Number(params.get("offset") ?? 0);
    if ((location && !isUuid(location)) || !["all", "active", "retired"].includes(status) || search.length > 160 || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) {
      return NextResponse.json({ error: "ตัวกรองไม่ถูกต้อง" }, { status: 400 });
    }
    const result = await auth.supabase.rpc("list_rubber_bill_issuers", { p_location_id: location, p_search: search, p_offset: offset, p_limit: 20, p_status: status });
    if (result.error || !isIssuerPage(result.data)) return NextResponse.json({ error: "โหลดทะเบียนไม่สำเร็จ" }, { status: result.error?.code === "42501" ? 403 : 503, headers: SMS_HEADERS });
    return NextResponse.json(result.data, { headers: SMS_HEADERS });
  } catch { return NextResponse.json({ error: "โหลดทะเบียนไม่สำเร็จ" }, { status: 503, headers: SMS_HEADERS }); }
}
export async function PATCH(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    if (!hasSystemManagerAccess(auth.auth) || !isSmsMutationAllowed(request)) return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!isUuid(body?.id)) return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 400 });
    const id = body.id.toLowerCase();
    const result = await auth.supabase.rpc("retire_rubber_bill_issuer", { p_id: id });
    if (result.error || result.data?.id !== id || result.data?.retired !== true) return NextResponse.json({ error: "เลิกใช้งานรหัสไม่สำเร็จ" }, { status: result.error?.code === "42501" ? 403 : 503, headers: SMS_HEADERS });
    return NextResponse.json(result.data, { headers: SMS_HEADERS });
  } catch { return NextResponse.json({ error: "เลิกใช้งานรหัสไม่สำเร็จ" }, { status: 503, headers: SMS_HEADERS }); }
}
