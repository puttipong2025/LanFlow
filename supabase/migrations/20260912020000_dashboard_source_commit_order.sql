-- XID allocation order is not source commit order. Keep the XID only as a
-- per-branch/per-transaction dedupe token; serialize a monotonic row version.
alter table public.dashboard_branch_snapshots
  add column last_source_transaction_id bigint;

comment on column public.dashboard_branch_snapshots.last_source_transaction_id is
  'Internal source-write dedupe token, not a scheduling clock or source version.';

create or replace function private.mark_dashboard_dirty(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_transaction_id bigint := pg_catalog.txid_current();
begin
  if p_location_id is null or not exists (
    select 1 from public.locations l where l.id = p_location_id and l.is_active
  ) then return; end if;

  insert into public.dashboard_branch_snapshots (
    location_id, status, source_version, pending_since, last_source_transaction_id
  ) values (p_location_id, 'dirty', 1, now(), source_transaction_id)
  on conflict (location_id) do update
  set status = case
        when dashboard_branch_snapshots.status in ('queued', 'running', 'failed')
          then dashboard_branch_snapshots.status
        else 'dirty'
      end,
      source_version = dashboard_branch_snapshots.source_version + 1,
      pending_since = coalesce(dashboard_branch_snapshots.pending_since, excluded.pending_since),
      last_source_transaction_id = excluded.last_source_transaction_id,
      updated_at = now()
  where dashboard_branch_snapshots.last_source_transaction_id
    is distinct from excluded.last_source_transaction_id;

  insert into public.dashboard_alert_thresholds (location_id)
  values (p_location_id) on conflict (location_id) do nothing;
end;
$$;

revoke all on function private.mark_dashboard_dirty(uuid)
  from public, anon, authenticated;
