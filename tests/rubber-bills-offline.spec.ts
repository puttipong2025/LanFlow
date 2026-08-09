import { test, expect, Page } from '@playwright/test';
import { assertRubberBillDeleteAllowed } from '../src/hooks/useRubberBills';
import { selectedAppLocationId } from './helpers/select-app-location';
import { bangkokDateString } from '../src/lib/bangkok-date';

const testUserId = process.env.TEST_USER_ID || '00000000-0000-4000-8000-000000000001';
const localSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const localServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Read all events from IndexedDB sync_queue (matching idb-queue.ts store name) */
async function readQueue(page: Page): Promise<any[]> {
  await page.waitForLoadState('domcontentloaded');
  return page.evaluate(() => {
    return new Promise<any[]>((resolve, reject) => {
      const req = indexedDB.open('lanflow_sync_db');
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        // DB doesn't exist yet → return empty
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
        all.onsuccess = () => {
          db.close();
          resolve(all.result);
        };
        all.onerror = () => {
          db.close();
          reject(all.error);
        };
      };
    });
  });
}

async function clearQueue(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lanflow_sync_db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction('sync_queue', 'readwrite');
        tx.objectStore('sync_queue').clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  });
}

async function createBillOnline(page: Page, marker: string) {
  const phone = process.env.TEST_PHONE || '0800000000';
  const password = process.env.TEST_PASSWORD || 'password123';
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/login');
  await page.fill('input[type="tel"]', phone);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("เข้าสู่ระบบ")');
  await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });

  await page.click('button:has-text("บิลยาง")');
  await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible();

  await page.click('button:has-text("เพิ่มบิลยาง")');
  await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeVisible();
  
  const customerInput = page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]');
  await customerInput.fill(marker);
  await page.keyboard.press('Escape');

  const modal = page.locator('.fixed.inset-0').last();
  const weighRow = modal.locator('table').first().locator('tbody tr').first();
  await weighRow.locator('input[type="number"]').nth(0).fill('1000');
  await weighRow.locator('input[type="number"]').nth(1).fill('200');
  await weighRow.locator('input[type="number"]').nth(3).fill('25.5');

  await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();
  await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });
  const row = page.locator('table tbody tr', { hasText: marker }).first();
  await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });
}

async function createSyncedBillFromAuthenticatedApp(page: Page, marker: string) {
  await page.click('button:has-text("บิลยาง")');
  await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible();
  await waitForRubberApprovalSettings(page);
  await page.click('button:has-text("เพิ่มบิลยาง")');

  const modal = page.locator('.fixed.inset-0').last();
  await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(marker);
  await page.keyboard.press('Escape');
  const weighRow = modal.locator('table').first().locator('tbody tr').first();
  await weighRow.locator('input[type="number"]').nth(0).fill('1000');
  await weighRow.locator('input[type="number"]').nth(1).fill('200');
  await weighRow.locator('input[type="number"]').nth(3).fill('25.5');
  await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();
  await expect(modal).toBeHidden({ timeout: 20000 });

  const row = page.locator('table tbody tr', { hasText: marker }).first();
  await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });
  return row;
}

async function waitForRubberApprovalSettings(page: Page) {
  await page.getByRole('button', { name: /^ตั้งค่าและอนุมัติบิลยาง/ }).click();
  const modal = page.locator('.fixed.inset-0').last();
  await expect(modal.getByLabel('เวลาแก้ไขได้ (นาที)')).toHaveValue('30');
  await modal.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(modal).toBeHidden();
}

async function cleanupRubberBillByCustomerName(page: Page, customerName: string) {
  const response = await page.request.get(
    `${localSupabaseUrl}/rest/v1/rubber_bills?customer_name=eq.${encodeURIComponent(customerName)}&select=client_temp_id,revision_no,location_id,record_status`,
    {
      headers: {
        apikey: localServiceRoleKey,
        Authorization: `Bearer ${localServiceRoleKey}`,
      },
    }
  );
  if (!response.ok()) return;
  const rows = await response.json() as Array<{
    client_temp_id: string;
    revision_no: number;
    location_id: string;
    record_status: string;
  }>;
  const row = rows.find((candidate) => candidate.record_status === 'active');
  if (!row) return;
  await page.request.post('/api/lanflow/rubber-bills', {
    data: {
      operation: 'delete',
      clientTempId: row.client_temp_id,
      idempotencyKey: `delete:${row.client_temp_id}:${row.revision_no}`,
      expectedRevisionNo: row.revision_no,
      recordStatus: 'deleted',
      locationId: row.location_id,
    },
  });
}

