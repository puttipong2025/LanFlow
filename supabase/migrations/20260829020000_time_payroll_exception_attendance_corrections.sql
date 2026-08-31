-- Forward-only corrections for the exception-attendance cutover.
-- Keep self-service withdrawal dates server-owned, serialize attendance close,
-- and validate every historical month changed by an active-period action.

create or replace function private.assert_attendance_range_open(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    return;
  end if;
  for v_month in
    select generate_series(
      date_trunc('month', p_start_date)::date,
      date_trunc('month', p_end_date)::date,
      interval '1 month'
    )::date
  loop
    perform private.assert_attendance_month_open(p_profile_id, to_char(v_month, 'YYYY-MM'));
  end loop;
end
$$;

revoke all on function private.assert_attendance_range_open(uuid, date, date) from public, anon, authenticated;

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

create or replace function public.create_time_tracking_transaction(
  p_profile_id uuid,
  p_type text,
  p_amount numeric,
  p_effective_date date,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created jsonb;
  v_decision jsonb;
  v_bangkok_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_effective_date date := p_effective_date;
begin
  if p_type = 'WITHDRAWAL'
    and p_profile_id = auth.uid()
    and not private.can_manage_time_payroll_profile(p_profile_id)
  then
    v_effective_date := v_bangkok_today;
  end if;
  v_created := public.create_time_tracking_transaction_internal_20260829(
    p_profile_id, p_type, p_amount, v_effective_date, p_description
  );
  if private.is_global_time_payroll_manager() then
    v_decision := public.decide_time_tracking_approval(
      'transaction', (v_created ->> 'id')::uuid, 'APPROVED', null, null
    );
    return v_created || jsonb_build_object('status', 'approved', 'decision', v_decision);
  end if;
  return v_created;
end
$$;

revoke all on function public.create_time_tracking_transaction(uuid, text, numeric, date, text) from public, anon;
grant execute on function public.create_time_tracking_transaction(uuid, text, numeric, date, text) to authenticated;

create or replace function public.request_time_tracking_withdrawal(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_user() then raise exception 'Authentication required'; end if;
  return public.create_time_tracking_transaction(
    auth.uid(),
    'WITHDRAWAL',
    p_amount,
    (now() at time zone 'Asia/Bangkok')::date,
    null
  );
end
$$;

revoke all on function public.request_time_tracking_withdrawal(numeric) from public, anon;
grant execute on function public.request_time_tracking_withdrawal(numeric) to authenticated;

create or replace function public.create_time_tracking_payroll_slip(
  p_profile_id uuid,
  p_month text,
  p_auto_start_next_month boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_month date;
  v_scan_month date;
  v_first_active_month date;
  v_created jsonb;
  v_attendance jsonb;
  v_final jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  select s.mode into v_mode from public.time_payroll_settings s where s.singleton = true for share;
  if v_mode = 'EXCEPTIONS' then
    if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'INVALID_MONTH'; end if;
    begin v_month := (p_month || '-01')::date; exception when others then raise exception 'INVALID_MONTH'; end;
    if to_char(v_month, 'YYYY-MM') <> p_month then raise exception 'INVALID_MONTH'; end if;
    select min(date_trunc('month', ap.start_on)::date)
      into v_first_active_month
    from public.time_payroll_active_periods ap
    where ap.profile_id = p_profile_id;
    if v_first_active_month is not null then
      for v_scan_month in
        select generate_series(
          v_first_active_month::timestamp,
          (v_month - interval '1 month')::timestamp,
          interval '1 month'
        )::date
      loop
        if not exists (
          select 1 from public.payroll_slips ps
          where ps.profile_id = p_profile_id and ps.month = to_char(v_scan_month, 'YYYY-MM')
        ) and public.calculate_paid_work_days(
          p_profile_id,
          v_scan_month::timestamp at time zone 'Asia/Bangkok',
          (v_scan_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
        ) > 0 then
          raise exception 'OLDER_WORK_MONTH:%', to_char(v_scan_month, 'YYYY-MM');
        end if;
      end loop;
    end if;
  end if;
  v_created := public.create_time_tracking_payroll_slip_internal_20260829(
    p_profile_id, p_month, case when v_mode = 'EXCEPTIONS' then false else p_auto_start_next_month end
  );
  v_attendance := public.get_time_payroll_attendance_month(p_profile_id, p_month);
  update public.payroll_slips
  set slip_data = coalesce(slip_data, '{}'::jsonb) || jsonb_build_object('attendance', v_attendance)
  where id = (v_created ->> 'id')::uuid;
  if private.is_global_time_payroll_manager() then
    perform public.decide_time_tracking_approval('payroll_slip', (v_created ->> 'id')::uuid, 'APPROVED', null, null);
  end if;
  select to_jsonb(ps) into v_final from public.payroll_slips ps where ps.id = (v_created ->> 'id')::uuid;
  return v_final || jsonb_build_object('auto_start_scheduled', coalesce((v_created ->> 'auto_start_scheduled')::boolean, false));
end
$$;

revoke all on function public.create_time_tracking_payroll_slip(uuid, text, boolean) from public, anon;
grant execute on function public.create_time_tracking_payroll_slip(uuid, text, boolean) to authenticated;
