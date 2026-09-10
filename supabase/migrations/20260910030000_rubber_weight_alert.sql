-- Configurable in-app alert for ready Dashboard remaining-rubber snapshots.

alter table public.dashboard_refresh_settings
  add column rubber_alert_threshold_kg integer not null default 10000
    check (rubber_alert_threshold_kg between 1 and 1000000),
  add column rubber_alert_interval_minutes integer not null default 60
    check (rubber_alert_interval_minutes between 1 and 1440);

create or replace function public.get_rubber_weight_alert_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings public.dashboard_refresh_settings%rowtype;
begin
  if not private.can_access_business_modules() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์อ่านค่าการแจ้งเตือนน้ำหนัก';
  end if;

  select *
  into strict settings
  from public.dashboard_refresh_settings
  where id = true;

  return jsonb_build_object(
    'thresholdKg', settings.rubber_alert_threshold_kg,
    'intervalMinutes', settings.rubber_alert_interval_minutes
  );
end;
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

  select *
  into strict settings
  from public.dashboard_refresh_settings
  where id = true;

  with eligible as (
    select
      l.id,
      l.name,
      l.created_at,
      case
        when jsonb_typeof(s.summary #> '{rubberRemaining,netWeight}') = 'number'
          then (s.summary #>> '{rubberRemaining,netWeight}')::numeric
        else null
      end as net_weight
    from public.locations l
    join public.dashboard_branch_snapshots s on s.location_id = l.id
    where l.is_active = true
      and public.can_access_location(l.id)
      and s.status = 'ready'
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'locationId', eligible.id,
        'locationName', eligible.name,
        'netWeight', eligible.net_weight
      )
      order by eligible.net_weight desc, eligible.created_at, eligible.id
    ),
    '[]'::jsonb
  )
  into candidates
  from eligible
  where eligible.net_weight > settings.rubber_alert_threshold_kg;

  return jsonb_build_object(
    'config', jsonb_build_object(
      'thresholdKg', settings.rubber_alert_threshold_kg,
      'intervalMinutes', settings.rubber_alert_interval_minutes
    ),
    'candidates', candidates
  );
end;
$$;

create or replace function public.save_rubber_weight_alert_config(
  p_threshold_kg integer,
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

  if p_threshold_kg is null
    or p_threshold_kg < 1
    or p_threshold_kg > 1000000
    or p_interval_minutes is null
    or p_interval_minutes < 1
    or p_interval_minutes > 1440
  then
    raise exception 'RUBBER_WEIGHT_ALERT_INVALID: ค่าการแจ้งเตือนไม่ถูกต้อง';
  end if;

  select p.name
  into actor_name
  from public.profiles p
  where p.id = auth.uid();

  update public.dashboard_refresh_settings
  set rubber_alert_threshold_kg = p_threshold_kg,
      rubber_alert_interval_minutes = p_interval_minutes,
      updated_by_user_id = auth.uid(),
      updated_by_name = actor_name,
      updated_at = now()
  where id = true;

  return public.get_rubber_weight_alert_config();
end;
$$;

revoke all on function public.get_rubber_weight_alert_config()
  from public, anon;
revoke all on function public.get_rubber_weight_alert_check()
  from public, anon;
revoke all on function public.save_rubber_weight_alert_config(integer, integer)
  from public, anon;

grant execute on function public.get_rubber_weight_alert_config()
  to authenticated, service_role;
grant execute on function public.get_rubber_weight_alert_check()
  to authenticated, service_role;
grant execute on function public.save_rubber_weight_alert_config(integer, integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';
