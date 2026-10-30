// Local HTTP/auth/receipt load, never Cloud. Logical clients share the existing
// Local super-admin test session; distinct-actor isolation is measured separately
// by the SQL load and security suites. This is not 40 rendered browser tabs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { request } from 'playwright';
import { parse } from 'dotenv';

const label = process.argv[2], clients = Number(process.env.RUBBER_LOAD_CLIENTS ?? 40);
const burst = process.env.RUBBER_LOAD_BURST === '1';
assert.match(label ?? '', /^[a-z0-9-]{1,48}$/); assert.ok([40,80].includes(clients));
const localEnv = parse(fs.readFileSync('.env.local'));
for (const raw of [localEnv.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL].filter(Boolean)) {
  const target = new URL(raw);
  assert.ok(target.protocol === 'http:' && ['localhost','127.0.0.1'].includes(target.hostname)
    && target.port === '55421', 'HTTP load requires Local Supabase, never a hosted target');
}
const sql = input => execFileSync('docker', ['exec','-i','supabase_db_webapp','psql','-X','-q','-At',
  '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
{ input, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'], maxBuffer: 4*1024*1024 }).trim();
const baseURL = 'http://127.0.0.1:3000', endpoint = '/api/lanflow/rubber-bills/queue';
const session = await request.newContext({ baseURL, storageState: 'playwright/.auth/super_admin.json', timeout: 30_000 });
const branches = Array.from({ length: clients }, () => randomUUID());
const ids = branches.map(id => `'${id}'`).join(','), samples = [], errors = [], readRetries = [], operations = {};
let before, after, origin, metadata;
const counters = () => JSON.parse(sql("select jsonb_build_object('commits',xact_commit,'rollbacks',xact_rollback,'blocksHit',blks_hit,'blocksRead',blks_read) from pg_stat_database where datname='postgres'"));
const failure = (operation,error) => ({ operation,code:error.code??error.name,
  reason:['ECONNRESET','ECONNREFUSED','socket hang up','Timeout','timeout','closed','fetch failed']
    .find(reason=>String(error.message).includes(reason))??'unclassified' });
async function call(name, path, data, retried = false) {
  const start = performance.now();
  let retry = false;
  try {
    const response = data ? await session.post(path, { data }) : await session.get(path);
    assert.ok(response.ok(), `${name} HTTP ${response.status()}`);
    return await response.json();
  } catch(error) {
    // Match QueryProvider's existing retry:1 for table/queue reads. Preserve
    // every raw reset; never retry admission/context or hide an HTTP rejection.
    if (!data && !retried && ['feed','queue-list'].includes(name)
        && String(error.message).includes('ECONNRESET')) {
      readRetries.push(failure(name,error)); retry=true;
    } else throw error;
  } finally {
    const v = operations[name] ??= { calls: 0, elapsedMs: 0 };
    v.calls++; v.elapsedMs += performance.now() - start;
  }
  if (retry) { await delay(1000); return call(name,path,data,true); }
}
async function read(branch) {
  const feed = await call('feed', `/api/lanflow/rubber-bills/feed?locationId=${branch}&limit=100`);
  assert.ok(Array.isArray(feed.rows) && feed.rows.every(row => row.location_id === branch));
}
try {
  const me = await call('auth', '/api/auth/me');
  assert.equal(me.profile.role, 'super_admin');
  assert.match(me.profile.id, /^[0-9a-f-]{36}$/);
  sql(`begin;${branches.map(branch => `
    insert into public.locations(id,name,code,is_active) values('${branch}','HTTP load ${branch}','H${branch.slice(0,8)}',true);
    insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,
      sync_status,record_status,location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,
      average_price,deduction_total,net_total,revision_no,created_by_user_id,created_by_name,created_by_phone)
    select gen_random_uuid(),gen_random_uuid()::text,'seed-'||g,'seed-'||g,'${branch}:'||g,
      'synced','active','${branch}','seed-'||g,current_date,'HTTP synthetic fixture','weighing',100,100,
      1,0,100,1,'${me.profile.id}','HTTP synthetic fixture','fixture' from generate_series(1,100) g;
  `).join('')}commit;`);
  // Warm HTTP routing/auth and branch-independent handler compilation without
  // creating a command. First real sample is retained, not silently discarded.
  await read(branches[0]);
  await call('queue-list', `${endpoint}?locationId=${branches[0]}`);
  await call('command-context', `/api/lanflow/rubber-bills/command-context?locationId=${branches[0]}&clientTempId=${randomUUID()}`);
  assert.equal((await session.post(endpoint, { data: {} })).status(), 400);
  metadata = {
    sourceRevision: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),
    helpers: JSON.parse(sql("select jsonb_agg(jsonb_build_object('name',proname,'md5',md5(pg_get_functiondef(oid))) order by proname) from pg_proc where pronamespace='private'::regnamespace and proname in ('rubber_actor_active','rubber_actor_manager','rubber_actor_location')")),
  };
  for (const key of Object.keys(operations)) delete operations[key];
  before = counters(); origin = performance.now();
  await Promise.all(branches.map(async (branch, index) => {
    const writing = (async () => {
      for (let cycle=0; cycle<2; cycle++) {
        const due = origin + (burst ? 0 : index * 30_000 / clients) + cycle * 30_000;
        await delay(Math.max(0,due-performance.now()));
        const start=performance.now(), command=randomUUID();
        const sample={ command, status:'unknown', offeredAtMs:due-origin, dispatchLagMs:start-due };
        samples.push(sample);
        try {
          const context=await call('command-context', `/api/lanflow/rubber-bills/command-context?locationId=${branch}&clientTempId=${command}`);
          let receipt=await call('admission', endpoint, { centralQueue:true,contractVersion:2,
            actorUserId:me.profile.id,commandId:command,idempotencyKey:command,locationId:branch,clientTempId:command,
            operation:'create',expectedCommandGeneration:context.generation,expectedQueueVersion:context.queueVersion,
            expectedRevisionNo:0,localBillNo:command,
            billDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date()),
            billType:'weighing',customerName:'HTTP synthetic fixture',inputMethod:'manual',deductWeight:0,acidPackCount:0,
            items:[{itemType:'weigh',title:'Weigh',inWeight:100,outWeight:0,netWeight:100,unitPrice:0,sequenceNo:1}] });
          sample.admittedState=receipt.state; sample.receiptPolls=0;
          while(receipt.state!=='done' && performance.now()-start<60_000) {
            await delay(2000);
            sample.receiptPolls++;
            receipt=await call('receipt', `${endpoint}?locationId=${branch}&commandId=${command}`);
          }
          assert.equal(receipt.commandId,command); assert.equal(receipt.state,'done');
          assert.equal(receipt.result?.status,'synced'); assert.equal(receipt.attempts,1);
          sample.status='synced'; sample.confirmedMs=performance.now()-start;
          await read(branch);
        } catch(error) { sample.status='failed'; errors.push(failure('save',error)); }
      }
    })();
    const reading = (async () => {
      for(let at=0;at<60_000;at+=10_000) {
        await delay(Math.max(0,origin+at+index*10-performance.now()));
        try {
          if(at===0) await read(branch);
          await call('queue-list', `${endpoint}?locationId=${branch}`);
        } catch(error) { errors.push(failure('read',error)); }
      }
    })();
    await Promise.all([writing,reading]);
  }));
  if (burst) await delay(Math.max(0,origin+60_000-performance.now()));
  after=counters();
  const outcomes=JSON.parse(sql(`select jsonb_build_object('commands',count(*),'done',count(*) filter(where state='done' and result->>'status'='synced'),
    'attempts',sum(attempts),'effects',(select count(*) from public.rubber_bills where location_id in (${ids}) and local_bill_no not like 'seed-%'))
    from private.rubber_queue_jobs where location_id in (${ids})`));
  assert.equal(outcomes.commands,clients*2);assert.equal(outcomes.done,clients*2);
  assert.equal(outcomes.attempts,clients*2);assert.equal(outcomes.effects,clients*2);
} catch(error) { errors.push(failure('setup-or-verification',error)); }
finally {
  await session.dispose();
  sql(`begin;set local app.history_retention_cleanup='on';
    delete from public.rubber_bill_approval_requests where location_id in (${ids});
    delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id in (${ids}));
    delete from public.rubber_bills where location_id in (${ids});set constraints all immediate;
    delete from public.dashboard_money_events where location_id in (${ids});
    delete from public.dashboard_branch_snapshots where location_id in (${ids});
    delete from public.document_deletion_audits where location_id in (${ids});
    delete from public.user_locations where location_id in (${ids});
    delete from public.locations where id in (${ids});commit;`);
  assert.equal(sql(`select count(*) from private.rubber_queue_jobs where location_id in (${ids})`),'0');
  const ordered=samples.filter(s=>s.status==='synced').map(s=>s.confirmedMs).sort((a,b)=>a-b);
  const pct=p=>ordered[Math.ceil(ordered.length*p)-1]??null;
  const result={label,clients,burst,expectedCommands:clients*2,confirmed:ordered.length,medianMs:pct(.5),p95Ms:pct(.95),
    environment:'Local HTTP/auth logical branch clients sharing one super-admin test session. Separate from browser render and distinct-actor SQL load. 100 seeded bill headers per branch; no seeded items.',
    readRetryPolicy:'One retry after 1s only for feed/list ECONNRESET, matching existing query retry:1; raw errors retained. No write/context retry.',
    metadata,before,after,operations,readRetries,errors,samples};
  fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/rubber-branch-http-'+label+'.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({label,clients,confirmed:ordered.length,medianMs:result.medianMs,p95Ms:result.p95Ms,readRetries:readRetries.length,errors}));
  if(errors.length)process.exitCode=1;
}
