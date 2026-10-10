-- Split approved Time/Payroll payments between a source-owned bank transfer and
-- the existing branch expense projection. Existing rows remain legacy and are
-- intentionally not backfilled.

alter table public.financial_transactions
  add column payment_contract_version smallint,
  add column payment_channel text,
  add column payment_transfer_amount numeric(14,2);

alter table public.payroll_slips
  add column payment_contract_version smallint,
  add column payment_channel text,
  add column payment_transfer_amount numeric(14,2);

alter table public.financial_transactions
  add constraint financial_transactions_payment_allocation_check check (
    (
      payment_contract_version is null
      and payment_channel is null
      and payment_transfer_amount is null
    ) or (
      type = 'WITHDRAWAL'
      and payment_contract_version = 1
      and payment_channel in ('branch_and_transfer', 'outside_system')
      and payment_transfer_amount is not null
      and payment_transfer_amount >= 0
      and payment_transfer_amount <= amount
      and (
        (payment_channel = 'outside_system' and expense_location_id is null and payment_transfer_amount = 0)
        or (payment_channel = 'branch_and_transfer' and expense_location_id is not null)
      )
    )
  );

alter table public.payroll_slips
  add constraint payroll_slips_payment_allocation_check check (
    (
      payment_contract_version is null
      and payment_channel is null
      and payment_transfer_amount is null
    ) or (
      payment_contract_version = 1
      and payment_channel in ('branch_and_transfer', 'outside_system')
      and payment_transfer_amount is not null
      and payment_transfer_amount >= 0
      and payment_transfer_amount <= net_pay
      and (
        (payment_channel = 'outside_system' and expense_location_id is null and payment_transfer_amount = 0)
        or (payment_channel = 'branch_and_transfer' and expense_location_id is not null)
      )
    )
  );

alter table public.money_transfers
  add column withdrawal_transaction_id uuid references public.financial_transactions(id),
  add column payroll_slip_id uuid references public.payroll_slips(id),
  add column time_payroll_source_kind text,
  add column time_payroll_employee_name text,
  add column time_payroll_source_label text,
  add column time_payroll_source_date date,
  add constraint money_transfers_withdrawal_transaction_id_key unique (withdrawal_transaction_id),
  add constraint money_transfers_payroll_slip_id_key unique (payroll_slip_id);

alter table public.money_transfers
  drop constraint money_transfers_transfer_type_check,
  add constraint money_transfers_transfer_type_check
    check (transfer_type in ('customer', 'transport', 'branch', 'cash', 'rubber_export_work', 'time_payroll')),
  add constraint money_transfers_time_payroll_source_check check (
    (
      transfer_type = 'time_payroll'
      and ((withdrawal_transaction_id is not null)::integer + (payroll_slip_id is not null)::integer) = 1
      and time_payroll_source_kind in ('withdrawal', 'payroll')
      and nullif(btrim(time_payroll_employee_name), '') is not null
      and nullif(btrim(time_payroll_source_label), '') is not null
      and time_payroll_source_date is not null
      and customer_id is null and customer_name is null
      and transport_staff_id is null and transport_staff_name is null
      and target_location_id is null and target_location_name is null
      and account_number is null and account_name is null and bank_name is null
    ) or (
      transfer_type <> 'time_payroll'
      and withdrawal_transaction_id is null
      and payroll_slip_id is null
      and time_payroll_source_kind is null
      and time_payroll_employee_name is null
      and time_payroll_source_label is null
      and time_payroll_source_date is null
    )
  );

