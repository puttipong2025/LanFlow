// Real HTTP/auth/admission/committed receipt workload against Local only.
import assert from 'node:assert/strict';
import { request } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
// Playwright network errors can embed the authenticated Cookie header.
process.on('uncaughtException', error => {
  console.error(JSON.stringify({ error: error.name, message: 'Local benchmark failed; check server availability and test assertions. Authenticated request logs are suppressed.' }));
  process.exitCode = 1;
});
const mode=process.argv[2];assert.ok(['baseline','phase2','candidate'].includes(mode));
const baseURL=`http://127.0.0.1:${mode==='baseline'?3100:mode==='phase2'?3200:3000}`;
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_webapp','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
  {input,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
const client=await request.newContext({baseURL,storageState:'playwright/.auth/super_admin.json'});
const me=await(await client.get('/api/auth/me')).json();assert.match(me.profile.id,/^[0-9a-f-]{36}$/);
const actor=me.profile.id,branch=randomUUID();
const saved=JSON.parse(sql("select row_to_json(j) from(select schedule,command from cron.job where jobname='rubber-central-queue')j"));
const endpoint='/api/lanflow/rubber-bills/queue';
const stats=()=>({db:JSON.parse(sql(`select jsonb_build_object('commits',xact_commit,'rollbacks',xact_rollback,'blocksRead',blks_read,'blocksHit',blks_hit,
  'activeConnections',(select count(*) from pg_stat_activity where datname='postgres')) from pg_stat_database where datname='postgres'`)),
  cpu:execFileSync('docker',['exec','supabase_db_webapp','cat','/sys/fs/cgroup/cpu.stat'],{encoding:'utf8'}).trim(),
  io:execFileSync('docker',['exec','supabase_db_webapp','cat','/sys/fs/cgroup/io.stat'],{encoding:'utf8'}).trim()});
try {
  if(mode!=='candidate')sql("select cron.alter_job(jobid,schedule:='10 seconds',command:='set statement_timeout=''8s'';set lock_timeout=''2s'';select private.process_rubber_queue(20)') from cron.job where jobname='rubber-central-queue'");
  else sql(readFileSync('supabase/migrations/20261029021000_rubber_queue_committed_attempts.sql','utf8'));
  const workloads=JSON.parse(sql(`begin;insert into public.locations(id,name,code,is_active) values('${branch}','API workload','A${branch.slice(0,8)}',true);
    create temp table workloads(scenario text,n integer,round integer,payload jsonb);
    do $setup$
    declare scenario text;n integer;round integer;i integer;command uuid;bill uuid;source uuid;seed uuid;target uuid;payload jsonb;cap numeric;
    begin
      perform set_config('request.jwt.claim.sub','${actor}',true);
      select effective_price_cap into cap from private.resolve_rubber_bill_price_policy_without_quota('${branch}');
      foreach scenario in array array['manual_direct','manual_approval','ocr_direct','ocr_approval','update','delete','approve','cancel'] loop
      foreach n in array array[1,5,10] loop for round in 1..2 loop for i in 1..n loop
        command:=gen_random_uuid();bill:=gen_random_uuid();
        payload:=jsonb_build_object('centralQueue',true,'actorUserId','${actor}','contractVersion',2,'commandId',command,'idempotencyKey',command,
          'locationId','${branch}','clientTempId',bill,'operation','create','expectedCommandGeneration',0,'expectedQueueVersion',0,'expectedRevisionNo',0,
          'localBillNo',bill,'billDate',(clock_timestamp() at time zone 'Asia/Bangkok')::date,'billType','weighing','customerName','API synthetic fixture',
          'inputMethod','manual','deductWeight',0,'acidPackCount',0,'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','Weigh',
          'inWeight',100,'outWeight',0,'netWeight',100,'unitPrice',case when scenario like '%approval' then cap+1 else least(cap,1) end,'sequenceNo',1)));
        if scenario like 'ocr_%' then
          source:=gen_random_uuid();insert into public.rubber_bill_ocr_sources(id,owner_user_id,location_id,state,image_sha256,drive_file_id,image_mime_type,image_size_bytes,original_file_name)
            values(source,'${actor}','${branch}','staged',md5(source::text)||md5(source::text),'synthetic-'||source,'image/jpeg',1024,'fixture.jpg');
          payload:=payload||jsonb_build_object('inputMethod','ocr','ocrUploadId',source);
        end if;
        if scenario in ('update','delete','approve','cancel') then
          insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,location_id,bill_no,bill_date,
            customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,revision_no,created_at,created_by_user_id,created_by_name,created_by_phone)
            values(bill,bill,bill,bill,'seed:'||bill,'synced','active','${branch}',bill,(clock_timestamp() at time zone 'Asia/Bangkok')::date,
            'API synthetic fixture','weighing',100,100,1,0,100,1,case when scenario in ('approve','cancel') then '2000-01-01'::timestamptz else clock_timestamp() end,
            '${actor}','API fixture','0000000000');
          payload:=payload||jsonb_build_object('operation',case when scenario='update' then 'update' else 'delete' end,'expectedRevisionNo',1,'expectedServerId',bill);
          if scenario in ('approve','cancel') then
            seed:=gen_random_uuid();perform public.submit_rubber_queue(payload||jsonb_build_object('commandId',seed,'idempotencyKey',seed));
            perform private.process_rubber_queue_batch(1,'${branch}');
            select id into target from public.rubber_bill_approval_requests where location_id='${branch}' and client_temp_id=bill::text and request_status='pending';
            if target is null then raise exception 'Missing approval fixture';end if;
            payload:=jsonb_build_object('centralQueue',true,'actorUserId','${actor}','contractVersion',2,'commandId',command,'idempotencyKey',command,
              'locationId','${branch}','clientTempId','request:'||target,'operation','update','queueAction',scenario,'targetRequestId',target);
          end if;
        end if;
        insert into workloads values(scenario,n,round,payload);
      end loop;end loop;end loop;end loop;
    end $setup$;
    select jsonb_agg(to_jsonb(w) order by round,n,scenario) from workloads w;commit;`));
  const before=stats(),samples=[];
  const started=Date.now();
  for(const workload of workloads) {
    const payload=workload.payload;
    const start=Date.now();let contextMs=0;
    if(!payload.queueAction) {
      const response=await client.get(`/api/lanflow/rubber-bills/command-context?locationId=${branch}&clientTempId=${payload.clientTempId}`);
      assert.equal(response.status(),200,'Command context must authenticate');
      const context=await response.json();contextMs=Date.now()-start;
      assert.equal(context.generation,payload.expectedCommandGeneration);assert.equal(context.queueVersion,payload.expectedQueueVersion);
    }
    const admissionStart=Date.now();
    const admitted=await client.post(endpoint,{data:payload});
    assert.ok([200,202].includes(admitted.status()),`Admission failed: ${admitted.status()}`);
    const body=await admitted.json();assert.equal(body.commandId,payload.commandId);
    samples.push({scenario:workload.scenario,n:workload.n,round:workload.round,commandId:payload.commandId,
      contextMs,admissionMs:Date.now()-admissionStart,start,acceptedAt:body.acceptedAt});
  }
  const ids=samples.map(s=>`'${s.commandId}'`).join(',');
  const deadline=Date.now()+180_000;
  while(Number(sql(`select count(*) from private.rubber_queue_jobs where command_id in (${ids}) and state<>'done'`))) {
    assert.ok(Date.now()<deadline,'Receipt workload exceeded its deadline');await delay(500);
  }
  const outcomes=JSON.parse(sql(`select jsonb_object_agg(command_id,jsonb_build_object('completedAt',completed_at,'status',result->>'status','attempts',attempts))
    from private.rubber_queue_jobs where command_id in (${ids})`));
  for(const sample of samples) {
    const expected=sample.scenario.includes('approval')?'pending_approval':sample.scenario==='approve'?'approved':sample.scenario==='cancel'?'cancelled':'synced';
    assert.equal(outcomes[sample.commandId].status,expected,`Wrong business outcome for ${sample.scenario}`);
    assert.equal(outcomes[sample.commandId].attempts,1,'Healthy commands must execute once');
    const receipt=await client.get(`${endpoint}?locationId=${branch}&commandId=${sample.commandId}`);
    assert.equal(receipt.status(),200);assert.equal((await receipt.json()).state,'done');
    sample.confirmedMs=Date.parse(outcomes[sample.commandId].completedAt)-sample.start;
    sample.queueMs=Date.parse(outcomes[sample.commandId].completedAt)-Date.parse(sample.acceptedAt);
    delete sample.start;
  }
  const result={mode,environment:'Local HTTP/auth/context through committed business result; mixed same-branch burst, not browser rendering or OCR recognition',
    commands:samples.length,totalMs:Date.now()-started,before,after:stats(),samples};
  writeFileSync(`output/rubber-api-${mode}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({mode,commands:samples.length,totalMs:result.totalMs,errors:0,retries:0}));
} finally {
  sql(`select cron.alter_job(jobid,schedule:='${saved.schedule.replaceAll("'","''")}',command:='${saved.command.replaceAll("'","''")}') from cron.job where jobname='rubber-central-queue'`);
  sql(`begin;set local app.history_retention_cleanup='on';delete from public.rubber_bill_approval_requests where location_id='${branch}';
    delete from public.rubber_bill_items where bill_id in(select id from public.rubber_bills where location_id='${branch}');
    delete from public.rubber_bills where location_id='${branch}';set constraints all immediate;
    delete from public.rubber_bill_ocr_sources where location_id='${branch}';
    delete from public.dashboard_money_events where location_id='${branch}';delete from public.dashboard_branch_snapshots where location_id='${branch}';
    delete from public.document_deletion_audits where location_id='${branch}';delete from public.user_locations where location_id='${branch}';
    delete from public.locations where id='${branch}';commit;`);
  await client.dispose();
}
