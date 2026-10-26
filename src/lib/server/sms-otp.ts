import { createHmac, randomInt, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { createSupabaseRequestClient, parseBearerToken } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { classifyAuthClaimsFailure } from "@/lib/server/auth-access-failure";

export const SMS_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export function smsError(code: string, status = 400, retryAfter?: number, quota?: { scope: string; count: number; limit: number }) {
  const messages: Record<string, string> = {
    OTP_REQUIRED: "กรุณายืนยันรหัส SMS ก่อนเข้าใช้งาน",
    SESSION_REVOKED: "กรุณาเข้าสู่ระบบใหม่ งานค้างยังเก็บไว้",
    PASSWORD_REQUIRED: "กรุณาเข้าสู่ระบบด้วยรหัสผ่านก่อน",
    INVALID_OTP: "รหัสไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว กรุณาตรวจสอบหรือขอรหัสใหม่",
    RATE_LIMITED: "ขอรหัสบ่อยเกินไป กรุณารอแล้วลองใหม่",
  };
  const wait = retryAfter ? Math.max(1, Math.ceil(retryAfter)) : undefined;
  const labels: Record<string, string> = { cooldown: "ยังไม่ครบเวลาส่งซ้ำ", account: "โควตาบัญชี", ip: "โควตาเครือข่ายที่ใช้อยู่", global: "โควตารวมระบบ", attempts: "จำนวนกรอกรหัสผิด" };
  const limitMessage = quota ? `${labels[quota.scope] ?? "โควตา SMS"} ${quota.count}/${quota.limit} ครั้ง` : "ขอรหัสบ่อยเกินไป";
  const error = code === "RATE_LIMITED" && wait
    ? `${limitMessage} กรุณารออีก ${wait < 60 ? `${wait} วินาที` : `${Math.ceil(wait / 60)} นาที`}แล้วลองใหม่`
    : messages[code] ?? "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
  return NextResponse.json({ errorCode: code, error, ...(quota ? { quota } : {}), ...(wait ? { retryAfter: wait, availableAt: new Date(Date.now() + wait * 1000).toISOString() } : {}) }, { status, headers: { ...SMS_HEADERS, ...(status === 503 ? { "Retry-After": "3" } : status === 429 && wait ? { "Retry-After": String(wait) } : {}) } });
}

export function otpDigest(user: string, session: string, id: string, code: string) {
  const secret = process.env.SMS_OTP_SECRET;
  if (!secret || secret.length < 32) throw new Error("SMS OTP secret is not configured");
  return createHmac("sha256", secret).update(`${user}:${session}:${id}:${code}`).digest("hex");
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

export async function sendThsms(phone: string, code: string) {
  const key = process.env.THSMS_API_KEY;
  const sender = process.env.THSMS_SENDER;
  if (!key || !sender) throw new Error("SMS provider is not configured");
  const localPhone = `0${phone.replace(/^\+?66/, "")}`;
  if (!/^0[0-9]{9}$/.test(localPhone)) throw new Error("Invalid SMS destination");
  const response = await fetch("https://thsms.com/api/send-sms", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sender, msisdn: [localPhone], message: `LanFlow login code: ${code}. Valid for 5 minutes. Do not share this code.` }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const result = await response.json();
  // Unknown responses fail closed; never expose provider payloads or OTPs in logs.
  if (!response.ok || !(result.status === "success" || result.status === true || result.success === true)) {
    throw new Error("SMS delivery was not confirmed");
  }
}

export async function startSmsChallenge(user: string, session: string, request: Request) {
  const id = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const digest = otpDigest(user, session, id, code);
  const admin = createSupabaseAdminClient();
  // Trust a forwarded IP only when running behind the known Vercel ingress.
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.trim() : "local";
  if (!ip || (ip !== "local" && !isIP(ip))) throw new Error("Trusted client IP unavailable");
  const hash = otpDigest("ip-budget", ip, "send", "");
  const budget = await admin.rpc("claim_sms_ip_budget", { p_hash: hash });
  if (budget.error) throw new Error("SMS sending budget unavailable");
  if (budget.data !== true) {
    const retry = await admin.rpc("sms_ip_retry_after", { p_hash: hash });
    if (retry.error) throw new Error("SMS sending budget unavailable");
    return { error: "RATE_LIMITED", retryAfter: retry.data as number, quota: { scope: "ip", count: 50, limit: 50 } };
  }
  const { data, error } = await admin.rpc("reserve_sms_challenge", { p_user: user, p_session: session, p_id: id, p_digest: digest });
  if (error) throw new Error("Unable to reserve OTP");
  if (data.error) return { error: data.error as string, retryAfter: data.retryAfter as number | undefined, quota: data.quota as { scope: string; count: number; limit: number } | undefined };
  await sendThsms(data.phone, code);
  const delivered = await admin.rpc("deliver_sms_challenge", { p_id: id });
  if (delivered.error) throw new Error("Unable to confirm OTP delivery");
  return { challengeId: id, expiresIn: 300, retryAfter: 30, sentCount: data.sentCount, sendLimit: data.sendLimit, resetAt: data.resetAt };
}
