import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test('Super Admin phone change preserves identity and revokes the old session', async ({ browser, baseURL }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, anon, options);
  const id = crypto.randomUUID();
  const suffix = Date.now().toString().slice(-7);
  const oldPhone = `+6681${suffix}`;
  const newPhone = `+6682${suffix}`;
  const password = `Phone-${crypto.randomUUID()}`;
  const actor = await browser.newContext({ storageState: 'playwright/.auth/super_admin.json' });
  try {
    expect((await admin.auth.admin.createUser({ id, phone: oldPhone, phone_confirm: true, password })).error).toBeNull();
    expect((await admin.from('profiles').insert({ id, phone: `0${oldPhone.slice(3)}`, name: 'Phone API fixture', role: 'admin', is_active: true })).error).toBeNull();
    const login = await client.auth.signInWithPassword({ phone: oldPhone, password });
    expect(login.error).toBeNull();
    const headers = { Authorization: `Bearer ${login.data.session!.access_token}` };
    const endpoint = `/api/lanflow/admin/users/${id}/phone`;
    const denied = await actor.request.patch(endpoint, { headers, data: { phone: newPhone } });
    expect(denied.status()).toBe(403);
    const changed = await actor.request.patch(endpoint, { headers: { Origin: new URL(baseURL!).origin }, data: { phone: newPhone } });
    expect(changed.status()).toBe(200);
    const oldStatus = await client.rpc('sms_login_status');
    expect(oldStatus.data?.status).toBe('SESSION_REVOKED');
    const profile = await admin.from('profiles').select('id,phone,role').eq('id', id).single();
    expect(profile.data).toEqual({ id, phone: `0${newPhone.slice(3)}`, role: 'admin' });
    const fresh = createClient(url, anon, options);
    const nextLogin = await fresh.auth.signInWithPassword({ phone: newPhone, password });
    expect(nextLogin.error).toBeNull();
    expect(nextLogin.data.user?.id).toBe(id);
    expect((await fresh.rpc('sms_login_status')).data?.status).toBe('READY');
    await fresh.auth.signOut({ scope: 'local' });
  } finally {
    await actor.close();
    await admin.from('profiles').delete().eq('id', id);
    await admin.auth.admin.deleteUser(id);
  }
});

test('Super Admin changing their own phone must prove the current password', async ({ browser, baseURL }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const id = process.env.TEST_USER_ID || '00000000-0000-4000-8000-000000000001';
  const before = await admin.auth.admin.getUserById(id);
  const phone = before.data.user!.phone!;
  const context = await browser.newContext({ storageState: 'playwright/.auth/super_admin.json' });
  const newPhone = `+6683${Date.now().toString().slice(-7)}`;
  const endpoint = `/api/lanflow/admin/users/${id}/phone`;
  const headers = { Origin: new URL(baseURL!).origin };
  let changed = false;
  try {
    expect((await context.request.patch(endpoint, { headers, data: { phone: newPhone } })).status()).toBe(400);
    expect((await context.request.patch(endpoint, { headers, data: { phone: newPhone, currentPassword: 'deliberately-wrong' } })).status()).toBe(400);
    const result = await context.request.patch(endpoint, { headers, data: { phone: newPhone, currentPassword: process.env.TEST_PASSWORD || 'password123' } });
    changed = result.ok();
    expect(result.status()).toBe(200);
    expect((await context.request.get('/api/auth/me')).status()).toBe(401);
    const fresh = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options);
    const login = await fresh.auth.signInWithPassword({ phone: newPhone, password: process.env.TEST_PASSWORD || 'password123' });
    expect(login.error).toBeNull();
    expect(login.data.user?.id).toBe(id);
    expect((await fresh.rpc('sms_login_status')).data?.status).toBe('READY');
    await fresh.auth.signOut({ scope: 'local' });
  } finally {
    await context.close();
    if (changed) {
      expect((await admin.rpc('prepare_sms_phone_change', { p_actor: id, p_target: id, p_phone: phone.replace(/^\+/, '') })).error).toBeNull();
      expect((await admin.auth.admin.updateUserById(id, { phone, phone_confirm: true })).error).toBeNull();
    }
  }
});
