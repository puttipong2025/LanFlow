begin;
select extensions.no_plan();
insert into auth.users(id,aud,role) values('af000000-0000-4000-8000-000000000002','authenticated','authenticated');
insert into public.locations(id,name,code,is_active) values('af000000-0000-4000-8000-000000000001','Numbering fixture','NUMREG',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values('af000000-0000-4000-8000-000000000002','0897000301','Numbering operator','admin',true,true);
insert into public.user_locations(user_id,location_id,is_primary) values
('af000000-0000-4000-8000-000000000002','af000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
create temp table number_results(label text primary key,value jsonb);
insert into number_results values('issuer',public.register_rubber_bill_issuer('af000000-0000-4000-8000-000000000001',
'af000000-0000-4000-8000-000000000010','af000000-0000-4000-8000-000000000011','Chrome','Windows'));
select extensions.is((select value->>'code' from number_results where label='issuer'),'D01','first issuer code');
select extensions.is(public.register_rubber_bill_issuer('af000000-0000-4000-8000-000000000001',
'af000000-0000-4000-8000-000000000010','af000000-0000-4000-8000-000000000011')->>'id',
(select value->>'id' from number_results where label='issuer'),'registration retry is stable');
create function pg_temp.number_payload(client text) returns jsonb language sql as $$
select jsonb_build_object('operation','create','clientTempId',client,'idempotencyKey',client,
'locationId','af000000-0000-4000-8000-000000000001','localBillNo','2610310001-D01','billDate','2026-10-31',
'billType','weighing','billNumbering',jsonb_build_object('version',1,'issuerId',value->>'id','date','2026-10-31','sequence',1))
from number_results where label='issuer' $$;
select extensions.is(private.allocate_rubber_bill_suffix(pg_temp.number_payload('number-first')),'2610310001-D01-1','first suffix');
select extensions.is(private.allocate_rubber_bill_suffix(pg_temp.number_payload('number-second')),'2610310001-D01-2','same base different bill has different suffix');
select extensions.is(private.allocate_rubber_bill_suffix(pg_temp.number_payload('number-first')),'2610310001-D01-1','replay has same suffix');
select extensions.throws_ok($$select private.allocate_rubber_bill_suffix(pg_temp.number_payload('number-first')||'{"localBillNo":"2610310002-D01"}')$$,
'P0001','INVALID_BILL_NUMBER','changed numbering is rejected');
select public.retire_rubber_bill_issuer((select (value->>'id')::uuid from number_results where label='issuer'));
select extensions.is(public.register_rubber_bill_issuer('af000000-0000-4000-8000-000000000001',
'af000000-0000-4000-8000-000000000010','af000000-0000-4000-8000-000000000011')->>'code','D02','retired code replaced without recycling');
select extensions.is(private.allocate_rubber_bill_suffix(pg_temp.number_payload('number-third')),'2610310001-D01-3','old-code offline bill still accepted');
select extensions.is((select count(*) from private.rubber_bill_issuers where retired_at is not null and location_id='af000000-0000-4000-8000-000000000001'),1::bigint,'retired issuer retained');
create function pg_temp.full_number_payload(client text) returns jsonb language sql as $$
select pg_temp.number_payload(client)||jsonb_build_object('formulaVersion',2,'expectedRevisionNo',0,
'customerName','Numbering fixture','deductWeight',0,'acidPackCount',0,'createdByUserId','af000000-0000-4000-8000-000000000002',
'createdByName','Numbering operator','createdByPhone','0897000301','clientRecordedAt',clock_timestamp(),
'clientCreatedAt',clock_timestamp(),'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','1',
'inWeight',10,'outWeight',0,'netWeight',10,'unitPrice',1,'totalAmount',10,'sequenceNo',1))) $$;
insert into number_results values('created',public.sync_rubber_bill_core_20260725010000(pg_temp.full_number_payload('number-first')));
select extensions.is((select value->>'status' from number_results where label='created'),'synced','actual business core creates numbered bill');
select extensions.is((select value->>'serverBillNo' from number_results where label='created'),'2610310001-D01-1','actual business core returns base plus suffix');
insert into number_results values('created2',public.sync_rubber_bill_core_20260725010000(pg_temp.full_number_payload('number-second')));
select extensions.is((select value->>'serverBillNo' from number_results where label='created2'),'2610310001-D01-2','two real bills can share the device base');
select extensions.is((select count(*) from public.rubber_bills where local_bill_no='2610310001-D01' and location_id='af000000-0000-4000-8000-000000000001'),2::bigint,'base uniqueness relaxed only for bound numbered bills');
select extensions.is(jsonb_array_length(public.get_rubber_bill_operational_feed_v2(
  p_location_id=>'af000000-0000-4000-8000-000000000001',p_search=>'2610310001-D01')->'rows'),2,'searching a duplicate base returns both distinct bills');
