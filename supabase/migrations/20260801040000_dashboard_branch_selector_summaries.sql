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
  if not private.is_active_user() then
    raise exception 'Access denied';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'locationId', l.id,
        'snapshotStatus', s.status,
        'calculatedAt', s.calculated_at,
        'cashStatus', case
          when s.summary is null then 'no_data'
          when coalesce(t.is_configured, false) = false then 'unconfigured'
          when (s.summary ->> 'netCashFlow')::numeric < t.net_cash_min then 'low'
          else 'normal'
        end,
        'summary', case
          when s.summary is null then null
          else jsonb_build_object(
            'netCashFlow', s.summary -> 'netCashFlow',
            'rubberInventoryWeight', s.summary -> 'rubberInventoryWeight',
            'purchaseToday', s.summary -> 'purchaseToday'
          )
        end
      )
      order by l.created_at, l.id
    ),
    '[]'::jsonb
  )
  into payload
  from public.locations l
  left join public.dashboard_branch_snapshots s on s.location_id = l.id
  left join public.dashboard_alert_thresholds t on t.location_id = l.id
  where l.is_active = true
    and public.can_access_location(l.id);

  return payload;
end;
$$;

revoke all on function public.get_dashboard_branch_summaries()
  from public, anon;
grant execute on function public.get_dashboard_branch_summaries()
  to authenticated;
