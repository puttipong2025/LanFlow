import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";
import { getSmsIdentity, isSmsMutationAllowed, smsError, SMS_HEADERS } from "@/lib/server/sms-otp";

const COOKIE = "lanflow-browser";

export function browserLabel(agent: string) {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const os = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "อื่น ๆ";
  return `${browser} · ${os}`;
}

export async function browserApprovalResponse(request: Request, operation: "status" | "mutation") {
  try {
    const identity = await getSmsIdentity(request);
    if (!identity || ["SIGNED_OUT", "SESSION_REVOKED"].includes(identity.status)) return smsError("SESSION_REVOKED", 401);
    if (operation !== "status" && !isSmsMutationAllowed(request)) return smsError("FORBIDDEN", 403);
    if (!identity.password && identity.status !== "READY") return smsError("PASSWORD_REQUIRED", 401);
    const body = operation === "mutation" ? await request.json().catch(() => null) : null;
    if (operation === "mutation" && !["bootstrap", "resubmit"].includes(body?.action)) return smsError("INVALID_INPUT");
    const action = operation === "status" ? "status" : body.action as "bootstrap" | "resubmit";
    const jar = await cookies();
    const existing = jar.get(COOKIE)?.value;
    const valid = typeof existing === "string" && /^[a-f0-9]{64}$/.test(existing);
    const secret = valid ? existing : action === "status" ? null : randomBytes(32).toString("hex");
    const result = await createSupabaseAdminClient().rpc("bootstrap_browser_approval", {
      p_user: identity.userId, p_session: identity.sessionId,
      p_hash: secret ? createHash("sha256").update(secret).digest("hex") : null,
      p_label: browserLabel(request.headers.get("user-agent") ?? ""),
      p_request: action !== "status", p_resubmit: action === "resubmit",
    });
    if (result.error) return smsError("UNAVAILABLE", 503);
    const response = NextResponse.json(result.data, { headers: SMS_HEADERS });
    if (secret && !valid) response.cookies.set(COOKIE, secret, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400,
    });
    return response;
  } catch { return smsError("UNAVAILABLE", 503); }
}
