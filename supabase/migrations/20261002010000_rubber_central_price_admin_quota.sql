-- One Rubber central price, per-group allowance, shared ungrouped defaults,
-- and server-authoritative per-account quota consumption.

alter table public.rubber_bill_approval_settings
  add column central_price numeric(12,2) not null default 42.00,
  add column central_price_revision bigint not null default 1,
  add column central_price_updated_by_user_id uuid references public.profiles(id),
  add column central_price_updated_by_name text not null default 'ระบบ',
  add column central_price_updated_by_phone text,
  add column central_price_updated_at timestamptz not null default now(),
  add column ungrouped_price_allowance numeric(12,2) not null default 0,
  add column ungrouped_edit_window_minutes integer not null default 30,
  add column ungrouped_revision bigint not null default 1,
  add column ungrouped_updated_by_user_id uuid references public.profiles(id),
  add column ungrouped_updated_by_name text not null default 'ระบบ',
  add column ungrouped_updated_by_phone text,
  add column ungrouped_updated_at timestamptz not null default now(),
  add column quota_limit_per_admin integer not null default 0,
  add column quota_round_id uuid not null default gen_random_uuid(),
  add column quota_updated_by_user_id uuid references public.profiles(id),
  add column quota_updated_by_name text not null default 'ระบบ',
  add column quota_updated_by_phone text,
  add column quota_updated_at timestamptz not null default now(),
  add column price_rule_revision bigint not null default 1,
  add constraint rubber_bill_approval_central_price_check
    check (central_price > 0 and scale(central_price) <= 2),
  add constraint rubber_bill_approval_ungrouped_allowance_check
    check (ungrouped_price_allowance >= 0 and scale(ungrouped_price_allowance) <= 2),
  add constraint rubber_bill_approval_ungrouped_window_check
    check (ungrouped_edit_window_minutes >= 0),
  add constraint rubber_bill_approval_quota_limit_check
    check (quota_limit_per_admin >= 0);

alter table public.rubber_approval_groups
  add column price_allowance numeric(12,2),
  add column revision_no bigint not null default 1;

update public.rubber_approval_groups
set price_allowance = greatest(coalesce(configured_price, 42.00) - 42.00, 0);

set constraints enforce_rubber_approval_group_row_not_empty immediate;

alter table public.rubber_approval_groups
  alter column price_allowance set not null,
  add constraint rubber_approval_groups_allowance_check
    check (price_allowance >= 0 and scale(price_allowance) <= 2);

alter table public.rubber_bills
  add column central_price_snapshot numeric(12,2),
  add column price_allowance_snapshot numeric(12,2),
  add column effective_price_cap_snapshot numeric(12,2),
  add column price_rule_revision_snapshot bigint,
  add column rubber_price_rule_source text,
  add column rubber_price_quota_use_id uuid,
  add constraint rubber_bills_central_snapshot_check
    check (central_price_snapshot is null or central_price_snapshot > 0),
  add constraint rubber_bills_allowance_snapshot_check
    check (price_allowance_snapshot is null or price_allowance_snapshot >= 0),
  add constraint rubber_bills_cap_snapshot_check
    check (effective_price_cap_snapshot is null or effective_price_cap_snapshot > 0),
  add constraint rubber_bills_rule_source_check
    check (rubber_price_rule_source is null or rubber_price_rule_source in ('group', 'ungrouped'));

alter table public.rubber_bill_approval_requests
  add column central_price_snapshot numeric(12,2),
  add column price_allowance_snapshot numeric(12,2),
  add column effective_price_cap_snapshot numeric(12,2),
  add column price_rule_revision_snapshot bigint,
  add column rubber_price_rule_source text,
  add constraint rubber_bill_approval_requests_central_snapshot_check
    check (central_price_snapshot is null or central_price_snapshot > 0),
  add constraint rubber_bill_approval_requests_allowance_snapshot_check
    check (price_allowance_snapshot is null or price_allowance_snapshot >= 0),
  add constraint rubber_bill_approval_requests_cap_snapshot_check
    check (effective_price_cap_snapshot is null or effective_price_cap_snapshot > 0),
  add constraint rubber_bill_approval_requests_rule_source_check
    check (rubber_price_rule_source is null or rubber_price_rule_source in ('group', 'ungrouped'));

create table public.rubber_bill_price_quota_uses (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id),
  bangkok_business_date date not null,
  quota_round_id uuid not null,
  operation_key text not null,
  operation text not null check (operation in ('create', 'update')),
  bill_id uuid not null references public.rubber_bills(id),
  bill_revision_no integer not null check (bill_revision_no > 0),
  created_at timestamptz not null default now(),
  unique (actor_user_id, operation_key)
);

create index rubber_bill_price_quota_uses_counter_idx
  on public.rubber_bill_price_quota_uses (
    actor_user_id,
    bangkok_business_date,
    quota_round_id
  );

alter table public.rubber_bills
  add constraint rubber_bills_quota_use_fk
  foreign key (rubber_price_quota_use_id)
  references public.rubber_bill_price_quota_uses(id);

alter table public.rubber_bill_price_quota_uses enable row level security;
revoke all on public.rubber_bill_price_quota_uses from public, anon, authenticated;
grant all on public.rubber_bill_price_quota_uses to service_role;

create or replace function private.can_use_rubber_bill_price_quota()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        p.role in ('admin', 'super_admin')
        or p.can_access_super_admin_features = true
      )
  )
$$;

