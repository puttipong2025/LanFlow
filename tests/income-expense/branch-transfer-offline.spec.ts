import { test, expect } from '@playwright/test';

test.use({ storageState: 'playwright/.auth/admin.json' });

test.describe.serial('Income/Expense: Branch Transfer & Approval Offline Rules', () => {
  test('Super Admin configures keyword for offline test', async ({ page }) => {
    // Override storage state to super_admin for this test only
    const superAdminContext = await page.context().browser()?.newContext({ storageState: 'playwright/.auth/super_admin.json' });
    if (!superAdminContext) throw new Error('No browser');
    const saPage = await superAdminContext.newPage();
    
    await saPage.goto('/');
    await saPage.click('button:has-text("รับ-จ่าย")');
    await expect(saPage.locator('button:has-text("ตั้งค่าอนุมัติ")')).toBeVisible({ timeout: 10000 });

    await saPage.click('button:has-text("ตั้งค่าอนุมัติ")');
    const approvalModal = saPage.locator('.fixed.inset-0').last();
    await expect(approvalModal).toBeVisible();

    // Fill "offlinetest"
    const newKeywordInput = approvalModal.locator('input[placeholder="ข้อความที่ต้องตรวจ"]').first();
    await newKeywordInput.fill('offlinetest');
    
    // Save it
    await approvalModal.locator('button:has-text("เพิ่ม")').last().click();
    await saPage.waitForTimeout(1000);
    
    await superAdminContext.close();
  });

  test.describe('Admin actions', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("เพิ่มรายจ่าย")')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    test.afterEach(async ({ context }) => {
      await context.setOffline(false).catch(() => {});
    });

  test('Branch Transfer save is disabled when offline', async ({ page, context }) => {
    // Open branch transfer modal
    await page.click('button:has-text("โยกเงินไปสาขาอื่น")');
    const modal = page.locator('.fixed.inset-0').last();
    await expect(modal).toBeVisible();

    // Select target location to try enabling save button
    await modal.locator('select').first().selectOption({ index: 1 });

    // Try adding a slip manually to satisfy all form requirements
    await modal.locator('button:has-text("เพิ่มเอง")').click();

    // Go offline after opening modal
    await context.setOffline(true);

    // Verify warning message is visible
    await expect(modal.locator('text=รายการโยกเงินต้องออนไลน์ก่อนบันทึก')).toBeVisible();

    // The save button should still be disabled because we are offline
    const saveButton = modal.locator('button:has-text("บันทึก")').first();
    await expect(saveButton).toBeDisabled();

    // Close modal
    await modal.locator('button:has-text("ยกเลิก")').click();
  });

  test('Submitting expense matching approval keyword when offline throws warning', async ({ page, context }) => {
    // Note: In global.setup, we already added keyword "ยาง" for approvals
    
    // Open Add Expense
    await page.click('button:has-text("เพิ่มรายจ่าย")');
    const modal = page.locator('.fixed.inset-0').last();
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

    // Wait for react-query to fetch keywords before going offline
    // A small timeout is usually enough since the server is local
    await page.waitForTimeout(2000);

    // Type a keyword that triggers approval
    const lineInput = modal.locator('table tbody tr').first().locator('input').first();
    await lineInput.fill('offlinetest');
    const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
    await costInput.fill('100');

    // Go offline before clicking save
    await context.setOffline(true);

    // Click Save
    await modal.locator('button:has-text("บันทึกบิล")').click();

    // Toast error should appear from submitForApprovalIfNeeded
    await expect(page.locator('text=รายการนี้ต้องรออนุมัติ ต้องออนไลน์ก่อนบันทึก')).toBeVisible();
    
    // Modal should still be open (it didn't close because it threw an error)
    await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();
  });
});
});
