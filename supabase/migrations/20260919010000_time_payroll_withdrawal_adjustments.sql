-- Append-only corrections for report-locked withdrawals.

alter table public.financial_transactions
  add column if not exists adjustment_base_amount numeric;

alter table public.financial_transactions
  add constraint financial_transactions_adjustment_shape
  check (
    (
      type = 'ADJUSTMENT'
      and parent_debt_id is not null
      and effective_date is not null
      and adjustment_base_amount is not null
      and amount >= 0
      and adjustment_base_amount >= 0
      and amount::text not in ('NaN', 'Infinity', '-Infinity')
      and adjustment_base_amount::text not in ('NaN', 'Infinity', '-Infinity')
    )
    or (
      type <> 'ADJUSTMENT'
      and adjustment_base_amount is null
    )
  ) not valid;

alter table public.financial_transactions
  validate constraint financial_transactions_adjustment_shape;

create unique index if not exists financial_transactions_one_pending_adjustment_per_withdrawal
  on public.financial_transactions (parent_debt_id)
  where type = 'ADJUSTMENT' and status = 'PENDING';

create index if not exists financial_transactions_adjustment_history
  on public.financial_transactions (parent_debt_id, approved_at desc, created_at desc, id desc)
  where type = 'ADJUSTMENT';

create or replace function private.latest_withdrawal_target(p_withdrawal_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select adjustment.amount
      from public.financial_transactions adjustment
      where adjustment.type = 'ADJUSTMENT'
        and adjustment.parent_debt_id = source.id
        and adjustment.status = 'APPROVED'
      order by adjustment.approved_at desc nulls last, adjustment.created_at desc, adjustment.id desc
      limit 1
    ),
    source.amount
  )
  from public.financial_transactions source
  where source.id = p_withdrawal_id
    and source.type = 'WITHDRAWAL';
$$;

create or replace function private.withdrawal_closed_floor(p_withdrawal_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(child.amount), 0)
  from public.financial_transactions source
  join public.financial_transactions child on child.parent_debt_id = source.id
  where source.id = p_withdrawal_id
    and source.type = 'WITHDRAWAL'
    and child.type = 'WITHDRAWAL_DEDUCTION'
    and child.status = 'APPROVED'
    and exists (
      select 1
      from public.payroll_slips slip
      where slip.profile_id = source.profile_id
        and slip.month = to_char(child.applied_month, 'YYYY-MM')
        and slip.status in ('PENDING', 'APPROVED')
    );
$$;

