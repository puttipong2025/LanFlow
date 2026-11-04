import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { resetTestEnvironment, resetTestSql } from "./support/bill-device-reset-target";
import { selectAppLocation } from "./helpers/select-app-location";
import { installThresholdAlertHandler } from "./helpers/dismiss-threshold-alert";

const target=resetTestEnvironment();
const admin=createClient(target.url,target.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const actor=crypto.randomUUID(),branch=crypto.randomUUID(),rex=Array.from({length:4},()=>crypto.randomUUID());
const phone="08992"+String(parseInt(crypto.randomUUID().slice(0,6),16)%100000).padStart(5,"0"), password="Bonus-test-2026!";
const label="Bonus E2E "+branch.slice(0,8), reference=rex.map((_,i)=>`REX-BONUS-${branch.slice(0,8)}-${i+1}`);
const scope=`'${branch}'`;

test.beforeAll(async()=>{
  test.setTimeout(60_000);
  const version=crypto.randomUUID();
  const user=await admin.auth.admin.createUser({id:actor,phone:"+66"+phone.slice(1),password,phone_confirm:true,
    user_metadata:{name:label,lanflow_password_copy_version:version},app_metadata:{lanflow_role:"admin"}});
  if(user.error) throw user.error;
  const profile=await admin.from("profiles").upsert({id:actor,phone,name:label,role:"admin",is_active:true,
    can_access_super_admin_features:true,current_password_plaintext:password,current_password_auth_version:version});
  if(profile.error) throw profile.error;
  resetTestSql(`insert into public.locations(id,name,code) values('${branch}','${label}','BB${branch.slice(0,8)}');
    insert into public.user_locations(user_id,location_id,is_primary) values('${actor}','${branch}',true);`);
  for(let i=0;i<4;i++) resetTestSql(`insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,status,
    original_weight_total,paid_total,rubber_value_total,average_price,current_weight,weight_loss_percent,
    work_rate,other_operating_cost,work_total,expense_destination,created_by_user_id,created_by_name,created_by_phone,
    verified_by_user_id,verified_by_name,verified_at,age_cutoff_at,average_age_hours,oldest_age_hours,estimated_age_item_count,
    created_at,sold_out_at,sold_out_by_user_id,sold_out_by_name)
    values('${rex[i]}','${reference[i]}','2020-01-12',${i+1},'${branch}','verified',${i===0?500000:i===3?100000:100},
    1000,1000,10,${i===0?450000:i===2?100:i===3?99999:90},${i===2||i===3?0:10},0,0,0,'branch',
    '${actor}','${label}','${phone}','${actor}','${label}','2020-01-14Z','2020-01-14Z',0,0,0,'2020-01-11T17:30Z',
    ${i===1?"null,null,null":`'2020-01-14Z','${actor}','${label}'`});`);
});
test.beforeEach(()=>{
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
async function fillSettings(page:Page,rate='0.02') {
  await page.getByLabel('สัดส่วน น้ำหนักลดลง (%)',{exact:true}).fill('100');
  await page.getByLabel('เป้า น้ำหนักลดลง (%)',{exact:true}).fill('10');
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
test('a lost response recovers the same complete batch after reloading',async({browser})=>{
  test.setTimeout(90000);await ready();const {page,context}=await open(browser);
  try {
    await settings(page);await fillSettings(page);await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    const ids:string[]=[];
    await page.route('**/api/lanflow/branch-bonuses',async route=>{const body=route.request().postDataJSON();if(body?.action==='confirmBatch'){ids.push(body.id);if(ids.length===1){await route.fetch();await route.abort('failed');return;}}await route.continue();});
    await page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true}).click();
    await expect(page.getByRole('button',{name:'ตรวจผลคำขอเดิมทั้งชุด',exact:true})).toBeVisible();
    page.once('dialog',dialog=>void dialog.accept());await page.reload();await page.getByRole('button',{name:'โบนัสสาขา',exact:true}).click();
    await page.getByRole('button',{name:'สร้างโบนัส',exact:true}).click();
    await page.getByRole('button',{name:'ตรวจผลคำขอเดิมทั้งชุด',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ผลคำขอยืนยันโบนัสทุกช่วง',exact:true})).toBeVisible();
    expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
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
    values('${old}',${scope},'2020-01-15','2020-01-20','{"excludedKeys":[],"excludedGroups":[]}',repeat('a',32),'{"allSources":[],"observedChanges":[]}', '${actor}','${label}');
    insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
      'id','${next}','export_no','REX-SPLIT-${next}','sequence_no',202,'created_at','2020-01-24T01:00Z'))).* from public.rubber_exports e where id='${rex[0]}';`);
  const {page,context}=await open(browser);
  try{
    await settings(page);await fillSettings(page);
    await expect(page.getByRole('button',{name:'ถัดไป',exact:true})).toBeDisabled();
    await page.getByLabel('ช่วงที่กำลังตรวจ').selectOption('1');await fillSettings(page,'0.03');
    await page.getByLabel('ช่วงที่กำลังตรวจ').selectOption('0');
    await expect(page.getByLabel('อัตราโบนัสต่อกิโลกรัม (บาท)',{exact:true})).toHaveValue('0.02');
    await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
    await page.getByLabel('ยอดโบนัสสุดท้าย 2020-01-12 ถึง 2020-01-12 (บาท)',{exact:true}).fill('0');
    await page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ผลคำขอยืนยันโบนัสทุกช่วง',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:/เปิดผล$/})).toHaveCount(2);
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('3');
    expect(Number(resetTestSql(`select snapshot->>'finalAmount' from public.branch_bonuses where location_id=${scope} and period_start='2020-01-12'`))).toBe(0);
    expect(Number(resetTestSql(`select snapshot->>'finalAmount' from public.branch_bonuses where location_id=${scope} and period_start='2020-01-24'`))).toBeGreaterThan(0);
  }finally{await context.close();}
});

test('an unfinished REX outside the first rendered page still blocks progress',async({browser})=>{
  await ready();const pending=crypto.randomUUID(),pendingNo='REX-HIDDEN-'+pending;
  resetTestSql(`insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
    'id',gen_random_uuid(),'export_no','REX-PAGE-'||n,'sequence_no',300+n))).* from public.rubber_exports e cross join generate_series(1,51) n where id='${rex[0]}';
    insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
    'id','${pending}','export_no','${pendingNo}','sequence_no',399,'created_at','2019-01-01T01:00Z','sold_out_at',null,'sold_out_by_user_id',null,'sold_out_by_name',null))).* from public.rubber_exports e where id='${rex[0]}';`);
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
    metrics:{burden:{weight:0,target:null},loss:{weight:12.5,target:10},counts:{weight:87.5,target:1}}};
  const expected=resetTestSql(`select set_config('request.jwt.claim.sub','${actor}',false);
    create temp table legacy_pending as select '${JSON.stringify(input)}'::jsonb input,private.branch_bonus_calculate('${branch}','${JSON.stringify(input)}',clock_timestamp()) snapshot;
    insert into public.branch_bonuses(id,location_id,period_start,period_end,input,request_fingerprint,snapshot,created_by_user_id,created_by_name)
      select '${id}',${scope},'2020-01-12','2020-01-12',input,repeat('a',32),snapshot||jsonb_build_object('finalAmount',snapshot->'suggestedAmount'),'${actor}','${label}' from legacy_pending;
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
    const source=crypto.randomUUID();
    resetTestSql(`insert into public.income_expense(id,client_temp_id,local_bill_no,server_bill_no,sync_status,record_status,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone)
      values('${source}','${source}','${source}','${source}','synced','active',${scope},'expense','1','2020-01-12','Changed after review',100,'ค่าใช้จ่าย','${actor}','${label}','${phone}');`);
    await page.getByRole('button',{name:'ยืนยันโบนัสทุกช่วง',exact:true}).click();
    await expect(page.getByRole('heading',{name:'ตรวจ REX ที่รอทำโบนัส',exact:true})).toBeVisible();
    expect(resetTestSql(`select count(*) from public.branch_bonuses where location_id=${scope}`)).toBe('0');
  }finally{await context.close();}
});
