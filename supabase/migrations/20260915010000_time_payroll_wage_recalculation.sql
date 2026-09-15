-- Recalculate provisional debt/withdrawal deductions when the current daily wage changes.
-- Closed payroll facts remain immutable; no wage-history table is introduced.

create or replace function private.is_time_payroll_month_closed(
  p_profile_id uuid,
  p_month text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.payroll_slips ps
    where ps.profile_id = p_profile_id
      and ps.month = p_month
      and ps.status in ('PENDING', 'APPROVED')
  )
$$;

revoke all on function private.is_time_payroll_month_closed(uuid, text)
  from public, anon, authenticated;

create or replace function private.plan_time_tracking_deductions(
  p_profile_id uuid,
  p_daily_wage numeric,
  p_through_month date,
  p_rebuild_open boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current_month date := date_trunc('month', now() at time zone 'Asia/Bangkok')::date;
  v_through_month date;
  v_old_wage numeric;
  v_first_month date;
  v_month date;
  v_paid_days numeric;
  v_gross numeric;
  v_old_deduction numeric;
  v_added_deduction numeric;
  v_new_deduction numeric;
  v_available numeric;
  v_parent record;
  v_parent_remaining numeric;
  v_amount numeric;
  v_child_type text;
  v_closed_status text;
  v_parent_state jsonb := '{}'::jsonb;
  v_allocations jsonb := '[]'::jsonb;
  v_old_allocations jsonb := '[]'::jsonb;
  v_parent_balances jsonb := '[]'::jsonb;
  v_months jsonb := '[]'::jsonb;
  v_total_old numeric := 0;
  v_total_new numeric := 0;
  v_payload jsonb;
  v_digest text;
begin
  if p_profile_id is null then raise exception 'PROFILE_NOT_FOUND'; end if;
  if p_daily_wage is null or p_daily_wage < 0 or p_daily_wage > 1000000000 then
    raise exception 'INVALID_WAGE';
  end if;
  if p_daily_wage <> trunc(p_daily_wage, 4) then
    raise exception 'INVALID_WAGE_PRECISION';
  end if;
  if p_through_month is null then raise exception 'INVALID_MONTH'; end if;

  v_through_month := least(date_trunc('month', p_through_month)::date, v_current_month);

  select p.daily_wage
  into v_old_wage
  from public.profiles p
  where p.id = p_profile_id
    and p.is_active = true;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  if p_rebuild_open then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', child.id,
        'parentId', child.parent_debt_id,
        'type', child.type::text,
        'amount', child.amount,
        'appliedMonth', to_char(child.applied_month, 'YYYY-MM')
      ) order by child.applied_month, parent.effective_date, parent.created_at, parent.id, child.created_at, child.id
    ), '[]'::jsonb)
    into v_old_allocations
    from public.financial_transactions child
    join public.financial_transactions parent on parent.id = child.parent_debt_id
    where child.profile_id = p_profile_id
      and child.status = 'APPROVED'
      and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and child.applied_month <= v_through_month
      and parent.profile_id = p_profile_id
      and parent.status = 'APPROVED'
      and parent.type in ('DEBT', 'WITHDRAWAL')
      and not private.is_time_payroll_month_closed(
        p_profile_id,
        to_char(child.applied_month, 'YYYY-MM')
      );
  end if;

  for v_parent in
    select
      parent.*,
      trunc(parent.remaining_amount + case when p_rebuild_open then coalesce((
        select sum(child.amount)
        from public.financial_transactions child
        where child.profile_id = p_profile_id
          and child.parent_debt_id = parent.id
          and child.status = 'APPROVED'
          and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
          and child.applied_month <= v_through_month
          and not private.is_time_payroll_month_closed(
            p_profile_id,
            to_char(child.applied_month, 'YYYY-MM')
          )
      ), 0) else 0 end, 2) as restored_remaining
    from public.financial_transactions parent
    where parent.profile_id = p_profile_id
      and parent.status = 'APPROVED'
      and parent.type in ('DEBT', 'WITHDRAWAL')
      and parent.effective_date < (v_through_month + interval '1 month')::date
    order by parent.effective_date, parent.created_at, parent.id
  loop
    if v_parent.restored_remaining <= 0 then continue; end if;
    v_parent_state := jsonb_set(
      v_parent_state,
      array[v_parent.id::text],
      to_jsonb(v_parent.restored_remaining),
      true
    );
    if v_first_month is null then
      v_first_month := date_trunc('month', v_parent.effective_date)::date;
    end if;
  end loop;

  if v_first_month is not null then
    for v_month in
      select generate_series(
        v_first_month::timestamp,
        v_through_month::timestamp,
        interval '1 month'
      )::date
    loop
      select ps.status::text
      into v_closed_status
      from public.payroll_slips ps
      where ps.profile_id = p_profile_id
        and ps.month = to_char(v_month, 'YYYY-MM')
        and ps.status in ('PENDING', 'APPROVED')
      limit 1;

      select coalesce(sum(child.amount), 0)
      into v_old_deduction
      from public.financial_transactions child
      join public.financial_transactions parent on parent.id = child.parent_debt_id
      where child.profile_id = p_profile_id
        and child.status = 'APPROVED'
        and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and child.applied_month = v_month
        and parent.profile_id = p_profile_id
        and parent.status = 'APPROVED'
        and parent.type in ('DEBT', 'WITHDRAWAL');

      if v_closed_status is not null then
        v_months := v_months || jsonb_build_array(jsonb_build_object(
          'month', to_char(v_month, 'YYYY-MM'),
          'closed', true,
          'slipStatus', v_closed_status,
          'paidDays', null,
          'grossPay', null,
          'oldDeduction', v_old_deduction,
          'newDeduction', v_old_deduction,
          'delta', 0,
          'restoredAmount', 0,
          'additionalDeduction', 0
        ));
        continue;
      end if;

      v_paid_days := public.calculate_paid_work_days(
        p_profile_id,
        v_month::timestamp at time zone 'Asia/Bangkok',
        (v_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
      );
      v_gross := trunc(v_paid_days * p_daily_wage, 2);
      v_available := greatest(trunc(
        v_gross - case when p_rebuild_open then 0 else v_old_deduction end,
        2
      ), 0);
      v_added_deduction := 0;

      for v_parent in
        select parent.*
        from public.financial_transactions parent
        where parent.profile_id = p_profile_id
          and parent.status = 'APPROVED'
          and parent.type in ('DEBT', 'WITHDRAWAL')
          and parent.effective_date < (v_month + interval '1 month')::date
        order by parent.effective_date, parent.created_at, parent.id
      loop
        exit when v_available <= 0;
        v_parent_remaining := coalesce((v_parent_state ->> v_parent.id::text)::numeric, 0);
        if v_parent_remaining <= 0 then continue; end if;

        v_amount := trunc(least(v_parent_remaining, v_available), 2);
        if v_amount <= 0 then continue; end if;
        v_child_type := case
          when v_parent.type = 'DEBT' then 'DEBT_DEDUCTION'
          else 'WITHDRAWAL_DEDUCTION'
        end;

        v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
          'parentId', v_parent.id,
          'type', v_child_type,
          'amount', v_amount,
          'appliedMonth', to_char(v_month, 'YYYY-MM')
        ));
        v_parent_remaining := trunc(v_parent_remaining - v_amount, 2);
        v_parent_state := jsonb_set(
          v_parent_state,
          array[v_parent.id::text],
          to_jsonb(v_parent_remaining),
          true
        );
        v_available := trunc(v_available - v_amount, 2);
        v_added_deduction := v_added_deduction + v_amount;
      end loop;

      v_new_deduction := case
        when p_rebuild_open then v_added_deduction
        else v_old_deduction + v_added_deduction
      end;
      v_total_old := v_total_old + v_old_deduction;
      v_total_new := v_total_new + v_new_deduction;
      v_months := v_months || jsonb_build_array(jsonb_build_object(
        'month', to_char(v_month, 'YYYY-MM'),
        'closed', false,
        'slipStatus', null,
        'paidDays', v_paid_days,
        'grossPay', v_gross,
        'oldDeduction', v_old_deduction,
        'newDeduction', v_new_deduction,
        'delta', v_new_deduction - v_old_deduction,
        'restoredAmount', greatest(v_old_deduction - v_new_deduction, 0),
        'additionalDeduction', greatest(v_new_deduction - v_old_deduction, 0)
      ));
    end loop;
  end if;

  for v_parent in
    select
      parent.*,
      trunc(parent.remaining_amount + case when p_rebuild_open then coalesce((
        select sum(child.amount)
        from public.financial_transactions child
        where child.profile_id = p_profile_id
          and child.parent_debt_id = parent.id
          and child.status = 'APPROVED'
          and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
          and child.applied_month <= v_through_month
          and not private.is_time_payroll_month_closed(
            p_profile_id,
            to_char(child.applied_month, 'YYYY-MM')
          )
      ), 0) else 0 end, 2) as restored_remaining
    from public.financial_transactions parent
    where parent.profile_id = p_profile_id
      and parent.status = 'APPROVED'
      and parent.type in ('DEBT', 'WITHDRAWAL')
      and v_parent_state ? parent.id::text
    order by parent.effective_date, parent.created_at, parent.id
  loop
    v_parent_balances := v_parent_balances || jsonb_build_array(jsonb_build_object(
      'parentId', v_parent.id,
      'oldRemaining', v_parent.remaining_amount,
      'restoredRemaining', v_parent.restored_remaining,
      'newRemaining', (v_parent_state ->> v_parent.id::text)::numeric
    ));
  end loop;

  v_payload := jsonb_build_object(
    'profileId', p_profile_id,
    'oldWage', v_old_wage,
    'newWage', p_daily_wage,
    'throughMonth', to_char(v_through_month, 'YYYY-MM'),
    'rebuildOpen', p_rebuild_open,
    'noOp', v_old_wage = p_daily_wage,
    'months', v_months,
    'allocations', v_allocations,
    'oldAllocations', v_old_allocations,
    'parentBalances', v_parent_balances,
    'totals', jsonb_build_object(
      'oldDeduction', v_total_old,
      'newDeduction', v_total_new,
      'delta', v_total_new - v_total_old,
      'restoredAmount', greatest(v_total_old - v_total_new, 0),
      'additionalDeduction', greatest(v_total_new - v_total_old, 0)
    )
  );
  v_digest := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  return v_payload || jsonb_build_object('digest', v_digest);