create or replace function private.time_payroll_branch_paid_amount(
  p_source_amount numeric,
  p_contract_version smallint,
  p_channel text,
  p_transfer_amount numeric,
  p_expense_location_id uuid
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_source_amount is null or p_source_amount <= 0 then 0::numeric
    when p_contract_version is null then
      case when p_expense_location_id is null then 0::numeric else p_source_amount end
    when p_contract_version = 1 and p_channel = 'branch_and_transfer' then
      greatest(round(p_source_amount - coalesce(p_transfer_amount, 0), 2), 0)
    else 0::numeric
  end;
$$;

create or replace function private.validate_time_payroll_payment(
  p_payment jsonb,
  p_source_amount numeric
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_channel text;
  v_location_id uuid;
  v_transfer_amount numeric;
  v_expected_amount numeric;
begin
  if p_payment is null or jsonb_typeof(p_payment) <> 'object' then
    raise exception 'PAYMENT_INVALID_PAYLOAD';
  end if;
  if p_source_amount is null or p_source_amount < 0 then
    raise exception 'PAYMENT_INVALID_SOURCE_AMOUNT';
  end if;

  begin
    v_channel := p_payment ->> 'channel';
    v_expected_amount := (p_payment ->> 'expectedSourceAmount')::numeric;
  exception when others then
    raise exception 'PAYMENT_INVALID_PAYLOAD';
  end;
  if v_expected_amount is distinct from p_source_amount then
    raise exception 'PAYMENT_AMOUNT_CHANGED';
  end if;

  if v_channel = 'outside_system' then
    if coalesce(p_payment -> 'expenseLocationId', 'null'::jsonb) <> 'null'::jsonb
      or coalesce(p_payment -> 'transferAmount', 'null'::jsonb) <> 'null'::jsonb then
      raise exception 'PAYMENT_INVALID_OUTSIDE_SYSTEM';
    end if;
    return jsonb_build_object(
      'contractVersion', 1,
      'channel', v_channel,
      'expenseLocationId', null,
      'transferAmount', 0,
      'branchPaidAmount', 0,
      'expectedSourceAmount', p_source_amount
    );
  end if;

  if v_channel <> 'branch_and_transfer' then
    raise exception 'PAYMENT_INVALID_CHANNEL';
  end if;
  begin
    v_location_id := nullif(p_payment ->> 'expenseLocationId', '')::uuid;
    v_transfer_amount := (p_payment ->> 'transferAmount')::numeric;
  exception when others then
    raise exception 'PAYMENT_INVALID_SPLIT';
  end;
  if v_location_id is null then raise exception 'PAYMENT_BRANCH_REQUIRED'; end if;
  if v_transfer_amount is null
    or v_transfer_amount < 0
    or v_transfer_amount > p_source_amount
    or v_transfer_amount <> round(v_transfer_amount, 2) then
    raise exception 'PAYMENT_INVALID_SPLIT';
  end if;

  return jsonb_build_object(
    'contractVersion', 1,
    'channel', v_channel,
    'expenseLocationId', v_location_id,
    'transferAmount', v_transfer_amount,
    'branchPaidAmount', round(p_source_amount - v_transfer_amount, 2),
    'expectedSourceAmount', p_source_amount
  );
end;
$$;

create or replace function private.guard_time_payroll_payment_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.payment_contract_version = 1 or new.payment_contract_version = 1)
    and (
      new.payment_contract_version is distinct from old.payment_contract_version
      or new.payment_channel is distinct from old.payment_channel
      or new.payment_transfer_amount is distinct from old.payment_transfer_amount
      or new.expense_location_id is distinct from old.expense_location_id
    )
    and coalesce(current_setting('app.time_payroll_payment_rpc', true), 'false') <> 'true'
  then
    raise exception 'PAYMENT_USE_ALLOCATION_API';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_time_payroll_payment_source on public.financial_transactions;
create trigger guard_time_payroll_payment_source
before update on public.financial_transactions
for each row execute function private.guard_time_payroll_payment_source();

drop trigger if exists guard_time_payroll_payment_source on public.payroll_slips;
create trigger guard_time_payroll_payment_source
before update on public.payroll_slips
for each row execute function private.guard_time_payroll_payment_source();

create or replace function private.guard_time_payroll_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_amount numeric;
  v_source_location_id uuid;
  v_source_name text;
  v_source_kind text;
  v_source_label text;
  v_source_date date;
begin
  if tg_op = 'UPDATE' and old.transfer_type = 'time_payroll'
    and coalesce(current_setting('app.time_payroll_payment_rpc', true), 'false') <> 'true' then
    if (to_jsonb(new) - array['transfer_status', 'revision_no', 'updated_at'])
      is distinct from
      (to_jsonb(old) - array['transfer_status', 'revision_no', 'updated_at']) then
      raise exception 'TIME_PAYROLL_TRANSFER_LOCKED';
    end if;
    return new;
  end if;

  if new.transfer_type <> 'time_payroll' then return new; end if;
  if tg_op = 'UPDATE' and old.transfer_type <> 'time_payroll' then
    raise exception 'TIME_PAYROLL_TRANSFER_INVALID';
  end if;

  if new.withdrawal_transaction_id is not null then
    select source.payment_transfer_amount, source.expense_location_id, profile.name,
      'withdrawal', 'เงินเบิก ' || to_char(source.effective_date, 'DD/MM/YYYY'), source.effective_date
    into v_source_amount, v_source_location_id, v_source_name,
      v_source_kind, v_source_label, v_source_date
    from public.financial_transactions source
    join public.profiles profile on profile.id = source.profile_id
    where source.id = new.withdrawal_transaction_id
      and source.type = 'WITHDRAWAL'
      and source.status = 'APPROVED'
      and source.cancelled_at is null
      and source.payment_contract_version = 1
      and source.payment_channel = 'branch_and_transfer';
  else
    select source.payment_transfer_amount, source.expense_location_id, profile.name,
      'payroll', 'เงินเดือน ' || source.month, coalesce((source.approved_at at time zone 'Asia/Bangkok')::date, current_date)
    into v_source_amount, v_source_location_id, v_source_name,
      v_source_kind, v_source_label, v_source_date
    from public.payroll_slips source
    join public.profiles profile on profile.id = source.profile_id
    where source.id = new.payroll_slip_id
      and source.status = 'APPROVED'
      and source.cancelled_at is null
      and source.payment_contract_version = 1
      and source.payment_channel = 'branch_and_transfer';
  end if;

  if v_source_amount is null or v_source_amount <= 0
    or new.location_id is distinct from v_source_location_id
    or new.net_amount_to_pay is distinct from v_source_amount
    or new.time_payroll_source_kind is distinct from v_source_kind
    or new.time_payroll_employee_name is distinct from v_source_name
    or new.time_payroll_source_label is distinct from v_source_label
    or new.time_payroll_source_date is distinct from v_source_date
    or new.transfer_method <> 'bank'
    or new.record_status <> 'active' then
    raise exception 'TIME_PAYROLL_TRANSFER_INVALID';
  end if;
  return new;
end;
$$;

create trigger guard_time_payroll_transfer
before insert or update on public.money_transfers
for each row execute function private.guard_time_payroll_transfer();

create or replace function private.apply_time_payroll_payment(
  p_source_type text,
  p_source_id uuid,
  p_payment jsonb,
  p_require_unlocked boolean default false,
  p_audit_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_transfer public.money_transfers%rowtype;
  v_allocation jsonb;
  v_source_amount numeric;
  v_location_id uuid;
  v_existing_location_id uuid;
  v_transfer_location_id uuid;
  v_transfer_amount numeric;
  v_employee_name text;
  v_source_kind text;
  v_source_label text;
  v_source_date date;
  v_source_report_no text;
  v_transfer_report_no text;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
  v_old_data jsonb;
begin
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'PAYMENT_INVALID_SOURCE';
  end if;

  perform set_config('app.time_payroll_payment_rpc', 'true', true);
  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found or v_tx.type <> 'WITHDRAWAL' or v_tx.status <> 'APPROVED' or v_tx.cancelled_at is not null then
      raise exception 'PAYMENT_SOURCE_NOT_APPROVED';
    end if;
    v_source_amount := v_tx.amount;
    v_existing_location_id := v_tx.expense_location_id;
    v_source_report_no := public.report_lock_no(v_tx);
    select profile.name into v_employee_name from public.profiles profile where profile.id = v_tx.profile_id;
    v_source_kind := 'withdrawal';
    v_source_label := 'เงินเบิก ' || to_char(v_tx.effective_date, 'DD/MM/YYYY');
    v_source_date := v_tx.effective_date;
    v_old_data := jsonb_build_object(
      'contractVersion', v_tx.payment_contract_version,
      'channel', v_tx.payment_channel,
      'expenseLocationId', v_tx.expense_location_id,
      'transferAmount', v_tx.payment_transfer_amount
    );
  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found or v_slip.status <> 'APPROVED' or v_slip.cancelled_at is not null or v_slip.net_pay <= 0 then
      raise exception 'PAYMENT_SOURCE_NOT_APPROVED';
    end if;
    v_source_amount := v_slip.net_pay;
    v_existing_location_id := v_slip.expense_location_id;
    v_source_report_no := public.report_lock_no(v_slip);
    select profile.name into v_employee_name from public.profiles profile where profile.id = v_slip.profile_id;
    v_source_kind := 'payroll';
    v_source_label := 'เงินเดือน ' || v_slip.month;
    v_source_date := coalesce((v_slip.approved_at at time zone 'Asia/Bangkok')::date, (v_now at time zone 'Asia/Bangkok')::date);
    v_old_data := jsonb_build_object(
      'contractVersion', v_slip.payment_contract_version,
      'channel', v_slip.payment_channel,
      'expenseLocationId', v_slip.expense_location_id,
      'transferAmount', v_slip.payment_transfer_amount
    );
  end if;

  v_allocation := private.validate_time_payroll_payment(p_payment, v_source_amount);
  v_location_id := nullif(v_allocation ->> 'expenseLocationId', '')::uuid;
  v_transfer_amount := (v_allocation ->> 'transferAmount')::numeric;
  if v_location_id is not null and not private.can_assign_time_tracking_expense_location(v_location_id) then
    raise exception 'PAYMENT_BRANCH_DENIED';
  end if;

  select transfer.location_id into v_transfer_location_id
  from public.money_transfers transfer
  where transfer.withdrawal_transaction_id = case when p_source_type = 'transaction' then p_source_id end
     or transfer.payroll_slip_id = case when p_source_type = 'payroll_slip' then p_source_id end;
  perform private.lock_report_locations(array[
    v_existing_location_id, v_location_id, v_transfer_location_id
  ]);

  select * into v_transfer
  from public.money_transfers transfer
  where transfer.withdrawal_transaction_id = case when p_source_type = 'transaction' then p_source_id end
     or transfer.payroll_slip_id = case when p_source_type = 'payroll_slip' then p_source_id end
  for update;

  if p_require_unlocked then
    if v_source_report_no is not null then perform private.raise_report_lock(v_source_report_no); end if;
    if v_transfer.id is not null then
      v_transfer_report_no := public.report_lock_no(v_transfer);
      if v_transfer_report_no is not null then perform private.raise_report_lock(v_transfer_report_no); end if;
      if exists (select 1 from public.money_transfer_slips slip where slip.transfer_id = v_transfer.id) then
        raise exception 'PAYMENT_TRANSFER_HAS_SLIPS';
      end if;
    end if;
  end if;

  if p_source_type = 'transaction' then
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.financial_transactions
    set payment_contract_version = 1,
        payment_channel = v_allocation ->> 'channel',
        payment_transfer_amount = v_transfer_amount,
        expense_location_id = v_location_id
    where id = p_source_id;
  else
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.payroll_slips
    set payment_contract_version = 1,
        payment_channel = v_allocation ->> 'channel',
        payment_transfer_amount = v_transfer_amount,
        expense_location_id = v_location_id
    where id = p_source_id;
  end if;

  if v_transfer_amount = 0 then
    if v_transfer.id is not null then
      delete from public.money_transfer_slips where transfer_id = v_transfer.id;
      delete from public.money_transfers where id = v_transfer.id;
    end if;
  elsif v_transfer.id is null then
    select profile.name, profile.phone into v_actor_name, v_actor_phone
    from public.profiles profile where profile.id = auth.uid();
    insert into public.money_transfers (
      location_id, withdrawal_transaction_id, payroll_slip_id,
      time_payroll_source_kind, time_payroll_employee_name,
      time_payroll_source_label, time_payroll_source_date,
      net_amount_to_pay, transfer_type, transfer_method, transfer_status,
      sync_status, record_status, created_by_user_id, created_by_name,
      created_by_phone, server_received_at
    ) values (
      v_location_id,
      case when p_source_type = 'transaction' then p_source_id end,
      case when p_source_type = 'payroll_slip' then p_source_id end,
      v_source_kind, coalesce(v_employee_name, 'พนักงาน'), v_source_label, v_source_date,
      v_transfer_amount, 'time_payroll', 'bank', 'pending',
      'synced', 'active', auth.uid(), coalesce(v_actor_name, ''),
      coalesce(v_actor_phone, ''), v_now
    );
  else
    update public.money_transfers
    set location_id = v_location_id,
        net_amount_to_pay = v_transfer_amount,
        time_payroll_employee_name = coalesce(v_employee_name, 'พนักงาน'),
        time_payroll_source_label = v_source_label,
        time_payroll_source_date = v_source_date,
        transfer_status = 'pending',
        revision_no = revision_no + 1,
        updated_at = v_now
    where id = v_transfer.id;
  end if;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, new_data, comment
  ) values (
    auth.uid(),
    case when p_source_type = 'transaction' then 'CHANGE_TRANSACTION_PAYMENT' else 'CHANGE_PAYROLL_PAYMENT' end,
    case when p_source_type = 'transaction' then 'financial_transactions' else 'payroll_slips' end,
    p_source_id,
    v_old_data,
    v_allocation,
    coalesce(p_audit_comment, '')
  );

  return v_allocation;
end;
$$;

create or replace function public.decide_time_tracking_approval_with_payment(
  p_source_type text,
  p_source_id uuid,
  p_decision text,
  p_comment text default null,
  p_payment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_status text;
  v_version smallint;
  v_result jsonb;
  v_allocation jsonb;
  v_source_amount numeric;
begin
  if auth.uid() is null or not private.has_time_payroll_manager_access() then
    raise exception 'Forbidden';
  end if;
  if p_source_type = 'transaction' then
    select profile_id into v_profile_id
    from public.financial_transactions where id = p_source_id;
  elsif p_source_type = 'payroll_slip' then
    select profile_id into v_profile_id
    from public.payroll_slips where id = p_source_id;
  else
    raise exception 'PAYMENT_INVALID_SOURCE';
  end if;
  if v_profile_id is null then raise exception 'PAYMENT_SOURCE_NOT_FOUND'; end if;
  if not private.can_manage_time_payroll_profile(v_profile_id) then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_profile_id::text, 0));
  if p_source_type = 'transaction' then
    select status::text, payment_contract_version, amount
    into v_status, v_version, v_source_amount
    from public.financial_transactions where id = p_source_id;
  else
    select status::text, payment_contract_version, net_pay
    into v_status, v_version, v_source_amount
    from public.payroll_slips where id = p_source_id;
  end if;
  if not found then raise exception 'PAYMENT_SOURCE_NOT_FOUND'; end if;

  if p_decision = 'REJECTED' then
    if p_payment is not null then raise exception 'PAYMENT_INVALID_PAYLOAD'; end if;
    return public.decide_time_tracking_approval(p_source_type, p_source_id, p_decision, p_comment, null);
  end if;
  if p_decision <> 'APPROVED' then
    raise exception 'PAYMENT_INVALID_PAYLOAD';
  end if;
  if v_source_amount <= 0 and p_payment is not null then
    raise exception 'PAYMENT_INVALID_PAYLOAD';
  end if;
  if p_payment is null then
    if v_source_amount > 0 then
      raise exception 'PAYMENT_REQUIRED';
    end if;
    return public.decide_time_tracking_approval(
      p_source_type, p_source_id, 'APPROVED', p_comment, null
    );
  end if;
  v_allocation := private.validate_time_payroll_payment(p_payment, v_source_amount);

  if v_status = 'APPROVED' and v_version = 1 then
    if exists (
      select 1 from public.financial_transactions source
      where p_source_type = 'transaction' and source.id = p_source_id
        and source.payment_channel = v_allocation ->> 'channel'
        and source.expense_location_id is not distinct from nullif(v_allocation ->> 'expenseLocationId', '')::uuid
        and source.payment_transfer_amount = (v_allocation ->> 'transferAmount')::numeric
    ) or exists (
      select 1 from public.payroll_slips source
      where p_source_type = 'payroll_slip' and source.id = p_source_id
        and source.payment_channel = v_allocation ->> 'channel'
        and source.expense_location_id is not distinct from nullif(v_allocation ->> 'expenseLocationId', '')::uuid
        and source.payment_transfer_amount = (v_allocation ->> 'transferAmount')::numeric
    ) then
      return jsonb_build_object('status', 'approved', 'payment', v_allocation, 'replayed', true);
    end if;
    raise exception 'PAYMENT_ALREADY_DECIDED';
  end if;

  v_result := public.decide_time_tracking_approval(
    p_source_type, p_source_id, 'APPROVED', p_comment, null
  );
  v_allocation := private.apply_time_payroll_payment(
    p_source_type, p_source_id, p_payment, false
  );
  return v_result || jsonb_build_object('payment', v_allocation);
