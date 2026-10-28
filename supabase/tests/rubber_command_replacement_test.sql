begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);
insert into public.locations(id,name,code,is_active) values
('ab000000-0000-4000-8000-000000000001','Command regression','CMDREG',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
('ab000000-0000-4000-8000-000000000002','0897082801','Command operator','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary) values
('ab000000-0000-4000-8000-000000000002','ab000000-0000-4000-8000-000000000001',true);
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,
sync_status,record_status,location_id,bill_no,bill_date,customer_name,bill_type,weight,
rubber_value,average_price,deduction_total,net_total,revision_no,created_by_user_id,created_by_name,created_by_phone)
values ('ab000000-0000-4000-8000-000000000003','command-regression','CMD-L','CMD-S','command-original',
'synced','active','ab000000-0000-4000-8000-000000000001','CMD-S',current_date-2,'Fixture','weighing',
100,3800,38,0,3800,1,'ab000000-0000-4000-8000-000000000002','Command operator','0897082801');
update public.rubber_bill_approval_settings set non_current_date_requires_approval=true where id=true;
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ab000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
create temp table command_results(label text,result jsonb);
insert into command_results values ('first', public.sync_rubber_bill(jsonb_build_object(
'operation','delete','contractVersion',2,'expectedCommandGeneration',0,'expectedRevisionNo',1,
'clientTempId','command-regression','locationId','ab000000-0000-4000-8000-000000000001',
'idempotencyKey','ab000000-0000-4000-8000-000000000011','commandId','ab000000-0000-4000-8000-000000000011')));
select extensions.is((select result->>'status' from command_results where label='first'),'pending_approval','first delete awaits approval');
insert into command_results values ('replacement', public.sync_rubber_bill(jsonb_build_object(
'operation','delete','contractVersion',2,'expectedCommandGeneration',1,'expectedRevisionNo',1,
'clientTempId','command-regression','locationId','ab000000-0000-4000-8000-000000000001',
'idempotencyKey','ab000000-0000-4000-8000-000000000012','commandId','ab000000-0000-4000-8000-000000000012')));
select extensions.is((select result->>'status' from command_results where label='replacement'),'pending_approval','new command replaces retired intent at unchanged bill revision');
select extensions.is((select count(*) from public.rubber_bill_approval_requests where client_temp_id='command-regression' and request_status='pending'),1::bigint,'one pending request remains');
select extensions.ok(not exists(select 1 from public.rubber_bill_approval_requests where idempotency_key='ab000000-0000-4000-8000-000000000011'),'old proposal is removed');
create function pg_temp.command_payload(p_key text,p_generation integer) returns jsonb language sql as $$
 select jsonb_build_object('operation','delete','contractVersion',2,'expectedCommandGeneration',p_generation,'expectedRevisionNo',1,
 'clientTempId','command-regression','locationId','ab000000-0000-4000-8000-000000000001','idempotencyKey',p_key,'commandId',p_key)
$$;
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000012',1))->>'requestId',
 (select result->>'requestId' from command_results where label='replacement'),'retry resolves before checking advanced generation');
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000011',0))->>'status','discarded','old command cannot resurrect after replacement');
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000013',0))->>'errorCode','STALE_COMMAND_CONTEXT','delayed first submission is rejected without bill revision change');
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000012',1)||'{"expectedRevisionNo":2}'::jsonb)->>'errorCode','COMMAND_MISMATCH','same command cannot change payload');
select extensions.is((public.get_rubber_bill_command_context('ab000000-0000-4000-8000-000000000001','command-regression')->>'generation')::integer,2,'generation advances once per accepted command');
select extensions.ok(not has_function_privilege('authenticated','public.sync_rubber_bill_before_commands_20261028010000(jsonb)','execute'),'legacy implementation is not client executable');