create or replace function public.get_withdrawal_adjustment_summaries(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if auth.uid() <> p_profile_id and not private.can_manage_time_payroll_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'withdrawalId', source.id,
      'latestTarget', private.latest_withdrawal_target(source.id),
      'closedSlipFloor', private.withdrawal_closed_floor(source.id),
      'pendingAdjustmentId', pending.id
    ) order by source.effective_date desc, source.created_at desc, source.id desc)
    from public.financial_transactions source
    left join lateral (
      select adjustment.id
      from public.financial_transactions adjustment
      where adjustment.type = 'ADJUSTMENT'
        and adjustment.parent_debt_id = source.id
        and adjustment.status = 'PENDING'
      order by adjustment.created_at desc, adjustment.id desc
      limit 1
    ) pending on true
    where source.profile_id = p_profile_id
      and source.type = 'WITHDRAWAL'
      and source.status = 'APPROVED'
      and source.cancelled_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function private.rebuild_open_deductions_for_adjustment(
  p_profile_id uuid,
  p_actor uuid,
  p_adjustment_id uuid
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
  v_old_allocations jsonb := '[]'::jsonb;
  v_restored record;
  v_parent_balance jsonb;
  v_allocation jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  select daily_wage into v_daily_wage
  from public.profiles
  where id = p_profile_id and is_active = true
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  perform set_config('app.time_payroll_settlement_rpc', 'true', true);
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', child.id,
      'parentId', child.parent_debt_id,
      'type', child.type::text,
      'amount', child.amount,
      'appliedMonth', to_char(child.applied_month, 'YYYY-MM')
    ) order by child.applied_month, child.created_at, child.id), '[]'::jsonb)
    into v_old_allocations
    from public.financial_transactions child
    join public.financial_transactions parent on parent.id = child.parent_debt_id
    where child.profile_id = p_profile_id
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

    for v_restored in
      select parent.id, parent.type, parent.amount,
        sum(child.amount) as open_amount
      from public.financial_transactions child
      join public.financial_transactions parent on parent.id = child.parent_debt_id
      where child.profile_id = p_profile_id
        and child.status = 'APPROVED'
        and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and child.applied_month <= v_current_month
        and parent.profile_id = p_profile_id
        and parent.status = 'APPROVED'
        and parent.type in ('DEBT', 'WITHDRAWAL')
        and not private.is_time_payroll_month_closed(
          p_profile_id,
          to_char(child.applied_month, 'YYYY-MM')
        )
      group by parent.id, parent.type, parent.amount
    loop
      update public.financial_transactions parent
      set remaining_amount = case
        when v_restored.type = 'WITHDRAWAL' then greatest(
          private.latest_withdrawal_target(v_restored.id)
            - private.withdrawal_closed_floor(v_restored.id),
          0
        )
        else least(parent.amount, parent.remaining_amount + v_restored.open_amount)
      end
      where parent.id = v_restored.id;
    end loop;

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

    -- The adjusted source may have no open deduction rows to restore (for
    -- example, after a prior adjustment to zero). Seed its new outstanding
    -- balance before the planner reads remaining_amount.
    update public.financial_transactions source
    set remaining_amount = greatest(
      private.latest_withdrawal_target(source.id)
        - private.withdrawal_closed_floor(source.id),
      0
    )
    from public.financial_transactions adjustment
    where adjustment.id = p_adjustment_id
      and adjustment.type = 'ADJUSTMENT'
      and adjustment.parent_debt_id = source.id
      and source.profile_id = p_profile_id
      and source.type = 'WITHDRAWAL'
      and source.status = 'APPROVED';
    if not found then raise exception 'WITHDRAWAL_SOURCE_NOT_FOUND'; end if;

    v_plan := private.plan_time_tracking_deductions(
      p_profile_id,
      v_daily_wage,
      v_current_month,
      false
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
      if not found then raise exception 'ADJUSTMENT_DEDUCTION_PLAN_STALE'; end if;
    end loop;

    for v_allocation in
      select value from jsonb_array_elements(v_plan -> 'allocations')
    loop
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
        'คำนวณยอดหักใหม่หลังปรับยอดเบิกเงิน',
        p_actor,
        now()
      );
    end loop;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, new_data, comment
    ) values (
      p_actor,
      'REBUILD_WITHDRAWAL_ADJUSTMENT_DEDUCTIONS',
      'financial_transactions',
      p_adjustment_id,
      jsonb_build_object(
        'months', v_plan -> 'months',
        'oldAllocations', v_old_allocations,
        'allocations', v_plan -> 'allocations',
        'totals', v_plan -> 'totals'
      ),
      'คืนและคำนวณยอดหักของเดือนเปิดใหม่หลังปรับยอดเบิกเงิน'
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

  return v_plan;
end;
$$;

create or replace function private.guard_reported_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_report_no text;
  v_remaining_cap numeric;
begin
  if tg_table_name = 'rubber_exports' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'sold_out_at' - 'sold_out_by_user_id' - 'sold_out_by_name')
       = (to_jsonb(old) - 'sold_out_at' - 'sold_out_by_user_id' - 'sold_out_by_name') then
    return new;
  end if;

  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);

  if v_report_no is not null then
    if tg_table_name = 'rubber_bills'
      and tg_op = 'UPDATE'
      and (to_jsonb(new)
        - 'print_status' - 'updated_at' - 'evidence_completion_id'
        - 'evidence_manual_correction_count' - 'net_rubber_value'
        - 'net_weight' - 'payable_before_rounding' - 'has_ocr_source_image')
        = (to_jsonb(old)
        - 'print_status' - 'updated_at' - 'evidence_completion_id'
        - 'evidence_manual_correction_count' - 'net_rubber_value'
        - 'net_weight' - 'payable_before_rounding' - 'has_ocr_source_image') then
      return new;
    end if;
    if tg_table_name = 'financial_transactions'
      and tg_op = 'UPDATE'
      and coalesce(current_setting('app.time_payroll_settlement_rpc', true), 'false') = 'true'
      and (to_jsonb(old) ->> 'type') in ('DEBT', 'WITHDRAWAL')
      and (to_jsonb(new) ->> 'type') = (to_jsonb(old) ->> 'type')
      and (to_jsonb(old) ->> 'status') = 'APPROVED'
      and (to_jsonb(new) ->> 'status') = (to_jsonb(old) ->> 'status') then
      v_remaining_cap := case
        when (to_jsonb(old) ->> 'type') = 'WITHDRAWAL'
          then private.latest_withdrawal_target(old.id)
        else (to_jsonb(old) ->> 'amount')::numeric
      end;
      if (to_jsonb(new) ->> 'remaining_amount')::numeric between 0 and v_remaining_cap
        and (to_jsonb(new) - array['remaining_amount', 'updated_at'])
          = (to_jsonb(old) - array['remaining_amount', 'updated_at']) then
        return new;
      end if;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.enforce_time_tracking_expense_relation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_rpc_write boolean := coalesce(current_setting('app.time_tracking_expense_rpc', true), 'false') = 'true';
begin
  if tg_table_name = 'financial_transactions' then
    if old.status <> 'APPROVED'
      and new.status = 'APPROVED'
      and new.type in ('WITHDRAWAL', 'ADJUSTMENT') then
      if not v_rpc_write
        or new.expense_location_id is null
        or new.approved_at is null
        or new.cancelled_at is not null then
        raise exception 'Time tracking financial approval must use the approval RPC';
      end if;
    end if;

    if old.status = 'APPROVED'
      and old.type in ('WITHDRAWAL', 'ADJUSTMENT')
      and (
        new.expense_location_id is distinct from old.expense_location_id
        or new.cancelled_at is distinct from old.cancelled_at
        or new.cancelled_by is distinct from old.cancelled_by
        or new.cancel_reason is distinct from old.cancel_reason
      )
      and not v_rpc_write then
      raise exception 'Time tracking financial relation must be changed through the approval RPC';
    end if;
  elsif tg_table_name = 'payroll_slips' then
    if old.status <> 'APPROVED' and new.status = 'APPROVED' then
      if not v_rpc_write
        or new.approved_at is null
        or (new.net_pay > 0 and new.expense_location_id is null)
        or new.cancelled_at is not null then
        raise exception 'Payroll approval must use the time tracking approval RPC';
      end if;
    end if;
    if old.status = 'APPROVED'
      and (
        new.expense_location_id is distinct from old.expense_location_id
        or new.cancelled_at is distinct from old.cancelled_at
        or new.cancelled_by is distinct from old.cancelled_by
        or new.cancel_reason is distinct from old.cancel_reason
      )
      and not v_rpc_write then
      raise exception 'Payroll expense relation must be changed at its source through the time tracking RPC';
    end if;
  end if;
  return new;
end;
$$;

alter table public.financial_transactions
  add constraint financial_transactions_adjustment_expense_assignment
  check (
    type <> 'ADJUSTMENT'
    or status <> 'APPROVED'
    or cancelled_at is not null
    or (expense_location_id is not null and approved_at is not null)
  ) not valid;

alter table public.financial_transactions
  validate constraint financial_transactions_adjustment_expense_assignment;