end;
$$;

create or replace function public.change_time_tracking_payment(
  p_source_type text,
  p_source_id uuid,
  p_payment jsonb,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_existing_location_id uuid;
  v_allocation jsonb;
begin
  if auth.uid() is null or not private.is_active_user() or not private.has_time_payroll_manager_access() then
    raise exception 'Forbidden';
  end if;
  if p_source_type = 'transaction' then
    select profile_id into v_profile_id
    from public.financial_transactions where id = p_source_id;
  elsif p_source_type = 'payroll_slip' then
    select profile_id into v_profile_id
    from public.payroll_slips where id = p_source_id;
  else
    raise exception 'PAYMENT_INVALID_SOURCE';
  end if;
  if v_profile_id is null or not private.can_manage_time_payroll_profile(v_profile_id) then
    raise exception 'Forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_profile_id::text, 0));
  if p_source_type = 'transaction' then
    select expense_location_id into v_existing_location_id
    from public.financial_transactions where id = p_source_id;
  else
    select expense_location_id into v_existing_location_id
    from public.payroll_slips where id = p_source_id;
  end if;
  if not found then raise exception 'PAYMENT_SOURCE_NOT_FOUND'; end if;
  if not private.is_global_time_payroll_manager()
    and v_existing_location_id is not null
    and not private.can_assign_time_tracking_expense_location(v_existing_location_id)
  then
    raise exception 'Existing expense location access denied';
  end if;
  v_allocation := private.apply_time_payroll_payment(
    p_source_type, p_source_id, p_payment, true, p_comment
  );
  return jsonb_build_object('status', 'updated', 'payment', v_allocation);
end;
$$;

create or replace function public.create_time_tracking_withdrawal_with_payment(
  p_profile_id uuid,
  p_amount numeric,
  p_effective_date date,
  p_description text,
  p_payment jsonb,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created jsonb;
  v_allocation jsonb;
begin
  v_created := public.create_time_tracking_transaction(
    p_profile_id, 'WITHDRAWAL', p_amount, p_effective_date, p_description, null, p_comment
  );
  v_allocation := private.apply_time_payroll_payment(
    'transaction', (v_created ->> 'id')::uuid, p_payment, false
  );
  return v_created || jsonb_build_object('payment', v_allocation);
end;
$$;

create or replace function public.create_time_tracking_payroll_slip_with_payment(
  p_profile_id uuid,
  p_month text,
  p_auto_start_next_month boolean,
  p_payment jsonb,
  p_comment text,
  p_expected_net_pay numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created jsonb;
  v_allocation jsonb;
begin
  v_created := public.create_time_tracking_payroll_slip(
    p_profile_id, p_month, p_auto_start_next_month, null, p_comment, p_expected_net_pay
  );
  if (v_created ->> 'net_pay')::numeric > 0 then
    v_allocation := private.apply_time_payroll_payment(
      'payroll_slip', (v_created ->> 'id')::uuid, p_payment, false
    );
  elsif p_payment is not null then
    raise exception 'PAYMENT_INVALID_PAYLOAD';
  end if;
  return v_created || jsonb_build_object('payment', v_allocation);
end;
$$;

create or replace function private.delete_time_payroll_transfer_for_source(
  p_source_type text,
  p_source_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.money_transfers%rowtype;
  v_report_no text;
begin
  select * into v_transfer
  from public.money_transfers transfer
  where transfer.withdrawal_transaction_id = case when p_source_type = 'transaction' then p_source_id end
     or transfer.payroll_slip_id = case when p_source_type = 'payroll_slip' then p_source_id end
  for update;
  if v_transfer.id is null then return; end if;
  if not private.can_access_money_transfer_module()
    or not private.can_access_location(v_transfer.location_id) then
    raise exception 'PAYMENT_DELETE_REQUIRES_MONEY_TRANSFER_ACCESS';
  end if;
  v_report_no := public.report_lock_no(v_transfer);
  if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
  perform set_config('app.time_payroll_payment_rpc', 'true', true);
  delete from public.money_transfer_slips where transfer_id = v_transfer.id;
  delete from public.money_transfers where id = v_transfer.id;
end;
$$;

do $migration$
declare
  v_definition text;
  v_tx_old text := 'delete from public.financial_transactions where id = v_tx.id;';
  v_tx_new text := 'perform private.lock_report_locations(array[v_tx.expense_location_id]);' || chr(10)
    || '    perform private.delete_time_payroll_transfer_for_source(''transaction'', v_tx.id);' || chr(10)
    || '    delete from public.financial_transactions where id = v_tx.id;';
  v_slip_old text := 'delete from public.payroll_slips where id = v_slip.id;';
  v_slip_new text := 'perform private.lock_report_locations(array[v_slip.expense_location_id]);' || chr(10)
    || '    perform private.delete_time_payroll_transfer_for_source(''payroll_slip'', v_slip.id);' || chr(10)
    || '    delete from public.payroll_slips where id = v_slip.id;';
begin
  select pg_get_functiondef(
    'public.delete_time_tracking_source_permanently(text,uuid)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_tx_old) = 0 or strpos(v_definition, v_slip_old) = 0 then
    raise exception 'TIME_PAYROLL_PAYMENT_DELETE_PATCH_BLOCKED';
  end if;
  execute replace(replace(v_definition, v_tx_old, v_tx_new), v_slip_old, v_slip_new);
end;
$migration$;

create or replace function public.save_source_owned_money_transfer_slips(
  p_transfer_id uuid,
  p_expected_revision integer,
  p_slips jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
  v_transfer public.money_transfers%rowtype;
  v_slip_ids uuid[];
  v_paid numeric;
  v_fingerprint text;
  v_report_no text;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  if p_transfer_id is null or p_expected_revision is null or p_slips is null
    or jsonb_typeof(p_slips) <> 'array' then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลสลิปไม่ครบ';
  end if;
  select location_id into v_location_id from public.money_transfers where id = p_transfer_id;
  if v_location_id is null then raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน'; end if;
  if not private.can_access_location(v_location_id) then raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));
  select * into v_transfer from public.money_transfers where id = p_transfer_id for update;
  if v_transfer.id is null or v_transfer.transfer_type not in ('rubber_export_work', 'time_payroll')
    or v_transfer.record_status <> 'active' or v_transfer.location_id <> v_location_id then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนจากต้นทาง';
  end if;
  if v_transfer.revision_no <> p_expected_revision then raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่'; end if;
  v_report_no := public.report_lock_no(v_transfer);
  if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
  if exists (select 1 from jsonb_array_elements(p_slips) x group by x->>'id' having count(*) > 1) then
    raise exception 'MT_DUPLICATE_SLIP_ID: มีรหัสสลิปซ้ำในรายการ';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    where nullif(x->>'id', '') is null
      or coalesce((x->>'amount')::numeric, 0) <= 0
      or coalesce((x->>'fee')::numeric, 0) < 0
      or nullif(x->>'transactionDate', '') is null
      or x->>'inputMethod' not in ('manual', 'ocr')
      or (x->>'inputMethod' = 'manual' and nullif(trim(x->>'referenceNumber'), '') is not null)
      or (x->>'inputMethod' = 'ocr' and nullif(trim(x->>'referenceNumber'), '') is null)
  ) then raise exception 'MT_INVALID_SLIP: จำนวนเงิน ค่าธรรมเนียม วันเวลา หรือที่มาของสลิปไม่ถูกต้อง'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    join public.money_transfer_slips s on s.id = (x->>'id')::uuid
    where s.transfer_id <> p_transfer_id
  ) then raise exception 'MT_SLIP_PARENT_CONFLICT: สลิปอยู่ในรายการโอนอื่น'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    where x->>'inputMethod' = 'ocr'
    group by private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    ) having count(*) > 1
  ) then raise exception 'MT_OCR_DUPLICATE: พบสลิป OCR ซ้ำในรายการ'; end if;
  for v_fingerprint in
    select distinct private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    ) from jsonb_array_elements(p_slips) x where x->>'inputMethod' = 'ocr' order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('money-transfer-ocr:' || v_fingerprint, 0));
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    join public.money_transfer_slips s
      on s.ocr_fingerprint = private.money_transfer_ocr_fingerprint(
        x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
      )
    join public.money_transfers t on t.id = s.transfer_id and t.record_status <> 'deleted'
    where x->>'inputMethod' = 'ocr' and t.id <> p_transfer_id
  ) then raise exception 'MT_OCR_DUPLICATE: สลิป OCR ถูกใช้ในรายการอื่นแล้ว'; end if;
  select coalesce(array_agg((x->>'id')::uuid), array[]::uuid[])
  into v_slip_ids from jsonb_array_elements(p_slips) x;
  delete from public.money_transfer_slips s
  where s.transfer_id = p_transfer_id and not (s.id = any(v_slip_ids));
  insert into public.money_transfer_slips (
    id, transfer_id, amount, reference_number, fee, sender_name, receiver_name,
    transaction_date, slip_image_url, sort_order, input_method, ocr_fingerprint
  )
  select (x->>'id')::uuid, p_transfer_id, (x->>'amount')::numeric,
    case when x->>'inputMethod' = 'manual' then null else nullif(x->>'referenceNumber', '') end,
    coalesce((x->>'fee')::numeric, 0), null, null,
    (x->>'transactionDate')::timestamptz, null,
    coalesce((x->>'sortOrder')::integer, 0), x->>'inputMethod',
    case when x->>'inputMethod' = 'ocr' then private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    ) end
  from jsonb_array_elements(p_slips) x
  on conflict (id) do update set
    amount = excluded.amount, reference_number = excluded.reference_number,
    fee = excluded.fee, transaction_date = excluded.transaction_date,
    sort_order = excluded.sort_order, input_method = excluded.input_method,
    ocr_fingerprint = excluded.ocr_fingerprint, sender_name = null,
    receiver_name = null, slip_image_url = null, updated_at = now()
  where money_transfer_slips.transfer_id = p_transfer_id;
  select coalesce(sum(amount), 0) into v_paid from public.money_transfer_slips where transfer_id = p_transfer_id;
  update public.money_transfers
  set transfer_status = case
      when v_paid = 0 then 'pending'
      when v_paid < v_transfer.net_amount_to_pay then 'partial'
      when v_paid = v_transfer.net_amount_to_pay then 'paid'
      else 'overpaid'
    end,
    revision_no = revision_no + 1,
    updated_at = now()
  where id = p_transfer_id;
  return public.get_money_transfer_detail(p_transfer_id);
