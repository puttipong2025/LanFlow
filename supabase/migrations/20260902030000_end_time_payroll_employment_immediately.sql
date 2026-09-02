-- END changes employment status on the selected Bangkok date. For today,
-- the server cutoff decides whether today's already-earned attendance remains.

do $$
begin
  if exists (
    select 1
    from public.time_payroll_active_periods
    where scheduled_action = 'END'
  ) then
    raise exception 'PENDING_END_REQUIRES_MANUAL_REVIEW';
  end if;
end
$$;

alter table public.time_payroll_active_periods
  drop constraint time_payroll_active_period_schedule_fields;

alter table public.time_payroll_active_periods
  add constraint time_payroll_active_period_schedule_fields check (
    (
      scheduled_action is null
      and scheduled_effective_on is null
      and scheduled_activation_on is null
    )
    or (
      scheduled_action in ('ENABLE', 'PAUSE', 'RESUME', 'END')
      and scheduled_effective_on is not null
      and scheduled_activation_on = scheduled_effective_on
    )
  );

create or replace function private.time_payroll_day_earned_at(
  p_now timestamptz,
  p_workday_end_time time
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_now at time zone 'Asia/Bangkok')::time >= p_workday_end_time
$$;

revoke all on function private.time_payroll_day_earned_at(timestamptz, time) from public, anon, authenticated;

