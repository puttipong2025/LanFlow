-- Retire TIMER as a writable/runtime attendance mode. Historical segment rows
-- remain readable for legacy slips and reports until a separate archive migration.

do $$
declare
  v_active_segments bigint;
  v_resume_schedules bigint;
begin
  select count(*) into v_active_segments
  from public.time_segments
  where end_time is null;

  select count(*) into v_resume_schedules
  from public.time_tracking_resume_schedules;

  if v_active_segments > 0 or v_resume_schedules > 0 then
    raise exception 'TIMER_RETIREMENT_BLOCKED:active=%:resume=%', v_active_segments, v_resume_schedules;
  end if;
end
$$;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'time-tracking-daily-cutoff',
      'deduct-debts-daily',
      'time-tracking-auto-start'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end
$$;

update public.time_payroll_settings
set mode = 'EXCEPTIONS',
    activated_on = coalesce(activated_on, (now() at time zone 'Asia/Bangkok')::date),
    updated_at = now()
where singleton = true;

alter table public.time_payroll_settings
  alter column mode set default 'EXCEPTIONS';

alter table public.time_payroll_settings
  drop constraint if exists time_payroll_settings_mode_check;

alter table public.time_payroll_settings
  add constraint time_payroll_settings_mode_check
  check (mode = 'EXCEPTIONS');

revoke insert, update, delete on table public.time_segments from authenticated;
revoke insert, update, delete on table public.time_tracking_resume_schedules from authenticated;

revoke all on function public.set_time_tracking_status(uuid, text) from public, anon, authenticated;
revoke all on function public.cutoff_time_tracking(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.replace_time_tracking_segments(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.activate_exception_attendance() from public, anon, authenticated;
revoke all on function public.get_time_payroll_preflight() from public, anon, authenticated;

create or replace function public.calculate_paid_work_days(
  p_profile_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
begin
  if p_period_end is null then raise exception 'PERIOD_END_REQUIRED'; end if;
  v_summary := private.exception_attendance_summary(p_profile_id, p_period_start, p_period_end, now());
  return coalesce((v_summary ->> 'paidDays')::numeric, 0);
end
$$;

revoke all on function public.calculate_paid_work_days(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.calculate_paid_work_days(uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.get_time_payroll_attendance_month(
  p_profile_id uuid,
  p_month text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_next_month date;
  v_settings jsonb;
  v_summary jsonb;
  v_periods jsonb;
  v_exceptions jsonb;
  v_wage numeric;
  v_bangkok_now timestamp := now() at time zone 'Asia/Bangkok';
  v_eligible_through date;
begin
  if auth.uid() is null or not (
    p_profile_id = auth.uid() or private.can_manage_time_payroll_profile(p_profile_id)
  ) then raise exception 'Forbidden'; end if;
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_MONTH'; end if;
  begin
    v_month := (p_month || '-01')::date;
  exception when others then
    raise exception 'INVALID_MONTH';
  end;
  if to_char(v_month, 'YYYY-MM') <> p_month then raise exception 'INVALID_MONTH'; end if;

  v_next_month := (v_month + interval '1 month')::date;
  v_settings := public.get_time_payroll_settings();
  v_eligible_through := case
    when v_bangkok_now::time >= (v_settings ->> 'workdayEndTime')::time then v_bangkok_now::date
    else v_bangkok_now::date - 1
  end;

  select p.daily_wage into v_wage
  from public.profiles p
  where p.id = p_profile_id and p.is_active;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  v_summary := private.exception_attendance_summary(
    p_profile_id,
    v_month::timestamp at time zone 'Asia/Bangkok',
    v_next_month::timestamp at time zone 'Asia/Bangkok',
    now()
  );
  v_summary := v_summary || jsonb_build_object(
    'grossPay', trunc(coalesce((v_summary ->> 'paidDays')::numeric, 0) * coalesce(v_wage, 0), 2)
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', ap.id, 'startOn', ap.start_on, 'endOn', ap.end_on)
      order by ap.start_on
    ),
    '[]'::jsonb
  ) into v_periods
  from public.time_payroll_active_periods ap
  where ap.profile_id = p_profile_id
    and ap.start_on < v_next_month
    and (ap.end_on is null or ap.end_on >= v_month);

  select coalesce(
    jsonb_agg(
      jsonb_build_object('date', x.work_date, 'status', x.status)
      order by x.work_date
    ),
    '[]'::jsonb
  ) into v_exceptions
  from public.time_payroll_attendance_exceptions x
  where x.profile_id = p_profile_id
    and x.work_date >= v_month
    and x.work_date < v_next_month;

  return jsonb_build_object(
    'month', p_month,
    'mode', 'EXCEPTIONS',
    'workdayEndTime', v_settings ->> 'workdayEndTime',
    'eligibleThrough', v_eligible_through,
    'periods', v_periods,
    'exceptions', v_exceptions,
    'summary', v_summary
  );
end
$$;

revoke all on function public.get_time_payroll_attendance_month(uuid, text) from public, anon;
grant execute on function public.get_time_payroll_attendance_month(uuid, text) to authenticated;
