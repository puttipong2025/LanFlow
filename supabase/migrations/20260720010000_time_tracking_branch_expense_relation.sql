-- Approved withdrawals and payroll slips are source-linked branch expenses.
-- The Income/Expense feed derives the display row; no duplicate income_expense row is stored.

alter table public.financial_transactions
  add column if not exists expense_location_id uuid references public.locations(id),
  add column if not exists approved_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancel_reason text;

alter table public.payroll_slips
  add column if not exists expense_location_id uuid references public.locations(id),
  add column if not exists approved_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancel_reason text;

create index if not exists financial_transactions_withdrawal_expense_feed_idx
  on public.financial_transactions (expense_location_id, approved_at desc, id desc)
  where type = 'WITHDRAWAL' and status = 'APPROVED' and cancelled_at is null;

create index if not exists payroll_slips_expense_feed_idx
  on public.payroll_slips (expense_location_id, approved_at desc, id desc)
  where status = 'APPROVED' and cancelled_at is null and net_pay > 0;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_withdrawal_expense_assignment;

alter table public.financial_transactions
  add constraint financial_transactions_withdrawal_expense_assignment
  check (
    type <> 'WITHDRAWAL'
    or status <> 'APPROVED'
    or cancelled_at is not null
    or (expense_location_id is not null and approved_at is not null)
  ) not valid;

alter table public.payroll_slips
  drop constraint if exists payroll_slips_expense_assignment;

alter table public.payroll_slips
  add constraint payroll_slips_expense_assignment
  check (
    status <> 'APPROVED'
    or cancelled_at is not null
    or net_pay <= 0
    or (expense_location_id is not null and approved_at is not null)
  ) not valid;

create or replace function private.can_assign_time_tracking_expense_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and target_location is not null
    and exists (
      select 1
      from public.user_locations ul
      join public.locations l on l.id = ul.location_id
      where ul.user_id = auth.uid()
        and ul.location_id = target_location
        and l.is_active = true
    )
$$;

create or replace function private.can_approve_time_tracking_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      private.current_user_role() = 'super_admin'
      or (
        private.current_user_role() = 'admin'
        and exists (
          select 1
          from public.profiles p
          where p.id = target_profile_id
            and p.role = 'user'
            and p.is_active = true
        )
      )
    )
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
      and new.type = 'WITHDRAWAL' then
      if not v_rpc_write
        or new.expense_location_id is null
        or new.approved_at is null
        or new.cancelled_at is not null then
        raise exception 'Withdrawal approval must use the time tracking approval RPC';
      end if;
    end if;

    if old.status = 'APPROVED'
      and old.type = 'WITHDRAWAL'
      and (
        new.expense_location_id is distinct from old.expense_location_id
        or new.cancelled_at is distinct from old.cancelled_at
        or new.cancelled_by is distinct from old.cancelled_by
        or new.cancel_reason is distinct from old.cancel_reason
      )
      and not v_rpc_write then
      raise exception 'Withdrawal expense relation must be changed at its source through the time tracking RPC';
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

drop trigger if exists enforce_financial_transaction_expense_relation on public.financial_transactions;
create trigger enforce_financial_transaction_expense_relation
  before update on public.financial_transactions
  for each row execute function private.enforce_time_tracking_expense_relation();

drop trigger if exists enforce_payroll_slip_expense_relation on public.payroll_slips;
create trigger enforce_payroll_slip_expense_relation
  before update on public.payroll_slips
  for each row execute function private.enforce_time_tracking_expense_relation();

create or replace function private.prevent_hard_delete_of_linked_time_tracking_source()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_table_name = 'financial_transactions'
    and old.type = 'WITHDRAWAL'
    and old.status = 'APPROVED'
    and old.expense_location_id is not null then
    raise exception 'Approved withdrawal must be soft-cancelled through the time tracking RPC';
  end if;

  if tg_table_name = 'payroll_slips'
    and old.status = 'APPROVED'
    and old.net_pay > 0
    and old.expense_location_id is not null then
    raise exception 'Approved payroll slip must be soft-cancelled through the time tracking RPC';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_hard_delete_of_linked_financial_transaction on public.financial_transactions;
create trigger prevent_hard_delete_of_linked_financial_transaction
  before delete on public.financial_transactions
  for each row execute function private.prevent_hard_delete_of_linked_time_tracking_source();

drop trigger if exists prevent_hard_delete_of_linked_payroll_slip on public.payroll_slips;
create trigger prevent_hard_delete_of_linked_payroll_slip
  before delete on public.payroll_slips
  for each row execute function private.prevent_hard_delete_of_linked_time_tracking_source();