exception
  when invalid_text_representation
    or numeric_value_out_of_range
    or invalid_datetime_format
    or datetime_field_overflow
  then
    raise exception 'MT_INVALID_SLIP: จำนวนเงิน ค่าธรรมเนียม วันเวลา หรือรูปแบบข้อมูลสลิปไม่ถูกต้อง';
end;
$$;

create or replace function public.save_rubber_export_work_transfer_slips(
  p_transfer_id uuid,
  p_expected_revision integer,
  p_slips jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
begin
  select transfer_type into v_type from public.money_transfers where id = p_transfer_id;
  if v_type <> 'rubber_export_work' then raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนค่าทำงาน'; end if;
  return public.save_source_owned_money_transfer_slips(p_transfer_id, p_expected_revision, p_slips);
end;
$$;

create or replace function public.get_money_transfer_list(
  p_location_id uuid,
  p_status text default 'all',
  p_search text default '',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_search text := lower(trim(coalesce(p_search, '')));
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then raise exception 'Money transfer module access denied'; end if;
  if not private.can_access_location(p_location_id) then raise exception 'Location access denied'; end if;
  if p_page_size < 1 or p_page_size > 100 then raise exception 'Invalid page size'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'Invalid transfer cursor'; end if;
  with candidates as (
    select t.*, e.export_no as rubber_export_no,
      public.report_lock_no(t) report_lock_no,
      coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = t.id), 0) paid_amount,
      coalesce((select count(*) from public.money_transfer_slips s where s.transfer_id = t.id), 0) slip_count,
      coalesce((select count(*) from public.money_transfer_items i where i.transfer_id = t.id), 0) source_count
    from public.money_transfers t
    left join public.rubber_exports e on e.id = t.rubber_export_id
    where t.location_id = p_location_id
      and t.record_status <> 'deleted'
      and t.transfer_type <> 'cash'
      and (p_status = 'all' or t.transfer_status = p_status)
      and (v_search = '' or position(v_search in lower(concat_ws(' ',
        t.customer_name, t.account_number, t.account_name, t.bank_name,
        t.transport_staff_name, t.target_location_name, e.export_no,
        t.time_payroll_employee_name, t.time_payroll_source_label, t.id::text
      ))) > 0)
      and (p_cursor_created_at is null or (t.created_at, t.id) < (p_cursor_created_at, p_cursor_id))
    order by t.created_at desc, t.id desc
    limit p_page_size + 1
  ), visible as (
    select * from candidates order by created_at desc, id desc limit p_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc, v.id desc) from visible v), '[]'::jsonb),
    'statusCounts', (select jsonb_build_object(
      'all', count(*),
      'pending', count(*) filter (where t.transfer_status = 'pending'),
      'partial', count(*) filter (where t.transfer_status = 'partial'),
      'advance_payment', count(*) filter (where t.transfer_status = 'advance_payment'),
      'paid', count(*) filter (where t.transfer_status = 'paid'),
      'overpaid', count(*) filter (where t.transfer_status = 'overpaid'),
      'branch_and_transfer', count(*) filter (where t.transfer_status = 'branch_and_transfer'),
      'cancelled', count(*) filter (where t.transfer_status = 'cancelled')
    ) from public.money_transfers t where t.location_id = p_location_id
      and t.record_status <> 'deleted' and t.transfer_type <> 'cash'),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextCreatedAt', (select v.created_at from visible v order by v.created_at, v.id limit 1),
    'nextId', (select v.id from visible v order by v.created_at, v.id limit 1)
  ) into v_result;
  return v_result;
