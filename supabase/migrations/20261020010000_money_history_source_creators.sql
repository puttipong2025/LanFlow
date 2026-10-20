-- Presentation attribution is the source creator; actual event actors remain audit data.
begin;
alter table public.financial_transactions
  -- Immutable identity snapshot: no FK update into report-locked financial sources.
  add column history_creator_user_id uuid,
  add column history_creator_name text;
alter table public.dashboard_money_events
  add column creator_user_id uuid references public.profiles(id) on delete set null,
  add column creator_name text not null default 'ไม่ทราบผู้สร้างรายการ';
create index dashboard_money_events_source_creator_idx
  on public.dashboard_money_events(source_type, source_id, occurred_at desc, id desc)
  where creator_user_id is not null or creator_name <> 'ไม่ทราบผู้สร้างรายการ';

-- Recover only explicit creation evidence, never approvers or the employee paid.
-- ALTER TABLE above holds the source lock until commit. This metadata-only backfill
-- must not change report-locked business rows' updated_at or emit business events.
alter table public.financial_transactions disable trigger report_lock_financial_transactions;
alter table public.financial_transactions disable trigger handle_updated_at;
alter table public.financial_transactions disable trigger dashboard_dirty_financial_transactions;
alter table public.financial_transactions disable trigger dashboard_money_event_withdrawal_update;
update public.financial_transactions t
set history_creator_user_id = a.admin_id, history_creator_name = p.name
from (
  select distinct on (record_id) record_id, admin_id
  from public.time_tracking_audit_logs
  where target_table = 'financial_transactions'
    and action in ('REQUEST_WITHDRAWAL', 'REQUEST_WITHDRAWAL_ADJUSTMENT', 'CREATE_DEBT')
  order by record_id, created_at, id
) a left join public.profiles p on p.id = a.admin_id
where t.id = a.record_id;
alter table public.financial_transactions enable trigger report_lock_financial_transactions;
alter table public.financial_transactions enable trigger handle_updated_at;
alter table public.financial_transactions enable trigger dashboard_dirty_financial_transactions;
alter table public.financial_transactions enable trigger dashboard_money_event_withdrawal_update;

create function private.capture_financial_history_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.history_creator_user_id := auth.uid();
    select name into new.history_creator_name from public.profiles where id = auth.uid();
  elsif new.history_creator_user_id is distinct from old.history_creator_user_id
    or new.history_creator_name is distinct from old.history_creator_name then
    new.history_creator_user_id := old.history_creator_user_id;
    new.history_creator_name := old.history_creator_name;
  end if;
  return new;
end;
$$;
create trigger financial_history_creator before insert or update on public.financial_transactions
for each row execute function private.capture_financial_history_creator();

create function private.money_history_source_creator(p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  source_row jsonb;
  creator_id uuid;
  creator_name text;
begin
  case p_type
    when 'income_expense' then select to_jsonb(s) into source_row from public.income_expense s where id = p_id;
    when 'rubber_bill' then select to_jsonb(s) into source_row from public.rubber_bills s where id = p_id;
    when 'money_transfer', 'cash_transfer' then select to_jsonb(s) into source_row from public.money_transfers s where id = p_id;
    when 'rubber_export' then select to_jsonb(s) into source_row from public.rubber_exports s where id = p_id;
    when 'withdrawal', 'withdrawal_adjustment' then select to_jsonb(s) into source_row from public.financial_transactions s where id = p_id;
    when 'payroll_slip' then select to_jsonb(s) into source_row from public.payroll_slips s where id = p_id;
    else source_row := null;
  end case;
  if source_row is not null then
    creator_id := coalesce(nullif(source_row->>'created_by_user_id', ''),
      nullif(source_row->>'created_by', ''), nullif(source_row->>'history_creator_user_id', ''))::uuid;
    creator_name := coalesce(nullif(source_row->>'created_by_name', ''), nullif(source_row->>'history_creator_name', ''));
    if creator_name is null then
      select name into creator_name from public.profiles where id = creator_id;
    end if;
  else
    select nullif(payload->>'creatorUserId', '')::uuid, nullif(payload->>'creatorName', '')
    into creator_id, creator_name from private.dashboard_money_event_projection
    where source_type = p_type and source_id = p_id order by event_key limit 1;
    if creator_id is null and (creator_name is null or creator_name = 'ไม่ทราบผู้สร้างรายการ') then
      select e.creator_user_id, e.creator_name into creator_id, creator_name
      from public.dashboard_money_events e
      where e.source_type = p_type and e.source_id = p_id
        and (e.creator_user_id is not null or e.creator_name <> 'ไม่ทราบผู้สร้างรายการ')
      order by occurred_at desc, id desc limit 1;
    end if;
  end if;
  if creator_id is not null and not exists(select 1 from public.profiles where id = creator_id) then
    creator_id := null;
  end if;
  return jsonb_build_object('creatorUserId', creator_id,
    'creatorName', coalesce(creator_name, 'ไม่ทราบผู้สร้างรายการ'));
end;
$$;

-- Snapshot source creators outside the fingerprint: no fabricated business events.
alter function private.dashboard_money_source_entries(text, uuid)
  rename to dashboard_money_source_entries_before_creator_snapshot;
create function private.dashboard_money_source_entries(p_source_type text, p_source_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(entry || private.money_history_source_creator(p_source_type, p_source_id)), '[]'::jsonb)
  from jsonb_array_elements(private.dashboard_money_source_entries_before_creator_snapshot(p_source_type, p_source_id)) entry
$$;

update private.dashboard_money_event_projection p
set payload = p.payload || private.money_history_source_creator(p.source_type, p.source_id);
update public.dashboard_money_events e
set creator_user_id = nullif(c.value->>'creatorUserId', '')::uuid,
    creator_name = c.value->>'creatorName'
from (
  select distinct source_type, source_id,
    private.money_history_source_creator(source_type, source_id) as value
  from public.dashboard_money_events
) c where e.source_type = c.source_type and e.source_id = c.source_id;

create function private.capture_money_history_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
declare creator jsonb;
begin
  -- Explicit snapshots are accepted only through already-privileged event writers.
  if new.creator_user_id is not null or new.creator_name <> 'ไม่ทราบผู้สร้างรายการ' then return new; end if;
  creator := private.money_history_source_creator(new.source_type, new.source_id);
  new.creator_user_id := nullif(creator->>'creatorUserId', '')::uuid;
  new.creator_name := creator->>'creatorName';
  return new;
end;
$$;
create trigger money_history_creator before insert on public.dashboard_money_events
for each row execute function private.capture_money_history_creator();

revoke all on function private.capture_financial_history_creator() from public, anon, authenticated;
revoke all on function private.money_history_source_creator(text, uuid) from public, anon, authenticated;
revoke all on function private.capture_money_history_creator() from public, anon, authenticated;
revoke all on function private.dashboard_money_source_entries(text, uuid) from public, anon, authenticated;
revoke all on function private.dashboard_money_source_entries_before_creator_snapshot(text, uuid) from public, anon, authenticated;

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
        'actorName', creator_name, 'occurredAt', occurred_at,
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

create or replace function public.get_dashboard_money_history(
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
      order by event.occurred_at desc, event.id desc limit page_size + 1
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
notify pgrst, 'reload schema';
commit;
