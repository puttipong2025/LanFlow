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
  v_last_end_on date;
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

  select max(nullif(log.new_data ->> 'selectedEffectiveOn', '')::date)
  into v_last_end_on
  from public.time_tracking_audit_logs log
  where log.target_table = 'time_payroll_active_periods'
    and log.record_id = p_profile_id
    and log.action = 'SET_PAYROLL_ACTIVE_PERIOD'
    and log.new_data @> '{"action":"END"}'::jsonb;

  return jsonb_build_object(
    'month', p_month,
    'mode', 'EXCEPTIONS',
    'workdayEndTime', v_settings ->> 'workdayEndTime',
    'eligibleThrough', v_eligible_through,
    'lastEndOn', v_last_end_on,
    'periods', v_periods,
    'exceptions', v_exceptions,
    'summary', v_summary
  );
end
$$;

revoke all on function public.get_time_payroll_attendance_month(uuid, text) from public, anon;
grant execute on function public.get_time_payroll_attendance_month(uuid, text) to authenticated;