end;
$$;

alter function public.get_income_expense_operational_feed(uuid, text, text, text)
  rename to get_income_expense_operational_feed_before_time_payroll_payment;

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
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_amount numeric;
  v_transfer_amount numeric;
begin
  v_result := public.get_income_expense_operational_feed_before_time_payroll_payment(
    p_location_id, p_mode, p_search, p_cursor
  );
  for v_row in select value from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb))
  loop
    if v_row ->> 'relationSourceType' = 'time_tracking_withdrawal' then
      select private.time_payroll_branch_paid_amount(
        source.amount, source.payment_contract_version, source.payment_channel,
        source.payment_transfer_amount, source.expense_location_id
      ), coalesce(source.payment_transfer_amount, 0)
      into v_amount, v_transfer_amount
      from public.financial_transactions source
      where source.id = (v_row ->> 'relationSourceId')::uuid;
      if coalesce(v_amount, 0) <= 0 then continue; end if;
      v_row := jsonb_set(v_row, '{cost}', to_jsonb(v_amount), true);
      v_row := jsonb_set(v_row, '{title}', to_jsonb(
        case when v_transfer_amount > 0 then 'สาขาจ่ายส่วนต่าง — ' else 'สาขาจ่าย — ' end || (v_row ->> 'title')
      ), true);
    elsif v_row ->> 'relationSourceType' = 'payroll_slip' then
      select private.time_payroll_branch_paid_amount(
        source.net_pay, source.payment_contract_version, source.payment_channel,
        source.payment_transfer_amount, source.expense_location_id
      ), coalesce(source.payment_transfer_amount, 0)
      into v_amount, v_transfer_amount
      from public.payroll_slips source
      where source.id = (v_row ->> 'relationSourceId')::uuid;
      if coalesce(v_amount, 0) <= 0 then continue; end if;
      v_row := jsonb_set(v_row, '{cost}', to_jsonb(v_amount), true);
      v_row := jsonb_set(v_row, '{title}', to_jsonb(
        case when v_transfer_amount > 0 then 'สาขาจ่ายส่วนต่าง — ' else 'สาขาจ่าย — ' end || (v_row ->> 'title')
      ), true);
    end if;
    v_rows := v_rows || jsonb_build_array(v_row);
  end loop;
  return jsonb_set(v_result, '{rows}', v_rows, true);
