-- Active-period changes are effective immediately or historically. Future-dated
-- actions would bypass the affected-month lock scan, so reject them server-side.

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
  if p_action not in ('ENABLE', 'PAUSE', 'RESUME', 'END') or p_effective_date is null then raise exception 'INVALID_PERIOD_ACTION'; end if;
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

revoke all on function public.set_time_payroll_active_period(uuid, text, date) from public, anon;
grant execute on function public.set_time_payroll_active_period(uuid, text, date) to authenticated;
