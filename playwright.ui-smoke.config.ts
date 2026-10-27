import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/rubber-sync-recovery-ui.spec.ts"],
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  workers: 1,
  use: { browserName: "chromium" },
});
