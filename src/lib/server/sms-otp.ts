import { NextResponse } from "next/server";
import { createSupabaseRequestClient, parseBearerToken } from "@/lib/supabase/server";
import { classifyAuthClaimsFailure } from "@/lib/server/auth-access-failure";

export const SMS_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export function smsError(code: string, status = 400) {
  const messages: Record<string, string> = {
    OTP_REQUIRED: "กรุณารออนุมัติเบราว์เซอร์ก่อนเข้าใช้งาน",
    SESSION_REVOKED: "กรุณาเข้าสู่ระบบใหม่ งานค้างยังเก็บไว้",
    PASSWORD_REQUIRED: "กรุณาเข้าสู่ระบบด้วยรหัสผ่านก่อน",
  };
  return NextResponse.json({ errorCode: code, error: messages[code] ?? "ดำเนินการไม่สำเร็จ กรุณาลองใหม่" }, {
    status, headers: { ...SMS_HEADERS, ...(status === 503 ? { "Retry-After": "3" } : {}) },
  });
}
// These endpoints accept only same-origin browser mutations or explicit Bearer requests.
export function isSmsMutationAllowed(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next's internal URL may use localhost while the browser uses 127.0.0.1.
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (origin !== null) return origin === expectedOrigin;
  return typeof parseBearerToken(request) === "string";
}

export async function getSmsIdentity(request: Request) {
  const token = parseBearerToken(request);
  if (token === null) return null;
  const supabase = await createSupabaseRequestClient(request);
  const claimsResult = await supabase.auth.getClaims(token);
  const claims = claimsResult.data?.claims;
  const failure = classifyAuthClaimsFailure({ claimsError: claimsResult.error, hasUserId: typeof claims?.sub === "string" });
  if (failure?.status === 401) return null;
  if (failure) throw new Error("Claims unavailable");
  if (!claims?.sub || typeof claims.session_id !== "string") return null;
  const statusResult = await supabase.rpc("sms_login_status");
  if (statusResult.error) throw new Error("SMS status unavailable");
  const status = statusResult.data?.status as string;
  const password = Array.isArray(claims.amr) && claims.amr.some((item: { method?: string }) => item.method === "password");
  return { userId: claims.sub, sessionId: claims.session_id, status, password };
}
