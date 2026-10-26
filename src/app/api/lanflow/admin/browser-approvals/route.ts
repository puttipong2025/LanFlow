import { NextResponse } from "next/server";
import { requireAuth, hasSystemManagerAccess } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { isSmsMutationAllowed, smsError, SMS_HEADERS } from "@/lib/server/sms-otp";
import { isUuid } from "@/lib/server/management-route-error";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    if (!hasSystemManagerAccess(auth.auth)) return smsError("FORBIDDEN", 403);
    const result = await createSupabaseAdminClient().rpc("list_browser_approvals", { p_actor: auth.auth.sub });
    if (result.error) return smsError("UNAVAILABLE", 503);
    return NextResponse.json({ users: result.data }, { headers: SMS_HEADERS });
  } catch { return smsError("UNAVAILABLE", 503); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    if (!hasSystemManagerAccess(auth.auth) || !isSmsMutationAllowed(request)) return smsError("FORBIDDEN", 403);
    const body = await request.json().catch(() => null);
    if (!isUuid(body?.userId) || !["approve", "cancel", "revoke"].includes(body?.action)
      || (body.action !== "revoke" && !isUuid(body.id))) return smsError("INVALID_INPUT");
    const result = await createSupabaseAdminClient().rpc("manage_browser_approval", {
      p_actor: auth.auth.sub, p_target: body.userId, p_action: body.action, p_id: body.action === "revoke" ? null : body.id,
    });
    if (result.error) {
      if (result.error.code === "42501") return smsError("FORBIDDEN", 403);
      if (result.error.code === "P0001" && ["STALE_REQUEST", "NOT_REQUIRED"].includes(result.error.message)) {
        return NextResponse.json({ error: "คำขอเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่" }, { status: 409, headers: SMS_HEADERS });
      }
      return smsError("UNAVAILABLE", 503);
    }
    return NextResponse.json({ success: true }, { headers: SMS_HEADERS });
  } catch { return smsError("UNAVAILABLE", 503); }
}
