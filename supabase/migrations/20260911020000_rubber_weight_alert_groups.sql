-- Group accumulated-net-weight alerts independently from Rubber Bill approval rules.

create table public.rubber_weight_alert_groups (
  id uuid primary key default gen_random_uuid(),
  threshold_kg integer not null,
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  updated_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rubber_weight_alert_groups_threshold_check
    check (threshold_kg between 1 and 1000000)
);

create table public.rubber_weight_alert_group_locations (
  group_id uuid not null references public.rubber_weight_alert_groups(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  created_at timestamptz not null default now(),
  primary key (group_id, location_id),
  unique (location_id)
);

create or replace function private.assert_rubber_weight_alert_group_not_empty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
begin
  if exists (select 1 from public.rubber_weight_alert_groups g where g.id = v_group_id)
     and not exists (
       select 1 from public.rubber_weight_alert_group_locations gl
       where gl.group_id = v_group_id
     ) then
    raise exception 'RUBBER_WEIGHT_ALERT_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  return null;
end
$$;

create constraint trigger enforce_rubber_weight_alert_group_not_empty
after insert or update or delete on public.rubber_weight_alert_group_locations
deferrable initially deferred
for each row execute function private.assert_rubber_weight_alert_group_not_empty();

create or replace function private.assert_rubber_weight_alert_group_row_not_empty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.rubber_weight_alert_groups g where g.id = new.id)
     and not exists (
       select 1 from public.rubber_weight_alert_group_locations gl
       where gl.group_id = new.id
     ) then
    raise exception 'RUBBER_WEIGHT_ALERT_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  return null;
end
$$;

create constraint trigger enforce_rubber_weight_alert_group_row_not_empty
after insert or update on public.rubber_weight_alert_groups
deferrable initially deferred
for each row execute function private.assert_rubber_weight_alert_group_row_not_empty();

-- Preserve the legacy threshold for branches active at migration time. A branch
-- created later intentionally remains ungrouped until a manager assigns it.
with initial_group as (
  insert into public.rubber_weight_alert_groups (
    threshold_kg,
    updated_by_user_id,
    updated_by_name,
    updated_at
  )
  select
    s.rubber_alert_threshold_kg,
    s.updated_by_user_id,
    s.updated_by_name,
    s.updated_at
  from public.dashboard_refresh_settings s
  where s.id = true
    and exists (select 1 from public.locations l where l.is_active = true)
  returning id
)
insert into public.rubber_weight_alert_group_locations (group_id, location_id)
select initial_group.id, l.id
from initial_group
cross join public.locations l
where l.is_active = true;

set constraints all immediate;

alter table public.rubber_weight_alert_groups enable row level security;
alter table public.rubber_weight_alert_group_locations enable row level security;

create policy rubber_weight_alert_groups_manager_read
on public.rubber_weight_alert_groups for select to authenticated
using (private.is_active_user() and private.can_access_super_admin_features());

create policy rubber_weight_alert_group_locations_manager_read
on public.rubber_weight_alert_group_locations for select to authenticated
using (private.is_active_user() and private.can_access_super_admin_features());

revoke all on public.rubber_weight_alert_groups from public, anon, authenticated;
revoke all on public.rubber_weight_alert_group_locations from public, anon, authenticated;
grant select on public.rubber_weight_alert_groups to authenticated;
grant select on public.rubber_weight_alert_group_locations to authenticated;
grant all on public.rubber_weight_alert_groups to service_role;
grant all on public.rubber_weight_alert_group_locations to service_role;

create or replace function public.list_rubber_weight_alert_groups()
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
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนน้ำหนัก';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', grouped.id,
    'locationIds', grouped.location_ids,
    'thresholdKg', grouped.threshold_kg
  ) order by grouped.created_at, grouped.id), '[]'::jsonb)
  into v_groups
  from (
    select g.id, g.threshold_kg, g.created_at,
      to_jsonb(array_agg(gl.location_id order by l.name, gl.location_id)) location_ids
    from public.rubber_weight_alert_groups g
    join public.rubber_weight_alert_group_locations gl on gl.group_id = g.id
    join public.locations l on l.id = gl.location_id
    group by g.id
  ) grouped;

  select coalesce(jsonb_agg(l.id order by l.name, l.id), '[]'::jsonb)
  into v_available_location_ids
  from public.locations l
  where l.is_active = true
    and not exists (
      select 1 from public.rubber_weight_alert_group_locations gl
      where gl.location_id = l.id
    );

  return jsonb_build_object(
    'groups', v_groups,
    'availableLocationIds', v_available_location_ids
  );
