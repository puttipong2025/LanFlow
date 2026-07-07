import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

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

async function loginAndGoToIncomeExpense(page: Page) {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/login');
  await page.fill('input[type="tel"]', phone);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("เข้าสู่ระบบ")');
  await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });

  // Navigate to income/expense tab
  await page.click('button:has-text("รับ-จ่าย")');
  await expect(page.locator('button:has-text("เพิ่มรายรับ")')).toBeVisible({ timeout: 10000 });
}

/** Create an income transaction online and wait for sync */
async function createIncomeOnline(page: Page, title: string, cost: number) {
  await page.click('button:has-text("เพิ่มรายรับ")');
  await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

  const modal = page.locator('.fixed.inset-0').last();
  // Fill title in the line item input
  const lineInput = modal.locator('table tbody tr').first().locator('input').first();
  await lineInput.fill(title);
  // Fill cost (the InlineNumber input for รายรับ)
  const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
  await costInput.fill(String(cost));

  await modal.locator('button:has-text("บันทึกบิล")').click();
  await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

  const row = page.locator('table tbody tr', { hasText: title }).first();
  await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });
  return row;
}

async function getPrimaryLocationId(page: Page) {
  const res = await page.request.get('/api/auth/me');
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  const locationId = data.profile?.locationIds?.[0];
  expect(locationId).toBeTruthy();
  return locationId as string;
}

async function buildIncomeExpensePayload(page: Page, overrides: Record<string, any> = {}) {
  const clientTempId = overrides.clientTempId ?? crypto.randomUUID();
  const txDate = overrides.txDate ?? new Date().toISOString().slice(0, 10);
  const type = overrides.type ?? 'income';
  const billOption = overrides.billOption ?? (type === 'expense' ? 'ค่าใช้จ่าย' : 'รายรับ');
  const revisionNo = overrides.expectedRevisionNo ?? 0;
  const operation = overrides.operation ?? 'create';
  const now = overrides.now ?? new Date().toISOString();

  return {
    operation,
    expectedRevisionNo: revisionNo,
    clientTempId,
    idempotencyKey: overrides.idempotencyKey ?? `${operation}:${clientTempId}:${revisionNo}`,
    locationId: overrides.locationId ?? await getPrimaryLocationId(page),
    recordStatus: operation === 'delete' ? 'deleted' : 'active',
    localBillNo: overrides.localBillNo ?? `LOCAL-${clientTempId.slice(0, 8)}`,
    txDate,
    type,
    title: overrides.title ?? `E2E-DIRECT-${Date.now()}`,
    cost: overrides.cost ?? 1000,
    billOption,
    unit: overrides.unit ?? null,
    price: overrides.price ?? null,
    clientRecordedAt: overrides.clientRecordedAt ?? now,
    clientCreatedAt: overrides.clientCreatedAt ?? now,
    deletedByName: overrides.deletedByName,
    deletedByPhone: overrides.deletedByPhone,
  };
}

async function enqueueIncomeExpenseEvent(page: Page, event: Record<string, any>) {
  await page.evaluate((queuedEvent) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lanflow_sync_db', 2);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sync_queue')) {
          const store = db.createObjectStore('sync_queue', { keyPath: 'queueId', autoIncrement: true });
          store.createIndex('entity', 'entity', { unique: false });
          store.createIndex('id', 'id', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('sync_queue', 'readwrite');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.objectStore('sync_queue').add(queuedEvent);
      };
    });
  }, event);
}

async function waitForQueueStatus(page: Page, clientTempId: string, status: 'failed' | 'conflict') {
  await expect.poll(async () => {
    const queue = await readQueue(page);
    return queue.find(e => e.id === clientTempId && e.entity === 'income_expense')?.status;
  }, { timeout: 15000 }).toBe(status);
}

async function fetchIncomeExpenseRows(page: Page, clientTempId: string, select = '*') {
  const res = await page.request.fetch(
    `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${clientTempId}&select=${select}`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
  );
  expect(res.ok()).toBeTruthy();
  return res.json();
}

function serverBillSuffix(serverBillNo: string) {
  return Number(serverBillNo.slice(-4));
}

