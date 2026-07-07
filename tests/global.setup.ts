import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

import { createClient } from '@supabase/supabase-js';

const authDir = path.join(__dirname, '../playwright/.auth');

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
  if (!serviceRoleKey) return;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ensure location exists first
  let locId = '';
  const { data: locations } = await admin.from('locations').select('id').eq('is_active', true).limit(1);
  if (locations && locations.length > 0) {
    locId = locations[0].id;
  }

  const usersConfig = [
    { id: testUserId, phone: phone, role: 'super_admin' },
    { id: '00000000-0000-4000-8000-000000000002', phone: '0810000001', role: 'admin' },
    { id: '00000000-0000-4000-8000-000000000003', phone: '0820000001', role: 'user' }
  ];

  for (const u of usersConfig) {
    const phoneE164 = normalizeThaiPhoneToE164(u.phone);
    const existing = await admin.auth.admin.getUserById(u.id);
    
    if (existing.data.user) {
      await admin.auth.admin.updateUserById(u.id, {
        phone: phoneE164, password, phone_confirm: true,
        user_metadata: { name: `LanFlow ${u.role}` },
        app_metadata: { lanflow_role: u.role },
      });
    } else {
      await admin.auth.admin.createUser({
        id: u.id, phone: phoneE164, password, phone_confirm: true,
        user_metadata: { name: `LanFlow ${u.role}` },
        app_metadata: { lanflow_role: u.role },
      });
    }

    await admin.from('profiles').upsert({
      id: u.id, phone: u.phone, name: `LanFlow ${u.role}`, role: u.role, is_active: true, password_hash: null,
    }, { onConflict: 'id' });

    // Ensure users have access to locations in user_locations
    const { data: allLocations } = await admin.from('locations').select('id');
    if (allLocations) {
      for (const loc of allLocations) {
        if (u.role === 'super_admin') {
            await admin.from('user_locations').upsert({
              user_id: u.id, location_id: loc.id
            }, { onConflict: 'user_id,location_id' });
        } else if (locations && locations.find(l => l.id === loc.id)) {
            await admin.from('user_locations').upsert({
              user_id: u.id, location_id: loc.id
            }, { onConflict: 'user_id,location_id' });
        }
      }
    }
  }
}

const authUsers = [
  { role: 'super_admin', phone },
  { role: 'admin', phone: '0810000001' },
  { role: 'user', phone: '0820000001' }
];

setup('authenticate users', async ({ page }) => {
  setup.setTimeout(60000); // 1 minute
  await ensureTestUser();
  const password = process.env.TEST_PASSWORD || 'password123';

  // Ensure the auth directory exists
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  for (const user of authUsers) {
    console.log(`Logging in as ${user.role} (${user.phone})...`);
    page.on('dialog', dialog => dialog.accept());
    
    // Using a fresh context for each user is safer to clear cookies/storage,
    // but navigating to /login and then logging out also works.
    // Let's use the current page and explicitly logout later.
    await page.goto('/login');
    await page.fill('input[type="tel"]', user.phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 15000 });

    const statePath = path.join(authDir, `${user.role}.json`);
    await page.context().storageState({ path: statePath });
    console.log(`Saved storageState for ${user.role} to ${statePath}`);

    // Wait for the UI to settle
    await page.waitForTimeout(500);

    // Logout to clear the session for the next iteration
    await page.click('button:has-text("ออกจากระบบ")');
    await expect(page.locator('button:has-text("เข้าสู่ระบบ")')).toBeVisible({ timeout: 10000 });
  }
});
