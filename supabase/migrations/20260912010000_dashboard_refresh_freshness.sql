-- The interval is a freshness deadline, not a quiet-period debounce.
alter table public.dashboard_branch_snapshots
  add column pending_since timestamptz default now(),
  add column failure_count integer not null default 0 check (failure_count >= 0),
  add column next_retry_at timestamptz;

update public.dashboard_branch_snapshots
set pending_since = case when status = 'ready' then null else updated_at end,
    next_retry_at = case when status = 'failed' then now() else null end;

drop index public.dashboard_branch_snapshots_work_idx;
create index dashboard_branch_snapshots_work_idx
  on public.dashboard_branch_snapshots(status, next_retry_at, pending_since, location_id)
  where status in ('dirty', 'queued', 'failed');

create or replace function private.dashboard_retry_delay(p_failure_count integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case
    when p_failure_count <= 1 then interval '1 minute'
    when p_failure_count = 2 then interval '2 minutes'
    when p_failure_count = 3 then interval '5 minutes'
    when p_failure_count = 4 then interval '10 minutes'
    else interval '30 minutes'
  end
$$;
revoke all on function private.dashboard_retry_delay(integer)
  from public, anon, authenticated;

create or replace function private.mark_dashboard_dirty(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version bigint := pg_catalog.txid_current();
begin
  if p_location_id is null or not exists (
    select 1 from public.locations l where l.id = p_location_id and l.is_active
  ) then
    return;
  end if;

  insert into public.dashboard_branch_snapshots (
    location_id, status, source_version, pending_since
  ) values (p_location_id, 'dirty', next_version, now())
  on conflict (location_id) do update
  set status = case
        when dashboard_branch_snapshots.status in ('queued', 'running', 'failed')
          then dashboard_branch_snapshots.status
        else 'dirty'
      end,
      source_version = excluded.source_version,
      pending_since = coalesce(dashboard_branch_snapshots.pending_since, excluded.pending_since),
      updated_at = now()
  where dashboard_branch_snapshots.source_version < excluded.source_version;

  insert into public.dashboard_alert_thresholds (location_id)
  values (p_location_id) on conflict (location_id) do nothing;
end;
$$;
revoke all on function private.mark_dashboard_dirty(uuid)
  from public, anon, authenticated;

create or replace function private.dashboard_rollover_if_needed()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  changed boolean := false;
  next_version bigint := pg_catalog.txid_current();
begin
  insert into public.dashboard_refresh_settings (id)
  values (true) on conflict (id) do nothing;
  insert into public.dashboard_branch_snapshots (location_id)
  select l.id from public.locations l where l.is_active
  on conflict (location_id) do nothing;
  insert into public.dashboard_alert_thresholds (location_id)
  select l.id from public.locations l where l.is_active
  on conflict (location_id) do nothing;

  update public.dashboard_refresh_settings
  set last_rollover_date = today, updated_at = now()
  where id = true and last_rollover_date < today
  returning true into changed;
  if not coalesce(changed, false) then return false; end if;

  update public.dashboard_branch_snapshots
  set status = case when status in ('queued', 'running', 'failed') then status else 'dirty' end,
      source_version = greatest(source_version + 1, next_version),
      pending_since = coalesce(pending_since, now()),
      updated_at = now()
  where location_id in (select l.id from public.locations l where l.is_active);
  return true;
end;
$$;
revoke all on function private.dashboard_rollover_if_needed()
  from public, anon, authenticated;

create or replace function public.queue_dashboard_refresh(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_version bigint;
begin
  perform private.dashboard_require_refresh_access(p_location_id);
  insert into public.dashboard_branch_snapshots (
    location_id, status, source_version, manual_requested_at, pending_since
  ) values (p_location_id, 'queued', 1, now(), now())
  on conflict (location_id) do update
  set status = case when dashboard_branch_snapshots.status = 'running' then 'running' else 'queued' end,
      source_version = case
        when dashboard_branch_snapshots.status in ('queued', 'running') then dashboard_branch_snapshots.source_version
        else dashboard_branch_snapshots.source_version + 1
      end,
      pending_since = coalesce(dashboard_branch_snapshots.pending_since, now()),
      manual_requested_at = now(),
      updated_at = now()
  returning source_version into requested_version;
  return public.get_dashboard_snapshot(p_location_id)
    || jsonb_build_object('requestedVersion', requested_version);
end;
$$;
revoke all on function public.queue_dashboard_refresh(uuid) from public, anon;
grant execute on function public.queue_dashboard_refresh(uuid) to authenticated;

create or replace function private.rebuild_dashboard_branch_target(
  p_location_id uuid, p_claimed_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_summary jsonb;
begin
  if p_location_id is null or p_claimed_version is null then return null; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('lanflow-dashboard-rebuild'), pg_catalog.hashtext(p_location_id::text)
  ) then return null; end if;
  if not exists (
    select 1 from public.dashboard_branch_snapshots s
    join public.locations l on l.id = s.location_id and l.is_active
    where s.location_id = p_location_id and s.status = 'running'
      and s.claimed_version = p_claimed_version
  ) then return null; end if;

  begin
    next_summary := private.calculate_dashboard_summary(p_location_id);
    update public.dashboard_branch_snapshots
    set summary = next_summary,
        calculated_at = now(),
        snapshot_version = p_claimed_version,
        status = case when source_version = p_claimed_version then 'ready' else 'dirty' end,
        pending_since = case when source_version = p_claimed_version then null else coalesce(claimed_at, pending_since, now()) end,
        failure_count = 0,
        next_retry_at = null,
        claimed_version = null,
        claimed_at = null,
        manual_requested_at = null,
        last_error = null,
        updated_at = now()
    where location_id = p_location_id and status = 'running' and claimed_version = p_claimed_version;
  exception when others then
    update public.dashboard_branch_snapshots
    set status = 'failed',
        pending_since = coalesce(pending_since, claimed_at, now()),
        failure_count = failure_count + 1,
        next_retry_at = now() + private.dashboard_retry_delay(failure_count + 1),
        claimed_version = null,
        claimed_at = null,
        last_error = 'คำนวณ Dashboard ไม่สำเร็จ',
        updated_at = now()
    where location_id = p_location_id and status = 'running' and claimed_version = p_claimed_version;
  end;
  return p_location_id;
end;
$$;
revoke all on function private.rebuild_dashboard_branch_target(uuid, bigint)
  from public, anon, authenticated;

-- Do not claim/update the row before calculation: source triggers must remain
-- free to advance source_version while this transaction computes the summary.
create or replace function private.rebuild_dashboard_branch_automatic(p_location_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version bigint;
  target_status text;
  started_at timestamptz := now();
  next_summary jsonb;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('lanflow-dashboard-rebuild'), pg_catalog.hashtext(p_location_id::text)
  ) then return false; end if;

  select s.source_version, s.status into target_version, target_status
  from public.dashboard_branch_snapshots s
  join public.locations l on l.id = s.location_id and l.is_active
  where s.location_id = p_location_id
    and (s.status in ('queued', 'dirty') or (s.status = 'failed' and coalesce(s.next_retry_at, now()) <= now()));
  if target_version is null then return false; end if;

  begin
    next_summary := private.calculate_dashboard_summary(p_location_id);
    update public.dashboard_branch_snapshots
    set summary = next_summary,
        calculated_at = now(),
        snapshot_version = target_version,
        status = case when source_version = target_version then 'ready' else 'dirty' end,
        pending_since = case when source_version = target_version then null else started_at end,
        failure_count = 0,
        next_retry_at = null,
        claimed_version = null,
        claimed_at = null,
        manual_requested_at = null,
        last_error = null,
        updated_at = now()
    where location_id = p_location_id;
  exception when others then
    -- A manual claim can arrive while we calculate. Leave that intent intact;
    -- its worker owns the next attempt after our advisory lock is released.
    update public.dashboard_branch_snapshots
    set status = case
          when status = 'running' or (status = 'queued' and (target_status <> 'queued' or source_version <> target_version)) then status
          else 'failed'
        end,
        failure_count = case
          when status = 'running' or (status = 'queued' and (target_status <> 'queued' or source_version <> target_version)) then failure_count
          else failure_count + 1
        end,
        next_retry_at = case
          when status = 'running' or (status = 'queued' and (target_status <> 'queued' or source_version <> target_version)) then next_retry_at
          else now() + private.dashboard_retry_delay(failure_count + 1)
        end,
        last_error = case
          when status = 'running' or (status = 'queued' and (target_status <> 'queued' or source_version <> target_version)) then last_error
          else 'คำนวณ Dashboard ไม่สำเร็จ'
        end,
        updated_at = now()
    where location_id = p_location_id;
  end;
  return true;
end;
$$;
revoke all on function private.rebuild_dashboard_branch_automatic(uuid)
  from public, anon, authenticated;

-- Retain the existing claim seam for callers, but no longer debounce dirty rows.
create or replace function private.claim_dashboard_branch()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  branch_id uuid;
begin
  perform private.dashboard_rollover_if_needed();
  select s.location_id into branch_id
  from public.dashboard_branch_snapshots s
  join public.locations l on l.id = s.location_id and l.is_active
  where s.status in ('queued', 'dirty')
     or (s.status = 'failed' and coalesce(s.next_retry_at, now()) <= now())
  order by case when s.status = 'queued' then 0 when s.summary is null then 1 when s.status = 'failed' then 2 else 3 end,
    s.pending_since nulls first, s.location_id
  limit 1 for update of s skip locked;
  if branch_id is null then return null; end if;
  update public.dashboard_branch_snapshots
  set status = 'running', claimed_version = source_version, claimed_at = now(), last_error = null, updated_at = now()
  where location_id = branch_id;
  return branch_id;
end;
$$;
revoke all on function private.claim_dashboard_branch()
  from public, anon, authenticated;

create or replace function private.process_dashboard_refresh_tick()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_size integer;
  processed integer := 0;
  branch_id uuid;
begin
  -- Also serialize direct/retried ticks, not just pg_cron's named job.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('lanflow-dashboard-tick')) then return 0; end if;
  perform private.dashboard_rollover_if_needed();

  update public.dashboard_branch_snapshots
  set status = 'failed',
      pending_since = coalesce(pending_since, claimed_at, now()),
      failure_count = failure_count + 1,
      next_retry_at = now() + private.dashboard_retry_delay(failure_count + 1),
      claimed_version = null,
      claimed_at = null,
      last_error = 'คำนวณ Dashboard ไม่สำเร็จ',
      updated_at = now()
  where status = 'running' and claimed_at < now() - interval '15 minutes';

  select greatest(1, ceil(count(*)::numeric / settings.interval_minutes)::integer)
  into batch_size
  from public.locations l cross join public.dashboard_refresh_settings settings
  where l.is_active and settings.id = true
  group by settings.interval_minutes;
  batch_size := coalesce(batch_size, 1);

  -- Adopt a manual claim if its Edge worker exited. An active worker holds the
  -- same advisory lock and is skipped without starting a duplicate calculation.
  if private.rebuild_dashboard_branch() is not null then processed := 1; end if;

  for branch_id in
    select s.location_id
    from public.dashboard_branch_snapshots s
    join public.locations l on l.id = s.location_id and l.is_active
    where s.status in ('queued', 'dirty')
       or (s.status = 'failed' and coalesce(s.next_retry_at, now()) <= now())
    order by case when s.status = 'queued' then 0 when s.summary is null then 1 when s.status = 'failed' then 2 else 3 end,
      s.pending_since nulls first, s.location_id
    limit greatest(0, batch_size - processed)
  loop
    if private.rebuild_dashboard_branch_automatic(branch_id) then processed := processed + 1; end if;
  end loop;
  return processed;
end;
$$;
revoke all on function private.process_dashboard_refresh_tick()
  from public, anon, authenticated;

create or replace function public.get_dashboard_snapshot(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot public.dashboard_branch_snapshots%rowtype;
  deadline timestamptz;
  refresh_minutes integer;
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  select * into snapshot from public.dashboard_branch_snapshots s where s.location_id = p_location_id;
  select interval_minutes into refresh_minutes from public.dashboard_refresh_settings where id = true;
  deadline := snapshot.pending_since + make_interval(mins => coalesce(refresh_minutes, 10));
  return jsonb_build_object(
    'status', coalesce(snapshot.status, 'dirty'),
    'sourceVersion', coalesce(snapshot.source_version, 1),
    'snapshotVersion', coalesce(snapshot.snapshot_version, 0),
    'summary', snapshot.summary,
    'calculatedAt', snapshot.calculated_at,
    'manualRequestedAt', snapshot.manual_requested_at,
    'lastError', snapshot.last_error,
    'isOverdue', coalesce(snapshot.status <> 'ready' and deadline < now(), false),
    'nextCheckAt', case
      when snapshot.status = 'ready' then null
      when snapshot.status = 'failed' then snapshot.next_retry_at
      when snapshot.summary is null or snapshot.status in ('queued', 'running') then now()
      else deadline
    end
  );
end;
$$;
revoke all on function public.get_dashboard_snapshot(uuid) from public, anon;
grant execute on function public.get_dashboard_snapshot(uuid) to authenticated;

create or replace function public.get_dashboard_branch_summaries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if not private.is_active_user() then raise exception 'Access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'locationId', l.id,
    'snapshotStatus', s.status,
    'calculatedAt', s.calculated_at,
    'isOverdue', coalesce(s.status <> 'ready' and s.pending_since + make_interval(mins => settings.interval_minutes) < now(), false),
    'cashStatus', case
      when s.summary is null then 'no_data'
      when coalesce(t.is_configured, false) = false then 'unconfigured'
      when (s.summary ->> 'netCashFlow')::numeric < t.net_cash_min then 'low'
      else 'normal'
    end,
    'summary', case when s.summary is null then null else jsonb_build_object(
      'netCashFlow', s.summary -> 'netCashFlow',
      'rubberInventoryWeight', s.summary -> 'rubberInventoryWeight',
      'purchaseToday', s.summary -> 'purchaseToday'
    ) end
  ) order by l.created_at, l.id), '[]'::jsonb) into payload
  from public.locations l
  cross join public.dashboard_refresh_settings settings
  left join public.dashboard_branch_snapshots s on s.location_id = l.id
  left join public.dashboard_alert_thresholds t on t.location_id = l.id
  where l.is_active and settings.id = true and public.can_access_location(l.id);
  return payload;
end;
$$;
revoke all on function public.get_dashboard_branch_summaries() from public, anon;
grant execute on function public.get_dashboard_branch_summaries() to authenticated;

do $$
declare
  existing_job bigint;
begin
  for existing_job in select jobid from cron.job
    where jobname in ('dashboard-read-model-claim', 'dashboard-read-model-rebuild', 'dashboard-read-model-refresh')
  loop perform cron.unschedule(existing_job); end loop;
  perform cron.schedule('dashboard-read-model-refresh', '* * * * *', 'select private.process_dashboard_refresh_tick()');
end;
$$;

notify pgrst, 'reload schema';
