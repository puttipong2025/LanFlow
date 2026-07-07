import { test, expect, Page } from '@playwright/test';

const phone = process.env.TEST_PHONE || '0800000000';
const password = process.env.TEST_PASSWORD || 'password123';
const NUM_RECORDS = 10;

test('Seed Data: Rubber Bills and Income/Expense', async ({ page }) => {
  test.setTimeout(300000); // 5 minutes timeout

  // 1. Login
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/login');
  await page.fill('input[type="tel"]', phone);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("เข้าสู่ระบบ")');
  await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });

  // 2. Add Rubber Bills
  await page.click('button:has-text("บิลยาง")');
  await expect(page.locator('button:has-text("เพิ่มบิลยาง")')).toBeVisible({ timeout: 10000 });

  for (let i = 1; i <= NUM_RECORDS; i++) {
    const marker = `Seed-Rubber-${Date.now()}-${i}`;
    await page.click('button:has-text("เพิ่มบิลยาง")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeVisible();
    
    const customerInput = page.locator('input[placeholder*="ค้นหาชื่อ หรือ รหัสสมาชิก"]');
    await customerInput.fill(marker);
    await page.keyboard.press('Escape');

    const modal = page.locator('.fixed.inset-0').last();
    const weighRow = modal.locator('table').first().locator('tbody tr').first();
    await weighRow.locator('input[type="number"]').nth(0).fill((1000 + i * 10).toString()); // inWeight
    await weighRow.locator('input[type="number"]').nth(1).fill('200'); // outWeight
    await weighRow.locator('input[type="number"]').nth(3).fill('25.5'); // price

    await page.click('button:has-text("Submit")');
    await expect(page.locator('h2:has-text("บิลเครื่องชั่งเล็ก")')).toBeHidden({ timeout: 10000 });
    
    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });
    console.log(`Created Rubber Bill ${i}/${NUM_RECORDS}`);
  }

  // 3. Add Income/Expense
  await page.click('button:has-text("รายรับ-รายจ่าย")');
  await expect(page.locator('button:has-text("เพิ่มรายรับ")')).toBeVisible({ timeout: 10000 });

  // Add Incomes
  for (let i = 1; i <= NUM_RECORDS; i++) {
    const marker = `Seed-Income-${Date.now()}-${i}`;
    await page.click('button:has-text("เพิ่มรายรับ")');
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

    const modal = page.locator('.fixed.inset-0').last();
    const lineInput = modal.locator('table tbody tr').first().locator('input').first();
    await lineInput.fill(marker);
    const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
    await costInput.fill((1000 + i * 100).toString());

    await modal.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });
    console.log(`Created Income ${i}/${NUM_RECORDS}`);
  }

  // Add Expenses
  for (let i = 1; i <= NUM_RECORDS; i++) {
    const marker = `Seed-Expense-${Date.now()}-${i}`;
    await page.click('button:has-text("เพิ่มรายจ่าย")');
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

    const modal = page.locator('.fixed.inset-0').last();
    const lineInput = modal.locator('table tbody tr').first().locator('input').first();
    await lineInput.fill(marker);
    const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
    await costInput.fill((500 + i * 50).toString());

    await modal.locator('button:has-text("บันทึกบิล")').click();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

    const row = page.locator('table tbody tr', { hasText: marker }).first();
    await expect(row.locator('span:has-text("ซิงก์แล้ว")')).toBeVisible({ timeout: 20000 });
    console.log(`Created Expense ${i}/${NUM_RECORDS}`);
  }

  console.log('Seed completed successfully!');
});
