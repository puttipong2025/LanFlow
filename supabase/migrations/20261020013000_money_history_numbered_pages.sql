begin;
-- Required p_page selects this overload; legacy cursor RPCs remain compatible.
create or replace function public.get_operator_money_history(
  p_page integer,
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
  if p_page is null or p_page < 1 or (p_page > 1 and p_cursor_at is not null) then
    raise exception 'Invalid history page' using errcode = '22023';
  end if;
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
      select e.id, e.location_id, e.source_type, e.action, e.event_date, e.occurred_at,
        e.creator_name, l.name as location_name,
        coalesce(e.creator_user_id::text, 'unknown') as actor_key,
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
        case when actor_key = 'unknown' then 'ไม่ทราบผู้สร้างรายการ'
          else coalesce(nullif(creator_name, ''), 'ไม่ระบุชื่อ') end as name
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
      order by occurred_at desc, id desc limit 11 offset (p_page::bigint - 1) * 10
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
        'id', visible.id, 'sourceType', visible.source_type, 'action', visible.action, 'kind', detail.kind,
        'number', detail.number, 'title', detail.title, 'direction', detail.direction, 'amount', round(detail.amount, 2),
        'actorName', visible.creator_name, 'occurredAt', visible.occurred_at,
        'locationId', visible.location_id, 'locationName', visible.location_name, 'route', visible.route
      ) order by visible.occurred_at desc, visible.id desc) from visible
        join public.dashboard_money_events detail on detail.id = visible.id), '[]'::jsonb),
      'nextCursor', case when (select count(*) from filtered) > 10 then (
        select jsonb_build_object('at', occurred_at, 'id', id)
        from visible order by occurred_at desc, id desc offset 9 limit 1
      ) else null end
    )
  );
end;
$$;


create or replace function public.get_dashboard_money_history(
  p_page integer,
  p_location_id uuid,
  p_event_date date default null,
  p_action text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  retention_days integer := private.history_retention_days();
  today_bangkok date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  from_date date := private.history_retention_cutoff_date(retention_days);
  selected_date date;
  normalized_action text := nullif(p_action, 'all');
begin
  if p_page is null or p_page < 1 or (p_page > 1 and p_cursor_at is not null) then
    raise exception 'Invalid history page' using errcode = '22023';
  end if;
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if normalized_action is not null and normalized_action not in ('create', 'update', 'delete') then
    raise exception 'Invalid money history action';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'Invalid money history cursor';
  end if;
  if p_event_date is not null and (p_event_date < from_date or p_event_date > today_bangkok) then
    raise exception 'Money history date is outside retention window';
  end if;
  selected_date := p_event_date;
  if selected_date is null then
    select max(event_date) into selected_date from public.dashboard_money_events
    where location_id = p_location_id and event_date between from_date and today_bangkok;
    selected_date := coalesce(selected_date, today_bangkok);
  end if;
  return (
    with filtered as (
      select event.* from public.dashboard_money_events event
      where event.location_id = p_location_id and event.event_date = selected_date
        and (normalized_action is null or event.action = normalized_action)
        and (p_cursor_at is null or (event.occurred_at, event.id) < (p_cursor_at, p_cursor_id))
      order by event.occurred_at desc, event.id desc limit page_size + 1 offset (p_page::bigint - 1) * page_size
    ), visible as (
      select * from filtered order by occurred_at desc, id desc limit page_size
    ), counts as (
      select count(*) total,
        count(*) filter (where action = 'create') created,
        count(*) filter (where action = 'update') updated,
        count(*) filter (where action = 'delete') deleted,
        max(occurred_at) latest_at
      from public.dashboard_money_events
      where location_id = p_location_id and event_date = selected_date
    )
    select jsonb_build_object(
      'selectedDate', selected_date, 'availableFrom', from_date,
      'availableTo', today_bangkok, 'retentionDays', retention_days,
      'counts', jsonb_build_object('all', counts.total, 'create', counts.created,
        'update', counts.updated, 'delete', counts.deleted),
      'latestAt', counts.latest_at,
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'sourceType', source_type, 'action', action, 'kind', kind,
        'number', number, 'title', title, 'direction', direction,
        'amount', round(amount, 2), 'actorName', creator_name, 'occurredAt', occurred_at
      ) order by occurred_at desc, id desc) from visible), '[]'::jsonb),
      'nextCursor', case when (select count(*) from filtered) > page_size then (
        select jsonb_build_object('at', occurred_at, 'id', id)
        from visible order by occurred_at desc, id desc offset page_size - 1 limit 1
      ) else null end
    ) from counts
  );
end
$$;
revoke all on function public.get_operator_money_history(integer,text,uuid,text,date,text,timestamptz,uuid) from public,anon;
grant execute on function public.get_operator_money_history(integer,text,uuid,text,date,text,timestamptz,uuid) to authenticated;
revoke all on function public.get_dashboard_money_history(integer,uuid,date,text,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_dashboard_money_history(integer,uuid,date,text,timestamptz,uuid,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
