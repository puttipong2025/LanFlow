begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

-- The failure is injected at the real expensive seam, not into the worker.
-- All replacements, fixtures and deletions roll back at the end of this test.
create or replace function private.history_retention_preview_rows(p_days integer)
returns table(group_key text, eligible_count bigint, oldest_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  raise exception 'full preview is unavailable';
end $$;

insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values ('64000000-0000-4000-8000-000000000001','0896400001','retention scan manager','admin',true,true);
insert into public.history_cleanup_runs(retention_days,cutoff_date,status,completed_at)
values (15,current_date-400,'succeeded',now()-interval '400 days');
select set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.lives_ok($q$
  select public.request_history_retention_cleanup('64000000-0000-4000-8000-000000000002',
    (select updated_at from public.history_retention_settings where singleton),
    private.history_retention_cutoff_date())
$q$,'accepting a job does not depend on full preview counts');
reset role;

-- Exercise automatic job creation independently of the accepted manual request.
update public.history_cleanup_runs set status='succeeded',completed_at=clock_timestamp()
where request_id='64000000-0000-4000-8000-000000000002';

select extensions.is(private.cleanup_history_retention(1000)->>'status','succeeded',
  'worker can make progress even when full preview counting would time out');
select extensions.ok(not exists(select 1 from public.history_cleanup_runs where completed_at=now()-interval '400 days'),
  'the real worker deletes the expired terminal fixture');
select extensions.ok(not exists(select 1 from public.history_cleanup_runs where status='failed'
  and started_at >= transaction_timestamp()),'preview timeout does not create a failed batch');
select * from extensions.finish();
rollback;
