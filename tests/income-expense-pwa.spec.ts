import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

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

const phone = process.env.TEST_PHONE || '0800000000';
const password = process.env.TEST_PASSWORD || 'password123';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const testUserId = process.env.TEST_USER_ID || '00000000-0000-4000-8000-000000000001';

function normalizeThaiPhoneToE164(rawPhone: string) {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.startsWith('0')) return `+66${digits.slice(1)}`;
  if (digits.startsWith('66')) return `+${digits}`;
  if (rawPhone.startsWith('+')) return rawPhone;
  return `+${digits}`;
}

async function ensureTestUser() {
  expect(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required for E2E setup').toBeTruthy();

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const phoneE164 = normalizeThaiPhoneToE164(phone);

  const existing = await admin.auth.admin.getUserById(testUserId);
  if (existing.data.user) {
    const { error } = await admin.auth.admin.updateUserById(testUserId, {
      phone: phoneE164,
      password,
      phone_confirm: true,
      user_metadata: { name: 'LanFlow E2E' },
      app_metadata: { lanflow_role: 'super_admin' },
    });
    if (error) throw error;
  } else {
    const { error } = await admin.auth.admin.createUser({
      id: testUserId,
      phone: phoneE164,
      password,
      phone_confirm: true,
      user_metadata: { name: 'LanFlow E2E' },
      app_metadata: { lanflow_role: 'super_admin' },
    });
    if (error) throw error;
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: testUserId,
    phone,
    name: 'LanFlow E2E',
    role: 'super_admin',
    is_active: true,
    password_hash: null,
  }, { onConflict: 'id' });
  if (profileError) throw profileError;

  const { data: locations, error: locationError } = await admin
    .from('locations')
    .select('id')
    .eq('is_active', true)
    .limit(1);
  if (locationError) throw locationError;
  if (!locations?.[0]?.id) throw new Error('No active location available for E2E user');

  const { error: assignmentError } = await admin.from('user_locations').upsert({
    user_id: testUserId,
    location_id: locations[0].id,
    assigned_by: testUserId,
    is_primary: true,
  }, { onConflict: 'user_id,location_id' });
  if (assignmentError) throw assignmentError;
}

async function cleanupIncomeExpense(page: Page, payload: any, clientTempId: string, revisionNo: number) {
  const cleanupRes = await page.request.post('/api/lanflow/income-expense', {
    data: {
      ...payload,
      operation: 'delete',
      recordStatus: 'deleted',
      expectedRevisionNo: revisionNo,
      idempotencyKey: `delete:${clientTempId}:${revisionNo}`,
    }
  });
  expect(cleanupRes.ok()).toBeTruthy();

  await expect.poll(async () => {
    const res = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${clientTempId}&select=record_status`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const rows = await res.json();
    return rows[0]?.record_status;
  }, { timeout: 15000 }).toBe('deleted');
}

test.use({ baseURL: 'http://127.0.0.1:3001' });

test.describe('Income/Expense PWA Offline Reload', () => {
  test.beforeAll(async () => {
    await ensureTestUser();
  });

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

  test('keeps income/expense pending row visible after offline reload and syncs on reconnect', async ({ page, context }) => {
    test.setTimeout(120000);
    page.on('dialog', dialog => dialog.accept());

    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });

    await page.click('button:has-text("รับ-จ่าย")');
    await expect(page.locator('button:has-text("เพิ่มรายรับ")')).toBeVisible({ timeout: 10000 });

    await expect.poll(async () => {
      return page.evaluate(async () => !!navigator.serviceWorker?.controller);
    }, {
      message: 'Service worker not controlling the page yet',
      timeout: 10000,
    }).toBe(true);

    await context.setOffline(true);

    const marker = `PWA-IE-${Date.now()}`;
    await page.click('button:has-text("เพิ่มรายรับ")');
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();
    const modal = page.locator('.fixed.inset-0').last();
    await modal.locator('table tbody tr').first().locator('input').first().fill(marker);
    await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('1700');
    await modal.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('span:has-text("รอซิงก์")')).toBeVisible();

    const queueBeforeReload = await readQueue(page);
    const eventBeforeReload = queueBeforeReload.find(e => e.entity === 'income_expense' && e.payload?.title === marker);
    expect(eventBeforeReload).toBeDefined();
    expect(eventBeforeReload.operation).toBe('create');
    expect(eventBeforeReload.status).toBe('pending');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });

    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 15000 });
    await page.click('button:has-text("รับ-จ่าย")');
    await expect(page.locator('button:has-text("เพิ่มรายรับ")')).toBeVisible({ timeout: 10000 });

    const offlineReloadRow = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(offlineReloadRow).toBeVisible({ timeout: 10000 });
    await expect(offlineReloadRow.locator('span:has-text("รอซิงก์")')).toBeVisible();

    const queueAfterReload = await readQueue(page);
    const eventAfterReload = queueAfterReload.find(e => e.id === eventBeforeReload.id);
    expect(eventAfterReload).toBeDefined();
    expect(eventAfterReload.status).toBe('pending');

    await context.setOffline(false);
    await page.click('button:has-text("รับ-จ่าย")');
    const syncedRow = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(syncedRow).toBeVisible({ timeout: 10000 });
    await expect(syncedRow.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });

    const queueAfterSync = await readQueue(page);
    expect(queueAfterSync.filter(e => e.id === eventBeforeReload.id && e.status === 'pending').length).toBe(0);

    const dbCheck = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${eventBeforeReload.id}&select=revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheck.json();
    expect(dbRows.length).toBe(1);

    await cleanupIncomeExpense(page, eventBeforeReload.payload, eventBeforeReload.id, dbRows[0].revision_no);
  });
});
