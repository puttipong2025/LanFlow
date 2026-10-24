import { defineConfig } from '@playwright/test';

// Requires the local Supabase Docker database; never run in the web build gate.
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/cash-counts/cash-count-concurrency.spec.ts'],
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
});