create or replace function private.resolve_rubber_bill_price_policy(p_location_id uuid)
returns table (
  group_id uuid,
  rule_source text,
  central_price numeric,
  price_allowance numeric,
  effective_price_cap numeric,
  edit_window_minutes integer,
  price_rule_revision bigint,
  updated_by_name text,
  updated_by_phone text,
  updated_at timestamptz,
  quota_limit_per_admin integer,
  quota_round_id uuid,
  non_current_date_requires_approval boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    case when g.id is null then 'ungrouped' else 'group' end,
    s.central_price,
    coalesce(g.price_allowance, s.ungrouped_price_allowance),
    s.central_price + coalesce(g.price_allowance, s.ungrouped_price_allowance),
    coalesce(g.edit_window_minutes, s.ungrouped_edit_window_minutes),
    s.price_rule_revision,
    coalesce(g.updated_by_name, s.ungrouped_updated_by_name),
    coalesce(g.updated_by_phone, s.ungrouped_updated_by_phone),
    coalesce(g.updated_at, s.ungrouped_updated_at),
    s.quota_limit_per_admin,
    s.quota_round_id,
    s.non_current_date_requires_approval
  from public.rubber_bill_approval_settings s
  left join public.rubber_approval_group_locations gl
    on gl.location_id = p_location_id
  left join public.rubber_approval_groups g
    on g.id = gl.group_id
  where s.id = true
$$;

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
    policy.group_id,
    false,
    policy.edit_window_minutes,
    coalesce(
      nullif(current_setting('lanflow.rubber_price_cap_override', true), '')::numeric,
      policy.effective_price_cap
    ),
    policy.updated_by_name,
    policy.updated_by_phone,
    policy.updated_at
  from private.resolve_rubber_bill_price_policy(p_location_id) policy
$$;

create or replace function public.get_effective_rubber_approval_settings(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy record;
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

  select * into v_policy
  from private.resolve_rubber_bill_price_policy(p_location_id);

  return jsonb_build_object(
    'locationId', p_location_id,
    'groupId', v_policy.group_id,
    'ruleSource', v_policy.rule_source,
    'editWindowMinutes', v_policy.edit_window_minutes,
    'centralPrice', v_policy.central_price,
    'priceAllowance', v_policy.price_allowance,
    'effectivePriceCap', v_policy.effective_price_cap,
    'priceRuleRevision', v_policy.price_rule_revision,
    'nonCurrentDateRequiresApproval', v_policy.non_current_date_requires_approval,
    'updatedByName', v_policy.updated_by_name,
    'updatedByPhone', v_policy.updated_by_phone,
    'updatedAt', v_policy.updated_at
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
  v_ungrouped_location_ids jsonb;
  v_settings public.rubber_bill_approval_settings%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;

  select * into v_settings
  from public.rubber_bill_approval_settings
  where id = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', grouped.id,
    'locationIds', grouped.location_ids,
    'editWindowMinutes', grouped.edit_window_minutes,
    'priceAllowance', grouped.price_allowance,
    'revisionNo', grouped.revision_no,
    'updatedByName', grouped.updated_by_name,
    'updatedByPhone', grouped.updated_by_phone,
    'updatedAt', grouped.updated_at
  ) order by grouped.created_at, grouped.id), '[]'::jsonb)
  into v_groups
  from (
    select g.id, g.edit_window_minutes, g.price_allowance, g.revision_no,
      g.updated_by_name, g.updated_by_phone, g.created_at, g.updated_at,
      to_jsonb(array_agg(gl.location_id order by l.name, gl.location_id)) location_ids
    from public.rubber_approval_groups g
    join public.rubber_approval_group_locations gl on gl.group_id = g.id
    join public.locations l on l.id = gl.location_id
    group by g.id
  ) grouped;

  select coalesce(jsonb_agg(l.id order by l.name, l.id), '[]'::jsonb)
  into v_ungrouped_location_ids
  from public.locations l
  where l.is_active = true
    and not exists (
      select 1 from public.rubber_approval_group_locations gl
      where gl.location_id = l.id
    );

  return jsonb_build_object(
    'groups', v_groups,
    'availableLocationIds', v_ungrouped_location_ids,
    'centralPrice', jsonb_build_object(
      'value', v_settings.central_price,
      'revision', v_settings.central_price_revision,
      'updatedByName', v_settings.central_price_updated_by_name,
      'updatedByPhone', v_settings.central_price_updated_by_phone,
      'updatedAt', v_settings.central_price_updated_at
    ),
    'ungroupedDefaults', jsonb_build_object(
      'locationIds', v_ungrouped_location_ids,
      'editWindowMinutes', v_settings.ungrouped_edit_window_minutes,
      'priceAllowance', v_settings.ungrouped_price_allowance,
      'revision', v_settings.ungrouped_revision,
      'updatedByName', v_settings.ungrouped_updated_by_name,
      'updatedByPhone', v_settings.ungrouped_updated_by_phone,
      'updatedAt', v_settings.ungrouped_updated_at
    ),
    'quota', jsonb_build_object(
      'limitPerAdmin', v_settings.quota_limit_per_admin,
      'roundId', v_settings.quota_round_id,
      'updatedByName', v_settings.quota_updated_by_name,
      'updatedByPhone', v_settings.quota_updated_by_phone,
      'updatedAt', v_settings.quota_updated_at
    )
  );
end
$$;

