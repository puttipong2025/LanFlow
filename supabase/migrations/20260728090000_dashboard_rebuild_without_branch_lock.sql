-- Do not hold the branch snapshot row lock while historical data is scanned.
-- Dirty triggers must remain free to advance source_version during a rebuild.

create or replace function private.rebuild_dashboard_branch()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  branch_id uuid;
  claim_version bigint;
  next_summary jsonb;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('lanflow-dashboard-rebuild')
  ) then
    return null;
  end if;

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

  begin
    next_summary := private.calculate_dashboard_summary(branch_id);

    update public.dashboard_branch_snapshots
    set summary = next_summary,
        calculated_at = now(),
        snapshot_version = claim_version,
        status = case
          when source_version = claim_version then 'ready'
          else 'dirty'
        end,
        claimed_version = null,
        claimed_at = null,
        manual_requested_at = null,
        last_error = null,
        updated_at = now()
    where location_id = branch_id
      and status = 'running'
      and claimed_version = claim_version;
  exception when others then
    update public.dashboard_branch_snapshots
    set status = 'failed',
        claimed_version = null,
        claimed_at = null,
        last_error = 'คำนวณ Dashboard ไม่สำเร็จ',
        updated_at = now()
    where location_id = branch_id
      and status = 'running'
      and claimed_version = claim_version;
  end;

  return branch_id;
end;
$$;

revoke all on function private.rebuild_dashboard_branch()
  from public, anon, authenticated;
