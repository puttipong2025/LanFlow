import { test, expect } from '@playwright/test';

test('shows persisted count and locks the fifth send until the 30-minute reset', async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { errorCode: 'OTP_REQUIRED' } }));
  let sends = 0;
  await page.route('**/api/auth/sms', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { status: 'OTP_REQUIRED', sentCount: 4, sendLimit: 5, resendAt: new Date(now - 1000).toISOString() } });
    } else {
      sends++;
      await route.fulfill({ json: { challengeId: crypto.randomUUID(), sentCount: 5, sendLimit: 5, retryAfter: 30, resetAt: new Date(now + 1800_000).toISOString() } });
    }
  });
  await page.goto('/login');
  await expect(page.getByText('ขอรหัสแล้ว 4/5 ครั้งในรอบ 30 นาทีนี้')).toBeVisible();
  await page.getByRole('button', { name: 'รับรหัส SMS', exact: true }).click();
  await expect(page.getByText('ขอรหัสแล้ว 5/5 ครั้งในรอบ 30 นาทีนี้')).toBeVisible();
  await expect(page.getByText(/ขอได้อีกครั้ง.*อีก 29 นาที|ขอได้อีกครั้ง.*อีก 30 นาที/)).toBeVisible();
  await page.clock.runFor(31_000);
  await expect(page.getByRole('button', { name: 'ส่งรหัสอีกครั้ง', exact: true })).toBeDisabled();
  expect(sends).toBe(1);
  await page.clock.fastForward(1770_001);
  await expect(page.getByText('ขอรหัสแล้ว 0/5 ครั้งในรอบ 30 นาทีนี้')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ส่งรหัสอีกครั้ง', exact: true })).toBeEnabled();
});

test('shows a shared-network quota limit with the time sending becomes available', async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { errorCode: 'OTP_REQUIRED' } }));
  await page.route('**/api/auth/sms', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { status: 'OTP_REQUIRED', sentCount: 2, sendLimit: 5 } })
    : route.fulfill({ status: 429, json: { errorCode: 'RATE_LIMITED', retryAfter: 45, quota: { scope: 'ip', count: 50, limit: 50 }, error: 'โควตาเครือข่ายที่ใช้อยู่ 50/50 ครั้ง' } }));
  await page.goto('/login');
  await expect(page.getByText('ขอรหัสแล้ว 2/5 ครั้งในรอบ 30 นาทีนี้')).toBeVisible();
  await page.getByRole('button', { name: 'รับรหัส SMS', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('โควตาเครือข่ายที่ใช้อยู่ 50/50 ครั้ง');
  await expect(page.getByText(/ขอได้อีกครั้ง/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'รับรหัส SMS', exact: true })).toBeDisabled();
  await page.clock.runFor(46_000);
  await expect(page.getByRole('button', { name: 'รับรหัส SMS', exact: true })).toBeEnabled();
});

test('a delayed initial quota response cannot overwrite a completed send', async ({ page }) => {
  let release: () => void = () => {};
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { errorCode: 'OTP_REQUIRED' } }));
  await page.route('**/api/auth/sms', async route => {
    if (route.request().method() === 'GET') {
      await delayed;
      await route.fulfill({ json: { status: 'OTP_REQUIRED', sentCount: 0, sendLimit: 5 } });
    } else await route.fulfill({ json: { challengeId: crypto.randomUUID(), sentCount: 1, sendLimit: 5, retryAfter: 30 } });
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'รับรหัส SMS', exact: true }).click();
  await expect(page.getByText('ขอรหัสแล้ว 1/5 ครั้งในรอบ 30 นาทีนี้')).toBeVisible();
  const initial = page.waitForResponse(response => response.url().endsWith('/api/auth/sms') && response.request().method() === 'GET');
  release();
  await initial;
  await expect(page.getByText('ขอรหัสแล้ว 1/5 ครั้งในรอบ 30 นาทีนี้')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ส่งรหัสอีกครั้ง', exact: true })).toBeDisabled();
});

test('resets an unused 30-minute balance even after the resend countdown has ended', async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { errorCode: 'OTP_REQUIRED' } }));
  await page.route('**/api/auth/sms', route => route.fulfill({ json: {
    status: 'OTP_REQUIRED', sentCount: 2, sendLimit: 5,
    resendAt: new Date(now + 5000).toISOString(), resetAt: new Date(now + 45_000).toISOString(),
  } }));
  await page.goto('/login');
  await expect(page.getByText('ขอรหัสแล้ว 2/5 ครั้งในรอบ 30 นาทีนี้')).toBeVisible();
  await page.clock.runFor(6000);
  await expect(page.getByRole('button', { name: 'รับรหัส SMS', exact: true })).toBeEnabled();
  await page.clock.fastForward(60_000);
  await expect(page.getByText('ขอรหัสแล้ว 0/5 ครั้งในรอบ 30 นาทีนี้')).toBeVisible();
});

test('retries account loading after an accepted code without verifying the used code again', async ({ page, baseURL }) => {
  let accepted = false;
  let recovered = false;
  let verifications = 0;
  await page.addInitScript(id => sessionStorage.setItem('lanflow:sms-challenge', id), crypto.randomUUID());
  await page.route('**/api/auth/me', route => !accepted
    ? route.fulfill({ status: 401, json: { errorCode: 'OTP_REQUIRED' } })
    : !recovered ? route.fulfill({ status: 503, json: { error: 'temporary outage' } })
    : route.fulfill({ json: { profile: { id: 'fixture', role: 'admin', phone: '0812345678', name: 'Fixture', locationIds: [] } } }));
  await page.route('**/api/auth/sms', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { status: 'OTP_REQUIRED', sentCount: 1, sendLimit: 5 } });
    verifications++;
    if (accepted) return route.fulfill({ status: 409, json: { errorCode: 'NOT_REQUIRED' } });
    accepted = true;
    return route.fulfill({ json: { success: true } });
  });
  await page.route(new URL('/', baseURL).toString(), route => route.fulfill({ contentType: 'text/html', body: '<html><body>Verified account</body></html>' }));
  await page.goto('/login');
  await page.getByLabel('รหัส SMS 6 หลัก').fill('123456');
  await page.getByRole('button', { name: 'ยืนยันรหัส', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('กรุณาลองตรวจสถานะอีกครั้ง');
  await expect(page.getByRole('button', { name: 'ตรวจสถานะอีกครั้ง', exact: true })).toBeVisible();
  recovered = true;
  await page.getByRole('button', { name: 'ตรวจสถานะอีกครั้ง', exact: true }).click();
  await expect(page.getByText('Verified account')).toBeVisible();
  expect(verifications).toBe(1);
});