end;
$$;

alter function private.reportable_items(uuid, timestamptz)
  rename to reportable_items_before_time_payroll_payment;

create or replace function private.reportable_items(p_location_id uuid, p_cutoff_at timestamptz)
returns table(entity_type text, entity_id uuid, eligibility_at timestamptz)
language sql
stable
security definer
set search_path = 'public', 'private'
as $$
  select candidate.entity_type, candidate.entity_id, candidate.eligibility_at
  from private.reportable_items_before_time_payroll_payment(p_location_id, p_cutoff_at) candidate
  where not (
    candidate.entity_type = 'financial_transaction'
    and exists (
      select 1 from public.financial_transactions source
      where source.id = candidate.entity_id and source.type = 'WITHDRAWAL'
        and private.time_payroll_branch_paid_amount(
          source.amount, source.payment_contract_version, source.payment_channel,
          source.payment_transfer_amount, source.expense_location_id
        ) <= 0
    )
  ) and not (
    candidate.entity_type = 'payroll_slip'
    and exists (
      select 1 from public.payroll_slips source
      where source.id = candidate.entity_id
        and private.time_payroll_branch_paid_amount(
          source.net_pay, source.payment_contract_version, source.payment_channel,
          source.payment_transfer_amount, source.expense_location_id
        ) <= 0
    )
  );
$$;

alter function private.report_income_expense_period_rows(uuid)
  rename to report_income_expense_period_rows_before_time_payroll_payment;

