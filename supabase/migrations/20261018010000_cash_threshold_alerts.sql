-- Group accumulated-net-weight alerts independently from Rubber Bill approval rules.

create table public.cash_alert_groups (
  id uuid primary key default gen_random_uuid(),
  threshold_amount numeric not null,
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  updated_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_alert_groups_threshold_check
    check (threshold_amount between -9999999999.99 and 9999999999.99 and threshold_amount = round(threshold_amount, 2))
);

create table public.cash_alert_group_locations (
  group_id uuid not null references public.cash_alert_groups(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  created_at timestamptz not null default now(),
  primary key (group_id, location_id),
  unique (location_id)
);

create or replace function private.assert_cash_alert_group_not_empty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
begin
  if exists (select 1 from public.cash_alert_groups g where g.id = v_group_id)
     and not exists (
       select 1 from public.cash_alert_group_locations gl
       where gl.group_id = v_group_id
     ) then
    raise exception 'CASH_ALERT_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  return null;
end
$$;

create constraint trigger enforce_cash_alert_group_not_empty
after insert or update or delete on public.cash_alert_group_locations
deferrable initially deferred
for each row execute function private.assert_cash_alert_group_not_empty();

create or replace function private.assert_cash_alert_group_row_not_empty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.cash_alert_groups g where g.id = new.id)
     and not exists (
       select 1 from public.cash_alert_group_locations gl
       where gl.group_id = new.id
     ) then
    raise exception 'CASH_ALERT_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  return null;
end
$$;

create constraint trigger enforce_cash_alert_group_row_not_empty
after insert or update on public.cash_alert_groups
deferrable initially deferred
for each row execute function private.assert_cash_alert_group_row_not_empty();

alter table public.cash_alert_groups enable row level security;
alter table public.cash_alert_group_locations enable row level security;

create policy cash_alert_groups_manager_read
on public.cash_alert_groups for select to authenticated
using (private.is_active_user() and private.can_access_super_admin_features());

create policy cash_alert_group_locations_manager_read
on public.cash_alert_group_locations for select to authenticated
using (private.is_active_user() and private.can_access_super_admin_features());

revoke all on public.cash_alert_groups from public, anon, authenticated;
revoke all on public.cash_alert_group_locations from public, anon, authenticated;
grant select on public.cash_alert_groups to authenticated;
grant select on public.cash_alert_group_locations to authenticated;
grant all on public.cash_alert_groups to service_role;
grant all on public.cash_alert_group_locations to service_role;

create or replace function public.list_cash_alert_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_available_location_ids jsonb;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนเงิน';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', grouped.id,
    'locationIds', grouped.location_ids,
    'thresholdAmount', grouped.threshold_amount
  ) order by grouped.created_at, grouped.id), '[]'::jsonb)
  into v_groups
  from (
    select g.id, g.threshold_amount, g.created_at,
      to_jsonb(array_agg(gl.location_id order by l.name, gl.location_id)) location_ids
    from public.cash_alert_groups g
    join public.cash_alert_group_locations gl on gl.group_id = g.id
    join public.locations l on l.id = gl.location_id
    group by g.id
  ) grouped;

  select coalesce(jsonb_agg(l.id order by l.name, l.id), '[]'::jsonb)
  into v_available_location_ids
  from public.locations l
  where l.is_active = true
    and not exists (
      select 1 from public.cash_alert_group_locations gl
      where gl.location_id = l.id
    );

  return jsonb_build_object(
    'groups', v_groups,
    'availableLocationIds', v_available_location_ids
  );
end
$$;

create or replace function private.validate_cash_alert_group_input(
  p_group_id uuid,
  p_location_ids uuid[],
  p_threshold_amount numeric
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
begin
  select coalesce(array_agg(distinct location_id order by location_id), array[]::uuid[])
  into v_location_ids
  from (
    select location_id
    from unnest(coalesce(p_location_ids, array[]::uuid[])) location_id
    where location_id is not null
    union
    select gl.location_id
    from public.cash_alert_group_locations gl
    join public.locations l on l.id = gl.location_id
    where p_group_id is not null
      and gl.group_id = p_group_id
      and l.is_active = false
  ) retained;

  if cardinality(v_location_ids) = 0 then
    raise exception 'CASH_ALERT_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  if p_threshold_amount is null or p_threshold_amount < -9999999999.99 or p_threshold_amount > 9999999999.99 or p_threshold_amount <> round(p_threshold_amount, 2) then
    raise exception 'CASH_ALERT_GROUP_INVALID: เกณฑ์เงินต้องอยู่ระหว่าง -9,999,999,999.99 ถึง 9,999,999,999.99 บาท และทศนิยมไม่เกินสองตำแหน่ง';
  end if;
  if exists (
    select 1
    from unnest(v_location_ids) requested(location_id)
    left join public.locations l on l.id = requested.location_id
    where l.id is null
      or (
        l.is_active = false
        and not exists (
          select 1 from public.cash_alert_group_locations gl
          where gl.group_id = p_group_id and gl.location_id = requested.location_id
        )
      )
  ) then
    raise exception 'RUBBER_LOCATION_NOT_FOUND: ไม่พบสาขาที่เปิดใช้งาน';
  end if;
  return v_location_ids;
end
$$;

create or replace function public.create_cash_alert_group(
  p_location_ids uuid[],
  p_threshold_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_group public.cash_alert_groups%rowtype;
  v_actor public.profiles%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนเงิน';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cash-alert-groups', 0));
  v_location_ids := private.validate_cash_alert_group_input(
    null, p_location_ids, p_threshold_amount
  );
  if exists (
    select 1 from public.cash_alert_group_locations gl
    where gl.location_id = any(v_location_ids)
  ) then
    raise exception 'CASH_ALERT_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
  end if;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  insert into public.cash_alert_groups (
    threshold_amount, updated_by_user_id, updated_by_name, updated_by_phone
  ) values (
    p_threshold_amount, auth.uid(), v_actor.name, v_actor.phone
  ) returning * into v_group;

  insert into public.cash_alert_group_locations (group_id, location_id)
  select v_group.id, location_id from unnest(v_location_ids) location_id;

  return jsonb_build_object(
    'id', v_group.id,
    'locationIds', to_jsonb(v_location_ids),
    'thresholdAmount', v_group.threshold_amount
  );
