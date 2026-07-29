-- Create active branches atomically and keep new Dashboard thresholds silent
-- until a manager saves them for the first time.

alter table public.locations
  add column provision_request_id uuid;

alter table public.locations
  add constraint locations_provision_request_id_key
  unique (provision_request_id);

do $$
begin
  if exists (
    select 1
    from public.locations
    where code is not null
    group by pg_catalog.upper(code)
    having count(*) > 1
  ) then
    raise exception 'BRANCH_CODE_CASE_COLLISION';
  end if;
end;
$$;

create unique index locations_code_case_insensitive_key
  on public.locations (pg_catalog.upper(code))
  where code is not null;

create or replace function private.prevent_location_code_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.code is distinct from new.code then
    raise exception 'BRANCH_CODE_IMMUTABLE'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_location_code_change()
  from public, anon, authenticated;

create trigger locations_code_immutable
before update of code on public.locations
for each row execute function private.prevent_location_code_change();

alter table public.dashboard_alert_thresholds
  add column is_configured boolean not null default false;

-- Every row that predates this migration keeps its current alert behaviour.
update public.dashboard_alert_thresholds
set is_configured = true;

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
    updated_by_name,
    is_configured
  )
  values (
    p_location_id,
    p_purchase_average_min,
    p_net_cash_min,
    auth.uid(),
    actor_name,
    true
  )
  on conflict (location_id) do update
  set purchase_average_min = excluded.purchase_average_min,
      net_cash_min = excluded.net_cash_min,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_by_name = excluded.updated_by_name,
      is_configured = true,
      updated_at = now();

  return public.get_dashboard_alert_thresholds(p_location_id);
end;
$$;

revoke all on function public.save_dashboard_alert_thresholds(uuid, numeric, numeric)
  from public, anon;
grant execute on function public.save_dashboard_alert_thresholds(uuid, numeric, numeric)
  to authenticated;

create or replace function public.get_dashboard_alerts_for_telegram()
returns table (
  location_id uuid,
  branch_name text,
  alert_key text,
  metric_label text,
  current_value numeric,
  minimum_value numeric,
  unit text,
  detail text
)
language sql
stable
security definer
set search_path = ''
as $$
  with branch_metrics as (
    select
      l.id as location_id,
      l.name as branch_name,
      s.summary,
      s.status,
      s.calculated_at,
      t.purchase_average_min,
      t.net_cash_min,
      'ต่ำกว่ายอดขั้นต่ำ · ผลคำนวณ '
        || to_char(
          s.calculated_at at time zone 'Asia/Bangkok',
          'DD/MM/YYYY HH24:MI'
        )
        || case
          when s.status = 'ready' then ''
          else ' · ข้อมูลกำลังรออัปเดต'
        end as alert_detail
    from public.locations l
    join public.dashboard_branch_snapshots s on s.location_id = l.id
    join public.dashboard_alert_thresholds t on t.location_id = l.id
    where l.is_active = true
      and t.is_configured = true
      and s.summary is not null
      and s.calculated_at is not null
  ),
  scalar_alerts as (
    select
      b.location_id,
      b.branch_name,
      'purchase_average_7_days'::text as alert_key,
      'ยอดซื้อเฉลี่ย 7 วัน'::text as metric_label,
      round((b.summary #>> '{purchase7Days,dailyAverage}')::numeric, 2)
        as current_value,
      b.purchase_average_min as minimum_value,
      'บาท/วัน'::text as unit,
      b.alert_detail as detail
    from branch_metrics b
    where b.purchase_average_min is not null
      and (b.summary #>> '{purchase7Days,dailyAverage}')::numeric
        < b.purchase_average_min

    union all

    select
      b.location_id,
      b.branch_name,
      'net_cash_accumulated',
      'รับ–จ่ายสุทธิสะสม',
      round((b.summary ->> 'netCashFlow')::numeric, 2),
      b.net_cash_min,
      'บาท',
      b.alert_detail
    from branch_metrics b
    where (b.summary ->> 'netCashFlow')::numeric < b.net_cash_min
  ),
  stock_alerts as (
    select
      b.location_id,
      b.branch_name,
      'stock:' || (product.item ->> 'productId') as alert_key,
      'สต็อกสินค้า · ' || (product.item ->> 'name') as metric_label,
      round((product.item ->> 'balance')::numeric, 2) as current_value,
      threshold.minimum_balance as minimum_value,
      product.item ->> 'unit' as unit,
      b.alert_detail as detail
    from branch_metrics b
    cross join lateral jsonb_array_elements(
      coalesce(b.summary #> '{stock,items}', '[]'::jsonb)
    ) product(item)
    join public.dashboard_stock_alert_thresholds threshold
      on threshold.location_id = b.location_id
     and threshold.product_id = (product.item ->> 'productId')::uuid
    where (product.item ->> 'balance')::numeric < threshold.minimum_balance
  )
  select * from scalar_alerts
  union all
  select * from stock_alerts
  order by branch_name, alert_key;
$$;

revoke all on function public.get_dashboard_alerts_for_telegram()
  from public, anon, authenticated;
grant execute on function public.get_dashboard_alerts_for_telegram()
  to service_role;

create or replace function public.provision_location(
  p_request_id uuid,
  p_name text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text :=
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(p_name, '')),
      '[[:space:]]+',
      ' ',
      'g'
    );
  normalized_code text :=
    pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')));
  location public.locations%rowtype;
  replayed boolean := false;
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
  then
    raise exception 'BRANCH_FORBIDDEN'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'BRANCH_REQUEST_ID_REQUIRED'
      using errcode = '22023';
  end if;

  if normalized_name = '' or char_length(normalized_name) > 100 then
    raise exception 'BRANCH_NAME_INVALID'
      using errcode = '22023';
  end if;

  if normalized_code !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'BRANCH_CODE_INVALID'
      using errcode = '22023';
  end if;

  select l.*
  into location
  from public.locations l
  where l.provision_request_id = p_request_id;

  if found then
    replayed := true;
  else
    insert into public.locations (
      name,
      code,
      is_active,
      created_by,
      provision_request_id
    )
    values (
      normalized_name,
      normalized_code,
      true,
      auth.uid(),
      p_request_id
    )
    on conflict (provision_request_id) do nothing
    returning * into location;

    if not found then
      select l.*
      into strict location
      from public.locations l
      where l.provision_request_id = p_request_id;
      replayed := true;
    else
      insert into public.user_locations (
        user_id,
        location_id,
        assigned_by,
        is_primary
      )
      values (
        auth.uid(),
        location.id,
        auth.uid(),
        false
      );
    end if;
  end if;

  if location.created_by is distinct from auth.uid()
    or location.name is distinct from normalized_name
    or location.code is distinct from normalized_code
  then
    raise exception 'BRANCH_IDEMPOTENCY_CONFLICT'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'location',
    jsonb_build_object(
      'id', location.id,
      'name', location.name,
      'code', location.code,
      'active', location.is_active
    ),
    'replayed', replayed
  );
end;
$$;

revoke all on function public.provision_location(uuid, text, text)
  from public, anon;
grant execute on function public.provision_location(uuid, text, text)
  to authenticated;
