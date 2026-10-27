// Diagnostic only: run against the local production build, without business writes.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';

const profilePath = await mkdtemp(join(tmpdir(), 'lanflow-pwa-diagnostic-'));
let context = await chromium.launchPersistentContext(profilePath, { ...devices['Pixel 7'], headless: true });
let page = await context.newPage();
const errors = [];
const failedScripts = [];
function observe(target) {
target.on('pageerror', error => errors.push(error.stack ?? error.message));
target.on('requestfailed', request => {
  if (['script', 'document'].includes(request.resourceType())) {
    failedScripts.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
  }
});
}
observe(page);

async function waitFor(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

try {
  if (process.argv.includes('--vercel-query')) {
    await page.route('http://127.0.0.1:3001/', async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/((?:src|href)=["'])(\/_next\/static\/[^"'?]+)(["'])/g, '$1$2?dpl=dpl_diagnostic$3');
      await route.fulfill({ response, body: html });
    });
  }
  await page.goto('http://127.0.0.1:3001/login');
  await page.locator('input[type="tel"]').fill(process.env.TEST_PHONE || '0800000000');
  await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD || 'password123');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await page.getByRole('button', { name: 'ภาพรวม', exact: true }).waitFor();
  const alert = page.getByRole('alertdialog', { name: 'แจ้งเตือน', exact: true });
  if (await alert.isVisible()) await alert.getByRole('button', { name: 'รับทราบ' }).click();
  await waitFor(() => page.evaluate(async () => {
    const cache = await caches.open('lanflow-start-url');
    return Boolean(navigator.serviceWorker.controller && await cache.match('/'));
  }), 'Service worker/app shell not ready');
  await page.getByText('พร้อมใช้งานออฟไลน์ 100%', { exact: true }).waitFor({ timeout: 20000 });
  console.log('READINESS_100: verified versioned files and current account/branch');
  await mkdir('output/pwa-readiness', { recursive: true });
  await page.screenshot({ path: 'output/pwa-readiness/android-online.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Header must fit the mobile viewport');
  console.log('ONLINE_READY', await page.evaluate(async () => ({
    caches: await caches.keys(),
    scripts: document.scripts.length,
  })));
  if (process.argv.includes('--vercel-query')) {
    await page.unroute('http://127.0.0.1:3001/');
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (['lanflow-static-cache', 'next-static-js-assets', 'static-js-assets', 'static-style-assets'].includes(name)) await caches.delete(name);
      }
    });
  }
  if (process.argv.includes('--cold')) {
    await context.close();
    context = await chromium.launchPersistentContext(profilePath, {
      ...devices['Pixel 7'], headless: true, offline: true,
    });
    page = await context.newPage();
    observe(page);
    await page.goto('http://127.0.0.1:3001/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } else {
    await context.setOffline(true);
    await page.getByText('ไม่มีอินเทอร์เน็ต', { exact: true }).waitFor();
    console.log('OFFLINE_TRANSITION', { errors: [...errors], failedScripts: [...failedScripts] });
  if (process.argv.includes('--reopen')) {
    await page.close();
    page = await context.newPage();
    observe(page);
    await page.goto('http://127.0.0.1:3001/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  }
  await waitFor(async () => errors.length > 0 || await page.getByRole('button', { name: 'เพิ่มบิลยาง', exact: true }).isVisible(), 'Offline workspace did not load');
  console.log('OFFLINE_RELOAD', { errors, failedScripts });
  assert.deepEqual(errors, [], 'Offline reload must not cause a client-side exception');
  assert.equal(await page.getByRole('button', { name: 'เพิ่มบิลยาง', exact: true }).isVisible(), true);
  await page.getByText('พร้อมใช้งานออฟไลน์ 100%', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole('button', { name: 'ตรวจหลักฐาน', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'รับ-จ่าย', exact: true }).click();
  await page.getByRole('button', { name: 'เพิ่มรายรับ', exact: true }).waitFor();
  await page.getByRole('button', { name: 'บิลยาง', exact: true }).click();
  await page.getByRole('button', { name: 'เพิ่มบิลยาง', exact: true }).waitFor();
  assert.deepEqual(errors, [], 'Both offline-supported modules must load without a client exception');
  await page.screenshot({ path: 'output/pwa-readiness/android-offline.png', fullPage: true });
  if (process.argv.includes('--missing-file')) {
    await page.evaluate(async () => {
      const names = (await caches.keys()).filter(name => name.startsWith('workbox-precache-'));
      for (const name of names) {
        const cache = await caches.open(name);
        for (const key of await cache.keys()) {
          if (new URL(key.url).pathname === '/fonts/NotoSansThai-Bold.ttf') await cache.delete(key);
        }
      }
    });
    await page.locator('summary').filter({ hasText: 'พร้อมใช้งานออฟไลน์ 100%' }).click();
    await page.getByRole('button', { name: 'ตรวจความพร้อมอีกครั้ง', exact: true }).click();
    await waitFor(async () => !await page.getByText('พร้อมใช้งานออฟไลน์ 100%', { exact: true }).isVisible(), 'Missing file must invalidate 100%');
    await page.getByText(/ยังไม่พร้อมออฟไลน์ [1-9]\d?%/).waitFor();
    console.log('MISSING_FILE: partial cache correctly reports below 100%');
  }
  console.log('PASS: offline reload renders the Rubber Bill workspace without a client exception');
} catch (error) {
  console.error('FAIL:', error.message);
  console.error(JSON.stringify({ errors, failedScripts }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close();
  await rm(profilePath, { recursive: true, force: true });
}
