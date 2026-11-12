import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import type { BonusBatchPreview } from "../src/types/branch-bonus";
import { resetTestEnvironment, resetTestSql } from "./support/bill-device-reset-target";
import { selectAppLocation } from "./helpers/select-app-location";
import { ensureBonusBatchSchema } from "./support/branch-bonus-test-schema";
import { RESET_TEST_CONTAINER } from "./support/bill-device-reset-target";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";

const target=resetTestEnvironment();
const admin=createClient(target.url,target.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const actor=crypto.randomUUID(),branch=crypto.randomUUID(),rex=Array.from({length:4},()=>crypto.randomUUID());
const phone="08992"+String(parseInt(crypto.randomUUID().slice(0,6),16)%100000).padStart(5,"0"), password="Bonus-test-2026!";
const label="Bonus E2E "+branch.slice(0,8), reference=rex.map((_,i)=>`REX-BONUS-${branch.slice(0,8)}-${i+1}`);
// Dedicated dates isolate all-branch benchmarks from unrelated integration fixtures.
const refBranch=crypto.randomUUID(),pendingBranch=crypto.randomUUID();
const refName=`Reference browser B ${branch.slice(0,8)}`,pendingName=`Pending browser C ${branch.slice(0,8)}`;
const scope=`'${branch}'`;

test.beforeAll(async()=>{
  test.setTimeout(60_000);
  ensureBonusBatchSchema(RESET_TEST_CONTAINER,"postgres");
  const version=crypto.randomUUID();
  const user=await admin.auth.admin.createUser({id:actor,phone:"+66"+phone.slice(1),password,phone_confirm:true,
    user_metadata:{name:label,lanflow_password_copy_version:version},app_metadata:{lanflow_role:"admin"}});
  if(user.error) throw user.error;
  const profile=await admin.from("profiles").upsert({id:actor,phone,name:label,role:"admin",is_active:true,
    can_access_super_admin_features:true,current_password_plaintext:password,current_password_auth_version:version});
  if(profile.error) throw profile.error;
  resetTestSql(`insert into public.locations(id,name,code) values('${branch}','${label}','BB${branch.slice(0,8)}');
    insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);`);
  resetTestSql(`insert into public.locations(id,name,code) values('${refBranch}','${refName}','RB${refBranch.slice(0,7)}'),('${pendingBranch}','${pendingName}','PC${pendingBranch.slice(0,7)}');`);
  for(let i=0;i<4;i++) resetTestSql(`insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,status,
    original_weight_total,paid_total,rubber_value_total,average_price,current_weight,weight_loss_percent,
    work_rate,other_operating_cost,work_total,expense_destination,created_by_user_id,created_by_name,created_by_phone,
    verified_by_user_id,verified_by_name,verified_at,age_cutoff_at,average_age_hours,oldest_age_hours,estimated_age_item_count,
    created_at,sold_out_at,sold_out_by_user_id,sold_out_by_name)
    values('${rex[i]}','${reference[i]}','2004-01-12',${i+1},'${branch}','verified',${i===0?500000:i===3?100000:100},
    1000,1000,10,${i===0?450000:i===2?100:i===3?99999:90},${i===2||i===3?0:10},0,0,0,'branch',
    '${actor}','${label}','${phone}','${actor}','${label}','2004-01-14Z','2004-01-14Z',144,144,${i===0?1:0},'2004-01-11T17:30Z',
    ${i===1?"null,null,null":`'2004-01-14Z','${actor}','${label}'`});`);
});
test.beforeEach(()=>{
  resetTestSql(`delete from public.rubber_exports where location_id in ('${refBranch}','${pendingBranch}');`);
  resetTestSql(`delete from public.branch_bonuses where location_id=${scope};
    delete from private.branch_bonus_request_receipts where location_id=${scope};
    delete from private.branch_bonus_batches where location_id=${scope};
    delete from public.rubber_exports where location_id=${scope} and id not in (${rex.map(id=>`'${id}'`).join(',')});
    delete from public.income_expense where location_id=${scope};
    delete from private.branch_bonus_source_gaps where location_id=${scope};
    select set_config('request.jwt.claim.sub','${actor}',false);
    select public.set_rubber_export_sold_out('${rex[1]}',false);
    select public.set_rubber_export_sold_out('${rex[2]}',false);
    select public.adjust_rubber_export_weight('${rex[2]}',100,current_weight) from public.rubber_exports where id='${rex[2]}';
    select public.set_rubber_export_sold_out('${rex[2]}',true);`);
});
test.afterAll(async()=>{
  resetTestSql(`delete from public.rubber_exports where location_id in ('${refBranch}','${pendingBranch}');update public.locations set is_active=false where id in ('${refBranch}','${pendingBranch}');`);
  resetTestSql(`delete from public.branch_bonuses where location_id=${scope};
    delete from private.branch_bonus_request_receipts where location_id=${scope};
    delete from private.branch_bonus_batches where location_id=${scope};
    delete from public.income_expense where location_id=${scope};
    delete from public.rubber_exports where location_id=${scope};
    delete from private.branch_bonus_source_gaps where location_id=${scope};
    delete from public.user_locations where location_id=${scope};
    update public.locations set is_active=false where id=${scope};`);
  const deleted=await admin.auth.admin.deleteUser(actor);if(deleted.error)throw deleted.error;
});
async function open(browser:Browser,width?:number) {
  const cookies=new Map<string,string>();
  const auth=createBrowserClient(target.url,target.anonKey,{isSingleton:false,cookies:{getAll:()=>[],setAll:(rows:{name:string;value:string}[])=>{for(const row of rows) cookies.set(row.name,row.value);}}});
  const login=await auth.auth.signInWithPassword({phone:"+66"+phone.slice(1),password});if(login.error) throw login.error;
  const context=await browser.newContext({baseURL:"http://127.0.0.1:3006",viewport:{width:width??1280,height:900},
    storageState:{cookies:[...cookies].map(([name,value])=>({name,value,domain:"127.0.0.1",path:"/",expires:Date.now()/1000+3600,httpOnly:false,secure:false,sameSite:"Lax" as const})),origins:[]}});
  await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
    // Development-only query tools are not part of the production workflow.
    const style=document.createElement('style');style.textContent='.tsqd-parent-container{display:none!important}';document.head.append(style);
  }));
  const page=await context.newPage();page.setDefaultTimeout(10000);await installThresholdAlertHandler(page);
  const me=await context.request.get("/api/auth/me");expect(me.status(),await me.text()).toBe(200);
  await page.goto("/");await selectAppLocation(page,branch);
  const listing=page.waitForResponse(response=>response.request().method()==="GET" && response.url().includes("/api/lanflow/branch-bonuses?")
    && new URL(response.url()).searchParams.get("locationId")===branch && new URL(response.url()).searchParams.get("view")==="list",{timeout:30000});
  await page.getByRole("button",{name:"โบนัสสาขา",exact:true}).click();
  const loaded=await listing;expect(loaded.status()).toBe(200);
  await expect(page.getByRole("button",{name:"สร้างโบนัส",exact:true})).toBeEnabled();
  return {page,context};
}
async function ready() {
  resetTestSql(`select set_config('request.jwt.claim.sub','${actor}',false);
    select public.set_rubber_export_sold_out('${rex[1]}',true);
    select public.set_rubber_export_sold_out('${rex[2]}',false);
    select public.adjust_rubber_export_weight('${rex[2]}',90,current_weight) from public.rubber_exports where id='${rex[2]}';
    select public.set_rubber_export_sold_out('${rex[2]}',true);`);
}
async function settings(page:Page) {
  await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
  await expect(page.getByRole('heading',{name:'ตรวจ REX ที่รอทำโบนัส',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'ตรวจสอบและถัดไป'})).toBeEnabled();
  await expect(page.getByText('กำลังคำนวณทุกช่วง…',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'ตรวจสอบและถัดไป'}).click();
  await expect(page.getByLabel('ช่วงที่กำลังตรวจ')).toBeVisible();
  await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
  await expect(page.getByLabel('สัดส่วน น้ำหนักลดลง (%)',{exact:true})).toBeVisible();
}
function seedReference(hours=96) {
  resetTestSql(`insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
    'id','${crypto.randomUUID()}','export_no','REF-${refBranch}','sequence_no',303,'location_id','${refBranch}',
    'original_weight_total',600200,'current_weight',588196,'weight_loss_percent',2,'average_age_hours',${hours},'oldest_age_hours',${hours},'estimated_age_item_count',0))).*
    from public.rubber_exports e where id='${rex[0]}';`);
}
async function fillSettings(page:Page,rate='0.02') {
  await page.getByLabel('สัดส่วน น้ำหนักลดลง (%)',{exact:true}).fill('100');
  await expect(page.getByLabel('เป้า น้ำหนักลดลง (%)',{exact:true})).toHaveAttribute('readonly','');
  await page.getByRole('heading',{name:'อัตราโบนัส',exact:true}).click();
  await page.getByLabel('อัตราโบนัสต่อกิโลกรัม (บาท)',{exact:true}).fill(rate);
  await page.getByRole('heading',{name:'อัตราโบนัส',exact:true}).click();
}
test('mandatory inventory blocks both active and zero-loss rows without a bypass',async({browser})=>{
  const {page,context}=await open(browser);
  try {
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ตรวจ REX ที่รอทำโบนัส',exact:true})).toBeVisible();
    await expect(page.getByText('ทั้งหมด 4 · พร้อม 2 · ต้องแก้ไข 2',{exact:true})).toBeVisible();
    await expect(page.getByRole('checkbox',{name:/เลือก REX/})).toHaveCount(0);
    await page.getByRole('button',{name:'ตรวจสอบและถัดไป'}).click();
    const dialog=page.getByRole('alertdialog');await expect(dialog).toBeVisible();
    await expect(dialog.getByText(reference[1],{exact:true})).toBeVisible();await expect(dialog.getByText(reference[2],{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'รับทราบ',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ตรวจ REX ที่รอทำโบนัส',exact:true})).toBeVisible();
    await ready();await page.getByRole('button',{name:'โหลด REX ใหม่',exact:true}).click();
    await expect(page.getByText('ทั้งหมด 4 · พร้อม 4 · ต้องแก้ไข 0',{exact:true})).toBeVisible();
  } finally {await context.close();}
});
test('real batch calculation disables duplicate confirmation and locks saved history',async({browser})=>{
  test.setTimeout(90000);await ready();const {page,context}=await open(browser);
  try {
    await settings(page);await fillSettings(page,'0.025');
    await expect(page.getByLabel('อัตราโบนัสต่อกิโลกรัม (บาท)',{exact:true})).toHaveValue('0.03');
    await page.getByLabel('อัตราโบนัสต่อกิโลกรัม (บาท)',{exact:true}).fill('invalid');
    await page.getByRole('heading',{name:'อัตราโบนัส',exact:true}).click();
    await expect(page.getByText('กรอกตัวเลขให้ถูกต้อง',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'ถัดไป',exact:true})).toBeDisabled();
    await page.getByLabel('อัตราโบนัสต่อกิโลกรัม (บาท)',{exact:true}).fill('0.03');
    await page.getByRole('heading',{name:'อัตราโบนัส',exact:true}).click();
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    const button=page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true});await expect(button).toBeEnabled();
    let count=0,release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/api/lanflow/branch-bonuses',async route=>{if(route.request().postDataJSON()?.action==='confirmBatch'){count++;await held;}await route.continue();});
    await button.click();await expect(button).toBeDisabled();release();
    await expect(page.getByRole('heading',{name:'ผลคำขอยืนยันโบนัสทุกช่วง',exact:true})).toBeVisible();expect(count).toBe(1);
    expect(Number(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`))).toBe(1);
    expect(()=>resetTestSql(`select set_config('request.jwt.claim.sub','${actor}',false);select public.set_rubber_export_sold_out('${rex[0]}',false);`)).toThrow(/BONUS_HISTORY_LOCKED/);
    await page.getByRole('button',{name:/เปิดผล$/}).click();
    await expect(page.getByRole('heading',{name:'ผลโบนัสที่ยืนยันแล้ว',exact:true})).toBeVisible();
    await expect(page.getByText('0.03 บาท',{exact:true})).toBeVisible();
    await expect(page.getByText('สูตรและที่มาของผลโบนัส',{exact:true})).toBeVisible();
    await expect(page.getByText('สูตรและที่มาของผลโบนัส',{exact:true})).not.toHaveAttribute('open','');
    await page.screenshot({path:'output/branch-bonus/batch-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'ลบผลโบนัสนี้',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'ลบผลโบนัส',exact:true}).click();
    await expect(page.getByRole('button',{name:'สร้างโบนัส',exact:true})).toBeVisible();
  } finally {await context.close();}
});
test('deleting during an older list refresh cannot restore the deleted bonus',async({browser})=>{
  test.setTimeout(90000);await ready();const {page,context}=await open(browser);
  let release:()=>void=()=>{},captured:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;}),snapshot=new Promise<void>(resolve=>{captured=resolve;});
  try{
    await settings(page);await fillSettings(page);await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    await page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ผลคำขอยืนยันโบนัสทุกช่วง',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'กลับรายการโบนัส',exact:true}).click();
    const remove=page.getByRole('button',{name:'ลบผล 2004-01-12',exact:true});await expect(remove).toBeEnabled();
    await expect(page.getByRole('button',{name:'โหลดรายการโบนัสใหม่',exact:true})).toBeEnabled();
    let reads=0;
    await page.route(url=>url.pathname==='/api/lanflow/branch-bonuses'&&url.searchParams.get('view')==='list',async route=>{
      reads++;if(reads===1){const response=await route.fetch();captured();await held;await route.fulfill({response}).catch(()=>{});}
      else await route.continue();
    });
    await page.getByRole('button',{name:'โหลดรายการโบนัสใหม่',exact:true}).click();await snapshot;
    await remove.click();await page.getByRole('alertdialog').getByRole('button',{name:'ลบผลโบนัส',exact:true}).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('0');release();
    await expect(remove).toHaveCount(0);await expect(page.getByRole('button',{name:'สร้างโบนัส',exact:true})).toBeEnabled();
    expect(reads).toBe(2);expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('0');
  }finally{release();await context.close();}
});
test('a lost response recovers the same complete batch after reloading',async({browser})=>{
  test.setTimeout(90000);await ready();const {page,context}=await open(browser);
  try {
    await settings(page);await fillSettings(page);await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    const ids:string[]=[];
    const temporaryStatuses=[429,401,403,408];
    await page.route('**/api/lanflow/branch-bonuses',async route=>{const body=route.request().postDataJSON();if(body?.action==='confirmBatch'){
      ids.push(body.id);if(ids.length===1){await route.fetch();await route.abort('failed');return;}
      const status=temporaryStatuses[ids.length-2];if(status){await route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:'Temporary retry failure'})});return;}
    }await route.continue();});
    await page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true}).click();
    await expect(page.getByRole('button',{name:'ตรวจผลคำขอเดิมทั้งชุด',exact:true})).toBeVisible();
    page.once('dialog',dialog=>void dialog.accept());await page.reload();await page.getByRole('button',{name:'โบนัสสาขา',exact:true}).click();
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    const retry=page.getByRole('button',{name:'ตรวจผลคำขอเดิมทั้งชุด',exact:true});
    const key=`lanflow:bonus-batch:${actor}:${branch}`;
    const pending=await page.evaluate(key=>localStorage.getItem(key),key);expect(pending).not.toBeNull();
    for(const status of temporaryStatuses){
      const rejected=page.waitForResponse(response=>response.url().endsWith('/api/lanflow/branch-bonuses')&&response.status()===status);
      await retry.click();await rejected;await expect(retry).toBeEnabled();
      expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(pending);
    }
    await retry.click();
    await expect(page.getByRole('heading',{name:'ผลคำขอยืนยันโบนัสทุกช่วง',exact:true})).toBeVisible();
    expect(ids).toHaveLength(temporaryStatuses.length+2);expect(new Set(ids).size).toBe(1);
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('1');
  } finally {await context.close();}
});
test('a new unfinished REX appearing after review blocks the next step',async({browser})=>{
  await ready();const {page,context}=await open(browser);
  try {
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    await expect(page.getByText('ทั้งหมด 4 · พร้อม 4 · ต้องแก้ไข 0',{exact:true})).toBeVisible();
    resetTestSql(`select set_config('request.jwt.claim.sub','${actor}',false);select public.set_rubber_export_sold_out('${rex[1]}',false);`);
    await page.getByRole('button',{name:'ตรวจสอบและถัดไป'}).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog').getByText(reference[1],{exact:true})).toBeVisible();
  } finally {await context.close();}
});

test('a pending batch rejected after reload can review REX again without leaving the form',async({browser})=>{
  test.setTimeout(90000);await ready();const {page,context}=await open(browser);
  try{
    await settings(page);await fillSettings(page);await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    let interrupted=false;
    await page.route('**/api/lanflow/branch-bonuses',async route=>{
      if(route.request().postDataJSON()?.action==='confirmBatch'&&!interrupted){interrupted=true;await route.abort('failed');return;}
      await route.continue();
    });
    await page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true}).click();
    await expect(page.getByRole('button',{name:'ตรวจผลคำขอเดิมทั้งชุด',exact:true})).toBeVisible();
    resetTestSql(`select set_config('request.jwt.claim.sub','${actor}',false);select public.set_rubber_export_sold_out('${rex[1]}',false);`);
    page.once('dialog',dialog=>void dialog.accept());await page.reload();await page.getByRole('button',{name:'โบนัสสาขา',exact:true}).click();
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    const rejected=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/lanflow/branch-bonuses')&&response.status()===409);
    await page.getByRole('button',{name:'ตรวจผลคำขอเดิมทั้งชุด',exact:true}).click();await rejected;
    await expect(page.getByRole('button',{name:'ตรวจผลคำขอเดิมทั้งชุด',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'โหลด REX ใหม่',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'โหลด REX ใหม่',exact:true}).click();
    await expect(page.getByText('ทั้งหมด 4 · พร้อม 3 · ต้องแก้ไข 1',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'ตรวจสอบและถัดไป',exact:true}).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('0');
  }finally{await context.close();}
});

test('an initial review failure can be retried in the same form',async({browser})=>{
  await ready();const {page,context}=await open(browser);
  try{
    let unavailable=true;
    await page.route(url=>url.pathname==='/api/lanflow/branch-bonuses'&&url.searchParams.get('view')==='review',async route=>{
      if(unavailable){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'โหลด REX ไม่สำเร็จในการทดสอบ'})});return;}
      await route.continue();
    });
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    await expect(page.getByRole('alert').filter({hasText:'โหลด REX ไม่สำเร็จในการทดสอบ'})).toBeVisible();
    await expect(page.getByRole('button',{name:'ตรวจสอบและถัดไป',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'โหลด REX ใหม่',exact:true})).toBeEnabled();
    unavailable=false;await page.getByRole('button',{name:'โหลด REX ใหม่',exact:true}).click();
    await expect(page.getByText('ทั้งหมด 4 · พร้อม 4 · ต้องแก้ไข 0',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'ตรวจสอบและถัดไป',exact:true})).toBeEnabled();
  }finally{await context.close();}
});
test('settings, readonly count goal, and selected evidence fit narrow screens',async({browser})=>{
  test.setTimeout(90000);await ready();const {page,context}=await open(browser,320);
  try {
    await settings(page);
    await page.getByLabel('สัดส่วน จำนวนรายการนับเงิน (%)',{exact:true}).fill('100');
    const goal=page.getByLabel('เป้า จำนวนรายการนับเงิน (ใบ)',{exact:true});await expect(goal).toHaveValue('1');await expect(goal).toHaveAttribute('readonly','');
    await page.getByLabel('สัดส่วน จำนวนรายการนับเงิน (%)',{exact:true}).fill('0');
    await fillSettings(page);await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    await expect(page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true})).toBeEnabled();
    for(const width of [320,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);await page.screenshot({path:`output/branch-bonus/batch-mobile-${width}.png`,fullPage:true});}
  } finally {await context.close();}
});

test('all periods keep independent settings and confirm atomically',async({browser})=>{
  test.setTimeout(90000);await ready();const next=crypto.randomUUID(),old=crypto.randomUUID();
  resetTestSql(`insert into public.branch_bonuses(id,location_id,period_start,period_end,input,request_fingerprint,snapshot,created_by_user_id,created_by_name)
    values('${old}',${scope},'2004-01-15','2004-01-20','{"excludedKeys":[],"excludedGroups":[]}',repeat('a',32),'{"allSources":[],"observedChanges":[]}', '${actor}','${label}');
    insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
      'id','${next}','export_no','REX-SPLIT-${next}','sequence_no',202,'created_at','2004-01-24T01:00Z'))).* from public.rubber_exports e where id='${rex[0]}';`);
  const {page,context}=await open(browser);
  try{
    await settings(page);await fillSettings(page);
    await expect(page.getByRole('button',{name:'ถัดไป',exact:true})).toBeDisabled();
    await page.getByLabel('ช่วงที่กำลังตรวจ').selectOption('1');await fillSettings(page,'0.03');
    await page.getByLabel('ช่วงที่กำลังตรวจ').selectOption('0');
    await expect(page.getByLabel('อัตราโบนัสต่อกิโลกรัม (บาท)',{exact:true})).toHaveValue('0.02');
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    const final=page.getByLabel('ยอดโบนัสสุดท้าย 2004-01-12 ถึง 2004-01-12 (บาท)',{exact:true});
    await final.fill(',');await final.press('Tab');
    await expect(final).toHaveAttribute('aria-invalid','true');
    await expect(page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true})).toBeDisabled();
    await final.focus();await final.press('Tab');
    await expect(final).toHaveValue(',');await expect(final).toHaveAttribute('aria-invalid','true');
    await expect(page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true})).toBeDisabled();
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('1');
    await final.fill('1,234.56');await final.press('Tab');await expect(final).toHaveValue('1234.56');
    await expect(page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true})).toBeEnabled();
    await final.fill('0');
    await page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ผลคำขอยืนยันโบนัสทุกช่วง',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:/เปิดผล$/})).toHaveCount(2);
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('3');
    expect(Number(resetTestSql(`select snapshot->>'finalAmount' from public.branch_bonuses where location_id=${scope} and period_start='2004-01-12'`))).toBe(0);
    expect(Number(resetTestSql(`select snapshot->>'finalAmount' from public.branch_bonuses where location_id=${scope} and period_start='2004-01-24'`))).toBeGreaterThan(0);
  }finally{await context.close();}
});

test('an unfinished REX outside the first rendered page still blocks progress',async({browser})=>{
  await ready();const pending=crypto.randomUUID(),pendingNo='REX-HIDDEN-'+pending;
  resetTestSql(`insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
    'id',gen_random_uuid(),'export_no','REX-PAGE-'||n,'sequence_no',300+n))).* from public.rubber_exports e cross join generate_series(1,51) n where id='${rex[0]}';
    insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
    'id','${pending}','export_no','${pendingNo}','sequence_no',399,'created_at','2003-01-01T01:00Z','sold_out_at',null,'sold_out_by_user_id',null,'sold_out_by_name',null))).* from public.rubber_exports e where id='${rex[0]}';`);
  const {page,context}=await open(browser);
  try{
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    await expect(page.getByText('ทั้งหมด 56 · พร้อม 55 · ต้องแก้ไข 1',{exact:true})).toBeVisible();
    await expect(page.getByText(pendingNo,{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'ตรวจสอบและถัดไป'}).click();
    await expect(page.getByRole('alertdialog').getByText(pendingNo,{exact:true})).toBeVisible();
  }finally{await context.close();}
});

test('a legacy pending request with old precision resolves its original receipt',async({browser})=>{
  await ready();const id=crypto.randomUUID();
  const input={exportIds:[rex[0]],excludedKeys:[],excludedGroups:[],rate:.0125,
    metrics:{burden:{weight:0,target:null},loss:{weight:12.5,target:10},counts:{weight:87.5,target:1},age:{weight:0,target:null}}};
  const expected=resetTestSql(`select set_config('request.jwt.claim.sub','${actor}',false);
    create temp table legacy_pending as select '${JSON.stringify(input)}'::jsonb input,private.branch_bonus_calculate('${branch}','${JSON.stringify(input)}',clock_timestamp()) snapshot;
    insert into public.branch_bonuses(id,location_id,period_start,period_end,input,request_fingerprint,snapshot,created_by_user_id,created_by_name)
      select '${id}',${scope},'2004-01-12','2004-01-12',input,repeat('a',32),snapshot||jsonb_build_object('finalAmount',snapshot->'suggestedAmount'),'${actor}','${label}' from legacy_pending;
    insert into private.branch_bonus_exports values('${id}','${rex[0]}');
    insert into private.branch_bonus_request_receipts select '${id}','${actor}',${scope},md5(jsonb_build_object('input',input,'expected',snapshot->>'sourceFingerprint','final',null)::text),'${id}' from legacy_pending;
    select snapshot->>'sourceFingerprint' from legacy_pending;`).split('\n').at(-1)!;
  const {page,context}=await open(browser);
  try{
    await page.evaluate(({owner,branch,id,input,expected})=>localStorage.setItem(`lanflow:bonus-intent:${owner}:${branch}`,JSON.stringify({ownerId:owner,locationId:branch,id,input,expected,finalAmount:null})),{owner:actor,branch,id,input,expected});
    await page.reload();await page.getByRole('button',{name:'โบนัสสาขา',exact:true}).click();
    await page.getByRole('button',{name:'ตรวจผลคำขอเดิม',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ผลโบนัสที่ยืนยันแล้ว',exact:true})).toBeVisible();
    await expect(page.getByText('0.0125 บาท',{exact:true})).toBeVisible();
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('1');
  }finally{await context.close();}
});

test('changed financial sources return to review without saving a partial result',async({browser})=>{
  await ready();const {page,context}=await open(browser);
  try{
    await settings(page);await fillSettings(page);await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    // Next can still be waiting for the shared debounced preview when click resolves.
    // Change the source only after the final preview is displayed and confirmable.
    const confirm=page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true});
    await expect(confirm).toBeEnabled();
    const source=crypto.randomUUID();
    resetTestSql(`insert into public.income_expense(id,client_temp_id,local_bill_no,server_bill_no,sync_status,record_status,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone)
      values('${source}','${source}','${source}','${source}','synced','active',${scope},'expense','1','2004-01-12','Changed after review',100,'ค่าใช้จ่าย','${actor}','${label}','${phone}');`);
    const rejected=page.waitForResponse(response=>response.url().endsWith('/api/lanflow/branch-bonuses')
      && response.request().postDataJSON()?.action==='confirmBatch'&&response.status()===409);
    await confirm.click();await rejected;
    await expect(page.getByRole('heading',{name:'ตรวจ REX ที่รอทำโบนัส',exact:true})).toBeVisible();
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('0');
  }finally{await context.close();}
});


test('verified age uses days, estimated labels and upward scoring on mobile, then saves',async({browser})=>{
  test.setTimeout(90000);await ready();seedReference();const {page,context}=await open(browser,390);
  try{
    await settings(page);
    await page.getByRole('button',{name:'ใช้สัดส่วนทดลอง 50 / 40 / 10 / 0',exact:true}).click();
    await expect(page.getByLabel('สัดส่วน อายุยาง (%)',{exact:true})).toHaveValue('0');
    for(const name of ['ภาระดำเนินงานต่อยอดซื้อ','น้ำหนักลดลง','จำนวนรายการนับเงิน'])await page.getByLabel(`สัดส่วน ${name} (%)`,{exact:true}).fill('0');
    await page.getByLabel('สัดส่วน อายุยาง (%)',{exact:true}).fill('100');
    const goal=page.getByLabel('เป้า อายุยาง (วัน)',{exact:true});await expect(goal).toHaveAttribute('readonly','');
    await expect(goal).toHaveValue('5.00');
    await expect(goal).toHaveAttribute('aria-invalid','false');
    await page.getByRole('button',{name:'0.02 บาท/กก.',exact:true}).click();
    await expect(page.getByText('อายุประมาณ · 1 REX',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    await expect(page.getByText('จริง 6.00 / เป้า 5.00 วัน',{exact:true})).toBeVisible();
    await expect(page.getByText('ปรับด้านนี้ 20.00%',{exact:true})).toBeVisible();
    await expect(page.getByText('หลังถ่วงสัดส่วน 20.00%',{exact:true})).toBeVisible();
    await page.getByText('รายละเอียดคะแนนอายุยาง',{exact:true}).click();
    await expect(page.getByText('อายุเฉลี่ย 6.000000 วัน · ผลต่างเทียบเป้า 20.000000%',{exact:true})).toBeVisible();
    for(const width of [320,390]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:`output/branch-bonus-age/age-${width}.png`,fullPage:true});
    }
    await page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ผลคำขอยืนยันโบนัสทุกช่วง',exact:true})).toBeVisible();
    await page.getByRole('button',{name:/เปิดผล$/}).click();
    await expect(page.getByText('จริง 6.00 / เป้า 5.00 วัน',{exact:true})).toBeVisible();
    const proof=JSON.parse(resetTestSql(`select snapshot->'metrics' from public.branch_bonuses where location_id=${scope}`));
    expect(proof.find((m:{key:string})=>m.key==='age')).toMatchObject({actual:6,target:5,adjustment:20,weightedAdjustment:20});
  }finally{await context.close();}
});

test('missing age warns before settings, blocks only when enabled, then permits age zero',async({browser})=>{
  test.setTimeout(90000);await ready();const {page,context}=await open(browser);
  try{
    await page.route('**/api/lanflow/branch-bonuses*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()==='GET'&&url.searchParams.get('view')==='review'){
        const response=await route.fetch(),data=await response.json();data.rows[0].averageAgeHours=null;
        await route.fulfill({response,json:data});return;
      }
      if(request.method()==='POST'&&request.postDataJSON()?.action==='previewBatch'){
        const response=await route.fetch(),data:BonusBatchPreview=await response.json();
        for(const {preview} of data.periods){preview.ageActual=null;preview.exports[0].averageAgeHours=null;
          if(request.postDataJSON().periods[0].input.metrics.age.weight>0){preview.canConfirm=false;preview.issues.push('REX บางใบขาดอายุ ณ ตรวจสอบ กรุณาแก้ต้นทางหรือปรับสัดส่วนอายุยางเป็น 0%');}}
        await route.fulfill({response,json:data});return;
      }
      await route.continue();
    });
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    await expect(page.getByText('บาง REX ขาดอายุ ณ ตรวจสอบ ยังไปตั้งค่าได้ แต่ต้องแก้ต้นทางหรือปรับสัดส่วนอายุยางเป็น 0% ก่อนยืนยัน',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'ตรวจสอบและถัดไป',exact:true}).click();
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    await page.getByLabel('สัดส่วน อายุยาง (%)',{exact:true}).fill('100');
    await expect(page.getByLabel('เป้า อายุยาง (วัน)',{exact:true})).toHaveAttribute('readonly','');await page.getByRole('heading',{name:'อัตราโบนัส',exact:true}).click();
    await page.getByRole('button',{name:'0.02 บาท/กก.',exact:true}).click();
    await expect(page.getByText('REX บางใบขาดอายุ ณ ตรวจสอบ กรุณาแก้ต้นทางหรือปรับสัดส่วนอายุยางเป็น 0%',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'ถัดไป',exact:true})).toBeDisabled();
    await page.getByLabel('สัดส่วน อายุยาง (%)',{exact:true}).fill('0');await fillSettings(page);
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    await expect(page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true})).toBeEnabled();
  }finally{await context.close();}
});


test('selection keeps review panels mounted and open while recalculating',async({browser})=>{
  test.setTimeout(90000);await ready();
  resetTestSql(`insert into public.income_expense(id,client_temp_id,local_bill_no,server_bill_no,sync_status,record_status,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,created_at)
    select gen_random_uuid(),'KEEP-'||n,'KEEP-'||n,'KEEP-'||n,'synced','active',${scope},'expense',n::text,'2004-01-12','Keep expense '||n,n,'ค่าใช้จ่าย','${actor}','${label}','${phone}','2004-01-12Z' from generate_series(1,61)n;`);
  const {page,context}=await open(browser);let release=()=>{};
  try{
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    await page.getByRole('button',{name:'ตรวจสอบและถัดไป',exact:true}).click();
    const expenses=page.locator('details').filter({has:page.locator('summary').filter({hasText:'รายการค่าใช้จ่าย'})});
    await expenses.locator('summary').click();
    await expect(expenses.getByRole('checkbox',{name:/รวม Keep expense /})).toHaveCount(50);
    await expenses.getByRole('button',{name:'โหลดรายละเอียดเพิ่ม',exact:true}).click();
    await expect(expenses.getByRole('checkbox',{name:/รวม Keep expense /})).toHaveCount(61);
    const exports=page.locator('details').filter({has:page.locator('summary').filter({hasText:'ตรวจน้ำหนักลดลงรายเที่ยว'})});
    await exports.locator('summary').click();
    const oldExpenses=await expenses.elementHandle(),oldExports=await exports.elementHandle();

    const gate=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/api/lanflow/branch-bonuses',async route=>{
      if(route.request().postDataJSON()?.action==='previewBatch')await gate;
      await route.continue();
    });
    const calculating=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/lanflow/branch-bonuses')&&r.postDataJSON()?.action==='previewBatch');
    await expenses.getByRole('checkbox',{name:'รวม Keep expense 1',exact:true}).click();
    await calculating;
    expect(await oldExpenses!.evaluate(el=>el.isConnected)).toBe(true);
    expect(await oldExports!.evaluate(el=>el.isConnected)).toBe(true);
    await expect(expenses).toHaveAttribute('open','');await expect(exports).toHaveAttribute('open','');
    await expect(expenses.getByRole('checkbox',{name:/รวม Keep expense /})).toHaveCount(61);
    await expect(expenses.getByRole('checkbox',{name:'รวม Keep expense 1',exact:true})).not.toBeChecked();
    release();await expect(page.getByText('กำลังคำนวณทุกช่วง…',{exact:true})).toHaveCount(0);
    await expect(expenses.getByRole('checkbox',{name:/รวม Keep expense /})).toHaveCount(61);
    await expect(expenses).toHaveAttribute('open','');await expect(exports).toHaveAttribute('open','');
    await expenses.getByRole('checkbox',{name:'รวม Keep expense 1',exact:true}).check();
    await expect(expenses.locator('summary')).toContainText('(61)');
    await page.getByRole('checkbox',{name:/รวมรายจ่ายทั่วไป/}).uncheck();
    await expect(expenses.locator('summary')).toContainText('(0)');await expect(expenses).toHaveAttribute('open','');
    await page.getByRole('checkbox',{name:/รวมรายจ่ายทั่วไป/}).check();
    await expect(expenses.locator('summary')).toContainText('(61)');
    await expect(page.getByRole('button',{name:'Sort Descending',exact:true})).toHaveCount(0);
    await expenses.locator('summary').click();await expect(expenses).not.toHaveAttribute('open','');
    await expenses.locator('summary').click();await expect(expenses).toHaveAttribute('open','');
    await page.screenshot({path:'output/branch-bonus-age/selection-stays-open.png',fullPage:true});
  }finally{release();await context.close();}
});

test('reference branches remain visible when disabled and change readonly targets without collapsing paged evidence',async({browser})=>{
  test.setTimeout(90000);await ready();seedReference();
  resetTestSql(`insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,original_weight_total,paid_total,rubber_value_total,average_price,created_by_user_id,created_by_name,created_by_phone,created_at)
    values('${crypto.randomUUID()}','PENDING-REF-${pendingBranch}','2004-01-12',304,'${pendingBranch}',100,1000,1000,10,'${actor}','${label}','${phone}','2004-01-12Z');
    insert into public.income_expense(id,client_temp_id,local_bill_no,server_bill_no,sync_status,record_status,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,created_at)
    select gen_random_uuid(),'REFCOST-'||n,'REFCOST-'||n,'REFCOST-'||n,'synced','active',${scope},'expense',n::text,'2004-01-12','Reference expense '||n,n,'ค่าใช้จ่าย','${actor}','${label}','${phone}','2004-01-12Z' from generate_series(1,61)n;`);
  const {page,context}=await open(browser,390);
  try{
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();await page.getByRole('button',{name:'ตรวจสอบและถัดไป',exact:true}).click();
    const picker=page.getByRole('group',{name:'สาขาอ้างอิงสำหรับคำนวณเป้า',exact:true});
    const other=picker.getByRole('checkbox',{name:`รวมสาขา ${refName} ในค่าเฉลี่ย`,exact:true});
    const pending=picker.getByRole('checkbox',{name:`รวมสาขา ${pendingName} ในค่าเฉลี่ย`,exact:true});
    await expect(other).toBeChecked();await expect(pending).toBeVisible();await expect(pending).toBeDisabled();await expect(pending).not.toBeChecked();
    await expect(picker.getByText('มี REX ยังไม่เข้าประวัติ · ไม่รวมในค่าเฉลี่ย',{exact:true})).toBeVisible();
    const expenses=page.locator('details').filter({has:page.locator('summary').filter({hasText:'รายการค่าใช้จ่าย'})});
    await expenses.locator('summary').click();await expect(expenses.getByRole('checkbox',{name:/รวม Reference expense /})).toHaveCount(50);
    await expenses.getByRole('button',{name:'โหลดรายละเอียดเพิ่ม',exact:true}).click();await expect(expenses.getByRole('checkbox',{name:/รวม Reference expense /})).toHaveCount(61);
    const original=await expenses.elementHandle();await other.uncheck();await expect(page.getByText('กำลังคำนวณทุกช่วง…',{exact:true})).toHaveCount(0);
    expect(await original!.evaluate(el=>el.isConnected)).toBe(true);await expect(expenses).toHaveAttribute('open','');await expect(expenses.getByRole('checkbox',{name:/รวม Reference expense /})).toHaveCount(61);
    for(const width of [320,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:`output/branch-bonus-age/reference-${width}.png`,fullPage:true});}
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();await page.getByLabel('สัดส่วน อายุยาง (%)',{exact:true}).fill('100');
    await expect(page.getByLabel('เป้า อายุยาง (วัน)',{exact:true})).toHaveValue('6.00');await expect(page.getByLabel('เป้า อายุยาง (วัน)',{exact:true})).toHaveAttribute('readonly','');
    await page.getByRole('button',{name:'ย้อนกลับ',exact:true}).click();await expect(other).not.toBeChecked();await other.check();
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();await expect(page.getByLabel('เป้า อายุยาง (วัน)',{exact:true})).toHaveValue('5.00');
  }finally{await context.close();}
});

test('zero automatic age target explains the blocker and allows disabling age',async({browser})=>{
  test.setTimeout(90000);await ready();const {page,context}=await open(browser,390);
  try{
    // SQL tests cover actual zero-age rows; this response gate isolates the UI escape path.
    await page.route('**/api/lanflow/branch-bonuses',async route=>{
      if(route.request().postDataJSON()?.action!=='previewBatch'){await route.continue();return;}
      const response=await route.fetch(),data:BonusBatchPreview=await response.json();
      for(const {preview} of data.periods){
        preview.reference!.ageTarget=0;
        if(route.request().postDataJSON().periods[0].input.metrics.age.weight>0){preview.canConfirm=false;preview.issues.push('เป้าอายุเฉลี่ยเป็น 0 วัน กรุณาปรับสัดส่วนอายุยางเป็น 0%');}
      }
      await route.fulfill({response,json:data});
    });
    await settings(page);await page.getByLabel('สัดส่วน อายุยาง (%)',{exact:true}).fill('100');
    await page.getByRole('button',{name:'0.02 บาท/กก.',exact:true}).click();
    await expect(page.getByLabel('เป้า อายุยาง (วัน)',{exact:true})).toHaveValue('0.00');
    await expect(page.getByText('เป้าอายุเฉลี่ยเป็น 0 วัน กรุณาปรับสัดส่วนอายุยางเป็น 0%',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'ถัดไป',exact:true})).toBeDisabled();
    await page.getByLabel('สัดส่วน อายุยาง (%)',{exact:true}).fill('0');await fillSettings(page);
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();await expect(page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true})).toBeEnabled();
  }finally{await context.close();}
});
