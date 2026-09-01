-- Schedule active-period changes by Bangkok calendar dates without a cron job.
-- Date ranges remain the calculation source of truth; schedule metadata exists
-- only for the next user-visible action and is retired lazily under the same
-- employee advisory lock used by payroll close.

alter table public.time_payroll_active_periods
  add column scheduled_action text,
  add column scheduled_effective_on date,
  add column scheduled_activation_on date;

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
      and scheduled_activation_on = case
        when scheduled_action = 'END' then scheduled_effective_on + 1
        else scheduled_effective_on
      end
    )
  );

create unique index time_payroll_active_period_one_scheduled
  on public.time_payroll_active_periods(profile_id)
  where scheduled_action is not null;

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

  v_activation_on := case when p_action = 'END' then p_effective_date + 1 else p_effective_date end;
  v_is_scheduled := v_activation_on > v_today;

  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));

  -- No volatile date predicate is used by the unique index. Retire metadata
  -- here before accepting another action; the date range already represents
  -- the effective state once activation_on is reached.
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
  end if;

  -- Scheduling and rescheduling must not mutate a month whose payroll snapshot
  -- or deduction ledger is already closed.
  perform private.assert_attendance_month_open(p_profile_id, to_char(p_effective_date, 'YYYY-MM'));
  if to_char(v_activation_on, 'YYYY-MM') <> to_char(p_effective_date, 'YYYY-MM') then
    perform private.assert_attendance_month_open(p_profile_id, to_char(v_activation_on, 'YYYY-MM'));
  end if;

  select * into v_current
  from public.time_payroll_active_periods ap
  where ap.profile_id = p_profile_id
    and ap.start_on <= v_today
    and (ap.end_on is null or ap.end_on >= v_today)
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
    if not v_is_scheduled then
      perform private.assert_attendance_range_open(p_profile_id, p_effective_date + 1, v_today);
    end if;
    update public.time_payroll_active_periods
    set end_on = p_effective_date,
        scheduled_action = case when v_is_scheduled then p_action else null end,
        scheduled_effective_on = case when v_is_scheduled then p_effective_date else null end,
        scheduled_activation_on = case when v_is_scheduled then v_activation_on else null end,
        updated_by = v_actor,
        updated_at = now()
    where id = v_current.id;
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
      'scheduled', v_is_scheduled
    ),
    case
      when v_is_scheduled then format(
        'ตั้งกำหนดการ %s: วันที่เลือก %s มีผลจริง %s 00:00 Asia/Bangkok',
        p_action, p_effective_date, v_activation_on
      )
      else format('เปลี่ยนช่วงเงินเดือน %s มีผลวันที่ %s Asia/Bangkok', p_action, v_activation_on)
    end
  );

  return jsonb_build_object(
    'profileId', p_profile_id,
    'action', p_action,
    'selectedEffectiveOn', p_effective_date,
    'activationOn', v_activation_on,
    'scheduled', v_is_scheduled
  );
end
$$;

revoke all on function public.set_time_payroll_active_period(uuid, text, date) from public, anon;
grant execute on function public.set_time_payroll_active_period(uuid, text, date) to authenticated;

create or replace function public.cancel_time_payroll_active_period_schedule(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_pending public.time_payroll_active_periods%rowtype;
begin
  if v_actor is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
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
$$;

revoke all on function public.cancel_time_payroll_active_period_schedule(uuid) from public, anon;
grant execute on function public.cancel_time_payroll_active_period_schedule(uuid) to authenticated;

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
  v_month date;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_scan_month date;
  v_first_active_month date;
  v_created jsonb;
  v_attendance jsonb;
  v_final jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  -- TIMER is retired. Keep the third argument only for RPC compatibility and
  -- enforce the EXCEPTIONS guards even if the settings singleton is missing.
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
  v_created := public.create_time_tracking_payroll_slip_internal_20260829(
    p_profile_id, p_month, false
  );
  v_attendance := public.get_time_payroll_attendance_month(p_profile_id, p_month);
  update public.payroll_slips
  set slip_data = coalesce(slip_data, '{}'::jsonb) || jsonb_build_object('attendance', v_attendance)
  where id = (v_created ->> 'id')::uuid;
  if private.is_global_time_payroll_manager() then
    perform public.decide_time_tracking_approval('payroll_slip', (v_created ->> 'id')::uuid, 'APPROVED', null, null);
  end if;
  select to_jsonb(ps) into v_final from public.payroll_slips ps where ps.id = (v_created ->> 'id')::uuid;
  return v_final || jsonb_build_object(
    'auto_start_scheduled',
    coalesce(p_auto_start_next_month, false)
      and coalesce((v_created ->> 'auto_start_scheduled')::boolean, false)
  );
end
$$;

revoke all on function public.create_time_tracking_payroll_slip(uuid, text, boolean) from public, anon;
grant execute on function public.create_time_tracking_payroll_slip(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
