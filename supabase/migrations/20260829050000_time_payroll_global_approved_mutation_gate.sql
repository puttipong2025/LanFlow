-- Keep approved Time/Payroll payment corrections and destructive actions under
-- the global-manager boundary. Delegated creators may only withdraw their own
-- pending payroll slips; employee self-withdrawal remains unchanged.

create or replace function public.change_time_tracking_expense_location(
  p_source_type text,
  p_source_id uuid,
  p_expense_location_id uuid,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_location_id uuid;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if not private.is_global_time_payroll_manager() then
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
$$;

create or replace function public.delete_time_tracking_source_permanently(
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    ) and not private.is_global_time_payroll_manager() then
      raise exception 'Forbidden';
    end if;

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
    if not (
      v_slip.status = 'PENDING'
      and v_slip.created_by = v_actor_id
    ) and not private.is_global_time_payroll_manager() then
      raise exception 'Forbidden';
    end if;

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
$$;

revoke all on function public.change_time_tracking_expense_location(text, uuid, uuid, text) from public, anon;
grant execute on function public.change_time_tracking_expense_location(text, uuid, uuid, text) to authenticated, service_role;

revoke all on function public.delete_time_tracking_source_permanently(text, uuid) from public, anon;
grant execute on function public.delete_time_tracking_source_permanently(text, uuid) to authenticated, service_role;