create or replace function private.prepare_payroll_slip_adjustment_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := (new.month || '-01')::date;
  v_blocker record;
  v_transactions jsonb;
begin
  select adjustment.id, adjustment.effective_date
  into v_blocker
  from public.financial_transactions adjustment
  where adjustment.profile_id = new.profile_id
    and adjustment.type = 'ADJUSTMENT'
    and adjustment.status = 'PENDING'
    and adjustment.effective_date < (v_month + interval '1 month')::date
  order by adjustment.effective_date, adjustment.created_at, adjustment.id
  limit 1;
  if found then
    raise exception 'PENDING_BLOCKER:ADJUSTMENT:%:%',
      v_blocker.id,
      to_char(v_blocker.effective_date, 'YYYY-MM');
  end if;

  select coalesce(jsonb_agg(
    case
      when item.value ->> 'type' in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION') then
        item.value || jsonb_build_object(
          'source_effective_date', parent.effective_date
        )
      when item.value ->> 'type' = 'WITHDRAWAL' then
        jsonb_set(
          item.value,
          '{amount}',
          to_jsonb(private.latest_withdrawal_target((item.value ->> 'id')::uuid)),
          true
        )
      else item.value
    end
    order by item.ordinality
  ) filter (
    where item.value ->> 'type' <> 'WITHDRAWAL'
      or private.latest_withdrawal_target((item.value ->> 'id')::uuid) > 0
  ), '[]'::jsonb)
  into v_transactions
  from jsonb_array_elements(coalesce(new.slip_data -> 'transactions', '[]'::jsonb))
    with ordinality item(value, ordinality)
  left join public.financial_transactions parent
    on parent.id = nullif(item.value ->> 'parent_debt_id', '')::uuid;

  new.slip_data := jsonb_set(new.slip_data, '{transactions}', v_transactions, true);
  return new;
end;
$$;

drop trigger if exists prepare_payroll_slip_adjustment_snapshot on public.payroll_slips;
create trigger prepare_payroll_slip_adjustment_snapshot
  before insert on public.payroll_slips
  for each row execute function private.prepare_payroll_slip_adjustment_snapshot();

alter table public.dashboard_money_events
  drop constraint if exists dashboard_money_events_source_type_check;
alter table public.dashboard_money_events
  add constraint dashboard_money_events_source_type_check
  check (source_type in (
    'income_expense', 'money_transfer', 'cash_transfer', 'withdrawal',
    'withdrawal_adjustment', 'payroll_slip', 'rubber_bill', 'rubber_export'
  ));

create or replace function public.decide_time_tracking_withdrawal_adjustment(
  p_adjustment_id uuid,
  p_decision text,
  p_expense_location_id uuid default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_adjustment public.financial_transactions%rowtype;
  v_source public.financial_transactions%rowtype;
  v_current_target numeric;
  v_closed_floor numeric;
  v_delta numeric;
  v_direction text;
  v_payload jsonb;
  v_previous_expense_flag text := current_setting('app.time_tracking_expense_rpc', true);
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_decision is null or p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'INVALID_ADJUSTMENT_DECISION';
  end if;

  select * into v_adjustment
  from public.financial_transactions
  where id = p_adjustment_id and type = 'ADJUSTMENT';
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if not private.can_manage_time_payroll_profile(v_adjustment.profile_id) then
    raise exception 'Forbidden';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_adjustment.profile_id::text, 0));
  select * into v_adjustment
  from public.financial_transactions
  where id = p_adjustment_id and type = 'ADJUSTMENT'
  for update;
  select * into v_source
  from public.financial_transactions
  where id = v_adjustment.parent_debt_id
  for update;

  if not found or v_source.type <> 'WITHDRAWAL'
    or v_source.status <> 'APPROVED' or v_source.cancelled_at is not null then
    raise exception 'WITHDRAWAL_SOURCE_NOT_FOUND';
  end if;
  if private.active_report_no('financial_transaction', v_source.id) is null then
    raise exception 'WITHDRAWAL_NOT_REPORT_LOCKED';
  end if;

  if v_adjustment.status <> 'PENDING' then
    if v_adjustment.status::text = p_decision
      and (
        p_decision = 'REJECTED'
        or v_adjustment.expense_location_id is not distinct from p_expense_location_id
      ) then
      return jsonb_build_object(
        'id', v_adjustment.id,
        'status', lower(p_decision),
        'idempotent', true
      );
    end if;
    raise exception 'ADJUSTMENT_ALREADY_DECIDED';
  end if;

  v_current_target := private.latest_withdrawal_target(v_source.id);
  if v_current_target is distinct from v_adjustment.adjustment_base_amount then
    raise exception 'ADJUSTMENT_STALE';
  end if;

  if p_decision = 'REJECTED' then
    update public.financial_transactions
    set status = 'REJECTED', approved_by = v_actor_id,
      admin_comment = left(coalesce(p_comment, ''), 500)
    where id = v_adjustment.id;
    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id, 'REJECT_WITHDRAWAL_ADJUSTMENT', 'financial_transactions', v_adjustment.id,
      to_jsonb(v_adjustment), jsonb_build_object('decision', 'REJECTED'), left(coalesce(p_comment, ''), 500)
    );
    return jsonb_build_object('id', v_adjustment.id, 'status', 'rejected');
  end if;

  if p_expense_location_id is null
    or not private.can_assign_time_tracking_expense_location(p_expense_location_id) then
    raise exception 'ADJUSTMENT_BRANCH_REQUIRED';
  end if;

  v_closed_floor := private.withdrawal_closed_floor(v_source.id);
  if v_adjustment.amount = v_current_target then raise exception 'ADJUSTMENT_NO_OP'; end if;
  if v_adjustment.amount < v_closed_floor then
    raise exception 'ADJUSTMENT_BELOW_CLOSED_FLOOR:%', v_closed_floor;
  end if;

  v_delta := trunc(v_adjustment.amount - v_current_target, 2);
  v_direction := case when v_delta > 0 then 'expense' else 'income' end;
  select name into v_actor_name from public.profiles where id = v_actor_id;

  perform set_config('app.time_tracking_expense_rpc', 'true', true);
  update public.financial_transactions
  set status = 'APPROVED', approved_by = v_actor_id, approved_at = now(),
    expense_location_id = p_expense_location_id,
    admin_comment = left(coalesce(p_comment, ''), 500)
  where id = v_adjustment.id;

  perform private.rebuild_open_deductions_for_adjustment(
    v_source.profile_id,
    v_actor_id,
    v_adjustment.id
  );

  v_payload := private.dashboard_money_event_entry(
    'withdrawal-adjustment:' || v_adjustment.id::text,
    p_expense_location_id,
    'withdrawal_adjustment',
    'TWA-' || left(v_adjustment.id::text, 8),
    case when v_delta > 0 then 'ปรับเพิ่มยอดเบิกเงิน — ' else 'คืนยอดเบิกเงิน — ' end
      || coalesce((select name from public.profiles where id = v_source.profile_id), 'พนักงาน'),
    v_direction,
    abs(v_delta),
    jsonb_build_object(
      'withdrawalId', v_source.id,
      'baseAmount', v_current_target,
      'targetAmount', v_adjustment.amount,
      'delta', v_delta,
      'locationId', p_expense_location_id,
      'approvedAt', now()
    ),
    v_actor_id,
    v_actor_name
  );
  perform private.append_dashboard_money_event(
    'withdrawal_adjustment', v_adjustment.id, 'create', v_payload, v_actor_id, v_actor_name
  );
  insert into private.dashboard_money_event_projection (source_type, source_id, event_key, payload)
  values ('withdrawal_adjustment', v_adjustment.id, v_payload ->> 'eventKey', v_payload)
  on conflict (source_type, source_id, event_key) do update set payload = excluded.payload;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, new_data, comment
  ) values (
    v_actor_id, 'APPROVE_WITHDRAWAL_ADJUSTMENT', 'financial_transactions', v_adjustment.id,
    to_jsonb(v_adjustment),
    jsonb_build_object(
      'withdrawalId', v_source.id,
      'baseAmount', v_current_target,
      'targetAmount', v_adjustment.amount,
      'delta', v_delta,
      'direction', v_direction,
      'expenseLocationId', p_expense_location_id,
      'closedSlipFloor', v_closed_floor
    ),
    left(coalesce(p_comment, ''), 500)
  );

  perform set_config('app.time_tracking_expense_rpc', coalesce(nullif(v_previous_expense_flag, ''), 'false'), true);

  return jsonb_build_object(
    'id', v_adjustment.id,
    'status', 'approved',
    'baseAmount', v_current_target,
    'targetAmount', v_adjustment.amount,
    'delta', v_delta,
    'direction', v_direction,
    'closedSlipFloor', v_closed_floor
  );
