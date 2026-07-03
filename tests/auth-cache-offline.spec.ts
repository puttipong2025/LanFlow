import { test, expect } from '@playwright/test';

test.describe('Offline Auth Cache Clearance', () => {
  test.skip(process.env.PW_PROJECT !== 'pwa', 'Offline routing relies on PWA service worker');

  test.afterEach(async ({ context }) => {
    await context.setOffline(false).catch(() => {});
  });

  test('should not restore profile if offline after logout', async ({ page, context }) => {
    const phone = process.env.TEST_PHONE || '0800000000';
    const password = process.env.TEST_PASSWORD || 'password123';
    // Online login
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');

    await expect(page.locator('text=ภาพรวม')).toBeVisible({ timeout: 15000 });

    // Verify localStorage has auth cache
    const hasCache = await page.evaluate(() => {
      return !!window.localStorage.getItem('lanflow:last-auth-user');
    });
    expect(hasCache).toBe(true);

    // Logout
    await page.click('button:has-text("ออกจากระบบ")');
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
    await expect(page.locator('text=ภาพรวม')).toBeVisible({ timeout: 15000 });

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
