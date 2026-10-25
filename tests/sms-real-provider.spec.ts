import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { loadSourceModule } from "./helpers/load-source-module";

test("opt-in: a real THSMS OTP for the authorized local fixture verifies once", async () => {
  test.skip(process.env.RUN_REAL_SMS_TEST !== "1", "Explicit opt-in required; consumes one SMS credit");
  const settings = parse(readFileSync(".env.local"));
  expect(settings.NEXT_PUBLIC_SUPABASE_URL).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/);
  const admin = createClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.SUPABASE_SECRET_KEY || settings.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const phone = "0641545551";
  const existing = await admin.from("profiles").select("id").eq("phone", phone);
  expect(existing.error).toBeNull();
  test.skip((existing.data?.length ?? 0) > 0, "Authorized phone already belongs to a local account; do not alter it for testing");
  const password = crypto.randomUUID();
  let userId: string | undefined;
  let capturedCode = "";
  try {
    const created = await admin.auth.admin.createUser({ phone: "+66641545551", password, phone_confirm: true });
    expect(created.error).toBeNull();
    userId = created.data.user!.id;
    expect((await admin.from("profiles").insert({ id: userId, phone, name: "SMS real delivery fixture", role: "admin", is_active: true })).error).toBeNull();
    const actors = await admin.from("profiles").select("id").eq("role", "super_admin").limit(1);
    expect((await admin.rpc("set_user_sms_required", { p_actor: actors.data![0].id, p_target: userId, p_required: true })).error).toBeNull();
    const auth = createClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || settings.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await auth.auth.signInWithPassword({ phone: "+66641545551", password });
    expect(signed.error).toBeNull();
    const sessionId = JSON.parse(Buffer.from(signed.data.session!.access_token.split(".")[1], "base64url").toString()).session_id;
    const module = loadSourceModule<typeof import("../src/lib/server/sms-otp")>("src/lib/server/sms-otp.ts", {
      "@/lib/server/supabase-admin": { createSupabaseAdminClient: () => admin },
    }, {
      process: { env: settings },
      fetch: async (url: string, options: RequestInit) => {
        // Only test memory sees the generated code; never log or persist it.
        capturedCode = /code: ([0-9]{6})/.exec(JSON.parse(String(options.body)).message)?.[1] ?? "";
        return fetch(url, options);
      },
    });
    const result = await module.startSmsChallenge(userId, sessionId, new Request("http://localhost/api/auth/sms"));
    expect("challengeId" in result).toBe(true);
    expect(capturedCode).toMatch(/^[0-9]{6}$/);
    const params = { p_user: userId, p_session: sessionId, p_id: result.challengeId, p_digest: module.otpDigest(userId, sessionId, result.challengeId!, capturedCode) };
    const verified = await admin.rpc("verify_sms_challenge", params);
    expect(verified.error).toBeNull();
    expect(verified.data).toBe(true);
    expect((await auth.rpc("sms_login_status")).data.status).toBe("READY");
    expect((await admin.rpc("verify_sms_challenge", params)).data).toBe(false);
    await auth.auth.signOut({ scope: "local" });
  } finally {
    if (userId) {
      // Service-only audit rows have no browser API; profiles/Auth fixtures are temporary.
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
