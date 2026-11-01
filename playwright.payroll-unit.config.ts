import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: ["**/time-payroll-attendance-route.spec.ts", "**/time-payroll-route-failures.spec.ts",
    "**/time-payroll-cutoff-refresh.spec.ts", "**/time-payroll-money-contract.spec.ts", "**/time-payroll-route-response.spec.ts"],
  workers: 1, outputDir: "output/payroll-unit-results", reporter: "list",
});
