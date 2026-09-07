import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  confirmCurrentBranchIfRequired,
  selectAppLocation,
  selectFirstAccessibleOption,
  selectedAppLocationId,
} from '../helpers/select-app-location';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55421';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const superAdminId = process.env.TEST_USER_ID ?? '00000000-0000-4000-8000-000000000001';
const transferLocationId = crypto.randomUUID();

async function ensureLoggedIn(page: import("@playwright/test").Page, role: "admin" | "super_admin") {
  await page.goto("/");
  await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).or(page.locator('input[type="tel"]')).first().waitFor({
    state: "visible",
    timeout: 30000,
  });
  if (await page.locator('input[type="tel"]').isVisible()) {
    await page.fill('input[type="tel"]', role === "admin" ? "0810000001" : process.env.TEST_PHONE || "0800000000");
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD || "password123");
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await expect(page.locator('text=ออกจากระบบ')).toBeVisible({ timeout: 30000 });
  }
}

test.describe('Income/Expense: Branch Transfer & Approval', () => {
  // We use admin for creating normal records

  test.beforeAll(async () => {
    expect(serviceRoleKey).toBeTruthy();
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await db.from('locations').insert({
      id: transferLocationId,
      name: `สาขาปลายทางทดสอบ ${transferLocationId.slice(0, 6)}`,
      code: `BT${transferLocationId.replaceAll('-', '').slice(0, 6).toUpperCase()}`,
      is_active: true,
    })).error).toBeNull();
    expect((await db.from('user_locations').insert({
      user_id: superAdminId,
      location_id: transferLocationId,
      is_primary: false,
    })).error).toBeNull();
  });

  test.afterAll(async () => {
    if (!serviceRoleKey) return;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await db
      .from('money_transfers')
      .delete()
      .or(`location_id.eq.${transferLocationId},target_location_id.eq.${transferLocationId}`)).error).toBeNull();
    expect((await db.from('user_locations').delete().eq('location_id', transferLocationId)).error).toBeNull();
    expect((await db.from('locations').delete().eq('id', transferLocationId)).error).toBeNull();
  });
  
  test.describe('0. Setup Approval Config @approval', () => {
    test.use({ storageState: 'playwright/.auth/super_admin.json' });

    test('Super Admin configures keyword', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await expect(page.getByRole('button', { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ })).toBeVisible({ timeout: 10000 });

      await page.getByRole('button', { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();
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
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await expect(page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true })).toBeVisible({ timeout: 10000 });

      const marker = `NormalExp-${Date.now()}`;
      
      await page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true }).click();
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
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await expect(page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true })).toBeVisible({ timeout: 10000 });

      // Assuming "เบิกเงินสด" matches a keyword "เบิก"
      const marker = `เบิกเงินสด-${Date.now()}`;
      
      await page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true }).click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeVisible();

      const modal = page.locator('.fixed.inset-0').last();
      const lineInput = modal.locator('table tbody tr').first().locator('input').first();
      await lineInput.fill(marker);
      
      const costInput = modal.locator('table tbody tr').first().locator('input[type="number"]').first();
      await costInput.fill('500');

      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      // Pending requests remain visible as locked placeholders in the main table.
      const pendingRow = page.locator('table tbody tr', { hasText: marker }).first();
      await expect(pendingRow).toBeVisible();
      await expect(pendingRow).toContainText('รออนุมัติ');
    });
  });

  test.describe('1.1 Super Admin Approval Workflow @approval', () => {
    test.use({ storageState: 'playwright/.auth/super_admin.json' });

    test('Super Admin: shows pending approval count on the module nav and approval button', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await expect(page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true })).toBeVisible({ timeout: 10000 });

      const marker = `เบิกเงินสด-Badge-${Date.now()}`;
      await page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true }).click();
      await confirmCurrentBranchIfRequired(page);
      const modal = page.locator('.fixed.inset-0').last();
      await modal.locator('table tbody tr').first().locator('input').first().fill(marker);
      await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('250');
      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      const approvalButton = page.getByRole('button', { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ });
      await expect(
        page.getByRole('navigation').getByRole('button', {
          name: /^รับ-จ่าย มีงานที่จัดการได้ [1-9]\d* รายการ$/,
        }),
      ).toBeVisible();
      await expect(approvalButton).toHaveAccessibleName(
        /^ตั้งค่าและอนุมัติรับ-จ่าย รออนุมัติ [1-9]\d* รายการ$/,
      );

      await approvalButton.click();
      const approvalModal = page.locator('.fixed.inset-0').last();
      const requestRow = approvalModal.locator('tr', { hasText: marker }).first();
      await expect(requestRow).toBeVisible();
      await requestRow.locator('button[title="ปฏิเสธ"]').click();
      const rejectDialog = page.getByRole('dialog', { name: 'ปฏิเสธรายการ' });
      await rejectDialog.getByLabel('เหตุผลที่ปฏิเสธ (ไม่บังคับ)').fill('badge test cleanup');
      await rejectDialog.getByRole('button', { name: 'ยืนยัน' }).click();
      await expect(page.getByText('ปฏิเสธรายการแล้ว')).toBeVisible();
      await approvalModal.locator('button[aria-label="ปิด"]').first().click();
    });

    test('Super Admin: approve and reject pending requests', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await expect(page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true })).toBeVisible({ timeout: 10000 });

      // 1. Create a request to approve
      const approveMarker = `เบิกเงินสด-Approve-${Date.now()}`;
      await page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true }).click();
      await confirmCurrentBranchIfRequired(page);
      let modal = page.locator('.fixed.inset-0').last();
      await modal.locator('table tbody tr').first().locator('input').first().fill(approveMarker);
      await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('300');
      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      // 2. Create a request to reject
      const rejectMarker = `เบิกเงินสด-Reject-${Date.now()}`;
      await page.getByRole('button', { name: 'เพิ่มรายจ่าย', exact: true }).click();
      modal = page.locator('.fixed.inset-0').last();
      await modal.locator('table tbody tr').first().locator('input').first().fill(rejectMarker);
      await modal.locator('table tbody tr').first().locator('input[type="number"]').first().fill('400');
      await modal.locator('button:has-text("บันทึกบิล")').click();
      await expect(page.locator('h2:has-text("เพิ่ม/แก้ไข บิลเงินสด")')).toBeHidden({ timeout: 10000 });

      // Open settings / approval modal
      await page.getByRole('button', { name: /^ตั้งค่าและอนุมัติรับ-จ่าย/ }).click();
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
      await rejectRow.locator('button[title="ปฏิเสธ"]').first().click();
      const rejectDialog = page.getByRole('dialog', { name: 'ปฏิเสธรายการ' });
      await rejectDialog.getByLabel('เหตุผลที่ปฏิเสธ (ไม่บังคับ)').fill('ทดสอบปฏิเสธ');
      await rejectDialog.getByRole('button', { name: 'ยืนยัน' }).click();
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
    test.beforeEach(async ({ page }) => ensureLoggedIn(page, "super_admin"));

    test('target location cannot be same as source location', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await expect(page.getByRole('button', { name: 'โยกเงินไปสาขาอื่น', exact: true })).toBeVisible({ timeout: 10000 });

      // Click the new main button
      await page.getByRole('button', { name: 'โยกเงินไปสาขาอื่น', exact: true }).click();
      await confirmCurrentBranchIfRequired(page);
      const modal = page.locator('.fixed.inset-0').last();
      await expect(modal).toBeVisible();

      // Ensure target location dropdown exists
      const targetSelect = modal.getByLabel('สาขาปลายทาง');
      
      const sourceLocationId = await selectedAppLocationId(page);
      expect(sourceLocationId).toBeTruthy();
      // The source branch is omitted altogether, so it cannot be submitted as a target.
      await expect(targetSelect.locator(`option[value="${sourceLocationId}"]`)).toHaveCount(0);
      
      await modal.locator('button:has-text("ยกเลิก")').click();
    });

    test('create cash branch transfer with separate denomination counts', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await page.getByRole('button', { name: 'โยกเงินไปสาขาอื่น', exact: true }).click();
      await confirmCurrentBranchIfRequired(page);
      const modal = page.locator('.fixed.inset-0').last();
      await selectFirstAccessibleOption(page, modal.getByLabel('สาขาปลายทาง'));
      const values = ['1', '0', '0', '0', '0', '0', '0', '0', '1'];
      for (const [index, input] of (await modal.locator('input').all()).entries()) await input.fill(values[index]);
      await modal.locator('button:has-text("บันทึก")').click();
      await expect(page.getByText('บันทึกรายการเงินสด รอปลายทางรับเงิน')).toBeVisible();
      await expect(page.locator('table tbody tr', { hasText: 'โยกเงินสดไป' }).first()).toBeVisible();
    });

    test('receive cash transfer with zero actual counts and finish with visible difference', async ({ page }) => {
      await page.context().setOffline(false);
      await page.goto('/');
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await page.getByRole('button', { name: 'โยกเงินไปสาขาอื่น', exact: true }).click();
      await confirmCurrentBranchIfRequired(page);
      const createModal = page.locator('.fixed.inset-0').last();
      const targetSelect = createModal.getByLabel('สาขาปลายทาง');
      const targetLocationId = await selectFirstAccessibleOption(page, targetSelect);
      for (const input of await createModal.locator('input').all()) await input.fill('0');
      await createModal.getByLabel('แบงค์ 20').fill('1');
      const [createResponse] = await Promise.all([
        page.waitForResponse((response) => response.url().includes('/api/lanflow/cash-branch-transfers') && response.request().method() === 'POST'),
        createModal.locator('button:has-text("บันทึก")').click(),
      ]);
      expect(createResponse.ok()).toBeTruthy();
      const transfer = await createResponse.json() as { id: string };
      await expect(page.getByText('บันทึกรายการเงินสด รอปลายทางรับเงิน')).toBeVisible();

      await selectAppLocation(page, targetLocationId!);
      const pendingTransfer = page.locator(`button[data-transfer-id="${transfer.id}"]`);
      await expect(pendingTransfer).toBeVisible({ timeout: 10000 });
      await pendingTransfer.click();
      const receiveModal = page.locator('.fixed.inset-0').last();
      await receiveModal.getByRole('button', { name: 'ยอดรับไม่ตรง', exact: true }).click();
      for (const input of await receiveModal.locator('input').all()) await input.fill('0');
      await receiveModal.locator('button:has-text("ยืนยันรับเงิน")').click();
      await expect(page.getByText('ยืนยันรับเงินและบันทึกผลต่างแล้ว')).toBeVisible();
      await expect(receiveModal).toBeHidden();
    });

    test('receive cash transfer with exact counts', async ({ page }) => {
      await page.context().setOffline(false);
      await page.goto('/');
      await page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ }).click();
      await page.getByRole('button', { name: 'โยกเงินไปสาขาอื่น', exact: true }).click();
      await confirmCurrentBranchIfRequired(page);
      const createModal = page.locator('.fixed.inset-0').last();
      const targetSelect = createModal.getByLabel('สาขาปลายทาง');
      const targetLocationId = await selectFirstAccessibleOption(page, targetSelect);
      for (const input of await createModal.locator('input').all()) await input.fill('0');
      await createModal.getByLabel('แบงค์ 20').fill('1');
      const [createResponse] = await Promise.all([
        page.waitForResponse((response) => response.url().includes('/api/lanflow/cash-branch-transfers') && response.request().method() === 'POST'),
        createModal.locator('button:has-text("บันทึก")').click(),
      ]);
      expect(createResponse.ok()).toBeTruthy();
      const transfer = await createResponse.json() as { id: string };
      await expect(page.getByText('บันทึกรายการเงินสด รอปลายทางรับเงิน')).toBeVisible();

      await selectAppLocation(page, targetLocationId!);
      const pendingTransfer = page.locator(`button[data-transfer-id="${transfer.id}"]`);
      await expect(pendingTransfer).toBeVisible({ timeout: 10000 });
      await pendingTransfer.click();
      const receiveModal = page.locator('.fixed.inset-0').last();
      await expect(receiveModal.getByText('ยอดรับเริ่มต้นตรงกับยอดที่ส่งและยังแก้ไขไม่ได้')).toBeVisible();
      await expect(receiveModal.getByLabel('แบงค์ 20')).toHaveValue('1');
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await receiveModal.locator('button:has-text("ยืนยันรับเงิน")').click();
      await expect(page.getByText('ยืนยันรับเงินแล้ว')).toBeVisible();
      await expect(receiveModal).toBeHidden();
    });
  });

  test.describe('3. Role & Security @role', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test('user sees only the time and payroll shell', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'เวลาและเงินเดือน' })).toBeVisible();
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^รับ-จ่าย(?: |$)/ })).toHaveCount(0);
    });
  });
});