exception when others then
  perform set_config('app.time_tracking_expense_rpc', coalesce(nullif(v_previous_expense_flag, ''), 'false'), true);
  raise;
end;
$$;

create or replace function public.request_time_tracking_withdrawal_adjustment(
  p_withdrawal_id uuid,
  p_target_amount numeric,
  p_expense_location_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source public.financial_transactions%rowtype;
  v_is_manager boolean;
  v_base numeric;
  v_floor numeric;
  v_adjustment_id uuid;
  v_delta numeric;
  v_description text;
  v_decision jsonb;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_target_amount is null
    or p_target_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_target_amount < 0 or p_target_amount > 1000000000
    or p_target_amount <> trunc(p_target_amount, 2) then
    raise exception 'INVALID_ADJUSTMENT_TARGET';
  end if;

  select * into v_source
  from public.financial_transactions
  where id = p_withdrawal_id;
  if not found or v_source.type <> 'WITHDRAWAL'
    or v_source.status <> 'APPROVED' or v_source.cancelled_at is not null then
    raise exception 'WITHDRAWAL_SOURCE_NOT_FOUND';
  end if;

  v_is_manager := private.can_manage_time_payroll_profile(v_source.profile_id);
  if v_source.profile_id <> v_actor_id and not v_is_manager then raise exception 'Forbidden'; end if;
  if private.active_report_no('financial_transaction', v_source.id) is null then
    raise exception 'WITHDRAWAL_NOT_REPORT_LOCKED';
  end if;
  if v_is_manager and (
    p_expense_location_id is null
    or not private.can_assign_time_tracking_expense_location(p_expense_location_id)
  ) then raise exception 'ADJUSTMENT_BRANCH_REQUIRED'; end if;
  if not v_is_manager and p_expense_location_id is not null then raise exception 'Forbidden'; end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_source.profile_id::text, 0));
  select * into v_source
  from public.financial_transactions
  where id = p_withdrawal_id
  for update;

  v_base := private.latest_withdrawal_target(v_source.id);
  v_floor := private.withdrawal_closed_floor(v_source.id);
  if p_target_amount = v_base then raise exception 'ADJUSTMENT_NO_OP'; end if;
  if p_target_amount < v_floor then raise exception 'ADJUSTMENT_BELOW_CLOSED_FLOOR:%', v_floor; end if;
  if exists (
    select 1 from public.financial_transactions
    where type = 'ADJUSTMENT' and parent_debt_id = v_source.id and status = 'PENDING'
  ) then raise exception 'ADJUSTMENT_PENDING_EXISTS'; end if;

  v_delta := trunc(p_target_amount - v_base, 2);
  v_description := format(
    'ปรับยอดเบิก %s: %s → %s (%s %s)%s',
    left(v_source.id::text, 8),
    to_char(v_base, 'FM9999999990.00'),
    to_char(p_target_amount, 'FM9999999990.00'),
    case when v_delta > 0 then 'เพิ่ม' else 'ลด' end,
    to_char(abs(v_delta), 'FM9999999990.00'),
    case when nullif(btrim(coalesce(p_reason, '')), '') is null
      then '' else ' — ' || left(btrim(p_reason), 500) end
  );

  insert into public.financial_transactions (
    profile_id, type, amount, adjustment_base_amount, status,
    parent_debt_id, effective_date, description
  ) values (
    v_source.profile_id, 'ADJUSTMENT', trunc(p_target_amount, 2), v_base,
    'PENDING', v_source.id, v_source.effective_date, v_description
  ) returning id into v_adjustment_id;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data, comment
  ) values (
    v_actor_id, 'REQUEST_WITHDRAWAL_ADJUSTMENT', 'financial_transactions', v_adjustment_id,
    jsonb_build_object(
      'withdrawalId', v_source.id,
      'baseAmount', v_base,
      'targetAmount', p_target_amount,
      'delta', v_delta,
      'closedSlipFloor', v_floor
    ),
    left(coalesce(p_reason, ''), 500)
  );

  if v_is_manager then
    v_decision := public.decide_time_tracking_withdrawal_adjustment(
      v_adjustment_id, 'APPROVED', p_expense_location_id, p_reason
    );
    return jsonb_build_object('id', v_adjustment_id, 'status', 'approved', 'decision', v_decision);
  end if;

  return jsonb_build_object(
    'id', v_adjustment_id,
    'status', 'pending',
    'baseAmount', v_base,
    'targetAmount', p_target_amount,
    'delta', v_delta,
    'closedSlipFloor', v_floor
  );