create or replace function private.report_income_expense_period_rows(p_report_id uuid)
returns table(tx_date date, number text, entry_type text, title text, amount numeric, sort_key text)
language sql
stable
security definer
set search_path = 'public', 'private'
as $$
  select base.*
  from private.report_income_expense_period_rows_before_time_payroll_payment(p_report_id) base
  where base.sort_key not like '60-%' and base.sort_key not like '61-%'

  union all

  select (source.approved_at at time zone 'Asia/Bangkok')::date,
    'TW-' || left(source.id::text, 8), 'expense',
    case when coalesce(source.payment_transfer_amount, 0) > 0 then 'สาขาจ่ายส่วนต่างเงินเบิกให้ ' else 'สาขาจ่ายเงินเบิกให้ ' end
      || coalesce(profile.name, 'พนักงาน'),
    private.time_payroll_branch_paid_amount(
      source.amount, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ),
    '60-' || source.id::text
  from public.report_items item
  join public.financial_transactions source on source.id = item.entity_id
  join public.profiles profile on profile.id = source.profile_id
  where item.report_id = p_report_id and item.entity_type = 'financial_transaction'
    and source.type = 'WITHDRAWAL'
    and private.time_payroll_branch_paid_amount(
      source.amount, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ) > 0

  union all

  select (source.approved_at at time zone 'Asia/Bangkok')::date,
    'PS-' || left(source.id::text, 8), 'expense',
    case when coalesce(source.payment_transfer_amount, 0) > 0 then 'สาขาจ่ายส่วนต่างเงินเดือนให้ ' else 'สาขาจ่ายเงินเดือนให้ ' end
      || coalesce(profile.name, 'พนักงาน') || ' — ' || source.month,
    private.time_payroll_branch_paid_amount(
      source.net_pay, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ),
    '61-' || source.id::text
  from public.report_items item
  join public.payroll_slips source on source.id = item.entity_id
  join public.profiles profile on profile.id = source.profile_id
  where item.report_id = p_report_id and item.entity_type = 'payroll_slip'
    and private.time_payroll_branch_paid_amount(
      source.net_pay, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ) > 0

  union all

  select coalesce(transfer.accounting_date,
      (coalesce(transfer.updated_at, transfer.created_at) at time zone 'Asia/Bangkok')::date),
    'TP-' || left(transfer.id::text, 8), 'expense',
    'โอน' || transfer.time_payroll_source_label || 'ให้ ' || transfer.time_payroll_employee_name,
    transfer.net_amount_to_pay,
    '62-' || transfer.id::text
  from public.report_items item
  join public.money_transfers transfer on transfer.id = item.entity_id
  where item.report_id = p_report_id
    and item.entity_type = 'bank_transfer_source'
    and transfer.transfer_type = 'time_payroll'
    and transfer.transfer_status in ('paid', 'overpaid')
    and transfer.net_amount_to_pay > 0;
$$;

alter function private.cash_count_events(uuid, timestamptz, timestamptz)
  rename to cash_count_events_before_time_payroll_payment;

create or replace function private.cash_count_events(
  p_location_id uuid,
  p_after_cutoff timestamptz,
  p_to_cutoff timestamptz
)
returns table(occurred_at timestamptz, event_kind text, amount numeric, counts jsonb, reference jsonb)
language sql
stable
security definer
set search_path = 'public', 'private'
as $$
  select base.*
  from private.cash_count_events_before_time_payroll_payment(
    p_location_id, p_after_cutoff, p_to_cutoff
  ) base
  where not (
    base.reference ->> 'source' = 'financial_transaction'
    and exists (
      select 1 from public.financial_transactions source
      where source.id = (base.reference ->> 'id')::uuid and source.type = 'WITHDRAWAL'
    )
  ) and coalesce(base.reference ->> 'source', '') <> 'payroll_slip'

  union all

  select item.eligibility_at, 'expense',
    private.time_payroll_branch_paid_amount(
      source.amount, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ), null::jsonb,
    jsonb_build_object('source', 'financial_transaction', 'id', source.id,
      'label', coalesce(source.description, 'เบิกเงิน'),
      'amount', private.time_payroll_branch_paid_amount(
        source.amount, source.payment_contract_version, source.payment_channel,
        source.payment_transfer_amount, source.expense_location_id
      ))
  from public.report_items item
  join public.report_batches batch on batch.id = item.report_id
  join public.financial_transactions source on source.id = item.entity_id
  where batch.location_id = p_location_id and batch.status = 'active' and item.active = true
    and item.entity_type = 'financial_transaction' and source.type = 'WITHDRAWAL'
    and item.eligibility_at > p_after_cutoff and item.eligibility_at <= p_to_cutoff
    and private.time_payroll_branch_paid_amount(
      source.amount, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ) > 0

  union all

  select item.eligibility_at, 'expense',
    private.time_payroll_branch_paid_amount(
      source.net_pay, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ), null::jsonb,
    jsonb_build_object('source', 'payroll_slip', 'id', source.id,
      'label', source.month,
      'amount', private.time_payroll_branch_paid_amount(
        source.net_pay, source.payment_contract_version, source.payment_channel,
        source.payment_transfer_amount, source.expense_location_id
      ))
  from public.report_items item
  join public.report_batches batch on batch.id = item.report_id
  join public.payroll_slips source on source.id = item.entity_id
  where batch.location_id = p_location_id and batch.status = 'active' and item.active = true
    and item.entity_type = 'payroll_slip'
    and item.eligibility_at > p_after_cutoff and item.eligibility_at <= p_to_cutoff
    and private.time_payroll_branch_paid_amount(
      source.net_pay, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ) > 0;
$$;

alter function private.dashboard_money_source_entries(text, uuid)
  rename to dashboard_money_source_entries_before_time_payroll_payment;

