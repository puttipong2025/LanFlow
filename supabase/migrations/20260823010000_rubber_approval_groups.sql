-- Resolve Rubber Bill price/time approval rules by branch group while keeping
-- the non-current-date rule global.

create table public.rubber_approval_groups (
  id uuid primary key default gen_random_uuid(),
  edit_window_minutes integer not null,
  configured_price numeric(12,2),
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  updated_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rubber_approval_groups_edit_window_check
    check (edit_window_minutes >= 0),
  constraint rubber_approval_groups_price_check
    check (configured_price is null or configured_price >= 0)
);

create table public.rubber_approval_group_locations (
  group_id uuid not null references public.rubber_approval_groups(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  created_at timestamptz not null default now(),
  primary key (group_id, location_id),
  unique (location_id)
);

create index rubber_approval_group_locations_group_idx
  on public.rubber_approval_group_locations (group_id, location_id);

create or replace function private.assert_rubber_approval_group_not_empty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
begin
  if exists (select 1 from public.rubber_approval_groups g where g.id = v_group_id)
     and not exists (
       select 1 from public.rubber_approval_group_locations gl
       where gl.group_id = v_group_id
     ) then
    raise exception 'RUBBER_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  return null;
end
$$;

create constraint trigger enforce_rubber_approval_group_not_empty
after insert or update or delete on public.rubber_approval_group_locations
deferrable initially deferred
for each row execute function private.assert_rubber_approval_group_not_empty();

create or replace function private.assert_rubber_approval_group_row_not_empty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.rubber_approval_groups g where g.id = new.id)
     and not exists (
       select 1 from public.rubber_approval_group_locations gl
       where gl.group_id = new.id
     ) then
    raise exception 'RUBBER_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  return null;
end
$$;

create constraint trigger enforce_rubber_approval_group_row_not_empty
after insert or update on public.rubber_approval_groups
deferrable initially deferred
for each row execute function private.assert_rubber_approval_group_row_not_empty();

-- Preserve the former singleton price/time values for every currently active
-- branch. Branches provisioned after this migration intentionally start exempt.
with initial_group as (
  insert into public.rubber_approval_groups (
    edit_window_minutes,
    configured_price,
    updated_by_user_id,
    updated_by_name,
    updated_by_phone,
    updated_at
  )
  select
    s.edit_window_minutes,
    s.configured_price,
    s.updated_by_user_id,
    s.updated_by_name,
    s.updated_by_phone,
    s.updated_at
  from public.rubber_bill_approval_settings s
  where s.id = true
    and exists (select 1 from public.locations l where l.is_active = true)
  returning id
)
insert into public.rubber_approval_group_locations (group_id, location_id)
select initial_group.id, l.id
from initial_group
cross join public.locations l
where l.is_active = true;

-- The deferred non-empty-group trigger validates the seed membership before
-- changing table RLS state; PostgreSQL otherwise rejects the ALTER with
-- pending trigger events.
set constraints all immediate;

alter table public.rubber_approval_groups enable row level security;
alter table public.rubber_approval_group_locations enable row level security;

create policy rubber_approval_groups_manager_read
on public.rubber_approval_groups for select to authenticated
using (private.is_active_user() and private.can_access_super_admin_features());

create policy rubber_approval_group_locations_manager_read
on public.rubber_approval_group_locations for select to authenticated
using (private.is_active_user() and private.can_access_super_admin_features());

revoke all on public.rubber_approval_groups from public, anon, authenticated;
revoke all on public.rubber_approval_group_locations from public, anon, authenticated;
grant select on public.rubber_approval_groups to authenticated;
grant select on public.rubber_approval_group_locations to authenticated;
grant all on public.rubber_approval_groups to service_role;
grant all on public.rubber_approval_group_locations to service_role;