create or replace function private.validate_rubber_price_allowance(p_price_allowance numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_price_allowance is null then return 0; end if;
  if p_price_allowance < 0 or scale(p_price_allowance) > 2 then
    raise exception 'RUBBER_ALLOWANCE_INVALID: ส่วนต่างราคาต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;
  return p_price_allowance;
end
$$;

create or replace function private.validate_rubber_effective_price_cap(
  p_central_price numeric,
  p_price_allowance numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_effective_price_cap numeric := p_central_price + p_price_allowance;
begin
  if v_effective_price_cap > 9999999999.99 then
    raise exception 'RUBBER_EFFECTIVE_PRICE_CAP_INVALID: ราคากลางรวมส่วนต่างต้องไม่เกิน 9,999,999,999.99 บาท';
  end if;
  return v_effective_price_cap;
end
$$;

create or replace function public.save_rubber_central_price(
  p_central_price numeric,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_actor public.profiles%rowtype;
  v_max_allowance numeric;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์ตั้งราคากลางยาง';
  end if;
  if p_central_price is null or p_central_price <= 0 or scale(p_central_price) > 2 then
    raise exception 'RUBBER_CENTRAL_PRICE_INVALID: ราคากลางต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_settings
  from public.rubber_bill_approval_settings where id = true for update;
  if v_settings.central_price_revision <> p_expected_revision then
    raise exception 'RUBBER_CENTRAL_PRICE_STALE: ราคากลางถูกแก้ไขโดยผู้ใช้อื่น';
  end if;
  select greatest(
    v_settings.ungrouped_price_allowance,
    coalesce(max(g.price_allowance), 0)
  ) into v_max_allowance
  from public.rubber_approval_groups g;
  perform private.validate_rubber_effective_price_cap(p_central_price, v_max_allowance);
  if v_settings.central_price = p_central_price then
    return public.list_rubber_approval_groups();
  end if;
  select * into v_actor from public.profiles p where p.id = auth.uid();
  update public.rubber_bill_approval_settings
  set central_price = p_central_price,
      central_price_revision = central_price_revision + 1,
      central_price_updated_by_user_id = auth.uid(),
      central_price_updated_by_name = v_actor.name,
      central_price_updated_by_phone = v_actor.phone,
      central_price_updated_at = clock_timestamp(),
      price_rule_revision = price_rule_revision + 1
  where id = true;
  update public.rubber_approval_groups
  set configured_price = p_central_price + price_allowance
  where true;
  return public.list_rubber_approval_groups();
end
$$;

create or replace function public.save_rubber_ungrouped_defaults(
  p_edit_window_minutes integer,
  p_price_allowance numeric,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_actor public.profiles%rowtype;
  v_allowance numeric;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์ตั้งค่ากลุ่มเริ่มต้น';
  end if;
  v_allowance := private.validate_rubber_price_allowance(p_price_allowance);
  if p_edit_window_minutes is null or p_edit_window_minutes < 0 then
    raise exception 'RUBBER_EDIT_WINDOW_INVALID: จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_settings
  from public.rubber_bill_approval_settings where id = true for update;
  if v_settings.ungrouped_revision <> p_expected_revision then
    raise exception 'RUBBER_UNGROUPED_STALE: ค่ากลุ่มเริ่มต้นถูกแก้ไขโดยผู้ใช้อื่น';
  end if;
  perform private.validate_rubber_effective_price_cap(v_settings.central_price, v_allowance);
  if v_settings.ungrouped_edit_window_minutes = p_edit_window_minutes
     and v_settings.ungrouped_price_allowance = v_allowance then
    return public.list_rubber_approval_groups();
  end if;
  select * into v_actor from public.profiles p where p.id = auth.uid();
  update public.rubber_bill_approval_settings
  set ungrouped_edit_window_minutes = p_edit_window_minutes,
      ungrouped_price_allowance = v_allowance,
      ungrouped_revision = ungrouped_revision + 1,
      ungrouped_updated_by_user_id = auth.uid(),
      ungrouped_updated_by_name = v_actor.name,
      ungrouped_updated_by_phone = v_actor.phone,
      ungrouped_updated_at = clock_timestamp(),
      price_rule_revision = price_rule_revision + 1
  where id = true;
  return public.list_rubber_approval_groups();
end
$$;

create or replace function public.save_rubber_admin_quota(
  p_quota_limit integer,
  p_expected_round_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_actor public.profiles%rowtype;
begin
  if not private.is_active_user() or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true and p.role = 'super_admin'
  ) then
    raise exception 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งโควต้าได้';
  end if;
  if p_quota_limit is null or p_quota_limit < 0 then
    raise exception 'RUBBER_QUOTA_INVALID: จำนวนโควต้าต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_settings
  from public.rubber_bill_approval_settings where id = true for update;
  if v_settings.quota_round_id <> p_expected_round_id then
    raise exception 'RUBBER_QUOTA_STALE: การตั้งค่าโควต้าถูกแก้ไขโดยผู้ใช้อื่น';
  end if;
  select * into v_actor from public.profiles p where p.id = auth.uid();
  update public.rubber_bill_approval_settings
  set quota_limit_per_admin = p_quota_limit,
      quota_round_id = gen_random_uuid(),
      quota_updated_by_user_id = auth.uid(),
      quota_updated_by_name = v_actor.name,
      quota_updated_by_phone = v_actor.phone,
      quota_updated_at = clock_timestamp()
  where id = true;
  return public.list_rubber_approval_groups();
end
$$;

create or replace function private.validate_rubber_approval_group_v2_input(
  p_location_ids uuid[],
  p_edit_window_minutes integer,
  p_price_allowance numeric
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
begin
  if p_location_ids is null or cardinality(p_location_ids) = 0 then
    raise exception 'RUBBER_GROUP_EMPTY: ต้องเลือกสาขาอย่างน้อยหนึ่งสาขา';
  end if;
  select array_agg(id order by id) into v_location_ids
  from (select distinct unnest(p_location_ids) id) selected;
  if cardinality(v_location_ids) <> cardinality(p_location_ids) then
    raise exception 'RUBBER_GROUP_DUPLICATE_BRANCH: ห้ามเลือกสาขาซ้ำ';
  end if;
  if exists (
    select 1 from unnest(v_location_ids) selected(id)
    left join public.locations l on l.id = selected.id and l.is_active = true
    where l.id is null
  ) then
    raise exception 'RUBBER_GROUP_INVALID_BRANCH: พบสาขาที่ไม่พร้อมใช้งาน';
  end if;
  if p_edit_window_minutes is null or p_edit_window_minutes < 0 then
    raise exception 'RUBBER_EDIT_WINDOW_INVALID: จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  perform private.validate_rubber_price_allowance(p_price_allowance);
  return v_location_ids;
end
$$;

create or replace function public.create_rubber_approval_group_v2(
  p_location_ids uuid[],
  p_edit_window_minutes integer,
  p_price_allowance numeric
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
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_allowance numeric;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;
  v_allowance := private.validate_rubber_price_allowance(p_price_allowance);
  v_location_ids := private.validate_rubber_approval_group_v2_input(
    p_location_ids, p_edit_window_minutes, v_allowance
  );
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  if exists (
    select 1 from public.rubber_approval_group_locations gl
    where gl.location_id = any(v_location_ids)
  ) then
    raise exception 'RUBBER_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
  end if;
  select * into v_actor from public.profiles p where p.id = auth.uid();
  select * into v_settings
  from public.rubber_bill_approval_settings where id = true for update;
  perform private.validate_rubber_effective_price_cap(v_settings.central_price, v_allowance);

  insert into public.rubber_approval_groups (
    edit_window_minutes, configured_price, price_allowance,
    updated_by_user_id, updated_by_name, updated_by_phone, updated_at
  ) values (
    p_edit_window_minutes, v_settings.central_price + v_allowance, v_allowance,
    auth.uid(), v_actor.name, v_actor.phone, v_now
  ) returning * into v_group;

  insert into public.rubber_approval_group_locations (group_id, location_id)
  select v_group.id, location_id from unnest(v_location_ids) location_id;

  update public.rubber_bill_approval_settings
  set ungrouped_revision = ungrouped_revision + 1,
      ungrouped_updated_by_user_id = auth.uid(),
      ungrouped_updated_by_name = v_actor.name,
      ungrouped_updated_by_phone = v_actor.phone,
      ungrouped_updated_at = v_now,
      price_rule_revision = price_rule_revision + 1
  where id = true;

  return jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id,
      'locationIds', to_jsonb(v_location_ids),
      'editWindowMinutes', v_group.edit_window_minutes,
      'priceAllowance', v_group.price_allowance,
      'revisionNo', v_group.revision_no,
      'updatedByName', v_group.updated_by_name,
      'updatedByPhone', v_group.updated_by_phone,
      'updatedAt', v_group.updated_at
    ),
    'affectedLocationIds', to_jsonb(v_location_ids)
  );
end
$$;

create or replace function public.update_rubber_approval_group_v2(
  p_group_id uuid,
  p_location_ids uuid[],
  p_edit_window_minutes integer,
  p_price_allowance numeric,
  p_expected_revision bigint,
  p_expected_source_revisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_old_location_ids uuid[];
  v_affected_location_ids uuid[];
  v_source_group_ids uuid[];
  v_group public.rubber_approval_groups%rowtype;
  v_actor public.profiles%rowtype;
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_allowance numeric;
  v_membership_changed boolean;
  v_ungrouped_changed boolean := false;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;
  v_allowance := private.validate_rubber_price_allowance(p_price_allowance);
  v_location_ids := private.validate_rubber_approval_group_v2_input(
    p_location_ids, p_edit_window_minutes, v_allowance
  );
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_group
  from public.rubber_approval_groups g
  where g.id = p_group_id for update;
  if v_group.id is null then
    raise exception 'RUBBER_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;
  if v_group.revision_no <> p_expected_revision then
    raise exception 'RUBBER_GROUP_STALE: กลุ่มถูกแก้ไขโดยผู้ใช้อื่น';
  end if;

  select array_agg(gl.location_id order by gl.location_id)
  into v_old_location_ids
  from public.rubber_approval_group_locations gl
  where gl.group_id = p_group_id;
  v_old_location_ids := coalesce(v_old_location_ids, array[]::uuid[]);
  v_membership_changed := v_old_location_ids is distinct from v_location_ids;
  v_ungrouped_changed := v_membership_changed and (
    exists (
      select 1 from unnest(v_old_location_ids) id
      where not (id = any(v_location_ids))
    )
    or exists (
      select 1 from unnest(v_location_ids) id
      where not (id = any(v_old_location_ids))
        and not exists (
          select 1 from public.rubber_approval_group_locations gl
          where gl.location_id = id
        )
    )
  );

  if not v_membership_changed
     and v_group.edit_window_minutes = p_edit_window_minutes
     and v_group.price_allowance = v_allowance then
    return jsonb_build_object(
      'group', jsonb_build_object(
        'id', v_group.id,
        'locationIds', to_jsonb(v_old_location_ids),
        'editWindowMinutes', v_group.edit_window_minutes,
        'priceAllowance', v_group.price_allowance,
        'revisionNo', v_group.revision_no,
        'updatedByName', v_group.updated_by_name,
        'updatedByPhone', v_group.updated_by_phone,
        'updatedAt', v_group.updated_at
      ),
      'affectedLocationIds', '[]'::jsonb
    );
  end if;

  select array_agg(distinct gl.group_id)
  into v_source_group_ids
  from public.rubber_approval_group_locations gl
  where gl.location_id = any(v_location_ids)
    and gl.group_id <> p_group_id;

  if exists (
    select 1
    from public.rubber_approval_groups source_group
    where source_group.id = any(coalesce(v_source_group_ids, array[]::uuid[]))
      and not case
        when jsonb_typeof(coalesce(p_expected_source_revisions, '{}'::jsonb) -> source_group.id::text) = 'number'
          then (coalesce(p_expected_source_revisions, '{}'::jsonb) ->> source_group.id::text)::numeric
            = source_group.revision_no
        else false
      end
  ) then
    raise exception 'RUBBER_GROUP_STALE: กลุ่มต้นทางถูกแก้ไขโดยผู้ใช้อื่น';
  end if;

  if exists (
    select 1
    from unnest(coalesce(v_source_group_ids, array[]::uuid[])) source(group_id)
    where not exists (
      select 1
      from public.rubber_approval_group_locations gl
      where gl.group_id = source.group_id
        and not (gl.location_id = any(v_location_ids))
    )
  ) then
    raise exception 'RUBBER_GROUP_EMPTY: ย้ายสมาชิกสุดท้ายไม่ได้ กรุณาลบกลุ่มต้นทาง';
  end if;

  select array_agg(distinct id order by id)
  into v_affected_location_ids
  from (
    select unnest(v_old_location_ids) id
    union
    select unnest(v_location_ids) id
    union
    select gl.location_id
    from public.rubber_approval_group_locations gl
    where gl.group_id = any(coalesce(v_source_group_ids, array[]::uuid[]))
  ) affected;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  select * into v_settings
  from public.rubber_bill_approval_settings where id = true for update;
  perform private.validate_rubber_effective_price_cap(v_settings.central_price, v_allowance);

  delete from public.rubber_approval_group_locations gl
  where gl.location_id = any(v_location_ids)
    and gl.group_id <> p_group_id;
  delete from public.rubber_approval_group_locations gl
  where gl.group_id = p_group_id
    and not (gl.location_id = any(v_location_ids));
  insert into public.rubber_approval_group_locations (group_id, location_id)
  select p_group_id, id from unnest(v_location_ids) id
  on conflict (location_id) do nothing;

  if v_source_group_ids is not null then
    update public.rubber_approval_groups
    set revision_no = revision_no + 1,
        updated_by_user_id = auth.uid(),
        updated_by_name = v_actor.name,
        updated_by_phone = v_actor.phone,
        updated_at = v_now
    where id = any(v_source_group_ids);
  end if;

  update public.rubber_approval_groups
  set edit_window_minutes = p_edit_window_minutes,
      configured_price = v_settings.central_price + v_allowance,
      price_allowance = v_allowance,
      revision_no = revision_no + 1,
      updated_by_user_id = auth.uid(),
      updated_by_name = v_actor.name,
      updated_by_phone = v_actor.phone,
      updated_at = v_now
  where id = p_group_id
  returning * into v_group;

  if v_ungrouped_changed then
    update public.rubber_bill_approval_settings
    set ungrouped_revision = ungrouped_revision + 1,
        ungrouped_updated_by_user_id = auth.uid(),
        ungrouped_updated_by_name = v_actor.name,
        ungrouped_updated_by_phone = v_actor.phone,
        ungrouped_updated_at = v_now
    where id = true;
  end if;

  update public.rubber_bill_approval_settings
  set price_rule_revision = price_rule_revision + 1
  where id = true;

  return jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id,
      'locationIds', to_jsonb(v_location_ids),
      'editWindowMinutes', v_group.edit_window_minutes,
      'priceAllowance', v_group.price_allowance,
      'revisionNo', v_group.revision_no,
      'updatedByName', v_group.updated_by_name,
      'updatedByPhone', v_group.updated_by_phone,
      'updatedAt', v_group.updated_at
    ),
    'affectedLocationIds', to_jsonb(v_affected_location_ids)
  );
end
$$;

create or replace function public.delete_rubber_approval_group_v2(
  p_group_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.rubber_approval_groups%rowtype;
  v_location_ids uuid[];
  v_actor public.profiles%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_group
  from public.rubber_approval_groups g
  where g.id = p_group_id for update;
  if v_group.id is null then
    raise exception 'RUBBER_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;
  if v_group.revision_no <> p_expected_revision then
    raise exception 'RUBBER_GROUP_STALE: กลุ่มถูกแก้ไขโดยผู้ใช้อื่น';
  end if;
  select array_agg(gl.location_id order by gl.location_id)
  into v_location_ids
  from public.rubber_approval_group_locations gl
  where gl.group_id = p_group_id;
  select * into v_actor from public.profiles p where p.id = auth.uid();
  delete from public.rubber_approval_groups where id = p_group_id;
  update public.rubber_bill_approval_settings
  set ungrouped_revision = ungrouped_revision + 1,
      ungrouped_updated_by_user_id = auth.uid(),
      ungrouped_updated_by_name = v_actor.name,
      ungrouped_updated_by_phone = v_actor.phone,
      ungrouped_updated_at = v_now,
      price_rule_revision = price_rule_revision + 1
  where id = true;
  return jsonb_build_object(
    'success', true,
    'releasedLocationIds', to_jsonb(coalesce(v_location_ids, array[]::uuid[]))
  );
end
$$;

create or replace function private.rubber_bill_submission_decision(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_operation text;
  v_location_id uuid;
  v_bill public.rubber_bills%rowtype;
  v_policy record;
  v_proposed_prices jsonb := '[]'::jsonb;
  v_current_prices jsonb := '[]'::jsonb;
  v_max_price numeric;
  v_price_changed boolean := false;
  v_business_date date;
  v_non_price_approval boolean := false;
  v_used_count integer := 0;
  v_remaining integer := 0;
  v_fingerprint text;
begin
  v_operation := payload->>'operation';
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;
  if v_operation is null or v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Invalid operation');
  end if;
  begin
    v_location_id := (payload->>'locationId')::uuid;
  exception when others then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Invalid approval payload');
  end;
  if v_location_id is null
     or coalesce(payload->>'clientTempId', '') = ''
     or coalesce(payload->>'idempotencyKey', '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;
  begin
    v_payload := private.normalize_rubber_bill_calculation_payload(payload);
  exception
    when raise_exception then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', sqlerrm);
    when others then
      return jsonb_build_object(
        'disposition', 'failed',
        'errorMessage', 'ข้อมูลตัวเลขในบิลยางไม่ถูกต้อง'
      );
  end;
  select * into v_policy
  from private.resolve_rubber_bill_price_policy(v_location_id);
  if v_policy.central_price is null then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'ไม่พบกติกาบิลยาง');
  end if;

  if v_operation = 'delete' then
    select * into v_bill
    from public.rubber_bills b
    where b.client_temp_id = v_payload->>'clientTempId';
    if v_bill.id is null then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Cannot delete non-existent record');
    end if;
    if v_bill.location_id <> v_location_id then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Location mismatch');
    end if;
    v_business_date := v_bill.bill_date;
  elsif v_operation = 'update' then
    select * into v_bill
    from public.rubber_bills b
    where b.client_temp_id = v_payload->>'clientTempId';
    if v_bill.id is null then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Cannot update non-existent record');
    end if;
    if v_bill.location_id <> v_location_id then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Location mismatch');
    end if;
    begin
      v_business_date := (v_payload->>'billDate')::date;
    exception when others then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'วันที่บิลไม่ถูกต้อง');
    end;
  else
    begin
      v_business_date := (v_payload->>'billDate')::date;
    exception when others then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'วันที่บิลไม่ถูกต้อง');
    end;
  end if;

  if v_bill.id is not null then
    if private.active_report_no('rubber_bill', v_bill.id) is not null then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'บิลอยู่ในรายงานแล้ว จึงดำเนินการไม่ได้');
    end if;
    if private.rubber_bill_has_active_transfer(v_bill.id) then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'บิลอยู่ในรายการโอนเงินแล้ว จึงดำเนินการไม่ได้');
    end if;
    if clock_timestamp() >= v_bill.created_at
       + make_interval(mins => v_policy.edit_window_minutes) then
      v_non_price_approval := true;
    end if;
  end if;
  if v_policy.non_current_date_requires_approval
     and v_business_date is distinct from
       (clock_timestamp() at time zone 'Asia/Bangkok')::date then
    v_non_price_approval := true;
  end if;

  if v_operation in ('create', 'update') then
    select
      coalesce(jsonb_agg((item->>'unitPrice')::numeric order by (item->>'sequenceNo')::integer), '[]'::jsonb),
      max((item->>'unitPrice')::numeric)
    into v_proposed_prices, v_max_price
    from jsonb_array_elements(coalesce(v_payload->'items', '[]'::jsonb)) item
    where item->>'itemType' = 'weigh';
  end if;

  if v_operation = 'create' then
    v_price_changed := true;
  elsif v_operation = 'update' then
    select coalesce(jsonb_agg(i.price order by i.sequence_no), '[]'::jsonb)
    into v_current_prices
    from public.rubber_bill_items i
    where i.bill_id = v_bill.id and i.item_type = 'weigh';
    v_price_changed := v_current_prices is distinct from v_proposed_prices;
  end if;

  if v_non_price_approval then
    return jsonb_build_object(
      'disposition', 'approval_required',
      'priceDecision', 'not_applicable',
      'priceChanged', v_price_changed,
      'centralPrice', v_policy.central_price,
      'priceAllowance', v_policy.price_allowance,
      'effectivePriceCap', v_policy.effective_price_cap,
      'priceRuleRevision', v_policy.price_rule_revision,
      'quotaRoundId', v_policy.quota_round_id,
      'ruleSource', v_policy.rule_source,
      'maxPrice', v_max_price
    );
  end if;

  if not v_price_changed or v_max_price is null or v_max_price <= v_policy.central_price then
    return jsonb_build_object(
      'disposition', 'direct',
      'priceDecision', case when v_price_changed then 'within_central' else 'unchanged' end,
      'priceChanged', v_price_changed,
      'centralPrice', v_policy.central_price,
      'priceAllowance', v_policy.price_allowance,
      'effectivePriceCap', v_policy.effective_price_cap,
      'priceRuleRevision', v_policy.price_rule_revision,
      'quotaRoundId', v_policy.quota_round_id,
      'ruleSource', v_policy.rule_source,
      'maxPrice', v_max_price
    );
  end if;

  if v_max_price > v_policy.effective_price_cap then
    return jsonb_build_object(
      'disposition', 'approval_required',
      'priceDecision', 'above_cap',
      'priceChanged', true,
      'centralPrice', v_policy.central_price,
      'priceAllowance', v_policy.price_allowance,
      'effectivePriceCap', v_policy.effective_price_cap,
      'priceRuleRevision', v_policy.price_rule_revision,
      'quotaRoundId', v_policy.quota_round_id,
      'ruleSource', v_policy.rule_source,
      'maxPrice', v_max_price
    );
  end if;

  if not private.can_use_rubber_bill_price_quota()
     or v_policy.quota_limit_per_admin <= 0 then
    return jsonb_build_object(
      'disposition', 'approval_required',
      'priceDecision', 'quota_unavailable',
      'priceChanged', true,
      'centralPrice', v_policy.central_price,
      'priceAllowance', v_policy.price_allowance,
      'effectivePriceCap', v_policy.effective_price_cap,
      'priceRuleRevision', v_policy.price_rule_revision,
      'quotaRoundId', v_policy.quota_round_id,
      'ruleSource', v_policy.rule_source,
      'maxPrice', v_max_price,
      'remainingAfterConfirm', 0
    );
  end if;

  select count(*)::integer into v_used_count
  from public.rubber_bill_price_quota_uses q
  where q.actor_user_id = auth.uid()
    and q.bangkok_business_date = (clock_timestamp() at time zone 'Asia/Bangkok')::date
    and q.quota_round_id = v_policy.quota_round_id;
  v_remaining := greatest(v_policy.quota_limit_per_admin - v_used_count, 0);

  if v_remaining = 0 then
    return jsonb_build_object(
      'disposition', 'approval_required',
      'priceDecision', 'quota_exhausted',
      'priceChanged', true,
      'centralPrice', v_policy.central_price,
      'priceAllowance', v_policy.price_allowance,
      'effectivePriceCap', v_policy.effective_price_cap,
      'priceRuleRevision', v_policy.price_rule_revision,
      'quotaRoundId', v_policy.quota_round_id,
      'ruleSource', v_policy.rule_source,
      'maxPrice', v_max_price,
      'remainingAfterConfirm', 0
    );
  end if;

  v_fingerprint := md5(concat_ws('|',
    auth.uid()::text,
    v_location_id::text,
    v_operation,
    v_payload->>'idempotencyKey',
    v_proposed_prices::text,
    v_policy.central_price::text,
    v_policy.price_allowance::text,
    v_policy.effective_price_cap::text,
    v_policy.price_rule_revision::text,
    v_policy.quota_round_id::text,
    v_remaining::text
  ));

  return jsonb_build_object(
    'disposition', 'quota_confirmation_required',
    'priceDecision', 'quota_available',
    'priceChanged', true,
    'centralPrice', v_policy.central_price,
    'priceAllowance', v_policy.price_allowance,
    'effectivePriceCap', v_policy.effective_price_cap,
    'priceRuleRevision', v_policy.price_rule_revision,
    'quotaRoundId', v_policy.quota_round_id,
    'decisionFingerprint', v_fingerprint,
    'ruleSource', v_policy.rule_source,
    'maxPrice', v_max_price,
    'remainingAfterConfirm', v_remaining - 1
  );
exception when others then
  return jsonb_build_object(
    'disposition', 'failed',
    'errorMessage', 'ตรวจสอบกติกาบิลยางไม่สำเร็จ'
  );
end
$$;

create or replace function public.preview_rubber_bill_submission(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.rubber_bill_submission_decision(payload);
end
$$;

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := payload->>'operation';
  v_business_date date;
  v_requires_approval boolean := false;
  v_submission_mode text := coalesce(payload->>'submissionMode', 'replay');
  v_decision jsonb;
  v_confirmation jsonb := payload->'quotaConfirmation';
  v_reservation jsonb;
  v_result jsonb;
  v_force_price_approval boolean := false;
  v_use_quota boolean := false;
  v_quota_use_id uuid;
  v_existing_quota_use public.rubber_bill_price_quota_uses%rowtype;
  v_bill_id uuid;
  v_bill_revision integer;
  v_request_id uuid;
  v_location_id uuid;
  v_expected_revision integer;
  v_existing_bill public.rubber_bills%rowtype;
  v_existing_request public.rubber_bill_approval_requests%rowtype;
  v_fallback_message text;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;
  if v_operation is null or v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;
  begin
    v_location_id := (payload->>'locationId')::uuid;
    v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  exception when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid approval payload');
  end;
  if v_location_id is null
     or v_expected_revision is null
     or v_expected_revision < 0
     or coalesce(payload->>'clientTempId', '') = ''
     or coalesce(payload->>'idempotencyKey', '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;

  -- Idempotent retries are identity lookups, not new policy decisions. This must
  -- run before report/relation/time guards so a successful request can be retried.
  select * into v_existing_bill
  from public.rubber_bills b
  where b.client_temp_id = payload->>'clientTempId'
    and b.location_id = v_location_id
    and b.idempotency_key = payload->>'idempotencyKey';
  if v_existing_bill.id is not null then
    if not (
      (v_operation = 'create'
        and v_expected_revision = 0
        and v_existing_bill.revision_no = 1
        and v_existing_bill.record_status = 'active')
      or (v_operation = 'update'
        and v_existing_bill.revision_no > 1
        and v_expected_revision = v_existing_bill.revision_no - 1
        and v_existing_bill.record_status = 'active')
      or (v_operation = 'delete'
        and v_existing_bill.revision_no > 1
        and v_expected_revision = v_existing_bill.revision_no - 1
        and v_existing_bill.record_status = 'deleted')
    ) then
      return jsonb_build_object(
        'status', 'conflict',
        'errorMessage', 'Idempotency key operation mismatch'
      );
    end if;
    select q.* into v_existing_quota_use
    from public.rubber_bill_price_quota_uses q
    where q.actor_user_id = auth.uid()
      and q.operation_key = payload->>'idempotencyKey'
      and q.operation = v_operation
      and q.bill_id = v_existing_bill.id
      and q.bill_revision_no = v_existing_bill.revision_no;
    return jsonb_strip_nulls(jsonb_build_object(
      'status', 'synced',
      'id', v_existing_bill.id,
      'serverBillNo', v_existing_bill.server_bill_no,
      'revisionNo', v_existing_bill.revision_no,
      'serverReceivedAt', v_existing_bill.server_received_at,
      'quotaConsumed', case when v_existing_quota_use.id is not null then true else null end
    ));
  end if;

  select * into v_existing_request
  from public.rubber_bill_approval_requests r
  where r.client_temp_id = payload->>'clientTempId'
    and r.location_id = v_location_id
    and r.idempotency_key = payload->>'idempotencyKey'
  order by r.requested_at
  limit 1;
  if v_existing_request.id is not null
     and (v_existing_request.operation is distinct from v_operation
       or v_existing_request.base_revision_no is distinct from v_expected_revision) then
    return jsonb_build_object(
      'status', 'conflict',
      'errorMessage', 'Idempotency key operation mismatch'
    );
  end if;

  if v_operation = 'create' then
    if v_existing_request.id is not null then
      if v_existing_request.request_status = 'approved'
         and v_existing_request.created_bill_id is not null then
        select * into v_existing_bill
        from public.rubber_bills b
        where b.id = v_existing_request.created_bill_id;
        if v_existing_bill.id is not null then
          return jsonb_build_object(
            'status', 'synced',
            'id', v_existing_bill.id,
            'serverBillNo', v_existing_bill.server_bill_no,
            'revisionNo', v_existing_bill.revision_no,
            'serverReceivedAt', v_existing_bill.server_received_at
          );
        end if;
      end if;
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_existing_request.id,
        'operation', v_operation,
        'clientTempId', payload->>'clientTempId'
      );
    end if;
  end if;

  -- The bill stores only its latest mutation key, while the quota ledger keeps
  -- the original price-operation key. Preserve retries for that same bill, but
  -- never let the historical key authorize a different bill or operation.
  select q.* into v_existing_quota_use
  from public.rubber_bill_price_quota_uses q
  where q.actor_user_id = auth.uid()
    and q.operation_key = payload->>'idempotencyKey';
  if v_existing_quota_use.id is not null then
    select * into v_existing_bill
    from public.rubber_bills b
    where b.id = v_existing_quota_use.bill_id;
    if v_existing_bill.id is not null
       and v_existing_bill.client_temp_id = payload->>'clientTempId'
       and v_existing_bill.location_id = v_location_id
       and v_existing_quota_use.operation = v_operation
       and (
         (v_operation = 'create'
           and v_expected_revision = 0
           and v_existing_quota_use.bill_revision_no = 1)
         or (v_operation in ('update', 'delete')
           and v_existing_quota_use.bill_revision_no > 1
           and v_expected_revision = v_existing_quota_use.bill_revision_no - 1)
       ) then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_existing_bill.id,
        'serverBillNo', v_existing_bill.server_bill_no,
        'revisionNo', v_existing_bill.revision_no,
        'serverReceivedAt', v_existing_bill.server_received_at,
        'quotaConsumed', true
      );
    end if;
    return jsonb_build_object(
      'status', 'conflict',
      'errorMessage', 'Idempotency key already exists'
    );
  end if;

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
     and v_business_date is distinct from
       (clock_timestamp() at time zone 'Asia/Bangkok')::date then
    payload := payload || jsonb_build_object('forceNonCurrentDateApproval', true);
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('rubber-approval-policy', 0));
  v_decision := private.rubber_bill_submission_decision(payload);
  if v_decision->>'disposition' = 'failed' then
    return jsonb_build_object(
      'status', 'failed',
      'errorMessage', coalesce(v_decision->>'errorMessage', 'ตรวจสอบกติกาบิลยางไม่สำเร็จ')
    );
  end if;

  if v_decision->>'disposition' = 'quota_confirmation_required' then
    if v_submission_mode = 'replay' then
      v_force_price_approval := true;
    elsif v_submission_mode <> 'interactive' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รูปแบบการส่งบิลยางไม่ถูกต้อง');
    elsif v_confirmation is null then
      return jsonb_build_object(
        'status', 'confirmation_required',
        'decision', v_decision,
        'errorMessage', 'กรุณายืนยันการใช้โควต้าราคา'
      );
    else
      perform pg_advisory_xact_lock(hashtextextended(
        concat_ws(':',
          'rubber-price-quota',
          auth.uid()::text,
          (clock_timestamp() at time zone 'Asia/Bangkok')::date::text,
          v_decision->>'quotaRoundId'
        ),
        0
      ));
      v_decision := private.rubber_bill_submission_decision(payload);
      if v_decision->>'disposition' = 'quota_confirmation_required' then
        if v_confirmation->>'priceRuleRevision' is distinct from v_decision->>'priceRuleRevision'
           or v_confirmation->>'quotaRoundId' is distinct from v_decision->>'quotaRoundId'
           or v_confirmation->>'decisionFingerprint' is distinct from v_decision->>'decisionFingerprint' then
          return jsonb_build_object(
            'status', 'rule_changed',
            'decision', v_decision,
            'errorMessage', 'กติกาหรือโควต้าเปลี่ยน กรุณาตรวจสอบและยืนยันอีกครั้ง'
          );
        end if;
        v_use_quota := true;
      elsif v_decision->>'priceDecision' = 'quota_exhausted' then
        v_force_price_approval := true;
        v_fallback_message := 'โควต้าถูกใช้ครบแล้ว รายการถูกส่งขออนุมัติ';
      end if;
    end if;
  elsif v_decision->>'priceDecision' in ('quota_unavailable', 'quota_exhausted') then
    v_force_price_approval := true;
  end if;

  if v_force_price_approval then
    perform set_config(
      'lanflow.rubber_price_cap_override',
      v_decision->>'centralPrice',
      true
    );
  end if;

  begin
    v_reservation := private.reserve_rubber_bill_ocr_source(payload);
    if v_reservation->>'status' = 'conflict' then
      return v_reservation;
    end if;
    if v_reservation->>'status' <> 'ok' then
      v_result := v_reservation;
      raise exception using errcode = 'P0002', message = 'ROLLBACK_OCR_RESERVATION';
    end if;

    v_result := private.sync_rubber_bill_approval_20260823010000(payload);
    if v_result->>'status' in ('failed', 'conflict') then
      raise exception using errcode = 'P0002', message = 'ROLLBACK_OCR_RESERVATION';
    end if;

    if v_result->>'status' = 'synced' then
      v_bill_id := (v_result->>'id')::uuid;
      v_bill_revision := (v_result->>'revisionNo')::integer;
      if v_use_quota then
        insert into public.rubber_bill_price_quota_uses (
          actor_user_id, bangkok_business_date, quota_round_id,
          operation_key, operation, bill_id, bill_revision_no
        ) values (
          auth.uid(),
          (clock_timestamp() at time zone 'Asia/Bangkok')::date,
          (v_decision->>'quotaRoundId')::uuid,
          payload->>'idempotencyKey',
          v_operation,
          v_bill_id,
          v_bill_revision
        )
        on conflict (actor_user_id, operation_key) do nothing
        returning id into v_quota_use_id;
        if v_quota_use_id is null then
          select q.* into v_existing_quota_use
          from public.rubber_bill_price_quota_uses q
          where q.actor_user_id = auth.uid()
            and q.operation_key = payload->>'idempotencyKey';
          if v_existing_quota_use.bill_id is distinct from v_bill_id
             or v_existing_quota_use.operation is distinct from v_operation
             or v_existing_quota_use.bill_revision_no is distinct from v_bill_revision then
            v_result := jsonb_build_object(
              'status', 'conflict',
              'errorMessage', 'Idempotency key already exists'
            );
            raise exception using errcode = 'P0002', message = 'ROLLBACK_QUOTA_KEY_CONFLICT';
          end if;
          v_quota_use_id := v_existing_quota_use.id;
        end if;
      end if;

      if v_operation = 'create'
         or coalesce((v_decision->>'priceChanged')::boolean, false) then
        update public.rubber_bills
        set central_price_snapshot = (v_decision->>'centralPrice')::numeric,
            price_allowance_snapshot = (v_decision->>'priceAllowance')::numeric,
            effective_price_cap_snapshot = (v_decision->>'effectivePriceCap')::numeric,
            price_rule_revision_snapshot = (v_decision->>'priceRuleRevision')::bigint,
            rubber_price_rule_source = v_decision->>'ruleSource',
            rubber_price_quota_use_id = v_quota_use_id
        where id = v_bill_id;
      end if;
    elsif v_result->>'status' = 'pending_approval' then
      v_request_id := (v_result->>'requestId')::uuid;
      update public.rubber_bill_approval_requests
      set configured_price_snapshot = (v_decision->>'effectivePriceCap')::numeric,
          central_price_snapshot = (v_decision->>'centralPrice')::numeric,
          price_allowance_snapshot = (v_decision->>'priceAllowance')::numeric,
          effective_price_cap_snapshot = (v_decision->>'effectivePriceCap')::numeric,
          price_rule_revision_snapshot = (v_decision->>'priceRuleRevision')::bigint,
          rubber_price_rule_source = v_decision->>'ruleSource'
      where id = v_request_id;
    end if;

    if v_fallback_message is not null then
      v_result := v_result || jsonb_build_object('message', v_fallback_message);
    end if;
    if v_quota_use_id is not null then
      v_result := v_result || jsonb_build_object('quotaConsumed', true);
    end if;
    return v_result;
  exception when sqlstate 'P0002' then
    return v_result;
  when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'บันทึกบิลยางไม่สำเร็จ');
  end;
