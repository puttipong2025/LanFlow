begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.profiles(id,phone,name,role,can_access_super_admin_features) values
 ('cc250000-0000-4000-8000-000000000001','0899925011','Group manager','admin',true),
 ('cc250000-0000-4000-8000-000000000002','0899925012','Scoped admin','admin',false),
 ('cc250000-0000-4000-8000-000000000003','0899925013','Ordinary user','user',false);
insert into public.locations(id,name,code) values
 ('cc250000-0000-4000-8000-000000000011','Count branch A','CCGA24'),
 ('cc250000-0000-4000-8000-000000000012','Count branch B','CCGB24'),
 ('cc250000-0000-4000-8000-000000000013','Count branch C','CCGC24');
insert into public.user_locations(user_id,location_id) values
 ('cc250000-0000-4000-8000-000000000002','cc250000-0000-4000-8000-000000000012');
select set_config('request.jwt.claim.sub','cc250000-0000-4000-8000-000000000001',true);
create function pg_temp.count_late(loc uuid) returns integer language sql stable as $$
  select (e->>'value')::integer from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') e
  where e->>'kind'='count' and e->>'locationId'=loc::text
$$;
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000011'),null::integer,'outside group has no fallback alert');
create temp table cc_groups as select (public.save_cash_count_alert_group(null,array['cc250000-0000-4000-8000-000000000011']::uuid[],2)->>'id')::uuid id;
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000011'),null::integer,'new member starts a fresh deadline');
update public.cash_count_alert_members set joined_at=now()-interval '3 days' where group_id=(select id from cc_groups);
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000011'),1,'never counted starts from join date without a dashboard snapshot');
insert into public.cash_count_sessions(id,location_id,cutoff_at,expires_at,started_at,status,ended_at,started_by_user_id,started_by_name,started_by_phone)
 select 'cc250000-0000-4000-8000-000000000021','cc250000-0000-4000-8000-000000000011',now()-interval '4 days',now()-interval '4 days'+interval '30 minutes',now()-interval '4 days','submitted',now()-interval '4 days'+interval '1 minute','cc250000-0000-4000-8000-000000000001','Group manager','0899925011';
insert into public.cash_counts(id,session_id,location_id,cutoff_at,actual_counts,actual_total,difference_total,formula_version,count_no,counted_total,created_by_user_id,created_by_name,created_by_phone)
 select 'cc250000-0000-4000-8000-000000000031',id,location_id,cutoff_at,'{"1":0,"2":0,"5":0,"10":0,"20":0,"50":0,"100":0,"500":0,"1000":0}',0,0,'legacy','CNT-GROUP-OLD',0,started_by_user_id,started_by_name,started_by_phone
 from public.cash_count_sessions where id='cc250000-0000-4000-8000-000000000021';
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000011'),2,'legacy count cutoff supplies the deadline even with no baseline');
select public.save_cash_count_alert_group((select id from cc_groups),array['cc250000-0000-4000-8000-000000000011']::uuid[],5);
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000011'),null::integer,'changing threshold takes effect immediately');
select extensions.is((select (joined_at at time zone 'Asia/Bangkok')::date from public.cash_count_alert_members where group_id=(select id from cc_groups)),(now() at time zone 'Asia/Bangkok')::date-3,'editing threshold retains join date');
select extensions.throws_like($$select public.save_cash_count_alert_group(null,array['cc250000-0000-4000-8000-000000000011']::uuid[],1)$$,'%สาขาอยู่ในกลุ่มอื่น%','one group per branch');
select extensions.throws_like($$select public.save_cash_count_alert_group(null,array['cc250000-0000-4000-8000-000000000012']::uuid[],0)$$,'%1–5%','minimum is one day');
select extensions.throws_like($$select public.save_cash_count_alert_group(null,array['cc250000-0000-4000-8000-000000000012']::uuid[],6)$$,'%1–5%','maximum is five days');
select public.save_cash_count_alert_group((select id from cc_groups),array['cc250000-0000-4000-8000-000000000012']::uuid[],1);
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000011'),null::integer,'removing membership stops alerts');
update public.cash_count_alert_members set joined_at=now()-interval '5 days' where group_id=(select id from cc_groups);
select public.save_cash_count_alert_group((select id from cc_groups),array['cc250000-0000-4000-8000-000000000013']::uuid[],1);
create temp table cc_groups_new as select (public.save_cash_count_alert_group(null,array['cc250000-0000-4000-8000-000000000011','cc250000-0000-4000-8000-000000000012']::uuid[],1)->>'id')::uuid id;
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000012'),null::integer,'moving a never-counted branch starts over');
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000011'),3,'moving a counted branch keeps its last cutoff');
update public.cash_count_alert_members set joined_at=now()-interval '3 days' where location_id='cc250000-0000-4000-8000-000000000012';
select set_config('request.jwt.claim.sub','cc250000-0000-4000-8000-000000000002',true);
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000011'),null::integer,'ordinary admin cannot see an unassigned branch');
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000012'),2,'ordinary admin sees assigned late branch');
select extensions.throws_like($$select public.list_cash_count_alert_groups()$$,'%FORBIDDEN%','ordinary admin cannot edit groups');
select set_config('request.jwt.claim.sub','cc250000-0000-4000-8000-000000000003',true);
select extensions.throws_like($$select public.get_branch_threshold_alert_check()$$,'%FORBIDDEN%','user cannot inspect threshold alerts');
select set_config('request.jwt.claim.sub','cc250000-0000-4000-8000-000000000001',true);
select public.delete_cash_count_alert_group((select id from cc_groups_new));
select extensions.is(pg_temp.count_late('cc250000-0000-4000-8000-000000000012'),null::integer,'deleting group removes members from alert scope');
select * from extensions.finish();
rollback;
