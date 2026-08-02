-- Start a manually requested Dashboard rebuild immediately without widening
-- Dashboard configuration privileges or waiting for the one-minute cron tick.

create or replace function private.can_request_dashboard_refresh(
  p_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and exists (
      select 1
      from public.locations l
      where l.id = p_location_id
        and l.is_active = true
    )
    and (
      private.can_access_super_admin_features()
      or (
        private.current_user_role() = 'admin'
        and private.can_access_location(p_location_id)
      )
    )
$$;

revoke all on function private.can_request_dashboard_refresh(uuid)
  from public, anon, authenticated;

create or replace function private.dashboard_require_refresh_access(
  p_location_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_request_dashboard_refresh(p_location_id) then
    raise exception 'ไม่มีสิทธิ์คำนวณ Dashboard สำหรับสาขานี้';
  end if;
end;
$$;

revoke all on function private.dashboard_require_refresh_access(uuid)
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
    location_id,
    status,
    source_version,
    manual_requested_at
  )
  values (
    p_location_id,
    'queued',
    1,
    now()
  )
  on conflict (location_id) do update
  set status = case
        when dashboard_branch_snapshots.status = 'running' then 'running'
        else 'queued'
      end,
      source_version = case
        when dashboard_branch_snapshots.status in ('queued', 'running')
          then dashboard_branch_snapshots.source_version
        else dashboard_branch_snapshots.source_version + 1
      end,
      manual_requested_at = now(),
      updated_at = now()
  returning source_version into requested_version;

  return public.get_dashboard_snapshot(p_location_id)
    || jsonb_build_object('requestedVersion', requested_version);
end;
$$;

revoke all on function public.queue_dashboard_refresh(uuid)
  from public, anon;
grant execute on function public.queue_dashboard_refresh(uuid)
  to authenticated;

create or replace function private.rebuild_dashboard_branch_target(
  p_location_id uuid,
  p_claimed_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_summary jsonb;
begin
  if p_location_id is null or p_claimed_version is null then
    return null;
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('lanflow-dashboard-rebuild'),
    pg_catalog.hashtext(p_location_id::text)
  ) then
    return null;
  end if;

  if not exists (
    select 1
    from public.dashboard_branch_snapshots snapshot
    join public.locations l
      on l.id = snapshot.location_id
     and l.is_active = true
    where snapshot.location_id = p_location_id
      and snapshot.status = 'running'
      and snapshot.claimed_version = p_claimed_version
  ) then
    return null;
  end if;

  begin
    next_summary := private.calculate_dashboard_summary(p_location_id);

    update public.dashboard_branch_snapshots
    set summary = next_summary,
        calculated_at = now(),
        snapshot_version = p_claimed_version,
        status = case
          when source_version = p_claimed_version then 'ready'
          else 'dirty'
        end,
        claimed_version = null,
        claimed_at = null,
        manual_requested_at = null,
        last_error = null,
        updated_at = now()
    where location_id = p_location_id
      and status = 'running'
      and claimed_version = p_claimed_version;
  exception when others then
    update public.dashboard_branch_snapshots
    set status = 'failed',
        claimed_version = null,
        claimed_at = null,
        last_error = 'คำนวณ Dashboard ไม่สำเร็จ',
        updated_at = now()
    where location_id = p_location_id
      and status = 'running'
      and claimed_version = p_claimed_version;
  end;

  return p_location_id;
end;
$$;

revoke all on function private.rebuild_dashboard_branch_target(uuid, bigint)
  from public, anon, authenticated;

create or replace function private.rebuild_dashboard_branch()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  branch_id uuid;
  claim_version bigint;
begin
  select snapshot.location_id, snapshot.claimed_version
  into branch_id, claim_version
  from public.dashboard_branch_snapshots snapshot
  join public.locations l
    on l.id = snapshot.location_id
   and l.is_active = true
  where snapshot.status = 'running'
  order by snapshot.claimed_at, snapshot.location_id
  limit 1;

  if branch_id is null then
    return null;
  end if;

  return private.rebuild_dashboard_branch_target(branch_id, claim_version);
end;
$$;

revoke all on function private.rebuild_dashboard_branch()
  from public, anon, authenticated;

create or replace function public.claim_dashboard_refresh_now(
  p_location_id uuid,
  p_requested_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot public.dashboard_branch_snapshots%rowtype;
begin
  perform private.dashboard_require_refresh_access(p_location_id);

  if p_requested_version is null or p_requested_version < 1 then
    raise exception 'Requested Dashboard version is invalid';
  end if;

  select current_snapshot.*
  into strict snapshot
  from public.dashboard_branch_snapshots current_snapshot
  where current_snapshot.location_id = p_location_id
  for update;

  if snapshot.snapshot_version < p_requested_version
    and snapshot.status <> 'running'
  then
    update public.dashboard_branch_snapshots
    set status = 'running',
        claimed_version = source_version,
        claimed_at = now(),
        last_error = null,
        updated_at = now()
    where location_id = p_location_id
    returning * into snapshot;
  end if;

  return public.get_dashboard_snapshot(p_location_id)
    || jsonb_build_object(
      'requestedVersion', p_requested_version,
      'claimedVersion', snapshot.claimed_version
    );
end;
$$;

revoke all on function public.claim_dashboard_refresh_now(uuid, bigint)
  from public, anon;
grant execute on function public.claim_dashboard_refresh_now(uuid, bigint)
  to authenticated;

create or replace function public.rebuild_dashboard_refresh_now(
  p_location_id uuid,
  p_claimed_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dashboard_require_refresh_access(p_location_id);

  if p_claimed_version is null or p_claimed_version < 1 then
    raise exception 'Claimed Dashboard version is invalid';
  end if;

  perform private.rebuild_dashboard_branch_target(
    p_location_id,
    p_claimed_version
  );

  return public.get_dashboard_snapshot(p_location_id);
end;
$$;

revoke all on function public.rebuild_dashboard_refresh_now(uuid, bigint)
  from public, anon;
grant execute on function public.rebuild_dashboard_refresh_now(uuid, bigint)
  to authenticated;