create or replace function public.decide_time_tracking_approval(
  p_source_type text,
  p_source_id uuid,
  p_decision text,
  p_comment text default null,
  p_expense_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_data jsonb;
  v_requires_expense_location boolean := false;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid approval source';
  end if;
  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'Invalid approval decision';
  end if;

  select role::text into v_actor_role from public.profiles where id = v_actor_id;

  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found then raise exception 'Transaction not found'; end if;
    if not private.can_approve_time_tracking_profile(v_tx.profile_id) then raise exception 'Forbidden'; end if;
    if v_tx.type = 'DEBT' and v_actor_role <> 'super_admin' then raise exception 'Only super_admin can approve debts'; end if;

    v_requires_expense_location := p_decision = 'APPROVED' and v_tx.type = 'WITHDRAWAL';
    if v_tx.status <> 'PENDING' then
      if v_tx.status = p_decision
        and (
          not v_requires_expense_location
          or v_tx.expense_location_id = p_expense_location_id
        ) then
        return jsonb_build_object('status', lower(p_decision), 'idempotent', true, 'sourceType', p_source_type, 'sourceId', p_source_id);
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_expense_location then
      if p_expense_location_id is null or not private.can_assign_time_tracking_expense_location(p_expense_location_id) then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_tx);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.financial_transactions
      set status = 'APPROVED',
          admin_comment = coalesce(p_comment, ''),
          approved_by = v_actor_id,
          approved_at = now(),
          expense_location_id = case when v_requires_expense_location then p_expense_location_id else null end,
          remaining_amount = case when v_tx.type in ('DEBT', 'WITHDRAWAL') then v_tx.amount else v_tx.remaining_amount end
      where id = v_tx.id;
    else
      update public.financial_transactions
      set status = 'REJECTED', admin_comment = coalesce(p_comment, ''), approved_by = v_actor_id
      where id = v_tx.id;
    end if;

    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (
      v_actor_id,
      'DECIDE_TRANSACTION_APPROVAL',
      'financial_transactions',
      v_tx.id,
      v_old_data,
      jsonb_build_object('decision', p_decision, 'expenseLocationId', p_expense_location_id),
      coalesce(p_comment, '')
    );

  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found then raise exception 'Payroll slip not found'; end if;
    if not private.can_approve_time_tracking_profile(v_slip.profile_id) then raise exception 'Forbidden'; end if;
    if v_slip.created_by = v_actor_id and v_actor_role <> 'super_admin' then raise exception 'Cannot approve your own slip'; end if;

    v_requires_expense_location := p_decision = 'APPROVED' and v_slip.net_pay > 0;
    if v_slip.status <> 'PENDING' then
      if v_slip.status = p_decision
        and (
          not v_requires_expense_location
          or v_slip.expense_location_id = p_expense_location_id
        ) then
        return jsonb_build_object('status', lower(p_decision), 'idempotent', true, 'sourceType', p_source_type, 'sourceId', p_source_id);
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_expense_location then
      if p_expense_location_id is null or not private.can_assign_time_tracking_expense_location(p_expense_location_id) then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_slip);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.payroll_slips
      set status = 'APPROVED',
          admin_comment = coalesce(p_comment, ''),
          approved_by = v_actor_id,
          approved_at = now(),
          expense_location_id = case when v_requires_expense_location then p_expense_location_id else null end
      where id = v_slip.id;
    else
      update public.payroll_slips
      set status = 'REJECTED', admin_comment = coalesce(p_comment, ''), approved_by = v_actor_id
      where id = v_slip.id;
    end if;

    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (
      v_actor_id,
      'DECIDE_PAYROLL_SLIP_APPROVAL',
      'payroll_slips',
      v_slip.id,
      v_old_data,
      jsonb_build_object('decision', p_decision, 'expenseLocationId', p_expense_location_id),
      coalesce(p_comment, '')
    );
  end if;

  return jsonb_build_object('status', lower(p_decision), 'idempotent', false, 'sourceType', p_source_type, 'sourceId', p_source_id);
end;
$$;

