-- Read-only operator view over the existing short-lived money event projection.
create or replace function public.get_operator_money_history(
  p_actor_key text default null,
  p_location_id uuid default null,
  p_route text default null,
  p_event_date date default null,
  p_action text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today_bangkok date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  retention_days integer := private.history_retention_days();
  from_date date := private.history_retention_cutoff_date(retention_days);
  normalized_action text := nullif(p_action, 'all');
begin
  if not private.is_active_user() or not exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin')
  ) then
    raise exception 'Operator history access denied' using errcode = '42501';
  end if;
  if p_location_id is not null and not public.can_access_location(p_location_id) then
    raise exception 'Location access denied' using errcode = '42501';
  end if;
  if p_actor_key is not null and p_actor_key <> 'unknown' then
    perform p_actor_key::uuid;
  end if;
  if normalized_action is not null and normalized_action not in ('create', 'update', 'delete') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;
  if p_route is not null and p_route not in (
    'income-expense', 'money-transfer', 'time-tracking', 'rubber-bills', 'rubber-export'
  ) then
    raise exception 'Invalid route' using errcode = '22023';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'Invalid cursor' using errcode = '22023';
  end if;
  if p_event_date is not null and p_event_date not between from_date and today_bangkok then
    raise exception 'Date outside retention window' using errcode = '22023';
  end if;

  return (
    with allowed_locations as materialized (
      select id, name from public.locations where public.can_access_location(id)
    ), scoped as materialized (
      select e.*, l.name as location_name,
        coalesce(e.actor_user_id::text, 'unknown') as actor_key,
        case
          when e.source_type in ('money_transfer', 'cash_transfer') then 'money-transfer'
          when e.source_type in ('withdrawal', 'withdrawal_adjustment', 'payroll_slip') then 'time-tracking'
          when e.source_type = 'rubber_bill' then 'rubber-bills'
          when e.source_type = 'rubber_export' then 'rubber-export'
          else 'income-expense'
        end as route
      from public.dashboard_money_events e
      join allowed_locations l on l.id = e.location_id
      where e.event_date between from_date and today_bangkok
    ), actors as (
      select distinct on (actor_key) actor_key,
        case when actor_key = 'unknown' then 'ไม่ทราบบัญชีผู้ดำเนินการ'
          else coalesce(nullif(actor_name, ''), 'ไม่ระบุชื่อ') end as name
      from scoped order by actor_key, occurred_at desc, id desc
    ), actor_events as materialized (
      select * from scoped where actor_key = lower(p_actor_key)
    ), selected as (
      select coalesce(p_event_date, max(event_date), today_bangkok) as day from actor_events
    ), daily as materialized (
      select e.* from actor_events e, selected where e.event_date = selected.day
    ), location_counts as (
      select location_id, count(*) as total from daily
      where (p_route is null or route = p_route)
        and (normalized_action is null or action = normalized_action)
      group by location_id
    ), route_counts as (
      select route, count(*) as total from daily
      where (p_location_id is null or location_id = p_location_id)
        and (normalized_action is null or action = normalized_action)
      group by route
    ), action_events as materialized (
      select * from daily
      where (p_location_id is null or location_id = p_location_id)
        and (p_route is null or route = p_route)
    ), filtered as (
      select * from action_events
      where (normalized_action is null or action = normalized_action)
        and (p_cursor_at is null or (occurred_at, id) < (p_cursor_at, p_cursor_id))
      order by occurred_at desc, id desc limit 11
    ), visible as (
      select * from filtered order by occurred_at desc, id desc limit 10
    )
    select jsonb_build_object(
      'actors', coalesce((select jsonb_agg(jsonb_build_object('key', actor_key, 'name', name)
        order by name, actor_key) from actors), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(jsonb_build_object(
        'key', a.location_id, 'name', a.location_name, 'count', coalesce(c.total, 0)) order by a.location_name, a.location_id)
        from (select distinct location_id, location_name from actor_events) a
        left join location_counts c using (location_id)), '[]'::jsonb),
      'routes', coalesce((select jsonb_agg(jsonb_build_object('key', a.route, 'count', coalesce(c.total, 0)) order by a.route)
        from (select distinct route from actor_events) a
        left join route_counts c using (route)), '[]'::jsonb),
      'selectedDate', (select day from selected),
      'availableFrom', from_date, 'availableTo', today_bangkok, 'retentionDays', retention_days,
      'counts', (select jsonb_build_object('all', count(*),
        'create', count(*) filter (where action = 'create'),
        'update', count(*) filter (where action = 'update'),
        'delete', count(*) filter (where action = 'delete')) from action_events),
      'latestAt', (select max(occurred_at) from action_events),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'sourceType', source_type, 'action', action, 'kind', kind,
        'number', number, 'title', title, 'direction', direction, 'amount', round(amount, 2),
        'actorName', actor_name, 'occurredAt', occurred_at,
        'locationId', location_id, 'locationName', location_name, 'route', route
      ) order by occurred_at desc, id desc) from visible), '[]'::jsonb),
      'nextCursor', case when (select count(*) from filtered) > 10 then (
        select jsonb_build_object('at', occurred_at, 'id', id)
        from visible order by occurred_at desc, id desc offset 9 limit 1
      ) else null end
    )
  );
end;
$$;

revoke all on function public.get_operator_money_history(text, uuid, text, date, text, timestamptz, uuid) from public, anon;
grant execute on function public.get_operator_money_history(text, uuid, text, date, text, timestamptz, uuid) to authenticated;
notify pgrst, 'reload schema';
