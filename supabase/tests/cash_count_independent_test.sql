begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code,is_active) values
 ('cc240000-0000-4000-8000-000000000001','Cash redesign test','CC24',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
 ('cc240000-0000-4000-8000-000000000002','0899924021','Cash reviewer','admin',true,true);
select set_config('request.jwt.claim.sub','cc240000-0000-4000-8000-000000000002',true);
insert into public.income_expense(local_bill_no,location_id,type,number,tx_date,title,cost,bill_option,
 created_by_user_id,created_by_name,created_by_phone,sync_status) values
 ('CC24-I','cc240000-0000-4000-8000-000000000001','income',1,current_date,'test',100000,'รายรับ',
 'cc240000-0000-4000-8000-000000000002','Cash reviewer','0899924021','synced');
create temp table cash_test_state as select (public.start_cash_count_session('cc240000-0000-4000-8000-000000000001')->'session'->>'id')::uuid as session_id;
select extensions.is((select system_balance from public.cash_count_sessions where id=(select session_id from cash_test_state)),100000::numeric,'live ledger baseline');
select extensions.throws_like($$update public.income_expense set cost=1 where local_bill_no='CC24-I'$$,
 '%CASH_COUNT_ACTIVE%','another caller cannot update money during a count');
select extensions.throws_like($$delete from public.income_expense where local_bill_no='CC24-I'$$,
 '%CASH_COUNT_ACTIVE%','deletion is fenced too');
select extensions.lives_ok($$select public.create_report_batch('cc240000-0000-4000-8000-000000000001')$$,'report creation is independent during a count');
create temp table cash_test_counts as select jsonb_build_object('1000',70,'500',0,'100',0,'50',0,'20',0,'10',0,'5',0,'2',0,'1',0) counts;
insert into public.cash_count_bank_evidence(id,session_id,owner_user_id,image_sha256,amount,balance_kind,drive_file_id)
 select 'cc240000-0000-4000-8000-000000000003',session_id,'cc240000-0000-4000-8000-000000000002',repeat('a',64),29500,'balance','test-drive-id' from cash_test_state;
select extensions.throws_like($$select public.submit_cash_count_v2((select session_id from cash_test_state),(select counts from cash_test_counts),'cc240000-0000-4000-8000-000000000003')$$,
 '%หลักฐานบัญชีไม่พร้อม%','a reserved Drive ID is not uploaded evidence');
update public.cash_count_bank_evidence set drive_uploaded_at=now() where id='cc240000-0000-4000-8000-000000000003';
create temp table cash_test_result as select public.submit_cash_count_v2((select session_id from cash_test_state),(select counts from cash_test_counts),'cc240000-0000-4000-8000-000000000003') result;
select extensions.is((select (result->>'differenceTotal')::numeric from cash_test_result),-500::numeric,'cash plus bank minus starting ledger = shortage');
select extensions.is((select (result->>'countedTotal')::numeric from cash_test_result),99500::numeric,'bank is counted once');
select extensions.is((select count(*)::integer from public.report_batches where location_id='cc240000-0000-4000-8000-000000000001'),1,'submission creates no additional report');
select extensions.is((select (public.submit_cash_count_v2((select session_id from cash_test_state),(select counts from cash_test_counts),null)->>'id')),
 (select result->>'id' from cash_test_result),'lost response replay returns the same count');
select extensions.throws_like($$update public.income_expense set title='unlocked' where local_bill_no='CC24-I'$$,'%REPORT_LOCKED%','count fence releases without weakening the independent report lock');
select extensions.lives_ok($$select public.check_cash_count((select (result->>'id')::uuid from cash_test_result))$$,'manager can check');
select extensions.is((select checked_by_name from public.cash_counts where id=(select (result->>'id')::uuid from cash_test_result)),'Cash reviewer','checker name saved');
select extensions.lives_ok($$select public.check_cash_count((select (result->>'id')::uuid from cash_test_result))$$,'checking is idempotent');
select extensions.lives_ok($$select public.delete_cash_count((select (result->>'id')::uuid from cash_test_result))$$,'checked count can be deleted');
select extensions.is((select status from public.cash_counts where id=(select (result->>'id')::uuid from cash_test_result)),'deleted','deletion preserves audit history');
select extensions.is((select count(*)::integer from public.report_batches where location_id='cc240000-0000-4000-8000-000000000001'),1,'count deletion preserves the report');
select extensions.is((select cost from public.income_expense where local_bill_no='CC24-I'),100000::numeric,'count and deletion never adjust the ledger');
select public.save_cash_count_alert_group(null,array['cc240000-0000-4000-8000-000000000001']::uuid[],2);
update public.cash_count_alert_members set joined_at=now()-interval '2 days' where location_id='cc240000-0000-4000-8000-000000000001';
select extensions.is((select count(*)::integer from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') e where e->>'locationId'='cc240000-0000-4000-8000-000000000001' and e->>'kind'='count'),0,'due today is not late');
update public.cash_count_alert_members set joined_at=now()-interval '3 days' where location_id='cc240000-0000-4000-8000-000000000001';
select extensions.is((select (e->>'value')::integer from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') e where e->>'locationId'='cc240000-0000-4000-8000-000000000001' and e->>'kind'='count'),1,'deleted last count falls back to membership and is one day late');
select extensions.lives_ok($$select public.start_cash_count_session('cc240000-0000-4000-8000-000000000001')$$,'can count again without new reportable work');
select * from extensions.finish();
rollback;