-- A new actor with ordinary operation access can replace another actor's pending.
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
('ab000000-0000-4000-8000-000000000004','0897082802','Second operator','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary) values
('ab000000-0000-4000-8000-000000000004','ab000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000004',true);
insert into command_results values ('other-actor',public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000016',2)));
select extensions.is((select result->>'status' from command_results where label='other-actor'),'pending_approval','ordinary authorized actor replaces another actor proposal');
select extensions.throws_ok($$select public.delete_rubber_bill_approval_request((select (result->>'requestId')::uuid from command_results where label='other-actor'))$$,
'P0001','ไม่มีสิทธิ์ลบคำขอบิลยาง','replacement does not broaden explicit discard permission');
update public.profiles set can_access_super_admin_features=true where id='ab000000-0000-4000-8000-000000000004';
select public.delete_rubber_bill_approval_request((select (result->>'requestId')::uuid from command_results where label='other-actor'));
select extensions.is((public.get_rubber_bill_command_context('ab000000-0000-4000-8000-000000000001','command-regression')->>'generation')::integer,4,'explicit discard advances generation without changing bill revision');
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000019',2))->>'errorCode','STALE_COMMAND_CONTEXT','return to no pending does not reset the command context');
insert into command_results values ('after-discard',public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000017',4)));
select extensions.is((select result->>'status' from command_results where label='after-discard'),'pending_approval','new delete after explicit discard succeeds at unchanged revision');
update public.rubber_bills set revision_no=2 where client_temp_id='command-regression';
select extensions.throws_ok($$select public.approve_rubber_bill_approval_request((select (result->>'requestId')::uuid from command_results where label='after-discard'))$$,
'P0001','Revision mismatch','approval cannot rebase an old proposal onto a newer bill');
update public.rubber_bills set revision_no=1 where client_temp_id='command-regression';
select extensions.is(public.approve_rubber_bill_approval_request((select (result->>'requestId')::uuid from command_results where label='after-discard'))->>'status','approved','new delete can be approved');
select extensions.is((select record_status from public.rubber_bills where client_temp_id='command-regression'),'deleted','approval deletes authoritative bill');
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000017',4))->>'status','synced','approved receipt remains replayable after generation advances');
set local app.history_retention_cleanup='on';
delete from public.rubber_bill_approval_requests where id=(select (result->>'requestId')::uuid from command_results where label='after-discard');
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000017',4))->>'status','synced','receipt survives deletion of temporary approved history');
select extensions.is(public.sync_rubber_bill((pg_temp.command_payload('ab000000-0000-4000-8000-000000000020',6)
- 'commandId' - 'contractVersion' - 'expectedCommandGeneration'))->>'errorCode','COMMAND_UPGRADE_REQUIRED','unknown legacy command cannot mutate an activated logical bill');

-- Restore an independent pending fixture for the returned-error rollback probe.
update public.rubber_bills set record_status='active',revision_no=1,deleted_at=null,idempotency_key='command-original',approval_state='not_required',approval_revision_no=null,approved_by_name=null where client_temp_id='command-regression';
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000002',true);
insert into command_results values ('rollback-fixture',public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000018',6)));

-- A returned business failure after retirement must roll back old request/guard.
create or replace function public.sync_rubber_bill_before_commands_20261028010000(payload jsonb)
returns jsonb language sql as $$ select '{"status":"failed","errorMessage":"synthetic rejection"}'::jsonb $$;
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000014',7))->>'status','failed','returned business failure reaches client');
select extensions.ok(exists(select 1 from public.rubber_bill_approval_requests where idempotency_key='ab000000-0000-4000-8000-000000000018'),'returned failure preserves previous pending');
select extensions.ok(not exists(select 1 from private.approval_request_replay_guards where request_key='ab000000-0000-4000-8000-000000000018'),'returned failure rolls back retirement guard');
select extensions.is((public.get_rubber_bill_command_context('ab000000-0000-4000-8000-000000000001','command-regression')->>'generation')::integer,7,'returned failure preserves generation');
select extensions.is((select result->>'status' from private.rubber_command_receipts where command_id='ab000000-0000-4000-8000-000000000018'),'pending_approval','returned failure preserves previous receipt');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select extensions.is(public.sync_rubber_bill(pg_temp.command_payload('ab000000-0000-4000-8000-000000000015',2))->>'status','failed','inactive actor cannot replace pending');
select extensions.ok(exists(select 1 from public.rubber_bill_approval_requests where idempotency_key='ab000000-0000-4000-8000-000000000018'),'unauthorized replacement leaves prior proposal intact');
select * from extensions.finish();
rollback;
