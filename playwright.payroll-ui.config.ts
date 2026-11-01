import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "**/time-payroll-refresh-ui.spec.ts", workers: 1,
  outputDir: "output/payroll-ui-results", reporter: "list", timeout: 30_000,
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3017", screenshot: "only-on-failure" },
  webServer: { command: "node scripts/run-payroll-ui-harness.mjs", url: "http://127.0.0.1:3017", reuseExistingServer: true, timeout: 120_000 },
});