create or replace function private.effective_rubber_approval_settings(p_location_id uuid)
returns table (
  group_id uuid,
  price_time_exempt boolean,
  edit_window_minutes integer,
  configured_price numeric,
  updated_by_name text,
  updated_by_phone text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    g.id is null,
    g.edit_window_minutes,
    g.configured_price,
    g.updated_by_name,
    g.updated_by_phone,
    g.updated_at
  from (select 1) seed
  left join public.rubber_approval_group_locations gl
    on gl.location_id = p_location_id
  left join public.rubber_approval_groups g
    on g.id = gl.group_id
$$;

create or replace function public.get_effective_rubber_approval_settings(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_effective record;
  v_non_current_date_requires_approval boolean;
begin
  if p_location_id is null
     or not private.is_active_user()
     or not private.can_access_location(p_location_id) then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์ดูการตั้งค่าของสาขานี้';
  end if;
  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.is_active = true
  ) then
    raise exception 'RUBBER_LOCATION_NOT_FOUND: ไม่พบสาขาที่ใช้งาน';
  end if;

  select * into v_effective
  from private.effective_rubber_approval_settings(p_location_id);
  select s.non_current_date_requires_approval
    into v_non_current_date_requires_approval
  from public.rubber_bill_approval_settings s
  where s.id = true;

  return jsonb_build_object(
    'locationId', p_location_id,
    'groupId', v_effective.group_id,
    'priceTimeExempt', v_effective.price_time_exempt,
    'editWindowMinutes', v_effective.edit_window_minutes,
    'configuredPrice', v_effective.configured_price,
    'nonCurrentDateRequiresApproval', coalesce(v_non_current_date_requires_approval, false),
    'updatedByName', v_effective.updated_by_name,
    'updatedByPhone', v_effective.updated_by_phone,
    'updatedAt', v_effective.updated_at
  );
end
$$;

create or replace function public.list_rubber_approval_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_available_location_ids jsonb;
  v_non_current_date_requires_approval boolean;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', grouped.id,
    'locationIds', grouped.location_ids,
    'editWindowMinutes', grouped.edit_window_minutes,
    'configuredPrice', grouped.configured_price,
    'updatedAt', grouped.updated_at
  ) order by grouped.created_at, grouped.id), '[]'::jsonb)
  into v_groups
  from (
    select g.id, g.edit_window_minutes, g.configured_price, g.created_at, g.updated_at,
      to_jsonb(array_agg(gl.location_id order by l.name, gl.location_id)) location_ids
    from public.rubber_approval_groups g
    join public.rubber_approval_group_locations gl on gl.group_id = g.id
    join public.locations l on l.id = gl.location_id
    group by g.id
  ) grouped;

  select coalesce(jsonb_agg(l.id order by l.name, l.id), '[]'::jsonb)
    into v_available_location_ids
  from public.locations l
  where l.is_active = true
    and not exists (
      select 1 from public.rubber_approval_group_locations gl
      where gl.location_id = l.id
    );

  select s.non_current_date_requires_approval
    into v_non_current_date_requires_approval
  from public.rubber_bill_approval_settings s where s.id = true;

  return jsonb_build_object(
    'groups', v_groups,
    'availableLocationIds', v_available_location_ids,
    'nonCurrentDateRequiresApproval', coalesce(v_non_current_date_requires_approval, false)
  );
end
$$;

