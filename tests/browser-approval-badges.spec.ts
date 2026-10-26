import { test, expect } from '@playwright/test';

test('branchless requests count in admin total and rows, not in branch badges', async ({ browser }) => {
  const context=await browser.newContext({storageState:'playwright/.auth/super_admin.json'});
  const page=await context.newPage();
  const target={id:'11111111-1111-4111-8111-111111111111',name:'Browser badge fixture',phone:'0854444444',role:'admin',isActive:true,locationIds:[],primaryLocationId:null};
  let pending=false;
  try {
    await page.route('**/api/lanflow/admin/users',r=>r.fulfill({json:{users:[target]}}));
    await page.route('**/api/lanflow/admin/browser-approvals',r=>r.fulfill({json:{users:pending?[{
      userId:target.id,required:true,primaryLocationId:null,lastApprovedBy:null,lastApprovedAt:null,
      pending:[{id:'a',label:'Chrome · Windows',requestedAt:new Date().toISOString()},{id:'b',label:'Safari · iOS',requestedAt:new Date().toISOString()}],
    }]:[]}}));
    await page.goto('/');
    const selector=page.getByRole('button',{name:/^เลือกสาขา/});
    await expect(selector).toBeVisible();
    const baseline=await selector.getAttribute('aria-label');
    pending=true;await page.reload();
    await expect(page.getByRole('button',{name:'Admin มีงานที่จัดการได้ 2 รายการ',exact:true})).toBeVisible();
    await expect(selector).toHaveAttribute('aria-label',baseline!);
    await page.getByRole('button',{name:'Admin มีงานที่จัดการได้ 2 รายการ',exact:true}).click();
    const row=page.getByRole('row').filter({hasText:target.phone});
    await expect(row.getByText('รออนุมัติ 2',{exact:true})).toBeVisible();
    await expect(row.getByRole('button',{name:'อนุมัติ',exact:true})).toHaveCount(2);
    await page.getByLabel('รออนุมัติเบราว์เซอร์').check();
    await expect(row).toBeVisible();
  } finally { await context.close(); }
});
