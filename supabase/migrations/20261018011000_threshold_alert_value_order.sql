-- Preserve descending weight and show lowest cash first within each group.
create or replace function public.get_branch_threshold_alert_check()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.can_access_business_modules() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์ตรวจการแจ้งเตือน';
  end if;
  with groups as (
    select 'cash'::text as kind, id, threshold_amount as threshold,
      row_number() over (order by created_at, id)::integer as group_order
    from public.cash_alert_groups
    union all
    select 'weight', id, threshold_kg,
      row_number() over (order by created_at, id)::integer
    from public.rubber_weight_alert_groups
  ), members as (
    select 'cash'::text as kind, group_id, location_id from public.cash_alert_group_locations
    union all
    select 'weight', group_id, location_id from public.rubber_weight_alert_group_locations
  ), scope as (
    select g.*, l.id as location_id, l.name as location_name,
      s.status,
      case when g.kind = 'cash' then s.summary -> 'netCashFlow'
        else s.summary #> '{rubberRemaining,netWeight}' end as metric,
      s.calculated_at
    from groups g join members m on m.kind = g.kind and m.group_id = g.id
    join public.locations l on l.id = m.location_id
    left join public.dashboard_branch_snapshots s on s.location_id = l.id
    where l.is_active and public.can_access_location(l.id)
  ), measured as (
    select *, case when status = 'ready' and jsonb_typeof(metric) = 'number'
      then metric::text::numeric end as value
    from scope
  )
  select jsonb_build_object(
    'config', public.get_rubber_weight_alert_config(),
    'checkedCount', count(value),
    'configuredCount', count(*),
    'candidates', coalesce(jsonb_agg(jsonb_build_object(
      'kind', kind, 'locationId', location_id, 'locationName', location_name,
      'groupId', id, 'groupOrder', group_order, 'threshold', threshold,
      'value', value, 'calculatedAt', calculated_at
    ) order by kind, group_order, case when kind = 'cash' then value else -value end, location_name, location_id)
      filter (where (kind = 'cash' and value < threshold) or (kind = 'weight' and value > threshold)), '[]'::jsonb),
    'unavailable', coalesce(jsonb_agg(jsonb_build_object(
      'kind', kind, 'locationId', location_id, 'locationName', location_name,
      'reason', case when status is null then 'missing_snapshot'
        when status <> 'ready' then 'not_ready' else 'missing_metric' end
    ) order by kind, location_name, location_id) filter (where value is null), '[]'::jsonb)
  ) into result from measured;
  return result;
end $$;