end
$$;

create or replace function private.validate_rubber_weight_alert_group_input(
  p_group_id uuid,
  p_location_ids uuid[],
  p_threshold_kg integer
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
    from public.rubber_weight_alert_group_locations gl
    join public.locations l on l.id = gl.location_id
    where p_group_id is not null
      and gl.group_id = p_group_id
      and l.is_active = false
  ) retained;

  if cardinality(v_location_ids) = 0 then
    raise exception 'RUBBER_WEIGHT_ALERT_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  if p_threshold_kg is null or p_threshold_kg < 1 or p_threshold_kg > 1000000 then
    raise exception 'RUBBER_WEIGHT_ALERT_GROUP_INVALID: เกณฑ์ต้องอยู่ระหว่าง 1–1,000,000 กก.';
  end if;
  if exists (
    select 1
    from unnest(v_location_ids) requested(location_id)
    left join public.locations l on l.id = requested.location_id
    where l.id is null
      or (
        l.is_active = false
        and not exists (
          select 1 from public.rubber_weight_alert_group_locations gl
          where gl.group_id = p_group_id and gl.location_id = requested.location_id
        )
      )
  ) then
    raise exception 'RUBBER_LOCATION_NOT_FOUND: ไม่พบสาขาที่เปิดใช้งาน';
  end if;
  return v_location_ids;
end
$$;

create or replace function public.create_rubber_weight_alert_group(
  p_location_ids uuid[],
  p_threshold_kg integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_group public.rubber_weight_alert_groups%rowtype;
  v_actor public.profiles%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนน้ำหนัก';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-weight-alert-groups', 0));
  v_location_ids := private.validate_rubber_weight_alert_group_input(
    null, p_location_ids, p_threshold_kg
  );
  if exists (
    select 1 from public.rubber_weight_alert_group_locations gl
    where gl.location_id = any(v_location_ids)
  ) then
    raise exception 'RUBBER_WEIGHT_ALERT_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
  end if;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  insert into public.rubber_weight_alert_groups (
    threshold_kg, updated_by_user_id, updated_by_name, updated_by_phone
  ) values (
    p_threshold_kg, auth.uid(), v_actor.name, v_actor.phone
  ) returning * into v_group;

  insert into public.rubber_weight_alert_group_locations (group_id, location_id)
  select v_group.id, location_id from unnest(v_location_ids) location_id;

  return jsonb_build_object(
    'id', v_group.id,
    'locationIds', to_jsonb(v_location_ids),
    'thresholdKg', v_group.threshold_kg
  );
exception when unique_violation then
  raise exception 'RUBBER_WEIGHT_ALERT_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
end
$$;

create or replace function public.update_rubber_weight_alert_group(
  p_group_id uuid,
  p_location_ids uuid[],
  p_threshold_kg integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_group public.rubber_weight_alert_groups%rowtype;
  v_actor public.profiles%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนน้ำหนัก';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-weight-alert-groups', 0));
  select * into v_group from public.rubber_weight_alert_groups g
  where g.id = p_group_id for update;
  if v_group.id is null then
    raise exception 'RUBBER_WEIGHT_ALERT_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;

  v_location_ids := private.validate_rubber_weight_alert_group_input(
    p_group_id, p_location_ids, p_threshold_kg
  );
  if exists (
    select 1 from public.rubber_weight_alert_group_locations gl
    where gl.location_id = any(v_location_ids) and gl.group_id <> p_group_id
  ) then
    raise exception 'RUBBER_WEIGHT_ALERT_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
  end if;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  update public.rubber_weight_alert_groups
  set threshold_kg = p_threshold_kg,
      updated_by_user_id = auth.uid(),
      updated_by_name = v_actor.name,
      updated_by_phone = v_actor.phone,
      updated_at = now()
  where id = p_group_id
  returning * into v_group;

  delete from public.rubber_weight_alert_group_locations gl
  where gl.group_id = p_group_id and not (gl.location_id = any(v_location_ids));
  insert into public.rubber_weight_alert_group_locations (group_id, location_id)
  select p_group_id, location_id from unnest(v_location_ids) location_id
  on conflict (group_id, location_id) do nothing;

  return jsonb_build_object(
    'id', v_group.id,
    'locationIds', to_jsonb(v_location_ids),
    'thresholdKg', v_group.threshold_kg
  );
exception when unique_violation then
  raise exception 'RUBBER_WEIGHT_ALERT_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
end
$$;