select extensions.is((select numbering_metadata->>'version' from public.rubber_bills where client_temp_id='number-first'),'1','metadata is stored in real bill');
select extensions.is(public.sync_rubber_bill_core_20260725010000(pg_temp.full_number_payload('number-first'))->>'serverBillNo','2610310001-D01-1','business replay preserves final');
select extensions.throws_ok($$update public.rubber_bills set local_bill_no='changed' where client_temp_id='number-first'$$,'P0001','BILL_NUMBER_CHANGED','issued base immutable');
select extensions.throws_ok($$update public.rubber_bills set server_bill_no='changed' where client_temp_id='number-first'$$,'P0001','BILL_NUMBER_CHANGED','issued final immutable');
delete from public.rubber_bills where client_temp_id='number-first';
select extensions.is(private.allocate_rubber_bill_suffix(pg_temp.number_payload('number-fourth')),'2610310001-D01-4','deleting a bill cannot recycle a suffix');
update public.rubber_bill_approval_settings set central_price=1,ungrouped_price_allowance=0,non_current_date_requires_approval=false where id=true;
update public.profiles set can_access_super_admin_features=false where id=auth.uid();
insert into number_results values('proposal',pg_temp.full_number_payload('number-approved')||jsonb_build_object(
 'centralQueue',true,'contractVersion',2,'commandId','af000000-0000-4000-8000-000000000030',
 'idempotencyKey','af000000-0000-4000-8000-000000000030','expectedCommandGeneration',0,'expectedQueueVersion',0,
 'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','1','inWeight',10,'outWeight',0,'netWeight',10,'unitPrice',2,'totalAmount',20,'sequenceNo',1))));
select extensions.is(public.submit_numbered_rubber_queue((select value from number_results where label='proposal'))->>'state','queued','numbered proposal admitted through capability fence');
select set_config('request.jwt.claim.sub','',true);
select private.process_rubber_queue(20);
select extensions.is((select result->>'status' from private.rubber_queue_jobs where client_temp_id='number-approved'),'pending_approval','new numbering still obeys price approval');
select extensions.is((select count(*) from private.rubber_bill_number_bindings where client_temp_id='number-approved'),0::bigint,'pending approval does not allocate final suffix');
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
update public.profiles set can_access_super_admin_features=true where id=auth.uid();
select extensions.is(public.get_rubber_bill_operational_feed_v2('af000000-0000-4000-8000-000000000001','pending_approval')->'rows'->0->'numbering_metadata'->>'version','1','pending feed preserves explicit numbering metadata');
select public.submit_rubber_queue(jsonb_build_object('contractVersion',2,
 'commandId','af000000-0000-4000-8000-000000000031','idempotencyKey','af000000-0000-4000-8000-000000000031',
 'locationId',location_id,'clientTempId','request:'||id::text,'queueAction','approve','operation','update','targetRequestId',id))
from public.rubber_bill_approval_requests where client_temp_id='number-approved';
select set_config('request.jwt.claim.sub','',true);
select private.process_rubber_queue(20);
select extensions.is((select server_bill_no from public.rubber_bills where client_temp_id='number-approved'),'2610310001-D01-5','approval creates bill with the frozen base and final suffix');
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
select extensions.is(public.submit_numbered_rubber_queue((select value from number_results where label='proposal'))->'result'->>'serverBillNo','2610310001-D01-5','admission replay after approval returns the same final');
select extensions.is((select last_suffix from private.rubber_bill_suffix_counters where location_id='af000000-0000-4000-8000-000000000001' and base_number='2610310001-D01'),5::bigint,'approval and replay allocate the suffix once');
create function pg_temp.reject_numbered_insert() returns trigger language plpgsql as $$
begin if new.client_temp_id='number-rollback' then raise exception 'NUMBERING_TEST_ROLLBACK'; end if; return new; end $$;
create trigger numbering_test_rollback after insert on public.rubber_bills for each row execute function pg_temp.reject_numbered_insert();
select extensions.is(public.sync_rubber_bill_core_20260725010000(pg_temp.full_number_payload('number-rollback'))->>'status','failed','business failure after allocation rolls back the attempt');
select extensions.is((select count(*) from private.rubber_bill_number_bindings where client_temp_id='number-rollback'),0::bigint,'rolled-back business create cannot retain a binding');
select extensions.is((select last_suffix from private.rubber_bill_suffix_counters where location_id='af000000-0000-4000-8000-000000000001' and base_number='2610310001-D01'),5::bigint,'rolled-back business create cannot consume a suffix');
drop trigger numbering_test_rollback on public.rubber_bills;
create function pg_temp.sequence_first_payload(client text) returns jsonb language sql as $$
select pg_temp.full_number_payload(client)||jsonb_build_object('localBillNo','0015-261031-D01',
  'billNumbering',(pg_temp.number_payload(client)->'billNumbering')||'{"sequence":15}'::jsonb) $$;
