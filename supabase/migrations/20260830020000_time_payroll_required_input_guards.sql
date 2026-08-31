-- Required scalar RPC inputs must fail closed. PostgreSQL IF treats an UNKNOWN
-- condition like false, so NOT IN/regex checks alone do not reject SQL NULL.

create or replace function public.replace_time_payroll_attendance_exceptions(
  p_profile_id uuid,
  p_month text,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_month date;
  v_next date;
  v_changed integer;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor is null or p_profile_id is null or not private.can_manage_time_payroll_profile(p_profile_id)
  then raise exception 'Forbidden'; end if;
  if p_month is null
    or p_month !~ '^[0-9]{4}-[0-9]{2}$'
    or jsonb_typeof(p_selections) is distinct from 'array'
  then raise exception 'INVALID_ATTENDANCE_SELECTIONS'; end if;
  begin v_month := (p_month || '-01')::date; exception when others then raise exception 'INVALID_MONTH'; end;
  if to_char(v_month, 'YYYY-MM') <> p_month then raise exception 'INVALID_MONTH'; end if;
  v_next := (v_month + interval '1 month')::date;
  if exists (
    select 1 from jsonb_array_elements(p_selections) item
    where (item ->> 'date') is not null and (item ->> 'date')::date > v_today
  ) then raise exception 'FUTURE_ATTENDANCE_DATE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  perform private.assert_attendance_month_open(p_profile_id, p_month);
  if exists (
    select 1 from jsonb_array_elements(p_selections) item
    where (item ->> 'status') is null
      or (item ->> 'status') not in ('HALF_DAY', 'OFF')
      or (item ->> 'date') is null
      or (item ->> 'date')::date < v_month
      or (item ->> 'date')::date >= v_next
      or not exists (
        select 1 from public.time_payroll_active_periods ap
        where ap.profile_id = p_profile_id and ap.start_on <= (item ->> 'date')::date
          and (ap.end_on is null or ap.end_on >= (item ->> 'date')::date)
      )
  ) or (
    select count(*) <> count(distinct item ->> 'date') from jsonb_array_elements(p_selections) item
  ) then raise exception 'INVALID_ATTENDANCE_SELECTIONS'; end if;

  delete from public.time_payroll_attendance_exceptions x
  where x.profile_id = p_profile_id and x.work_date >= v_month and x.work_date < v_next;
  insert into public.time_payroll_attendance_exceptions(profile_id, work_date, status, created_by, updated_by)
  select p_profile_id, (item ->> 'date')::date, item ->> 'status', v_actor, v_actor
  from jsonb_array_elements(p_selections) item;
  get diagnostics v_changed = row_count;
  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, new_data, comment)
  values (v_actor, 'REPLACE_ATTENDANCE_EXCEPTIONS', 'time_payroll_attendance_exceptions', p_profile_id,
    jsonb_build_object('month', p_month, 'selections', p_selections, 'count', v_changed), 'แก้ข้อยกเว้นวันทำงาน');
  return jsonb_build_object('changed', v_changed, 'month', p_month);
end
$$;

create or replace function public.update_time_payroll_config(p_workday_end_time text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_time time;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  if p_workday_end_time is null or p_workday_end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  then raise exception 'INVALID_WORKDAY_END_TIME'; end if;
  v_time := p_workday_end_time::time;
  update public.time_payroll_settings
  set workday_end_time = case when pending_effective_date <= v_today then pending_workday_end_time else workday_end_time end,
      pending_workday_end_time = v_time,
      pending_effective_date = v_today + 1,
      updated_by = v_actor,
      updated_at = now()
  where singleton = true;
  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, new_data, comment)
  values (v_actor, 'UPDATE_TIME_PAYROLL_CONFIG', 'time_payroll_settings', v_actor,
    jsonb_build_object('workdayEndTime', p_workday_end_time, 'effectiveDate', v_today + 1), 'ตั้งค่าเวลาสิ้นสุดวัน');
  return public.get_time_payroll_settings();
end
$$;

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
  v_open public.time_payroll_active_periods%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  if p_profile_id is null
    or p_action is null
    or p_action not in ('ENABLE', 'PAUSE', 'RESUME', 'END')
    or p_effective_date is null
  then raise exception 'INVALID_PERIOD_ACTION'; end if;
  if p_effective_date > v_today then raise exception 'FUTURE_EFFECTIVE_DATE'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.is_active) then raise exception 'PROFILE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  select * into v_open from public.time_payroll_active_periods ap where ap.profile_id = p_profile_id and ap.end_on is null for update;
  if p_action in ('ENABLE', 'RESUME') then
    if found then raise exception 'ACTIVE_PERIOD_ALREADY_OPEN'; end if;
    perform private.assert_attendance_range_open(p_profile_id, p_effective_date, v_today);
    insert into public.time_payroll_active_periods(profile_id, start_on, created_by, updated_by)
    values (p_profile_id, p_effective_date, v_actor, v_actor);
  elsif p_action = 'PAUSE' then
    if not found or p_effective_date <= v_open.start_on then raise exception 'NO_OPEN_ACTIVE_PERIOD'; end if;
    perform private.assert_attendance_range_open(p_profile_id, p_effective_date, v_today);
    update public.time_payroll_active_periods set end_on = p_effective_date - 1, updated_by = v_actor, updated_at = now() where id = v_open.id;
  else
    if not found or p_effective_date < v_open.start_on then raise exception 'NO_OPEN_ACTIVE_PERIOD'; end if;
    perform private.assert_attendance_range_open(p_profile_id, p_effective_date + 1, v_today);
    update public.time_payroll_active_periods set end_on = p_effective_date, updated_by = v_actor, updated_at = now() where id = v_open.id;
  end if;
  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, new_data, comment)
  values (v_actor, 'SET_PAYROLL_ACTIVE_PERIOD', 'time_payroll_active_periods', p_profile_id,
    jsonb_build_object('action', p_action, 'effectiveDate', p_effective_date), 'เปลี่ยนช่วงเงินเดือน');
  return jsonb_build_object('profileId', p_profile_id, 'action', p_action, 'effectiveDate', p_effective_date);
end
$$;

revoke all on function public.replace_time_payroll_attendance_exceptions(uuid, text, jsonb) from public, anon;
grant execute on function public.replace_time_payroll_attendance_exceptions(uuid, text, jsonb) to authenticated;
revoke all on function public.update_time_payroll_config(text) from public, anon;
grant execute on function public.update_time_payroll_config(text) to authenticated;
revoke all on function public.set_time_payroll_active_period(uuid, text, date) from public, anon;
grant execute on function public.set_time_payroll_active_period(uuid, text, date) to authenticated;