end
$$;

create or replace function public.approve_rubber_bill_approval_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.rubber_bill_approval_requests%rowtype;
  v_result jsonb;
  v_actor_name text;
  v_actor_phone text;
  v_created_bill_id uuid;
  v_report_no text;
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์อนุมัติคำขอบิลยาง';
  end if;
  select * into v_request
  from public.rubber_bill_approval_requests
  where id = p_request_id for update;
  if v_request.id is null or v_request.request_status <> 'pending' then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;
  if v_request.bill_id is not null then
    perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_request.bill_id::text));
    v_report_no := private.active_report_no('rubber_bill', v_request.bill_id);
    if v_report_no is not null then
      raise exception 'บิลอยู่ในรายงาน % แล้ว จึงอนุมัติไม่ได้', v_report_no;
    end if;
    if private.rubber_bill_has_active_transfer(v_request.bill_id) then
      raise exception 'บิลอยู่ในรายการโอนเงินแล้ว จึงอนุมัติไม่ได้';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('rubber-bill-create:' || v_request.client_temp_id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request.location_id::text, 0));

  if v_request.operation = 'create'
     and v_request.proposed_payload->>'inputMethod' = 'ocr' then
    perform 1
    from public.rubber_bill_ocr_sources s
    where s.id = nullif(v_request.proposed_payload->>'ocrUploadId', '')::uuid
      and s.owner_user_id = v_request.requested_by_user_id
      and s.location_id = v_request.location_id
      and s.reserved_client_temp_id = v_request.client_temp_id
      and s.reserved_idempotency_key = v_request.idempotency_key
      and s.state = 'reserved'
    for update;
    if not found then
      raise exception 'ข้อมูลอ้างอิงรูป OCR ไม่ตรงกับคำขออนุมัติ';
    end if;
  end if;

  v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);
  if v_result->>'status' <> 'synced' then
    raise exception '%', coalesce(v_result->>'errorMessage', 'อนุมัติคำขอไม่สำเร็จ');
  end if;
  v_created_bill_id := (v_result->>'id')::uuid;
  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bills
  set created_by_user_id = case
        when v_request.operation = 'create' then v_request.requested_by_user_id
        else created_by_user_id
      end,
      created_by_name = case
        when v_request.operation = 'create' then v_request.requested_by_name
        else created_by_name
      end,
      created_by_phone = case
        when v_request.operation = 'create' then v_request.requested_by_phone
        else created_by_phone
      end,
      approval_state = 'approved',
      approved_by_name = coalesce(v_actor_name, ''),
      approval_revision_no = revision_no,
      central_price_snapshot = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.central_price_snapshot else central_price_snapshot end,
      price_allowance_snapshot = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.price_allowance_snapshot else price_allowance_snapshot end,
      effective_price_cap_snapshot = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.effective_price_cap_snapshot else effective_price_cap_snapshot end,
      price_rule_revision_snapshot = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.price_rule_revision_snapshot else price_rule_revision_snapshot end,
      rubber_price_rule_source = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.rubber_price_rule_source else rubber_price_rule_source end,
      rubber_price_quota_use_id = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then null else rubber_price_quota_use_id end
  where id = v_created_bill_id;

  update public.rubber_bill_approval_requests
  set request_status = 'approved',
      approved_by_user_id = auth.uid(),
      approved_by_name = coalesce(v_actor_name, ''),
      approved_by_phone = coalesce(v_actor_phone, ''),
      approved_at = now(),
      created_bill_id = case when operation = 'create' then v_created_bill_id else null end
  where id = p_request_id;

  return jsonb_build_object(
    'status', 'approved',
    'requestId', p_request_id,
    'operation', v_request.operation,
    'billId', v_created_bill_id,
    'syncResult', v_result
  );