end;
$$;

revoke all on function private.plan_time_tracking_deductions(uuid, numeric, date, boolean)
  from public, anon, authenticated;

create or replace function private.apply_time_tracking_deductions(
  p_profile_id uuid,
  p_through_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_flag text := current_setting('app.time_payroll_settlement_rpc', true);
  v_daily_wage numeric;
  v_plan jsonb;
  v_allocation jsonb;
  v_parent_approved_by uuid;
  v_inserted_id uuid;
  v_comment text;
begin
  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  select p.daily_wage into v_daily_wage
  from public.profiles p
  where p.id = p_profile_id and p.is_active = true;
  if not found or coalesce(v_daily_wage, 0) <= 0 then
    return jsonb_build_object('deducted', 0);
  end if;

  v_plan := private.plan_time_tracking_deductions(
    p_profile_id,
    v_daily_wage,
    p_through_month,
    false
  );
  perform set_config('app.time_payroll_settlement_rpc', 'true', true);
  begin
    for v_allocation in
      select value from jsonb_array_elements(v_plan -> 'allocations')
    loop
      select parent.approved_by
      into v_parent_approved_by
      from public.financial_transactions parent
      where parent.id = (v_allocation ->> 'parentId')::uuid;

      update public.financial_transactions
      set remaining_amount = trunc(remaining_amount - (v_allocation ->> 'amount')::numeric, 2)
      where id = (v_allocation ->> 'parentId')::uuid
        and remaining_amount >= (v_allocation ->> 'amount')::numeric;
      if not found then raise exception 'DEDUCTION_PLAN_STALE'; end if;

      v_comment := case
        when v_allocation ->> 'type' = 'DEBT_DEDUCTION' then 'หักหนี้อัตโนมัติ'
        else 'หักยอดเบิกเงินอัตโนมัติ'
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
        v_parent_approved_by,
        now()
      ) returning id into v_inserted_id;

      insert into public.time_tracking_audit_logs (
        admin_id, action, target_table, record_id, new_data, comment
      ) values (
        coalesce(auth.uid(), v_parent_approved_by, p_profile_id),
        'AUTO_DEDUCTION',
        'financial_transactions',
        (v_allocation ->> 'parentId')::uuid,
        jsonb_build_object(
          'deductionId', v_inserted_id,
          'deducted_amount', (v_allocation ->> 'amount')::numeric,
          'type', v_allocation ->> 'type',
          'applied_month', v_allocation ->> 'appliedMonth'
        ),
        v_comment
      );
    end loop;
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
    'deducted', coalesce((v_plan #>> '{totals,additionalDeduction}')::numeric, 0)
  );
end;
$$;

revoke all on function private.apply_time_tracking_deductions(uuid, date)
  from public, anon, authenticated;

create or replace function public.preview_time_tracking_wage_recalculation(
  p_profile_id uuid,
  p_daily_wage numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
begin
  if not private.can_manage_time_payroll_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  v_plan := private.plan_time_tracking_deductions(
    p_profile_id,
    p_daily_wage,
    date_trunc('month', now() at time zone 'Asia/Bangkok')::date,
    true
  );
  return v_plan - 'allocations' - 'oldAllocations' - 'parentBalances' - 'rebuildOpen';
end;
$$;

revoke all on function public.preview_time_tracking_wage_recalculation(uuid, numeric)
  from public, anon;
grant execute on function public.preview_time_tracking_wage_recalculation(uuid, numeric)
  to authenticated;

create or replace function public.commit_time_tracking_wage_recalculation(
  p_profile_id uuid,
  p_daily_wage numeric,
  p_expected_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_previous_flag text := current_setting('app.time_payroll_settlement_rpc', true);
  v_plan jsonb;
  v_parent_balance jsonb;
  v_allocation jsonb;
  v_created_allocations jsonb := '[]'::jsonb;
  v_created_id uuid;
  v_comment text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_time_payroll_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_expected_digest is null or p_expected_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'WAGE_PREVIEW_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  perform 1 from public.profiles p where p.id = p_profile_id and p.is_active = true for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  v_plan := private.plan_time_tracking_deductions(
    p_profile_id,
    p_daily_wage,
    date_trunc('month', now() at time zone 'Asia/Bangkok')::date,
    true
  );
  if v_plan ->> 'digest' is distinct from p_expected_digest then
    raise exception 'WAGE_PREVIEW_STALE';
  end if;
  if (v_plan ->> 'noOp')::boolean then
    return (v_plan - 'allocations' - 'oldAllocations' - 'parentBalances' - 'rebuildOpen')
      || jsonb_build_object('committed', false);
  end if;

  perform set_config('app.time_payroll_settlement_rpc', 'true', true);
  begin
    delete from public.financial_transactions child
    using public.financial_transactions parent
    where child.profile_id = p_profile_id
      and child.parent_debt_id = parent.id
      and child.status = 'APPROVED'
      and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and child.applied_month <= date_trunc('month', now() at time zone 'Asia/Bangkok')::date
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
      if not found then raise exception 'WAGE_PREVIEW_STALE'; end if;
    end loop;

    update public.profiles
    set daily_wage = p_daily_wage
    where id = p_profile_id;

    for v_allocation in
      select value from jsonb_array_elements(v_plan -> 'allocations')
    loop
      v_comment := case
        when v_allocation ->> 'type' = 'DEBT_DEDUCTION' then 'หักหนี้อัตโนมัติหลังแก้ค่าแรง'
        else 'หักยอดเบิกเงินอัตโนมัติหลังแก้ค่าแรง'
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
        v_actor,
        now()
      ) returning id into v_created_id;
      v_created_allocations := v_created_allocations || jsonb_build_array(
        v_allocation || jsonb_build_object('id', v_created_id)
      );
    end loop;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor,
      'RECALCULATE_WAGE_DEDUCTIONS',
      'profiles',
      p_profile_id,
      jsonb_build_object(
        'dailyWage', v_plan -> 'oldWage',
        'totalDeduction', v_plan #> '{totals,oldDeduction}',
        'allocations', v_plan -> 'oldAllocations'
      ),
      jsonb_build_object(
        'dailyWage', v_plan -> 'newWage',
        'totalDeduction', v_plan #> '{totals,newDeduction}',
        'months', v_plan -> 'months',
        'allocations', v_created_allocations
      ),
      'แก้ค่าแรงและคำนวณยอดหักหนี้/เงินเบิกของเดือนเปิดใหม่'
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

  return (v_plan - 'allocations' - 'oldAllocations' - 'parentBalances' - 'rebuildOpen')
    || jsonb_build_object('committed', true, 'createdAllocations', v_created_allocations);
end;
$$;

revoke all on function public.commit_time_tracking_wage_recalculation(uuid, numeric, text)
  from public, anon;
grant execute on function public.commit_time_tracking_wage_recalculation(uuid, numeric, text)
  to authenticated;

-- Keep the legacy two-argument RPC compatible for callers that do not need a rebuild.
-- It cannot bypass the preview/commit contract when an open provisional deduction exists.
create or replace function public.update_time_tracking_wage(
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
  if v_actor_id is null then raise exception 'Authentication required'; end if;
  if not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_daily_wage is null or p_daily_wage < 0 or p_daily_wage > 1000000000 then
    raise exception 'INVALID_WAGE';
  end if;
  if p_daily_wage <> trunc(p_daily_wage, 4) then raise exception 'INVALID_WAGE_PRECISION'; end if;

  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  select p.daily_wage into v_old_wage
  from public.profiles p
  where p.id = p_profile_id and p.is_active = true
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  if exists (
    select 1
    from public.financial_transactions child
    where child.profile_id = p_profile_id
      and child.status = 'APPROVED'
      and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and not private.is_time_payroll_month_closed(
        p_profile_id,
        to_char(child.applied_month, 'YYYY-MM')
      )
  ) then
    raise exception 'DEDUCTION_WAGE_LOCKED';
  end if;

  if v_old_wage = p_daily_wage then
    return jsonb_build_object('dailyWage', p_daily_wage, 'noOp', true);
  end if;
  update public.profiles set daily_wage = p_daily_wage where id = p_profile_id;
  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, new_data, comment
  ) values (
    v_actor_id,
    'UPDATE_WAGE',
    'profiles',
    p_profile_id,
    jsonb_build_object('daily_wage', v_old_wage),
    jsonb_build_object('daily_wage', p_daily_wage),
    'แก้ไขค่าแรงรายวัน'
  );
  return jsonb_build_object('dailyWage', p_daily_wage, 'noOp', false);
end;
$$;

revoke all on function public.update_time_tracking_wage(uuid, numeric) from public, anon;
grant execute on function public.update_time_tracking_wage(uuid, numeric) to authenticated;

-- The current planner and public wage RPC replace these revoked implementation
-- snapshots. Keeping them would leave three unreachable money-calculation paths
-- in the live schema.
drop function if exists public.update_time_tracking_wage_internal_20260829(uuid, numeric);
drop function if exists public.update_time_tracking_wage_internal_20260901(uuid, numeric);
drop function if exists private.apply_time_tracking_deductions_internal_20260902(uuid, date);

create or replace function public.preview_time_tracking_payroll_slip(
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
  v_gross numeric;
  v_used numeric;
  v_remaining numeric;
  v_wage numeric;
begin
  if not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_MONTH'; end if;
  v_month := (p_month || '-01')::date;
  if v_month > date_trunc('month', now() at time zone 'Asia/Bangkok')::date then raise exception 'INVALID_MONTH'; end if;
  if private.is_time_payroll_month_closed(p_profile_id, p_month)
  then raise exception 'MONTH_CLOSED:%', p_month; end if;
  select daily_wage into v_wage from public.profiles where id = p_profile_id;
  v_gross := trunc(public.calculate_paid_work_days(
    p_profile_id,
    v_month::timestamp at time zone 'Asia/Bangkok',
    (v_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
  ) * v_wage, 2);
  select coalesce(sum(amount), 0) into v_used from public.financial_transactions
  where profile_id = p_profile_id and status = 'APPROVED'
    and type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION') and applied_month = v_month;
  select coalesce(sum(remaining_amount), 0) into v_remaining from public.financial_transactions
  where profile_id = p_profile_id and status = 'APPROVED'
    and type in ('DEBT', 'WITHDRAWAL') and effective_date < (v_month + interval '1 month')::date;
  return jsonb_build_object('netPay', round(greatest(v_gross - v_used - v_remaining, 0), 0));
end;
$$;

revoke all on function public.preview_time_tracking_payroll_slip(uuid, text) from public, anon;
grant execute on function public.preview_time_tracking_payroll_slip(uuid, text) to authenticated;

notify pgrst, 'reload schema';
