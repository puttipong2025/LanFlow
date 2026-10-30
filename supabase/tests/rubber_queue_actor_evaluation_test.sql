begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id,aud,role) values
('af100000-0000-4000-8000-000000000001','authenticated','authenticated'),
('af100000-0000-4000-8000-000000000002','authenticated','authenticated'),
('af100000-0000-4000-8000-000000000003','authenticated','authenticated');
insert into public.locations(id,name,code,is_active) values
('af100000-0000-4000-8000-000000000010','Actor evaluation','ACTORPROBE',true),
('af100000-0000-4000-8000-000000000011','Other scope','ACTOROTHER',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
('af100000-0000-4000-8000-000000000002','probe-2','Inactive actor','admin',false,false),
('af100000-0000-4000-8000-000000000003','probe-3','Manager actor','admin',true,true),
('af100000-0000-4000-8000-000000000001','probe-1','Operator actor','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary) values
('af100000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000010',true);

-- Count the actual actor lookup under a sequential scan. This catches repeated
-- evaluation per profile/membership row without depending on wall-clock timing.
-- All instrumentation and fixtures roll back at the end of this test.
create temporary sequence actor_probe_calls;
create or replace function private.rubber_execution_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  perform nextval('pg_temp.actor_probe_calls');
  return coalesce((private.rubber_execution_job()).actor_user_id,auth.uid());
end $$;
set local enable_indexscan=off;
set local enable_indexonlyscan=off;
set local enable_bitmapscan=off;
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000001',true);

alter sequence pg_temp.actor_probe_calls restart with 1;
select extensions.ok(private.rubber_actor_active(),'active operator is accepted');
select extensions.is((select last_value from pg_temp.actor_probe_calls),1::bigint,'active check resolves actor once under a sequential scan');
alter sequence pg_temp.actor_probe_calls restart with 1;
select extensions.ok(not private.rubber_actor_manager(),'ordinary operator is not a manager');
select extensions.is((select last_value from pg_temp.actor_probe_calls),1::bigint,'manager check resolves actor once under a sequential scan');
alter sequence pg_temp.actor_probe_calls restart with 1;
select extensions.ok(private.rubber_actor_location('af100000-0000-4000-8000-000000000010'),'assigned branch is accepted');
select extensions.ok((select last_value<=3 from pg_temp.actor_probe_calls),'branch check resolves actor at most once in each of its three queries');
select extensions.ok(not private.rubber_actor_location('af100000-0000-4000-8000-000000000011'),'unassigned branch is denied');

-- Each new statement must observe permission changes; no cross-query auth cache.
update public.user_locations set location_id='af100000-0000-4000-8000-000000000011'
where user_id='af100000-0000-4000-8000-000000000001';
select extensions.ok(not private.rubber_actor_location('af100000-0000-4000-8000-000000000010'),'membership removal is visible on the next statement');
update public.profiles set is_active=false where id=auth.uid();
select extensions.ok(not private.rubber_actor_active(),'deactivation is visible on the next statement');
select extensions.ok(not private.rubber_actor_location('af100000-0000-4000-8000-000000000011'),'inactive actor cannot use its assigned branch');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000003',true);
select extensions.ok(private.rubber_actor_manager(),'manager capability is accepted');
select extensions.ok(private.rubber_actor_location('af100000-0000-4000-8000-000000000010'),'manager retains the existing branch-access behavior');
update public.profiles set can_access_super_admin_features=false where id=auth.uid();
select extensions.ok(not private.rubber_actor_manager(),'revoked manager capability is visible on the next statement');
select extensions.ok(not private.rubber_actor_location('af100000-0000-4000-8000-000000000010'),'revoked manager without membership loses access');

-- A worker must use its protected original actor even with a different JWT.
update public.profiles set is_active=true where id='af100000-0000-4000-8000-000000000001';
insert into private.rubber_queue_jobs(command_id,location_id,actor_user_id,client_temp_id,action,fingerprint,payload,policy)
values('af100000-0000-4000-8000-000000000020','af100000-0000-4000-8000-000000000011',
  'af100000-0000-4000-8000-000000000001','actor-probe','create','actor-probe','{}','{}');
insert into private.rubber_queue_execution values(pg_backend_pid(),txid_current(),'af100000-0000-4000-8000-000000000020');
select extensions.is(private.rubber_execution_actor(),'af100000-0000-4000-8000-000000000001'::uuid,'protected job actor overrides the ambient JWT');
select extensions.ok(private.rubber_actor_location('af100000-0000-4000-8000-000000000011'),'worker retains original actor membership');
update public.profiles set is_active=false where id='af100000-0000-4000-8000-000000000001';
select extensions.ok(not private.rubber_actor_location('af100000-0000-4000-8000-000000000011'),'worker observes original actor deactivation');
delete from private.rubber_queue_execution where backend_pid=pg_backend_pid() and transaction_id=txid_current();
select extensions.is(private.rubber_execution_actor(),'af100000-0000-4000-8000-000000000003'::uuid,'removing job context restores JWT fallback on the next statement');
update public.profiles set is_active=true where id='af100000-0000-4000-8000-000000000001';
insert into private.rubber_queue_jobs(command_id,location_id,actor_user_id,client_temp_id,action,fingerprint,payload,policy)
values('af100000-0000-4000-8000-000000000021','af100000-0000-4000-8000-000000000011',
  'af100000-0000-4000-8000-000000000003','actor-probe-other','create','actor-probe-other','{}','{}');
create function pg_temp.probe_actor_switch() returns boolean language plpgsql as $$
declare first_allowed boolean; second_allowed boolean;
begin
  insert into private.rubber_queue_execution values(pg_backend_pid(),txid_current(),'af100000-0000-4000-8000-000000000020');
  first_allowed:=private.rubber_actor_location('af100000-0000-4000-8000-000000000011');
  update private.rubber_queue_execution set command_id='af100000-0000-4000-8000-000000000021'
    where backend_pid=pg_backend_pid() and transaction_id=txid_current();
  second_allowed:=private.rubber_actor_location('af100000-0000-4000-8000-000000000011');
  delete from private.rubber_queue_execution where backend_pid=pg_backend_pid() and transaction_id=txid_current();
  return first_allowed and not second_allowed;
end $$;
select extensions.ok(pg_temp.probe_actor_switch(),'one outer worker statement does not reuse the previous job actor across nested queries');
select set_config('request.jwt.claim.sub','',true);
select extensions.ok(not private.rubber_actor_active(),'missing identity is denied');
select * from extensions.finish();
rollback;
