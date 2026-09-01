-- Preserve daily-wage precision up to four decimal places and make the
-- rounded whole-baht payroll net the only payment/accounting amount.

begin;

lock table public.payroll_slips in share row exclusive mode;

do $$
begin
  if exists (select 1 from public.payroll_slips) then
    raise exception 'PAYROLL_SLIPS_NOT_EMPTY';
  end if;
end
$$;

alter table public.profiles
  add constraint profiles_daily_wage_precision check (
    daily_wage >= 0 and daily_wage = trunc(daily_wage, 4)
  ) not valid;

alter table public.profiles validate constraint profiles_daily_wage_precision;

alter table public.payroll_slips
  add constraint payroll_slips_net_pay_whole_baht check (
    net_pay >= 0 and net_pay = trunc(net_pay, 0)
  ) not valid;

alter table public.payroll_slips validate constraint payroll_slips_net_pay_whole_baht;

create or replace function public.create_time_tracking_payroll_slip_internal_20260901(
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
  v_actor_id uuid := auth.uid();
  v_month date;
  v_next_month date;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
  v_scan_month date;
  v_first_segment_month date;
  v_active_segment public.time_segments%rowtype;
  v_was_running boolean := false;
  v_daily_wage numeric;
  v_total_days numeric;
  v_gross numeric;
  v_deductions numeric;
  v_net_before_rounding numeric;
  v_net numeric;
  v_rounding_adjustment numeric;
  v_segments jsonb;
  v_transactions jsonb;
  v_slip public.payroll_slips%rowtype;
  v_blocker record;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'INVALID_MONTH';
  end if;

  begin
    v_month := (p_month || '-01')::date;
  exception when others then
    raise exception 'INVALID_MONTH';
  end;
  if to_char(v_month, 'YYYY-MM') <> p_month or v_month > v_current_month then
    raise exception 'INVALID_MONTH';
  end if;
  v_next_month := (v_month + interval '1 month')::date;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));

  if exists (
    select 1 from public.payroll_slips ps
    where ps.profile_id = p_profile_id and ps.month = p_month
  ) then
    raise exception 'MONTH_CLOSED:%', p_month;
  end if;

  select ft.id, ft.type::text type, ft.effective_date
  into v_blocker
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and ft.type in ('DEBT', 'WITHDRAWAL')
    and ft.status = 'PENDING'
    and ft.effective_date < v_next_month
  order by ft.effective_date, ft.created_at, ft.id
  limit 1;
  if found then
    raise exception 'PENDING_BLOCKER:%:%:%',
      v_blocker.type,
      v_blocker.id,
      to_char(v_blocker.effective_date, 'YYYY-MM');
  end if;

  select min(date_trunc('month', s.start_time at time zone 'Asia/Bangkok')::date)
  into v_first_segment_month
  from public.time_segments s
  where s.profile_id = p_profile_id;

  if v_first_segment_month is not null then
    for v_scan_month in
      select generate_series(
        v_first_segment_month::timestamp,
        (v_month - interval '1 month')::timestamp,
        interval '1 month'
      )::date
    loop
      if not exists (
        select 1 from public.payroll_slips ps
        where ps.profile_id = p_profile_id
          and ps.month = to_char(v_scan_month, 'YYYY-MM')
      ) and public.calculate_paid_work_days(
        p_profile_id,
        v_scan_month::timestamp at time zone 'Asia/Bangkok',
        (v_scan_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
      ) > 0 then
        raise exception 'OLDER_WORK_MONTH:%', to_char(v_scan_month, 'YYYY-MM');
      end if;
    end loop;
  end if;

  if v_month = v_current_month then
    select * into v_active_segment
    from public.time_segments s
    where s.profile_id = p_profile_id and s.end_time is null
    for update;
    if found then
      v_was_running := true;
      update public.time_segments
      set end_time = now()
      where id = v_active_segment.id;
    end if;
  end if;

  v_total_days := public.calculate_paid_work_days(
    p_profile_id,
    v_month::timestamp at time zone 'Asia/Bangkok',
    v_next_month::timestamp at time zone 'Asia/Bangkok'
  );

  if v_month < v_current_month and v_total_days <= 0 then
    raise exception 'NO_WORK_MONTH:%', p_month;
  end if;

  perform private.apply_time_tracking_deductions(p_profile_id, v_month);

  select p.daily_wage into v_daily_wage
  from public.profiles p
  where p.id = p_profile_id;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  v_gross := trunc(v_total_days * v_daily_wage, 2);
  select coalesce(sum(ft.amount), 0)
  into v_deductions
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and ft.status = 'APPROVED'
    and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
    and ft.applied_month = v_month;
  v_net_before_rounding := greatest(v_gross - v_deductions, 0);
  v_net := round(v_net_before_rounding, 0);
  v_rounding_adjustment := v_net - v_net_before_rounding;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.start_time), '[]'::jsonb)
  into v_segments
  from public.time_segments s
  where s.profile_id = p_profile_id
    and s.end_time is not null
    and s.end_time > (v_month::timestamp at time zone 'Asia/Bangkok')
    and s.start_time < (v_next_month::timestamp at time zone 'Asia/Bangkok');

  select coalesce(jsonb_agg(to_jsonb(ft) order by ft.created_at, ft.id), '[]'::jsonb)
  into v_transactions
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and (
      (
        ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and ft.applied_month = v_month
      )
      or
      (
        ft.type in ('DEBT', 'WITHDRAWAL')
        and ft.effective_date >= v_month
        and ft.effective_date < v_next_month
      )
    );

  insert into public.payroll_slips (
    profile_id,
    month,
    gross_pay,
    total_deductions,
    net_pay,
    total_days,
    daily_wage,
    slip_data,
    status,
    created_by
  )
  values (
    p_profile_id,
    p_month,
    v_gross,
    v_deductions,
    v_net,
    v_total_days,
    v_daily_wage,
    jsonb_build_object(
      'segments', v_segments,
      'transactions', v_transactions,
      'netPayBeforeRounding', v_net_before_rounding,
      'roundingAdjustment', v_rounding_adjustment,
      'lockedAt', now()
    ),
    'PENDING',
    v_actor_id
  )
  returning * into v_slip;

  if v_month = v_current_month and v_was_running and p_auto_start_next_month then
    insert into public.time_tracking_resume_schedules (
      profile_id,
      payroll_slip_id,
      resume_at,
      created_by
    )
    values (
      p_profile_id,
      v_slip.id,
      v_next_month::timestamp at time zone 'Asia/Bangkok',
      v_actor_id
    )
    on conflict (profile_id) do update
    set
      payroll_slip_id = excluded.payroll_slip_id,
      resume_at = excluded.resume_at,
      created_by = excluded.created_by,
      created_at = now();
  else
    delete from public.time_tracking_resume_schedules
    where profile_id = p_profile_id;
  end if;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data, comment
  )
  values (
    v_actor_id,
    'CREATE_PAYROLL_SLIP',
    'payroll_slips',
    v_slip.id,
    to_jsonb(v_slip) || jsonb_build_object(
      'was_running', v_was_running,
      'auto_start_next_month', v_month = v_current_month
        and v_was_running
        and p_auto_start_next_month
    ),
    'สร้างสลิปเดือน ' || p_month
  );

  return to_jsonb(v_slip) || jsonb_build_object(
    'auto_start_scheduled',
    v_month = v_current_month and v_was_running and p_auto_start_next_month
  );
