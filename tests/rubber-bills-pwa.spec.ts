import { test, expect, Page } from '@playwright/test';
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const localSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const localServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
      const req = indexedDB.open('lanflow_sync_db');
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

async function readReceiptSnapshots(page: Page): Promise<any[]> {
  return page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('lanflow_sync_db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('rubber_bill_receipts')) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction('rubber_bill_receipts', 'readonly');
      const all = transaction.objectStore('rubber_bill_receipts').getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
      transaction.oncomplete = () => db.close();
    };
  }));
}

async function deleteReceiptSnapshot(page: Page, billId: string) {
  await page.evaluate((targetBillId) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('lanflow_sync_db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('rubber_bill_receipts', 'readwrite');
      transaction.objectStore('rubber_bill_receipts').delete(targetBillId);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    };
  }), billId);
}

test.use({ baseURL: 'http://127.0.0.1:3001' });

test.describe('PWA Offline Reload', () => {
  const phone = process.env.TEST_PHONE || '0800000000';
  const password = process.env.TEST_PASSWORD || 'password123';

  test.afterEach(async ({ context }) => {
    await context.setOffline(false).catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    const resetApprovalSetting = await page.request.patch(
      `${localSupabaseUrl}/rest/v1/rubber_bill_approval_settings?id=eq.true`,
      {
        headers: {
          apikey: localServiceRoleKey,
          Authorization: `Bearer ${localServiceRoleKey}`,
          Prefer: 'return=minimal',
        },
        data: { edit_window_minutes: 30, configured_price: null },
      }
    );
    expect(resetApprovalSetting.ok()).toBeTruthy();
    await page.addInitScript(() => {
      localStorage.setItem("lanflow:rubber-bill-approval-settings:v1", JSON.stringify({
        editWindowMinutes: 30,
        configuredPrice: null,
        cachedAt: new Date().toISOString(),
      }));
    });
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
    test.setTimeout(150000);

    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => {
      Window.prototype.print = function printWithoutDialog() {
        window.setTimeout(() => {
          this.dispatchEvent(new Event('afterprint'));
        }, 0);
      };
    });

    // === Phase 1: Login online — let SW install and cache the app shell ===
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });

    // Visit rubber bills tab to trigger SW precaching of this view
    await page.click('button:has-text("บิลยาง")');
    await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible();

    // Create one synced bill so the online query stores a complete receipt snapshot.
    const syncedMarker = `PWA-SYNCED-${Date.now()}`;
    await page.click('button:has-text("เพิ่มบิลยาง")');
    await page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(syncedMarker);
    await page.keyboard.press('Escape');
    const syncedModal = page.locator('.fixed.inset-0').last();
    const syncedWeighRow = syncedModal.locator('table').first().locator('tbody tr').first();
    await syncedWeighRow.locator('input[type="number"]').nth(0).fill('1000');
    await syncedWeighRow.locator('input[type="number"]').nth(1).fill('200');
    await syncedWeighRow.locator('input[type="number"]').nth(3).fill('20.00');
    await page.click('button:has-text("Submit")');

    const syncedRow = page.locator('table tbody tr', { hasText: syncedMarker }).first();
    await expect(syncedRow).toBeVisible({ timeout: 10000 });
    await expect(syncedRow.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => {
      const snapshots = await readReceiptSnapshots(page);
      return snapshots.find((snapshot) => snapshot.bill?.customerName === syncedMarker) ?? null;
    }, {
      message: 'Synced receipt snapshot was not cached',
      timeout: 20000,
    }).not.toBeNull();

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
    const cachedSyncedRow = page.locator('table tbody tr', { hasText: syncedMarker }).first();
    await expect(cachedSyncedRow).toBeVisible({ timeout: 10000 });
    await expect(cachedSyncedRow.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible();

    // Verify IDB queue survived the offline reload
    const queueAfterReload = await readQueue(page);
    const eventAfterReload = queueAfterReload.find(e => e.payload?.customerName === pwaMarker);
    expect(eventAfterReload).toBeDefined();
    expect(eventAfterReload.operation).toBe('create');
    expect(eventAfterReload.status).toBe('pending');

    // Both offline PDF downloads must work without any network request or mutation.
    await page.waitForTimeout(1000);
    const printRequests: string[] = [];
    let capturePrintRequests = false;
    page.on('request', (request) => {
      if (capturePrintRequests) {
        printRequests.push(`${request.method()} ${request.url()}`);
      }
    });
    capturePrintRequests = true;
    const offlineDownloadPromise = page.waitForEvent("download");
    await offlineRow.locator('button[title="ดาวน์โหลด PDF ใบรับซื้อยาง"]').click();
    const offlineDownload = await offlineDownloadPromise;
    expect(offlineDownload.suggestedFilename()).toMatch(/^LanFlow-rubber-bill-.*-80mm\.pdf$/);
    const pdfOutputDir = join(process.cwd(), "output", "pdf");
    await mkdir(pdfOutputDir, { recursive: true });
    await offlineDownload.saveAs(join(pdfOutputDir, "rubber-bill-offline-80mm.pdf"));
    await expect(page.locator('iframe[aria-hidden="true"]')).toHaveCount(0);
    const syncedDownloadPromise = page.waitForEvent("download");
    await cachedSyncedRow.locator('button[title="ดาวน์โหลด PDF ใบรับซื้อยาง"]').click();
    const syncedDownload = await syncedDownloadPromise;
    expect(syncedDownload.suggestedFilename()).toMatch(/^LanFlow-rubber-bill-.*-80mm\.pdf$/);
    await syncedDownload.saveAs(join(pdfOutputDir, "rubber-bill-synced-80mm.pdf"));
    await expect(page.locator('iframe[aria-hidden="true"]')).toHaveCount(0);
    await page.waitForTimeout(200);
    capturePrintRequests = false;
    expect(printRequests).toEqual([]);

    // A synced row without its receipt snapshot must ask to reconnect instead of rebuilding from network.
    const cachedSnapshots = await readReceiptSnapshots(page);
    const cachedSyncedSnapshot = cachedSnapshots.find(
      (snapshot) => snapshot.bill?.customerName === syncedMarker
    );
    expect(cachedSyncedSnapshot).toBeDefined();
    await deleteReceiptSnapshot(page, cachedSyncedSnapshot.billId);
    await cachedSyncedRow.locator('button[title="ดาวน์โหลด PDF ใบรับซื้อยาง"]').click();
    await expect(page.getByText('ไม่พบสำเนาใบพิมพ์ของบิลนี้ในเครื่อง กรุณาออนไลน์เพื่อโหลดใหม่'))
      .toBeVisible();

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

    const syncedCleanup = {
      operation: 'delete',
      clientTempId: cachedSyncedSnapshot.bill.clientTempId,
      idempotencyKey: `delete:${cachedSyncedSnapshot.bill.clientTempId}:${cachedSyncedSnapshot.revisionNo}`,
      expectedRevisionNo: cachedSyncedSnapshot.revisionNo,
      recordStatus: 'deleted',
      locationId: cachedSyncedSnapshot.locationId,
    };
    await page.request.post('/api/lanflow/rubber-bills', { data: syncedCleanup });
  });
});
