// Local-only integration proof. No SMS is sent and no production endpoint is read.
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID, randomInt } from 'node:crypto';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:55421';
const inspect = JSON.parse(execFileSync('docker', ['inspect', 'supabase_auth_webapp'], { encoding: 'utf8' }))[0];
const secret = inspect.Config.Env.find(value => value.startsWith('GOTRUE_JWT_SECRET=')).slice('GOTRUE_JWT_SECRET='.length);
function jwt(role, extra={}) {
  const payload = [ { alg: 'HS256', typ: 'JWT' }, { role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, ...extra } ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
}
const key=jwt('service_role');
async function request(path, token=key, body, method) {
  const response=await fetch(`${base}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body: body===undefined ? undefined : JSON.stringify(body) });
  const data=await response.json().catch(()=>null);
  return {status:response.status,data};
}
async function rpc(name,body,token=key) {
  const result=await request(`/rest/v1/rpc/${name}`,token,body);
  assert.ok(result.status<300, `${name} failed (${result.status})`);
  return result.data;
}
const phone=`08${randomInt(10_000_000,99_999_999)}`;
const phone2=`09${randomInt(10_000_000,99_999_999)}`;
const password=`Sms-test-${randomUUID()}`;
let user;
const ipHash=createHmac('sha256',secret).update(randomUUID()).digest('hex');
const globalFixture=randomUUID();
let checks=0;
const check=(value,message)=>{assert.ok(value,message); checks++;};
async function login(number=phone) {
  const result=await request('/auth/v1/token?grant_type=password',key,{phone:`66${number.slice(1)}`,password});
  assert.equal(result.status,200,'Local password login must succeed');
  return result.data;
}
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
try {
  const budgets=await Promise.all(Array.from({length:55},()=>rpc('claim_sms_ip_budget',{p_hash:ipHash})));
  check(budgets.filter(Boolean).length===50,'Concurrent IP budget allows only 50 sends');
  check(await rpc('sms_ip_retry_after',{p_hash:ipHash})>0,'IP rejection supplies a positive retry delay');
  check(!await rpc('claim_sms_ip_budget',{p_hash:'not-a-valid-bucket'}),'Invalid budget key rejected');
  const actorResult=await request('/rest/v1/profiles?role=eq.super_admin&select=id');
  const actor=actorResult.data[0]?.id;
  assert.ok(actor,'Local Super Admin fixture is required');
  const created=await request('/auth/v1/admin/users',key,{phone:`66${phone.slice(1)}`,password,phone_confirm:true});
  assert.equal(created.status,200);
  user=created.data.id;
  const profile=await request('/rest/v1/profiles',key,{id:user,phone,name:'SMS isolated integration',role:'admin',is_active:true});
  assert.ok(profile.status<300,'Create local profile');
  const first=await login();
  check((await rpc('sms_login_status',{},first.access_token)).status==='READY','Legacy session ready');
  await rpc('set_user_sms_required',{p_actor:actor,p_target:user,p_required:true});
  check((await rpc('sms_login_status',{},first.access_token)).status==='SESSION_REVOKED','Old token revoked immediately');
  check((await request('/rest/v1/profiles?select=id',first.access_token)).status===401,'Direct table access revoked');
  check((await request('/rest/v1/rpc/get_my_effective_active_location_scope',first.access_token,{})).status===401,'Definer RPC revoked');
  const second=await login();
  const sid=claims(second.access_token).session_id;
  const sql=text=>execFileSync('docker',['exec','-i','supabase_db_webapp','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});
  const rlsCount=sql(`begin; set local role authenticated; select set_config('request.jwt.claims','${JSON.stringify(claims(second.access_token))}',true); select count(*) from public.profiles where id='${user}'; rollback;`);
  check(rlsCount.split(/\r?\n/).includes('0'),'Restrictive RLS denies pending session without pre-request hook');
  check((await rpc('sms_login_status',{},jwt('authenticated',{sub:user,session_id:sid,amr:[{method:'otp'}]}))).status==='PASSWORD_REQUIRED','OTP-only Auth token is not a password factor');
  check((await rpc('sms_login_status',{},second.access_token)).status==='OTP_REQUIRED','Password alone not enough');
  const id=randomUUID();
  const digest='local-test-digest';
  const reserved=await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:id,p_digest:digest});
  check(reserved.phone===`66${phone.slice(1)}`,'Destination from registered phone');
  check((await request('/rest/v1/rpc/verify_sms_challenge',second.access_token,{p_user:user,p_session:sid,p_id:id,p_digest:digest})).status>=400,'Browser cannot call service-only verifier');
  check(!await rpc('verify_sms_challenge',{p_user:user,p_session:sid,p_id:id,p_digest:digest}),'Undelivered challenge rejected');
  await rpc('deliver_sms_challenge',{p_id:id});
  check(!await rpc('verify_sms_challenge',{p_user:user,p_session:sid,p_id:id,p_digest:'wrong'}),'Wrong code rejected');
  check(await rpc('verify_sms_challenge',{p_user:user,p_session:sid,p_id:id,p_digest:digest}),'Correct code accepted');
  check(!await rpc('verify_sms_challenge',{p_user:user,p_session:sid,p_id:id,p_digest:digest}),'Code cannot be reused');
  check((await rpc('sms_login_status',{},second.access_token)).status==='READY','Verified session ready');
  const third=await login();
  check((await rpc('sms_login_status',{},third.access_token)).status==='OTP_REQUIRED','Another session not authorized');
  check((await rpc('reserve_sms_challenge',{p_user:user,p_session:claims(third.access_token).session_id,p_id:randomUUID(),p_digest:digest})).error==='RATE_LIMITED','Resend cooldown spans sessions');
  // Fixture-only clock adjustment: never run against any database except this named local container.
  const fresh=async()=>{
    sql(`update private.sms_account_security set last_sent_at=now()-interval '31 seconds' where user_id='${user}';`);
    const next=randomUUID();
    const value=await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:next,p_digest:digest});
    assert.ok(value.phone,'Reserve fresh local challenge');
    await rpc('deliver_sms_challenge',{p_id:next});
    return next;
  };
  const replacement=await fresh();
  check(!await rpc('verify_sms_challenge',{p_user:user,p_session:sid,p_id:id,p_digest:digest}),'Replacement invalidates previous code');
  for(let attempt=0;attempt<5;attempt++) check(!await rpc('verify_sms_challenge',{p_user:user,p_session:sid,p_id:replacement,p_digest:'wrong'}),'Wrong attempt rejected');
  check(!await rpc('verify_sms_challenge',{p_user:user,p_session:sid,p_id:replacement,p_digest:digest}),'Five failures block even the correct code');
  const expired=await fresh();
  sql(`update private.sms_login_challenges set expires_at=now()-interval '1 second' where session_id='${sid}';`);
  check(!await rpc('verify_sms_challenge',{p_user:user,p_session:sid,p_id:expired,p_digest:digest}),'Expired code rejected');
  sql(`update private.sms_account_security set quota_sends=4,quota_window=now(),failures=0,send_window=now(),last_sent_at=now()-interval '31 seconds' where user_id='${user}';`);
  check(Boolean((await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:randomUUID(),p_digest:digest})).phone),'Fifth account send allowed after 30 seconds');
  const immediateCap=await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:randomUUID(),p_digest:digest});
  check(immediateCap.quota?.scope==='account'&&immediateCap.retryAfter>30,'Fifth-send limit reports the hourly wait even during resend cooldown');
  sql(`update private.sms_account_security set last_sent_at=now()-interval '31 seconds' where user_id='${user}';`);
  const capped=await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:randomUUID(),p_digest:digest});
  check(capped.error==='RATE_LIMITED'&&capped.retryAfter>0,'Sixth account send rejected with wait time');
  check(capped.quota?.count===5&&capped.quota?.limit===5,'Account rejection reports 5/5');
  const usage=await rpc('sms_send_usage',{p_user:user});
  check(usage.sentCount===5&&usage.sendLimit===5&&Date.parse(usage.resendAt)>Date.now(),'30-minute account usage survives page reload with available time');
  check((await request('/rest/v1/rpc/sms_send_usage',second.access_token,{p_user:user})).status>=400,'Browser cannot read service-only usage RPC directly');
  check(capped.retryAfter<=1800,'Account wait is at most 30 minutes');
  const hourlyBefore=Number(sql(`select sends from private.sms_account_security where user_id='${user}';`).trim());
  sql(`update private.sms_account_security set quota_window=now()-interval '31 minutes',last_sent_at=now()-interval '31 seconds' where user_id='${user}';`);
  const newHalfHour=await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:randomUUID(),p_digest:digest});
  check(newHalfHour.sentCount===1&&newHalfHour.sendLimit===5,'Account quota restarts after 30 minutes');
  check(Number(sql(`select sends from private.sms_account_security where user_id='${user}';`).trim())===hourlyBefore+1,'Half-hour reset preserves hourly global accounting');
  sql(`update private.sms_account_security set quota_sends=5,quota_window=now()-interval '29 minutes 55 seconds',last_sent_at=now() where user_id='${user}';`);
  const longerCooldown=await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:randomUUID(),p_digest:digest});
  check(longerCooldown.quota?.scope==='cooldown'&&longerCooldown.retryAfter>5,'Cooldown remains enforced when hourly reset occurs first');
  sql(`update private.sms_account_security set failure_window=now(),failures=10,quota_window=now()-interval '10 minutes' where user_id='${user}';`);
  const longerFailure=await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:randomUUID(),p_digest:digest});
  check(longerFailure.quota?.scope==='attempts'&&longerFailure.retryAfter>3500,'Wrong-code restriction takes precedence when it expires last');
  sql(`update private.sms_account_security set sends=0,quota_sends=0,quota_window=now(),failures=0,send_window=now(),last_sent_at=now()-interval '31 seconds' where user_id='${user}';
    insert into auth.users(id) values('${globalFixture}');
    insert into public.profiles(id,phone,name,role,is_active) values('${globalFixture}','${phone2}','Global budget fixture','user',true);
    insert into private.sms_account_security(user_id,sends,send_window) values('${globalFixture}',199,now());`);
  check(Boolean((await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:randomUUID(),p_digest:digest})).phone),'Global send 200 allowed');
  sql(`update private.sms_account_security set last_sent_at=now()-interval '31 seconds' where user_id='${user}';`);
  const globalCap=await rpc('reserve_sms_challenge',{p_user:user,p_session:sid,p_id:randomUUID(),p_digest:digest});
  check(globalCap.error==='RATE_LIMITED'&&globalCap.retryAfter>0,'Global send 201 rejected with wait time');
  sql(`delete from public.profiles where id='${globalFixture}'; delete from auth.users where id='${globalFixture}';`);
  await rpc('set_user_sms_required',{p_actor:actor,p_target:user,p_required:false});
  check((await rpc('sms_login_status',{},second.access_token)).status==='READY','Disabling does not revoke current session');
  const directChange=await request('/auth/v1/user',second.access_token,{phone:`66${phone2.slice(1)}`},'PUT');
  check(directChange.status>=400,'Direct self phone change forbidden');
  await rpc('prepare_sms_phone_change',{p_actor:actor,p_target:user,p_phone:`66${phone2.slice(1)}`});
  const changed=await request(`/auth/v1/admin/users/${user}`,key,{phone:`66${phone2.slice(1)}`,phone_confirm:true},'PUT');
  check(changed.status===200,'Authorized phone change succeeds');
  check((await rpc('sms_login_status',{},second.access_token)).status==='SESSION_REVOKED','Phone change revokes SMS-disabled session');
  const stored=await request(`/rest/v1/profiles?id=eq.${user}&select=phone`);
  check(stored.data[0].phone===phone2,'Profile phone synchronized atomically');
  const final=await login(phone2);
  check((await rpc('sms_login_status',{},final.access_token)).status==='READY','Same password works with new phone');
  console.log(`SMS local integration: ${checks} checks passed; no messages sent.`);
} finally {
  execFileSync('docker',['exec','-i','supabase_db_webapp','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:`delete from private.sms_ip_budgets where bucket_hash='${ipHash}'; delete from public.profiles where id='${globalFixture}'; delete from auth.users where id='${globalFixture}';`,encoding:'utf8'});
  if(user) {
    // Explicit fixture cleanup is constrained to the account generated above.
    execFileSync('docker',['exec','-i','supabase_db_webapp','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:`delete from private.sms_security_audit where target_id='${user}';`,encoding:'utf8'});
    await request(`/rest/v1/profiles?id=eq.${user}`,key,undefined,'DELETE');
    await request(`/auth/v1/admin/users/${user}`,key,undefined,'DELETE');
  }
}
