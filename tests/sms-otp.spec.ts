import { test, expect } from "@playwright/test";
import { loadSourceModule } from "./helpers/load-source-module";

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
