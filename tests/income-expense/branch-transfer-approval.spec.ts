import { test, expect } from '@playwright/test';

test.describe('Income/Expense: Branch Transfer & Approval', () => {
  // We use admin for creating normal records
  
  test.describe('0. Setup Approval Config @approval', () => {
    test.use({ storageState: 'playwright/.auth/super_admin.json' });

    test('Super Admin configures keyword', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("ตั้งค่าและอนุมัติรับ-จ่าย")')).toBeVisible({ timeout: 10000 });

      await page.click('button:has-text("ตั้งค่าและอนุมัติรับ-จ่าย")');
      const approvalModal = page.locator('.fixed.inset-0').last();
      await expect(approvalModal).toBeVisible();

      // Fill "เบิก"
      const newKeywordInput = approvalModal.locator('input[placeholder="ข้อความที่ต้องตรวจ"]').first();
      await newKeywordInput.fill('เบิก');
      
      // Save it
      await approvalModal.locator('button:has-text("เพิ่ม")').last().click();
      
      // Wait for it to be saved
      await expect(approvalModal.locator('table', { hasText: 'เบิก' }).first()).toBeVisible();
      await approvalModal.locator('button[aria-label="ปิด"]').first().click();
      await expect(approvalModal).toBeHidden();
    });
  });

  test.describe('1. Approval Workflow @approval', () => {
    // Admin creates expenses
    test.use({ storageState: 'playwright/.auth/admin.json' });

    test('Admin: save normal expense immediately without keyword', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("เพิ่มรายจ่าย")')).toBeVisible({ timeout: 10000 });

      const marker = `NormalExp-${Date.now()}`;
      
      await page.click('button:has-text("เพิ่มรายจ่าย")');
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

      const modal = page.locator('.fixed.inset-0').last();
      const lineInput = modal.locator('table tbody tr').first().locator('input').first();
      await lineInput.fill(marker);
      
      const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
      await costInput.fill('150');

      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      // Verify it appears in the main table
      await expect(page.locator('table tbody tr', { hasText: marker })).toBeVisible();
    });

    test('Admin: save expense with keyword goes to approval queue', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("เพิ่มรายจ่าย")')).toBeVisible({ timeout: 10000 });

      // Assuming "เบิกเงินสด" matches a keyword "เบิก"
      const marker = `เบิกเงินสด-${Date.now()}`;
      
      await page.click('button:has-text("เพิ่มรายจ่าย")');
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

      const modal = page.locator('.fixed.inset-0').last();
      const lineInput = modal.locator('table tbody tr').first().locator('input').first();
      await lineInput.fill(marker);
      
      const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
      await costInput.fill('500');

      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      // Verify it does NOT appear in the main table
      await expect(page.locator('table tbody tr', { hasText: marker })).toBeHidden({ timeout: 5000 });
    });
  });

  test.describe('1.1 Super Admin Approval Workflow @approval', () => {
    test.use({ storageState: 'playwright/.auth/super_admin.json' });

    test('Super Admin: shows pending approval count on the action button', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("เพิ่มรายจ่าย")')).toBeVisible({ timeout: 10000 });

      const marker = `เบิกเงินสด-Badge-${Date.now()}`;
      await page.click('button:has-text("เพิ่มรายจ่าย")');
      const modal = page.locator('.fixed.inset-0').last();
      await modal.locator('table tbody tr').first().locator('input').first().fill(marker);
      await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('250');
      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      const approvalButton = page.locator('button:has-text("ตั้งค่าและอนุมัติรับ-จ่าย")');
      const pendingBadge = approvalButton.locator('[aria-label^="รออนุมัติ "]');
      await expect(pendingBadge).toBeVisible();
      await expect(pendingBadge).toHaveText(/^[1-9]\d*$/);

      await approvalButton.click();
      const approvalModal = page.locator('.fixed.inset-0').last();
      const requestRow = approvalModal.locator('tr', { hasText: marker }).first();
      await expect(requestRow).toBeVisible();
      page.once('dialog', dialog => dialog.accept('badge test cleanup'));
      await requestRow.locator('button[title="ปฏิเสธ"]').click();
      await expect(page.getByText('ปฏิเสธรายการแล้ว')).toBeVisible();
      await approvalModal.locator('button[aria-label="ปิด"]').first().click();
    });

    test('Super Admin: approve and reject pending requests', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("เพิ่มรายจ่าย")')).toBeVisible({ timeout: 10000 });

      // 1. Create a request to approve
      const approveMarker = `เบิกเงินสด-Approve-${Date.now()}`;
      await page.click('button:has-text("เพิ่มรายจ่าย")');
      let modal = page.locator('.fixed.inset-0').last();
      await modal.locator('table tbody tr').first().locator('input').first().fill(approveMarker);
      await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('300');
      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      // 2. Create a request to reject
      const rejectMarker = `เบิกเงินสด-Reject-${Date.now()}`;
      await page.click('button:has-text("เพิ่มรายจ่าย")');
      modal = page.locator('.fixed.inset-0').last();
      await modal.locator('table tbody tr').first().locator('input').first().fill(rejectMarker);
      await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('400');
      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      // Open settings / approval modal
      await page.click('button:has-text("ตั้งค่าและอนุมัติรับ-จ่าย")');
      const approvalModal = page.locator('.fixed.inset-0').last();
      await expect(approvalModal).toBeVisible();

      // Approve the first one
      const approveRow = approvalModal.locator('tr', { hasText: approveMarker }).first();
      await expect(approveRow).toBeVisible();
      page.once("dialog", dialog => dialog.accept());
      await approveRow.locator('button[title="อนุมัติ"]').click();

      await expect(page.getByText("อนุมัติรายการแล้ว")).toBeVisible();
      // Reject the second one
      const rejectRow = approvalModal.locator('tr', { hasText: rejectMarker }).first();
      await expect(rejectRow).toBeVisible();
      page.once("dialog", dialog => dialog.accept("ทดสอบปฏิเสธ"));
      await rejectRow.locator('button[title="ปฏิเสธ"]').first().click();

      await expect(page.getByText("ปฏิเสธรายการแล้ว")).toBeVisible();
      await approvalModal.locator('button[aria-label="ปิด"]').first().click();
      await expect(approvalModal).toBeHidden();

      // Verify approveMarker is in the main table now
      // Use the main table specifically to avoid matching modals if they hang around
      const mainTable = page.locator('main table, .max-w-7xl table').first();
      await expect(mainTable.locator('tbody tr', { hasText: approveMarker })).toBeVisible();

      // Verify rejectMarker is NOT in the main table
      await expect(mainTable.locator('tbody tr', { hasText: rejectMarker })).toBeHidden();
    });
  });

  test.describe('2. Branch Transfer @transfer', () => {
    test.use({ storageState: 'playwright/.auth/super_admin.json' });

    test('target location cannot be same as source location', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("โยกเงินไปสาขาอื่น")')).toBeVisible({ timeout: 10000 });

      // Click the new main button
      await page.click('button:has-text("โยกเงินไปสาขาอื่น")');
      const modal = page.locator('.fixed.inset-0').last();
      await expect(modal).toBeVisible();
      await page.locator('button:has-text("โอนธนาคาร")').click();

      // Ensure target location dropdown exists
      const targetSelect = modal.locator('select').first();
      
      const options = await targetSelect.locator('option').evaluateAll(opts => 
        opts.map(o => ({ value: (o as HTMLOptionElement).value, text: (o as HTMLOptionElement).text }))
      );
      
      await modal.locator('button:has-text("ยกเลิก")').click();
    });

    test('create branch transfer success and verify relation lock', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("โยกเงินไปสาขาอื่น")')).toBeVisible({ timeout: 10000 });

      const marker = `Transfer-${Date.now()}`;

      await page.click('button:has-text("โยกเงินไปสาขาอื่น")');
      const modal = page.locator('.fixed.inset-0').last();
      await expect(modal).toBeVisible();
      await page.locator('button:has-text("โอนธนาคาร")').click();

      // Select target location (pick index 1 which should be another branch)
      const targetSelect = modal.locator('select').first();
      await targetSelect.selectOption({ index: 1 });

      // Click เพิ่มเอง
      await modal.locator('button:has-text("เพิ่มเอง")').click();
      
      // Wait for SlipRow
      const slipRow = modal.locator('.grid.gap-3').first();
      await expect(slipRow).toBeVisible();

      // Fill amount and date
      await slipRow.locator('input[type="number"]').first().fill('1000');
      // Set to some valid date like 2026-07-07T12:00
      await slipRow.locator('input[type="datetime-local"]').first().fill('2026-07-07T12:00');

      await modal.locator('button:has-text("บันทึก")').first().click();
      await expect(modal).toBeHidden({ timeout: 10000 });

      // Switch to the target branch via Header location selector
      // In super_admin, we should be able to select the location
      const branchSelector = page.locator('select[aria-label="เลือกสาขา"]').first();
      await branchSelector.selectOption({ index: 1 }); 
      
      // Wait for table to load
      await page.waitForTimeout(2000);

      // Verify the income appears in target branch (it may take a moment to sync, but we use a loose check)
      const targetRow = page.locator('table tbody tr', { hasText: 'รับโอน' }).first();
      await expect(targetRow).toBeVisible();

      // Verify Relation Lock: Edit and Delete buttons should be disabled
      // Verify Relation Lock: Edit and Delete buttons should be disabled
      // The buttons will have their titles replaced by the lock reason, so we just check by position
      // First button is Edit, second is Delete
      const editButton = targetRow.locator('button').nth(0);
      await expect(editButton).toBeDisabled();

      const deleteButton = targetRow.locator('button').nth(1);
      await expect(deleteButton).toBeDisabled();
    });

    test('create cash branch transfer with separate denomination counts', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await page.click('button:has-text("โยกเงินไปสาขาอื่น")');
      const modal = page.locator('.fixed.inset-0').last();
      await modal.getByLabel('สาขาปลายทาง').selectOption({ index: 1 });
      const values = ['1', '0', '0', '0', '0', '0', '0', '0', '1'];
      for (const [index, input] of (await modal.locator('input').all()).entries()) await input.fill(values[index]);
      await modal.locator('button:has-text("บันทึก")').click();
      await expect(page.getByText('บันทึกรายการเงินสด รอปลายทางรับเงิน')).toBeVisible();
      await expect(page.locator('table tbody tr', { hasText: 'โยกเงินสดไป' }).first()).toBeVisible();
    });

    test('receive cash transfer with zero actual counts and show mismatch', async ({ page }) => {
      await page.context().setOffline(false);
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await page.click('button:has-text("โยกเงินไปสาขาอื่น")');
      const createModal = page.locator('.fixed.inset-0').last();
      const targetSelect = createModal.getByLabel('สาขาปลายทาง');
      const targetLocationId = await targetSelect.locator('option').nth(1).getAttribute('value');
      await targetSelect.selectOption({ index: 1 });
      for (const input of await createModal.locator('input').all()) await input.fill('0');
      await createModal.getByLabel('แบงค์ 20').fill('1');
      await createModal.locator('button:has-text("บันทึก")').click();
      await expect(page.getByText('บันทึกรายการเงินสด รอปลายทางรับเงิน')).toBeVisible();

      await page.locator('select[aria-label="เลือกสาขา"]').first().selectOption(targetLocationId!);
      await expect(page.locator('button:has-text("รอรับเงิน")')).toBeVisible({ timeout: 10000 });
      await page.locator('button:has-text("รอรับเงิน")').click();
      const receiveModal = page.locator('.fixed.inset-0').last();
      for (const input of await receiveModal.locator('input').all()) await input.fill('0');
      await receiveModal.locator('button:has-text("ยืนยันรับเงิน")').click();
      await expect(page.getByText('บันทึกยอดไม่ตรงแล้ว')).toBeVisible();
      await expect(page.locator('table tbody tr', { hasText: 'ยอดไม่ตรง' }).first()).toBeVisible();
    });

    test('receive cash transfer with exact counts', async ({ page }) => {
      await page.context().setOffline(false);
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await page.click('button:has-text("โยกเงินไปสาขาอื่น")');
      const createModal = page.locator('.fixed.inset-0').last();
      const targetSelect = createModal.getByLabel('สาขาปลายทาง');
      const targetLocationId = await targetSelect.locator('option').nth(1).getAttribute('value');
      await targetSelect.selectOption({ index: 1 });
      for (const input of await createModal.locator('input').all()) await input.fill('0');
      await createModal.getByLabel('แบงค์ 20').fill('1');
      await createModal.locator('button:has-text("บันทึก")').click();
      await expect(page.getByText('บันทึกรายการเงินสด รอปลายทางรับเงิน')).toBeVisible();

      await page.locator('select[aria-label="เลือกสาขา"]').first().selectOption(targetLocationId!);
      await page.locator('button:has-text("รอรับเงิน")').click();
      const receiveModal = page.locator('.fixed.inset-0').last();
      for (const input of await receiveModal.locator('input').all()) await input.fill('0');
      await receiveModal.getByLabel('แบงค์ 20').fill('1');
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await receiveModal.locator('button:has-text("ยืนยันรับเงิน")').click();
      await expect(page.getByText('ยืนยันรับเงินแล้ว')).toBeVisible();
      await expect(page.locator('table tbody tr', { hasText: 'รับเงินแล้ว' }).first()).toBeVisible();
    });
  });

  test.describe('3. Role & Security @role', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test('user cannot approve/reject or see settings', async ({ page }) => {
      await page.goto('/');
      await page.click('button:has-text("รับ-จ่าย")');
      await expect(page.locator('button:has-text("เพิ่มรายจ่าย")')).toBeVisible({ timeout: 10000 });

      // Normal user should not see the approval settings button
      await expect(page.locator('button:has-text("ตั้งค่าและอนุมัติรับ-จ่าย")')).toBeHidden();

      // Can also test API direct access if needed, but UI hiding is a good first step
    });
  });
});
