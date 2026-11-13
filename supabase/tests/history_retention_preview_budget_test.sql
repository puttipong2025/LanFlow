begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.is(
  (select eligible_count is null from private.history_scheduler_preview(private.history_retention_cutoff_date()::timestamp at time zone 'Asia/Bangkok')),
  pg_relation_size('cron.job_run_details'::regclass) > 64::bigint * 1024 * 1024,
  'large scheduler heaps are never counted on the preview path');

-- Exercise the exact-count branch on both fresh CI and a larger long-lived Local DB.
-- Only the temporary function budget changes, and this entire test rolls back.
do $$begin execute replace(pg_get_functiondef('private.history_scheduler_preview(timestamptz)'::regprocedure),
  '64::bigint', '1024000::bigint'); end$$;
insert into cron.job_run_details(runid,status,start_time,end_time,username) values
  (-650001,'succeeded',now()-interval '400 days',now()-interval '400 days','postgres'),
  (-650002,'running',now()-interval '400 days',null,'postgres'),
  (-650003,'failed',private.history_retention_cutoff_date()::timestamp at time zone 'Asia/Bangkok',now(),'postgres');
select extensions.is(
  (select eligible_count from private.history_scheduler_preview(private.history_retention_cutoff_date()::timestamp at time zone 'Asia/Bangkok')),
  (select count(*) from cron.job_run_details where status in ('succeeded','failed')
    and start_time < (select private.history_retention_cutoff_date()::timestamp at time zone 'Asia/Bangkok')),
  'small scheduler previews retain exact terminal counts and the strict Bangkok cutoff');
select extensions.is(
  (select oldest_date from private.history_scheduler_preview(private.history_retention_cutoff_date()::timestamp at time zone 'Asia/Bangkok')),
  (select (min(start_time) at time zone 'Asia/Bangkok')::date from cron.job_run_details where status in ('succeeded','failed')
    and start_time < (select private.history_retention_cutoff_date()::timestamp at time zone 'Asia/Bangkok')),
  'the oldest date uses eligible terminal rows only');

-- Reproduce a scheduler history count that cannot finish within a web request.
-- Only that group's count is unavailable; the policy and other groups remain usable.
create temporary sequence retention_preview_calls;
create or replace function private.history_scheduler_preview(p_cutoff_at timestamptz)
returns table(eligible_count bigint, oldest_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform nextval('pg_temp.retention_preview_calls'::regclass);
  return query select null::bigint, null::date;
end
$$;

insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values ('65000000-0000-4000-8000-000000000001','0896500001','retention preview manager','admin',true,true);
select set_config('request.jwt.claim.sub','65000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.is(
  (select g->'eligibleCount' from jsonb_array_elements(public.get_history_retention_overview()->'groups') g
    where g->>'key'='scheduler_run_history'), 'null'::jsonb,
  'an unavailable scheduler count stays unknown rather than zero');
select extensions.is(public.get_history_retention_overview()->'totalEligible', 'null'::jsonb,
  'an incomplete preview must not advertise a complete total');
select extensions.is(jsonb_array_length(public.get_history_retention_overview()->'groups'),12,
  'all temporary history groups stay visible when one count is unavailable');
reset role;
select setval('pg_temp.retention_preview_calls'::regclass, 1, false);
set local role authenticated;
select extensions.lives_ok($q$select public.save_history_retention_settings(30,
  (select updated_at from public.history_retention_settings where singleton))$q$,
  'saving the policy does not depend on an unbounded scheduler count');
reset role;
select extensions.is((select last_value from pg_temp.retention_preview_calls), 1::bigint,
  'policy save shares a single preview between its audit and response');
select extensions.is((select eligible_counts->'scheduler_run_history' from public.history_retention_change_audits
  where actor_user_id='65000000-0000-4000-8000-000000000001' order by changed_at desc limit 1), 'null'::jsonb,
  'the permanent policy audit records an unknown count honestly');
select extensions.ok(not has_function_privilege('authenticated','private.history_scheduler_preview(timestamptz)','execute'),
  'the scheduler preview helper is not a browser RPC');
select * from extensions.finish();
rollback;