end
$$;

-- The API has cut over to the revision-aware v2 RPCs below and the bounded v2
-- operational feed. Keeping superseded functions leaves duplicate policy/read
-- surfaces in the schema and makes an accidental re-grant a policy bypass.
drop function if exists public.create_rubber_approval_group(uuid[], integer, numeric);
drop function if exists public.update_rubber_approval_group(uuid, uuid[], integer, numeric);
drop function if exists public.delete_rubber_approval_group(uuid);
drop function if exists private.validate_rubber_approval_group_input(uuid[], integer, numeric);
drop function if exists public.save_rubber_bill_approval_settings(integer, numeric);
drop function if exists public.save_rubber_bill_approval_settings(integer, numeric, boolean);
drop function if exists private.sync_rubber_bill_approval_20260805020000(jsonb);
drop function if exists public.list_rubber_bill_approval_markers(uuid);
drop function if exists public.get_rubber_bill_operational_feed(uuid, text, text, text, timestamptz, uuid, integer);

revoke all on function private.can_use_rubber_bill_price_quota() from public, anon, authenticated;
revoke all on function private.resolve_rubber_bill_price_policy(uuid) from public, anon, authenticated;
revoke all on function private.validate_rubber_price_allowance(numeric) from public, anon, authenticated;
revoke all on function private.validate_rubber_effective_price_cap(numeric, numeric) from public, anon, authenticated;
revoke all on function private.validate_rubber_approval_group_v2_input(uuid[], integer, numeric)
  from public, anon, authenticated;