create or replace function public.delete_rubber_weight_alert_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนน้ำหนัก';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-weight-alert-groups', 0));
  select array_agg(gl.location_id order by gl.location_id)
  into v_location_ids
  from public.rubber_weight_alert_group_locations gl
  where gl.group_id = p_group_id;
  if v_location_ids is null then
    raise exception 'RUBBER_WEIGHT_ALERT_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;
  delete from public.rubber_weight_alert_groups where id = p_group_id;
  return jsonb_build_object(
    'success', true,
    'releasedLocationIds', to_jsonb(v_location_ids)
  );
end
$$;

create or replace function public.save_rubber_weight_alert_interval(p_interval_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  perform private.dashboard_require_manager();
  if p_interval_minutes is null or p_interval_minutes < 1 or p_interval_minutes > 1440 then
    raise exception 'RUBBER_WEIGHT_ALERT_INVALID: รอบตรวจต้องอยู่ระหว่าง 1–1,440 นาที';
  end if;
  select p.name into actor_name from public.profiles p where p.id = auth.uid();
  update public.dashboard_refresh_settings
  set rubber_alert_interval_minutes = p_interval_minutes,
      updated_by_user_id = auth.uid(),
      updated_by_name = actor_name,
      updated_at = now()
  where id = true;
  return public.get_rubber_weight_alert_config();
end
$$;

create or replace function public.get_rubber_weight_alert_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings public.dashboard_refresh_settings%rowtype;
  candidates jsonb;
begin
  if not private.can_access_business_modules() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์ตรวจการแจ้งเตือนน้ำหนัก';
  end if;

  select * into strict settings
  from public.dashboard_refresh_settings
  where id = true;

  with ordered_groups as (
    select g.id, g.threshold_kg,
      row_number() over (order by g.created_at, g.id)::integer as group_order
    from public.rubber_weight_alert_groups g
  ), eligible as (
    select
      l.id,
      l.name,
      l.created_at,
      ordered_groups.id as group_id,
      ordered_groups.group_order,
      ordered_groups.threshold_kg,
      case
        when jsonb_typeof(s.summary #> '{rubberRemaining,netWeight}') = 'number'
          then (s.summary #>> '{rubberRemaining,netWeight}')::numeric
        else null
      end as net_weight
    from ordered_groups
    join public.rubber_weight_alert_group_locations gl on gl.group_id = ordered_groups.id
    join public.locations l on l.id = gl.location_id
    join public.dashboard_branch_snapshots s on s.location_id = l.id
    where l.is_active = true
      and public.can_access_location(l.id)
      and s.status = 'ready'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'locationId', eligible.id,
    'locationName', eligible.name,
    'netWeight', eligible.net_weight,
    'groupId', eligible.group_id,
    'groupOrder', eligible.group_order,
    'thresholdKg', eligible.threshold_kg
  ) order by eligible.group_order, eligible.net_weight desc, eligible.created_at, eligible.id), '[]'::jsonb)
  into candidates
  from eligible
  where eligible.net_weight > eligible.threshold_kg;

  return jsonb_build_object(
    'config', jsonb_build_object(
      'thresholdKg', settings.rubber_alert_threshold_kg,
      'intervalMinutes', settings.rubber_alert_interval_minutes
    ),
    'candidates', candidates
  );
end
$$;

revoke all on function private.assert_rubber_weight_alert_group_not_empty() from public, anon, authenticated;
revoke all on function private.assert_rubber_weight_alert_group_row_not_empty() from public, anon, authenticated;
revoke all on function private.validate_rubber_weight_alert_group_input(uuid, uuid[], integer) from public, anon, authenticated;
revoke all on function public.list_rubber_weight_alert_groups() from public, anon;
revoke all on function public.create_rubber_weight_alert_group(uuid[], integer) from public, anon;
revoke all on function public.update_rubber_weight_alert_group(uuid, uuid[], integer) from public, anon;
revoke all on function public.delete_rubber_weight_alert_group(uuid) from public, anon;
revoke all on function public.save_rubber_weight_alert_interval(integer) from public, anon;

grant execute on function public.list_rubber_weight_alert_groups() to authenticated, service_role;
grant execute on function public.create_rubber_weight_alert_group(uuid[], integer) to authenticated, service_role;
grant execute on function public.update_rubber_weight_alert_group(uuid, uuid[], integer) to authenticated, service_role;
grant execute on function public.delete_rubber_weight_alert_group(uuid) to authenticated, service_role;
grant execute on function public.save_rubber_weight_alert_interval(integer) to authenticated, service_role;

notify pgrst, 'reload schema';
