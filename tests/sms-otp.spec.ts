import { test, expect } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

test("OTP proof binds user, session, challenge and code; missing secret fails closed", () => {
  const env = { SMS_OTP_SECRET: "test-secret-with-at-least-thirty-two-characters" };
  const module = loadSourceModule<typeof import("../src/lib/server/sms-otp")>("src/lib/server/sms-otp.ts", {}, { process: { env } });
  const digest = module.otpDigest("user", "session", "challenge", "123456");
  expect(digest).toHaveLength(64);
  expect(module.otpDigest("user", "other-session", "challenge", "123456")).not.toBe(digest);
  expect(module.otpDigest("other-user", "session", "challenge", "123456")).not.toBe(digest);
  expect(module.otpDigest("user", "session", "new-challenge", "123456")).not.toBe(digest);
  env.SMS_OTP_SECRET = "";
  expect(() => module.otpDigest("user", "session", "challenge", "123456")).toThrow();
});

test("SMS mutations reject foreign origins and missing browser origin", () => {
  const module = loadSourceModule<typeof import("../src/lib/server/sms-otp")>("src/lib/server/sms-otp.ts", {});
  expect(module.isSmsMutationAllowed(new Request("https://lanflow.test/api/auth/sms", { headers: { origin: "https://foreign.test" } }))).toBe(false);
  expect(module.isSmsMutationAllowed(new Request("https://lanflow.test/api/auth/sms"))).toBe(false);
  expect(module.isSmsMutationAllowed(new Request("https://lanflow.test/api/auth/sms", { headers: { origin: "" } }))).toBe(false);
  expect(module.isSmsMutationAllowed(new Request("https://lanflow.test/api/auth/sms", { headers: { origin: "https://lanflow.test" } }))).toBe(true);
  expect(module.isSmsMutationAllowed(new Request("http://localhost:3107/api/auth/sms", { headers: { origin: "http://127.0.0.1:3107", host: "127.0.0.1:3107" } }))).toBe(true);
});

test("offline queue preflight refuses a different owner and unavailable auth", async () => {
  const module = loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts", {
    "@/lib/network-abort": { abortableFetch: async () => Response.json({ profile: { id: "other-user" } }) },
  });
  expect(await module.canSyncCurrentSession("queue-owner")).toBe(false);
  const failed = loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts", {
    "@/lib/network-abort": { abortableFetch: async () => new Response(null, { status: 401 }) },
  });
  expect(await failed.canSyncCurrentSession("queue-owner")).toBe(false);
});

test("provider timeout or unknown success shape never confirms delivery", async () => {
  let sent: Record<string, unknown> | undefined;
  const module = loadSourceModule<typeof import("../src/lib/server/sms-otp")>("src/lib/server/sms-otp.ts", {}, {
    process: { env: { THSMS_API_KEY: "fake", THSMS_SENDER: "TEST" } },
    fetch: async (_url: string, options: { body: string }) => { sent = JSON.parse(options.body); return Response.json({ error: "unconfirmed" }); },
  });
  let rejected = false;
  try { await module.sendThsms("66812345678", "123456"); } catch { rejected = true; }
  expect(rejected).toBe(true);
  expect(sent?.msisdn).toEqual(["0812345678"]);
});

test("queue preflight pauses an owner whose business role was removed", async () => {
  const module = loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts", {
    "@/lib/network-abort": { abortableFetch: async () => Response.json({ profile: { id: "queue-owner", role: "user" } }) },
  });
  expect(await module.canSyncCurrentSession("queue-owner")).toBe(false);
});

test("queue preflight checks the original branch and allows an authorized owner", async () => {
  const module = loadSourceModule<typeof import("../src/lib/auth-fetch")>("src/lib/auth-fetch.ts", {
    "@/lib/network-abort": { abortableFetch: async () => Response.json({ profile: { id: "queue-owner", role: "admin", locationIds: ["branch-a"] } }) },
  });
  expect(await module.canSyncCurrentSession("queue-owner", "branch-a")).toBe(true);
  expect(await module.canSyncCurrentSession("queue-owner", "branch-b")).toBe(false);
});
