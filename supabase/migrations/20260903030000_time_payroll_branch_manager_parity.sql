-- ADR-0060: reuse existing target scope; keep global authority unchanged.

CREATE OR REPLACE FUNCTION public.update_time_tracking_wage(p_profile_id uuid, p_daily_wage numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  return public.update_time_tracking_wage_internal_20260901(p_profile_id, p_daily_wage);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_time_payroll_active_period(p_profile_id uuid, p_action text, p_effective_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_activation_on date;
  v_is_scheduled boolean;
  v_pending public.time_payroll_active_periods%rowtype;
  v_current public.time_payroll_active_periods%rowtype;
  v_latest public.time_payroll_active_periods%rowtype;
  v_last_end_action_on date;
  v_workday_end_time time;
  v_end_day_earned boolean;
begin
  if v_actor is null or not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
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

      if not found then
        select b.last_end_action_on
          into v_last_end_action_on
        from private.time_payroll_employment_boundaries b
        where b.profile_id = p_profile_id;

        if not found then raise exception 'NO_PERIOD_HISTORY_TO_RESUME'; end if;
        if p_effective_date < v_last_end_action_on then
          raise exception 'RESUME_BEFORE_LAST_END_DATE:%', v_last_end_action_on;
        end if;
      elsif not (v_latest.end_on = v_today and p_effective_date = v_today)
        and (v_latest.end_on is null or p_effective_date <= v_latest.end_on)
      then
        raise exception 'RESUME_OVERLAPS_PREVIOUS_PERIOD:%', v_latest.end_on;
      end if;
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
      if p_action = 'RESUME'
        and v_latest.end_on = v_today
        and p_effective_date = v_today
      then
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
$function$;

CREATE OR REPLACE FUNCTION public.correct_time_payroll_resume_start(p_profile_id uuid, p_start_on date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_current public.time_payroll_active_periods%rowtype;
  v_previous public.time_payroll_active_periods%rowtype;
  v_old_start_on date;
  v_affected_from date;
  v_affected_through date;
begin
  if v_actor is null or not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_profile_id is null or p_start_on is null then raise exception 'INVALID_RESUME_CORRECTION'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.is_active) then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));

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

  if not found then raise exception 'NO_RESUME_PERIOD_TO_CORRECT'; end if;

  select * into v_previous
  from public.time_payroll_active_periods ap
  where ap.profile_id = p_profile_id
    and ap.id <> v_current.id
    and ap.start_on < v_current.start_on
    and ap.end_on is not null
  order by ap.start_on desc
  limit 1
  for update;

  if not found then raise exception 'NO_RESUME_PERIOD_TO_CORRECT'; end if;
  if p_start_on <= v_previous.end_on then
    raise exception 'RESUME_OVERLAPS_PREVIOUS_PERIOD:%', v_previous.end_on;
  end if;
  if p_start_on > v_today then raise exception 'RESUME_CORRECTION_DATE_IN_FUTURE'; end if;
  if v_current.scheduled_effective_on is not null
    and p_start_on >= v_current.scheduled_effective_on
  then
    raise exception 'RESUME_CORRECTION_AFTER_PENDING_ACTION:%', v_current.scheduled_effective_on;
  end if;

  v_old_start_on := v_current.start_on;
  if p_start_on = v_old_start_on then raise exception 'INVALID_RESUME_CORRECTION'; end if;
  v_affected_from := least(v_old_start_on, p_start_on);
  v_affected_through := greatest(v_old_start_on, p_start_on);
  perform private.assert_attendance_range_open(p_profile_id, v_affected_from, v_affected_through);

  update public.time_payroll_active_periods
  set start_on = p_start_on,
      updated_by = v_actor,
      updated_at = now()
  where id = v_current.id;

  return jsonb_build_object(
    'profileId', p_profile_id,
    'oldStartOn', v_old_start_on,
    'newStartOn', p_start_on,
    'affectedFrom', v_affected_from,
    'affectedThrough', v_affected_through
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.correct_time_payroll_period_start(p_profile_id uuid, p_period_id uuid, p_start_on date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_actor is null or not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.cancel_time_payroll_active_period_schedule(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_pending public.time_payroll_active_periods%rowtype;
begin
  if v_actor is null or not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_profile_id is null then raise exception 'INVALID_PERIOD_ACTION'; end if;
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
  if not found then raise exception 'NO_PENDING_PERIOD_ACTION'; end if;

  perform private.assert_attendance_month_open(
    p_profile_id,
    to_char(v_pending.scheduled_effective_on, 'YYYY-MM')
  );
  if to_char(v_pending.scheduled_activation_on, 'YYYY-MM')
    <> to_char(v_pending.scheduled_effective_on, 'YYYY-MM')
  then
    perform private.assert_attendance_month_open(
      p_profile_id,
      to_char(v_pending.scheduled_activation_on, 'YYYY-MM')
    );
  end if;

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

  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, old_data, new_data, comment)
  values (
    v_actor,
    'CANCEL_PAYROLL_ACTIVE_PERIOD_SCHEDULE',
    'time_payroll_active_periods',
    p_profile_id,
    jsonb_build_object(
      'action', v_pending.scheduled_action,
      'selectedEffectiveOn', v_pending.scheduled_effective_on,
      'activationOn', v_pending.scheduled_activation_on
    ),
    jsonb_build_object('scheduled', false),
    format(
      'ยกเลิกกำหนดการ %s เดิมมีผลจริง %s 00:00 Asia/Bangkok',
      v_pending.scheduled_action, v_pending.scheduled_activation_on
    )
  );

  return jsonb_build_object(
    'profileId', p_profile_id,
    'cancelled', true,
    'action', v_pending.scheduled_action,
    'selectedEffectiveOn', v_pending.scheduled_effective_on,
    'activationOn', v_pending.scheduled_activation_on
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.decide_time_tracking_approval(p_source_type text, p_source_id uuid, p_decision text, p_comment text DEFAULT NULL::text, p_expense_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not private.has_time_payroll_manager_access() then raise exception 'Forbidden'; end if;
  return public.decide_time_tracking_approval_internal_20260829(
    p_source_type, p_source_id, p_decision, p_comment, p_expense_location_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.update_time_payroll_config(p_workday_end_time text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_time time;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor is null or not (private.is_active_user() and private.is_super_admin()) then raise exception 'Forbidden'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION private.can_assign_time_tracking_expense_location(target_location uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.has_time_payroll_manager_access()
    and target_location is not null
    and (private.is_global_time_payroll_manager() or exists (
      select 1 from public.user_locations ul
      where ul.user_id = auth.uid() and ul.location_id = target_location
    ))
    and exists (
      select 1 from public.locations l
      where l.id = target_location and l.is_active = true
    )
$function$;

CREATE OR REPLACE FUNCTION public.get_time_payroll_payment_locations()
 RETURNS TABLE(id uuid, name text, code text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.id, l.name, l.code, l.is_active
  from public.locations l
  where private.can_assign_time_tracking_expense_location(l.id)
    and l.is_active = true
  order by l.created_at, l.id
$function$;

CREATE OR REPLACE FUNCTION public.change_time_tracking_expense_location(p_source_type text, p_source_id uuid, p_expense_location_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_location_id uuid;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if not private.has_time_payroll_manager_access() then
    raise exception 'Forbidden';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid expense source';
  end if;
  if p_expense_location_id is not null
    and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
  then
    raise exception 'New expense location access denied';
  end if;

  if p_source_type = 'transaction' then
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found
      or v_tx.type <> 'WITHDRAWAL'
      or v_tx.status <> 'APPROVED'
      or v_tx.cancelled_at is not null
    then
      raise exception 'Active withdrawal expense not found';
    end if;
    if not private.can_manage_time_payroll_profile(v_tx.profile_id) then
      raise exception 'Expense location access denied';
    end if;

    if not private.is_global_time_payroll_manager()
      and v_tx.expense_location_id is not null
      and not private.can_assign_time_tracking_expense_location(v_tx.expense_location_id)
    then raise exception 'Existing expense location access denied'; end if;

    v_old_location_id := v_tx.expense_location_id;
    if v_old_location_id is not distinct from p_expense_location_id then
      return jsonb_build_object('status', 'unchanged');
    end if;

    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.financial_transactions
    set expense_location_id = p_expense_location_id
    where id = v_tx.id;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'CHANGE_TRANSACTION_EXPENSE_LOCATION',
      'financial_transactions',
      v_tx.id,
      jsonb_build_object(
        'expenseLocationId', v_old_location_id,
        'paymentMethod', case when v_old_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM' else 'BRANCH' end
      ),
      jsonb_build_object(
        'expenseLocationId', p_expense_location_id,
        'paymentMethod', case when p_expense_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM' else 'BRANCH' end
      ),
      coalesce(p_comment, '')
    );
  else
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found
      or v_slip.status <> 'APPROVED'
      or v_slip.net_pay <= 0
      or v_slip.cancelled_at is not null
    then
      raise exception 'Active payroll expense not found';
    end if;
    if not private.can_manage_time_payroll_profile(v_slip.profile_id) then
      raise exception 'Expense location access denied';
    end if;

    if not private.is_global_time_payroll_manager()
      and v_slip.expense_location_id is not null
      and not private.can_assign_time_tracking_expense_location(v_slip.expense_location_id)
    then raise exception 'Existing expense location access denied'; end if;

    v_old_location_id := v_slip.expense_location_id;
    if v_old_location_id is not distinct from p_expense_location_id then
      return jsonb_build_object('status', 'unchanged');
    end if;

    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.payroll_slips
    set expense_location_id = p_expense_location_id
    where id = v_slip.id;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'CHANGE_PAYROLL_EXPENSE_LOCATION',
      'payroll_slips',
      v_slip.id,
      jsonb_build_object(
        'expenseLocationId', v_old_location_id,
        'paymentMethod', case when v_old_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM' else 'BRANCH' end
      ),
      jsonb_build_object(
        'expenseLocationId', p_expense_location_id,
        'paymentMethod', case when p_expense_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM' else 'BRANCH' end
      ),
      coalesce(p_comment, '')
    );
  end if;

  return jsonb_build_object(
    'status', 'updated',
    'oldExpenseLocationId', v_old_location_id,
    'expenseLocationId', p_expense_location_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.delete_time_tracking_source_permanently(p_source_type text, p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_blocked_month text;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid deletion source';
  end if;

  if p_source_type = 'transaction' then
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_tx.profile_id::text, 0));
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;
    if not (
      v_tx.status = 'PENDING'
      and v_tx.type = 'WITHDRAWAL'
      and v_tx.profile_id = v_actor_id
    ) and not private.can_manage_time_payroll_profile(v_tx.profile_id) then
      raise exception 'Forbidden';
    end if;

    if v_tx.status = 'APPROVED'
      and not private.is_global_time_payroll_manager()
      and v_tx.expense_location_id is not null
      and not private.can_assign_time_tracking_expense_location(v_tx.expense_location_id)
    then raise exception 'Existing expense location access denied'; end if;

    select ps.month into v_blocked_month
    from public.payroll_slips ps
    where ps.profile_id = v_tx.profile_id
      and (
        ps.month = to_char(v_tx.effective_date, 'YYYY-MM')
        or exists (
          select 1
          from public.financial_transactions child
          where child.parent_debt_id = v_tx.id
            and child.applied_month is not null
            and ps.month = to_char(child.applied_month, 'YYYY-MM')
        )
      )
    order by ps.month
    limit 1;
    if v_blocked_month is not null then
      raise exception 'MONTH_CLOSED:%', v_blocked_month;
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'financial_transactions'
      and (
        record_id = v_tx.id
        or record_id in (
          select id from public.financial_transactions where parent_debt_id = v_tx.id
        )
      );

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.financial_transactions where parent_debt_id = v_tx.id;
    delete from public.financial_transactions where id = v_tx.id;
  else
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id;
    if not found then
      raise exception 'Payroll slip not found';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_slip.profile_id::text, 0));
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found then
      raise exception 'Payroll slip not found';
    end if;
    if not private.can_manage_time_payroll_profile(v_slip.profile_id) then
      raise exception 'Forbidden';
    end if;

    if v_slip.status = 'APPROVED'
      and not private.is_global_time_payroll_manager()
      and v_slip.expense_location_id is not null
      and not private.can_assign_time_tracking_expense_location(v_slip.expense_location_id)
    then raise exception 'Existing expense location access denied'; end if;

    if exists (
      select 1
      from public.payroll_slips newer
      where newer.profile_id = v_slip.profile_id and newer.month > v_slip.month
    ) then
      select min(newer.month) into v_blocked_month
      from public.payroll_slips newer
      where newer.profile_id = v_slip.profile_id and newer.month > v_slip.month;
      raise exception 'DELETE_NEWER_SLIP_FIRST:%', v_blocked_month;
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'payroll_slips' and record_id = v_slip.id;

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.payroll_slips where id = v_slip.id;
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'sourceType', p_source_type,
    'sourceId', p_source_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.create_time_tracking_transaction(p_profile_id uuid, p_type text, p_amount numeric, p_effective_date date, p_description text, p_expense_location_id uuid, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_expense_location_id is not null and (
    p_type <> 'WITHDRAWAL' or not private.can_manage_time_payroll_profile(p_profile_id)
    or not private.can_assign_time_tracking_expense_location(p_expense_location_id)
  ) then raise exception 'Expense location access denied'; end if;
  v_created := public.create_time_tracking_transaction_internal_20260829(
    p_profile_id, p_type, p_amount, v_effective_date, p_description
  );
  if private.can_manage_time_payroll_profile(p_profile_id) then
    v_decision := public.decide_time_tracking_approval(
      'transaction', (v_created ->> 'id')::uuid, 'APPROVED', p_comment, p_expense_location_id
    );
    return v_created || jsonb_build_object('status', 'approved', 'decision', v_decision);
  end if;
  return v_created;
end
$function$;

create or replace function public.create_time_tracking_transaction(
  p_profile_id uuid, p_type text, p_amount numeric, p_effective_date date, p_description text default null
) returns jsonb language sql security definer set search_path = '' as $$
  select public.create_time_tracking_transaction(p_profile_id, p_type, p_amount, p_effective_date, p_description, null, null)
$$;
revoke all on function public.create_time_tracking_transaction(uuid,text,numeric,date,text,uuid,text) from public, anon;
grant execute on function public.create_time_tracking_transaction(uuid,text,numeric,date,text,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_time_tracking_payroll_slip(p_profile_id uuid, p_month text, p_auto_start_next_month boolean, p_expense_location_id uuid, p_comment text, p_expected_net_pay numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_month date;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_scan_month date;
  v_first_active_month date;
  v_created jsonb;
  v_attendance jsonb;
  v_final jsonb;
begin
  if not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_expense_location_id is not null and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
  then raise exception 'Expense location access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'INVALID_MONTH'; end if;
  begin v_month := (p_month || '-01')::date; exception when others then raise exception 'INVALID_MONTH'; end;
  if to_char(v_month, 'YYYY-MM') <> p_month then raise exception 'INVALID_MONTH'; end if;

  if exists (
    select 1
    from public.time_payroll_active_periods ap
    where ap.profile_id = p_profile_id
      and ap.scheduled_action is not null
      and ap.scheduled_activation_on > v_today
      and (
        to_char(ap.scheduled_effective_on, 'YYYY-MM') = p_month
        or to_char(ap.scheduled_activation_on, 'YYYY-MM') = p_month
      )
  ) then raise exception 'PENDING_PERIOD_ACTION:%', p_month; end if;

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

  v_created := public.create_time_tracking_payroll_slip_internal_20260901(
    p_profile_id, p_month, false
  );
  v_attendance := public.get_time_payroll_attendance_month(p_profile_id, p_month);
  update public.payroll_slips
  set slip_data = coalesce(slip_data, '{}'::jsonb) || jsonb_build_object('attendance', v_attendance)
  where id = (v_created ->> 'id')::uuid;
  if p_expected_net_pay is not null and p_expected_net_pay is distinct from (v_created ->> 'net_pay')::numeric then
    raise exception 'PAYROLL_AMOUNT_CHANGED';
  end if;
  if private.can_manage_time_payroll_profile(p_profile_id) then
    perform public.decide_time_tracking_approval('payroll_slip', (v_created ->> 'id')::uuid, 'APPROVED', p_comment,
      case when (v_created ->> 'net_pay')::numeric > 0 then p_expense_location_id else null end);
  end if;
  select to_jsonb(ps) into v_final from public.payroll_slips ps where ps.id = (v_created ->> 'id')::uuid;
  return v_final || jsonb_build_object(
    'auto_start_scheduled',
    coalesce(p_auto_start_next_month, false)
      and coalesce((v_created ->> 'auto_start_scheduled')::boolean, false)
  );
end;
$function$;

create or replace function public.create_time_tracking_payroll_slip(
  p_profile_id uuid, p_month text, p_auto_start_next_month boolean default true
) returns jsonb language sql security definer set search_path = '' as $$
  select public.create_time_tracking_payroll_slip(p_profile_id, p_month, p_auto_start_next_month, null, null, null)
$$;
revoke all on function public.create_time_tracking_payroll_slip(uuid,text,boolean,uuid,text,numeric) from public, anon;
grant execute on function public.create_time_tracking_payroll_slip(uuid,text,boolean,uuid,text,numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.get_actionable_badge_counts()
 RETURNS TABLE(location_id uuid, module_id text, item_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_can_manage_system boolean;
  v_can_use_money_transfer boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select p.role,
    p.role = 'super_admin' or p.can_access_super_admin_features = true,
    p.role = 'super_admin' or p.can_access_super_admin_features = true or p.can_access_money_transfer = true
  into v_role, v_can_manage_system, v_can_use_money_transfer
  from public.profiles p where p.id = v_user_id and p.is_active = true;
  if v_role is null then raise exception 'Inactive profile'; end if;

  return query
  with accessible_locations as (
    select ul.location_id from public.user_locations ul
    join public.locations l on l.id = ul.location_id and l.is_active = true
    where ul.user_id = v_user_id
  ), scoped_time_requests as (
    select ft.id, ft.profile_id
    from public.financial_transactions ft
    where ft.status = 'PENDING' and ft.type in ('DEBT', 'WITHDRAWAL')
    union all
    select ps.id, ps.profile_id
    from public.payroll_slips ps
    where ps.status = 'PENDING'
  ), counts as (
    select al.location_id, 'rubber'::text module_id, count(distinct w.work_identity)::bigint item_count
    from accessible_locations al
    cross join lateral private.rubber_bill_current_work_items(al.location_id) w
    where w.work_kind = 'unpriced' or (v_can_manage_system and w.work_kind = 'pending_approval')
    group by al.location_id

    union all
    select al.location_id, 'rubber-evidence'::text, count(*)::bigint
    from accessible_locations al
    join private.rubber_bill_evidence_projection p on p.location_id = al.location_id
    where p.review_status = 'pending'
    group by al.location_id

    union all
    select t.target_location_id, 'cash', count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    join accessible_locations al on al.location_id = t.target_location_id
    where d.cash_status = 'pending_receipt' and t.record_status <> 'deleted'
    group by t.target_location_id

    union all
    select r.location_id, 'cash', count(*)::bigint
    from public.income_expense_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select r.source_location_id, 'cash', count(*)::bigint
    from public.cash_transfer_delete_requests r
    join accessible_locations al on al.location_id = r.source_location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.source_location_id

    union all
    select t.location_id, 'money-transfer', count(*)::bigint
    from public.money_transfers t
    join accessible_locations al on al.location_id = t.location_id
    where v_can_use_money_transfer and t.transfer_method = 'bank'
      and t.transfer_status in ('pending', 'partial', 'advance_payment')
      and t.record_status <> 'deleted'
    group by t.location_id

    union all
    select r.location_id, 'acid-stock', count(*)::bigint
    from public.stock_entry_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select al.location_id, 'acid-stock', count(r.id)::bigint
    from accessible_locations al cross join public.stock_product_approval_requests r
    where v_can_manage_system and r.request_status = 'pending'
    group by al.location_id

    union all
    select target_primary.location_id, 'time-tracking', count(requests.id)::bigint
    from scoped_time_requests requests
    join public.user_locations target_primary
      on target_primary.user_id = requests.profile_id and target_primary.is_primary = true
    join accessible_locations al on al.location_id = target_primary.location_id
    where private.can_manage_time_payroll_profile(requests.profile_id)
    group by target_primary.location_id

    union all
    select e.location_id, 'rubber-export', count(*)::bigint
    from public.rubber_exports e
    join accessible_locations al on al.location_id = e.location_id
    where (v_can_manage_system or v_role = 'admin') and e.status = 'draft'
    group by e.location_id
  )
  select c.location_id, c.module_id, sum(c.item_count)::bigint
  from counts c where c.item_count > 0
  group by c.location_id, c.module_id order by c.location_id, c.module_id;
end;
$function$;

-- Computed field: resolve the real source row, never trust caller-supplied composite fields.
create or replace function public.expense_location_name(source_row public.financial_transactions)
returns text language sql stable security definer set search_path = '' as $$
  select l.name from public.financial_transactions source
  join public.locations l on l.id = source.expense_location_id
  where source.id = source_row.id and private.is_active_user()
    and (source.profile_id = auth.uid() or private.can_manage_time_payroll_profile(source.profile_id))
$$;
revoke all on function public.expense_location_name(public.financial_transactions) from public, anon;
grant execute on function public.expense_location_name(public.financial_transactions) to authenticated;

-- Computed field: resolve the real source row, never trust caller-supplied composite fields.
create or replace function public.expense_location_name(source_row public.payroll_slips)
returns text language sql stable security definer set search_path = '' as $$
  select l.name from public.payroll_slips source
  join public.locations l on l.id = source.expense_location_id
  where source.id = source_row.id and private.is_active_user()
    and (source.profile_id = auth.uid() or private.can_manage_time_payroll_profile(source.profile_id))
$$;
revoke all on function public.expense_location_name(public.payroll_slips) from public, anon;
grant execute on function public.expense_location_name(public.payroll_slips) to authenticated;

-- Read-only quote; creation checks the expected amount in the same transaction.
-- Older open work months remain rejected by the existing creation guards.
create or replace function public.preview_time_tracking_payroll_slip(p_profile_id uuid, p_month text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date;
  v_gross numeric;
  v_used numeric;
  v_remaining numeric;
  v_wage numeric;
begin
  if not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_MONTH'; end if;
  v_month := (p_month || '-01')::date;
  if v_month > date_trunc('month', now() at time zone 'Asia/Bangkok')::date then raise exception 'INVALID_MONTH'; end if;
  if exists (select 1 from public.payroll_slips where profile_id = p_profile_id and month = p_month)
  then raise exception 'MONTH_CLOSED:%', p_month; end if;
  select daily_wage into v_wage from public.profiles where id = p_profile_id;
  v_gross := trunc(public.calculate_paid_work_days(p_profile_id,
    v_month::timestamp at time zone 'Asia/Bangkok',
    (v_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok') * v_wage, 2);
  select coalesce(sum(amount), 0) into v_used from public.financial_transactions
  where profile_id = p_profile_id and status = 'APPROVED'
    and type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION') and applied_month = v_month;
  select coalesce(sum(remaining_amount), 0) into v_remaining from public.financial_transactions
  where profile_id = p_profile_id and status = 'APPROVED'
    and type in ('DEBT', 'WITHDRAWAL') and effective_date < (v_month + interval '1 month')::date;
  return jsonb_build_object('netPay', round(greatest(v_gross - v_used - v_remaining, 0), 0));
end
$$;
revoke all on function public.preview_time_tracking_payroll_slip(uuid,text) from public, anon;
grant execute on function public.preview_time_tracking_payroll_slip(uuid,text) to authenticated;
notify pgrst, 'reload schema';
