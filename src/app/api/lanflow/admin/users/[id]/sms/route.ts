import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { isSmsMutationAllowed, SMS_HEADERS, smsError } from "@/lib/server/sms-otp";
import { isUuid } from "@/lib/server/management-route-error";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole(request, ["super_admin"]);
    if (!auth.ok) return auth.response;
    if (!isSmsMutationAllowed(request)) return smsError("FORBIDDEN", 403);
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!isUuid(id) || typeof body?.required !== "boolean") return smsError("INVALID_INPUT");
    const admin = createSupabaseAdminClient();
    const result = await admin.rpc("set_user_sms_required", { p_actor: auth.auth.sub, p_target: id, p_required: body.required });
    if (result.error) return smsError("UPDATE_FAILED", 400);
    return NextResponse.json({ success: true, smsRequired: body.required }, { headers: SMS_HEADERS });
  } catch { return smsError("UNAVAILABLE", 503); }
}