create or replace function private.dashboard_money_source_entries(p_source_type text, p_source_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entries jsonb;
  v_row record;
  v_amount numeric;
begin
  if p_source_type = 'money_transfer' then
    v_entries := private.dashboard_money_source_entries_before_time_payroll_payment(p_source_type, p_source_id);
    select transfer.*, profile.id as actor_id, profile.name as actor_name
    into v_row
    from public.money_transfers transfer
    left join public.profiles profile on profile.id = transfer.created_by_user_id
    where transfer.id = p_source_id;
    if found and v_row.transfer_type = 'time_payroll'
      and v_row.record_status <> 'deleted'
      and v_row.transfer_status in ('paid', 'overpaid')
      and v_row.net_amount_to_pay > 0 then
      v_entries := v_entries || jsonb_build_array(private.dashboard_money_event_entry(
        'time-payroll-transfer:' || v_row.id::text,
        v_row.location_id,
        'transfer_out',
        'TP-' || left(v_row.id::text, 8),
        'โอน' || v_row.time_payroll_source_label || 'ให้ ' || v_row.time_payroll_employee_name,
        'expense',
        v_row.net_amount_to_pay,
        jsonb_build_object(
          'transferType', v_row.transfer_type,
          'transferStatus', v_row.transfer_status,
          'sourceKind', v_row.time_payroll_source_kind,
          'sourceLabel', v_row.time_payroll_source_label,
          'employeeName', v_row.time_payroll_employee_name,
          'amount', v_row.net_amount_to_pay
        ),
        v_row.created_by_user_id,
        v_row.created_by_name
      ));
    end if;
    return v_entries;
  elsif p_source_type = 'withdrawal' then
    select source.*, profile.name as profile_name, approver.name as approver_name
    into v_row from public.financial_transactions source
    join public.profiles profile on profile.id = source.profile_id
    left join public.profiles approver on approver.id = source.approved_by
    where source.id = p_source_id;
    if not found or v_row.type::text <> 'WITHDRAWAL' or v_row.status::text <> 'APPROVED'
      or v_row.cancelled_at is not null or v_row.expense_location_id is null then return '[]'::jsonb; end if;
    v_amount := private.time_payroll_branch_paid_amount(
      v_row.amount, v_row.payment_contract_version, v_row.payment_channel,
      v_row.payment_transfer_amount, v_row.expense_location_id
    );
    if v_amount <= 0 then return '[]'::jsonb; end if;
    return jsonb_build_array(private.dashboard_money_event_entry(
      'withdrawal:' || v_row.id::text, v_row.expense_location_id, 'expense',
      'TW-' || left(v_row.id::text, 8),
      case when coalesce(v_row.payment_transfer_amount, 0) > 0 then 'สาขาจ่ายส่วนต่างเงินเบิกให้ ' else 'สาขาจ่ายเงินเบิกให้ ' end
        || coalesce(v_row.profile_name, 'พนักงาน'),
      'expense', v_amount,
      jsonb_build_object('profileId', v_row.profile_id, 'amount', v_amount,
        'sourceAmount', v_row.amount, 'transferAmount', v_row.payment_transfer_amount,
        'expenseLocationId', v_row.expense_location_id, 'status', v_row.status),
      v_row.approved_by, v_row.approver_name
    ));
  elsif p_source_type = 'payroll_slip' then
    select source.*, profile.name as profile_name, approver.name as approver_name
    into v_row from public.payroll_slips source
    join public.profiles profile on profile.id = source.profile_id
    left join public.profiles approver on approver.id = source.approved_by
    where source.id = p_source_id;
    if not found or v_row.status::text <> 'APPROVED' or v_row.cancelled_at is not null
      or v_row.expense_location_id is null then return '[]'::jsonb; end if;
    v_amount := private.time_payroll_branch_paid_amount(
      v_row.net_pay, v_row.payment_contract_version, v_row.payment_channel,
      v_row.payment_transfer_amount, v_row.expense_location_id
    );
    if v_amount <= 0 then return '[]'::jsonb; end if;
    return jsonb_build_array(private.dashboard_money_event_entry(
      'payroll:' || v_row.id::text, v_row.expense_location_id, 'expense',
      'PS-' || left(v_row.id::text, 8),
      case when coalesce(v_row.payment_transfer_amount, 0) > 0 then 'สาขาจ่ายส่วนต่างเงินเดือนให้ ' else 'สาขาจ่ายเงินเดือนให้ ' end
        || coalesce(v_row.profile_name, 'พนักงาน') || ' — ' || v_row.month,
      'expense', v_amount,
      jsonb_build_object('profileId', v_row.profile_id, 'month', v_row.month,
        'netPay', v_row.net_pay, 'transferAmount', v_row.payment_transfer_amount,
        'branchPaidAmount', v_amount, 'expenseLocationId', v_row.expense_location_id,
        'status', v_row.status, 'slipData', v_row.slip_data),
      v_row.approved_by, v_row.approver_name
    ));
  end if;
  return private.dashboard_money_source_entries_before_time_payroll_payment(p_source_type, p_source_id);
end;
$$;

revoke all on function private.time_payroll_branch_paid_amount(numeric,smallint,text,numeric,uuid) from public, anon, authenticated;
revoke all on function private.validate_time_payroll_payment(jsonb,numeric) from public, anon, authenticated;
revoke all on function private.guard_time_payroll_payment_source() from public, anon, authenticated;
revoke all on function private.guard_time_payroll_transfer() from public, anon, authenticated;
revoke all on function private.apply_time_payroll_payment(text,uuid,jsonb,boolean,text) from public, anon, authenticated;
revoke all on function private.delete_time_payroll_transfer_for_source(text,uuid) from public, anon, authenticated;
revoke all on function private.reportable_items_before_time_payroll_payment(uuid,timestamptz) from public, anon, authenticated;
revoke all on function private.report_income_expense_period_rows_before_time_payroll_payment(uuid) from public, anon, authenticated;
revoke all on function private.cash_count_events_before_time_payroll_payment(uuid,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function private.dashboard_money_source_entries_before_time_payroll_payment(text,uuid) from public, anon, authenticated;
revoke all on function private.reportable_items(uuid,timestamptz) from public, anon, authenticated;
revoke all on function private.report_income_expense_period_rows(uuid) from public, anon, authenticated;
revoke all on function private.cash_count_events(uuid,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function private.dashboard_money_source_entries(text,uuid) from public, anon, authenticated;

revoke all on function public.get_money_transfer_list(uuid,text,text,timestamptz,uuid,integer) from public, anon;
grant execute on function public.get_money_transfer_list(uuid,text,text,timestamptz,uuid,integer) to authenticated;
revoke all on function public.get_income_expense_operational_feed(uuid,text,text,text) from public, anon;
grant execute on function public.get_income_expense_operational_feed(uuid,text,text,text) to authenticated;

revoke all on function public.decide_time_tracking_approval_with_payment(text,uuid,text,text,jsonb) from public, anon;
grant execute on function public.decide_time_tracking_approval_with_payment(text,uuid,text,text,jsonb) to authenticated;
revoke all on function public.change_time_tracking_payment(text,uuid,jsonb,text) from public, anon;
grant execute on function public.change_time_tracking_payment(text,uuid,jsonb,text) to authenticated;
revoke all on function public.create_time_tracking_withdrawal_with_payment(uuid,numeric,date,text,jsonb,text) from public, anon;
grant execute on function public.create_time_tracking_withdrawal_with_payment(uuid,numeric,date,text,jsonb,text) to authenticated;
revoke all on function public.create_time_tracking_payroll_slip_with_payment(uuid,text,boolean,jsonb,text,numeric) from public, anon;
grant execute on function public.create_time_tracking_payroll_slip_with_payment(uuid,text,boolean,jsonb,text,numeric) to authenticated;
revoke all on function public.save_source_owned_money_transfer_slips(uuid,integer,jsonb) from public, anon;
grant execute on function public.save_source_owned_money_transfer_slips(uuid,integer,jsonb) to authenticated;
revoke all on function public.save_rubber_export_work_transfer_slips(uuid,integer,jsonb) from public, anon;
grant execute on function public.save_rubber_export_work_transfer_slips(uuid,integer,jsonb) to authenticated;

notify pgrst, 'reload schema';
