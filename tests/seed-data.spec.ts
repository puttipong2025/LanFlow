import { test, expect, Page } from '@playwright/test';

test.describe('Seed Data', () => {
  const phone = process.env.TEST_PHONE || '0800000000';
  const password = process.env.TEST_PASSWORD || 'password123';

  test('Seed Rubber Bills and Income/Expense', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes

    // 1. Login
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/login');
    await page.fill('input[type="tel"]', phone);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("เข้าสู่ระบบ")');
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
    // Rubber Bills were already seeded, skipping to Income/Expense

    // 2. Go to Income/Expense tab and create 30 items

    await page.click('button:has-text("รับ-จ่าย")');
    await expect(page.locator('button:has-text("เพิ่มรายรับ")')).toBeVisible({ timeout: 10000 });

    for (let i = 1; i <= 30; i++) {
      const isIncome = i % 2 !== 0;
      const marker = `Seed-${isIncome ? 'Inc' : 'Exp'}-${Date.now()}-${i}`;

      if (isIncome) {
        await page.click('button:has-text("เพิ่มรายรับ")');
      } else {
        await page.click('button:has-text("เพิ่มรายจ่าย")');
      }
      
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

      const modal = page.locator('.fixed.inset-0').last();
      const lineInput = modal.locator('table tbody tr').first().locator('input').first();
      await lineInput.fill(marker);
      
      const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
      await costInput.fill((1000 + i * 100).toString());

      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });
      console.log(`Created ${isIncome ? 'Income' : 'Expense'} ${i}/15`);
    }

    // Wait for syncs to complete roughly
    await page.waitForTimeout(5000);
  });
});
