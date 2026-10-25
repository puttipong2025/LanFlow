// Local Auth + real Next.js route + Chromium. Provider delivery is deliberately not used.
import { spawn, execFileSync } from 'node:child_process';
import { createHmac, randomUUID, randomInt } from 'node:crypto';
import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:55421';
const authEnv=JSON.parse(execFileSync('docker',['inspect','supabase_auth_webapp'],{encoding:'utf8'}))[0].Config.Env;
const secret=authEnv.find(value=>value.startsWith('GOTRUE_JWT_SECRET=')).slice(18);
function token(role) {
  const data=[{alg:'HS256',typ:'JWT'},{role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${data}.${createHmac('sha256',secret).update(data).digest('base64url')}`;
}
const service=token('service_role');
const anon=token('anon');
const admin=createClient(base,service,{auth:{persistSession:false,autoRefreshToken:false}});
const otpSecret=randomUUID()+randomUUID();
const phone=`08${randomInt(10_000_000,99_999_999)}`;
const password=randomUUID();
const port=3107;
let user, browser, server;
const output=[];
try {
  const {data:actors,error:actorError}=await admin.from('profiles').select('id').eq('role','super_admin').limit(1);
  assert.equal(actorError,null);
  const created=await admin.auth.admin.createUser({phone:`+66${phone.slice(1)}`,password,phone_confirm:true});
  assert.equal(created.error,null);
  user=created.data.user.id;
  assert.equal((await admin.from('profiles').insert({id:user,name:'SMS browser fixture',phone,role:'admin',is_active:true})).error,null);
  assert.equal((await admin.rpc('set_user_sms_required',{p_actor:actors[0].id,p_target:user,p_required:true})).error,null);
  const values=new Map();
  // Non-singleton cookie adapter mirrors the browser's actual SSR cookie format.
  const client=createBrowserClient(base,anon,{isSingleton:false,cookies:{getAll:()=>[],setAll:items=>{for(const item of items) values.set(item.name,item.value);}}});
  const signed=await client.auth.signInWithPassword({phone:`+66${phone.slice(1)}`,password});
  assert.equal(signed.error,null);
  const session=JSON.parse(Buffer.from(signed.data.session.access_token.split('.')[1],'base64url').toString()).session_id;
  // Use a server client too: verifies the cookie adapter can read the same identity.
  const cookieClient=createServerClient(base,anon,{cookies:{getAll:()=>[...values].map(([name,value])=>({name,value})),setAll:()=>{}}});
  assert.equal((await cookieClient.auth.getUser()).data.user?.id,user);
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p',String(port)],{
    env:{...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:anon,
      NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,SUPABASE_SECRET_KEY:service,SMS_OTP_SECRET:otpSecret,THSMS_API_KEY:'',THSMS_SENDER:''},
    stdio:['ignore','pipe','pipe'],
  });
  server.stdout.on('data',chunk=>output.push(chunk.toString()));
  server.stderr.on('data',chunk=>output.push(chunk.toString()));
  for(let attempt=0;attempt<60;attempt++) {
    try { if((await fetch(`http://127.0.0.1:${port}/login`,{signal:AbortSignal.timeout(3000)})).ok) break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:390,height:844},storageState:{cookies:[...values].map(([name,value])=>({name,value,domain:'127.0.0.1',path:'/',expires:Math.floor(Date.now()/1000)+3600,httpOnly:false,secure:false,sameSite:'Lax'})),origins:[]}});
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/login`);
  await page.getByRole('heading',{name:'ยืนยันการเข้าสู่ระบบ'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'OTP form must fit the mobile viewport');
  await page.screenshot({path:'output/sms-otp-mobile.png',fullPage:true});
  assert.equal(await page.locator('input[autocomplete="one-time-code"]').count(),1);
  await page.getByRole('button',{name:'รับรหัส SMS',exact:true}).click();
  await page.getByRole('status').filter({hasText:'ดำเนินการไม่สำเร็จ'}).waitFor();
  const challenge=randomUUID();
  const digest=createHmac('sha256',otpSecret).update(`${user}:${session}:${challenge}:123456`).digest('hex');
  assert.equal((await admin.rpc('reserve_sms_challenge',{p_user:user,p_session:session,p_id:challenge,p_digest:digest})).error,null);
  await admin.rpc('deliver_sms_challenge',{p_id:challenge});
  await page.evaluate(id=>sessionStorage.setItem('lanflow:sms-challenge',id),challenge);
  await page.reload();
  await page.getByLabel('รหัส SMS 6 หลัก').fill('000000');
  await page.getByRole('button',{name:'ยืนยันรหัส',exact:true}).click();
  await page.getByRole('status').filter({hasText:'รหัสไม่ถูกต้อง'}).waitFor();
  await page.getByLabel('รหัส SMS 6 หลัก').fill('123456');
  await page.route(`http://127.0.0.1:${port}/`,route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body>Verified fixture</body></html>'}));
  await page.getByRole('button',{name:'ยืนยันรหัส',exact:true}).click();
  await page.getByText('Verified fixture').waitFor();
  const verifiedStatus=await fetch(`${base}/rest/v1/rpc/sms_login_status`,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${signed.data.session.access_token}`,'Content-Type':'application/json'},body:'{}'});
  assert.equal((await verifiedStatus.json()).status,'READY');
  assert.deepEqual(pageErrors,[],'No browser runtime or hydration errors');
  await context.close();
  console.log('SMS browser/local API: pending state, mobile form, provider failure, wrong code and correct code passed; no SMS sent.');
} catch(error) {
  console.error(output.join('').slice(-1800).replace(/eyJ[A-Za-z0-9_.-]+/g,'[token hidden]'));
  throw error;
} finally {
  if(browser) await browser.close();
  if(server) {
    if(process.platform==='win32') {
      try { execFileSync('taskkill',['/pid',String(server.pid),'/T','/F'],{stdio:'ignore'}); } catch { server.kill(); }
    } else server.kill();
    server.stdout.destroy();
    server.stderr.destroy();
  }
  if(user) {
    execFileSync('docker',['exec','-i','supabase_db_webapp','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:`delete from private.sms_security_audit where target_id='${user}';`,encoding:'utf8'});
    await admin.from('profiles').delete().eq('id',user);
    await admin.auth.admin.deleteUser(user);
  }
}
