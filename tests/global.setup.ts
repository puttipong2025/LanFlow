import { test as setup } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

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

  const { data: locations } = await admin.from('locations').select('id').eq('is_active', true).limit(1);

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

setup('authenticate users', async () => {
  setup.setTimeout(60000);
  await ensureTestUser();
  const password = process.env.TEST_PASSWORD || 'password123';
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!publishableKey) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required for Playwright auth fixtures');

  // Ensure the auth directory exists
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  for (const user of authUsers) {
    const cookieValues = new Map<string, string>();
    const client = createBrowserClient(supabaseUrl, publishableKey, {
      isSingleton: false,
      cookieOptions: { name: 'sb-127-auth-token' },
      cookies: {
        getAll: () => [],
        setAll: (cookies: Array<{ name: string; value: string }>) => {
          for (const cookie of cookies) cookieValues.set(cookie.name, cookie.value);
        },
      },
    });
    const { error } = await client.auth.signInWithPassword({
      phone: normalizeThaiPhoneToE164(user.phone),
      password,
    });
    if (error) throw error;

    const statePath = path.join(authDir, `${user.role}.json`);
    fs.writeFileSync(statePath, JSON.stringify({
      cookies: [...cookieValues].map(([name, value]) => ({
        name,
        value,
        domain: '127.0.0.1',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      })),
      origins: [],
    }));
  }
});
