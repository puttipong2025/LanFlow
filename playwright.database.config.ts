import { defineConfig } from '@playwright/test';

// Requires the local Supabase Docker database; never run in the web build gate.
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/time-payroll-adjustment-concurrency.spec.ts', '**/cash-counts/cash-count-concurrency.spec.ts', '**/cash-counts/cash-count-overdue-concurrency.spec.ts', '**/rubber-command-concurrency.spec.ts', '**/rubber-central-queue-concurrency.spec.ts', '**/rubber-device-numbering-concurrency.spec.ts', '**/income-expense-background-concurrency.spec.ts'],
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
});
