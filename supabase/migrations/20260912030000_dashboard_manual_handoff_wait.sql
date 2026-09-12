-- A manual rebuild can overlap an automatic rebuild for the same branch.
-- Wait for that worker to release the shared branch lock so the Edge worker's
-- existing second pass can claim and finish the requested source version.
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('lanflow-dashboard-rebuild'),
    pg_catalog.hashtext(p_location_id::text)
  );

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

notify pgrst, 'reload schema';