end;
$$;

revoke all on function public.create_time_tracking_payroll_slip_internal_20260901(uuid, text, boolean)
from public, anon, authenticated;

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
  if private.is_global_time_payroll_manager() then
    perform public.decide_time_tracking_approval('payroll_slip', (v_created ->> 'id')::uuid, 'APPROVED', null, null);
  end if;
  select to_jsonb(ps) into v_final from public.payroll_slips ps where ps.id = (v_created ->> 'id')::uuid;
  return v_final || jsonb_build_object(
    'auto_start_scheduled',
    coalesce(p_auto_start_next_month, false)
      and coalesce((v_created ->> 'auto_start_scheduled')::boolean, false)
  );
end;
$$;

create or replace function public.update_time_tracking_wage_internal_20260901(
  p_profile_id uuid,
  p_daily_wage numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_old_wage numeric;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_daily_wage is null or p_daily_wage < 0 then
    raise exception 'INVALID_WAGE';
  end if;
  if p_daily_wage <> trunc(p_daily_wage, 4) then
    raise exception 'INVALID_WAGE_PRECISION';
  end if;

  select p.daily_wage into v_old_wage
  from public.profiles p
  where p.id = p_profile_id
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if exists (
    select 1
    from public.financial_transactions ft
    where ft.profile_id = p_profile_id
      and ft.status = 'APPROVED'
      and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and not exists (
        select 1
        from public.payroll_slips ps
        where ps.profile_id = p_profile_id
          and ps.month = to_char(ft.applied_month, 'YYYY-MM')
      )
  ) then
    raise exception 'DEDUCTION_WAGE_LOCKED';
  end if;

  update public.profiles
  set daily_wage = p_daily_wage
  where id = p_profile_id;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, new_data
  )
  values (
    v_actor_id,
    'UPDATE_WAGE',
    'profiles',
    p_profile_id,
    jsonb_build_object('daily_wage', v_old_wage),
    jsonb_build_object('daily_wage', p_daily_wage)
  );

  return jsonb_build_object('dailyWage', p_daily_wage);
