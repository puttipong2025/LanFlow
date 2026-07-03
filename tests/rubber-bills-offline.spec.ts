import { test, expect, Page } from '@playwright/test';

/** Read all events from IndexedDB sync_queue (matching idb-queue.ts store name) */
async function readQueue(page: Page): Promise<any[]> {
  await page.waitForLoadState('domcontentloaded');
  return page.evaluate(() => {
    return new Promise<any[]>((resolve, reject) => {
      const req = indexedDB.open('lanflow_sync_db', 2);
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

  await page.click('button:has-text("Submit")');
  await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });
  const row = page.locator('table tbody tr', { hasText: marker }).first();
  await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });
}

test.describe('Rubber Bills Full Offline Sync', () => {
  const marker = `E2E-${Date.now()}`;
  const phone = process.env.TEST_PHONE || '0800000000';
  const password = process.env.TEST_PASSWORD || 'password123';
  
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

  test('should support create, edit, delete offline and sync when online', async ({ page, context }) => {
    test.setTimeout(90000);

    // 1. Login
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });

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
    await weighRow.locator('input[type="number"]').nth(0).fill('1000');
    await weighRow.locator('input[type="number"]').nth(1).fill('200');
    await weighRow.locator('input[type="number"]').nth(3).fill('25.5');

    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    // Assert: UI shows "รอซิงก์" (pending)
    const createdRow = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(createdRow).toBeVisible({ timeout: 5000 });
    await expect(createdRow.locator('span:has-text("รอซิงก์")')).toBeVisible();

    // Assert: IDB queue has the create event with correct payload shape
    const queueAfterCreate = await readQueue(page);
    const createEvent = queueAfterCreate.find(
      e => e.operation === 'create' && e.payload?.customerName === marker
    );
    expect(createEvent).toBeDefined();
    // payload uses items[] with unitPrice, not weighItems[].price
    expect(createEvent.payload.items).toBeDefined();
    const weighItem = createEvent.payload.items.find((i: any) => i.itemType === 'weigh');
    expect(weighItem.unitPrice).toBe(25.5);
    const clientTempId = createEvent.id;

    // === STEP 2: EDIT the pending bill offline ===
    await createdRow.locator('button[title="แก้ไข"]').click();
    await expect(page.locator('h2:has-text("แก้ไขบิลเครื่องชั่งเล็ก")')).toBeVisible();
    
    const editModal = page.locator('.fixed.inset-0').last();
    const editWeighRow = editModal.locator('table').first().locator('tbody tr').first();
    await editWeighRow.locator('input[type="number"]').nth(3).fill('26.5');
    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("แก้ไขบิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    // Assert: edit coalesced into existing create (not a second event)
    const queueAfterEdit = await readQueue(page);
    const editEvents = queueAfterEdit.filter(e => e.id === clientTempId);
    expect(editEvents.length).toBe(1);
    expect(editEvents[0].operation).toBe('create'); // still "create", payload updated
    expect(editEvents[0].payload.items.find((i: any) => i.itemType === 'weigh').unitPrice).toBe(26.5);

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
    await deleteWeighRow.locator('input[type="number"]').nth(3).fill('20.5');
    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    const deleteRow = page.locator('table tbody tr', { hasText: markerDelete }).first();
    await expect(deleteRow).toBeVisible({ timeout: 5000 });

    // Delete the second bill — should coalesce with its pending create
    await deleteRow.locator('button:has-text("ลบ")').click();
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

  test('should coalesce offline updates for a synced bill (edit twice)', async ({ page, context }) => {
    const marker = `SyncEditTwice-${Date.now()}`;
    await createBillOnline(page, marker);

    // Get the bill from table
    const row = page.locator('table tbody tr', { hasText: marker }).first();
    const editBtn = row.locator('button[title="แก้ไข"]');
    await editBtn.click();

    // Get clientTempId from URL or we can just fetch it from DB since it's online
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const dbCheckRes = await page.request.fetch(
      `${supabaseUrl}/rest/v1/rubber_bills?customer_name=eq.${marker}&select=client_temp_id,revision_no,server_bill_no`,
      { headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheckRes.json();
    const clientTempId = dbRows[0].client_temp_id;
    const initialRev = dbRows[0].revision_no;

    // Go offline
    await context.setOffline(true);

    // Edit 1
    await page.fill('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]', `${marker}-EDIT1`);
    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("แก้ไขบิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    // Edit 2
    await editBtn.click();
    await page.fill('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]', `${marker}-EDIT2`);
    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("แก้ไขบิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    // Verify queue has exactly ONE update event with expectedRevisionNo = initialRev
    const queue = await readQueue(page);
    const pendingUpdates = queue.filter(e => e.id === clientTempId && e.operation === 'update');
    expect(pendingUpdates.length).toBe(1);
    expect(pendingUpdates[0].payload.expectedRevisionNo).toBe(initialRev);
    expect(pendingUpdates[0].payload.customerName).toBe(`${marker}-EDIT2`);
    expect(pendingUpdates[0].payload.idempotencyKey).toBe(`update:${clientTempId}:${initialRev}`);

    // Go online, wait for sync
    await context.setOffline(false);
    await expect(row.locator('span:has-text("รอซิงก์")')).toBeHidden({ timeout: 15000 });

    // Verify DB
    const dbCheckRes2 = await page.request.fetch(
      `${supabaseUrl}/rest/v1/rubber_bills?client_temp_id=eq.${clientTempId}&select=customer_name,revision_no`,
      { headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    const dbRows2 = await dbCheckRes2.json();
    expect(dbRows2[0].customer_name).toBe(`${marker}-EDIT2`);
    expect(dbRows2[0].revision_no).toBeGreaterThan(initialRev);

    // Cleanup
    await page.request.post('/api/lanflow/rubber-bills', { data: { ...pendingUpdates[0].payload, operation: 'delete', expectedRevisionNo: dbRows2[0].revision_no, recordStatus: 'deleted', idempotencyKey: `delete:${clientTempId}:${dbRows2[0].revision_no}` } });
  });

  test('should coalesce offline update then delete to a single delete event with original revision', async ({ page, context }) => {
    const marker = `SyncEditDel-${Date.now()}`;
    await createBillOnline(page, marker);

    // Get the bill from table
    const row = page.locator('table tbody tr', { hasText: marker }).first();
    const editBtn = row.locator('button[title="แก้ไข"]');
    const deleteBtn = row.locator('button:has-text("ลบ")');

    // Fetch details
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const dbCheckRes = await page.request.fetch(
      `${supabaseUrl}/rest/v1/rubber_bills?customer_name=eq.${marker}&select=client_temp_id,revision_no,location_id`,
      { headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheckRes.json();
    const clientTempId = dbRows[0].client_temp_id;
    const initialRev = dbRows[0].revision_no;
    const locationId = dbRows[0].location_id;

    // Go offline
    await context.setOffline(true);

    // Edit 1
    await editBtn.click();
    await page.fill('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]', `${marker}-EDIT1`);
    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("แก้ไขบิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    // Delete
    // Dialog confirm is already mocked in createBillOnline
    await deleteBtn.click();
    await expect(row).toBeHidden({ timeout: 10000 });

    // Verify queue has exactly ONE delete event with expectedRevisionNo = initialRev
    const queue = await readQueue(page);
    const pendingEvents = queue.filter(e => e.id === clientTempId);
    expect(pendingEvents.length).toBe(1);
    expect(pendingEvents[0].operation).toBe('delete');
    expect(pendingEvents[0].payload.expectedRevisionNo).toBe(initialRev);
    expect(pendingEvents[0].payload.idempotencyKey).toBe(`delete:${clientTempId}:${initialRev}`);

    // Go online
    await context.setOffline(false);
    
    // DB-level check: ensure record is deleted
    await expect.poll(async () => {
      const res = await page.request.fetch(
        `${supabaseUrl}/rest/v1/rubber_bills?client_temp_id=eq.${clientTempId}&select=record_status`,
        { headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` } }
      );
      const rows = await res.json();
      return rows[0]?.record_status;
    }, { timeout: 15000 }).toBe('deleted');
  });
  test('should resolve legacy duplicate events from IDB correctly upon online sync', async ({ page, context }) => {
    // Online login
    await page.goto('/login');
    await page.fill('input[type="tel"]', '0800000000');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button:has-text("เข้าสู่ระบบ")');

    await expect(page.locator('text=ภาพรวม')).toBeVisible({ timeout: 15000 });
    await page.click('button:has-text("บิลยาง")');

    // 1. Create a bill online first
    const marker = `Legacy-${Date.now()}`;

    await page.click('button:has-text("เพิ่มบิลยาง")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeVisible();

    await page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]').fill(marker);
    await page.keyboard.press('Escape');

    const modal = page.locator('.fixed.inset-0').last();
    const weighRow = modal.locator('table').first().locator('tbody tr').first();
    await weighRow.locator('input[type="number"]').nth(0).fill('1000');
    await weighRow.locator('input[type="number"]').nth(1).fill('200');
    await weighRow.locator('input[type="number"]').nth(3).fill('25.5');

    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });
    
    // Wait for sync
    const row = page.locator(`tr:has-text("${marker}")`).first();
    await expect(row.locator('span:has-text("รอซิงก์")')).toBeHidden({ timeout: 15000 });

    // 2. Fetch revision and client_temp_id
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const dbCheckRes = await page.request.fetch(
      `${supabaseUrl}/rest/v1/rubber_bills?customer_name=eq.${marker}&select=client_temp_id,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const dbRows = await dbCheckRes.json();
    const initialRev = dbRows[0].revision_no;
    const clientTempId = dbRows[0].client_temp_id;

    // 3. Go offline
    await context.setOffline(true);

    // 4. Edit bill via UI to generate a FULL valid update payload in the queue
    await row.locator('button[title="แก้ไข"]').click();
    await page.fill('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]', `${marker}-Legacy1`);
    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("แก้ไขบิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });

    // 5. Clone the event in IDB to simulate duplicate bug
    await page.evaluate(async ({ clientTempId, marker }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('lanflow_sync_db', 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      
      const allEvents = await new Promise<any[]>((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
      });

      const originalEvent = allEvents.find(e => e.id === clientTempId && e.operation === 'update');
      
      // Create duplicate event with same idempotencyKey and expectedRevisionNo but different name
      const duplicateEvent = JSON.parse(JSON.stringify(originalEvent));
      delete duplicateEvent.queueId; // let autoIncrement assign a new one
      duplicateEvent.payload.customerName = `${marker}-Legacy2`;
      duplicateEvent.createdAt = new Date().toISOString();

      store.add(duplicateEvent);

      await new Promise((resolve) => {
        tx.oncomplete = resolve;
      });
      db.close();
    }, { clientTempId, marker });

    // 6. Go online, wait for sync
    await context.setOffline(false);
    
    // We expect the sync to resolve the duplicates and successfully sync Legacy2
    // We can't rely on UI row text updating instantly since we bypassed the query cache,
    // so we just wait a bit and check DB directly.
    await page.waitForTimeout(3000);

    // 6. Verify DB has Legacy2 and revision incremented
    const dbCheckRes2 = await page.request.fetch(
      `${supabaseUrl}/rest/v1/rubber_bills?client_temp_id=eq.${clientTempId}&select=customer_name,revision_no`,
      { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
    const finalRows = await dbCheckRes2.json();
    
    expect(finalRows[0].customer_name).toBe(`${marker}-Legacy2`);
    expect(finalRows[0].revision_no).toBeGreaterThan(initialRev);
    
    // 7. Verify queue is empty for this bill
    const queue = await readQueue(page);
    const remaining = queue.filter(e => e.id === clientTempId);
    expect(remaining.length).toBe(0);
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
    const meRes = await page.request.fetch('/api/auth/me', { headers: { Accept: 'application/json' } });
    expect(meRes.ok()).toBeTruthy();
    const meData = await meRes.json();
    const locationId = meData.profile?.locationIds?.[0];
    expect(locationId).toBeDefined();

    // 3. Go offline
    await context.setOffline(true);

    // 4. Seed IDB with create + delete for a fresh clientTempId
    const marker = `LegacyCD-${Date.now()}`;
    const freshId = await page.evaluate(async ({ locationId, marker }) => {
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
        billDate: now.split('T')[0],
        customerName: marker,
        customerType: 'สาขานี้จ่าย',
        weight: 800,
        rubberValue: 20400,
        averagePrice: 25.5,
        deductionTotal: 0,
        netTotal: 20400,
        cashPayment: 20400,
        transferPayment: 0,
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
        const req = indexedDB.open('lanflow_sync_db', 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');

      // Add create event
      store.add({
        id: clientTempId,
        entity: 'rubber_bills',
        operation: 'create',
        payload: basePayload,
        timestamp: Date.now(),
        status: 'pending'
      });

      // Add delete event
      store.add({
        id: clientTempId,
        entity: 'rubber_bills',
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
    }, { locationId, marker });

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
    const meRes = await page.request.fetch('/api/auth/me', { headers: { Accept: 'application/json' } });
    expect(meRes.ok()).toBeTruthy();
    const meData = await meRes.json();
    const locationId = meData.profile?.locationIds?.[0];
    expect(locationId).toBeDefined();

    // 3. Go offline
    await context.setOffline(true);

    const marker = `LegacyCU-${Date.now()}`;
    // 4. Seed IDB with create + update for a fresh clientTempId
    const freshId = await page.evaluate(async ({ locationId, marker }) => {
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
        billDate: now.split('T')[0],
        customerName: marker,
        customerType: 'สาขานี้จ่าย',
        weight: 800,
        rubberValue: 20400,
        averagePrice: 25.5,
        deductionTotal: 0,
        netTotal: 20400,
        cashPayment: 20400,
        transferPayment: 0,
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
        cashPayment: 22950,
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
        const req = indexedDB.open('lanflow_sync_db', 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');

      // Add create event
      store.add({
        id: clientTempId,
        entity: 'rubber_bills',
        operation: 'create',
        payload: createPayload,
        timestamp: Date.now(),
        status: 'pending'
      });

      // Add update event
      store.add({
        id: clientTempId,
        entity: 'rubber_bills',
        operation: 'update',
        payload: updatePayload,
        timestamp: Date.now() + 1,
        status: 'pending'
      });

      await new Promise(resolve => { tx.oncomplete = resolve; });
      db.close();
      return clientTempId;
    }, { locationId, marker });

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
        billDate: new Date().toISOString().split('T')[0],
        customerName: `${marker}-Updated`,
        customerType: 'สาขานี้จ่าย',
        weight: 900,
        rubberValue: 22950,
        averagePrice: 25.5,
        deductionTotal: 0,
        netTotal: 22950,
        cashPayment: 22950,
        transferPayment: 0,
        acidPackCount: 0,
        clientRecordedAt: new Date().toISOString(),
        clientCreatedAt: new Date().toISOString(),
        items: []
      }
    });
    expect(cleanupRes.ok()).toBeTruthy();
  });
});
