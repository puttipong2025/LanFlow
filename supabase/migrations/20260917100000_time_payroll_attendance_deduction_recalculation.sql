-- Rebuild provisional deductions when an attendance correction changes paid days.
-- Payroll slips remain immutable; the existing wage planner stays the sole calculator.

create or replace function private.assert_attendance_range_without_payroll_slip(
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
  v_slip_id uuid;
  v_slip_status text;
  v_report_no text;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    return;
  end if;

  for v_month in
    select generate_series(
      date_trunc('month', p_start_date)::timestamp,
      date_trunc('month', p_end_date)::timestamp,
      interval '1 month'
    )::date
  loop
    select ps.id, ps.status::text, public.report_lock_no(ps)
    into v_slip_id, v_slip_status, v_report_no
    from public.payroll_slips ps
    where ps.profile_id = p_profile_id
      and ps.month = to_char(v_month, 'YYYY-MM')
      and ps.status in ('PENDING', 'APPROVED')
    order by (public.report_lock_no(ps) is not null) desc, ps.created_at desc
    limit 1;

    if found then
      if v_report_no is not null then
        raise exception 'REPORT_LOCKED:%:PAYROLL_SLIP:%:%:%',
          v_report_no, to_char(v_month, 'YYYY-MM'), v_slip_status, v_slip_id;
      end if;
      raise exception 'MONTH_CLOSED:%:PAYROLL_SLIP:%:%',
        to_char(v_month, 'YYYY-MM'), v_slip_status, v_slip_id;
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_attendance_range_without_payroll_slip(uuid, date, date)
  from public, anon, authenticated;

create or replace function private.rebuild_open_deductions_after_attendance(
  p_profile_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
  v_previous_flag text := current_setting('app.time_payroll_settlement_rpc', true);
  v_daily_wage numeric;
  v_plan jsonb;
  v_old_canonical jsonb;
  v_new_canonical jsonb;
  v_open_months jsonb;
  v_old_open_deduction numeric;
  v_new_open_deduction numeric;
  v_parent_balance jsonb;
  v_allocation jsonb;
  v_created_allocations jsonb := '[]'::jsonb;
  v_created_id uuid;
  v_comment text;
begin
  if p_profile_id is null or p_actor is null then
    raise exception 'INVALID_ATTENDANCE_RECALCULATION';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  select p.daily_wage into v_daily_wage
  from public.profiles p
  where p.id = p_profile_id and p.is_active = true
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  v_plan := private.plan_time_tracking_deductions(
    p_profile_id,
    v_daily_wage,
    v_current_month,
    true
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'parentId', grouped.parent_id,
      'type', grouped.deduction_type,
      'amount', grouped.amount,
      'appliedMonth', grouped.applied_month
    ) order by grouped.applied_month, grouped.parent_id, grouped.deduction_type
  ), '[]'::jsonb)
  into v_old_canonical
  from (
    select
      item ->> 'parentId' as parent_id,
      item ->> 'type' as deduction_type,
      item ->> 'appliedMonth' as applied_month,
      sum((item ->> 'amount')::numeric) as amount
    from jsonb_array_elements(v_plan -> 'oldAllocations') item
    group by item ->> 'parentId', item ->> 'type', item ->> 'appliedMonth'
  ) grouped;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'parentId', grouped.parent_id,
      'type', grouped.deduction_type,
      'amount', grouped.amount,
      'appliedMonth', grouped.applied_month
    ) order by grouped.applied_month, grouped.parent_id, grouped.deduction_type
  ), '[]'::jsonb)
  into v_new_canonical
  from (
    select
      item ->> 'parentId' as parent_id,
      item ->> 'type' as deduction_type,
      item ->> 'appliedMonth' as applied_month,
      sum((item ->> 'amount')::numeric) as amount
    from jsonb_array_elements(v_plan -> 'allocations') item
    group by item ->> 'parentId', item ->> 'type', item ->> 'appliedMonth'
  ) grouped;

  select
    coalesce(jsonb_agg(month_row order by month_row ->> 'month'), '[]'::jsonb),
    coalesce(sum((month_row ->> 'oldDeduction')::numeric), 0),
    coalesce(sum((month_row ->> 'newDeduction')::numeric), 0)
  into v_open_months, v_old_open_deduction, v_new_open_deduction
  from jsonb_array_elements(v_plan -> 'months') month_row
  where (month_row ->> 'closed')::boolean = false;

  if v_old_canonical = v_new_canonical then
    return jsonb_build_object(
      'deductionsChanged', false,
      'oldOpenDeduction', v_old_open_deduction,
      'newOpenDeduction', v_new_open_deduction
    );
  end if;

  perform set_config('app.time_payroll_settlement_rpc', 'true', true);
  begin
    delete from public.financial_transactions child
    using public.financial_transactions parent
    where child.profile_id = p_profile_id
      and child.parent_debt_id = parent.id
      and child.status = 'APPROVED'
      and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and child.applied_month <= v_current_month
      and parent.profile_id = p_profile_id
      and parent.status = 'APPROVED'
      and parent.type in ('DEBT', 'WITHDRAWAL')
      and not private.is_time_payroll_month_closed(
        p_profile_id,
        to_char(child.applied_month, 'YYYY-MM')
      );

    for v_parent_balance in
      select value from jsonb_array_elements(v_plan -> 'parentBalances')
    loop
      update public.financial_transactions
      set remaining_amount = (v_parent_balance ->> 'newRemaining')::numeric
      where id = (v_parent_balance ->> 'parentId')::uuid
        and profile_id = p_profile_id
        and status = 'APPROVED'
        and type in ('DEBT', 'WITHDRAWAL');
      if not found then raise exception 'ATTENDANCE_DEDUCTION_PLAN_STALE'; end if;
    end loop;

    for v_allocation in
      select value from jsonb_array_elements(v_plan -> 'allocations')
    loop
      v_comment := case
        when v_allocation ->> 'type' = 'DEBT_DEDUCTION' then 'หักหนี้อัตโนมัติหลังแก้วันทำงาน'
        else 'หักยอดเบิกเงินอัตโนมัติหลังแก้วันทำงาน'
      end;
      insert into public.financial_transactions (
        profile_id, type, amount, status, parent_debt_id, applied_month,
        admin_comment, approved_by, approved_at
      ) values (
        p_profile_id,
        (v_allocation ->> 'type')::public.financial_transaction_type,
        (v_allocation ->> 'amount')::numeric,
        'APPROVED',
        (v_allocation ->> 'parentId')::uuid,
        ((v_allocation ->> 'appliedMonth') || '-01')::date,
        v_comment,
        p_actor,
        now()
      ) returning id into v_created_id;
      v_created_allocations := v_created_allocations || jsonb_build_array(
        v_allocation || jsonb_build_object('id', v_created_id)
      );
    end loop;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      p_actor,
      'RECALCULATE_ATTENDANCE_DEDUCTIONS',
      'financial_transactions',
      p_profile_id,
      jsonb_build_object(
        'totalOpenDeduction', v_old_open_deduction,
        'allocations', v_plan -> 'oldAllocations'
      ),
      jsonb_build_object(
        'totalOpenDeduction', v_new_open_deduction,
        'months', v_open_months,
        'allocations', v_created_allocations
      ),
      'แก้วันทำงานและคำนวณยอดหักหนี้/เงินเบิกของเดือนเปิดใหม่'
    );
  exception when others then
    perform set_config(
      'app.time_payroll_settlement_rpc',
      coalesce(nullif(v_previous_flag, ''), 'false'),
      true
    );
    raise;
  end;
  perform set_config(
    'app.time_payroll_settlement_rpc',
    coalesce(nullif(v_previous_flag, ''), 'false'),
    true
  );

  return jsonb_build_object(
    'deductionsChanged', true,
    'oldOpenDeduction', v_old_open_deduction,
    'newOpenDeduction', v_new_open_deduction
  );
