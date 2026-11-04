import { defineConfig, devices } from "@playwright/test";
import { resetTestEnvironment } from "./tests/support/bill-device-reset-target";
const target = resetTestEnvironment();
export default defineConfig({
  testDir: "./tests", testMatch: ["**/branch-bonus-browser.spec.ts"], workers: 1, outputDir: "test-results/branch-bonus-browser",
  forbidOnly: !!process.env.CI, retries: 0, reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3006", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev -p 3006", url: "http://127.0.0.1:3006/login",
    reuseExistingServer: false, timeout: 120000, gracefulShutdown: { signal: "SIGINT", timeout: 5000 },
    env: { NEXT_PUBLIC_SUPABASE_URL: target.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: target.anonKey,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: target.anonKey, SUPABASE_SERVICE_ROLE_KEY: target.serviceKey },
  },
});
