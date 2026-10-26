// Local-only real Auth/PostgREST integration. Never sends SMS or touches Cloud.
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID, randomInt, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:55421';
const inspect=JSON.parse(execFileSync('docker',['inspect','supabase_auth_webapp'],{encoding:'utf8'}))[0];
const secret=inspect.Config.Env.find(v=>v.startsWith('GOTRUE_JWT_SECRET=')).slice(18);
function jwt(role) {
  const body=[{alg:'HS256',typ:'JWT'},{role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}
const key=jwt('service_role');
async function req(path,body,token=key,method=body===undefined?'GET':'POST') {
  const response=await fetch(base+path,{method,headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json().catch(()=>null)};
}
async function rpc(name,body,token) { const r=await req('/rest/v1/rpc/'+name,body,token); assert.ok(r.status<300,`${name}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; }
const sql=text=>execFileSync('docker',['exec','-i','supabase_db_webapp','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});
const fixtures=[]; let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const password=`Approval-${randomUUID()}`;
async function user(role='user',manager=false) {
  const phone=`668${randomInt(10000000,99999999)}`;
  const r=await req('/auth/v1/admin/users',{phone,password,phone_confirm:true}); assert.equal(r.status,200); fixtures.push(r.data.id);
  const p=await req('/rest/v1/profiles',{id:r.data.id,phone:'0'+phone.slice(2),name:'Browser integration',role,is_active:true,can_access_super_admin_features:manager}); assert.ok(p.status<300);
  return {id:r.data.id,phone};
}
async function login(u) { const r=await req('/auth/v1/token?grant_type=password',{phone:u.phone,password}); assert.equal(r.status,200); return {token:r.data.access_token,sid:JSON.parse(Buffer.from(r.data.access_token.split('.')[1],'base64url')).session_id}; }
try {
  const actors=await req('/rest/v1/profiles?role=eq.super_admin&select=id'); const actor=actors.data[0].id;
  const target=await user(); const manager=await user('admin',true); const ordinary=await user('admin');
  const loc=(await req('/rest/v1/locations?is_active=eq.true&select=id&limit=1')).data[0].id;
  await req('/rest/v1/user_locations',{user_id:target.id,location_id:loc,is_primary:true});
  const old=await login(target);
  await rpc('set_user_sms_required',{p_actor:actor,p_target:target.id,p_required:true});
  check((await rpc('sms_login_status',{},old.token)).status==='SESSION_REVOKED','toggle revokes old session');
  let session=await login(target); const hash=createHash('sha256').update(randomUUID()).digest('hex');
  const bootstrap=(s=session,h=hash,request=true,resubmit=false)=>rpc('bootstrap_browser_approval',{p_user:target.id,p_session:s.sid,p_hash:h,p_label:'Chrome · Windows',p_request:request,p_resubmit:resubmit});
  check((await bootstrap(session,hash,false)).status==='MISSING','status does not create request');
  const concurrent=await Promise.all(Array.from({length:8},()=>bootstrap()));
  check(concurrent.every(v=>v.status==='PENDING'),'multiple tabs pending');
  let list=await rpc('list_browser_approvals',{p_actor:actor}); let row=list.find(r=>r.userId===target.id);
  check(row.pending.length===1,'multiple tabs deduplicated'); check(row.primaryLocationId===loc,'primary branch returned');
  check((await req('/rest/v1/profiles?select=id',undefined,session.token)).status===401,'pending direct REST blocked');
  check((await req('/rest/v1/rpc/get_my_effective_active_location_scope',{},session.token)).status===401,'pending definer blocked');
  check(!(await rpc('list_browser_approvals',{p_actor:ordinary.id})).some(r=>r.userId===target.id),'ordinary admin has no approval rights');
  const manage=(who,action,id=row.pending[0].id)=>req('/rest/v1/rpc/manage_browser_approval',{p_actor:who,p_target:target.id,p_action:action,p_id:id});
  check((await manage(ordinary.id,'approve')).status===403,'ordinary admin cannot approve');
  check((await manage(target.id,'approve')).status===403,'self approval rejected');
  check((await manage(manager.id,'cancel')).status<300,'manager can cancel ordinary target in effective scope');
  check((await bootstrap()).status==='CANCELLED','bootstrap does not recreate cancelled request');
  check((await bootstrap(session,hash,false)).status==='CANCELLED','polling does not recreate cancelled request');
  check((await bootstrap(session,hash,true,true)).status==='PENDING','explicit resubmit allowed');
  await req('/rest/v1/profiles?id=eq.'+target.id,{role:'admin',can_access_super_admin_features:true},key,'PATCH');
  check((await manage(manager.id,'approve')).status===403,'target promoted while pending requires superadmin');
  check((await rpc('sms_login_status',{},session.token)).status==='SESSION_REVOKED','manager promotion invalidates ordinary-account sessions');
  session=await login(target);await bootstrap();
  row=(await rpc('list_browser_approvals',{p_actor:actor})).find(r=>r.userId===target.id);
  check((await manage(actor,'approve')).status<300,'superadmin approves manager target');
  check((await bootstrap()).status==='READY','approval attaches session');
  check((await rpc('sms_login_status',{},session.token)).status==='READY','real gate ready');
  check((await req('/rest/v1/profiles?select=id',undefined,session.token)).status===200,'approved direct REST allowed');
  const next=await login(target);
  check((await bootstrap(next)).status==='READY','new login remembers browser');
  check((await bootstrap(next,createHash('sha256').update('other').digest('hex'))).status==='PENDING','new browser needs approval');
  check((await manage(actor,'revoke',null)).status<300,'revoke all succeeds');
  check((await rpc('sms_login_status',{},session.token)).status==='SESSION_REVOKED','revoke all blocks old token');
  check((await bootstrap(next)).status==='SESSION_REVOKED','revoke blocks concurrent existing session');
  const after=await login(target); check((await bootstrap(after)).status==='PENDING','revoked trust needs fresh approval');
  const noScope=await user(); await rpc('set_user_sms_required',{p_actor:actor,p_target:noScope.id,p_required:true});
  const ns=await login(noScope); await rpc('bootstrap_browser_approval',{p_user:noScope.id,p_session:ns.sid,p_hash:hash,p_label:'Safari · iOS',p_request:true});
  check((await rpc('list_browser_approvals',{p_actor:actor})).some(r=>r.userId===noScope.id&&r.primaryLocationId===null&&r.pending.length===1),'no branch visible to superadmin');
  check(!(await rpc('list_browser_approvals',{p_actor:manager.id})).some(r=>r.userId===noScope.id),'no branch outside manager scope');
  const denied=await req('/rest/v1/rpc/bootstrap_browser_approval',{p_user:target.id,p_session:after.sid,p_hash:hash,p_label:'test',p_request:true},after.token);
  check(denied.status>=400,'bootstrap RPC never callable by browser role');
  check(!await rpc('verify_sms_challenge',{p_user:target.id,p_session:after.sid,p_id:randomUUID(),p_digest:'unused'}),'old SMS verifier disabled');
  await rpc('set_user_sms_required',{p_actor:actor,p_target:target.id,p_required:false});
  check((await rpc('sms_login_status',{},after.token)).status==='READY','toggle off keeps current valid session');
  await rpc('set_user_sms_required',{p_actor:actor,p_target:target.id,p_required:true});
  const reopened=await login(target); check((await bootstrap(reopened,hash,false)).status==='MISSING','reopen does not trust prior generation');
  list=await rpc('list_browser_approvals',{p_actor:actor}); row=list.find(r=>r.userId===target.id);
  check(row.lastApprovedBy!==null&&row.lastApprovedAt!==null,'latest approver survives revocation');
  check(!(await rpc('list_browser_approvals',{p_actor:manager.id})).some(r=>r.userId===target.id),'manager badge excludes manager target');
  await bootstrap(reopened);
  row=(await rpc('list_browser_approvals',{p_actor:actor})).find(r=>r.userId===target.id);
  const race=await Promise.all([manage(actor,'approve',row.pending[0].id),manage(actor,'revoke',null)]);
  check(race[1].status<300,'concurrent revoke succeeds');
  check((await rpc('sms_login_status',{},reopened.token)).status==='SESSION_REVOKED','approve racing revoke never restores old session');
  const credentials=await login(target);await bootstrap(credentials);
  const rls=sql(`begin;set local role authenticated;select set_config('request.jwt.claims','${JSON.stringify(JSON.parse(Buffer.from(credentials.token.split('.')[1],'base64url')))}',true);select count(*) from public.profiles;rollback;`);
  check(rls.includes('\n0\nROLLBACK'),'pending restrictive RLS blocks rows even without pre-request hook');
  row=(await rpc('list_browser_approvals',{p_actor:actor})).find(r=>r.userId===target.id);
  await manage(actor,'approve',row.pending[0].id);await bootstrap(credentials);
  const changed=await req('/auth/v1/admin/users/'+target.id,{password:`Changed-${randomUUID()}`},key,'PUT');
  check(changed.status<300,'Auth password change succeeds');
  check((await rpc('sms_login_status',{},credentials.token)).status==='SESSION_REVOKED','password change revokes active session');
  check(sql(`select state from private.browser_approvals where user_id='${target.id}' and secret_hash='${hash}';`).trim()==='revoked','password change revokes browser trust');
  // Restore fixture password; the next fresh login must request approval again.
  await req('/auth/v1/admin/users/'+target.id,{password},key,'PUT');
  const phoneSession=await login(target);await bootstrap(phoneSession);
  row=(await rpc('list_browser_approvals',{p_actor:actor})).find(r=>r.userId===target.id);
  await manage(actor,'approve',row.pending[0].id);await bootstrap(phoneSession);
  const newPhone=`669${randomInt(10000000,99999999)}`;
  await rpc('prepare_sms_phone_change',{p_actor:actor,p_target:target.id,p_phone:newPhone});
  check((await req('/auth/v1/admin/users/'+target.id,{phone:newPhone,phone_confirm:true},key,'PUT')).status<300,'authorized phone change succeeds');
  check((await rpc('sms_login_status',{},phoneSession.token)).status==='SESSION_REVOKED','phone change revokes session');
  target.phone=newPhone;
  const newNumber=await login(target);check((await bootstrap(newNumber,hash,false)).status==='MISSING','phone change invalidates trust generation');
  sql(`update auth.sessions set not_after=now()-interval '1 second' where id='${newNumber.sid}';`);
  check((await bootstrap(newNumber)).status==='SESSION_REVOKED','expired session cannot request approval');
  await req('/rest/v1/user_locations',{user_id:noScope.id,location_id:loc,is_primary:true});
  let history=(await rpc('list_browser_approvals',{p_actor:actor})).find(r=>r.userId===noScope.id);
  await rpc('manage_browser_approval',{p_actor:actor,p_target:noScope.id,p_action:'approve',p_id:history.pending[0].id});
  const historyHash=createHash('sha256').update(randomUUID()).digest('hex');
  await rpc('bootstrap_browser_approval',{p_user:noScope.id,p_session:ns.sid,p_hash:historyHash,p_label:'test',p_request:true});
  history=(await rpc('list_browser_approvals',{p_actor:manager.id})).find(r=>r.userId===noScope.id);
  await rpc('manage_browser_approval',{p_actor:manager.id,p_target:noScope.id,p_action:'approve',p_id:history.pending[0].id});
  await req('/rest/v1/profiles?id=eq.'+manager.id,undefined,key,'DELETE');
  history=(await rpc('list_browser_approvals',{p_actor:actor})).find(r=>r.userId===noScope.id);
  check(history.lastApprovedBy===null&&history.lastApprovedAt!==null,'deleted latest approver uses fallback, not an older approver name');
  await req('/rest/v1/profiles?id=eq.'+noScope.id,{is_active:false},key,'PATCH');
  check((await rpc('bootstrap_browser_approval',{p_user:noScope.id,p_session:ns.sid,p_hash:hash,p_label:'test',p_request:true})).status==='SESSION_REVOKED','inactive target cannot bootstrap');
  for(const signature of ['bootstrap_browser_approval(uuid,uuid,text,text,boolean,boolean)','manage_browser_approval(uuid,uuid,text,uuid)','list_browser_approvals(uuid)']) {
    check(sql(`select has_function_privilege('authenticated','public.${signature}','execute');`).trim()==='f',`${signature} is service-only even without pre-request hook`);
  }
  const count=sql(`select count(*) from private.browser_approvals where user_id='${target.id}' and secret_hash='${hash}';`).trim();
  check(count==='1','one record per browser/account across lifecycle');
  console.log(`Browser approval integration: ${checks} checks passed; no SMS sent.`);
} finally {
  for(const id of fixtures) sql(`delete from private.sms_security_audit where target_id='${id}' or actor_id='${id}';`);
  for(const id of fixtures.reverse()) { await req('/auth/v1/admin/users/'+id,undefined,key,'DELETE'); await req('/rest/v1/profiles?id=eq.'+id,undefined,key,'DELETE'); }
}
