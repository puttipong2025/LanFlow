import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker?.ready;
  });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
    message: 'Service worker did not take control before offline navigation',
    timeout: 10000,
  }).toBe(true);
}

async function waitForAuthenticatedAppShell(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const cache = await window.caches.open('lanflow-start-url');
    return Boolean(await cache.match('/'));
  }), {
    message: 'Authenticated app shell was not cached before navigation changed',
    timeout: 10000,
  }).toBe(true);
}

test.describe('Offline Auth Cache Clearance', () => {
  test.skip(process.env.PW_PROJECT !== 'pwa', 'Offline routing relies on PWA service worker');

  test.afterEach(async ({ context }) => {
    await context.setOffline(false).catch(() => {});
  });

  test('should not reload-loop after the service worker controls an authenticated root page', async ({ page }) => {
    const phone = process.env.TEST_PHONE || '0800000000';
    const password = process.env.TEST_PASSWORD || 'password123';

    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.getByRole('button', { name: 'ภาพรวม', exact: true })).toBeVisible({ timeout: 15000 });
    await waitForServiceWorkerControl(page);
    await waitForAuthenticatedAppShell(page);

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'ภาพรวม', exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('should keep a valid cached profile when auth revalidation is temporarily unavailable', async ({ page }) => {
    const phone = process.env.TEST_PHONE || '0800000000';
    const password = process.env.TEST_PASSWORD || 'password123';

    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.getByRole('button', { name: 'ภาพรวม', exact: true })).toBeVisible({ timeout: 15000 });
    await waitForServiceWorkerControl(page);
    await waitForAuthenticatedAppShell(page);

    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const rawUrl = input instanceof Request ? input.url : String(input);
        const url = new URL(rawUrl, window.location.origin);
        if (url.pathname === '/api/auth/me') {
          const storageKey = 'lanflow:test-auth-503-hits';
          const hits = Number(window.localStorage.getItem(storageKey) ?? '0') + 1;
          window.localStorage.setItem(storageKey, String(hits));
          return new Response(JSON.stringify({ error: 'auth service unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch(input, init);
      };
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('button', { name: 'ภาพรวม', exact: true })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => Number(
      window.localStorage.getItem('lanflow:test-auth-503-hits') ?? '0',
    ))).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Boolean(
      window.localStorage.getItem('lanflow:last-auth-user'),
    ))).toBe(true);
  });

  test('should not restore profile if offline after logout', async ({ page, context }) => {
    const phone = process.env.TEST_PHONE || '0800000000';
    const password = process.env.TEST_PASSWORD || 'password123';
    // Online login
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');

    await expect(page.getByRole('button', { name: 'ภาพรวม', exact: true })).toBeVisible({ timeout: 15000 });
    await waitForServiceWorkerControl(page);
    await waitForAuthenticatedAppShell(page);

    // Verify localStorage has auth cache
    const hasCache = await page.evaluate(() => {
      return !!window.localStorage.getItem('lanflow:last-auth-user');
    });
    expect(hasCache).toBe(true);

    // Logout
    await page.click('button:has-text("ออกจากระบบ")');
    await expect(page.getByRole('heading', { name: 'ยืนยันออกจากระบบ?' })).toBeVisible();
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).last().click();
    await expect(page.locator('text=เข้าสู่ระบบ')).toBeVisible({ timeout: 10000 });

    // Verify localStorage cleared
    const hasCacheAfter = await page.evaluate(() => {
      return !!window.localStorage.getItem('lanflow:last-auth-user');
    });
    expect(hasCacheAfter).toBe(false);

    // Go offline, reload root page
    await context.setOffline(true);
    await page.goto('/');

    const debugLocal = await page.evaluate(() => {
      return window.localStorage.getItem('lanflow:last-auth-user');
    });
    console.log("LAST_USER_KEY after offline reload:", debugLocal);

    // Should show offline logged out screen, not enter app and not crash to dinosaur page
    await expect(page.locator('text=ออฟไลน์และออกจากระบบแล้ว')).toBeVisible({ timeout: 10000 });
  });

  test('should sign out if offline cache has expired (validatedAt > 7 days)', async ({ page, context }) => {
    const phone = process.env.TEST_PHONE || '0800000000';
    const password = process.env.TEST_PASSWORD || 'password123';

    // 1. Online login to establish valid cache
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.getByRole('button', { name: 'ภาพรวม', exact: true })).toBeVisible({ timeout: 15000 });
    await waitForServiceWorkerControl(page);
    await waitForAuthenticatedAppShell(page);

    // 2. Expire the offline cache by setting validatedAt to 8 days ago
    const cacheExpired = await page.evaluate(() => {
      const lastUser = window.localStorage.getItem('lanflow:last-auth-user');
      if (!lastUser) return false;
      const cacheKey = `lanflow:auth-profile:${lastUser}`;
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw) return false;
      const cache = JSON.parse(raw);
      // Set validatedAt to 8 days ago (beyond OFFLINE_AUTH_MAX_AGE_MS = 7 days)
      cache.validatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      window.localStorage.setItem(cacheKey, JSON.stringify(cache));
      return true;
    });
    expect(cacheExpired).toBe(true); // Prove we actually mutated a real cache entry

    // 3. Go offline, reload
    await context.setOffline(true);
    await page.goto('/');

    // 4. App-only UI must never render during expired offline reload
    await expect(page.locator('button:has-text("บิลยาง")')).toBeHidden({ timeout: 5000 });

    // 5. Should show offline signed-out screen
    await expect(page.locator('text=ออฟไลน์และออกจากระบบแล้ว')).toBeVisible({ timeout: 10000 });

    // 6. Verify cache was cleared
    const hasCache = await page.evaluate(() => {
      return !!window.localStorage.getItem('lanflow:last-auth-user');
    });
    expect(hasCache).toBe(false);
  });
});

