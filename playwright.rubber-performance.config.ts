import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
const baseline = process.env.RUBBER_PERFORMANCE_MODE === 'baseline';
const phase2 = process.env.RUBBER_PERFORMANCE_MODE === 'phase2';
const root = baseline ? 'C:/Users/Do/.codex/worktrees/rubber-sync-baseline/webapp' : process.cwd();
const port = baseline ? 3100 : phase2 ? 3200 : 3000;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests', workers: 1, fullyParallel: false, reporter: 'list',
  use: { baseURL, ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    { name: 'measure', testMatch: /rubber-sync-performance-browser\.spec\.ts/, dependencies: ['setup'] },
  ],
  webServer: { command: `node node_modules/next/dist/bin/next dev -p ${port}`, cwd: root,
    env: phase2 ? { RUBBER_QUEUE_DATABASE_URL: '' } : undefined,
    url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
