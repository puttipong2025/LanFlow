import { test, expect, Page } from '@playwright/test';

/**
 * PWA Offline Reload Test
 * 
 * This test validates the shipment plan's offline requirements:
 *   1. PWA shell loads from SW cache during offline reload ✅
 *   2. IndexedDB queue survives offline reload ✅
 *   3. After going online, app renders queued bills and syncs them ✅
 * 
 * Prerequisites:
 *   1. npm run build  (produces .next/ with service worker)
 *   2. PW_PROJECT=pwa npx playwright test --project=chromium-pwa
 */

/** Read all events from IndexedDB sync_queue */
async function readQueue(page: Page): Promise<any[]> {
  await page.waitForLoadState('domcontentloaded');
  return page.evaluate(() => {
    return new Promise<any[]>((resolve, reject) => {
      const req = indexedDB.open('lanflow_sync_db', 2);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        req.transaction?.abort();
        resolve([]);
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction('sync_queue', 'readonly');
        const store = tx.objectStore('sync_queue');
        const all = store.getAll();
        all.onsuccess = () => { db.close(); resolve(all.result); };
        all.onerror = () => { db.close(); reject(all.error); };
      };
    });
  });
}

test.use({ baseURL: 'http://127.0.0.1:3001' });

test.describe('PWA Offline Reload', () => {
  const phone = process.env.TEST_PHONE || '0800000000';
  const password = process.env.TEST_PASSWORD || 'password123';

  test.afterEach(async ({ context }) => {
    await context.setOffline(false).catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('lanflow_sync_db');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      });
    });
  });

  test('should preserve IDB queue across offline page reload and sync after reconnect', async ({ page, context }) => {
    test.setTimeout(120000);

    page.on('dialog', dialog => dialog.accept());

    // === Phase 1: Login online — let SW install and cache the app shell ===
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });

    // Visit rubber bills tab to trigger SW precaching of this view
    await page.click('button:has-text("บิลยาง")');
    await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible();

    // Wait for service worker to be active and controlling the page
    await expect.poll(async () => {
      return page.evaluate(async () => {
        return !!navigator.serviceWorker?.controller;
      });
    }, {
      message: 'Service worker not controlling the page yet',
      timeout: 10000,
    }).toBe(true);

    // === Phase 2: Go offline, create bill ===
    await context.setOffline(true);

    const pwaMarker = `PWA-${Date.now()}`;
    await page.click('button:has-text("เพิ่มบิลยาง")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeVisible();
    await page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(pwaMarker);
    await page.keyboard.press('Escape');
    const modal = page.locator('.fixed.inset-0').last();
    const weighRow = modal.locator('table').first().locator('tbody tr').first();
    await weighRow.locator('input[type="number"]').nth(0).fill('1000');
    await weighRow.locator('input[type="number"]').nth(1).fill('200');
    await weighRow.locator('input[type="number"]').nth(3).fill('25.5');
    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    // Verify bill is in IDB queue before reload
    const queueBeforeReload = await readQueue(page);
    const eventBeforeReload = queueBeforeReload.find(e => e.payload?.customerName === pwaMarker);
    expect(eventBeforeReload).toBeDefined();

    // === Phase 3: RELOAD WHILE OFFLINE ===
    // The service worker serves cached HTML/JS so the page loads.
    // However, server-side auth validation fails offline → app shows "no access" screen.
    // Key assertion: IndexedDB data SURVIVES the reload.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });

    // The SW-cached page loaded (we can see "ออกจากระบบ" which is rendered client-side)
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 15000 });

    // In full offline mode with bootstrap cache, we should be able to click tabs
    await page.click('button:has-text("บิลยาง")');
    await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible({ timeout: 10000 });

    // And the bill created offline should be visible with "รอซิงก์" badge
    const offlineRow = page.locator('table tbody tr', { hasText: pwaMarker }).first();
    await expect(offlineRow).toBeVisible({ timeout: 10000 });
    await expect(offlineRow.locator('span:has-text("รอซิงก์")')).toBeVisible();

    // Verify IDB queue survived the offline reload
    const queueAfterReload = await readQueue(page);
    const eventAfterReload = queueAfterReload.find(e => e.payload?.customerName === pwaMarker);
    expect(eventAfterReload).toBeDefined();
    expect(eventAfterReload.operation).toBe('create');
    expect(eventAfterReload.status).toBe('pending');

    // === Phase 4: Go online → reload again → full app renders → sync ===
    await context.setOffline(false);
    await page.waitForTimeout(500); // Give network stack time to recover
    // Workaround for Playwright ERR_ABORTED after offline state: navigate away then back
    await page.goto('about:blank');
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 15000 });
    await page.click('button:has-text("บิลยาง")');

    // Bill from queue should be visible and eventually sync
    const reloadedRow = page.locator('table tbody tr', { hasText: pwaMarker }).first();
    await expect(reloadedRow).toBeVisible({ timeout: 10000 });

    // Wait for sync to complete
    await expect(reloadedRow.locator('span:has-text("รอซิงก์")')).toBeHidden({ timeout: 20000 });
    await expect(reloadedRow.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 5000 });

    // IDB queue should have no pending events for this bill
    const queueAfterSync = await readQueue(page);
    const pendingAfterSync = queueAfterSync.filter(
      e => e.payload?.customerName === pwaMarker && e.status === 'pending'
    );
    expect(pendingAfterSync.length).toBe(0);

    // === Cleanup: soft delete the test bill ===
    // Use the IDs we saved before reload/sync, since queueAfterSync is empty
    const cleanupPayload = {
      operation: 'delete',
      clientTempId: eventBeforeReload.id,
      idempotencyKey: `delete:${eventBeforeReload.id}:1`,
      expectedRevisionNo: 1,
      recordStatus: 'deleted',
      locationId: eventBeforeReload.payload.locationId,
    };
    await page.request.post('/api/lanflow/rubber-bills', { data: cleanupPayload });
  });
});
