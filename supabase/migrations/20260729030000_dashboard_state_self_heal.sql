-- Keep the Dashboard read-model operational after data-only restores/imports
-- that bypass location triggers or omit singleton/derived rows.

insert into public.dashboard_refresh_settings (id)
values (true)
on conflict (id) do nothing;

insert into public.dashboard_branch_snapshots (location_id)
select l.id
from public.locations l
where l.is_active = true
on conflict (location_id) do nothing;

insert into public.dashboard_alert_thresholds (location_id)
select l.id
from public.locations l
where l.is_active = true
on conflict (location_id) do nothing;

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
  values (true)
  on conflict (id) do nothing;

  insert into public.dashboard_branch_snapshots (location_id)
  select l.id
  from public.locations l
  where l.is_active = true
  on conflict (location_id) do nothing;

  insert into public.dashboard_alert_thresholds (location_id)
  select l.id
  from public.locations l
  where l.is_active = true
  on conflict (location_id) do nothing;

  update public.dashboard_refresh_settings
  set last_rollover_date = today,
      updated_at = now()
  where id = true
    and last_rollover_date < today
  returning true into changed;

  if not coalesce(changed, false) then
    return false;
  end if;

  update public.dashboard_branch_snapshots
  set status = case
        when dashboard_branch_snapshots.status in ('queued', 'running')
          then dashboard_branch_snapshots.status
        else 'dirty'
      end,
      source_version = greatest(
        dashboard_branch_snapshots.source_version + 1,
        next_version
      ),
      updated_at = now()
  where location_id in (
    select l.id
    from public.locations l
    where l.is_active = true
  );

  return true;
end;
$$;

revoke all on function private.dashboard_rollover_if_needed()
  from public, anon, authenticated;
