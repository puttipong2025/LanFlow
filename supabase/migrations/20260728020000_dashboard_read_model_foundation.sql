-- Dashboard read-model foundation.
-- This migration creates configuration/state only. It deliberately does not
-- aggregate historical data or replace get_dashboard_overview yet.

create table public.dashboard_refresh_settings (
  id boolean primary key default true check (id = true),
  interval_minutes integer not null default 10
    check (interval_minutes between 10 and 1440),
  last_rollover_date date not null
    default ((current_timestamp at time zone 'Asia/Bangkok')::date),
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.dashboard_refresh_settings (id)
values (true);

create table public.dashboard_branch_snapshots (
  location_id uuid primary key references public.locations(id),
  status text not null default 'dirty'
    check (status in ('dirty', 'queued', 'running', 'ready', 'failed')),
  source_version bigint not null default 1 check (source_version >= 1),
  snapshot_version bigint not null default 0
    check (snapshot_version >= 0 and snapshot_version <= source_version),
  claimed_version bigint,
  summary jsonb,
  calculated_at timestamptz,
  manual_requested_at timestamptz,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (claimed_version is null or claimed_version between 1 and source_version),
  check (
    (summary is null and calculated_at is null)
    or (summary is not null and calculated_at is not null)
  )
);

create index dashboard_branch_snapshots_work_idx
  on public.dashboard_branch_snapshots(status, updated_at, location_id)
  where status in ('dirty', 'queued', 'failed');

create table public.dashboard_alert_thresholds (
  location_id uuid primary key references public.locations(id),
  purchase_average_min numeric(14,2)
    check (purchase_average_min is null or purchase_average_min >= 0),
  net_cash_min numeric(14,2) not null default 30000
    check (net_cash_min >= 0),
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dashboard_stock_alert_thresholds (
  location_id uuid not null references public.locations(id),
  product_id uuid not null references public.stock_products(id),
  minimum_balance numeric(14,2) not null check (minimum_balance >= 0),
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (location_id, product_id)
);

insert into public.dashboard_branch_snapshots (location_id)
select l.id
from public.locations l
where l.is_active = true
on conflict (location_id) do nothing;

insert into public.dashboard_alert_thresholds (location_id)
select l.id
from public.locations l
where l.is_active = true
on conflict (location_id) do nothing;

alter table public.dashboard_refresh_settings enable row level security;
alter table public.dashboard_branch_snapshots enable row level security;
alter table public.dashboard_alert_thresholds enable row level security;
alter table public.dashboard_stock_alert_thresholds enable row level security;

revoke all on
  public.dashboard_refresh_settings,
  public.dashboard_branch_snapshots,
  public.dashboard_alert_thresholds,
  public.dashboard_stock_alert_thresholds
from public, anon, authenticated;

grant all on
  public.dashboard_refresh_settings,
  public.dashboard_branch_snapshots,
  public.dashboard_alert_thresholds,
  public.dashboard_stock_alert_thresholds
to service_role;

create or replace function private.dashboard_require_manager()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
  then
    raise exception 'ไม่มีสิทธิ์จัดการ Dashboard';
  end if;
end;
$$;

revoke all on function private.dashboard_require_manager()
  from public, anon, authenticated;

create or replace function public.get_dashboard_refresh_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings public.dashboard_refresh_settings%rowtype;
begin
  perform private.dashboard_require_manager();

  select *
  into strict settings
  from public.dashboard_refresh_settings
  where id = true;

  return jsonb_build_object(
    'intervalMinutes', settings.interval_minutes,
    'updatedAt', settings.updated_at,
    'updatedByName', settings.updated_by_name
  );
end;
$$;

revoke all on function public.get_dashboard_refresh_settings()
  from public, anon;
grant execute on function public.get_dashboard_refresh_settings()
  to authenticated;

create or replace function public.save_dashboard_refresh_interval(
  p_interval_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  perform private.dashboard_require_manager();

  if p_interval_minutes is null
    or p_interval_minutes < 10
    or p_interval_minutes > 1440
  then
    raise exception 'รอบคำนวณต้องอยู่ระหว่าง 10 ถึง 1,440 นาที';
  end if;

  select p.name
  into actor_name
  from public.profiles p
  where p.id = auth.uid();

  update public.dashboard_refresh_settings
  set interval_minutes = p_interval_minutes,
      updated_by_user_id = auth.uid(),
      updated_by_name = actor_name,
      updated_at = now()
  where id = true;

  return public.get_dashboard_refresh_settings();
end;
$$;

revoke all on function public.save_dashboard_refresh_interval(integer)
  from public, anon;
grant execute on function public.save_dashboard_refresh_interval(integer)
  to authenticated;

create or replace function public.get_dashboard_snapshot(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot public.dashboard_branch_snapshots%rowtype;
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'Location access denied';
  end if;

  select *
  into snapshot
  from public.dashboard_branch_snapshots s
  where s.location_id = p_location_id;

  if snapshot.location_id is null then
    return jsonb_build_object(
      'status', 'dirty',
      'sourceVersion', 1,
      'snapshotVersion', 0,
      'summary', null,
      'calculatedAt', null,
      'manualRequestedAt', null,
      'lastError', null
    );
  end if;

  return jsonb_build_object(
    'status', snapshot.status,
    'sourceVersion', snapshot.source_version,
    'snapshotVersion', snapshot.snapshot_version,
    'summary', snapshot.summary,
    'calculatedAt', snapshot.calculated_at,
    'manualRequestedAt', snapshot.manual_requested_at,
    'lastError', snapshot.last_error
  );
end;
$$;

revoke all on function public.get_dashboard_snapshot(uuid)
  from public, anon;
grant execute on function public.get_dashboard_snapshot(uuid)
  to authenticated;

create or replace function public.queue_dashboard_refresh(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  location_active boolean;
begin
  perform private.dashboard_require_manager();

  select l.is_active
  into location_active
  from public.locations l
  where l.id = p_location_id;

  if coalesce(location_active, false) = false then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน';
  end if;

  insert into public.dashboard_branch_snapshots (
    location_id,
    status,
    source_version,
    manual_requested_at
  )
  values (
    p_location_id,
    'queued',
    1,
    now()
  )
  on conflict (location_id) do update
  set status = case
        when dashboard_branch_snapshots.status = 'running' then 'running'
        else 'queued'
      end,
      source_version = case
        when dashboard_branch_snapshots.status in ('queued', 'running')
          then dashboard_branch_snapshots.source_version
        else dashboard_branch_snapshots.source_version + 1
      end,
      manual_requested_at = case
        when dashboard_branch_snapshots.status = 'running'
          then dashboard_branch_snapshots.manual_requested_at
        else now()
      end,
      updated_at = now();

  return public.get_dashboard_snapshot(p_location_id);
end;
$$;

revoke all on function public.queue_dashboard_refresh(uuid)
  from public, anon;
grant execute on function public.queue_dashboard_refresh(uuid)
  to authenticated;

create or replace function public.get_dashboard_alert_thresholds(
  p_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  thresholds public.dashboard_alert_thresholds%rowtype;
  stock_items jsonb;
begin
  perform private.dashboard_require_manager();

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.is_active = true
  ) then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน';
  end if;

  select *
  into thresholds
  from public.dashboard_alert_thresholds t
  where t.location_id = p_location_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'productId', p.id,
        'name', p.name,
        'unit', p.unit,
        'minimumBalance', st.minimum_balance
      )
      order by p.name, p.id
    ),
    '[]'::jsonb
  )
  into stock_items
  from public.stock_products p
  left join public.dashboard_stock_alert_thresholds st
    on st.product_id = p.id
   and st.location_id = p_location_id
  where p.is_active = true;

  return jsonb_build_object(
    'locationId', p_location_id,
    'purchaseAverageMin', thresholds.purchase_average_min,
    'netCashMin', coalesce(thresholds.net_cash_min, 30000),
    'stockItems', stock_items,
    'updatedAt', thresholds.updated_at,
    'updatedByName', thresholds.updated_by_name
  );
end;
$$;

revoke all on function public.get_dashboard_alert_thresholds(uuid)
  from public, anon;
grant execute on function public.get_dashboard_alert_thresholds(uuid)
  to authenticated;

create or replace function public.save_dashboard_alert_thresholds(
  p_location_id uuid,
  p_purchase_average_min numeric,
  p_net_cash_min numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  perform private.dashboard_require_manager();

  if p_purchase_average_min < 0
    or p_net_cash_min is null
    or p_net_cash_min < 0
  then
    raise exception 'เกณฑ์แจ้งเตือนต้องไม่ติดลบ';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.is_active = true
  ) then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน';
  end if;

  select p.name
  into actor_name
  from public.profiles p
  where p.id = auth.uid();

  insert into public.dashboard_alert_thresholds (
    location_id,
    purchase_average_min,
    net_cash_min,
    updated_by_user_id,
    updated_by_name
  )
  values (
    p_location_id,
    p_purchase_average_min,
    p_net_cash_min,
    auth.uid(),
    actor_name
  )
  on conflict (location_id) do update
  set purchase_average_min = excluded.purchase_average_min,
      net_cash_min = excluded.net_cash_min,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_by_name = excluded.updated_by_name,
      updated_at = now();

  return public.get_dashboard_alert_thresholds(p_location_id);
end;
$$;

revoke all on function public.save_dashboard_alert_thresholds(uuid, numeric, numeric)
  from public, anon;
grant execute on function public.save_dashboard_alert_thresholds(uuid, numeric, numeric)
  to authenticated;

create or replace function public.save_dashboard_stock_alert_threshold(
  p_location_id uuid,
  p_product_id uuid,
  p_minimum_balance numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  perform private.dashboard_require_manager();

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.is_active = true
  ) then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน';
  end if;

  if not exists (
    select 1 from public.stock_products p
    where p.id = p_product_id and p.is_active = true
  ) then
    raise exception 'ไม่พบสินค้าที่เปิดใช้งาน';
  end if;

  if p_minimum_balance is not null and p_minimum_balance < 0 then
    raise exception 'เกณฑ์สต็อกต้องไม่ติดลบ';
  end if;

  if p_minimum_balance is null then
    delete from public.dashboard_stock_alert_thresholds
    where location_id = p_location_id
      and product_id = p_product_id;
  else
    select p.name
    into actor_name
    from public.profiles p
    where p.id = auth.uid();

    insert into public.dashboard_stock_alert_thresholds (
      location_id,
      product_id,
      minimum_balance,
      updated_by_user_id,
      updated_by_name
    )
    values (
      p_location_id,
      p_product_id,
      p_minimum_balance,
      auth.uid(),
      actor_name
    )
    on conflict (location_id, product_id) do update
    set minimum_balance = excluded.minimum_balance,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_by_name = excluded.updated_by_name,
        updated_at = now();
  end if;

  return public.get_dashboard_alert_thresholds(p_location_id);
end;
$$;

revoke all on function public.save_dashboard_stock_alert_threshold(uuid, uuid, numeric)
  from public, anon;
grant execute on function public.save_dashboard_stock_alert_threshold(uuid, uuid, numeric)
  to authenticated;
