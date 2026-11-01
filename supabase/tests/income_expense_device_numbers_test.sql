begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code,is_active) values('ae000000-0000-4000-8000-000000000001','IE numbers','IEN',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
  values('ae000000-0000-4000-8000-000000000002','0899998012','IE numbers','admin',true,true);
insert into public.user_locations(user_id,location_id,is_primary)
  values('ae000000-0000-4000-8000-000000000002','ae000000-0000-4000-8000-000000000001',true);
-- A fresh seed may remove this singleton through the profile FK; own all approval inputs.
insert into public.income_expense_approval_settings(id) values(true) on conflict(id) do nothing;
update public.income_expense_approval_settings set applies_to='both',approval_min_amount=null,non_current_date_requires_approval=false;
update public.income_expense_approval_keywords set is_active=false;
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
create temp table number_issuer as select public.register_rubber_bill_issuer('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-000000000003','ae000000-0000-4000-8000-000000000004') as value;
create function pg_temp.number_code(value text) returns text language sql as $$
select replace(value,'D01',(select value->>'code' from number_issuer)) $$;
create temp table inputs(id text primary key,p jsonb,r jsonb);
insert into inputs values('one',jsonb_build_object('operation','create','expectedRevisionNo',0,'clientTempId','ie-number-one',
  'idempotencyKey','create:ie-number-one:0','locationId','ae000000-0000-4000-8000-000000000001',
  'recordStatus','active','localBillNo',pg_temp.number_code('E-0001-261031-D01'),'txDate','2026-10-31','type','expense','title','Ordinary numbered expense','cost',100,
  'billOption','ค่าใช้จ่าย','clientRecordedAt','2026-10-31T01:00:00Z','clientCreatedAt','2026-10-31T01:00:00Z',
  'createdByUserId','ae000000-0000-4000-8000-000000000002','createdByName','IE numbers','createdByPhone','0899998012',
  'billNumbering',jsonb_build_object('version',1,'issuerId',public.register_rubber_bill_issuer(
    'ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-000000000003','ae000000-0000-4000-8000-000000000004')->>'id',
    'date','2026-10-31','sequence',1)),null);
update inputs set r=public.sync_numbered_income_expense(p) where id='one';
select extensions.is((select r->>'status' from inputs where id='one'),'synced','numbered create uses business core');
select extensions.is((select r->>'serverBillNo' from inputs where id='one'),pg_temp.number_code('E-0001-261031-D01-1'),'core returns final, not legacy number');
select extensions.is((select number from public.income_expense where client_temp_id='ie-number-one'),pg_temp.number_code('E-0001-261031-D01-1'),'stored number equals final');
select extensions.is((select public.sync_numbered_income_expense(p)->>'serverBillNo' from inputs where id='one'),pg_temp.number_code('E-0001-261031-D01-1'),'exact replay preserves final');
select extensions.is((select public.sync_numbered_income_expense(p||'{"cost":101}'::jsonb)->>'status' from inputs where id='one'),'conflict','changed replay rejected');
insert into inputs select 'two',p||'{"clientTempId":"ie-number-two","idempotencyKey":"create:ie-number-two:0"}'::jsonb,null from inputs where id='one';
update inputs set r=public.sync_numbered_income_expense(p) where id='two';
select extensions.is((select r->>'serverBillNo' from inputs where id='two'),pg_temp.number_code('E-0001-261031-D01-2'),'different bill with same base gets next suffix');
select extensions.is((select public.sync_numbered_income_expense(p||'{"operation":"update","expectedRevisionNo":1,"idempotencyKey":"update:ie-number-one:1","txDate":"2026-10-30"}'::jsonb)->>'serverBillNo' from inputs where id='one'),pg_temp.number_code('E-0001-261031-D01-1'),'editing date keeps final');
select extensions.is((select public.sync_income_expense((p-'billNumbering')||'{"operation":"update","expectedRevisionNo":2,"idempotencyKey":"update:ie-number-one:2"}'::jsonb)->>'errorCode' from inputs where id='one'),'NUMBERING_REJECTED','cannot strip metadata on update');
insert into inputs select 'invalid',p||'{"clientTempId":"ie-number-invalid","idempotencyKey":"create:ie-number-invalid:0","cost":0}'::jsonb,null from inputs where id='one';
update inputs set r=public.sync_numbered_income_expense(p) where id='invalid';
select extensions.is((select r->>'status' from inputs where id='invalid'),'failed','ordinary business failure preserved');
select extensions.is((select count(*) from private.income_expense_number_bindings where client_temp_id='ie-number-invalid'),0::bigint,'failed business create has no binding');
create function pg_temp.fail_numbered_insert() returns trigger language plpgsql as $$ begin
  if new.client_temp_id='ie-number-insert-failure' then raise exception 'numbering insert disproof'; end if; return new; end $$;
create trigger z_numbering_insert_disproof before insert on public.income_expense for each row execute function pg_temp.fail_numbered_insert();
insert into inputs select 'insert-failure',p||'{"clientTempId":"ie-number-insert-failure","idempotencyKey":"create:ie-number-insert-failure:0"}'::jsonb,null from inputs where id='one';
update inputs set r=public.sync_numbered_income_expense(p) where id='insert-failure';
select extensions.is((select r->>'status' from inputs where id='insert-failure'),'failed','exception after suffix allocation becomes business failure');
select extensions.is((select count(*) from private.income_expense_number_bindings where client_temp_id='ie-number-insert-failure'),0::bigint,'core exception rolls back allocated binding');
select extensions.is((select last_suffix from private.income_expense_suffix_counters where base_number=pg_temp.number_code('E-0001-261031-D01') and location_id='ae000000-0000-4000-8000-000000000001'),2::bigint,'core exception rolls back suffix counter');
drop trigger z_numbering_insert_disproof on public.income_expense;
insert into inputs select 'edited-before-sync',p||'{"clientTempId":"ie-number-edited-before-sync","idempotencyKey":"create:ie-number-edited-before-sync:0","txDate":"2026-10-30"}'::jsonb,null from inputs where id='one';
update inputs set r=public.sync_numbered_income_expense(p) where id='edited-before-sync';
select extensions.is((select r->>'status' from inputs where id='edited-before-sync'),'synced','editing an unsubmitted create date preserves the original number date');
update public.income_expense_approval_settings set approval_min_amount=1;
insert into inputs select 'approval',p||'{"clientTempId":"ie-number-approval","idempotencyKey":"create:ie-number-approval:0"}'::jsonb,null from inputs where id='one';
update inputs set r=public.sync_numbered_income_expense(p) where id='approval';
select extensions.is((select r->>'status' from inputs where id='approval'),'pending_approval','same sync path requests approval');
select extensions.is((select count(*) from private.income_expense_number_bindings where client_temp_id='ie-number-approval'),0::bigint,'pending creates do not allocate final');
select extensions.ok((select exists(select 1 from jsonb_array_elements(public.get_income_expense_operational_feed(
  'ae000000-0000-4000-8000-000000000001','pending_approval')->'rows') item where item->'billNumbering'=p->'billNumbering')
  from inputs where id='approval'),'pending feed returns immutable numbering metadata');
select extensions.is((select public.decide_income_expense_approval_request((r->>'requestId')::uuid,'rejected')->>'status' from inputs where id='approval'),'rejected','manager rejects');
select extensions.is((select public.sync_numbered_income_expense(p)->>'status' from inputs where id='approval'),'rejected','lost acknowledgement followed by rejection never reopens approval');
select extensions.is((select count(*) from public.income_expense_approval_requests where requested_payload->>'clientTempId'='ie-number-approval'),1::bigint,'retry has one approval request');
set local app.history_retention_cleanup='on';
delete from public.income_expense_approval_requests where requested_payload->>'clientTempId'='ie-number-approval';
select extensions.is((select public.sync_numbered_income_expense(p)->>'status' from inputs where id='approval'),'rejected','terminal outcome survives disposable history');
select extensions.is((select public.sync_income_expense(p-'billNumbering')->>'status' from inputs where id='approval'),'failed','legacy expired-replay guard prevents metadata stripping from reopening a terminal create');
select set_config('app.bypass_income_expense_approval','false',true);
insert into inputs select 'approved',p||'{"clientTempId":"ie-number-approved","idempotencyKey":"create:ie-number-approved:0"}'::jsonb,null from inputs where id='one';
update inputs set r=public.sync_numbered_income_expense(p) where id='approved';
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values('ae000000-0000-4000-8000-000000000033','0899998033','Second manager','admin',true,true);
insert into public.user_locations(user_id,location_id,is_primary) values('ae000000-0000-4000-8000-000000000033','ae000000-0000-4000-8000-000000000001',true);
-- A pending proposal must keep its frozen issuer through a global retirement.
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='super_admin' and is_active limit 1),true);
select public.reset_all_bill_devices(gen_random_uuid(),public.preview_bill_device_reset()->>'snapshot','รีเซ็ตทั้งหมด');
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000033',true);
select extensions.is((select public.decide_income_expense_approval_request((r->>'requestId')::uuid,'approved')->>'status' from inputs where id='approved'),'approved','pending create survives bulk device reset and uses same allocator');
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000002',true);
select set_config('app.bypass_income_expense_approval','false',true);
select extensions.is((select actor_user_id::text from private.income_expense_create_receipts where client_temp_id='ie-number-approved'),'ae000000-0000-4000-8000-000000000002','another manager approving preserves the original create receipt owner');
select extensions.is((select public.sync_numbered_income_expense(p)->>'serverBillNo' from inputs where id='approved'),pg_temp.number_code('E-0001-261031-D01-4'),'approval result durable and exact');
select extensions.ok((select numbering_metadata is not null from public.income_expense where client_temp_id='ie-number-approved'),'metadata saved after approval');
select public.retire_rubber_bill_issuer((select (p->'billNumbering'->>'issuerId')::uuid from inputs where id='one'));
update public.income_expense_approval_settings set approval_min_amount=null;
insert into inputs select 'retired',p||'{"clientTempId":"ie-number-retired","idempotencyKey":"create:ie-number-retired:0"}'::jsonb,null from inputs where id='one';
update inputs set r=public.sync_numbered_income_expense(p) where id='retired';
select extensions.is((select r->>'status' from inputs where id='retired'),'synced','old offline work remains sendable after shared issuer retirement');
select extensions.is((select public.sync_numbered_income_expense(p||'{"operation":"delete","expectedRevisionNo":1,"idempotencyKey":"delete:ie-number-two:1","recordStatus":"deleted"}'::jsonb)->>'status' from inputs where id='two'),'synced','numbered delete follows the existing soft-delete path');
select extensions.is((select public.sync_numbered_income_expense(p)->>'status' from inputs where id='two'),'discarded','late create replay does not resurrect a deleted numbered bill');
select extensions.is((select count(*) from private.income_expense_number_bindings where client_temp_id='ie-number-two'),1::bigint,'deletion retains the issued binding');
create temp table numbering_count_session as select (public.start_cash_count_session('ae000000-0000-4000-8000-000000000001')->'session'->>'id')::uuid id;
insert into inputs select 'count-locked',p||'{"clientTempId":"ie-number-count-locked","idempotencyKey":"create:ie-number-count-locked:0"}'::jsonb,null from inputs where id='one';
update inputs set r=public.sync_numbered_income_expense(p) where id='count-locked';
select extensions.is((select r->>'status' from inputs where id='count-locked'),'failed','active cash count still fences numbered creates');
select extensions.is((select count(*) from private.income_expense_number_bindings where client_temp_id='ie-number-count-locked'),0::bigint,'cash-count rejection leaves no binding');
select public.cancel_cash_count_session((select id from numbering_count_session));
select public.create_report_batch('ae000000-0000-4000-8000-000000000001');
select extensions.is((select public.sync_numbered_income_expense(p||'{"operation":"update","expectedRevisionNo":2,"idempotencyKey":"update:ie-number-one:2","cost":201}'::jsonb)->>'status' from inputs where id='one'),'failed','report lock still fences edits to numbered bills');
select extensions.ok(not has_table_privilege('authenticated','private.income_expense_number_bindings','select'),'private binding inaccessible');
insert into public.profiles(id,phone,name,role,is_active) values('ae000000-0000-4000-8000-000000000098','0899998098','Unassigned actor','user',true);
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000098',true);
select extensions.is((select public.sync_numbered_income_expense(p)->>'status' from inputs where id='one'),'failed','active actor without branch access cannot read a saved receipt');
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000099',true);
select extensions.is((select public.sync_numbered_income_expense(p)->>'status' from inputs where id='one'),'failed','inactive unknown actor cannot replay a saved receipt');
select * from extensions.finish();
rollback;
