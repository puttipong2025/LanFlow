-- Treat adjacent payroll rows as one continuous latest work chain. This keeps
-- historical row identities while allowing the chain's first boundary to be
-- corrected without deleting, recreating, or overlapping any period.

create or replace function public.correct_time_payroll_period_start(
  p_profile_id uuid,
  p_period_id uuid,
  p_start_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_tail public.time_payroll_active_periods%rowtype;
  v_target public.time_payroll_active_periods%rowtype;
  v_candidate public.time_payroll_active_periods%rowtype;
  v_previous public.time_payroll_active_periods%rowtype;
  v_latest_on date;
  v_old_start_on date;
  v_affected_from date;
  v_affected_through date;
begin
  if v_actor is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  if p_profile_id is null or p_period_id is null or p_start_on is null then
    raise exception 'INVALID_PERIOD_START_CORRECTION';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.is_active) then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));

  select * into v_tail
  from public.time_payroll_active_periods ap
  where ap.profile_id = p_profile_id
    and ap.start_on <= v_today
  order by ap.start_on desc
  limit 1
  for update;

  if not found then raise exception 'NO_PERIOD_START_TO_CORRECT'; end if;
  v_target := v_tail;

  loop
    select * into v_candidate
    from public.time_payroll_active_periods ap
    where ap.profile_id = p_profile_id
      and ap.end_on = v_target.start_on - 1
    order by ap.start_on desc
    limit 1
    for update;
    exit when not found;
    v_target := v_candidate;
  end loop;

  if v_target.id <> p_period_id then raise exception 'PERIOD_START_CORRECTION_STALE'; end if;

  select * into v_previous
  from public.time_payroll_active_periods ap
  where ap.profile_id = p_profile_id
    and ap.start_on < v_target.start_on
    and ap.end_on is not null
  order by ap.start_on desc
  limit 1
  for update;

  if found and p_start_on <= v_previous.end_on then
    raise exception 'PERIOD_START_OVERLAPS_PREVIOUS:%', v_previous.end_on;
  end if;
  if p_start_on > v_today then raise exception 'PERIOD_START_CORRECTION_DATE_IN_FUTURE'; end if;

  v_latest_on := case
    when v_target.id <> v_tail.id then v_target.end_on
    when v_tail.end_on is null
      or (
        v_tail.scheduled_action in ('PAUSE', 'END')
        and v_tail.scheduled_activation_on > v_today
      )
    then v_today
    else v_tail.end_on
  end;

  if v_latest_on is null or p_start_on > v_latest_on then
    raise exception 'PERIOD_START_CORRECTION_AFTER_END:%', v_latest_on;
  end if;

  v_old_start_on := v_target.start_on;
  if p_start_on = v_old_start_on then raise exception 'INVALID_PERIOD_START_CORRECTION'; end if;

  v_affected_from := least(v_old_start_on, p_start_on);
  v_affected_through := greatest(v_old_start_on, p_start_on) - 1;
  perform private.assert_attendance_range_open(p_profile_id, v_affected_from, v_affected_through);

  update public.time_payroll_active_periods
  set start_on = p_start_on,
      updated_by = v_actor,
      updated_at = now()
  where id = v_target.id;

  return jsonb_build_object(
    'profileId', p_profile_id,
    'periodId', v_target.id,
    'oldStartOn', v_old_start_on,
    'newStartOn', p_start_on,
    'affectedFrom', v_affected_from,
    'affectedThrough', v_affected_through
  );
end
$$;

revoke all on function public.correct_time_payroll_period_start(uuid, uuid, date) from public, anon;
grant execute on function public.correct_time_payroll_period_start(uuid, uuid, date) to authenticated;
