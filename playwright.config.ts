import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local so test code can access SUPABASE_SERVICE_ROLE_KEY etc.
const envPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const isPwa = process.env.PW_PROJECT === 'pwa';

export default defineConfig({
  testDir: './tests',
  globalTeardown: './tests/playwright-global-teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: isPwa ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: isPwa ? [
    {
      // Production-mode tests: uses `npm start` with PWA/SW enabled
      // Run with: PW_PROJECT=pwa npx playwright test --project=chromium-pwa
      // Requires: npm run build first
      name: 'chromium-pwa',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/rubber-bills-pwa.spec.ts', '**/auth-cache-offline.spec.ts'],
    }
  ] : [
    {
      // Dev-mode tests: uses `npm run dev`, PWA/SW disabled
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/rubber-bills-pwa.spec.ts'],
    }
  ],
  webServer: isPwa
    ? {
        command: 'node node_modules/next/dist/bin/next start -p 3001',
        url: 'http://127.0.0.1:3001',
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGINT', timeout: 1000 },
        timeout: 30 * 1000,
      }
    : {
        command: 'node node_modules/next/dist/bin/next dev -p 3000',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGINT', timeout: 1000 },
        timeout: 120 * 1000,
      },
});
