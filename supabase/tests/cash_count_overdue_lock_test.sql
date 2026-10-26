begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.profiles(id,phone,name,role,can_access_super_admin_features) values
 ('cc260000-0000-4000-8000-000000000001','0899926011','Lock manager','admin',true),
 ('cc260000-0000-4000-8000-000000000002','0899926012','Lock admin','admin',false);
insert into public.locations(id,name,code) values
 ('cc260000-0000-4000-8000-000000000011','Lock A','CCLA26'),
 ('cc260000-0000-4000-8000-000000000012','Lock B','CCLB26');
insert into public.user_locations(user_id,location_id) values
 ('cc260000-0000-4000-8000-000000000002','cc260000-0000-4000-8000-000000000011');
select set_config('request.jwt.claim.sub','cc260000-0000-4000-8000-000000000001',true);
create temp table lock_group as select (public.save_cash_count_alert_group(null,array['cc260000-0000-4000-8000-000000000011']::uuid[],1)->>'id')::uuid id;
select extensions.is((select lock_enabled from public.cash_count_alert_groups where id=(select id from lock_group)),false,'legacy create defaults off');
select extensions.ok(not has_function_privilege('anon','public.save_cash_count_alert_group(uuid,uuid[],integer)','EXECUTE'),'legacy wrapper denies anon');
select extensions.ok(not has_function_privilege('authenticated','private.cash_count_lock_state(uuid,timestamptz)','EXECUTE'),'private state is not directly callable');
select extensions.throws_like($$select public.save_cash_count_alert_group((select id from lock_group),array['cc260000-0000-4000-8000-000000000011']::uuid[],1,true,0,4)$$,'%1–48%','zero grace rejected');
select extensions.throws_like($$select public.save_cash_count_alert_group((select id from lock_group),array['cc260000-0000-4000-8000-000000000011']::uuid[],1,true,1,49)$$,'%1–48%','49 hours rejected');
select public.save_cash_count_alert_group((select id from lock_group),array['cc260000-0000-4000-8000-000000000011']::uuid[],1,true,8,4);
update public.cash_count_alert_members set joined_at=now()-interval '5 days' where group_id=(select id from lock_group);
create temp table boundary as select (private.cash_count_lock_state('cc260000-0000-4000-8000-000000000011',now())->>'lockAt')::timestamptz t;
select extensions.is((private.cash_count_lock_state('cc260000-0000-4000-8000-000000000011',(select t-interval '1 microsecond' from boundary))->>'locked')::boolean,false,'not locked before boundary');
select extensions.is((private.cash_count_lock_state('cc260000-0000-4000-8000-000000000011',(select t from boundary))->>'locked')::boolean,true,'locked exactly at boundary');
select extensions.is(extract(hour from (select t from boundary) at time zone 'Asia/Bangkok')::integer,8,'grace starts at Thai midnight');
select extensions.is((public.get_cash_count_overdue_status()->'states'->0->>'locked')::boolean,true,'manager sees own locked branch');
select extensions.throws_like($$insert into public.income_expense(local_bill_no,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,sync_status)
 values('CCLOCK26-I','cc260000-0000-4000-8000-000000000011','income',1,current_date,'test',100,'รายรับ','cc260000-0000-4000-8000-000000000001','Lock manager','0899926011','synced')$$,'%CASH_COUNT_OVERDUE_LOCKED%','direct financial write blocked');
-- Count itself remains available without a temporary grant when no old blockers exist.
create temp table lock_session as select (public.start_cash_count_session('cc260000-0000-4000-8000-000000000011')->'session'->>'id')::uuid id;
select extensions.ok((select id is not null from lock_session),'can start count while overdue locked');
select public.unlock_cash_count_overdue('cc260000-0000-4000-8000-000000000011');
create temp table grant_time as select unlocked_until t from public.cash_count_alert_members where group_id=(select id from lock_group);
select public.unlock_cash_count_overdue('cc260000-0000-4000-8000-000000000011');
select extensions.is((select unlocked_until from public.cash_count_alert_members where group_id=(select id from lock_group)),(select t from grant_time),'replay does not extend grant');
select extensions.throws_like($$insert into public.income_expense(local_bill_no,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,sync_status)
 values('CCLOCK26-I','cc260000-0000-4000-8000-000000000011','income',1,current_date,'test',100,'รายรับ','cc260000-0000-4000-8000-000000000001','Lock manager','0899926011','synced')$$,'%CASH_COUNT_ACTIVE%','temporary grant does not bypass active count');
