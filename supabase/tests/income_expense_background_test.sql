begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);
insert into public.locations(id,name,code,is_active) values('73000000-0000-4000-8000-000000000001','Background test','IEBG',true);
insert into public.profiles(id,phone,name,role,is_active) values('73000000-0000-4000-8000-000000000002','0897300002','Background actor','admin',true);
insert into public.user_locations(user_id,location_id,is_primary) values('73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000001',true);
update public.income_expense_approval_keywords set is_active=false;
-- Seed truncation can remove this singleton through its profile foreign key.
insert into public.income_expense_approval_settings(id) values(true) on conflict(id) do nothing;
update public.income_expense_approval_settings set approval_min_amount=null, non_current_date_requires_approval=false;
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"73000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
create temp table bg_state(payload jsonb,result jsonb);
grant all on bg_state to authenticated;
insert into bg_state(payload) values(jsonb_build_object('operation','create','expectedRevisionNo',0,
 'clientTempId','bg-fixture','idempotencyKey','create:bg-fixture:0','locationId','73000000-0000-4000-8000-000000000001',
 'recordStatus','active','localBillNo','LOCAL-BG','txDate',(now() at time zone 'Asia/Bangkok')::date,
 'type','expense','title','Background expense','cost',100,'billOption','ค่าใช้จ่าย',
 'clientRecordedAt',now(),'clientCreatedAt',now()));
set local role authenticated;
update bg_state set result=public.sync_income_expense(payload);
select extensions.is((select result->>'status' from bg_state),'synced','fixture created');
update bg_state set payload=payload || jsonb_build_object('operation','update','expectedRevisionNo',1,
 'idempotencyKey','update:bg-fixture:1','contractVersion',2,'background',true,
 'commandId','73000000-0000-4000-8000-000000000003','actorUserId','73000000-0000-4000-8000-000000000002',
 'expectedServerId',result->>'id','cost',120);
update bg_state set result=public.sync_income_expense_background(payload);
select extensions.is((select result->>'outcome' from bg_state),'synced','background update committed');
select extensions.is((select public.sync_income_expense_background(payload)->>'outcome' from bg_state),'synced','same command replays');
select extensions.is((select revision_no from public.income_expense where client_temp_id='bg-fixture'),2,'replay does not increment revision');
select extensions.is((select public.sync_income_expense_background(payload || '{"cost":130}'::jsonb)->>'status' from bg_state),'failed','changed immutable command rejected');
select extensions.is((select public.sync_income_expense_background(payload || '{"actorUserId":"73000000-0000-4000-8000-000000000099"}'::jsonb)->>'status' from bg_state),'failed','wrong actor rejected');
select extensions.is((select public.sync_income_expense_background(payload || '{"commandId":"73000000-0000-4000-8000-000000000004"}'::jsonb)->>'outcome' from bg_state),'revision_conflict','new stale intent retires as conflict');
reset role;
update public.income_expense_approval_settings set approval_min_amount=1, applies_to='both';
set local role authenticated;
update bg_state set payload=payload || '{"commandId":"73000000-0000-4000-8000-000000000005","expectedRevisionNo":2,"idempotencyKey":"update:bg-fixture:2"}'::jsonb;
update bg_state set result=public.sync_income_expense_background(payload);
select extensions.is((select result->>'outcome' from bg_state),'pending_approval','qualifying background update requests approval');
reset role;
update public.income_expense_approval_requests set request_status='rejected' where id=(select (result->>'requestId')::uuid from bg_state);
set local role authenticated;
select extensions.is((select public.sync_income_expense_background(payload)->>'outcome' from bg_state),'rejected','lost response after rejection never recreates pending approval');
reset role;
delete from public.income_expense_approval_requests where id=(select (result->>'requestId')::uuid from bg_state);
set local role authenticated;
select extensions.is((select public.sync_income_expense_background(payload)->>'outcome' from bg_state),'rejected','terminal receipt survives history cleanup');
reset role;
update public.income_expense_approval_settings set approval_min_amount=null;
set local role authenticated;
select public.sync_income_expense(payload || '{"expectedRevisionNo":2,"idempotencyKey":"update:bg-fixture:2","cost":140}'::jsonb) from bg_state;
select extensions.is((select public.sync_income_expense_background(payload || '{"commandId":"73000000-0000-4000-8000-000000000003","expectedRevisionNo":1,"idempotencyKey":"update:bg-fixture:1"}'::jsonb)->>'outcome' from bg_state),'synced','exact applied receipt survives a later revision');
select extensions.is((select public.sync_income_expense(payload || '{"operation":"delete","recordStatus":"deleted","expectedRevisionNo":3,"idempotencyKey":"delete:bg-fixture:3"}'::jsonb)->>'status' from bg_state),'synced','other command deletes the record');
select extensions.is((select public.sync_income_expense_background(payload || '{"commandId":"73000000-0000-4000-8000-000000000006","operation":"delete","recordStatus":"deleted","expectedRevisionNo":3,"idempotencyKey":"delete:bg-fixture:3"}'::jsonb)->>'outcome' from bg_state),'deleted','positive physical deletion proof retires a different pending delete');
reset role;
update public.profiles set role='user' where id='73000000-0000-4000-8000-000000000002';
set local role authenticated;
select extensions.is((select public.income_expense_background_context((payload->>'expectedServerId')::uuid,(payload->>'locationId')::uuid)->>'status' from bg_state),'forbidden','ordinary user cannot bypass API through context RPC');
select extensions.is((select public.sync_income_expense_background(payload)->>'status' from bg_state),'failed','ordinary user cannot bypass API through command RPC');
select * from extensions.finish();
rollback;