for (const downgrade of [false, true]) {
test(`SMS revocation on reconnect preserves a pending queue${downgrade ? ' after role downgrade and new login' : ''}`, async ({ browser }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/);
  const service = createClient(url, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const context = await browser.newContext();
  const page = await context.newPage();
  let owner = '';
  try {
    await page.goto('/login');
    await page.locator('input[type="tel"]').fill('0810000001');
    await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD || 'password123');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ภาพรวม', exact: true })).toBeVisible({ timeout: 15000 });
    if (process.env.PW_PROJECT === 'pwa') await waitForServiceWorkerControl(page);
    const profile = await page.evaluate(() => {
      const id = localStorage.getItem('lanflow:last-auth-user')!;
      return JSON.parse(localStorage.getItem(`lanflow:auth-profile:${id}`)!).profile;
    });
    owner = profile.id;
    const location = profile.primaryLocationId || profile.locationIds[0];
    expect(location).toBeTruthy();
    await context.setOffline(true);
    const marker = crypto.randomUUID();
    await page.evaluate(({ marker, owner, location }) => new Promise<void>((resolve, reject) => {
      const opened = indexedDB.open('lanflow_sync_db');
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const db = opened.result;
        const transaction = db.transaction('sync_queue', 'readwrite');
        for (const entity of ['rubber_bills', 'income_expense']) transaction.objectStore('sync_queue').add({ id: marker, entity, ownerUserId: owner, locationId: location, operation: 'create', payload: { clientTempId: marker, locationId: location }, timestamp: Date.now(), status: 'pending' });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    }), { marker, owner, location });
    const actors = await service.from('profiles').select('id').eq('role', 'super_admin').limit(1);
    expect((await service.rpc('set_user_sms_required', { p_actor: actors.data![0].id, p_target: owner, p_required: true })).error).toBeNull();
    if (downgrade) expect((await service.from('profiles').update({ role: 'user' }).eq('id', owner)).error).toBeNull();
    let replayed = 0;
    page.on('request', request => { if (request.method() === 'POST' && ['/api/lanflow/rubber-bills', '/api/lanflow/income-expense'].includes(new URL(request.url()).pathname)) replayed++; });
    await context.setOffline(false);
    await expect(page).toHaveURL(/\/login$/);
    if (downgrade) {
      expect((await service.rpc('set_user_sms_required', { p_actor: actors.data![0].id, p_target: owner, p_required: false })).error).toBeNull();
      await page.getByRole('button', { name: 'แสดง', exact: true }).click();
      await expect(page.locator('#password')).toHaveAttribute('type', 'text');
      await page.getByRole('button', { name: 'ซ่อน', exact: true }).click();
      await page.locator('input[type="tel"]').fill('0810000001');
      await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD || 'password123');
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'เวลาและเงินเดือน', exact: true })).toBeVisible();
      await expect(page.getByText('กำลังตรวจสอบสิทธิ์...', { exact: true })).toBeHidden();
      expect((await page.request.get('/api/lanflow/dashboard')).status()).toBe(403);
    }
    const queued = await page.evaluate(marker => new Promise<Array<{ status: string; ownerUserId: string; locationId: string }>>((resolve, reject) => {
      const opened = indexedDB.open('lanflow_sync_db');
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const db = opened.result;
        const request = db.transaction('sync_queue').objectStore('sync_queue').index('id').getAll(marker);
        request.onsuccess = () => { db.close(); resolve(request.result); };
        request.onerror = () => reject(request.error);
      };
    }), marker);
    expect(queued).toHaveLength(2);
    for (const event of queued) {
      expect(event.status).toBe('pending');
      expect(event.ownerUserId).toBe(owner);
      expect(event.locationId).toBe(location);
    }
    expect(replayed).toBe(0);
  } finally {
    await context.setOffline(false);
    if (owner) {
      if (downgrade) await service.from('profiles').update({ role: 'admin' }).eq('id', owner);
      const actors = await service.from('profiles').select('id').eq('role', 'super_admin').limit(1);
      await service.rpc('set_user_sms_required', { p_actor: actors.data![0].id, p_target: owner, p_required: false });
    }
    await context.close();
  }
});
}