select public.submit_cash_count_v3((select id from lock_session),'{}'::jsonb||'{"1":0,"2":0,"5":0,"10":0,"20":0,"50":0,"100":0,"500":0,"1000":0}',array[]::uuid[]);
select extensions.is((select unlocked_until from public.cash_count_alert_members where group_id=(select id from lock_group)),null::timestamptz,'successful count clears grant without review');
select extensions.is((public.get_cash_count_overdue_status()->'states'->0->>'locked')::boolean,false,'successful count starts normal period');
select public.delete_cash_count((select id from public.cash_counts where session_id=(select id from lock_session)));
select extensions.is((public.get_cash_count_overdue_status()->'states'->0->>'locked')::boolean,true,'deleting latest uses join date and does not restore grant');
select public.unlock_cash_count_overdue('cc260000-0000-4000-8000-000000000011');
update grant_time set t=(select unlocked_until from public.cash_count_alert_members where group_id=(select id from lock_group));
select extensions.lives_ok($$insert into public.income_expense(local_bill_no,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,sync_status)
 values('CCLOCK26-ALLOWED','cc260000-0000-4000-8000-000000000011','income',1,current_date,'test',100,'รายรับ','cc260000-0000-4000-8000-000000000001','Lock manager','0899926011','synced')$$,'temporary grant permits real financial write after count ended');
select public.save_cash_count_alert_group((select id from lock_group),array['cc260000-0000-4000-8000-000000000011']::uuid[],1);
select extensions.is((select lock_enabled from public.cash_count_alert_groups where id=(select id from lock_group)),true,'legacy edit preserves enabled');
select extensions.is((select grace_hours from public.cash_count_alert_groups where id=(select id from lock_group)),8,'legacy edit preserves grace');
select public.save_cash_count_alert_group((select id from lock_group),array['cc260000-0000-4000-8000-000000000011']::uuid[],1,true,48,1);
select extensions.is((private.cash_count_lock_state('cc260000-0000-4000-8000-000000000011',now())->>'lockAt')::timestamptz,(select t+interval '40 hours' from boundary),'editing grace moves the deadline immediately without changing join date');
select extensions.is((select unlocked_until from public.cash_count_alert_members where group_id=(select id from lock_group)),(select t from grant_time),'new duration does not change existing grant');
update public.cash_count_alert_members set unlocked_until=clock_timestamp() where group_id=(select id from lock_group);
select extensions.is((public.get_cash_count_overdue_status()->'states'->0->>'locked')::boolean,true,'expired grant relocks');
select set_config('request.jwt.claim.sub','cc260000-0000-4000-8000-000000000002',true);
select extensions.throws_like($$select public.unlock_cash_count_overdue('cc260000-0000-4000-8000-000000000011')$$,'%ไม่มีสิทธิ์%','ordinary admin cannot unlock');
select extensions.throws_like($$select public.get_cash_count_overdue_status('cc260000-0000-4000-8000-000000000012')$$,'%ไม่มีสิทธิ์%','cannot inspect unassigned branch');
select extensions.is((public.get_cash_count_overdue_status()->'states'->0->>'canUnlock')::boolean,false,'ordinary admin receives contact-only status');
select extensions.ok(not (public.get_cash_count_overdue_status()->'states'->0->'contacts' @> '[{"id":"cc260000-0000-4000-8000-000000000002"}]'::jsonb),'contact list excludes ordinary admin');
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='super_admin'),true);
select public.unlock_cash_count_overdue('cc260000-0000-4000-8000-000000000011');
select extensions.is((select unlocked_by_user_id from public.cash_count_alert_members where group_id=(select id from lock_group)),auth.uid(),'super admin can unlock');
select public.save_cash_count_alert_group((select id from lock_group),array['cc260000-0000-4000-8000-000000000011']::uuid[],1,false,null,null);
select extensions.is((select unlocked_until from public.cash_count_alert_members where group_id=(select id from lock_group)),null::timestamptz,'disabling clears grant');
select extensions.is((public.get_cash_count_overdue_status()->'states'->0->>'locked')::boolean,false,'disabled group is not locked');
select public.save_cash_count_alert_group((select id from lock_group),array['cc260000-0000-4000-8000-000000000012']::uuid[],1,true,1,1);
select extensions.is((select count(*) from public.cash_count_alert_members where location_id='cc260000-0000-4000-8000-000000000011'),0::bigint,'old membership removed with grant');
select extensions.is((select unlocked_until from public.cash_count_alert_members where group_id=(select id from lock_group)),null::timestamptz,'new membership has no old grant');
select public.delete_cash_count_alert_group((select id from lock_group));
select extensions.is(jsonb_array_length(public.get_cash_count_overdue_status()->'states'),0,'deleting group removes lock state');
select * from extensions.finish();
rollback;