end;
$$;

create or replace function public.withdraw_time_tracking_withdrawal_adjustment(p_adjustment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_adjustment public.financial_transactions%rowtype;
begin
  if v_actor_id is null or not private.is_active_user() then raise exception 'Authentication required'; end if;
  select * into v_adjustment
  from public.financial_transactions
  where id = p_adjustment_id and type = 'ADJUSTMENT'
  for update;
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if v_adjustment.profile_id <> v_actor_id then raise exception 'Forbidden'; end if;
  if v_adjustment.status <> 'PENDING' then raise exception 'ADJUSTMENT_ALREADY_DECIDED'; end if;

  delete from public.financial_transactions where id = v_adjustment.id;
  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, comment
  ) values (
    v_actor_id, 'WITHDRAW_WITHDRAWAL_ADJUSTMENT', 'financial_transactions', v_adjustment.id,
    to_jsonb(v_adjustment), 'พนักงานถอนคำขอปรับยอดเบิกเงิน'
  );
  return jsonb_build_object('id', v_adjustment.id, 'status', 'withdrawn');
end;
$$;

revoke all on function public.get_withdrawal_adjustment_summaries(uuid) from public, anon;
grant execute on function public.get_withdrawal_adjustment_summaries(uuid) to authenticated;
revoke all on function public.request_time_tracking_withdrawal_adjustment(uuid, numeric, uuid, text) from public, anon;
grant execute on function public.request_time_tracking_withdrawal_adjustment(uuid, numeric, uuid, text) to authenticated;
revoke all on function public.decide_time_tracking_withdrawal_adjustment(uuid, text, uuid, text) from public, anon;
grant execute on function public.decide_time_tracking_withdrawal_adjustment(uuid, text, uuid, text) to authenticated;
revoke all on function public.withdraw_time_tracking_withdrawal_adjustment(uuid) from public, anon;
grant execute on function public.withdraw_time_tracking_withdrawal_adjustment(uuid) to authenticated;

