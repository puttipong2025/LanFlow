begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

insert into public.locations (id, name, code, is_active)
values (
  '23000000-0000-4000-8000-000000000001',
  'pgTAP Dashboard scheduler',
  'PDS',
  true
);

update public.dashboard_refresh_settings
set interval_minutes = 10,
    last_rollover_date = (current_timestamp at time zone 'Asia/Bangkok')::date;

update public.dashboard_branch_snapshots
set status = 'ready',
    snapshot_version = source_version,
    summary = coalesce(summary, '{}'::jsonb),
    calculated_at = coalesce(calculated_at, now()),
    manual_requested_at = null,
    claimed_version = null,
    claimed_at = null,
    last_error = null,
    updated_at = now();

update public.dashboard_branch_snapshots
set status = 'dirty',
    source_version = 1,
    last_source_transaction_id = null,
    snapshot_version = 1,
    summary = '{}'::jsonb,
    calculated_at = now() - interval '20 minutes',
    pending_since = now() - interval '11 minutes',
    updated_at = now() - interval '11 minutes'
where location_id = '23000000-0000-4000-8000-000000000001';

select private.mark_dashboard_dirty(
  '23000000-0000-4000-8000-000000000001'
);

select extensions.is(
  (select pending_since from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  now() - interval '11 minutes',
  'a later source write preserves the first pending deadline'
);
select private.mark_dashboard_dirty('23000000-0000-4000-8000-000000000001');
select extensions.is(
  (select source_version from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  2::bigint, 'multiple source triggers in one transaction advance the branch version only once'
);

select extensions.is(
  private.claim_dashboard_branch(),
  '23000000-0000-4000-8000-000000000001'::uuid,
  'a later source write does not postpone an already-due Dashboard refresh'
);

select private.rebuild_dashboard_branch();
select extensions.ok(
  (select status = 'ready' and pending_since is null and failure_count = 0 and next_retry_at is null
   from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'successful manual/claimed completion clears pending and retry metadata'
);

-- Transaction-scoped fixtures only: exactly 26 active branches, no business data.
update public.locations set is_active = false where id <> '23000000-0000-4000-8000-000000000001';
insert into public.locations (id, name, code, is_active)
select ('23000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'pgTAP scheduler ' || n, 'PDS' || n, true
from generate_series(2, 26) n;

select extensions.ok(
  (select bool_and(pending_since is not null) from public.dashboard_branch_snapshots s
   join public.locations l on l.id = s.location_id where l.is_active and s.status = 'dirty'),
  'new active branches receive pending_since through the insert path'
);

update public.dashboard_branch_snapshots s
set status = 'dirty', source_version = 2, snapshot_version = 1,
    summary = '{}'::jsonb, calculated_at = now(), pending_since = now() - interval '10 minutes'
where s.location_id in (select id from public.locations where is_active);
select extensions.is(private.process_dashboard_refresh_tick(), 3, '26 branches at 10 minutes rebuild three branches per tick');
select extensions.is(
  (select count(*)::integer from public.dashboard_branch_snapshots s join public.locations l on l.id = s.location_id where l.is_active and s.status = 'ready'),
  3, 'the budget counts completed rebuilds, not merely claims'
);
select private.process_dashboard_refresh_tick() from generate_series(1, 8);
select extensions.is(
  (select count(*)::integer from public.dashboard_branch_snapshots s join public.locations l on l.id = s.location_id where l.is_active and s.status <> 'ready'),
  0, 'all 26 branches drain in nine ticks at the 10-minute setting'
);

update public.dashboard_refresh_settings set interval_minutes = 30;
update public.dashboard_branch_snapshots s set status = 'dirty', pending_since = now(), source_version = source_version + 1
where s.location_id in (select id from public.locations where is_active);
select extensions.is(private.process_dashboard_refresh_tick(), 1, '26 branches at 30 minutes use a one-branch budget');
select private.process_dashboard_refresh_tick() from generate_series(1, 25);
select extensions.is(
  (select count(*)::integer from public.dashboard_branch_snapshots s join public.locations l on l.id = s.location_id where l.is_active and s.status <> 'ready'),
  0, 'all 26 branches drain within the 30-minute setting'
);

update public.dashboard_refresh_settings
set interval_minutes = 10, last_rollover_date = (now() at time zone 'Asia/Bangkok')::date - 1;
select extensions.is(private.process_dashboard_refresh_tick(), 3, 'Bangkok midnight rollover uses the adaptive batch immediately');
select extensions.is(
  (select count(*)::integer from public.dashboard_branch_snapshots s join public.locations l on l.id = s.location_id where l.is_active and s.status = 'dirty' and s.pending_since = now()),
  23, 'rollover seeds pending metadata for the remaining active branches'
);
select private.process_dashboard_refresh_tick() from generate_series(1, 8);
select extensions.is(
  (select count(*)::integer from public.dashboard_branch_snapshots s join public.locations l on l.id = s.location_id where l.is_active and s.status <> 'ready'),
  0, 'midnight rollover drains all branches in nine ticks'
);

update public.dashboard_refresh_settings set interval_minutes = 30;
update public.dashboard_branch_snapshots
set status = 'dirty', source_version = source_version + 1, pending_since = now(), summary = null, calculated_at = null
where location_id = '23000000-0000-4000-8000-000000000001';
update public.dashboard_branch_snapshots
set status = 'dirty', source_version = source_version + 1, pending_since = now() - interval '1 day'
where location_id = '23000000-0000-4000-8000-000000000002';
select extensions.is(private.process_dashboard_refresh_tick(), 1, 'no-summary work is eligible without waiting for an interval');
select extensions.is(
  (select status from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'ready', 'no-summary work is selected before an older dirty summary'
);

create temporary table dashboard_successful_summary as
select summary from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001';
-- Fault injection is rolled back with the entire test. The production aggregate
-- is used above; this seam deterministically exercises failure/version paths.
create or replace function private.calculate_dashboard_summary(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('lanflow.test_dashboard_mode', true) = 'fail' then
    raise exception 'pgTAP injected calculation failure';
  end if;
  if current_setting('lanflow.test_dashboard_mode', true) = 'write' then
    update public.dashboard_branch_snapshots set source_version = source_version + 1
    where location_id = p_location_id;
  end if;
  return (select summary from pg_temp.dashboard_successful_summary);
end;
$$;

update public.dashboard_branch_snapshots
set status = 'dirty', source_version = 1, snapshot_version = 0, last_source_transaction_id = null, pending_since = now() - interval '1 hour', failure_count = 0, next_retry_at = null
where location_id = '23000000-0000-4000-8000-000000000001';
select set_config('lanflow.test_dashboard_mode', 'fail', true);
select private.rebuild_dashboard_branch_automatic('23000000-0000-4000-8000-000000000001');
select extensions.ok(
  (select status = 'failed' and failure_count = 1 and next_retry_at = now() + interval '1 minute'
   from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'first failure schedules a one-minute retry'
);
select extensions.is(
  (select summary from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  (select summary from dashboard_successful_summary), 'failure preserves the latest successful result'
);
select private.mark_dashboard_dirty('23000000-0000-4000-8000-000000000001');
select extensions.ok(
  (select status = 'failed' and source_version = 2 and failure_count = 1 and next_retry_at = now() + interval '1 minute' and pending_since = now() - interval '1 hour'
   from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'a source write during failure preserves both pending deadline and backoff'
);
select extensions.is(private.rebuild_dashboard_branch_automatic('23000000-0000-4000-8000-000000000001'), false, 'automatic work cannot bypass a future retry');
create temporary table dashboard_retry_observations (attempt integer, seconds integer);
do $$
declare attempt integer;
begin
  for attempt in 2..6 loop
    update public.dashboard_branch_snapshots set next_retry_at = now() - interval '1 second'
    where location_id = '23000000-0000-4000-8000-000000000001';
    perform private.rebuild_dashboard_branch_automatic('23000000-0000-4000-8000-000000000001');
    insert into dashboard_retry_observations
    select failure_count, extract(epoch from next_retry_at - now())::integer
    from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001';
  end loop;
end;
$$;
select extensions.is(
  (select array_agg(seconds order by attempt) from dashboard_retry_observations),
  array[120, 300, 600, 1800, 1800], 'consecutive retries follow 2/5/10/30/30 minutes'
);

insert into public.profiles (id, phone, name, role, is_active, can_access_super_admin_features)
values ('24000000-0000-4000-8000-000000000001', '0894000001', 'pgTAP scheduler manager', 'admin', true, true);
select set_config('request.jwt.claim.sub', '24000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.is(public.get_dashboard_snapshot('23000000-0000-4000-8000-000000000001') ->> 'isOverdue', 'true', 'RPC discloses overdue after the first pending deadline');
select extensions.ok(
  not (public.get_dashboard_snapshot('23000000-0000-4000-8000-000000000001') ?| array['pending_since', 'failure_count', 'next_retry_at', 'last_source_transaction_id']),
  'RPC does not expose internal scheduler metadata'
);
select extensions.is(
  (select item ->> 'isOverdue' from jsonb_array_elements(public.get_dashboard_branch_summaries()) item where item ->> 'locationId' = '23000000-0000-4000-8000-000000000001'),
  'true', 'branch summaries disclose the same overdue state'
);
select public.queue_dashboard_refresh('23000000-0000-4000-8000-000000000001');
select public.claim_dashboard_refresh_now('23000000-0000-4000-8000-000000000001', 1);
reset role;
select extensions.ok(
  (select status = 'running' and failure_count = 6 and next_retry_at > now()
   from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'manual fast path bypasses retry without resetting failure history before success'
);
select set_config('lanflow.test_dashboard_mode', 'success', true);
select private.rebuild_dashboard_branch();
select extensions.ok(
  (select status = 'ready' and pending_since is null and failure_count = 0 and next_retry_at is null
   from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'manual recovery clears pending and failure metadata only on success'
);

update public.dashboard_branch_snapshots
set status = 'dirty', source_version = source_version + 1, pending_since = now() - interval '1 hour'
where location_id = '23000000-0000-4000-8000-000000000001';
select set_config('lanflow.test_dashboard_mode', 'write', true);
select private.rebuild_dashboard_branch_automatic('23000000-0000-4000-8000-000000000001');
select extensions.ok(
  (select status = 'dirty' and source_version > snapshot_version and pending_since = now()
   from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'source changes during automatic calculation remain dirty with a conservative new lower bound'
);
select set_config('lanflow.test_dashboard_mode', 'success', true);
select private.rebuild_dashboard_branch_automatic('23000000-0000-4000-8000-000000000001');
select extensions.ok(
  (select status = 'ready' and source_version = snapshot_version from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'the next automatic calculation covers the newer source version'
);

update public.dashboard_branch_snapshots
set status = 'running', claimed_version = source_version, claimed_at = now() - interval '16 minutes', pending_since = now() - interval '1 hour'
where location_id = '23000000-0000-4000-8000-000000000001';
select private.process_dashboard_refresh_tick();
select extensions.ok(
  (select status = 'failed' and failure_count = 1 and next_retry_at = now() + interval '1 minute' and claimed_version is null
   from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'stale-running recovery applies the same failure backoff'
);
update public.dashboard_branch_snapshots
set status = 'running', claimed_version = source_version, claimed_at = now()
where location_id = '23000000-0000-4000-8000-000000000001';
select private.process_dashboard_refresh_tick();
select extensions.is(
  (select status from public.dashboard_branch_snapshots where location_id = '23000000-0000-4000-8000-000000000001'),
  'ready', 'the tick adopts a fresh orphaned manual claim'
);
select extensions.ok(not has_function_privilege('authenticated', 'private.process_dashboard_refresh_tick()', 'execute'), 'authenticated cannot invoke the internal scheduler');
select extensions.is((select count(*)::integer from cron.job where jobname like 'dashboard-read-model-%'), 1, 'one automatic cron replaces the old claim/rebuild pair');

select * from extensions.finish();

rollback;
