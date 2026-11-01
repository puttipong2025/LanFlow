import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "**/time-payroll-attendance-concurrency.spec.ts",
  workers: 1, timeout: 20_000, outputDir: "output/payroll-db-results", reporter: "list",
});
