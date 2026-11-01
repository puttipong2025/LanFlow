import { defineConfig, devices } from "@playwright/test";
import { resetTestEnvironment } from "./tests/support/bill-device-reset-target";

const target = resetTestEnvironment();
process.env.NEXT_PUBLIC_SUPABASE_URL = target.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = target.anonKey;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = target.anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = target.serviceKey;

export default defineConfig({
  testDir: "./tests", workers: 1, fullyParallel: false, forbidOnly: !!process.env.CI,
  reporter: "list", timeout: 90000,
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3002", screenshot: "only-on-failure" },
  projects: [
    { name: "reset-database", testMatch: "**/bill-device-reset-database.spec.ts" },
    { name: "reset-browser", testMatch: "**/bill-device-reset-browser.spec.ts" },
  ],
  webServer: process.env.BILL_RESET_DATABASE_ONLY === "1" ? undefined : {
    command: process.env.BILL_RESET_PRODUCTION === "1"
      ? "node node_modules/next/dist/bin/next start -p 3002"
      : "node node_modules/next/dist/bin/next dev -p 3002",
    url: "http://127.0.0.1:3002", reuseExistingServer: false, timeout: 120000,
    gracefulShutdown: { signal: "SIGINT", timeout: 1000 },
    env: { NEXT_PUBLIC_SUPABASE_URL: target.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: target.anonKey,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: target.anonKey, SUPABASE_SERVICE_ROLE_KEY: target.serviceKey },
  },
});