end;
$$;

revoke all on function public.update_time_tracking_wage_internal_20260901(uuid, numeric)
from public, anon, authenticated;

create or replace function public.update_time_tracking_wage(
  p_profile_id uuid,
  p_daily_wage numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  return public.update_time_tracking_wage_internal_20260901(p_profile_id, p_daily_wage);
end;
$$;

create or replace function public.get_dashboard_money_history(
  p_location_id uuid,
  p_event_date date default null,
  p_action text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  today_bangkok date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  from_date date := (current_timestamp at time zone 'Asia/Bangkok')::date - 14;
  selected_date date;
  normalized_action text := nullif(p_action, 'all');
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'Location access denied';
  end if;

  if normalized_action is not null
    and normalized_action not in ('create', 'update', 'delete')
  then
    raise exception 'Invalid money history action';
  end if;

  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'Invalid money history cursor';
  end if;

  if p_event_date is not null
    and (p_event_date < from_date or p_event_date > today_bangkok)
  then
    raise exception 'Money history date is outside retention window';
  end if;

  selected_date := p_event_date;
  if selected_date is null then
    select max(event_date)
    into selected_date
    from public.dashboard_money_events
    where location_id = p_location_id
      and event_date between from_date and today_bangkok;
    selected_date := coalesce(selected_date, today_bangkok);
  end if;

  return (
    with filtered as (
      select event.*
      from public.dashboard_money_events event
      where event.location_id = p_location_id
        and event.event_date = selected_date
        and (normalized_action is null or event.action = normalized_action)
        and (
          p_cursor_at is null
          or (event.occurred_at, event.id) < (p_cursor_at, p_cursor_id)
        )
      order by event.occurred_at desc, event.id desc
      limit page_size + 1
    ),
    visible as (
      select *
      from filtered
      order by occurred_at desc, id desc
      limit page_size
    ),
    counts as (
      select
        count(*) as total,
        count(*) filter (where action = 'create') as created,
        count(*) filter (where action = 'update') as updated,
        count(*) filter (where action = 'delete') as deleted,
        max(occurred_at) as latest_at
      from public.dashboard_money_events
      where location_id = p_location_id
        and event_date = selected_date
    )
    select jsonb_build_object(
      'selectedDate', selected_date,
      'availableFrom', from_date,
      'availableTo', today_bangkok,
      'counts', jsonb_build_object(
        'all', counts.total,
        'create', counts.created,
        'update', counts.updated,
        'delete', counts.deleted
      ),
      'latestAt', counts.latest_at,
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'sourceType', source_type,
          'action', action,
          'kind', kind,
          'number', number,
          'title', title,
          'direction', direction,
          'amount', round(amount, 2),
          'actorName', actor_name,
          'occurredAt', occurred_at
        ) order by occurred_at desc, id desc)
        from visible
      ), '[]'::jsonb),
      'nextCursor', case
        when (select count(*) from filtered) > page_size then (
          select jsonb_build_object('at', occurred_at, 'id', id)
          from visible
          order by occurred_at desc, id desc
          offset page_size - 1
          limit 1
        )
        else null
      end
    )
    from counts
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
