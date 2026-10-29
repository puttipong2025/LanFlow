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
select extensions.is((select result->>'state' from queue_results where label='admit'),'queued','admission is not business success');
select extensions.is((select record_status from public.rubber_bills where client_temp_id='central-regression'),'active','admission does not change bill');
select extensions.is((select item_count from public.get_actionable_badge_counts() where location_id='ac000000-0000-4000-8000-000000000001' and module_id='rubber'),
 1::bigint,'all-branch badge exposes central work silently through the existing query');
select extensions.is((select count(*) from private.rubber_bill_report_blockers('ac000000-0000-4000-8000-000000000001',clock_timestamp())),1::bigint,'accepted command blocks branch report');
select extensions.is((select count(*) from private.rubber_bill_report_blockers('ac000000-0000-4000-8000-000000000005',clock_timestamp())),0::bigint,'other branch remains unblocked');
select extensions.throws_ok($$select public.get_rubber_queue('ac000000-0000-4000-8000-000000000005')$$,'P0001','FORBIDDEN','feed enforces branch access');
select extensions.is(public.submit_rubber_queue(pg_temp.queue_payload('ac000000-0000-4000-8000-000000000011'))->>'acceptedAt',
  (select result->>'acceptedAt' from queue_results where label='admit'),'retry preserves accepted time');
select extensions.throws_ok($$select public.submit_rubber_queue(pg_temp.queue_payload('ac000000-0000-4000-8000-000000000011')||'{"expectedRevisionNo":2}')$$,
'P0001','COMMAND_MISMATCH','same identity cannot change proposal');
select extensions.is(public.sync_rubber_bill(pg_temp.queue_payload('ac000000-0000-4000-8000-000000000011'))->>'errorCode','CENTRAL_QUEUE_PENDING','legacy transport cannot execute queued work');
select extensions.is(public.sync_rubber_bill((pg_temp.queue_payload('ac000000-0000-4000-8000-000000000099')-'centralQueue'-'expectedQueueVersion'))->>'errorCode',
 'CENTRAL_ADMISSION_REQUIRED','unknown legacy intent cannot overtake a central command on the same bill');