test.describe('Rubber Bills Full Offline Sync @rubber-bills-entry', () => {
  const marker = `E2E-${Date.now()}`;
  const phone = process.env.TEST_PHONE || '0800000000';
  const password = process.env.TEST_PASSWORD || 'password123';
  
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
    await clearQueue(page);
  });

  test.describe('queue-first online network failure', () => {
    test.describe.configure({ timeout: 90000 });
    test.use({ storageState: 'playwright/.auth/super_admin.json' });

    test('keeps an online create in the pending queue when the request fails', async ({ page }) => {
      test.setTimeout(60000);
      const networkFailureMarker = `E2E-NETWORK-FAIL-${Date.now()}`;
      const dialogMessages: string[] = [];
      page.on('dialog', dialog => {
        dialogMessages.push(dialog.message());
        void dialog.accept();
      });

      await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
      await page.click('button:has-text("บิลยาง")');
      await waitForRubberApprovalSettings(page);
      await page.click('button:has-text("เพิ่มบิลยาง")');

      let interceptedPost = false;
      await page.route('**/api/lanflow/rubber-bills', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        await route.abort('failed');
        interceptedPost = true;
      });

      const modal = page.locator('.fixed.inset-0').last();
      await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(networkFailureMarker);
      await page.keyboard.press('Escape');
      const weighRow = modal.locator('table').first().locator('tbody tr').first();
      await weighRow.locator('input[type="number"]').nth(0).fill('1000');
      await weighRow.locator('input[type="number"]').nth(1).fill('200');
      await weighRow.locator('input[type="number"]').nth(3).fill('25.5');
      expect(await page.evaluate(() => navigator.onLine)).toBe(true);
      await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();

      await expect.poll(() => interceptedPost || dialogMessages.length > 0).toBe(true);
      expect(dialogMessages).toEqual([]);
      expect(await page.evaluate(() => navigator.onLine)).toBe(true);
      const queueAfterFailure = await readQueue(page);
      expect(queueAfterFailure.some((event) =>
        event.entity === 'rubber_bills'
        && event.operation === 'create'
        && event.status === 'pending'
        && event.payload?.customerName === networkFailureMarker
      )).toBe(true);
    });

    test('keeps an online create pending when the API returns a transient 503', async ({ page }) => {
      test.setTimeout(60000);
      const transientMarker = `E2E-503-PENDING-${Date.now()}`;
      page.on('dialog', dialog => void dialog.accept());

      await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
      await page.click('button:has-text("บิลยาง")');
      await waitForRubberApprovalSettings(page);
      await page.click('button:has-text("เพิ่มบิลยาง")');

      await page.route('**/api/lanflow/rubber-bills', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ errorMessage: 'temporary outage' }),
        });
      });

      const modal = page.locator('.fixed.inset-0').last();
      await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(transientMarker);
      await page.keyboard.press('Escape');
      const weighRow = modal.locator('table').first().locator('tbody tr').first();
      await weighRow.locator('input[type="number"]').nth(0).fill('1000');
      await weighRow.locator('input[type="number"]').nth(1).fill('200');
      await weighRow.locator('input[type="number"]').nth(3).fill('25.5');
      await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();

      await expect(modal).toBeHidden();
      const queueAfterFailure = await readQueue(page);
      expect(queueAfterFailure.some((event) =>
        event.entity === 'rubber_bills'
        && event.operation === 'create'
        && event.status === 'pending'
        && event.payload?.customerName === transientMarker
      )).toBe(true);
    });

    test('keeps an online update in the pending queue when the request fails', async ({ page }) => {
      test.setTimeout(90000);
      const networkFailureMarker = `E2E-UPDATE-FAIL-${Date.now()}`;
      page.on('dialog', dialog => dialog.accept());

      try {
        const row = await createSyncedBillFromAuthenticatedApp(page, networkFailureMarker);
        await row.getByRole('button', { name: 'แก้ไข', exact: true }).click();
        const modal = page.locator('.fixed.inset-0').last();
        const weighRow = modal.locator('table').first().locator('tbody tr').first();
        await weighRow.locator('input[type="number"]').nth(3).fill('26');

        let postAttempts = 0;
        await page.route('**/api/lanflow/rubber-bills', async (route) => {
          if (route.request().method() !== 'POST') {
            await route.continue();
            return;
          }
          postAttempts += 1;
          await route.abort('failed');
        });

        await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();
        await expect.poll(() => postAttempts).toBeGreaterThan(0);
        await expect(modal).toBeHidden();
        await expect(row.locator('span:has-text("รอซิงก์")')).toBeVisible();
        const queueAfterFailure = await readQueue(page);
        expect(queueAfterFailure.some((event) =>
          event.entity === 'rubber_bills'
          && event.operation === 'update'
          && event.status === 'pending'
          && event.payload?.customerName === networkFailureMarker
        )).toBe(true);
      } finally {
        await page.unroute('**/api/lanflow/rubber-bills');
        await cleanupRubberBillByCustomerName(page, networkFailureMarker);
      }
    });

    test('keeps an online delete in the pending queue when the request fails', async ({ page }) => {
      test.setTimeout(90000);
      const networkFailureMarker = `E2E-DELETE-FAIL-${Date.now()}`;
      page.on('dialog', dialog => dialog.accept());

      try {
        const row = await createSyncedBillFromAuthenticatedApp(page, networkFailureMarker);
        let postAttempts = 0;
        await page.route('**/api/lanflow/rubber-bills', async (route) => {
          if (route.request().method() !== 'POST') {
            await route.continue();
            return;
          }
          postAttempts += 1;
          await route.abort('failed');
        });

        await row.getByRole('button', { name: 'ลบ', exact: true }).click();
        await expect.poll(() => postAttempts).toBeGreaterThan(0);
        const queueAfterFailure = await readQueue(page);
        expect(queueAfterFailure.some((event) =>
          event.entity === 'rubber_bills'
          && event.operation === 'delete'
          && event.status === 'pending'
          && event.payload?.customerName === networkFailureMarker
        )).toBe(true);
      } finally {
        await page.unroute('**/api/lanflow/rubber-bills');
        await cleanupRubberBillByCustomerName(page, networkFailureMarker);
      }
    });

    test('replays exactly once when the server commits but the response is lost', async ({ page }) => {
      test.setTimeout(90000);
      const responseLossMarker = `E2E-RESPONSE-LOSS-${Date.now()}`;
      page.on('dialog', dialog => dialog.accept());

      try {
        await page.click('button:has-text("บิลยาง")');
        await waitForRubberApprovalSettings(page);
        await page.click('button:has-text("เพิ่มบิลยาง")');

        let postAttempts = 0;
        let committedStatus = 0;
        await page.route('**/api/lanflow/rubber-bills', async (route) => {
          if (route.request().method() !== 'POST') {
            await route.continue();
            return;
          }
          postAttempts += 1;
          if (postAttempts === 1) {
            const committedResponse = await route.fetch();
            committedStatus = committedResponse.status();
            await route.abort('failed');
            return;
          }
          await route.continue();
        });

        const modal = page.locator('.fixed.inset-0').last();
        await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(responseLossMarker);
        await page.keyboard.press('Escape');
        const weighRow = modal.locator('table').first().locator('tbody tr').first();
        await weighRow.locator('input[type="number"]').nth(0).fill('1000');
        await weighRow.locator('input[type="number"]').nth(1).fill('200');
        await weighRow.locator('input[type="number"]').nth(3).fill('25.5');
        await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();

        await expect.poll(() => committedStatus).toBe(200);
        await expect.poll(() => postAttempts).toBeGreaterThanOrEqual(2);
        await expect(modal).toBeHidden();
        await expect.poll(async () => {
          const queue = await readQueue(page);
          return queue.some((event) => event.payload?.customerName === responseLossMarker);
        }).toBe(false);

        const response = await page.request.get(
          `${localSupabaseUrl}/rest/v1/rubber_bills?customer_name=eq.${encodeURIComponent(responseLossMarker)}&select=id,record_status`,
          {
            headers: {
              apikey: localServiceRoleKey,
              Authorization: `Bearer ${localServiceRoleKey}`,
            },
          }
        );
        expect(response.ok()).toBe(true);
        const rows = await response.json() as Array<{ id: string; record_status: string }>;
        expect(rows.filter((row) => row.record_status === 'active')).toHaveLength(1);
      } finally {
        await page.unroute('**/api/lanflow/rubber-bills');
        await cleanupRubberBillByCustomerName(page, responseLossMarker);
      }
    });
  });

  test('should support create, edit, delete offline and sync when online', async ({ page, context }) => {
    test.setTimeout(90000);

    // 1. Login
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    const meResponse = await page.request.get('/api/auth/me');
    expect(meResponse.ok()).toBeTruthy();
    const payerName = (await meResponse.json() as { profile: { name: string } }).profile.name;

    // 2. Go to Rubber Bills tab
    await page.click('button:has-text("บิลยาง")');
    await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible();

    // 3. Go Offline
    await context.setOffline(true);

    // === STEP 1: CREATE bill offline ===
    await page.click('button:has-text("เพิ่มบิลยาง")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeVisible();
    
    const customerInput = page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]');
    await customerInput.fill(marker);
    await page.keyboard.press('Escape');

    const modal = page.locator('.fixed.inset-0').last();
    const weighRow = modal.locator('table').first().locator('tbody tr').first();
    const inWeightInput = weighRow.locator('input[type="number"]').nth(0);
    await expect(inWeightInput).toHaveValue('0');
    await inWeightInput.focus();
    await expect(inWeightInput).toHaveValue('');
    await inWeightInput.blur();
    await expect(inWeightInput).toHaveValue('0');
    await weighRow.locator('input[type="number"]').nth(0).fill('1000');
    await weighRow.locator('input[type="number"]').nth(1).fill('200');
    await weighRow.locator('input[type="number"]').nth(3).fill('19.5');

    await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    // Assert: UI shows "รอซิงก์" (pending)
    const createdRow = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(createdRow).toBeVisible({ timeout: 5000 });
    await expect(createdRow.locator('span:has-text("รอซิงก์")')).toBeVisible();
    await expect(createdRow.locator('td').nth(5)).toHaveText(payerName);

    // Assert: IDB queue has the create event with correct payload shape
    const queueAfterCreate = await readQueue(page);
    const createEvent = queueAfterCreate.find(
      e => e.operation === 'create' && e.payload?.customerName === marker
    );
    expect(createEvent).toBeDefined();
    // payload uses items[] with unitPrice, not weighItems[].price
    expect(createEvent.payload.items).toBeDefined();
    const weighItem = createEvent.payload.items.find((i: any) => i.itemType === 'weigh');
    expect(weighItem.unitPrice).toBe(19.5);
    expect(createEvent.payload.configuredPriceSnapshot).toBeNull();
    const clientTempId = createEvent.id;

    // === STEP 2: EDIT the pending bill offline ===
    const editAction = createdRow.locator('button[title="แก้ไข"]');
    const deleteAction = createdRow.locator('button[title="ลบ"]');
    await expect(editAction).toHaveAttribute('aria-label', 'แก้ไข');
    await expect(deleteAction).toHaveAttribute('aria-label', 'ลบ');
    await expect(editAction).toHaveText('แก้');
    await expect(deleteAction).toHaveText('ลบ');
    await editAction.click();
    await expect(page.locator('h2:has-text("แก้ไขบิลเครื่องชั่งเล็ก")')).toBeVisible();
    
    const editModal = page.locator('.fixed.inset-0').last();
    const editWeighRow = editModal.locator('table').first().locator('tbody tr').first();
    await editWeighRow.locator('input[type="number"]').nth(3).fill('19.75');
    await editModal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();
    await expect(page.locator('h2:has-text("แก้ไขบิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });
    await expect(createdRow.locator('td').nth(5)).toHaveText(payerName);

    // Assert: edit coalesced into existing create (not a second event)
    const queueAfterEdit = await readQueue(page);
    const editEvents = queueAfterEdit.filter(e => e.id === clientTempId);
    expect(editEvents.length).toBe(1);
    expect(editEvents[0].operation).toBe('create'); // still "create", payload updated
    expect(editEvents[0].payload.items.find((i: any) => i.itemType === 'weigh').unitPrice).toBe(19.75);
    expect(editEvents[0].payload.configuredPriceSnapshot).toBeNull();

    // === STEP 3: CREATE second bill, then DELETE (test coalesce: create+delete = no-op) ===
    const markerDelete = `${marker}-DEL`;
    await page.click('button:has-text("เพิ่มบิลยาง")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeVisible();
    await page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(markerDelete);
    await page.keyboard.press('Escape');
    const deleteModal = page.locator('.fixed.inset-0').last();
    const deleteWeighRow = deleteModal.locator('table').first().locator('tbody tr').first();
    await deleteWeighRow.locator('input[type="number"]').nth(0).fill('500');
    await deleteWeighRow.locator('input[type="number"]').nth(1).fill('100');
    await deleteWeighRow.locator('input[type="number"]').nth(3).fill('18.5');
    await deleteModal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    const deleteRow = page.locator('table tbody tr', { hasText: markerDelete }).first();
    await expect(deleteRow).toBeVisible({ timeout: 5000 });

    // Delete the second bill — should coalesce with its pending create
    await deleteRow.getByRole('button', { name: 'ลบ', exact: true }).click();
    await expect(deleteRow).toBeHidden({ timeout: 5000 });

    // Assert: coalesce removed both create and delete events for second bill
    const queueAfterDelete = await readQueue(page);
    const deletedBillEvents = queueAfterDelete.filter(
      e => e.payload?.customerName === markerDelete
    );
    expect(deletedBillEvents.length).toBe(0);
    // First bill's create event should still be in queue
    expect(queueAfterDelete.find(e => e.id === clientTempId)).toBeDefined();

    // === STEP 4: RELOAD page (go online briefly for dev server, then offline) ===
    // This proves IDB queue survives page reload
    await context.setOffline(false);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 15000 });
    // The sync may have fired during reload — that's OK
    // Go to Rubber Bills tab
    await page.click('button:has-text("บิลยาง")');

    // The bill should be visible (either synced or still pending)
    const reloadedRow = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(reloadedRow).toBeVisible({ timeout: 10000 });

    // === STEP 5: Verify sync completed (if not, go online to trigger it) ===
    await context.setOffline(false);
    // Wait for sync to complete: "รอซิงก์" should disappear
    await expect(reloadedRow.locator('span:has-text("รอซิงก์")')).toBeHidden({ timeout: 20000 });
    
    // Queue should be empty after sync
    const queueAfterSync = await readQueue(page);
    expect(queueAfterSync.filter(e => e.id === clientTempId && e.status === 'pending').length).toBe(0);

    // UI should show "ซิงก์แล้ว" with a real serverBillNo
    await expect(reloadedRow.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 5000 });
    const billNoCell = reloadedRow.locator('td').nth(1);
    const billNoText = await billNoCell.innerText();
    expect(billNoText).not.toContain('TEMP-');

    // === STEP 6: IDEMPOTENCY REPLAY — send same payload, must NOT create duplicate ===
    const replayPayload = editEvents[0].payload;

    // Capture pre-replay revisionNo from first sync
    const firstSyncRes = await page.request.post('/api/lanflow/rubber-bills', {
      data: replayPayload
    });
    expect(firstSyncRes.ok()).toBeTruthy();
    const replayData = await firstSyncRes.json();
    expect(replayData.serverBillNo).toBeDefined();
    expect(replayData.status).toBe('synced');
    const revisionAfterReplay = replayData.revisionNo;

    // Send the SAME payload again (second replay)
    const secondReplayRes = await page.request.post('/api/lanflow/rubber-bills', {
      data: replayPayload
    });
    expect(secondReplayRes.ok()).toBeTruthy();
    const secondReplayData = await secondReplayRes.json();
    // Idempotent: same serverBillNo, same revisionNo, status 'synced'
    expect(secondReplayData.status).toBe('synced');
    expect(secondReplayData.serverBillNo).toBe(replayData.serverBillNo);
    expect(secondReplayData.revisionNo).toBe(revisionAfterReplay);

    // DB-level check: query Supabase REST API with service_role key (bypasses RLS)
    // This ensures no duplicate regardless of UI pagination/filter
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const dbCheckRes = await page.request.fetch(
      `${supabaseUrl}/rest/v1/rubber_bills?client_temp_id=eq.${clientTempId}&select=id,revision_no,server_bill_no`,
      {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
        }
      }
    );
    expect(dbCheckRes.ok()).toBeTruthy();
    const dbRows = await dbCheckRes.json();
    // Exactly 1 row — no duplicates
    expect(dbRows.length).toBe(1);
    expect(dbRows[0].revision_no).toBe(revisionAfterReplay);
    expect(dbRows[0].server_bill_no).toBe(replayData.serverBillNo);

    // === CLEANUP — soft delete the test bill ===
    const cleanupPayload = {
      ...replayPayload,
      operation: 'delete',
      recordStatus: 'deleted',
      expectedRevisionNo: replayData.revisionNo ?? 1,
      idempotencyKey: `delete:${clientTempId}:${replayData.revisionNo ?? 1}`
    };
    await page.request.post('/api/lanflow/rubber-bills', { data: cleanupPayload });
  });

  // NOTE: Full offline reload (PWA/SW) test lives in rubber-bills-pwa.spec.ts
  // Run with: npx playwright test --project=chromium-pwa

  test('should block editing and deleting a synced bill while offline', async ({ page, context }) => {
    const marker = `SyncedOffline-${Date.now()}`;
    await createBillOnline(page, marker);

    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await context.setOffline(true);

    const blockMessage = 'รายการนี้ซิงก์แล้ว ต้องออนไลน์เพื่อแก้ไขหรือลบ';
    const deleteButton = row.locator('button').nth(1);
    const editButton = row.locator('button').nth(2);

    await expect(editButton).toBeDisabled();
    await expect(deleteButton).toBeDisabled();
    await expect(editButton).toHaveAttribute('title', blockMessage);
    await expect(deleteButton).toHaveAttribute('title', blockMessage);
    await expect(editButton).toHaveAttribute('aria-label', blockMessage);
    await expect(deleteButton).toHaveAttribute('aria-label', blockMessage);
    await expect(readQueue(page)).resolves.toHaveLength(0);
  });

  test('offline stock deduction cannot be added to the sync queue', async ({ page, context }) => {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    await page.click('button:has-text("บิลยาง")');
    await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible();

    await context.setOffline(true);
    await page.click('button:has-text("เพิ่มบิลยาง")');
    const modal = page.locator('.fixed.inset-0').last();
    await expect(modal.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeVisible();
    const queueBefore = await readQueue(page);
    const offlineStockButton = modal.getByRole('button', { name: 'กดได้เมื่อออนไลน์' });
    await expect(offlineStockButton).toHaveAttribute('aria-disabled', 'true');

    await offlineStockButton.evaluate((button) => (button as HTMLButtonElement).click());
    await expect(page.getByText('หักสินค้าใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสต็อกก่อน')).toBeVisible();
    await expect(
      modal.locator('section', { hasText: 'หักสินค้า' }).locator('tbody tr')
    ).toHaveCount(0);
    expect(await readQueue(page)).toEqual(queueBefore);
  });

  test('online approval requests never enter sync_queue', async ({ page }) => {
    const marker = `ApprovalNoQueue-${Date.now()}`;
    const settingsUrl = `${localSupabaseUrl}/rest/v1/rubber_bill_approval_settings?id=eq.true`;
    const serviceHeaders = {
      apikey: localServiceRoleKey,
      Authorization: `Bearer ${localServiceRoleKey}`,
      Prefer: 'return=minimal',
    };
    expect((await page.request.patch(settingsUrl, {
      headers: serviceHeaders,
      data: { edit_window_minutes: 30, configured_price: 0 },
    })).ok()).toBeTruthy();

    let requestId: string | undefined;
    try {
      page.on('dialog', dialog => dialog.accept());
      await page.goto('/login');
      await page.fill('input[type="tel"]', phone);
      await page.fill('input[type="password"]', password);
      await page.click('button:has-text("เข้าสู่ระบบ")');
      await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
      await page.click('button:has-text("บิลยาง")');
      await page.click('button:has-text("เพิ่มบิลยาง")');
      await expect(page.getByText('ราคาที่กำหนด 0.00 บาท')).toBeVisible({ timeout: 15000 });

      const modal = page.locator('.fixed.inset-0').last();
      await modal.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(marker);
      await page.keyboard.press('Escape');
      const weighRow = modal.locator('table').first().locator('tbody tr').first();
      await weighRow.locator('input[type="number"]').nth(0).fill('100');
      await weighRow.locator('input[type="number"]').nth(1).fill('20');
      await weighRow.locator('input[type="number"]').nth(3).fill('1');
      await modal.getByRole('button', { name: 'บันทึกบิล', exact: true }).click();
      await expect(modal).toBeHidden({ timeout: 10000 });

      const pendingRow = page.locator('table tbody tr', { hasText: marker }).first();
      await expect(pendingRow).toContainText('รออนุมัติสร้างบิล', { timeout: 15000 });
      expect((await readQueue(page)).some((event) => event.payload?.customerName === marker)).toBe(false);

      const requestsResponse = await page.request.get(
        `${localSupabaseUrl}/rest/v1/rubber_bill_approval_requests?select=id,proposed_payload&request_status=eq.pending`,
        { headers: serviceHeaders }
      );
      expect(requestsResponse.ok()).toBeTruthy();
      const requests = await requestsResponse.json() as Array<{
        id: string;
        proposed_payload?: { customerName?: string };
      }>;
      requestId = requests.find((request) => request.proposed_payload?.customerName === marker)?.id;
      expect(requestId).toBeTruthy();
    } finally {
      if (requestId) {
        await page.request.delete(`/api/lanflow/rubber-bills/approval-requests/${requestId}`);
      }
      await page.request.patch(settingsUrl, {
        headers: serviceHeaders,
        data: { edit_window_minutes: 30, configured_price: null },
      });
    }
  });

  test('hook delete guard rejects a synced bill offline before queue work', () => {
    expect(() => assertRubberBillDeleteAllowed(0, false)).toThrow(
      'รายการนี้ซิงก์แล้ว ต้องออนไลน์เพื่อแก้ไขหรือลบ'
    );
    expect(() => assertRubberBillDeleteAllowed(1, false)).not.toThrow();
  });

  test('legacy create + delete in IDB should be no-op after normalizer', async ({ page, context }) => {
    test.setTimeout(60000);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    // 1. Login online
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/login');
    await page.fill('input[type="tel"]', '0800000000');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    await page.click('button:has-text("บิลยาง")');
    await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible();

    // 2. Get locationId from the logged-in user's profile
    const locationId = await selectedAppLocationId(page);
    expect(locationId).toBeDefined();

    // 3. Go offline
    await context.setOffline(true);

    // 4. Seed IDB with create + delete for a fresh clientTempId
    const marker = `LegacyCD-${Date.now()}`;
    const freshId = await page.evaluate(async ({ locationId, marker, ownerUserId }) => {
      const clientTempId = crypto.randomUUID();
      const now = new Date().toISOString();

      const basePayload = {
        operation: 'create',
        expectedRevisionNo: 0,
        clientTempId,
        idempotencyKey: `create:${clientTempId}:0`,
        locationId,
        recordStatus: 'active',
        localBillNo: `TEMP-${clientTempId.slice(0, 8)}`,
        billDate: bangkokDateString(new Date(now)),
        customerName: marker,
        configuredPriceSnapshot: null,
        weight: 800,
        rubberValue: 20400,
        averagePrice: 25.5,
        deductionTotal: 0,
        netTotal: 20400,
        acidPackCount: 0,
        clientRecordedAt: now,
        clientCreatedAt: now,
        items: [{
          itemType: 'weigh',
          title: 'ชั่ง',
          description: 'ชั่ง',
          inWeight: 1000,
          outWeight: 200,
          netWeight: 800,
          unitPrice: 25.5,
          totalAmount: 20400,
          sequenceNo: 1
        }]
      };

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('lanflow_sync_db');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');

      // Add create event
      store.add({
        id: clientTempId,
        entity: 'rubber_bills',
        ownerUserId,
        locationId,
        operation: 'create',
        payload: basePayload,
        timestamp: Date.now(),
        status: 'pending'
      });

      // Add delete event
      store.add({
        id: clientTempId,
        entity: 'rubber_bills',
        ownerUserId,
        locationId,
        operation: 'delete',
        payload: {
          ...basePayload,
          operation: 'delete',
          recordStatus: 'deleted',
          idempotencyKey: `delete:${clientTempId}:0`,
        },
        timestamp: Date.now() + 1,
        status: 'pending'
      });

      await new Promise(resolve => { tx.oncomplete = resolve; });
      db.close();
      return clientTempId;
    }, { locationId, marker, ownerUserId: testUserId });

    // 5. Go online → normalizer fires → create+delete = no-op
    await context.setOffline(false);

    // 6. Assert: queue is empty for this clientTempId
    await expect.poll(async () => {
      const q = await readQueue(page);
      return q.filter(e => e.id === freshId).length;
    }, { timeout: 15000 }).toBe(0);

    // 7. Assert: DB has no row for this clientTempId
    const dbCheck = await page.request.fetch(
      `${supabaseUrl}/rest/v1/rubber_bills?client_temp_id=eq.${freshId}&select=id`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheck.json();
    expect(dbRows.length).toBe(0);
  });

  test('legacy create + update in IDB should sync as single create with latest payload', async ({ page, context }) => {
    test.setTimeout(60000);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    // 1. Login online
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/login');
    await page.fill('input[type="tel"]', '0800000000');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    await page.click('button:has-text("บิลยาง")');
    await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible();

    // 2. Get locationId from the logged-in user's profile
    const locationId = await selectedAppLocationId(page);
    expect(locationId).toBeDefined();

    // 3. Go offline
    await context.setOffline(true);

    const marker = `LegacyCU-${Date.now()}`;
    // 4. Seed IDB with create + update for a fresh clientTempId
    const freshId = await page.evaluate(async ({ locationId, marker, ownerUserId }) => {
      const clientTempId = crypto.randomUUID();
      const now = new Date().toISOString();

      const createPayload = {
        operation: 'create',
        expectedRevisionNo: 0,
        clientTempId,
        idempotencyKey: `create:${clientTempId}:0`,
        locationId,
        recordStatus: 'active',
        localBillNo: `TEMP-${clientTempId.slice(0, 8)}`,
        billDate: bangkokDateString(new Date(now)),
        customerName: marker,
        configuredPriceSnapshot: null,
        weight: 800,
        rubberValue: 20400,
        averagePrice: 25.5,
        deductionTotal: 0,
        netTotal: 20400,
        acidPackCount: 0,
        clientRecordedAt: now,
        clientCreatedAt: now,
        items: [{
          itemType: 'weigh',
          title: 'ชั่ง',
          description: 'ชั่ง',
          inWeight: 1000,
          outWeight: 200,
          netWeight: 800,
          unitPrice: 25.5,
          totalAmount: 20400,
          sequenceNo: 1
        }]
      };

      const updatePayload = {
        ...createPayload,
        operation: 'update',
        expectedRevisionNo: 1,
        idempotencyKey: `update:${clientTempId}:1`,
        customerName: `${marker}-Updated`,
        weight: 900,
        rubberValue: 22950,
        netTotal: 22950,
        items: [{
          itemType: 'weigh',
          title: 'ชั่ง',
          description: 'ชั่ง',
          inWeight: 1100,
          outWeight: 200,
          netWeight: 900,
          unitPrice: 25.5,
          totalAmount: 22950,
          sequenceNo: 1
        }]
      };

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('lanflow_sync_db');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');

      // Add create event
      store.add({
        id: clientTempId,
        entity: 'rubber_bills',
        ownerUserId,
        locationId,
        operation: 'create',
        payload: createPayload,
        timestamp: Date.now(),
        status: 'pending'
      });

      // Add update event
      store.add({
        id: clientTempId,
        entity: 'rubber_bills',
        ownerUserId,
        locationId,
        operation: 'update',
        payload: updatePayload,
        timestamp: Date.now() + 1,
        status: 'pending'
      });

      await new Promise(resolve => { tx.oncomplete = resolve; });
      db.close();
      return clientTempId;
    }, { locationId, marker, ownerUserId: testUserId });

    // 5. Go online → normalizer coalesces create+update → single create with latest payload → sync
    await context.setOffline(false);

    // 6. Assert: queue is empty (sync succeeded)
    await expect.poll(async () => {
      const q = await readQueue(page);
      return q.filter(e => e.id === freshId).length;
    }, { timeout: 15000 }).toBe(0);

    // 7. Assert: DB has exactly 1 row with latest customer name
    await expect.poll(async () => {
      const res = await page.request.fetch(
        `${supabaseUrl}/rest/v1/rubber_bills?client_temp_id=eq.${freshId}&select=customer_name`,
        { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
      );
      const rows = await res.json();
      return rows.length;
    }, { timeout: 15000 }).toBe(1);

    const dbCheck = await page.request.fetch(
      `${supabaseUrl}/rest/v1/rubber_bills?client_temp_id=eq.${freshId}&select=customer_name,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheck.json();
    expect(dbRows[0].customer_name).toBe(`${marker}-Updated`);

    // Cleanup — assert it succeeds to avoid stale test data
    const cleanupRes = await page.request.post('/api/lanflow/rubber-bills', {
      data: {
        operation: 'delete',
        clientTempId: freshId,
        expectedRevisionNo: dbRows[0].revision_no,
        idempotencyKey: `delete:${freshId}:${dbRows[0].revision_no}`,
        locationId,
        recordStatus: 'deleted',
        localBillNo: `TEMP-${freshId.slice(0, 8)}`,
        billDate: bangkokDateString(),
        customerName: `${marker}-Updated`,
        configuredPriceSnapshot: null,
        weight: 900,
        rubberValue: 22950,
        averagePrice: 25.5,
        deductionTotal: 0,
        netTotal: 22950,
        acidPackCount: 0,
        clientRecordedAt: new Date().toISOString(),
        clientCreatedAt: new Date().toISOString(),
        items: []
      }
    });
    expect(cleanupRes.ok()).toBeTruthy();
  });
});
