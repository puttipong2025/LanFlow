-- Attendance is confirmed only through the current Bangkok business date.
-- Reject future individual and batch writes before taking locks or mutating rows.

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
  if v_actor is null or not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' or jsonb_typeof(p_selections) <> 'array' then raise exception 'INVALID_ATTENDANCE_SELECTIONS'; end if;
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
    where (item ->> 'status') not in ('HALF_DAY', 'OFF')
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

revoke all on function public.replace_time_payroll_attendance_exceptions(uuid, text, jsonb) from public, anon;
grant execute on function public.replace_time_payroll_attendance_exceptions(uuid, text, jsonb) to authenticated;
