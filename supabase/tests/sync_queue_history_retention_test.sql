begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into auth.users(id,aud,role) values('ac000000-0000-4000-8000-000000000002','authenticated','authenticated');
insert into public.locations(id,name,code,is_active) values
('ac000000-0000-4000-8000-000000000001','Central queue','CQREG',true),
('ac000000-0000-4000-8000-000000000005','Other queue','CQOTHER',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
('ac000000-0000-4000-8000-000000000002','0897082805','Queue operator','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary) values
('ac000000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-000000000001',true);
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,
sync_status,record_status,location_id,bill_no,bill_date,customer_name,bill_type,weight,
rubber_value,average_price,deduction_total,net_total,revision_no,created_at,created_by_user_id,created_by_name,created_by_phone)
values ('ac000000-0000-4000-8000-000000000003','central-regression','CQ-L','CQ-S','central-original',
'synced','active','ac000000-0000-4000-8000-000000000001','CQ-S',current_date-2,'Fixture','weighing',
100,3800,38,0,3800,1,'2000-01-01','ac000000-0000-4000-8000-000000000002','Queue operator','0897082805');
update public.rubber_bill_approval_settings set non_current_date_requires_approval=true where id=true;
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
create function pg_temp.queue_payload(key uuid,head integer default 0) returns jsonb language sql as $$
select jsonb_build_object('centralQueue',true,'operation','delete','contractVersion',2,'expectedCommandGeneration',0,
'expectedQueueVersion',head,'expectedRevisionNo',1,'clientTempId','central-regression',
'locationId','ac000000-0000-4000-8000-000000000001','idempotencyKey',key,'commandId',key)
$$;
create temp table queue_results(label text,result jsonb);
insert into queue_results values('admit',public.submit_rubber_queue(pg_temp.queue_payload('ac000000-0000-4000-8000-000000000011')));
update public.history_retention_settings set retention_days=15 where singleton;
update private.rubber_queue_jobs set state='done',completed_at=now()-interval '20 days',
  policy='{"obsolete":"details"}',payload='{"obsolete":"proposal"}',error_code='COMMAND_SUPERSEDED',
  result=jsonb_build_object('status','discarded','commandId',command_id,'operation',action,'clientTempId',client_temp_id)
where command_id='ac000000-0000-4000-8000-000000000011';
select extensions.is((select eligible_count from private.history_retention_preview_rows(15) where group_key='sync_queue_history'),1::bigint,'expired completed queue appears in shared preview');
select extensions.is(jsonb_array_length(public.list_rubber_queue('ac000000-0000-4000-8000-000000000001',true)->'rows'),0,'expired history hidden before physical cleanup');
select extensions.is(jsonb_array_length(public.list_rubber_queue('ac000000-0000-4000-8000-000000000001',false)->'notices'),0,'expired notices hidden before cleanup');
select extensions.is(private.compact_rubber_queue_history(15,1),1::bigint,'bounded cleanup compacts completed history');
select extensions.ok((select history_purged_at is not null and payload is null and policy='{}' and reference='' from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000011'),'proposal and policy details removed, replay identity retained');
select extensions.is(public.submit_rubber_queue(pg_temp.queue_payload('ac000000-0000-4000-8000-000000000011'))->>'state','done','old central submit returns original terminal receipt');
select extensions.is(public.sync_rubber_bill(pg_temp.queue_payload('ac000000-0000-4000-8000-000000000011'))->>'status','discarded','legacy retry cannot resurrect compacted command');
select extensions.throws_ok($$select public.submit_rubber_queue(pg_temp.queue_payload('ac000000-0000-4000-8000-000000000011')||'{"expectedRevisionNo":2}')$$,'P0001','COMMAND_MISMATCH','changed retry still fails fingerprint validation');
select extensions.is((select record_status from public.rubber_bills where client_temp_id='central-regression'),'active','cleanup and retries leave business record unchanged');
select extensions.is(private.compact_rubber_queue_history(15,1),0::bigint,'compaction is idempotent');
select extensions.ok(not has_function_privilege('authenticated','private.compact_rubber_queue_history(integer,integer)','execute'),'browser cannot compact directly');

-- All unfinished states, missing completion time and exact cutoff remain safe.
insert into private.rubber_queue_jobs(command_id,location_id,actor_user_id,client_temp_id,action,fingerprint,policy,state,completed_at,result)
select gen_random_uuid(),'ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002',s,'delete','fp','{}',s,now()-interval '40 days','{}'
from unnest(array['queued','retry_wait','paused','correction_required']) s;
insert into private.rubber_queue_jobs(command_id,location_id,actor_user_id,client_temp_id,action,fingerprint,policy,state,completed_at,result)
values ('ac000000-0000-4000-8000-000000000021','ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','cutoff','delete','fp','{}','done',private.history_retention_cutoff_date(15)::timestamp at time zone 'Asia/Bangkok','{}'),
('ac000000-0000-4000-8000-000000000022','ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','missing-time','delete','fp','{}','done',null,'{}'),
('ac000000-0000-4000-8000-000000000023','ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','approval','delete','fp','{}','done',now()-interval '40 days','{"status":"pending_approval"}');
select extensions.is(private.compact_rubber_queue_history(15,100),0::bigint,'unfinished work, pending approval, missing time and cutoff are protected');
insert into private.rubber_command_contexts(location_id,client_temp_id) values('ac000000-0000-4000-8000-000000000001','approval');
insert into private.rubber_command_receipts(command_id,location_id,client_temp_id,owner_user_id,operation,fingerprint,result)
values('ac000000-0000-4000-8000-000000000023','ac000000-0000-4000-8000-000000000001','approval','ac000000-0000-4000-8000-000000000002','delete','fp','{"status":"pending_approval"}');
select extensions.ok((select resolved_at is null from private.rubber_command_receipts where client_temp_id='approval'),'pending receipt has no resolution time');
update private.rubber_command_receipts set result='{"status":"discarded"}' where client_temp_id='approval';
select extensions.ok((select resolved_at >= now() from private.rubber_command_receipts where client_temp_id='approval'),'final decision stamps server resolution time');
select extensions.is(private.compact_rubber_queue_history(15,100),0::bigint,'recent approval resolution starts a fresh retention window');
-- Simulate the next retention window without relying on wall clock sleeps.
alter table private.rubber_command_receipts disable trigger stamp_rubber_command_resolution;
update private.rubber_command_receipts set resolved_at=now()-interval '20 days' where client_temp_id='approval';
alter table private.rubber_command_receipts enable trigger stamp_rubber_command_resolution;
select extensions.is((select eligible_count from private.history_retention_preview_rows(15) where group_key='sync_queue_history'),1::bigint,'old final approval receipt becomes eligible');
select private.cleanup_history_retention(100);
select extensions.ok((select history_purged_at is not null and result->>'status'='discarded' from private.rubber_queue_jobs where client_temp_id='approval'),'shared worker compacts final handoff with final replay result');
select extensions.is((select count(*) from private.rubber_queue_jobs where state<>'done' and history_purged_at is not null),0::bigint,'shared worker preserves every unfinished state');
insert into private.rubber_queue_jobs(command_id,location_id,actor_user_id,client_temp_id,action,fingerprint,policy,state,completed_at,result)
select gen_random_uuid(),'ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002','batch-'||n,'delete','fp','{}','done',now()-interval '40 days','{}'
from generate_series(1,3) n;
select extensions.is(private.compact_rubber_queue_history(15,1),1::bigint,'one batch cannot compact all eligible rows');
select extensions.is((select eligible_count from private.history_retention_preview_rows(15) where group_key='sync_queue_history'),2::bigint,'preview counts only remaining uncompacted rows');
select extensions.ok(private.history_retention_has_work(15),'remaining expired queue work keeps worker scheduled');
select extensions.is(private.compact_rubber_queue_history(15,1),1::bigint,'next batch resumes remaining history');
select extensions.is(private.compact_rubber_queue_history(15,100),1::bigint,'last batch clears remaining eligible history');
select extensions.is(private.compact_rubber_queue_history(365,100),0::bigint,'increasing days cannot restore compacted history');
select extensions.is((select count(*) from private.rubber_queue_jobs where client_temp_id like 'batch-%' and history_purged_at is not null),3::bigint,'all command identities survive compaction');
select * from extensions.finish();
rollback;