insert into number_results values('sequence-first',public.sync_rubber_bill_core_20260725010000(pg_temp.sequence_first_payload('sequence-first')));
select extensions.is((select value->>'status' from number_results where label='sequence-first'),'synced','new sequence-first base creates through actual core');
select extensions.is((select value->>'serverBillNo' from number_results where label='sequence-first'),'0015-261031-D01-1','server appends suffix without moving or resetting the sequence');
select extensions.is(public.sync_rubber_bill_core_20260725010000(pg_temp.sequence_first_payload('sequence-second'))->>'serverBillNo','0015-261031-D01-2','duplicate new-layout base gets next suffix');
select extensions.is(public.sync_rubber_bill_core_20260725010000(pg_temp.sequence_first_payload('sequence-first'))->>'serverBillNo','0015-261031-D01-1','new-layout replay keeps its original final');
select extensions.is(jsonb_array_length(public.get_rubber_bill_operational_feed_v2(
  p_location_id=>'af000000-0000-4000-8000-000000000001',p_search=>'0015-261031-D01')->'rows'),2,'new-layout search returns both distinct bills');
select extensions.throws_ok($$select private.assert_rubber_bill_numbering(pg_temp.sequence_first_payload('sequence-first')||'{"localBillNo":"2610310015-D01"}')$$,
  'P0001','BILL_NUMBER_CHANGED','issued new-layout base cannot be rewritten to the old equivalent');
select extensions.throws_ok($$select private.assert_rubber_bill_numbering(pg_temp.sequence_first_payload('invalid-new-layout')||'{"localBillNo":"0001-261031-D01"}')$$,
  'P0001','INVALID_BILL_NUMBER','reordered number must still match its original sequence metadata');
update public.profiles set can_access_super_admin_features=false where id=auth.uid();
select extensions.throws_ok('select public.list_rubber_bill_issuers()','42501','FORBIDDEN','ordinary admin cannot list other issuers');
select extensions.throws_ok($$select public.retire_rubber_bill_issuer((select (value->>'id')::uuid from number_results where label='issuer'))$$,
'42501','FORBIDDEN','ordinary admin cannot retire');
select extensions.ok(not has_table_privilege('authenticated','private.rubber_bill_number_bindings','insert'),'clients cannot forge bindings');
update public.profiles set can_access_super_admin_features=true where id=auth.uid();
select extensions.throws_ok($$select private.assert_rubber_bill_numbering(pg_temp.number_payload('bad-date')||jsonb_build_object('billNumbering',
  (pg_temp.number_payload('bad-date')->'billNumbering')||'{"date":"2026-02-30"}'::jsonb))$$,
  'P0001','INVALID_BILL_NUMBER','invalid calendar input produces a controlled permanent numbering error');
select extensions.throws_ok($$select private.assert_rubber_bill_numbering(pg_temp.number_payload('bad-issuer')||jsonb_build_object('billNumbering',
  (pg_temp.number_payload('bad-issuer')->'billNumbering')||'{"issuerId":"not-a-uuid"}'::jsonb))$$,
  'P0001','INVALID_BILL_NUMBER','invalid issuer syntax produces a controlled numbering error');
select extensions.throws_ok('select public.list_rubber_bill_issuers(p_limit=>null)','P0001','INVALID_INPUT','explicit null cannot bypass the registry page bound');
select * from extensions.finish();
rollback;
