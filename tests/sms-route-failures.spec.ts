import { test, expect } from '@playwright/test';
import { loadSourceModule } from './helpers/load-source-module';

const id = '11111111-1111-4111-8111-111111111111';
const smsBoundary = {
  SMS_HEADERS: { 'Cache-Control': 'no-store' },
  isSmsMutationAllowed: () => true,
  smsError: (errorCode: string, status = 400) => Response.json({ errorCode }, { status, headers: { 'Cache-Control': 'no-store' } }),
  getSmsIdentity: async () => ({ userId: id, sessionId: id, password: true, status: 'OTP_REQUIRED' }),
  otpDigest: () => 'digest',
};

for (const resource of ['otp', 'phone', 'sms'] as const) {
  test(`${resource}: authenticate before Origin, but authenticated foreign requests remain forbidden`, async () => {
    for (const signedIn of [false, true]) {
      let writes = 0;
      const filename = resource === 'otp' ? 'src/app/api/auth/sms/route.ts' : `src/app/api/lanflow/admin/users/[id]/${resource}/route.ts`;
      const route = loadSourceModule<Record<string, (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>>>(filename, {
        '@/lib/server/sms-otp': { ...smsBoundary, isSmsMutationAllowed: () => false, getSmsIdentity: async () => signedIn ? { status: 'OTP_REQUIRED', password: true } : null },
        '@/lib/server/auth': { requireRole: async () => signedIn ? { ok: true, auth: { sub: id } } : { ok: false, response: Response.json({ error: 'unauthorized' }, { status: 401 }) } },
        '@/lib/server/supabase-admin': { createSupabaseAdminClient: () => { writes++; throw new Error('must not write'); } },
      });
      const result = await route[resource === 'otp' ? 'POST' : 'PATCH'](new Request('http://localhost', { method: 'POST', headers: { Origin: 'https://foreign.test' } }), { params: Promise.resolve({ id }) });
      expect(result.status).toBe(signedIn ? 403 : 401);
      expect(writes).toBe(0);
    }
  });
}

for (const body of [
  { action: 'verify', challengeId: '-'.repeat(36), code: '123456' },
  { action: 'verify', challengeId: id, code: 123456 },
  { action: 'verify', challengeId: id, code: ['123456'] },
]) {
  test(`OTP rejects malformed input before invoking the verifier: ${typeof body.code}/${body.challengeId === id}`, async () => {
    let calls = 0;
    const route = loadSourceModule<typeof import('../src/app/api/auth/sms/route')>('src/app/api/auth/sms/route.ts', {
      '@/lib/server/sms-otp': smsBoundary,
      '@/lib/server/supabase-admin': { createSupabaseAdminClient: () => ({ rpc: async () => { calls++; return { data: true, error: null }; } }) },
    });
    const result = await route.POST(new Request('http://localhost/api/auth/sms', { method: 'POST', body: JSON.stringify(body) }));
    expect(result.status).toBe(410);
    expect(calls).toBe(0);
  });
}

for (const resource of ['phone', 'sms'] as const) {
  test(`${resource} route returns a retryable response when its admin dependency throws`, async () => {
    const route = loadSourceModule<{ PATCH: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> }>(`src/app/api/lanflow/admin/users/[id]/${resource}/route.ts`, {
      '@/lib/server/sms-otp': smsBoundary,
      '@/lib/server/auth': { requireRole: async () => ({ ok: true, auth: { sub: 'other-actor' } }) },
      '@/lib/server/supabase-admin': { createSupabaseAdminClient: () => { throw new Error('dependency unavailable'); } },
    });
    let result: Response | undefined;
    let escaped = false;
    try {
      result = await route.PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(resource === 'phone' ? { phone: '0812345678' } : { required: false }) }), { params: Promise.resolve({ id }) });
    } catch { escaped = true; }
    expect(escaped).toBe(false);
    expect(result?.status).toBe(503);
    expect(result?.headers.get('Cache-Control')).toContain('no-store');
  });
}

test('expired credentials are signed out, while an Auth outage remains retryable', async () => {
  for (const status of [401, 503]) {
    const module = loadSourceModule<typeof import('../src/lib/server/sms-otp')>('src/lib/server/sms-otp.ts', {
      '@/lib/supabase/server': {
        parseBearerToken: () => 'test-token',
        createSupabaseRequestClient: async () => ({ auth: { getClaims: async () => ({ error: { status }, data: null }) } }),
      },
    });
    let result: unknown;
    let rejected = false;
    try { result = await module.getSmsIdentity(new Request('http://localhost')); } catch { rejected = true; }
    expect(rejected).toBe(status === 503);
    if (status === 401) expect(result).toBeNull();
  }
});

test('a phone lookup outage is retryable rather than a missing account', async () => {
  const route = loadSourceModule<{ PATCH: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> }>('src/app/api/lanflow/admin/users/[id]/phone/route.ts', {
    '@/lib/server/sms-otp': smsBoundary,
    '@/lib/server/auth': { requireRole: async () => ({ ok: true, auth: { sub: 'other-actor' } }) },
    '@/lib/server/supabase-admin': { createSupabaseAdminClient: () => ({ auth: { admin: { getUserById: async () => ({ error: { status: 503 }, data: null }) } } }) },
  });
  const result = await route.PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ phone: '0812345678' }) }), { params: Promise.resolve({ id }) });
  expect(result.status).toBe(503);
});

test('a password-verifier outage is retryable rather than an incorrect password', async () => {
  const route = loadSourceModule<{ PATCH: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> }>('src/app/api/lanflow/admin/users/[id]/phone/route.ts', {
    '@/lib/server/sms-otp': smsBoundary,
    '@/lib/server/auth': { requireRole: async () => ({ ok: true, auth: { sub: id, phone: '0812345678' } }) },
    '@/lib/supabase/config': { getSupabaseUrl: () => 'http://localhost', getSupabasePublishableKey: () => 'test-key' },
    '@supabase/supabase-js': { createClient: () => ({ auth: { signInWithPassword: async () => ({ error: { status: 503 }, data: {} }) } }) },
  });
  const result = await route.PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ phone: '0812345679', currentPassword: 'test-password' }) }), { params: Promise.resolve({ id }) });
  expect(result.status).toBe(503);
});

test('self password change distinguishes an Auth outage from a wrong password', async () => {
  const route = loadSourceModule<{ POST: (r: Request) => Promise<Response> }>('src/app/api/auth/password/route.ts', {
    '@/lib/server/auth': { requireAuth: async () => ({ ok: true, auth: { sub: id, phone: '0812345678' } }) },
    '@/lib/supabase/config': { getSupabaseUrl: () => 'http://localhost', getSupabasePublishableKey: () => 'test-key' },
    '@supabase/supabase-js': { createClient: () => ({ auth: { signInWithPassword: async () => ({ error: { status: 503 }, data: {} }) } }) },
  });
  const result = await route.POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password', confirmPassword: 'new-password' }) }));
  expect(result.status).toBe(503);
  expect(result.headers.get('Retry-After')).toBe('3');
});