end;
$$;

revoke all on function private.rebuild_open_deductions_after_attendance(uuid, uuid)
  from public, anon, authenticated;

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
  v_rebuild jsonb;
  v_selection jsonb;
  v_selection_date date;
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
  for v_selection in select value from jsonb_array_elements(p_selections)
  loop
    if (v_selection ->> 'date') is null
      or (v_selection ->> 'date') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    then raise exception 'INVALID_ATTENDANCE_SELECTIONS'; end if;
    begin
      v_selection_date := (v_selection ->> 'date')::date;
    exception when others then
      raise exception 'INVALID_ATTENDANCE_SELECTIONS';
    end;
    if to_char(v_selection_date, 'YYYY-MM-DD') <> v_selection ->> 'date'
    then raise exception 'INVALID_ATTENDANCE_SELECTIONS'; end if;
    if v_selection_date > v_today then raise exception 'FUTURE_ATTENDANCE_DATE'; end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  perform private.assert_attendance_range_without_payroll_slip(p_profile_id, v_month, v_month);
  for v_selection in select value from jsonb_array_elements(p_selections)
  loop
    v_selection_date := (v_selection ->> 'date')::date;
    if (v_selection ->> 'status') is null
      or (v_selection ->> 'status') not in ('HALF_DAY', 'OFF')
      or v_selection_date < v_month
      or v_selection_date >= v_next
      or not exists (
        select 1 from public.time_payroll_active_periods ap
        where ap.profile_id = p_profile_id and ap.start_on <= v_selection_date
          and (ap.end_on is null or ap.end_on >= v_selection_date)
      )
    then raise exception 'INVALID_ATTENDANCE_SELECTIONS'; end if;
  end loop;
  if (
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

  v_rebuild := private.rebuild_open_deductions_after_attendance(p_profile_id, v_actor);
  return jsonb_build_object('changed', v_changed, 'month', p_month) || v_rebuild;
end;
$$;

revoke all on function public.replace_time_payroll_attendance_exceptions(uuid, text, jsonb)
  from public, anon;
grant execute on function public.replace_time_payroll_attendance_exceptions(uuid, text, jsonb)
  to authenticated;

create or replace function public.correct_time_payroll_period_start(
  p_profile_id uuid,
  p_period_id uuid,
  p_start_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_rebuild jsonb;
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
  perform private.assert_attendance_range_without_payroll_slip(
    p_profile_id,
    v_affected_from,
    v_affected_through
  );

  update public.time_payroll_active_periods
  set start_on = p_start_on,
      updated_by = v_actor,
      updated_at = now()
  where id = v_target.id;

  v_rebuild := private.rebuild_open_deductions_after_attendance(p_profile_id, v_actor);
  return jsonb_build_object(
    'profileId', p_profile_id,
    'periodId', v_target.id,
    'oldStartOn', v_old_start_on,
    'newStartOn', p_start_on,
    'affectedFrom', v_affected_from,
    'affectedThrough', v_affected_through
  ) || v_rebuild;
end;
$$;

revoke all on function public.correct_time_payroll_period_start(uuid, uuid, date)
  from public, anon;
grant execute on function public.correct_time_payroll_period_start(uuid, uuid, date)
  to authenticated;