select extensions.ok(not has_function_privilege('authenticated','private.process_rubber_queue(integer)','execute'),'browser cannot run worker');
select extensions.ok(not has_table_privilege('authenticated','private.rubber_queue_execution','insert'),'browser cannot forge worker identity');
-- Revoke permission AFTER admission, clear every browser claim, then execute.
delete from public.user_locations where user_id='ac000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select private.process_rubber_queue(20);
select extensions.is((select state from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000011'),'paused','revoked permission pauses accepted work');
select extensions.is((select record_status from public.rubber_bills where client_temp_id='central-regression'),'active','pause has no business effect');
select extensions.is((select count(*) from private.rubber_queue_execution),0::bigint,'worker identity is cleaned after attempt');
insert into public.user_locations(user_id,location_id,is_primary) values
('ac000000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-000000000001',true);
update private.rubber_queue_jobs set next_attempt_at=clock_timestamp() where command_id='ac000000-0000-4000-8000-000000000011';
select private.process_rubber_queue(20);
select extensions.is((select result->>'status' from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000011'),'pending_approval','worker without browser creates pending approval');
select extensions.is((select requested_by_user_id::text from public.rubber_bill_approval_requests where client_temp_id='central-regression'),
'ac000000-0000-4000-8000-000000000002','worker preserves actual actor');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
update public.profiles set can_access_super_admin_features=true where id='ac000000-0000-4000-8000-000000000002';
select extensions.is(public.get_rubber_bill_operational_feed_v2('ac000000-0000-4000-8000-000000000001','pending_approval')->'rows'->0->'approval_proposed_summary'->>'customerName',
 'Fixture','minimal delete cannot break the pending-approval card');
update public.profiles set can_access_super_admin_features=false where id='ac000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','',true);
select extensions.is((select state from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000011'),'done','business result leaves runnable queue');
select extensions.ok((select payload is null from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000011'),'terminal proposal is cleared');
select extensions.is((select count(*) from private.rubber_bill_report_blockers('ac000000-0000-4000-8000-000000000001',clock_timestamp())),1::bigint,'approval handoff has one blocker');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
select extensions.is(public.sync_rubber_bill(pg_temp.queue_payload('ac000000-0000-4000-8000-000000000011'))->>'status','pending_approval','legacy replay reads durable terminal result');
-- Manager action binds exact request, and acceptance still does not approve it.
update public.profiles set can_access_super_admin_features=true where id='ac000000-0000-4000-8000-000000000002';
insert into queue_results select 'manager',public.submit_rubber_queue(jsonb_build_object('contractVersion',2,
 'commandId','ac000000-0000-4000-8000-000000000012','idempotencyKey','ac000000-0000-4000-8000-000000000012',
 'locationId',location_id,'clientTempId','request:'||id::text,'queueAction','approve','operation','update','targetRequestId',id))
from public.rubber_bill_approval_requests where client_temp_id='central-regression';
select extensions.is((select result->>'state' from queue_results where label='manager'),'queued','manager decision is durable before execution');
select set_config('request.jwt.claim.sub','',true);
select private.process_rubber_queue(20);
select extensions.is((select result->>'status' from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000012'),'approved','manager approval runs without browser');
select extensions.is((select record_status from public.rubber_bills where client_temp_id='central-regression'),'deleted','approved deletion updates normal bill');
select extensions.is((select count(*) from private.rubber_bill_report_blockers('ac000000-0000-4000-8000-000000000001',clock_timestamp())),0::bigint,'completed manager work releases only its blockers');
select extensions.is((select count(*) from private.rubber_queue_execution),0::bigint,'no identity persists after approval');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
select extensions.is(public.get_rubber_queue('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000011')->'result'->>'status',
 'synced','old device reads final approved-delete receipt instead of stale pending approval');
-- Accepted price policy survives a later cap change without changing user input.
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
update public.rubber_bill_approval_settings set central_price=50,ungrouped_price_allowance=0,
  non_current_date_requires_approval=false where id=true;
insert into queue_results values('priced-create',public.submit_rubber_queue(jsonb_build_object(
 'centralQueue',true,'contractVersion',2,'commandId','ac000000-0000-4000-8000-000000000013',
 'idempotencyKey','ac000000-0000-4000-8000-000000000013','operation','create','expectedCommandGeneration',0,
 'expectedQueueVersion',0,'expectedRevisionNo',0,'locationId','ac000000-0000-4000-8000-000000000001',
 'clientTempId','central-priced-create','localBillNo','CQ-CREATE','billDate',(clock_timestamp() at time zone 'Asia/Bangkok')::date,
 'billType','weighing','customerName','Queue price fixture','inputMethod','manual','deductWeight',0,'acidPackCount',0,
 'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','Weigh','netWeight',100,'inWeight',100,
 'outWeight',0,'unitPrice',40,'sequenceNo',1)))));
update public.rubber_bill_approval_settings set central_price=10,non_current_date_requires_approval=true where id=true;
select set_config('request.jwt.claim.sub','',true);
select private.process_rubber_queue(20);
select extensions.is((select result->>'status' from private.rubber_queue_jobs where client_temp_id='central-priced-create'),'synced','accepted price remains valid after cap decreases');
select extensions.is((select average_price from public.rubber_bills where client_temp_id='central-priced-create'),40::numeric,'worker preserves submitted price');
select extensions.is((select effective_price_cap_snapshot from public.rubber_bills where client_temp_id='central-priced-create'),50::numeric,'bill records admitted authoritative policy');
select extensions.is((select created_by_user_id::text from public.rubber_bills where client_temp_id='central-priced-create'),
 'ac000000-0000-4000-8000-000000000002','created bill actor survives empty JWT');

create function pg_temp.create_payload(key uuid,client text,price numeric default 5) returns jsonb language sql as $$
select jsonb_build_object('centralQueue',true,'contractVersion',2,'commandId',key,'idempotencyKey',key,
 'operation','create','expectedCommandGeneration',0,'expectedQueueVersion',0,'expectedRevisionNo',0,
 'locationId','ac000000-0000-4000-8000-000000000001','clientTempId',client,'localBillNo',client,
 'billDate',(clock_timestamp() at time zone 'Asia/Bangkok')::date,'billType','weighing','customerName','Queue recovery fixture',
 'inputMethod','manual','deductWeight',0,'acidPackCount',0,'items',jsonb_build_array(jsonb_build_object(
 'itemType','weigh','title','Weigh','netWeight',100,'inWeight',100,'outWeight',0,'unitPrice',price,'sequenceNo',1)))
$$;
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
insert into queue_results values('invalid',public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000014','central-correction',-1)));
select private.process_rubber_queue(20);
select extensions.is((select state from private.rubber_queue_jobs where client_temp_id='central-correction'),'correction_required','invalid create retains a correctable original');
select extensions.ok((select payload is not null from private.rubber_queue_jobs where client_temp_id='central-correction'),'correction retains original draft');
select extensions.is(public.get_rubber_queue_draft('ac000000-0000-4000-8000-000000000014')->>'clientTempId','central-correction','authorized other device can open central correction draft');
select extensions.is(public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000015','central-correction')
  ||'{"expectedQueueVersion":1}')->>'state','queued','correction uses new identity and current queue version');
select extensions.is(public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000014','central-correction',-1))->>'state','done','old offline copy reads superseded receipt');
select extensions.ok((select payload is null from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000014'),'old rejected draft is cleared only after replacement');
select private.process_rubber_queue(20);
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-correction'),1::bigint,'corrected create succeeds exactly once');
select extensions.is(public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000016','central-correction'))->'result'->>'errorCode',
 'STALE_COMMAND_CONTEXT','a delayed different command cannot overwrite latest work');

-- Historical accepted-time fixtures simulate a worker waking after midnight.
insert into queue_results values('overnight',public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000017','central-overnight')
 ||jsonb_build_object('billDate',(clock_timestamp() at time zone 'Asia/Bangkok')::date-1)));
update private.rubber_queue_jobs set accepted_at=(((clock_timestamp() at time zone 'Asia/Bangkok')::date-1)+time '23:59:59') at time zone 'Asia/Bangkok'
 where command_id='ac000000-0000-4000-8000-000000000017';
select private.process_rubber_queue(20);
select extensions.is((select result->>'status' from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000017'),'synced','overnight execution uses admitted Bangkok date');

update public.rubber_bills set created_at=clock_timestamp()-interval '10 minutes' where client_temp_id='central-priced-create';
update public.rubber_bill_approval_settings set ungrouped_edit_window_minutes=5 where id=true;
insert into queue_results values('edit-window',public.submit_rubber_queue(jsonb_build_object('centralQueue',true,'contractVersion',2,
 'commandId','ac000000-0000-4000-8000-000000000018','idempotencyKey','ac000000-0000-4000-8000-000000000018',
 'operation','delete','expectedCommandGeneration',1,'expectedQueueVersion',1,'expectedRevisionNo',1,
 'locationId','ac000000-0000-4000-8000-000000000001','clientTempId','central-priced-create')));
update private.rubber_queue_jobs set accepted_at=clock_timestamp()-interval '9 minutes'
 where command_id='ac000000-0000-4000-8000-000000000018';
select private.process_rubber_queue(20);
select extensions.is((select result->>'status' from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000018'),'synced','execution delay does not expire the admitted edit window');

-- Active cash count pauses only its branch; expiration resumes without unlock.
select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000019','central-cash'));
select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000020','central-other')
 ||'{"locationId":"ac000000-0000-4000-8000-000000000005"}');
insert into public.cash_count_sessions(id,location_id,cutoff_at,expires_at,started_by_user_id,started_by_name,started_by_phone)
values('ac000000-0000-4000-8000-000000000030','ac000000-0000-4000-8000-000000000001',now(),
 now()+interval '30 minutes','ac000000-0000-4000-8000-000000000002','Fixture','000');
select private.process_rubber_queue(20);
select extensions.is((select state from private.rubber_queue_jobs where client_temp_id='central-cash'),'paused','active cash session pauses central command');
select extensions.is((select state from private.rubber_queue_jobs where client_temp_id='central-other'),'done','other branch continues during cash lock');
update public.cash_count_sessions set expires_at=now()-interval '1 minute',cutoff_at=now()-interval '31 minutes'
 where id='ac000000-0000-4000-8000-000000000030';
update private.rubber_queue_jobs set next_attempt_at=clock_timestamp() where client_temp_id='central-cash';
select private.process_rubber_queue(20);
select extensions.is((select state from private.rubber_queue_jobs where client_temp_id='central-cash'),'done','expired active cash session does not pause forever');

select extensions.is(jsonb_array_length(public.list_rubber_queue('ac000000-0000-4000-8000-000000000001',true,null,null,50,'central-correction')->'rows'),3,'shared literal search finds correction history');
select extensions.ok((public.list_rubber_queue('ac000000-0000-4000-8000-000000000001')->'counts'->>'revision')::bigint>0,'shared revision advances without local sender');
select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000021','central-rollback'));
savepoint worker_crash;
select private.process_rubber_queue(20);
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-rollback'),1::bigint,'worker produces business effect in the attempt transaction');
rollback to savepoint worker_crash;
select extensions.is((select state from private.rubber_queue_jobs where client_temp_id='central-rollback'),'queued','aborted attempt rolls receipt and claim back together');
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-rollback'),0::bigint,'aborted transaction leaves no partial business bill');
select private.process_rubber_queue(20);
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-rollback'),1::bigint,'recovery creates one bill');
select private.process_rubber_queue(20);
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-rollback'),1::bigint,'terminal recovery never executes the bill twice');

select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000022','central-old-manager'));
select public.submit_rubber_queue(jsonb_build_object('centralQueue',true,'contractVersion',2,
 'commandId','ac000000-0000-4000-8000-000000000023','idempotencyKey','ac000000-0000-4000-8000-000000000023',
 'operation','update','queueAction','approve','targetRequestId','ac000000-0000-4000-8000-000000000099',
 'clientTempId','request:ac000000-0000-4000-8000-000000000099','locationId','ac000000-0000-4000-8000-000000000001'));
select extensions.is((select result->>'errorCode' from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000023'),
 'REQUEST_CHANGED','late manager upload gets a durable exact-target retirement');
select extensions.is((select state from private.rubber_queue_jobs where client_temp_id='central-old-manager'),'queued','missing target retirement does not remove unrelated work');

-- Duplicate timestamps page without gaps using the command UUID tie breaker.
select extensions.is(jsonb_array_length(public.list_rubber_queue('ac000000-0000-4000-8000-000000000001',false,null,null,1)->'rows'),1,'queue paging is bounded');
select extensions.ok(not has_table_privilege('authenticated','private.rubber_queue_jobs','select'),'central proposals are never directly readable');
insert into public.rubber_bill_ocr_sources(id,owner_user_id,location_id,state,image_sha256,drive_file_id,image_mime_type,image_size_bytes,original_file_name)
values('ac000000-0000-4000-8000-000000000040','ac000000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-000000000001',
 'staged',repeat('a',64),'central-ocr-file','image/jpeg',1024,'fixture.jpg');
select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000024','central-ocr')
 ||'{"inputMethod":"ocr","ocrUploadId":"ac000000-0000-4000-8000-000000000040"}');
select set_config('request.jwt.claim.sub','',true);
select private.process_rubber_queue(20);
select extensions.is((select state from public.rubber_bill_ocr_sources where id='ac000000-0000-4000-8000-000000000040'),'attached','worker attaches the original actor OCR source with no JWT');
select extensions.is((select result->>'status' from private.rubber_queue_jobs where client_temp_id='central-ocr'),'synced','authorized OCR uses the existing business core');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
('ac000000-0000-4000-8000-000000000004','0897082818','Foreign OCR owner','admin',true,false);
insert into public.rubber_bill_ocr_sources(id,owner_user_id,location_id,state,image_sha256,drive_file_id,image_mime_type,image_size_bytes,original_file_name)
values('ac000000-0000-4000-8000-000000000041','ac000000-0000-4000-8000-000000000004','ac000000-0000-4000-8000-000000000001',
 'staged',repeat('b',64),'central-foreign-ocr-file','image/jpeg',1024,'fixture.jpg');
select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000025','central-foreign-ocr')
 ||'{"inputMethod":"ocr","ocrUploadId":"ac000000-0000-4000-8000-000000000041"}');
select set_config('request.jwt.claim.sub','',true);
select private.process_rubber_queue(20);
select extensions.is((select state from private.rubber_queue_jobs where client_temp_id='central-foreign-ocr'),'correction_required','foreign OCR requires correction instead of endless business retry');
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-foreign-ocr'),0::bigint,'queue access never authorizes foreign OCR business writes');
select extensions.is((select state from public.rubber_bill_ocr_sources where id='ac000000-0000-4000-8000-000000000041'),'staged','foreign source is unchanged');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000026','central-cancel',1000));
select private.process_rubber_queue(20);
create temp table cancelling as select id from public.rubber_bill_approval_requests where client_temp_id='central-cancel' and request_status='pending';
select public.submit_rubber_queue(jsonb_build_object('centralQueue',true,'contractVersion',2,
 'commandId','ac000000-0000-4000-8000-000000000027','idempotencyKey','ac000000-0000-4000-8000-000000000027',
 'operation','update','queueAction','cancel','targetRequestId',id,'clientTempId','request:'||id::text,
 'locationId','ac000000-0000-4000-8000-000000000001')) from cancelling;
select set_config('request.jwt.claim.sub','',true);
select private.process_rubber_queue(20);
select extensions.is((select result->>'status' from private.rubber_queue_jobs where command_id='ac000000-0000-4000-8000-000000000027'),
 'cancelled','confirmed manager cancellation executes without browser');
select extensions.is((select count(*) from public.rubber_bill_approval_requests where client_temp_id='central-cancel'),0::bigint,'cancellation removes only the exact pending request');
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-cancel'),0::bigint,'cancelling a create request does not create a bill');
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-ocr'),1::bigint,'cancellation preserves unrelated business');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000028','central-timeout')
 ||'{"customerName":"Queue timeout fixture"}');
select public.submit_rubber_queue(pg_temp.create_payload('ac000000-0000-4000-8000-000000000029','central-after-timeout'));
create function pg_temp.central_timeout_fixture() returns trigger language plpgsql as $$
begin
  if new.customer_name='Queue timeout fixture' then raise exception using errcode='57014',message='injected statement timeout'; end if;
  return new;
end $$;
create trigger central_timeout_fixture before insert on public.rubber_bills for each row execute function pg_temp.central_timeout_fixture();
select extensions.lives_ok('select private.process_rubber_queue(20)','one cancelled attempt does not abort the entire worker tick');
select extensions.is((select error_code from private.rubber_queue_jobs where client_temp_id='central-timeout'),'ATTEMPT_TIMEOUT','timeout records a durable retry instead of starving the same oldest job');
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='central-timeout'),0::bigint,'cancelled attempt has no partial business effect');
select extensions.is((select state from private.rubber_queue_jobs where client_temp_id='central-after-timeout'),'done','another command continues after an isolated timeout');
select * from extensions.finish();
rollback;
