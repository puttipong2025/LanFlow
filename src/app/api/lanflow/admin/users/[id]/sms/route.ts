import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { isSmsMutationAllowed, SMS_HEADERS, smsError } from "@/lib/server/sms-otp";
import { isUuid } from "@/lib/server/management-route-error";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isSmsMutationAllowed(request)) return smsError("FORBIDDEN", 403);
    const auth = await requireRole(request, ["super_admin"]);
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!isUuid(id) || typeof body?.required !== "boolean") return smsError("INVALID_INPUT");
    if (body.required && (!process.env.THSMS_API_KEY || !process.env.THSMS_SENDER || (process.env.SMS_OTP_SECRET?.length ?? 0) < 32)) {
      return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าบริการส่ง SMS กรุณาตั้งค่าก่อนเปิดใช้งาน" }, { status: 503, headers: SMS_HEADERS });
    }
    const admin = createSupabaseAdminClient();
    if (body.required) {
      const target = await admin.auth.admin.getUserById(id);
      if (target.error) return smsError("UNAVAILABLE", 503);
      if (!/^\+?66[689][0-9]{8}$/.test(target.data.user?.phone ?? "")) {
        return NextResponse.json({ error: "กรุณาตั้งค่าเบอร์มือถือไทยให้ถูกต้องก่อนเปิด SMS" }, { status: 400, headers: SMS_HEADERS });
      }
    }
    const result = await admin.rpc("set_user_sms_required", { p_actor: auth.auth.sub, p_target: id, p_required: body.required });
    if (result.error) return smsError("UPDATE_FAILED", 400);
    return NextResponse.json({ success: true, smsRequired: body.required }, { headers: SMS_HEADERS });
  } catch { return smsError("UNAVAILABLE", 503); }
}
