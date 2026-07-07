import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

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
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const phoneE164 = normalizeThaiPhoneToE164(phone);

  const existing = await admin.auth.admin.getUserById(testUserId);
  if (existing.data.user) {
    await admin.auth.admin.updateUserById(testUserId, {
      phone: phoneE164, password, phone_confirm: true,
      user_metadata: { name: 'LanFlow E2E' },
      app_metadata: { lanflow_role: 'super_admin' },
    });
  } else {
    await admin.auth.admin.createUser({
      id: testUserId, phone: phoneE164, password, phone_confirm: true,
      user_metadata: { name: 'LanFlow E2E' },
      app_metadata: { lanflow_role: 'super_admin' },
    });
  }

  await admin.from('profiles').upsert({
    id: testUserId, phone, name: 'LanFlow E2E', role: 'super_admin', is_active: true, password_hash: null,
  }, { onConflict: 'id' });

  // ensure location
  const { data: locations } = await admin.from('locations').select('id').eq('is_active', true).limit(1);
  if (locations && locations.length > 0) {
    const locId = locations[0].id;
    await admin.from('user_locations').upsert({ user_id: testUserId, location_id: locId }, { onConflict: 'user_id,location_id' });
  }
}

test.describe('Seed Users', () => {
  test.beforeEach(async () => {
    await ensureTestUser();
  });

  test('Seed Admins and Users', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes

    // 1. Login
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });

    // 2. Go to Admin tab
    await page.click('button:has-text("Admin")');
    await expect(page.locator('h2:has-text("รายชื่อพนักงานในระบบ")')).toBeVisible();

    // Ensure location is loaded in select
    await expect(page.locator('select').last().locator('option').nth(1)).toBeAttached({ timeout: 10000 });
    const locationId = await page.locator('select').last().locator('option').nth(1).getAttribute('value');

    if (!locationId) {
      throw new Error('No location found to assign to users');
    }

    // Generate 5 admins
    for (let i = 1; i <= 5; i++) {
      const uPhone = `081${i.toString().padStart(7, '0')}`;
      const name = `TestAdmin${i}`;

      await page.fill('input[placeholder="ชื่อพนักงาน"]', name);
      await page.fill('input[placeholder="เบอร์โทร 08xxxxxxxx"]', uPhone);
      await page.fill('input[placeholder="รหัสผ่านอย่างน้อย 8 ตัว"]', password);
      
      // select role (first select is role, second is location)
      const roleSelect = page.locator('select').filter({ has: page.locator('option[value="admin"]') }).first();
      if (await roleSelect.count() > 0) {
        await roleSelect.selectOption('admin');
      }
      
      const locSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'เลือกสาขาเริ่มต้น' }) }).first();
      await locSelect.selectOption(locationId);

      await page.click('button:has-text("สร้างบัญชีผู้ใช้")');
      
      // wait for it to appear in the list
      await expect(page.locator(`text=${name}`)).toBeVisible({ timeout: 10000 });
      console.log(`Created Admin: ${name} (${uPhone})`);
      await page.waitForTimeout(500); // small delay to let toasts fade if any
    }

    // Generate 15 users
    for (let i = 1; i <= 15; i++) {
      const uPhone = `082${i.toString().padStart(7, '0')}`;
      const name = `TestUser${i}`;

      await page.fill('input[placeholder="ชื่อพนักงาน"]', name);
      await page.fill('input[placeholder="เบอร์โทร 08xxxxxxxx"]', uPhone);
      await page.fill('input[placeholder="รหัสผ่านอย่างน้อย 8 ตัว"]', password);
      
      const roleSelect = page.locator('select').filter({ has: page.locator('option[value="user"]') }).first();
      if (await roleSelect.count() > 0) {
        await roleSelect.selectOption('user');
      }
      
      const locSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'เลือกสาขาเริ่มต้น' }) }).first();
      await locSelect.selectOption(locationId);

      await page.click('button:has-text("สร้างบัญชีผู้ใช้")');
      
      await expect(page.locator(`text=${name}`)).toBeVisible({ timeout: 10000 });
      console.log(`Created User: ${name} (${uPhone})`);
      await page.waitForTimeout(500);
    }
  });
});