create or replace function private.income_expense_feed_row_sort_key(p_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_row ->> 'id' like 'money-transfer-income:%'
      then 'transfer-income:' || (p_row ->> 'relationSourceId')
    when p_row ->> 'id' like 'money-transfer-branch-expense:%'
      then 'transfer-expense:' || (p_row ->> 'relationSourceId')
    when p_row ->> 'id' like 'money-transfer-branch-paid-expense:%'
      then 'customer-transfer-expense:' || (p_row ->> 'relationSourceId')
    when p_row ->> 'id' like 'cash-transfer-expense:%'
      or p_row ->> 'id' like 'cash-transfer-income:%'
      or p_row ->> 'id' like 'time-tracking-withdrawal:%'
      or p_row ->> 'id' like 'time-tracking-withdrawal-adjustment:%'
      or p_row ->> 'id' like 'payroll-slip:%'
      or p_row ->> 'id' like 'rubber-export-expense:%'
      then p_row ->> 'id'
    when p_row ->> 'relationSourceType' = 'rubber_bill_daily'
      then 'rubber:' || (p_row ->> 'relationSourceId')
    when p_row ->> 'relationSourceType' = 'ocr_ticket_daily'
      then 'ocr:' || (p_row ->> 'relationSourceId')
    else 'actual:' || (p_row ->> 'id')
  end;
$$;

revoke all on function private.income_expense_feed_row_sort_key(jsonb)
  from public, anon, authenticated;

-- Keep the established feed contract and merge adjustment deltas into the same cursor stream.
alter function public.get_income_expense_feed(uuid, date, date, date, text, integer)
  rename to get_income_expense_feed_before_withdrawal_adjustments;

revoke all on function public.get_income_expense_feed_before_withdrawal_adjustments(uuid, date, date, date, text, integer)
  from public, anon, authenticated;

create or replace function public.get_income_expense_feed(
  p_location_id uuid,
  p_from_date date,
  p_to_date date,
  p_cursor_date date default null,
  p_cursor_key text default null,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 100);
  v_base jsonb;
begin
  v_base := public.get_income_expense_feed_before_withdrawal_adjustments(
    p_location_id, p_from_date, p_to_date, p_cursor_date, p_cursor_key, 100
  );

  return (
    with feed as (
      select
        (row_data ->> 'txDate')::date as sort_date,
        private.income_expense_feed_row_sort_key(row_data) as sort_key,
        row_data
      from jsonb_array_elements(coalesce(v_base -> 'rows', '[]'::jsonb)) as base_row(row_data)

      union all

      select
        (adjustment.approved_at at time zone 'Asia/Bangkok')::date,
        'time-tracking-withdrawal-adjustment:' || adjustment.id::text,
        jsonb_build_object(
          'id', 'time-tracking-withdrawal-adjustment:' || adjustment.id,
          'clientTempId', 'time-tracking-withdrawal-adjustment:' || adjustment.id,
          'localBillNo', 'TWA-' || left(adjustment.id::text, 8),
          'serverBillNo', 'TWA-' || left(adjustment.id::text, 8),
          'idempotencyKey', 'time-tracking-withdrawal-adjustment:' || adjustment.id,
          'locationId', adjustment.expense_location_id,
          'syncStatus', 'synced',
          'recordStatus', 'active',
          'type', case when adjustment.amount > adjustment.adjustment_base_amount then 'expense' else 'income' end,
          'number', 'TWA-' || left(adjustment.id::text, 8),
          'txDate', (adjustment.approved_at at time zone 'Asia/Bangkok')::date,
          'title', case
            when adjustment.amount > adjustment.adjustment_base_amount then 'เพิ่มยอดเบิกเงิน — '
            else 'คืนยอดเบิกเงิน — '
          end || coalesce(profile.name, 'พนักงาน') || coalesce(' — ' || nullif(adjustment.description, ''), ''),
          'cost', abs(adjustment.amount - adjustment.adjustment_base_amount),
          'billOption', case when adjustment.amount > adjustment.adjustment_base_amount then 'ค่าใช้จ่าย' else 'รายรับ' end,
          'clientRecordedAt', adjustment.approved_at,
          'clientCreatedAt', adjustment.created_at,
          'serverReceivedAt', adjustment.updated_at,
          'revisionNo', 1,
          'createdByUserId', adjustment.profile_id,
          'createdByName', coalesce(profile.name, 'พนักงาน'),
          'createdByPhone', '',
          'relationSourceType', 'time_tracking_withdrawal_adjustment',
          'relationSourceId', adjustment.id,
          'relationSourceLocationId', adjustment.expense_location_id,
          'relationLabel', 'ปรับยอดเบิกเงิน',
          'relationLockReason', 'รายการนี้มาจากการปรับยอดเบิกเงิน ต้องตรวจสอบที่โมดูลลงเวลาต้นทาง'
        )
      from public.financial_transactions adjustment
      join public.profiles profile on profile.id = adjustment.profile_id
      where adjustment.type = 'ADJUSTMENT'
        and adjustment.status = 'APPROVED'
        and adjustment.cancelled_at is null
        and adjustment.expense_location_id = p_location_id
        and adjustment.amount <> adjustment.adjustment_base_amount
        and (adjustment.approved_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date
        and (
          p_cursor_date is null
          or (
            (adjustment.approved_at at time zone 'Asia/Bangkok')::date,
            'time-tracking-withdrawal-adjustment:' || adjustment.id::text
          ) < (p_cursor_date, p_cursor_key)
        )
    ), numbered as (
      select *, row_number() over (order by sort_date desc, sort_key desc) as row_no
      from feed
    ), page as (
      select * from numbered where row_no <= v_page_size + 1
    )
    select jsonb_build_object(
      'rows', coalesce(
        (select jsonb_agg(row_data order by sort_date desc, sort_key desc)
         from page where row_no <= v_page_size),
        '[]'::jsonb
      ),
      'nextCursor', case
        when (select count(*) from page) > v_page_size
          or v_base ->> 'nextCursor' is not null
        then encode(convert_to((
          select sort_date::text || '|' || sort_key
          from page where row_no = v_page_size
        ), 'utf8'), 'base64')
        else null
      end
    )
  );
end;
$$;

revoke all on function public.get_income_expense_feed(uuid, date, date, date, text, integer) from public, anon;
grant execute on function public.get_income_expense_feed(uuid, date, date, date, text, integer) to authenticated;

create index if not exists financial_transactions_adjustment_operational_feed
  on public.financial_transactions (expense_location_id, approved_at desc, id desc)
  where type = 'ADJUSTMENT' and status = 'APPROVED' and cancelled_at is null;

alter function public.get_income_expense_operational_feed(uuid, text, text, text)
  rename to get_income_expense_operational_feed_before_wadj;

revoke all on function public.get_income_expense_operational_feed_before_wadj(uuid, text, text, text)
  from public, anon, authenticated;

create or replace function public.get_income_expense_operational_feed(
  p_location_id uuid,
  p_mode text default 'latest',
  p_search text default '',
  p_cursor text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_search text := lower(regexp_replace(btrim(coalesce(p_search, '')), '\s+', ' ', 'g'));
  v_cursor jsonb;
  v_cursor_date date;
  v_cursor_key text;
  v_pinned_rows jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_next_cursor text;
  v_has_more boolean := false;
begin
  -- The established function remains the authority for auth, cursor scope,
  -- pending approvals, and every pre-existing source type.
  v_result := public.get_income_expense_operational_feed_before_wadj(
    p_location_id, p_mode, p_search, p_cursor
  );
  if p_mode <> 'latest' then return v_result; end if;

  if p_cursor is not null then
    v_cursor := convert_from(decode(p_cursor, 'hex'), 'utf8')::jsonb;
    v_cursor_date := (v_cursor ->> 'date')::date;
    v_cursor_key := v_cursor ->> 'key';
  end if;

  select coalesce(jsonb_agg(entry.row_data order by entry.position), '[]'::jsonb)
  into v_pinned_rows
  from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
    with ordinality entry(row_data, position)
  where entry.row_data ->> 'id' like 'approval-income:%';

  with feed as (
    select
      (entry.row_data ->> 'txDate')::date as sort_date,
      private.income_expense_feed_row_sort_key(entry.row_data) as sort_key,
      entry.row_data
    from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
      as entry(row_data)
    where entry.row_data ->> 'id' not like 'approval-income:%'

    union all

    select
      (adjustment.approved_at at time zone 'Asia/Bangkok')::date,
      'time-tracking-withdrawal-adjustment:' || adjustment.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'id', 'time-tracking-withdrawal-adjustment:' || adjustment.id,
        'clientTempId', 'time-tracking-withdrawal-adjustment:' || adjustment.id,
        'localBillNo', 'TWA-' || left(adjustment.id::text, 8),
        'serverBillNo', 'TWA-' || left(adjustment.id::text, 8),
        'idempotencyKey', 'time-tracking-withdrawal-adjustment:' || adjustment.id,
        'locationId', adjustment.expense_location_id,
        'syncStatus', 'synced',
        'recordStatus', 'active',
        'type', case when adjustment.amount > adjustment.adjustment_base_amount then 'expense' else 'income' end,
        'number', 'TWA-' || left(adjustment.id::text, 8),
        'txDate', (adjustment.approved_at at time zone 'Asia/Bangkok')::date,
        'title', case when adjustment.amount > adjustment.adjustment_base_amount
          then 'เพิ่มยอดเบิกเงิน — ' else 'คืนยอดเบิกเงิน — ' end
          || coalesce(profile.name, 'พนักงาน')
          || coalesce(' — ' || nullif(adjustment.description, ''), ''),
        'cost', abs(adjustment.amount - adjustment.adjustment_base_amount),
        'billOption', case when adjustment.amount > adjustment.adjustment_base_amount then 'ค่าใช้จ่าย' else 'รายรับ' end,
        'clientRecordedAt', adjustment.approved_at,
        'clientCreatedAt', adjustment.created_at,
        'serverReceivedAt', adjustment.updated_at,
        'revisionNo', 1,
        'createdByUserId', adjustment.profile_id,
        'createdByName', coalesce(profile.name, 'พนักงาน'),
        'createdByPhone', profile.phone,
        'relationSourceType', 'time_tracking_withdrawal_adjustment',
        'relationSourceId', adjustment.id,
        'relationSourceLocationId', adjustment.expense_location_id,
        'relationLabel', 'ปรับยอดเบิกเงิน',
        'relationLockReason', 'รายการนี้มาจากการปรับยอดเบิกเงิน ต้องตรวจสอบที่โมดูลลงเวลาต้นทาง',
        'reportLockNo', public.report_lock_no(adjustment)
      ))
    from public.financial_transactions adjustment
    join public.profiles profile on profile.id = adjustment.profile_id
    where adjustment.type = 'ADJUSTMENT'
      and adjustment.status = 'APPROVED'
      and adjustment.cancelled_at is null
      and adjustment.expense_location_id = p_location_id
      and adjustment.amount <> adjustment.adjustment_base_amount
      and (
        v_cursor_date is null
        or (
          (adjustment.approved_at at time zone 'Asia/Bangkok')::date,
          'time-tracking-withdrawal-adjustment:' || adjustment.id::text
        ) < (v_cursor_date, v_cursor_key)
      )
      and (
        v_search = ''
        or position(v_search in lower(regexp_replace(concat_ws(' ',
          'TWA-' || left(adjustment.id::text, 8),
          (adjustment.approved_at at time zone 'Asia/Bangkok')::date::text,
          case when adjustment.amount > adjustment.adjustment_base_amount
            then 'เพิ่มยอดเบิกเงิน' else 'คืนยอดเบิกเงิน' end,
          profile.name,
          adjustment.description,
          case when adjustment.amount > adjustment.adjustment_base_amount then 'ค่าใช้จ่าย' else 'รายรับ' end,
          profile.phone
        ), '\s+', ' ', 'g'))) > 0
      )
  ), numbered as (
    select *, row_number() over (order by sort_date desc, sort_key desc) as row_no
    from feed
  ), page as (
    select * from numbered where row_no <= 101
  ), page_state as (
    select (
      (select count(*) from page) > 100
      or coalesce((v_result ->> 'hasMore')::boolean, false)
    ) as has_more
  )
  select
    coalesce((
      select jsonb_agg(row_data order by sort_date desc, sort_key desc)
      from page where row_no <= 100
    ), '[]'::jsonb),
    page_state.has_more,
    case when page_state.has_more then (
      select encode(convert_to(jsonb_build_object(
        'v', 1,
        'locationId', p_location_id,
        'mode', 'latest',
        'search', v_search,
        'sort', 'tx_date_desc',
        'date', sort_date,
        'key', sort_key
      )::text, 'utf8'), 'hex')
      from page where row_no = 100
    ) else null end
  into v_rows, v_has_more, v_next_cursor
  from page_state;

  v_result := jsonb_set(v_result, '{rows}', v_pinned_rows || v_rows, true);
  v_result := jsonb_set(v_result, '{hasMore}', to_jsonb(v_has_more), true);
  v_result := jsonb_set(v_result, '{nextCursor}', coalesce(to_jsonb(v_next_cursor), 'null'::jsonb), true);
  return v_result;
end;
$$;

revoke all on function public.get_income_expense_operational_feed(uuid, text, text, text)
  from public, anon;
grant execute on function public.get_income_expense_operational_feed(uuid, text, text, text)
  to authenticated;

comment on function public.get_income_expense_operational_feed(uuid, text, text, text) is
  'Authenticated Income/Expense operational feed with withdrawal adjustments. VOLATILE matches its delegated feed functions.';

-- Reuse the established report rows, adding only the signed adjustment delta.
alter function private.report_income_expense_period_rows(uuid)
  rename to report_income_expense_period_rows_before_withdrawal_adjustments;

create or replace function private.report_income_expense_period_rows(p_report_id uuid)
returns table (
  tx_date date,
  number text,
  entry_type text,
  title text,
  amount numeric,
  sort_key text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select *
  from private.report_income_expense_period_rows_before_withdrawal_adjustments(p_report_id)

  union all

  select
    (adjustment.approved_at at time zone 'Asia/Bangkok')::date,
    'TWA-' || left(adjustment.id::text, 8),
    case when adjustment.amount > adjustment.adjustment_base_amount then 'expense' else 'income' end,
    case when adjustment.amount > adjustment.adjustment_base_amount then 'เพิ่มยอดเบิกเงิน — ' else 'คืนยอดเบิกเงิน — ' end
      || coalesce(profile.name, 'พนักงาน') || coalesce(': ' || nullif(adjustment.description, ''), ''),
    abs(adjustment.amount - adjustment.adjustment_base_amount),
    '60A-' || adjustment.id::text
  from public.report_items item
  join public.financial_transactions adjustment on adjustment.id = item.entity_id
  join public.profiles profile on profile.id = adjustment.profile_id
  where item.report_id = p_report_id
    and item.entity_type = 'financial_transaction'
    and adjustment.type = 'ADJUSTMENT'
    and adjustment.amount <> adjustment.adjustment_base_amount;
$$;

revoke all on function private.report_income_expense_period_rows_before_withdrawal_adjustments(uuid)
  from public, anon, authenticated;
revoke all on function private.report_income_expense_period_rows(uuid) from public, anon, authenticated;

-- Cash count follows the report lock eligibility timestamp and the same signed delta.
alter function private.cash_count_events(uuid, timestamptz, timestamptz)
  rename to cash_count_events_before_withdrawal_adjustments;

create or replace function private.cash_count_events(
  p_location_id uuid,
  p_after_cutoff timestamptz,
  p_to_cutoff timestamptz
)
returns table (
  occurred_at timestamptz,
  event_kind text,
  amount numeric,
  counts jsonb,
  reference jsonb
)
language sql
stable
security definer
set search_path = public, private
as $$
  select *
  from private.cash_count_events_before_withdrawal_adjustments(
    p_location_id, p_after_cutoff, p_to_cutoff
  )

  union all

  select
    item.eligibility_at,
    case when adjustment.amount > adjustment.adjustment_base_amount then 'expense' else 'income' end,
    abs(adjustment.amount - adjustment.adjustment_base_amount),
    null::jsonb,
    jsonb_build_object(
      'source', 'financial_transaction',
      'id', adjustment.id,
      'label', coalesce(adjustment.description, 'ปรับยอดเบิกเงิน'),
      'amount', abs(adjustment.amount - adjustment.adjustment_base_amount)
    )
  from public.report_items item
  join public.report_batches batch on batch.id = item.report_id
  join public.financial_transactions adjustment on adjustment.id = item.entity_id
  where batch.location_id = p_location_id
    and batch.status = 'active'
    and item.active = true
    and item.entity_type = 'financial_transaction'
    and item.eligibility_at > p_after_cutoff
    and item.eligibility_at <= p_to_cutoff
    and adjustment.type = 'ADJUSTMENT'
    and adjustment.amount <> adjustment.adjustment_base_amount;
$$;

revoke all on function private.cash_count_events_before_withdrawal_adjustments(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function private.cash_count_events(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

alter function public.get_actionable_badge_counts()
  rename to get_actionable_badge_counts_before_withdrawal_adjustments;

create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with combined as (
    select *
    from public.get_actionable_badge_counts_before_withdrawal_adjustments()

    union all

    select primary_location.location_id, 'time-tracking'::text, count(*)::bigint
    from public.financial_transactions adjustment
    join public.user_locations primary_location
      on primary_location.user_id = adjustment.profile_id
      and primary_location.is_primary = true
    where adjustment.type = 'ADJUSTMENT'
      and adjustment.status = 'PENDING'
      and public.can_access_location(primary_location.location_id)
      and private.can_manage_time_payroll_profile(adjustment.profile_id)
    group by primary_location.location_id
  )
  select combined.location_id, combined.module_id, sum(combined.item_count)::bigint
  from combined
  group by combined.location_id, combined.module_id
  order by combined.location_id, combined.module_id;
$$;

revoke all on function public.get_actionable_badge_counts_before_withdrawal_adjustments()
  from public, anon, authenticated;
revoke all on function public.get_actionable_badge_counts() from public, anon;
grant execute on function public.get_actionable_badge_counts() to authenticated;

create or replace function private.prevent_approved_adjustment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if coalesce(current_setting('app.time_tracking_permanent_delete_rpc', true), 'false') = 'true' then
    if old.type = 'ADJUSTMENT' and old.status = 'APPROVED' then
      perform pg_advisory_xact_lock(
        hashtextextended('dashboard-money-history:withdrawal_adjustment:' || old.id::text, 0)
      );
      select projection.payload into v_payload
      from private.dashboard_money_event_projection projection
      where projection.source_type = 'withdrawal_adjustment'
        and projection.source_id = old.id
      limit 1;
      if v_payload is not null then
        perform private.append_dashboard_money_event(
          'withdrawal_adjustment', old.id, 'delete', v_payload, auth.uid(), null
        );
        delete from private.dashboard_money_event_projection
        where source_type = 'withdrawal_adjustment'
          and source_id = old.id;
      end if;
    end if;
    return old;
  end if;
  if old.type = 'ADJUSTMENT' and old.status = 'APPROVED' then
    raise exception 'APPROVED_ADJUSTMENT_DELETE_FORBIDDEN';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_approved_adjustment_delete on public.financial_transactions;
create trigger prevent_approved_adjustment_delete
  before delete on public.financial_transactions
  for each row execute function private.prevent_approved_adjustment_delete();

notify pgrst, 'reload schema';