create or replace function private.validate_rubber_approval_group_input(
  p_location_ids uuid[],
  p_edit_window_minutes integer,
  p_configured_price numeric
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
  from unnest(coalesce(p_location_ids, array[]::uuid[])) location_id
  where location_id is not null;

  if cardinality(v_location_ids) = 0 then
    raise exception 'RUBBER_GROUP_EMPTY: กลุ่มต้องมีอย่างน้อยหนึ่งสาขา';
  end if;
  if p_edit_window_minutes is null or p_edit_window_minutes < 0 then
    raise exception 'RUBBER_GROUP_INVALID: จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  if p_configured_price is not null
     and (p_configured_price < 0 or scale(p_configured_price) > 2) then
    raise exception 'RUBBER_GROUP_INVALID: ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;
  if exists (
    select 1 from unnest(v_location_ids) requested(location_id)
    left join public.locations l on l.id = requested.location_id and l.is_active = true
    where l.id is null
  ) then
    raise exception 'RUBBER_LOCATION_NOT_FOUND: ไม่พบสาขาที่ใช้งาน';
  end if;
  return v_location_ids;
end
$$;

create or replace function public.create_rubber_approval_group(
  p_location_ids uuid[],
  p_edit_window_minutes integer,
  p_configured_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_group public.rubber_approval_groups%rowtype;
  v_actor public.profiles%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-groups', 0));
  v_location_ids := private.validate_rubber_approval_group_input(
    p_location_ids, p_edit_window_minutes, p_configured_price
  );
  if exists (
    select 1 from public.rubber_approval_group_locations gl
    where gl.location_id = any(v_location_ids)
  ) then
    raise exception 'RUBBER_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
  end if;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  insert into public.rubber_approval_groups (
    edit_window_minutes, configured_price,
    updated_by_user_id, updated_by_name, updated_by_phone
  ) values (
    p_edit_window_minutes, p_configured_price,
    auth.uid(), v_actor.name, v_actor.phone
  ) returning * into v_group;

  insert into public.rubber_approval_group_locations (group_id, location_id)
  select v_group.id, location_id from unnest(v_location_ids) location_id;

  return jsonb_build_object(
    'id', v_group.id,
    'locationIds', to_jsonb(v_location_ids),
    'editWindowMinutes', v_group.edit_window_minutes,
    'configuredPrice', v_group.configured_price,
    'updatedAt', v_group.updated_at
  );
exception when unique_violation then
  raise exception 'RUBBER_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
end
$$;

create or replace function public.update_rubber_approval_group(
  p_group_id uuid,
  p_location_ids uuid[],
  p_edit_window_minutes integer,
  p_configured_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_group public.rubber_approval_groups%rowtype;
  v_actor public.profiles%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-groups', 0));
  select * into v_group from public.rubber_approval_groups g
  where g.id = p_group_id for update;
  if v_group.id is null then
    raise exception 'RUBBER_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;
  v_location_ids := private.validate_rubber_approval_group_input(
    p_location_ids, p_edit_window_minutes, p_configured_price
  );
  if exists (
    select 1 from public.rubber_approval_group_locations gl
    where gl.location_id = any(v_location_ids) and gl.group_id <> p_group_id
  ) then
    raise exception 'RUBBER_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
  end if;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  update public.rubber_approval_groups
  set edit_window_minutes = p_edit_window_minutes,
      configured_price = p_configured_price,
      updated_by_user_id = auth.uid(),
      updated_by_name = v_actor.name,
      updated_by_phone = v_actor.phone,
      updated_at = now()
  where id = p_group_id
  returning * into v_group;

  delete from public.rubber_approval_group_locations gl
  where gl.group_id = p_group_id and not (gl.location_id = any(v_location_ids));
  insert into public.rubber_approval_group_locations (group_id, location_id)
  select p_group_id, location_id from unnest(v_location_ids) location_id
  on conflict (group_id, location_id) do nothing;

  return jsonb_build_object(
    'id', v_group.id,
    'locationIds', to_jsonb(v_location_ids),
    'editWindowMinutes', v_group.edit_window_minutes,
    'configuredPrice', v_group.configured_price,
    'updatedAt', v_group.updated_at
  );
exception when unique_violation then
  raise exception 'RUBBER_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
end
$$;

create or replace function public.delete_rubber_approval_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-groups', 0));
  select array_agg(gl.location_id order by gl.location_id)
    into v_location_ids
  from public.rubber_approval_group_locations gl
  where gl.group_id = p_group_id;
  if v_location_ids is null then
    raise exception 'RUBBER_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;
  delete from public.rubber_approval_groups where id = p_group_id;
  return jsonb_build_object(
    'success', true,
    'releasedLocationIds', to_jsonb(v_location_ids)
  );
end
$$;

create or replace function public.save_rubber_bill_date_approval_setting(
  p_non_current_date_requires_approval boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์ตั้งค่าการอนุมัติบิลยาง';
  end if;
  if p_non_current_date_requires_approval is null then
    raise exception 'RUBBER_GROUP_INVALID: ต้องระบุกฎวันที่บิล';
  end if;
  update public.rubber_bill_approval_settings
  set non_current_date_requires_approval = p_non_current_date_requires_approval,
      updated_by_user_id = auth.uid(),
      updated_by_name = (select p.name from public.profiles p where p.id = auth.uid()),
      updated_by_phone = (select p.phone from public.profiles p where p.id = auth.uid()),
      updated_at = now()
  where id = true;
  return p_non_current_date_requires_approval;
end
$$;

revoke all on function private.assert_rubber_approval_group_not_empty() from public, anon, authenticated;
revoke all on function private.assert_rubber_approval_group_row_not_empty() from public, anon, authenticated;
revoke all on function private.effective_rubber_approval_settings(uuid) from public, anon, authenticated;
revoke all on function private.validate_rubber_approval_group_input(uuid[], integer, numeric) from public, anon, authenticated;
revoke all on function public.get_effective_rubber_approval_settings(uuid) from public, anon;
revoke all on function public.list_rubber_approval_groups() from public, anon;
revoke all on function public.create_rubber_approval_group(uuid[], integer, numeric) from public, anon;
revoke all on function public.update_rubber_approval_group(uuid, uuid[], integer, numeric) from public, anon;
revoke all on function public.delete_rubber_approval_group(uuid) from public, anon;
revoke all on function public.save_rubber_bill_date_approval_setting(boolean) from public, anon;
grant execute on function public.get_effective_rubber_approval_settings(uuid) to authenticated;
grant execute on function public.list_rubber_approval_groups() to authenticated;
grant execute on function public.create_rubber_approval_group(uuid[], integer, numeric) to authenticated;
grant execute on function public.update_rubber_approval_group(uuid, uuid[], integer, numeric) to authenticated;
grant execute on function public.delete_rubber_approval_group(uuid) to authenticated;
grant execute on function public.save_rubber_bill_date_approval_setting(boolean) to authenticated;

alter table public.rubber_bill_approval_requests
  add column approval_group_id_snapshot uuid;
alter table public.rubber_bill_approval_requests
  alter column edit_window_minutes_snapshot drop not null;
alter table public.rubber_bill_approval_requests
  drop constraint rubber_bill_approval_requests_edit_window_snapshot_check;
alter table public.rubber_bill_approval_requests
  add constraint rubber_bill_approval_requests_edit_window_snapshot_check
  check (edit_window_minutes_snapshot is null or edit_window_minutes_snapshot >= 0);

-- Preserve the battle-tested approval dispatcher and change only its setting
-- source and snapshots. Exact replacements make schema drift fail the migration.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'private.sync_rubber_bill_approval_20260805020000(jsonb)'::regprocedure
  ) into v_definition;

  v_definition := replace(
    v_definition,
    'sync_rubber_bill_approval_20260805020000',
    'sync_rubber_bill_approval_20260823010000'
  );
  v_definition := replace(
    v_definition,
    '  v_settings public.rubber_bill_approval_settings%rowtype;',
    E'  v_group_id uuid;\n  v_edit_window_minutes integer;\n  v_configured_price numeric;\n  v_price_time_exempt boolean := true;'
  );
  v_definition := replace(
    v_definition,
    E'  select *\n    into v_settings\n  from public.rubber_bill_approval_settings\n  where id = true;',
    E'  select effective.group_id, effective.price_time_exempt,\n         effective.edit_window_minutes, effective.configured_price\n    into v_group_id, v_price_time_exempt, v_edit_window_minutes, v_configured_price\n  from private.effective_rubber_approval_settings(v_location_id) effective;\n\n  if v_price_time_exempt then\n    payload := jsonb_set(payload, ''{configuredPriceSnapshot}'', ''null''::jsonb, true);\n  end if;'
  );
  v_definition := replace(v_definition, 'v_settings.configured_price', 'v_configured_price');
  v_definition := replace(
    v_definition,
    'if clock_timestamp() >= v_bill.created_at + make_interval(mins => v_settings.edit_window_minutes) then',
    'if not v_price_time_exempt and clock_timestamp() >= v_bill.created_at + make_interval(mins => v_edit_window_minutes) then'
  );
  v_definition := replace(
    v_definition,
    E'    edit_window_minutes_snapshot,\n    original_payload,',
    E'    edit_window_minutes_snapshot,\n    approval_group_id_snapshot,\n    original_payload,'
  );
  v_definition := replace(
    v_definition,
    E'    v_settings.edit_window_minutes,\n    v_original_payload,',
    E'    v_edit_window_minutes,\n    v_group_id,\n    v_original_payload,'
  );

  if position('sync_rubber_bill_approval_20260805020000' in v_definition) > 0
     or position('v_settings' in v_definition) > 0
     or position('approval_group_id_snapshot' in v_definition) = 0
     or position('effective_rubber_approval_settings' in v_definition) = 0 then
    raise exception 'Could not preserve Rubber Bill approval dispatcher';
  end if;
  execute v_definition;
end
$$;

revoke all on function private.sync_rubber_bill_approval_20260823010000(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_operation text := payload->>'operation';
  v_business_date date;
  v_requires_approval boolean := false;
begin
  begin
    if v_operation = 'delete' then
      select bill_date into v_business_date
      from public.rubber_bills
      where client_temp_id = payload->>'clientTempId';
    elsif v_operation in ('create', 'update') then
      v_business_date := (payload->>'billDate')::date;
    end if;
  exception when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'วันที่บิลไม่ถูกต้อง');
  end;

  select coalesce(non_current_date_requires_approval, false)
    into v_requires_approval
  from public.rubber_bill_approval_settings
  where id = true;

  if v_requires_approval
     and v_business_date is distinct from (clock_timestamp() at time zone 'Asia/Bangkok')::date then
    payload := payload || jsonb_build_object('forceNonCurrentDateApproval', true);
  end if;

  return private.sync_rubber_bill_approval_20260823010000(payload);
end
$$;

revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

notify pgrst, 'reload schema';