revoke all on function private.rubber_bill_submission_decision(jsonb) from public, anon, authenticated;

revoke all on function public.preview_rubber_bill_submission(jsonb) from public, anon;
revoke all on function public.save_rubber_central_price(numeric, bigint) from public, anon;
revoke all on function public.save_rubber_ungrouped_defaults(integer, numeric, bigint) from public, anon;
revoke all on function public.save_rubber_admin_quota(integer, uuid) from public, anon;
revoke all on function public.create_rubber_approval_group_v2(uuid[], integer, numeric) from public, anon;
revoke all on function public.update_rubber_approval_group_v2(uuid, uuid[], integer, numeric, bigint, jsonb)
  from public, anon;
revoke all on function public.delete_rubber_approval_group_v2(uuid, bigint) from public, anon;

grant execute on function public.preview_rubber_bill_submission(jsonb) to authenticated;
grant execute on function public.save_rubber_central_price(numeric, bigint) to authenticated;
grant execute on function public.save_rubber_ungrouped_defaults(integer, numeric, bigint) to authenticated;
grant execute on function public.save_rubber_admin_quota(integer, uuid) to authenticated;
grant execute on function public.create_rubber_approval_group_v2(uuid[], integer, numeric) to authenticated;
grant execute on function public.update_rubber_approval_group_v2(uuid, uuid[], integer, numeric, bigint, jsonb)
  to authenticated;
grant execute on function public.delete_rubber_approval_group_v2(uuid, bigint) to authenticated;
