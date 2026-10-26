import { test, expect } from '@playwright/test';

test('waiting countdown polls without creating more requests, then enters after approval', async ({ page }) => {
  await page.clock.install();
  let approved = false, requests = 0, polls = 0;
  await page.route('**/api/auth/browser', async route => {
    if (route.request().method() === 'POST') requests++; else polls++;
    await route.fulfill({ json: { status: approved ? 'READY' : 'PENDING' } });
  });
  await page.route('**/api/auth/me', route => route.fulfill({ status: approved ? 503 : 401, json: approved ? { error: 'outage' } : { errorCode: 'OTP_REQUIRED' } }));
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'รออนุมัติเบราว์เซอร์' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('10 วินาที');
  const before = requests;
  await page.clock.runFor(11_000);
  await expect.poll(() => polls).toBeGreaterThan(1);
  expect(requests).toBe(before);
  approved = true;
  await page.getByRole('button', { name: 'ตรวจสถานะอีกครั้ง', exact: true }).click();
  await expect(page.locator('main [role=alert]')).toContainText('อนุมัติแล้ว');
});

test('cancelled request only returns after explicit resubmit', async ({ page }) => {
  await page.clock.install();
  let resubmits = 0;
  await page.route('**/api/auth/browser', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'resubmit') resubmits++;
    await route.fulfill({ json: { status: resubmits ? 'PENDING' : 'CANCELLED' } });
  });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { errorCode: 'OTP_REQUIRED' } }));
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'ขออนุมัติอีกครั้ง' })).toBeVisible();
  await page.clock.runFor(21_000);
  expect(resubmits).toBe(0);
  await page.getByRole('button', { name: 'ขออนุมัติอีกครั้ง' }).click();
  await expect(page.getByRole('status')).toContainText('10 วินาที');
  expect(resubmits).toBe(1);
});

test('status outages do not enter business screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/browser', route => route.fulfill({ status: 503, json: { error: 'บริการไม่พร้อม' } }));
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { errorCode: 'OTP_REQUIRED' } }));
  await page.goto('/login');
  await expect(page.locator('main [role=alert]')).toHaveText('บริการไม่พร้อม');
  await expect(page.getByRole('heading', { name: 'รออนุมัติเบราว์เซอร์' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const retry=page.getByRole('button', { name: 'ตรวจสถานะอีกครั้ง', exact: true });
  await retry.focus();await page.keyboard.press('Enter');
  await expect(page.locator('main [role=alert]')).toHaveText('บริการไม่พร้อม');
});
