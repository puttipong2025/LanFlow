import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/config";
import { isSmsMutationAllowed, SMS_HEADERS, smsError } from "@/lib/server/sms-otp";
import { normalizeThaiPhoneToE164 } from "@/lib/phone";
import { isUuid } from "@/lib/server/management-route-error";
import { classifyAuthClaimsFailure } from "@/lib/server/auth-access-failure";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole(request, ["super_admin"]);
    if (!auth.ok) return auth.response;
    if (!isSmsMutationAllowed(request)) return smsError("FORBIDDEN", 403);
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!isUuid(id) || typeof body?.phone !== "string") return smsError("INVALID_INPUT");
    let phone: string;
    try { phone = normalizeThaiPhoneToE164(body.phone); } catch { return smsError("INVALID_INPUT"); }
    if (!/^\+66[689][0-9]{8}$/.test(phone)) return smsError("INVALID_INPUT");
    if (id === auth.auth.sub) {
      if (typeof body.currentPassword !== "string" || !body.currentPassword) return smsError("PASSWORD_REQUIRED");
      // Isolated client cannot replace the actor's cookie session.
      const verifier = createClient(getSupabaseUrl(), getSupabasePublishableKey(), { auth: { persistSession: false, autoRefreshToken: false } });
      const checked = await verifier.auth.signInWithPassword({ phone: normalizeThaiPhoneToE164(auth.auth.phone), password: body.currentPassword });
      if (classifyAuthClaimsFailure({ claimsError: checked.error, hasUserId: Boolean(checked.data.user?.id) })?.status === 503) return smsError("UNAVAILABLE", 503);
      if (checked.error || checked.data.user?.id !== id) return smsError("PASSWORD_REQUIRED");
      await verifier.auth.signOut({ scope: "local" });
    }
    const admin = createSupabaseAdminClient();
    const current = await admin.auth.admin.getUserById(id);
    if (classifyAuthClaimsFailure({ claimsError: current.error, hasUserId: Boolean(current.data?.user) })?.status === 503) return smsError("UNAVAILABLE", 503);
    if (current.error || !current.data.user) return smsError("NOT_FOUND", 404);
    if (current.data.user.phone?.replace(/^\+/, "") === phone.slice(1)) return smsError("UNCHANGED", 409);
    const prepared = await admin.rpc("prepare_sms_phone_change", { p_actor: auth.auth.sub, p_target: id, p_phone: phone.slice(1) });
    if (prepared.error) return smsError("INVALID_OR_DUPLICATE_PHONE", 409);
    // The Auth database trigger synchronizes profiles, audit and revocation in the
    // same transaction as Auth's phone update. No second profiles API write.
    const updated = await admin.auth.admin.updateUserById(id, { phone, phone_confirm: true });
    if (updated.error) return smsError("PHONE_CHANGE_FAILED", 409);
    return NextResponse.json({ success: true, phone: `0${phone.slice(3)}` }, { headers: SMS_HEADERS });
  } catch { return smsError("UNAVAILABLE", 503); }
}
