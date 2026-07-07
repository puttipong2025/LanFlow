import { test, expect } from '@playwright/test';

test.describe('Phase 4: DB Lockdown Hardening Tests', () => {
  // Use admin role to ensure we have normal permissions but test bypass attempts
  test.use({ storageState: 'playwright/.auth/admin.json' });

  let locationId = '';

  test.beforeAll(async ({ request }) => {
    // Get location ID for the user
    const response = await request.get('/api/auth/me');
    expect(response.status()).toBe(200);
    const data = await response.json();
    locationId = data.profile.locationIds[0];
    expect(locationId).toBeTruthy();
  });

  test('Test 1: Malicious Branch Transfer Bypass', async ({ request }) => {
    // Attempting to directly insert a branch transfer-like record
    const payload = {
      operation: 'create',
      clientTempId: `malicious-transfer-${Date.now()}`,
      idempotencyKey: `malicious-transfer-${Date.now()}`,
      localBillNo: `LOCAL-TR-${Date.now()}`,
      locationId: locationId,
      type: 'income',
      billOption: 'รายรับ',
      cost: 500,
      title: 'รับโอนจากสาขา A',
      txDate: new Date().toISOString(),
      clientCreatedAt: new Date().toISOString(),
      clientRecordedAt: new Date().toISOString(),
    };

    const response = await request.post('/api/lanflow/income-expense', {
      data: payload,
    });

    const body = await response.json();
    console.log(body);
    expect(response.status()).toBe(409);
    expect(body.status).toBe('conflict');
    expect(body.errorMessage).toBe('ไม่สามารถซิงก์รายการโยกเงินโดยตรงได้ ต้องทำผ่านระบบโยกเงินเท่านั้น');
  });

  test('Test 2: Malicious Approval Keyword Bypass', async ({ request }) => {
    // Seed keyword to the database for this test
    const { createClient } = require('@supabase/supabase-js');
    const adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await adminClient.from('income_expense_approval_keywords').insert({
      keyword: 'เบิก',
      match_mode: 'contains',
      applies_to: 'both',
      is_active: true
    });
    if (error) console.error("SEED KEYWORD ERROR:", error);

    // Attempting to insert a record with an approval keyword directly
    const payload = {
      operation: 'create',
      clientTempId: `malicious-keyword-${Date.now()}`,
      idempotencyKey: `malicious-keyword-${Date.now()}`,
      localBillNo: `LOCAL-KW-${Date.now()}`,
      locationId: locationId,
      type: 'expense',
      billOption: 'ค่าใช้จ่าย',
      cost: 500,
      title: 'เบิกเงินสดซื้อของ',
      txDate: new Date().toISOString(),
      clientCreatedAt: new Date().toISOString(),
      clientRecordedAt: new Date().toISOString(),
    };

    const response = await request.post('/api/lanflow/income-expense', {
      data: payload,
    });

    const body = await response.json();
    console.log(body);
    expect(response.status()).toBe(409);
    expect(body.status).toBe('conflict');
    expect(body.errorMessage).toBe('รายการนี้ต้องขออนุมัติ ไม่สามารถซิงก์โดยตรงได้');
  });

  test('Test 3: Valid API Sync', async ({ request }) => {
    // Normal sync should pass successfully
    const payload = {
      operation: 'create',
      clientTempId: `valid-sync-${Date.now()}`,
      idempotencyKey: `valid-sync-${Date.now()}`,
      localBillNo: `LOCAL-OK-${Date.now()}`,
      locationId: locationId,
      type: 'expense',
      billOption: 'ค่าใช้จ่าย',
      cost: 200,
      title: 'ซื้อของใช้ทั่วไป',
      txDate: new Date().toISOString(),
      clientCreatedAt: new Date().toISOString(),
      clientRecordedAt: new Date().toISOString(),
    };

    const response = await request.post('/api/lanflow/income-expense', {
      data: payload,
    });

    const body = await response.json();
    console.log(body);
    expect(response.status()).toBe(200);
    expect(body.status).toBe('synced');
    expect(body.id).toBeTruthy();
    expect(body.serverBillNo).toBeTruthy();
  });
});