exception when unique_violation then
  raise exception 'CASH_ALERT_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
end
$$;

create or replace function public.update_cash_alert_group(
  p_group_id uuid,
  p_location_ids uuid[],
  p_threshold_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_group public.cash_alert_groups%rowtype;
  v_actor public.profiles%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนเงิน';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cash-alert-groups', 0));
  select * into v_group from public.cash_alert_groups g
  where g.id = p_group_id for update;
  if v_group.id is null then
    raise exception 'CASH_ALERT_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;

  v_location_ids := private.validate_cash_alert_group_input(
    p_group_id, p_location_ids, p_threshold_amount
  );
  if exists (
    select 1 from public.cash_alert_group_locations gl
    where gl.location_id = any(v_location_ids) and gl.group_id <> p_group_id
  ) then
    raise exception 'CASH_ALERT_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
  end if;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  update public.cash_alert_groups
  set threshold_amount = p_threshold_amount,
      updated_by_user_id = auth.uid(),
      updated_by_name = v_actor.name,
      updated_by_phone = v_actor.phone,
      updated_at = now()
  where id = p_group_id
  returning * into v_group;

  delete from public.cash_alert_group_locations gl
  where gl.group_id = p_group_id and not (gl.location_id = any(v_location_ids));
  insert into public.cash_alert_group_locations (group_id, location_id)
  select p_group_id, location_id from unnest(v_location_ids) location_id
  on conflict (group_id, location_id) do nothing;

  return jsonb_build_object(
    'id', v_group.id,
    'locationIds', to_jsonb(v_location_ids),
    'thresholdAmount', v_group.threshold_amount
  );
exception when unique_violation then
  raise exception 'CASH_ALERT_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
end
$$;

create or replace function public.delete_cash_alert_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนเงิน';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cash-alert-groups', 0));
  select array_agg(gl.location_id order by gl.location_id)
  into v_location_ids
  from public.cash_alert_group_locations gl
  where gl.group_id = p_group_id;
  if v_location_ids is null then
    raise exception 'CASH_ALERT_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;
  delete from public.cash_alert_groups where id = p_group_id;
  return jsonb_build_object(
    'success', true,
    'releasedLocationIds', to_jsonb(v_location_ids)
  );
end
$$;


revoke all on function private.assert_cash_alert_group_not_empty() from public, anon, authenticated;
revoke all on function private.assert_cash_alert_group_row_not_empty() from public, anon, authenticated;
revoke all on function private.validate_cash_alert_group_input(uuid, uuid[], numeric) from public, anon, authenticated;
revoke all on function public.list_cash_alert_groups() from public, anon;
grant execute on function public.list_cash_alert_groups() to authenticated;
revoke all on function public.create_cash_alert_group(uuid[], numeric) from public, anon;
grant execute on function public.create_cash_alert_group(uuid[], numeric) to authenticated;
revoke all on function public.update_cash_alert_group(uuid, uuid[], numeric) from public, anon;
grant execute on function public.update_cash_alert_group(uuid, uuid[], numeric) to authenticated;
revoke all on function public.delete_cash_alert_group(uuid) from public, anon;
grant execute on function public.delete_cash_alert_group(uuid) to authenticated;

-- A single snapshot-consistent read; unconfigured branches are outside the scope.
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
    ) order by kind, group_order, location_name, location_id)
      filter (where (kind = 'cash' and value < threshold) or (kind = 'weight' and value > threshold)), '[]'::jsonb),
    'unavailable', coalesce(jsonb_agg(jsonb_build_object(
      'kind', kind, 'locationId', location_id, 'locationName', location_name,
      'reason', case when status is null then 'missing_snapshot'
        when status <> 'ready' then 'not_ready' else 'missing_metric' end
    ) order by kind, location_name, location_id) filter (where value is null), '[]'::jsonb)
  ) into result from measured;
  return result;
end $$;
revoke all on function public.get_branch_threshold_alert_check() from public, anon;
grant execute on function public.get_branch_threshold_alert_check() to authenticated;
