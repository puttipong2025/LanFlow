import { test, expect } from '@playwright/test';
import { loadSourceModule } from './helpers/load-source-module';

const id='11111111-1111-4111-8111-111111111111';
const boundary={
  SMS_HEADERS:{'Cache-Control':'no-store'},
  smsError:(errorCode:string,status=400)=>Response.json({errorCode},{status}),
  isSmsMutationAllowed:()=>true,
  getSmsIdentity:async()=>({userId:id,sessionId:id,status:'OTP_REQUIRED',password:true}),
};
test('bootstrap authenticates before validating body or touching cookies/database',async()=>{
  const mod=loadSourceModule<typeof import('../src/lib/server/browser-approval')>('src/lib/server/browser-approval.ts',{
    '@/lib/server/sms-otp':{...boundary,getSmsIdentity:async()=>null},
    'next/headers':{cookies:()=>{throw new Error('must not read');}},
  });
  expect((await mod.browserApprovalResponse(new Request('http://localhost',{method:'POST',body:'invalid'}),'mutation')).status).toBe(401);
});
test('foreign bootstrap cannot issue cookie or request',async()=>{
  const mod=loadSourceModule<typeof import('../src/lib/server/browser-approval')>('src/lib/server/browser-approval.ts',{
    '@/lib/server/sms-otp':{...boundary,isSmsMutationAllowed:()=>false},
    'next/headers':{cookies:()=>{throw new Error('must not read');}},
  });
  expect((await mod.browserApprovalResponse(new Request('http://localhost',{method:'POST'}),'mutation')).status).toBe(403);
});
test('bootstrap issues HttpOnly cookie and only sends its hash to database',async()=>{
  let args:Record<string,unknown>={};
  const mod=loadSourceModule<typeof import('../src/lib/server/browser-approval')>('src/lib/server/browser-approval.ts',{
    '@/lib/server/sms-otp':boundary,'next/headers':{cookies:async()=>({get:()=>undefined})},
    '@/lib/server/supabase-admin':{createSupabaseAdminClient:()=>({rpc:async(_name:string,p:Record<string,unknown>)=>{args=p;return {data:{status:'PENDING'},error:null};}})},
  },{process:{env:{NODE_ENV:'production'}}});
  const response=await mod.browserApprovalResponse(new Request('https://localhost',{method:'POST',body:JSON.stringify({action:'bootstrap'}),headers:{'user-agent':'Chrome/123 Windows'}}),'mutation');
  expect(response.status).toBe(200);
  const cookie=response.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=lax');
  const secret=cookie.match(/lanflow-browser=([a-f0-9]+)/)![1];
  expect(args.p_hash).toMatch(/^[a-f0-9]{64}$/);expect(args.p_hash).not.toBe(secret);
  expect(args.p_user).toBe(id);expect(args.p_request).toBe(true);
  expect(await response.text()).not.toContain(secret);
});
test('status never creates cookie or request; unavailable database fails closed',async()=>{
  for(const outage of [false,true]){
    let args:Record<string,unknown>={};
    const mod=loadSourceModule<typeof import('../src/lib/server/browser-approval')>('src/lib/server/browser-approval.ts',{
      '@/lib/server/sms-otp':boundary,'next/headers':{cookies:async()=>({get:()=>undefined})},
      '@/lib/server/supabase-admin':{createSupabaseAdminClient:()=>({rpc:async(_name:string,p:Record<string,unknown>)=>{args=p;return {data:{status:'MISSING'},error:outage?{}:null};}})},
    });
    const response=await mod.browserApprovalResponse(new Request('http://localhost'),'status');
    expect(args.p_request).toBe(false);expect(args.p_hash).toBeNull();expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.status).toBe(outage?503:200);
  }
});
test('admin route rejects ordinary admin and foreign origin without writes',async()=>{
  for(const manager of [false,true]){
    let writes=0;
    const mod=loadSourceModule<typeof import('../src/app/api/lanflow/admin/browser-approvals/route')>('src/app/api/lanflow/admin/browser-approvals/route.ts',{
      '@/lib/server/auth':{requireAuth:async()=>({ok:true,auth:{sub:id}}),hasSystemManagerAccess:()=>manager},
      '@/lib/server/sms-otp':{...boundary,isSmsMutationAllowed:()=>false},
      '@/lib/server/supabase-admin':{createSupabaseAdminClient:()=>{writes++;throw new Error('must not write');}},
    });
    expect((await mod.POST(new Request('http://localhost',{method:'POST'}))).status).toBe(403);expect(writes).toBe(0);
  }
});
test('admin mutation uses verified actor and maps revoked privileges/stale request',async()=>{
  for(const code of ['42501','P0001']){
    let args:Record<string,unknown>={};
    const mod=loadSourceModule<typeof import('../src/app/api/lanflow/admin/browser-approvals/route')>('src/app/api/lanflow/admin/browser-approvals/route.ts',{
      '@/lib/server/auth':{requireAuth:async()=>({ok:true,auth:{sub:id}}),hasSystemManagerAccess:()=>true},
      '@/lib/server/sms-otp':boundary,
      '@/lib/server/supabase-admin':{createSupabaseAdminClient:()=>({rpc:async(_name:string,p:Record<string,unknown>)=>{args=p;return {error:{code,message:'STALE_REQUEST'}};}})},
    });
    const response=await mod.POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({userId:id,action:'approve',id,p_actor:'forged'})}));
    expect(response.status).toBe(code==='42501'?403:409);expect(args.p_actor).toBe(id);
  }
});

test('database outage is retryable and revoke ignores an unrelated request ID',async()=>{
  let args:Record<string,unknown>={};
  const mod=loadSourceModule<typeof import('../src/app/api/lanflow/admin/browser-approvals/route')>('src/app/api/lanflow/admin/browser-approvals/route.ts',{
    '@/lib/server/auth':{requireAuth:async()=>({ok:true,auth:{sub:id}}),hasSystemManagerAccess:()=>true},
    '@/lib/server/sms-otp':boundary,
    '@/lib/server/supabase-admin':{createSupabaseAdminClient:()=>({rpc:async(_name:string,p:Record<string,unknown>)=>{args=p;return {error:{code:'08006',message:'connection unavailable'}};}})},
  });
  const response=await mod.POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({userId:id,action:'revoke',id:{unrelated:true}})}));
  expect.soft(args.p_id).toBeNull();expect(response.status).toBe(503);
});
