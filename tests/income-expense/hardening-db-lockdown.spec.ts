import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { bangkokDateString } from '../../src/lib/bangkok-date';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
    const clientTempId = `malicious-transfer-${crypto.randomUUID()}`;
    const payload = {
      operation: 'create',
      expectedRevisionNo: 0,
      clientTempId,
      idempotencyKey: `create:${clientTempId}:0`,
      localBillNo: `LOCAL-TR-${Date.now()}`,
      locationId: locationId,
      recordStatus: 'active',
      type: 'income',
      billOption: 'รายรับ',
      cost: 500,
      title: 'รับโอนจากสาขา A',
      txDate: bangkokDateString(),
      clientCreatedAt: new Date().toISOString(),
      clientRecordedAt: new Date().toISOString(),
    };

    const response = await request.post('/api/lanflow/income-expense', {
      data: payload,
    });

    const body = await response.json();
    expect(response.status()).toBe(409);
    expect(body.status).toBe('conflict');
    expect(body.errorMessage).toBe('ไม่สามารถซิงก์รายการโยกเงินโดยตรงได้ ต้องทำผ่านระบบโยกเงินเท่านั้น');
  });

  test('Test 2: Malicious Approval Keyword Bypass', async ({ request }) => {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const marker = crypto.randomUUID();
    const clientTempId = `malicious-keyword-${marker}`;
    const keywordId = crypto.randomUUID();
    let requestId: string | null = null;
    const { error } = await adminClient.from('income_expense_approval_keywords').insert({
      id: keywordId,
      keyword: marker,
      match_mode: 'exact',
      applies_to: 'both',
      is_active: true
    });
    expect(error).toBeNull();

    // Attempting to insert a record with an approval keyword directly
    const payload = {
      operation: 'create',
      expectedRevisionNo: 0,
      clientTempId,
      idempotencyKey: `create:${clientTempId}:0`,
      localBillNo: `LOCAL-KW-${marker.slice(0, 8)}`,
      locationId: locationId,
      recordStatus: 'active',
      type: 'expense',
      billOption: 'ค่าใช้จ่าย',
      cost: 500,
      title: marker,
      txDate: bangkokDateString(),
      clientCreatedAt: new Date().toISOString(),
      clientRecordedAt: new Date().toISOString(),
    };

    try {
      const response = await request.post('/api/lanflow/income-expense', { data: payload });
      const body = await response.json();
      expect(response.status()).toBe(202);
      expect(body.status).toBe('pending_approval');
      expect(body.matchedReasons).toContain('keyword');
      requestId = body.requestId;
      expect((await adminClient.from('income_expense').select('id').eq('client_temp_id', clientTempId)).data)
        .toHaveLength(0);
    } finally {
      if (requestId) await adminClient.from('income_expense_approval_requests').delete().eq('id', requestId);
      await adminClient.from('income_expense').delete().eq('client_temp_id', clientTempId);
      await adminClient.from('income_expense_approval_keywords').delete().eq('id', keywordId);
    }
  });

  test('Test 3: Valid API Sync', async ({ request }) => {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const clientTempId = `valid-sync-${crypto.randomUUID()}`;
    const { data: originalSettings, error: settingsReadError } = await adminClient
      .from('income_expense_approval_settings')
      .select('applies_to, approval_min_amount, non_current_date_requires_approval')
      .eq('id', true)
      .single();
    expect(settingsReadError).toBeNull();
    const { error: settingsUpdateError } = await adminClient
      .from('income_expense_approval_settings')
      .update({ approval_min_amount: null, non_current_date_requires_approval: false })
      .eq('id', true);
    expect(settingsUpdateError).toBeNull();
    // Normal sync should pass successfully
    const payload = {
      operation: 'create',
      expectedRevisionNo: 0,
      clientTempId,
      idempotencyKey: `create:${clientTempId}:0`,
      localBillNo: `LOCAL-OK-${Date.now()}`,
      locationId: locationId,
      recordStatus: 'active',
      type: 'expense',
      billOption: 'ค่าใช้จ่าย',
      cost: 200,
      title: 'ซื้อของใช้ทั่วไป',
      txDate: bangkokDateString(),
      clientCreatedAt: new Date().toISOString(),
      clientRecordedAt: new Date().toISOString(),
    };

    try {
      const response = await request.post('/api/lanflow/income-expense', { data: payload });
      const body = await response.json();
      expect(response.status()).toBe(200);
      expect(body.status).toBe('synced');
      expect(body.id).toBeTruthy();
      expect(body.serverBillNo).toBeTruthy();
    } finally {
      await adminClient.from('income_expense').delete().eq('client_temp_id', clientTempId);
      if (originalSettings) {
        await adminClient.from('income_expense_approval_settings').update(originalSettings).eq('id', true);
      }
    }
  });
});
