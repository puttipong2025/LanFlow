import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt, randomUUID } from 'node:crypto';

test('real browser flow: two tabs, approval, remembered login and revoke-all', async ({ browser }) => {
  test.setTimeout(45_000);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):55421\/?$/);
  const admin=createClient(url,process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const password=`Browser-${randomUUID()}`;
  const ids:string[]=[];
  const contexts=[];
  async function fixture(role:'super_admin'|'admin') {
    const phone=`08${randomInt(10000000,99999999)}`;
    const {data,error}=await admin.auth.admin.createUser({phone:`66${phone.slice(1)}`,password,phone_confirm:true});
    expect(error).toBeNull();const id=data.user!.id;ids.push(id);
    const profile=await admin.from('profiles').upsert({id,phone,name:`Browser acceptance ${role}`,role,is_active:true});expect(profile.error).toBeNull();
    return {id,phone};
  }
  async function login(page:Page,phone:string) {
    await page.goto('/login');
    await page.getByLabel('เบอร์โทรศัพท์').fill(phone);
    await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  }
  try {
    const actorResult=await admin.from('profiles').select('id,name').eq('role','super_admin').single();expect(actorResult.error).toBeNull(); const actor=actorResult.data!; const target=await fixture('admin');
    const location=await admin.from('locations').select('id').eq('is_active',true).limit(1).single();expect(location.error).toBeNull();
    expect((await admin.from('user_locations').insert({user_id:target.id,location_id:location.data!.id,is_primary:true})).error).toBeNull();
    expect((await admin.rpc('set_user_sms_required',{p_actor:actor.id,p_target:target.id,p_required:true})).error).toBeNull();
    const staff=await browser.newContext({storageState:{cookies:[],origins:[]}});contexts.push(staff);
    const a=await staff.newPage();await login(a,target.phone);
    await expect(a.getByRole('heading',{name:'รออนุมัติเบราว์เซอร์'})).toBeVisible();
    const b=await staff.newPage();await b.goto('/login');
    await expect(b.getByRole('heading',{name:'รออนุมัติเบราว์เซอร์'})).toBeVisible();
    const summary=await admin.rpc('list_browser_approvals',{p_actor:actor.id});
    expect(summary.data.find((u:{userId:string})=>u.userId===target.id).pending).toHaveLength(1);
    const cookie=(await staff.cookies()).find(c=>c.name==='lanflow-browser');expect(cookie?.httpOnly).toBe(true);
    const owner=await browser.newContext({storageState:'playwright/.auth/super_admin.json'});contexts.push(owner);
    const manager=await owner.newPage();await manager.goto('/');
    await manager.getByRole('button',{name:/^Admin(?: มีงาน|$)/}).click();
    await manager.getByLabel('ค้นหาพนักงาน').fill(target.phone);
    const row=manager.getByRole('row').filter({hasText:target.phone});
    await expect(row.getByText('รออนุมัติ 1',{exact:true})).toBeVisible();
    await manager.getByLabel(/รออนุมัติเบราว์เซอร์/).check();
    await row.getByRole('button',{name:'อนุมัติ',exact:true}).click();
    await manager.getByLabel(/รออนุมัติเบราว์เซอร์/).uncheck();
    await expect(row.getByText(new RegExp(`อนุมัติล่าสุด: ${actor.name}`))).toBeVisible();
    await a.getByRole('button',{name:'ตรวจสถานะอีกครั้ง',exact:true}).click();
    await expect(a.getByRole('heading',{name:'รออนุมัติเบราว์เซอร์'})).toHaveCount(0);
    await a.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
    await a.getByRole('button',{name:'ออกจากระบบ',exact:true}).last().click();
    await expect(a.getByRole('button',{name:'เข้าสู่ระบบ',exact:true})).toBeVisible();
    await login(a,target.phone);
    await expect(a.getByRole('button',{name:'ออกจากระบบ',exact:true})).toBeVisible();
    await expect(a.getByRole('heading',{name:'รออนุมัติเบราว์เซอร์'})).toHaveCount(0);
    await row.getByRole('button',{name:'ถอนอนุมัติทั้งหมด'}).click();
    const revokeResponse=manager.waitForResponse(response=>response.url().endsWith('/api/lanflow/admin/browser-approvals') && response.request().method()==='POST');
    await manager.getByRole('alertdialog',{name:'ถอนอนุมัติทั้งหมด?'}).getByRole('button',{name:'ยืนยัน',exact:true}).click();
    expect((await revokeResponse).status()).toBe(200);
    const revoked=await a.request.get('/api/auth/me');expect(revoked.status()).toBe(401);
    await a.evaluate(() => window.location.reload());
    await a.waitForURL('**/login');await expect(a.getByRole('button',{name:'เข้าสู่ระบบ',exact:true})).toBeVisible();
    await login(a,target.phone);await expect(a.getByRole('heading',{name:'รออนุมัติเบราว์เซอร์'})).toBeVisible();
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    for(const id of ids.reverse()) { await admin.auth.admin.deleteUser(id);await admin.from('profiles').delete().eq('id',id); }
  }
});
