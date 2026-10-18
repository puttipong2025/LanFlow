-- Share branch cash status with in-app groups; Telegram thresholds stay independent.
set constraints public.enforce_cash_alert_group_row_not_empty immediate;
update public.cash_alert_groups
set threshold_amount = greatest(10000, least(1000000, threshold_amount))
where threshold_amount < 10000 or threshold_amount > 1000000;
alter table public.cash_alert_groups drop constraint cash_alert_groups_threshold_check;
alter table public.cash_alert_groups add constraint cash_alert_groups_threshold_check
  check (threshold_amount between 10000 and 1000000 and threshold_amount = round(threshold_amount, 2));

set constraints public.enforce_cash_alert_group_row_not_empty deferred;

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
  if p_threshold_amount is null or p_threshold_amount < 10000 or p_threshold_amount > 1000000 or p_threshold_amount <> round(p_threshold_amount, 2) then
    raise exception 'CASH_ALERT_GROUP_INVALID: เกณฑ์เงินต้องอยู่ระหว่าง 10,000 ถึง 1,000,000 บาท และทศนิยมไม่เกินสองตำแหน่ง';
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

create or replace function public.get_dashboard_branch_summaries()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if not private.is_active_user() then raise exception 'Access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'locationId', l.id,
    'snapshotStatus', s.status,
    'calculatedAt', s.calculated_at,
    'isOverdue', coalesce(s.status <> 'ready' and s.pending_since + make_interval(mins => settings.interval_minutes) < now(), false),
    'cashStatus', case
      when s.summary is null then 'no_data'
      when g.id is null then 'unconfigured'
      when (s.summary ->> 'netCashFlow')::numeric < g.threshold_amount then 'low'
      else 'normal'
    end,
    'summary', case when s.summary is null then null else jsonb_build_object(
      'netCashFlow', s.summary -> 'netCashFlow',
      'rubberInventoryWeight', s.summary -> 'rubberInventoryWeight',
      'purchaseToday', s.summary -> 'purchaseToday'
    ) end
  ) order by l.created_at, l.id), '[]'::jsonb) into payload
  from public.locations l
  cross join public.dashboard_refresh_settings settings
  left join public.dashboard_branch_snapshots s on s.location_id = l.id
  left join public.cash_alert_group_locations gl on gl.location_id = l.id
  left join public.cash_alert_groups g on g.id = gl.group_id
  where l.is_active and settings.id = true and public.can_access_location(l.id);
  return payload;
end;
$$;
revoke all on function public.get_dashboard_branch_summaries() from public, anon;
grant execute on function public.get_dashboard_branch_summaries() to authenticated;

notify pgrst, 'reload schema';
