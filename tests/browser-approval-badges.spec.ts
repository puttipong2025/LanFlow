import { test, expect } from '@playwright/test';

test('branchless requests count in admin total and rows, not in branch badges', async ({ browser }) => {
  test.setTimeout(60_000);
  const context=await browser.newContext({storageState:'playwright/.auth/super_admin.json'});
  const page=await context.newPage();
  const target={id:'11111111-1111-4111-8111-111111111111',name:'Browser badge fixture',phone:'0854444444',role:'admin',isActive:true,locationIds:[],primaryLocationId:null};
  const other={...target,id:'22222222-2222-4222-8222-222222222222',name:'No pending request',phone:'0854444445'};
  let pending=false;
  try {
    await page.route('**/api/lanflow/admin/users',r=>r.fulfill({json:{users:[target,other]}}));
    await page.route('**/api/lanflow/admin/browser-approvals',r=>r.fulfill({json:{users:pending?[{
      userId:target.id,required:true,primaryLocationId:null,lastApprovedBy:null,lastApprovedAt:null,
      pending:[{id:'a',label:'Chrome · Windows',requestedAt:new Date().toISOString()},{id:'b',label:'Safari · iOS',requestedAt:new Date().toISOString()}],
    }]:[]}}));
    await page.goto('/');
    const selector=page.getByRole('button',{name:/^เลือกสาขา/});
    await expect(selector).toBeVisible({ timeout: 30_000 });
    const baseline=await selector.getAttribute('aria-label');
    pending=true;await page.reload();
    await expect(page.getByRole('button',{name:'Admin มีงานที่จัดการได้ 2 รายการ',exact:true})).toBeVisible();
    await expect(selector).toHaveAttribute('aria-label',baseline!);
    await page.getByRole('button',{name:'Admin มีงานที่จัดการได้ 2 รายการ',exact:true}).click();
    const all=page.getByRole('button',{name:'ทั้งหมด 2 คน',exact:true});
    const waiting=page.getByRole('button',{name:'รออนุมัติเบราว์เซอร์ 2 คำขอ',exact:true});
    await expect(all).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('row').filter({hasText:other.phone})).toBeVisible();
    const row=page.getByRole('row').filter({hasText:target.phone});
    await expect(row.getByText('รออนุมัติ 2',{exact:true})).toBeVisible();
    await expect(row.getByRole('button',{name:'อนุมัติ',exact:true})).toHaveCount(2);
    await page.getByRole('button', { name: /^รออนุมัติเบราว์เซอร์/ }).click();
    await expect(waiting).toHaveAttribute('aria-pressed','true');
    await expect(row).toBeVisible();
    await expect(page.getByRole('row').filter({hasText:other.phone})).toHaveCount(0);
    await all.click();
    await expect(page.getByRole('row').filter({hasText:other.phone})).toBeVisible();
  } finally { await context.close(); }
});
