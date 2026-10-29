import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Local Docker only. All fixtures/settings/business writes roll back together.
// Measures database admission/execution, never browser, OCR recognition or Cloud.
const rounds = Number(process.env.RUBBER_BASELINE_ROUNDS ?? 5);
if (!Number.isInteger(rounds) || rounds < 2 || rounds > 100) throw new Error('Use 2–100 rounds');
const revision = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const container = process.env.RUBBER_BENCHMARK_CONTAINER ?? 'supabase_db_webapp';
if (!['supabase_db_webapp','lanflow-rubber-realdata-20261029'].includes(container)) throw new Error('Unsupported Local benchmark container');
const role = container === 'supabase_db_webapp' ? 'postgres' : 'supabase_admin';
const statement = `begin;
set local statement_timeout='300s';
create temp table measurements(scenario text,n integer,round integer,admission_ms numeric,execution_ms numeric);
do $bench$
declare actor uuid:=gen_random_uuid(); branch uuid:=gen_random_uuid(); command uuid; client text;
  source uuid; payload jsonb; context jsonb; request_id uuid; start_at timestamptz;
  admission_ms numeric; execution_ms numeric; scenario text; n integer; round integer; i integer;
  commands uuid[]; payloads jsonb[]; price numeric;
begin
insert into auth.users(id,aud,role) values(actor,'authenticated','authenticated');
insert into public.locations(id,name,code,is_active) values(branch,'Queue benchmark','BM'||left(branch::text,8),true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values(actor,'B'||left(actor::text,9),'Benchmark','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary) values(actor,branch,true);
perform set_config('request.jwt.claim.sub',actor::text,true);
update public.rubber_bill_approval_settings set central_price=50,ungrouped_price_allowance=0,
non_current_date_requires_approval=false where id=true;
foreach scenario in array array['manual_direct','manual_approval','ocr_direct','ocr_approval','update','delete','approve','cancel'] loop
foreach n in array array[1,5,10] loop
for round in 1..${rounds} loop
commands:='{}'; payloads:='{}'; admission_ms:=0; execution_ms:=0;
for i in 1..n loop
command:=gen_random_uuid(); client:=gen_random_uuid()::text; source:=null;
price:=case when scenario in ('manual_approval','ocr_approval','approve','cancel') then 1000 else 40 end;
update public.profiles set can_access_super_admin_features=false where id=actor;
payload:=jsonb_build_object('centralQueue',true,'contractVersion',2,'commandId',command,'idempotencyKey',command,
'operation','create','expectedCommandGeneration',0,'expectedQueueVersion',0,'expectedRevisionNo',0,
'locationId',branch,'clientTempId',client,'localBillNo',client,'billDate',(clock_timestamp() at time zone 'Asia/Bangkok')::date,
'billType','weighing','customerName','Synthetic benchmark','inputMethod','manual','deductWeight',0,'acidPackCount',0,
'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','Weigh','inWeight',100,'outWeight',0,
'netWeight',100,'unitPrice',price,'sequenceNo',1)));
if scenario like 'ocr_%' then
source:=gen_random_uuid();
insert into public.rubber_bill_ocr_sources(id,owner_user_id,location_id,state,image_sha256,drive_file_id,
image_mime_type,image_size_bytes,original_file_name)
values(source,actor,branch,'staged',md5(source::text)||md5(source::text),'synthetic-'||source,'image/jpeg',1024,'synthetic.jpg');
payload:=payload||jsonb_build_object('inputMethod','ocr','ocrUploadId',source);
end if;
if scenario in ('update','delete','approve','cancel') then
perform public.submit_rubber_queue(payload);
perform private.process_rubber_queue_batch(1,branch);
if not exists(select 1 from private.rubber_queue_jobs where command_id=command and state='done') then
raise exception 'Setup failed for %',scenario; end if;
command:=gen_random_uuid();
if scenario in ('approve','cancel') then
select id into request_id from public.rubber_bill_approval_requests where location_id=branch and client_temp_id=client and request_status='pending';
if request_id is null then raise exception 'Missing setup approval'; end if;
update public.profiles set can_access_super_admin_features=true where id=actor;
payload:=jsonb_build_object('centralQueue',true,'contractVersion',2,'commandId',command,'idempotencyKey',command,
'operation','update','queueAction',scenario,'targetRequestId',request_id,'clientTempId','request:'||request_id,'locationId',branch);
else
context:=public.get_rubber_bill_command_context(branch,client);
payload:=payload||jsonb_build_object('commandId',command,'idempotencyKey',command,'operation',scenario,
'expectedCommandGeneration',(context->>'generation')::integer,'expectedQueueVersion',(context->>'queueVersion')::integer,
'expectedRevisionNo',(context->>'revisionNo')::integer,'expectedServerId',context->>'serverId');
end if;
end if;
commands:=array_append(commands,command);
payloads:=array_append(payloads,payload);
end loop;
start_at:=clock_timestamp();
foreach payload in array payloads loop
perform public.submit_rubber_queue(payload);
end loop;
admission_ms:=extract(epoch from clock_timestamp()-start_at)*1000;
start_at:=clock_timestamp();
perform private.process_rubber_queue_batch(20,branch);
execution_ms:=extract(epoch from clock_timestamp()-start_at)*1000;
if (select count(*) from private.rubber_queue_jobs where command_id=any(commands) and state='done')<>n then
raise exception 'Unconfirmed outcomes in % n=%: %',scenario,n,
(select jsonb_agg(jsonb_build_object('state',state,'error',error_code)) from private.rubber_queue_jobs where command_id=any(commands));
end if;
if exists(select 1 from private.rubber_queue_jobs where command_id=any(commands) and result->>'status' is distinct from
  case when scenario in ('manual_approval','ocr_approval') then 'pending_approval'
  when scenario='approve' then 'approved' when scenario='cancel' then 'cancelled' else 'synced' end) then
raise exception 'Unexpected business result for %: %',scenario,
(select jsonb_agg(result->>'status') from private.rubber_queue_jobs where command_id=any(commands));
end if;
insert into measurements values(scenario,n,round,admission_ms,execution_ms);
end loop;
end loop;
end loop;
end $bench$;
select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) from measurements m;
rollback;`;
const raw = execFileSync('docker', ['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U',role,'-d','postgres'],
  { input: statement, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const samples = JSON.parse(raw.trim());
const percentile = (values, p) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const groups = Object.groupBy(samples, s => `${s.scenario}/${s.n}`);
const summary = Object.entries(groups).map(([scenario, rows]) => ({ scenario, samples: rows.length,
  admissionMedianMs: percentile(rows.map(r=>Number(r.admission_ms)),.5),
  executionMedianMs: percentile(rows.map(r=>Number(r.execution_ms)),.5),
  executionP95Ms: percentile(rows.map(r=>Number(r.execution_ms)),.95),
  executionMaxMs: Math.max(...rows.map(r=>Number(r.execution_ms))) }));
mkdirSync('output',{recursive:true});
const path = container === 'supabase_db_webapp' ? 'output/rubber-queue-mutation-baseline.json' : 'output/rubber-realdata-mutation-baseline.json';
writeFileSync(path, JSON.stringify({ environment:'Local Docker, one rollback transaction; no network/commit/cron timing', container, revision,
  rounds, samples, summary },null,2));
console.log(JSON.stringify({ path, samples: samples.length, summary },null,2));