create or replace function public.set_time_payroll_active_period(
  p_profile_id uuid,
  p_action text,
  p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_activation_on date;
  v_is_scheduled boolean;
  v_pending public.time_payroll_active_periods%rowtype;
  v_current public.time_payroll_active_periods%rowtype;
  v_latest public.time_payroll_active_periods%rowtype;
  v_workday_end_time time;
  v_end_day_earned boolean;
begin
  if v_actor is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  if p_profile_id is null
    or p_action is null
    or p_action not in ('ENABLE', 'PAUSE', 'RESUME', 'END')
    or p_effective_date is null
  then raise exception 'INVALID_PERIOD_ACTION'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.is_active) then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if p_action = 'END' and p_effective_date < v_today then
    raise exception 'END_DATE_IN_PAST';
  end if;

  v_activation_on := p_effective_date;
  v_is_scheduled := v_activation_on > v_today;

  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));

  update public.time_payroll_active_periods
  set scheduled_action = null,
      scheduled_effective_on = null,
      scheduled_activation_on = null,
      updated_by = v_actor,
      updated_at = now()
  where profile_id = p_profile_id
    and scheduled_action is not null
    and scheduled_activation_on <= v_today;

  select * into v_pending
  from public.time_payroll_active_periods ap
  where ap.profile_id = p_profile_id
    and ap.scheduled_action is not null
    and ap.scheduled_activation_on > v_today
  for update;

  if found then
    perform private.assert_attendance_month_open(
      p_profile_id,
      to_char(v_pending.scheduled_effective_on, 'YYYY-MM')
    );
    if v_pending.scheduled_action in ('ENABLE', 'RESUME') then
      delete from public.time_payroll_active_periods where id = v_pending.id;
    else
      update public.time_payroll_active_periods
      set end_on = null,
          scheduled_action = null,
          scheduled_effective_on = null,
          scheduled_activation_on = null,
          updated_by = v_actor,
          updated_at = now()
      where id = v_pending.id;
    end if;
  end if;

  perform private.assert_attendance_month_open(p_profile_id, to_char(p_effective_date, 'YYYY-MM'));

  select * into v_current
  from public.time_payroll_active_periods ap
  where ap.profile_id = p_profile_id
    and ap.start_on <= v_today
    and (
      ap.end_on is null
      or (
        ap.scheduled_action in ('PAUSE', 'END')
        and ap.scheduled_activation_on > v_today
      )
    )
  order by ap.start_on desc
  limit 1
  for update;

  if p_action in ('ENABLE', 'RESUME') then
    if found then raise exception 'ACTIVE_PERIOD_ALREADY_OPEN'; end if;

    if p_action = 'RESUME' then
      select * into v_latest
      from public.time_payroll_active_periods ap
      where ap.profile_id = p_profile_id
      order by ap.start_on desc
      limit 1
      for update;
    end if;

    if v_is_scheduled then
      insert into public.time_payroll_active_periods(
        profile_id, start_on, scheduled_action, scheduled_effective_on,
        scheduled_activation_on, created_by, updated_by
      ) values (
        p_profile_id, p_effective_date, p_action, p_effective_date,
        v_activation_on, v_actor, v_actor
      );
    else
      perform private.assert_attendance_range_open(p_profile_id, p_effective_date, v_today);
      if p_action = 'RESUME' and v_latest.end_on = p_effective_date then
        update public.time_payroll_active_periods
        set end_on = null, updated_by = v_actor, updated_at = now()
        where id = v_latest.id;
      else
        insert into public.time_payroll_active_periods(profile_id, start_on, created_by, updated_by)
        values (p_profile_id, p_effective_date, v_actor, v_actor);
      end if;
    end if;
  elsif p_action = 'PAUSE' then
    if not found or p_effective_date <= v_current.start_on then raise exception 'NO_OPEN_ACTIVE_PERIOD'; end if;
    if not v_is_scheduled then
      perform private.assert_attendance_range_open(p_profile_id, p_effective_date, v_today);
    end if;
    update public.time_payroll_active_periods
    set end_on = p_effective_date - 1,
        scheduled_action = case when v_is_scheduled then p_action else null end,
        scheduled_effective_on = case when v_is_scheduled then p_effective_date else null end,
        scheduled_activation_on = case when v_is_scheduled then v_activation_on else null end,
        updated_by = v_actor,
        updated_at = now()
    where id = v_current.id;
  else
    if not found or p_effective_date < v_current.start_on then raise exception 'NO_OPEN_ACTIVE_PERIOD'; end if;

    if v_is_scheduled then
      update public.time_payroll_active_periods
      set end_on = p_effective_date - 1,
          scheduled_action = p_action,
          scheduled_effective_on = p_effective_date,
          scheduled_activation_on = v_activation_on,
          updated_by = v_actor,
          updated_at = now()
      where id = v_current.id;
    else
      select coalesce(s.workday_end_time, time '16:00')
        into v_workday_end_time
      from private.effective_time_payroll_settings() s;
      v_workday_end_time := coalesce(v_workday_end_time, time '16:00');
      v_end_day_earned := private.time_payroll_day_earned_at(now(), v_workday_end_time);

      if not v_end_day_earned and v_current.start_on = v_today then
        delete from public.time_payroll_active_periods where id = v_current.id;
      else
        update public.time_payroll_active_periods
        set end_on = case when v_end_day_earned then v_today else v_today - 1 end,
            scheduled_action = null,
            scheduled_effective_on = null,
            scheduled_activation_on = null,
            updated_by = v_actor,
            updated_at = now()
        where id = v_current.id;
      end if;
    end if;
  end if;

  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, new_data, comment)
  values (
    v_actor,
    'SET_PAYROLL_ACTIVE_PERIOD',
    'time_payroll_active_periods',
    p_profile_id,
    jsonb_build_object(
      'action', p_action,
      'selectedEffectiveOn', p_effective_date,
      'activationOn', v_activation_on,
      'scheduled', v_is_scheduled,
      'endDayEarned', v_end_day_earned
    ),
    case
      when v_is_scheduled then format(
        'ตั้งกำหนดการ %s: วันที่เลือก %s มีผล %s 00:00 Asia/Bangkok',
        p_action, p_effective_date, v_activation_on
      )
      when p_action = 'END' then format(
        'สิ้นสุดงานทันทีวันที่ %s; คงผลค่าแรงวันนี้: %s (cutoff %s Asia/Bangkok)',
        p_effective_date, v_end_day_earned, v_workday_end_time
      )
      else format('เปลี่ยนช่วงเงินเดือน %s มีผลวันที่ %s Asia/Bangkok', p_action, v_activation_on)
    end
  );

  return jsonb_build_object(
    'profileId', p_profile_id,
    'action', p_action,
    'selectedEffectiveOn', p_effective_date,
    'activationOn', v_activation_on,
    'scheduled', v_is_scheduled,
    'endDayEarned', v_end_day_earned
  );
end
$$;

revoke all on function public.set_time_payroll_active_period(uuid, text, date) from public, anon;
grant execute on function public.set_time_payroll_active_period(uuid, text, date) to authenticated;

notify pgrst, 'reload schema';
