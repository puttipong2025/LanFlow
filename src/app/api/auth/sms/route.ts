import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { getSmsIdentity, isSmsMutationAllowed, otpDigest, SMS_HEADERS, smsError, startSmsChallenge } from "@/lib/server/sms-otp";
import { isUuid } from "@/lib/server/management-route-error";

export async function GET(request: Request) {
  try {
    const identity = await getSmsIdentity(request);
    if (!identity) return smsError("SESSION_REVOKED", 401);
    return NextResponse.json({ status: identity.status }, { headers: SMS_HEADERS });
  } catch { return smsError("UNAVAILABLE", 503); }
}

export async function POST(request: Request) {
  let stage = "identity";
  try {
    const identity = await getSmsIdentity(request);
    if (!identity || ["SIGNED_OUT", "SESSION_REVOKED"].includes(identity.status)) return smsError("SESSION_REVOKED", 401);
    if (!isSmsMutationAllowed(request)) return smsError("FORBIDDEN", 403);
    if (!identity.password) return smsError("PASSWORD_REQUIRED", 401);
    if (identity.status !== "OTP_REQUIRED") return smsError("NOT_REQUIRED", 409);
    const body = await request.json().catch(() => null);
    if (body?.action === "send") {
      stage = "send";
      // Check provider configuration before consuming the user's send quota.
      if (!process.env.THSMS_API_KEY || !process.env.THSMS_SENDER) return smsError("UNAVAILABLE", 503);
      const result = await startSmsChallenge(identity.userId, identity.sessionId, request);
      if ("error" in result) return smsError(result.error!, result.error === "RATE_LIMITED" ? 429 : 401);
      return NextResponse.json(result, { headers: SMS_HEADERS });
    }
    if (body?.action !== "verify" || typeof body.code !== "string" || !/^[0-9]{6}$/.test(body.code) || !isUuid(body.challengeId)) return smsError("INVALID_OTP");
    stage = "verify";
    const { data, error } = await createSupabaseAdminClient().rpc("verify_sms_challenge", {
      p_user: identity.userId, p_session: identity.sessionId, p_id: body.challengeId,
      p_digest: otpDigest(identity.userId, identity.sessionId, body.challengeId, body.code),
    });
    if (error) return smsError("UNAVAILABLE", 503);
    return data === true ? NextResponse.json({ success: true }, { headers: SMS_HEADERS }) : smsError("INVALID_OTP");
  } catch (error) {
    const known = ["Claims unavailable", "SMS status unavailable", "SMS OTP secret is not configured", "Trusted client IP unavailable", "SMS sending budget unavailable", "Unable to reserve OTP", "SMS delivery was not confirmed", "Unable to confirm OTP delivery"];
    const reason = error instanceof Error && known.includes(error.message) ? error.message : "Unexpected failure";
    console.error("SMS request unavailable", { stage, reason });
    return smsError("UNAVAILABLE", 503);
  }
}