test.describe('Income/Expense Offline Sync', () => {
  test.beforeAll(async () => {
    await ensureTestUser();
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

  test('offline create income, reconnect sync', async ({ page, context }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-INC-${Date.now()}`;

    // Go offline
    await context.setOffline(true);

    // Create income transaction
    await page.click('button:has-text("เพิ่มรายรับ")');
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

    const modal = page.locator('.fixed.inset-0').last();
    const lineInput = modal.locator('table tbody tr').first().locator('input').first();
    await lineInput.fill(marker);
    const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
    await costInput.fill('1500');

    await modal.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    // Assert: UI shows pending
    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.locator('span:has-text("รอซิงก์")')).toBeVisible();

    // Assert: IDB queue has the create event
    const queue = await readQueue(page);
    const createEvent = queue.find(e => e.entity === 'income_expense' && e.payload?.title === marker);
    expect(createEvent).toBeDefined();
    expect(createEvent.payload.operation).toBe('create');
    expect(createEvent.payload.cost).toBe(1500);
    const clientTempId = createEvent.id;

    // Go online
    await context.setOffline(false);
    await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });

    // Queue should be empty for this event
    const queueAfter = await readQueue(page);
    expect(queueAfter.filter(e => e.id === clientTempId && e.status === 'pending').length).toBe(0);

    // Cleanup
    const dbCheck = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${clientTempId}&select=id,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheck.json();
    if (dbRows.length > 0) {
      await cleanupIncomeExpense(page, createEvent.payload, clientTempId, dbRows[0].revision_no);
    }
  });

  test('offline create expense, reconnect sync', async ({ page, context }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-EXP-${Date.now()}`;

    await context.setOffline(true);

    // Create expense
    await page.click('button:has-text("เพิ่มรายจ่าย")');
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

    const modal = page.locator('.fixed.inset-0').last();
    const lineInput = modal.locator('table tbody tr').first().locator('input').first();
    await lineInput.fill(marker);
    const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
    await costInput.fill('2500');

    await modal.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.locator('span:has-text("รอซิงก์")')).toBeVisible();

    const queue = await readQueue(page);
    const createEvent = queue.find(e => e.entity === 'income_expense' && e.payload?.title === marker);
    expect(createEvent).toBeDefined();
    expect(createEvent.payload.type).toBe('expense');
    expect(createEvent.payload.billOption).toBe('ค่าใช้จ่าย');
    const clientTempId = createEvent.id;

    // Go online
    await context.setOffline(false);
    await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });

    // Cleanup
    const dbCheck = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${clientTempId}&select=id,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheck.json();
    if (dbRows.length > 0) {
      await cleanupIncomeExpense(page, createEvent.payload, clientTempId, dbRows[0].revision_no);
    }
  });

  test.skip('synced row → offline edit twice → coalesce to single update', async ({ page, context }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-EDIT2-${Date.now()}`;
    await createIncomeOnline(page, marker, 1000);

    // Get clientTempId and revision from DB
    const dbRes = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?title=eq.${marker}&select=client_temp_id,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbRes.json();
    const clientTempId = dbRows[0].client_temp_id;
    const initialRev = dbRows[0].revision_no;

    const row = page.locator('table tbody tr', { hasText: marker }).first();
    const editBtn = row.locator('button[title="แก้ไข"]');

    // Go offline
    await context.setOffline(true);

    // Edit 1
    await editBtn.click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();
    const modal1 = page.locator('.fixed.inset-0').last();
    const lineInput1 = modal1.locator('table tbody tr').first().locator('input').first();
    await lineInput1.fill(`${marker}-EDIT1`);
    await modal1.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    // Edit 2
    const row2 = page.locator('table tbody tr', { hasText: `${marker}-EDIT1` }).first();
    await row2.locator('button[title="แก้ไข"]').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();
    const modal2 = page.locator('.fixed.inset-0').last();
    const lineInput2 = modal2.locator('table tbody tr').first().locator('input').first();
    await lineInput2.fill(`${marker}-EDIT2`);
    await modal2.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    // Verify queue: exactly ONE update with original expectedRevisionNo
    const queue = await readQueue(page);
    const pendingUpdates = queue.filter(e => e.id === clientTempId && e.entity === 'income_expense');
    expect(pendingUpdates.length).toBe(1);
    expect(pendingUpdates[0].payload.expectedRevisionNo).toBe(initialRev);
    expect(pendingUpdates[0].payload.title).toBe(`${marker}-EDIT2`);

    // Go online, wait for sync
    await context.setOffline(false);
    const syncedRow = page.locator('table tbody tr', { hasText: `${marker}-EDIT2` }).first();
    await expect(syncedRow.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });

    // Verify DB
    const dbCheck = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${clientTempId}&select=title,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const finalRows = await dbCheck.json();
    expect(finalRows[0].title).toBe(`${marker}-EDIT2`);
    expect(finalRows[0].revision_no).toBeGreaterThan(initialRev);

    // Cleanup
    await cleanupIncomeExpense(page, pendingUpdates[0].payload, clientTempId, finalRows[0].revision_no);
  });

  test.skip('synced row → offline edit → delete → sync as soft delete', async ({ page, context }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-EDITDEL-${Date.now()}`;
    await createIncomeOnline(page, marker, 1000);

    // Get from DB
    const dbRes = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?title=eq.${marker}&select=client_temp_id,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbRes.json();
    const clientTempId = dbRows[0].client_temp_id;
    const initialRev = dbRows[0].revision_no;

    const row = page.locator('table tbody tr', { hasText: marker }).first();

    // Go offline
    await context.setOffline(true);

    // Edit
    await row.locator('button[title="แก้ไข"]').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();
    const modal = page.locator('.fixed.inset-0').last();
    await modal.locator('table tbody tr').first().locator('input').first().fill(`${marker}-EDITED`);
    await modal.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    // Delete
    const editedRow = page.locator('table tbody tr', { hasText: `${marker}-EDITED` }).first();
    await editedRow.locator('button[title="ลบ"]').click();
    await expect(editedRow).toBeHidden({ timeout: 10000 });

    // Queue: exactly ONE delete with original revision
    const queue = await readQueue(page);
    const events = queue.filter(e => e.id === clientTempId && e.entity === 'income_expense');
    expect(events.length).toBe(1);
    expect(events[0].operation).toBe('delete');
    expect(events[0].payload.expectedRevisionNo).toBe(initialRev);

    // Go online
    await context.setOffline(false);

    // DB check: soft deleted
    await expect.poll(async () => {
      const res = await page.request.fetch(
        `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${clientTempId}&select=record_status`,
        { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
      );
      const rows = await res.json();
      return rows[0]?.record_status;
    }, { timeout: 15000 }).toBe('deleted');
  });

  test('offline create → delete before sync → no-op, DB has no row', async ({ page, context }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-CREATEDEL-${Date.now()}`;

    await context.setOffline(true);

    // Create
    await page.click('button:has-text("เพิ่มรายรับ")');
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();
    const modal = page.locator('.fixed.inset-0').last();
    await modal.locator('table tbody tr').first().locator('input').first().fill(marker);
    await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('500');
    await modal.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 5000 });

    // Get clientTempId from queue
    const queueBefore = await readQueue(page);
    const createEvt = queueBefore.find(e => e.entity === 'income_expense' && e.payload?.title === marker);
    expect(createEvt).toBeDefined();
    const clientTempId = createEvt.id;

    // Delete while still offline
    await row.locator('button[title="ลบ"]').click();
    await expect(row).toBeHidden({ timeout: 5000 });

    // Queue: no events for this id (create + delete = noop)
    const queueAfter = await readQueue(page);
    const remaining = queueAfter.filter(e => e.id === clientTempId);
    expect(remaining.length).toBe(0);

    // Go online
    await context.setOffline(false);

    // DB: no row
    await expect.poll(async () => {
      const dbCheck = await page.request.fetch(
        `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${clientTempId}&select=id`,
        { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
      );
      const dbRows = await dbCheck.json();
      return dbRows.length;
    }, { timeout: 15000 }).toBe(0);
  });

  test('replay same payload → idempotent, no duplicate', async ({ page, context }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-IDEMP-${Date.now()}`;

    // Create offline
    await context.setOffline(true);
    await page.click('button:has-text("เพิ่มรายรับ")');
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();
    const modal = page.locator('.fixed.inset-0').last();
    await modal.locator('table tbody tr').first().locator('input').first().fill(marker);
    await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('3000');
    await modal.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    const queue = await readQueue(page);
    const createEvent = queue.find(e => e.entity === 'income_expense' && e.payload?.title === marker);
    const clientTempId = createEvent.id;
    const payload = createEvent.payload;

    // Go online → sync
    await context.setOffline(false);
    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });

    // Replay same payload
    const replay1 = await page.request.post('/api/lanflow/income-expense', { data: payload });
    expect(replay1.ok()).toBeTruthy();
    const replay1Data = await replay1.json();
    expect(replay1Data.status).toBe('synced');

    // Replay again
    const replay2 = await page.request.post('/api/lanflow/income-expense', { data: payload });
    expect(replay2.ok()).toBeTruthy();
    const replay2Data = await replay2.json();
    expect(replay2Data.status).toBe('synced');
    expect(replay2Data.serverBillNo).toBe(replay1Data.serverBillNo);
    expect(replay2Data.revisionNo).toBe(replay1Data.revisionNo);

    // DB: exactly 1 row
    const dbCheck = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?client_temp_id=eq.${clientTempId}&select=id`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheck.json();
    expect(dbRows.length).toBe(1);

    // Cleanup
    await cleanupIncomeExpense(page, payload, clientTempId, replay1Data.revisionNo);
  });

  test('stale update revision → marks conflict and shows error in UI', async ({ page, context }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-CONFLICT-${Date.now()}`;
    await createIncomeOnline(page, marker, 1000);

    const dbRows = await page.request.fetch(
      `${supabaseUrl}/rest/v1/income_expense?title=eq.${marker}&select=client_temp_id,location_id,local_bill_no,tx_date,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    ).then(res => res.json());
    const serverRow = dbRows[0];
    const clientTempId = serverRow.client_temp_id;
    const initialRev = serverRow.revision_no;

    const serverUpdatePayload = await buildIncomeExpensePayload(page, {
      operation: 'update',
      expectedRevisionNo: initialRev,
      clientTempId,
      idempotencyKey: `server-update:${clientTempId}:${initialRev}`,
      locationId: serverRow.location_id,
      localBillNo: serverRow.local_bill_no,
      txDate: serverRow.tx_date,
      title: `${marker}-SERVER`,
      cost: 1100,
    });
    const serverUpdate = await page.request.post('/api/lanflow/income-expense', { data: serverUpdatePayload });
    expect(serverUpdate.ok()).toBeTruthy();
    const serverUpdateData = await serverUpdate.json();
    expect(serverUpdateData.status).toBe('synced');
    expect(serverUpdateData.revisionNo).toBeGreaterThan(initialRev);

    await context.setOffline(true);
    const stalePayload = await buildIncomeExpensePayload(page, {
      operation: 'update',
      expectedRevisionNo: initialRev,
      clientTempId,
      idempotencyKey: `update:${clientTempId}:${initialRev}`,
      locationId: serverRow.location_id,
      localBillNo: serverRow.local_bill_no,
      txDate: serverRow.tx_date,
      title: `${marker}-LOCAL`,
      cost: 1200,
    });
    await enqueueIncomeExpenseEvent(page, {
      id: clientTempId,
      entity: 'income_expense',
      operation: 'update',
      payload: stalePayload,
      timestamp: Date.now(),
      status: 'pending',
    });

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitForQueueStatus(page, clientTempId, 'conflict');

    await page.reload();
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    await page.click('button:has-text("รับ-จ่าย")');
    const conflictRow = page.locator('table tbody tr', { hasText: `${marker}-LOCAL` }).first();
    await expect(conflictRow).toBeVisible({ timeout: 15000 });
    await expect(conflictRow.locator('text=Revision mismatch')).toBeVisible();

    await cleanupIncomeExpense(page, serverUpdatePayload, clientTempId, serverUpdateData.revisionNo);
  });

  test('invalid queued payload → marks failed and stays in queue', async ({ page, context }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-FAILED-${Date.now()}`;
    await context.setOffline(true);
    const payload = await buildIncomeExpensePayload(page, {
      title: marker,
      cost: 0,
    });
    await enqueueIncomeExpenseEvent(page, {
      id: payload.clientTempId,
      entity: 'income_expense',
      operation: 'create',
      payload,
      timestamp: Date.now(),
      status: 'pending',
    });

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitForQueueStatus(page, payload.clientTempId, 'failed');

    const queue = await readQueue(page);
    const failedEvent = queue.find(e => e.id === payload.clientTempId && e.entity === 'income_expense');
    expect(failedEvent).toBeDefined();
    expect(failedEvent.status).toBe('failed');
    expect(failedEvent.errorMessage).toContain('cost must be > 0');

    await page.reload();
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    await page.click('button:has-text("รับ-จ่าย")');
    const failedRow = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(failedRow).toBeVisible({ timeout: 15000 });
    await expect(failedRow.locator('text=cost must be > 0')).toBeVisible();

    const dbRows = await fetchIncomeExpenseRows(page, payload.clientTempId, 'id');
    expect(dbRows.length).toBe(0);
  });

  test('concurrent create → server bill numbers are unique', async ({ page }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-CONCURRENT-${Date.now()}`;
    const locationId = await getPrimaryLocationId(page);
    const txDate = new Date().toISOString().slice(0, 10);
    const payloadA = await buildIncomeExpensePayload(page, {
      locationId,
      txDate,
      title: `${marker}-A`,
      cost: 100,
    });
    const payloadB = await buildIncomeExpensePayload(page, {
      locationId,
      txDate,
      title: `${marker}-B`,
      cost: 200,
    });

    const [resA, resB] = await Promise.all([
      page.request.post('/api/lanflow/income-expense', { data: payloadA }),
      page.request.post('/api/lanflow/income-expense', { data: payloadB }),
    ]);
    expect(resA.ok()).toBeTruthy();
    expect(resB.ok()).toBeTruthy();

    const dataA = await resA.json();
    const dataB = await resB.json();
    expect(dataA.status).toBe('synced');
    expect(dataB.status).toBe('synced');
    expect(dataA.serverBillNo).toBeTruthy();
    expect(dataB.serverBillNo).toBeTruthy();
    expect(dataA.serverBillNo).not.toBe(dataB.serverBillNo);

    await cleanupIncomeExpense(page, payloadA, payloadA.clientTempId, dataA.revisionNo);
    await cleanupIncomeExpense(page, payloadB, payloadB.clientTempId, dataB.revisionNo);
  });

  test('income and expense share one server bill sequence per location and date', async ({ page }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-SEQUENCE-${Date.now()}`;
    const locationId = await getPrimaryLocationId(page);
    const txDate = new Date().toISOString().slice(0, 10);
    const incomePayload = await buildIncomeExpensePayload(page, {
      locationId,
      txDate,
      title: `${marker}-INCOME`,
      cost: 300,
      type: 'income',
      billOption: 'รายรับ',
    });
    const expensePayload = await buildIncomeExpensePayload(page, {
      locationId,
      txDate,
      title: `${marker}-EXPENSE`,
      cost: 400,
      type: 'expense',
      billOption: 'ค่าใช้จ่าย',
    });

    const incomeRes = await page.request.post('/api/lanflow/income-expense', { data: incomePayload });
    expect(incomeRes.ok()).toBeTruthy();
    const incomeData = await incomeRes.json();
    expect(incomeData.status).toBe('synced');

    const expenseRes = await page.request.post('/api/lanflow/income-expense', { data: expensePayload });
    expect(expenseRes.ok()).toBeTruthy();
    const expenseData = await expenseRes.json();
    expect(expenseData.status).toBe('synced');

    expect(expenseData.serverBillNo.slice(0, 6)).toBe(incomeData.serverBillNo.slice(0, 6));
    expect(serverBillSuffix(expenseData.serverBillNo)).toBe(serverBillSuffix(incomeData.serverBillNo) + 1);

    await cleanupIncomeExpense(page, incomePayload, incomePayload.clientTempId, incomeData.revisionNo);
    await cleanupIncomeExpense(page, expensePayload, expensePayload.clientTempId, expenseData.revisionNo);
  });

  test('delete keeps record history and only soft deletes', async ({ page }) => {
    test.setTimeout(90000);
    await loginAndGoToIncomeExpense(page);

    const marker = `E2E-SOFTDEL-${Date.now()}`;
    const payload = await buildIncomeExpensePayload(page, {
      title: marker,
      cost: 900,
    });
    const createRes = await page.request.post('/api/lanflow/income-expense', { data: payload });
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    expect(createData.status).toBe('synced');

    const deletePayload = {
      ...payload,
      operation: 'delete',
      recordStatus: 'deleted',
      expectedRevisionNo: createData.revisionNo,
      idempotencyKey: `delete:${payload.clientTempId}:${createData.revisionNo}`,
      deletedByName: 'LanFlow E2E',
      deletedByPhone: phone,
    };
    const deleteRes = await page.request.post('/api/lanflow/income-expense', { data: deletePayload });
    expect(deleteRes.ok()).toBeTruthy();
    const deleteData = await deleteRes.json();
    expect(deleteData.status).toBe('synced');

    const rows = await fetchIncomeExpenseRows(
      page,
      payload.clientTempId,
      'record_status,deleted_at,deleted_by_name,deleted_by_phone,server_bill_no,local_bill_no,title,cost,revision_no'
    );
    expect(rows.length).toBe(1);
    expect(rows[0].record_status).toBe('deleted');
    expect(rows[0].deleted_at).toBeTruthy();
    expect(rows[0].deleted_by_name).toBe('LanFlow E2E');
    expect(rows[0].deleted_by_phone).toBe(phone);
    expect(rows[0].server_bill_no).toBe(createData.serverBillNo);
    expect(rows[0].local_bill_no).toBe(payload.localBillNo);
    expect(rows[0].title).toBe(marker);
    expect(Number(rows[0].cost)).toBe(900);
    expect(rows[0].revision_no).toBeGreaterThan(createData.revisionNo);
  });
});