create or replace function public.change_time_tracking_expense_location(
  p_source_type text,
  p_source_id uuid,
  p_expense_location_id uuid,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_location_id uuid;
begin
  if v_actor_id is null or not private.is_active_user() then raise exception 'Authentication required'; end if;
  if p_source_type not in ('transaction', 'payroll_slip') or p_expense_location_id is null then raise exception 'Invalid expense source'; end if;
  if not private.can_assign_time_tracking_expense_location(p_expense_location_id) then raise exception 'New expense location access denied'; end if;

  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found or v_tx.type <> 'WITHDRAWAL' or v_tx.status <> 'APPROVED' or v_tx.cancelled_at is not null or v_tx.expense_location_id is null then
      raise exception 'Active withdrawal expense not found';
    end if;
    if not private.can_approve_time_tracking_profile(v_tx.profile_id) or not private.can_assign_time_tracking_expense_location(v_tx.expense_location_id) then
      raise exception 'Expense location access denied';
    end if;
    v_old_location_id := v_tx.expense_location_id;
    if v_old_location_id = p_expense_location_id then return jsonb_build_object('status', 'unchanged'); end if;
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.financial_transactions set expense_location_id = p_expense_location_id where id = v_tx.id;
    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (v_actor_id, 'CHANGE_TRANSACTION_EXPENSE_LOCATION', 'financial_transactions', v_tx.id, jsonb_build_object('expenseLocationId', v_old_location_id), jsonb_build_object('expenseLocationId', p_expense_location_id), coalesce(p_comment, ''));
  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found or v_slip.status <> 'APPROVED' or v_slip.net_pay <= 0 or v_slip.cancelled_at is not null or v_slip.expense_location_id is null then
      raise exception 'Active payroll expense not found';
    end if;
    if not private.can_approve_time_tracking_profile(v_slip.profile_id) or not private.can_assign_time_tracking_expense_location(v_slip.expense_location_id) then
      raise exception 'Expense location access denied';
    end if;
    v_old_location_id := v_slip.expense_location_id;
    if v_old_location_id = p_expense_location_id then return jsonb_build_object('status', 'unchanged'); end if;
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.payroll_slips set expense_location_id = p_expense_location_id where id = v_slip.id;
    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (v_actor_id, 'CHANGE_PAYROLL_EXPENSE_LOCATION', 'payroll_slips', v_slip.id, jsonb_build_object('expenseLocationId', v_old_location_id), jsonb_build_object('expenseLocationId', p_expense_location_id), coalesce(p_comment, ''));
  end if;

  return jsonb_build_object('status', 'updated', 'oldExpenseLocationId', v_old_location_id, 'expenseLocationId', p_expense_location_id);
end;
$$;

create or replace function public.cancel_time_tracking_expense_source(
  p_source_type text,
  p_source_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
begin
  if v_actor_id is null or not private.is_active_user() then raise exception 'Authentication required'; end if;
  if p_source_type not in ('transaction', 'payroll_slip') then raise exception 'Invalid expense source'; end if;

  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found or v_tx.type <> 'WITHDRAWAL' or v_tx.status <> 'APPROVED' or v_tx.expense_location_id is null then raise exception 'Withdrawal expense not found'; end if;
    if not private.can_approve_time_tracking_profile(v_tx.profile_id) then raise exception 'Forbidden'; end if;
    if v_tx.cancelled_at is not null then return jsonb_build_object('status', 'cancelled', 'idempotent', true); end if;
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.financial_transactions set cancelled_at = now(), cancelled_by = v_actor_id, cancel_reason = coalesce(p_reason, '') where id = v_tx.id;
    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (v_actor_id, 'CANCEL_TRANSACTION_EXPENSE', 'financial_transactions', v_tx.id, to_jsonb(v_tx), jsonb_build_object('cancelledAt', now()), coalesce(p_reason, ''));
  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found or v_slip.status <> 'APPROVED' or v_slip.net_pay <= 0 or v_slip.expense_location_id is null then raise exception 'Payroll expense not found'; end if;
    if not private.can_approve_time_tracking_profile(v_slip.profile_id) then raise exception 'Forbidden'; end if;
    if v_slip.cancelled_at is not null then return jsonb_build_object('status', 'cancelled', 'idempotent', true); end if;
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.payroll_slips set cancelled_at = now(), cancelled_by = v_actor_id, cancel_reason = coalesce(p_reason, '') where id = v_slip.id;
    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (v_actor_id, 'CANCEL_PAYROLL_EXPENSE', 'payroll_slips', v_slip.id, to_jsonb(v_slip), jsonb_build_object('cancelledAt', now()), coalesce(p_reason, ''));
  end if;

  return jsonb_build_object('status', 'cancelled', 'idempotent', false);
end;
$$;

revoke all on function public.decide_time_tracking_approval(text, uuid, text, text, uuid) from public, anon;
revoke all on function public.change_time_tracking_expense_location(text, uuid, uuid, text) from public, anon;
revoke all on function public.cancel_time_tracking_expense_source(text, uuid, text) from public, anon;
grant execute on function public.decide_time_tracking_approval(text, uuid, text, text, uuid) to authenticated;
grant execute on function public.change_time_tracking_expense_location(text, uuid, uuid, text) to authenticated;
grant execute on function public.cancel_time_tracking_expense_source(text, uuid, text) to authenticated;
