-- Delegate Time/Payroll management by employee primary branch and allow
-- source-owned central payments without derived Income/Expense rows.

alter table public.profiles
  add column if not exists can_manage_time_payroll boolean not null default false;

grant select (can_manage_time_payroll) on public.profiles to authenticated;

-- Existing single-location accounts can be repaired without guessing.
update public.user_locations ul
set is_primary = true
where ul.is_primary = false
  and not exists (
    select 1
    from public.user_locations existing
    where existing.user_id = ul.user_id
      and existing.is_primary = true
  )
  and 1 = (
    select count(*)
    from public.user_locations assigned
    where assigned.user_id = ul.user_id
  );

do $$
begin
  if exists (
    select 1
    from public.user_locations ul
    group by ul.user_id
    having count(*) filter (where ul.is_primary) <> 1
  ) then
    raise exception 'AMBIGUOUS_PRIMARY_LOCATION';
  end if;
end
$$;

create unique index if not exists user_locations_one_primary_per_user
  on public.user_locations (user_id)
  where is_primary = true;

create or replace function private.default_first_user_location_primary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('user-locations:' || new.user_id::text, 0));
  if not new.is_primary and not exists (
    select 1 from public.user_locations ul where ul.user_id = new.user_id
  ) then
    new.is_primary := true;
  end if;
  return new;
end
$$;

drop trigger if exists default_first_user_location_primary on public.user_locations;
create trigger default_first_user_location_primary
before insert on public.user_locations
for each row execute function private.default_first_user_location_primary();

create or replace function private.assert_user_primary_location(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_count integer;
  v_primary_count integer;
begin
  if target_user_id is null then return; end if;
  select count(*), count(*) filter (where ul.is_primary)
  into v_assignment_count, v_primary_count
  from public.user_locations ul
  where ul.user_id = target_user_id;

  if v_assignment_count > 0 and v_primary_count <> 1 then
    raise exception 'PRIMARY_LOCATION_REQUIRED';
  end if;
end
$$;

create or replace function private.enforce_user_primary_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform private.assert_user_primary_location(old.user_id);
  end if;
  perform private.assert_user_primary_location(coalesce(new.user_id, old.user_id));
  return null;
end
$$;

drop trigger if exists enforce_user_primary_location on public.user_locations;
create constraint trigger enforce_user_primary_location
after insert or update or delete on public.user_locations
deferrable initially deferred
for each row execute function private.enforce_user_primary_location();

create or replace function public.set_user_primary_location(
  p_user_id uuid,
  p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_actor_id uuid := auth.uid();
  v_old_location_id uuid;
begin
  if v_actor_id is null or not private.can_access_super_admin_features() then
    raise exception 'Forbidden';
  end if;
  if exists (
    select 1 from public.profiles p where p.id = p_user_id and p.role = 'super_admin'
  ) then
    raise exception 'Cannot modify super_admin locations';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('user-locations:' || p_user_id::text, 0));
  if not exists (
    select 1 from public.user_locations ul
    where ul.user_id = p_user_id and ul.location_id = p_location_id
  ) then
    raise exception 'LOCATION_NOT_ASSIGNED';
  end if;

  select ul.location_id into v_old_location_id
  from public.user_locations ul
  where ul.user_id = p_user_id and ul.is_primary = true;

  if v_old_location_id = p_location_id then
    return jsonb_build_object('status', 'unchanged', 'primaryLocationId', p_location_id);
  end if;

  update public.user_locations
  set is_primary = false
  where user_id = p_user_id and is_primary = true;

  update public.user_locations
  set is_primary = true
  where user_id = p_user_id and location_id = p_location_id;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, new_data, comment
  ) values (
    v_actor_id,
    'CHANGE_PRIMARY_LOCATION',
    'profiles',
    p_user_id,
    jsonb_build_object('primaryLocationId', v_old_location_id),
    jsonb_build_object('primaryLocationId', p_location_id),
    ''
  );

  return jsonb_build_object(
    'status', 'updated',
    'oldPrimaryLocationId', v_old_location_id,
    'primaryLocationId', p_location_id
  );
end
$$;

create or replace function public.remove_user_location_with_primary_replacement(
  p_user_id uuid,
  p_location_id uuid,
  p_replacement_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_actor_id uuid := auth.uid();
  v_was_primary boolean;
  v_remaining_count integer;
begin
  if v_actor_id is null or not private.can_access_super_admin_features() then
    raise exception 'Forbidden';
  end if;
  if exists (
    select 1 from public.profiles p where p.id = p_user_id and p.role = 'super_admin'
  ) then
    raise exception 'Cannot modify super_admin locations';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('user-locations:' || p_user_id::text, 0));
  select ul.is_primary into v_was_primary
  from public.user_locations ul
  where ul.user_id = p_user_id and ul.location_id = p_location_id
  for update;
  if not found then return jsonb_build_object('status', 'unchanged'); end if;

  select count(*) into v_remaining_count
  from public.user_locations ul
  where ul.user_id = p_user_id and ul.location_id <> p_location_id;

  if v_was_primary and v_remaining_count > 0 then
    if p_replacement_location_id is null
      or p_replacement_location_id = p_location_id
      or not exists (
        select 1 from public.user_locations ul
        where ul.user_id = p_user_id
          and ul.location_id = p_replacement_location_id
      )
    then
      raise exception 'REPLACEMENT_PRIMARY_REQUIRED';
    end if;

    update public.user_locations
    set is_primary = false
    where user_id = p_user_id and location_id = p_location_id;

    update public.user_locations
    set is_primary = true
    where user_id = p_user_id and location_id = p_replacement_location_id;
  elsif p_replacement_location_id is not null then
    raise exception 'REPLACEMENT_PRIMARY_NOT_ALLOWED';
  end if;

  delete from public.user_locations
  where user_id = p_user_id and location_id = p_location_id;

  if v_was_primary then
    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'REMOVE_PRIMARY_LOCATION',
      'profiles',
      p_user_id,
      jsonb_build_object('primaryLocationId', p_location_id),
      jsonb_build_object('primaryLocationId', p_replacement_location_id),
      ''
    );
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'primaryLocationId', case when v_was_primary then p_replacement_location_id else null end
  );
end
$$;

revoke all on function public.set_user_primary_location(uuid, uuid) from public, anon;
revoke all on function public.remove_user_location_with_primary_replacement(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_user_primary_location(uuid, uuid) to authenticated;
grant execute on function public.remove_user_location_with_primary_replacement(uuid, uuid, uuid) to authenticated;

create or replace function private.has_time_payroll_manager_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      private.can_access_super_admin_features()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('user', 'admin')
          and p.can_manage_time_payroll = true
      )
    )
$$;

create or replace function private.is_time_payroll_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_time_payroll_manager_access()
$$;

create or replace function private.can_manage_time_payroll_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and exists (
      select 1
      from public.profiles target
      where target.id = target_profile_id
        and target.is_active = true
        and (
          private.can_access_super_admin_features()
          or (
            target.role in ('user', 'admin')
            and target.can_access_super_admin_features = false
            and exists (
              select 1
              from public.user_locations target_primary
              join public.locations target_location
                on target_location.id = target_primary.location_id
               and target_location.is_active = true
              join public.user_locations actor_location
                on actor_location.location_id = target_primary.location_id
               and actor_location.user_id = auth.uid()
              where target_primary.user_id = target_profile_id
                and target_primary.is_primary = true
            )
            and exists (
              select 1 from public.profiles actor
              where actor.id = auth.uid()
                and actor.role in ('user', 'admin')
                and actor.can_manage_time_payroll = true
            )
          )
        )
    )
$$;

create or replace function private.can_approve_time_tracking_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_time_payroll_profile(target_profile_id)
$$;

create or replace function private.can_assign_time_tracking_expense_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_time_payroll_manager_access()
    and target_location is not null
    and exists (
      select 1 from public.locations l
      where l.id = target_location and l.is_active = true
    )
$$;

create or replace function private.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      target_user = auth.uid()
      or private.can_access_super_admin_features()
      or private.can_manage_time_payroll_profile(target_user)
      or (
        private.current_user_role() = 'admin'
        and exists (
          select 1
          from public.user_locations mine
          join public.user_locations theirs on theirs.location_id = mine.location_id
          where mine.user_id = auth.uid() and theirs.user_id = target_user
        )
      )
    )
$$;

revoke all on function private.has_time_payroll_manager_access() from public, anon;
revoke all on function private.can_manage_time_payroll_profile(uuid) from public, anon;
grant execute on function private.has_time_payroll_manager_access() to authenticated;
grant execute on function private.can_manage_time_payroll_profile(uuid) to authenticated;

create or replace function public.get_time_payroll_payment_locations()
returns table(id uuid, name text, code text, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.code, l.is_active
  from public.locations l
  where private.has_time_payroll_manager_access()
    and l.is_active = true
  order by l.created_at, l.id
$$;

revoke all on function public.get_time_payroll_payment_locations() from public, anon;
grant execute on function public.get_time_payroll_payment_locations() to authenticated;

drop policy if exists financial_transactions_read_self_or_manager on public.financial_transactions;
create policy financial_transactions_read_self_or_manager
on public.financial_transactions for select to authenticated
using (profile_id = auth.uid() or private.can_manage_time_payroll_profile(profile_id));

drop policy if exists payroll_slips_read_self_or_manager on public.payroll_slips;
create policy payroll_slips_read_self_or_manager
on public.payroll_slips for select to authenticated
using (profile_id = auth.uid() or private.can_manage_time_payroll_profile(profile_id));

drop policy if exists time_segments_read_self_or_manager on public.time_segments;
create policy time_segments_read_self_or_manager
on public.time_segments for select to authenticated
using (profile_id = auth.uid() or private.can_manage_time_payroll_profile(profile_id));

drop policy if exists time_tracking_resume_schedules_read_self_or_manager on public.time_tracking_resume_schedules;
create policy time_tracking_resume_schedules_read_self_or_manager
on public.time_tracking_resume_schedules for select to authenticated
using (profile_id = auth.uid() or private.can_manage_time_payroll_profile(profile_id));

drop policy if exists time_tracking_audit_logs_read_manager on public.time_tracking_audit_logs;
create policy time_tracking_audit_logs_read_manager
on public.time_tracking_audit_logs for select to authenticated
using (
  private.can_access_super_admin_features()
  or (private.has_time_payroll_manager_access() and admin_id = auth.uid())
);

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
  v_actor_id uuid := auth.uid();
  v_id uuid;
  v_comment text;
  v_actor_name text;
  v_bangkok_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_type not in ('DEBT', 'WITHDRAWAL') then
    raise exception 'INVALID_TRANSACTION_TYPE';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_effective_date is null or p_effective_date > v_bangkok_today then
    raise exception 'FUTURE_EFFECTIVE_DATE';
  end if;
  if p_type = 'DEBT' and not private.can_manage_time_payroll_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_type = 'WITHDRAWAL'
    and p_profile_id <> v_actor_id
    and not private.can_manage_time_payroll_profile(p_profile_id)
  then
    raise exception 'Forbidden';
  end if;
  if p_type = 'DEBT' and nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.is_active = true
  ) then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.payroll_slips ps
    where ps.profile_id = p_profile_id
      and ps.month = to_char(p_effective_date, 'YYYY-MM')
  ) then
    raise exception 'MONTH_CLOSED:%', to_char(p_effective_date, 'YYYY-MM');
  end if;

  select p.name into v_actor_name from public.profiles p where p.id = v_actor_id;
  v_comment := case
    when v_actor_id = p_profile_id and p_type = 'WITHDRAWAL' then null
    when p_type = 'DEBT' then 'สร้างหนี้สินโดย: ' || coalesce(v_actor_name, 'ผู้จัดการ')
    else 'ยื่นแทนโดยผู้จัดการ: ' || coalesce(v_actor_name, 'ผู้จัดการ')
  end;

  insert into public.financial_transactions (
    profile_id, type, amount, effective_date, due_date, description, admin_comment
  ) values (
    p_profile_id,
    p_type::public.financial_transaction_type,
    trunc(p_amount, 2),
    p_effective_date,
    case when p_type = 'DEBT' then p_effective_date else null end,
    nullif(btrim(coalesce(p_description, '')), ''),
    v_comment
  ) returning id into v_id;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data, comment
  ) values (
    v_actor_id,
    case when p_type = 'DEBT' then 'CREATE_DEBT' else 'REQUEST_WITHDRAWAL' end,
    'financial_transactions',
    v_id,
    jsonb_build_object(
      'profile_id', p_profile_id,
      'type', p_type,
      'amount', trunc(p_amount, 2),
      'effective_date', p_effective_date,
      'description', nullif(btrim(coalesce(p_description, '')), '')
    ),
    v_comment
  );

  return jsonb_build_object('id', v_id, 'status', 'pending');
end
$$;

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
set search_path = 'public', 'private'
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_data jsonb;
  v_requires_payment_choice boolean := false;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
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

  if p_source_type = 'transaction' then
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;
    if not private.can_manage_time_payroll_profile(v_tx.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_tx.profile_id::text, 0));
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;
    if exists (
      select 1 from public.payroll_slips ps
      where ps.profile_id = v_tx.profile_id
        and ps.month = to_char(v_tx.effective_date, 'YYYY-MM')
    ) then
      raise exception 'MONTH_CLOSED:%', to_char(v_tx.effective_date, 'YYYY-MM');
    end if;

    v_requires_payment_choice := p_decision = 'APPROVED' and v_tx.type = 'WITHDRAWAL';
    if v_tx.status <> 'PENDING' then
      if v_tx.status = p_decision::public.approval_status
        and (
          not v_requires_payment_choice
          or v_tx.expense_location_id is not distinct from p_expense_location_id
        )
      then
        return jsonb_build_object(
          'status', lower(p_decision),
          'idempotent', true,
          'sourceType', p_source_type,
          'sourceId', p_source_id
        );
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_payment_choice then
      if p_expense_location_id is not null
        and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
      then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_tx);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.financial_transactions
      set
        status = 'APPROVED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id,
        approved_at = now(),
        expense_location_id = case
          when v_requires_payment_choice then p_expense_location_id
          else null
        end,
        remaining_amount = amount
      where id = v_tx.id;

      perform private.apply_time_tracking_deductions(v_tx.profile_id, v_current_month);
    else
      update public.financial_transactions
      set
        status = 'REJECTED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id
      where id = v_tx.id;
    end if;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'DECIDE_TRANSACTION_APPROVAL',
      'financial_transactions',
      v_tx.id,
      v_old_data,
      jsonb_build_object(
        'decision', p_decision,
        'expenseLocationId', p_expense_location_id,
        'paymentMethod', case
          when v_requires_payment_choice and p_expense_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM'
          when v_requires_payment_choice then 'BRANCH'
          else null
        end
      ),
      coalesce(p_comment, '')
    );
  else
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id;
    if not found then raise exception 'Payroll slip not found'; end if;
    if not private.can_manage_time_payroll_profile(v_slip.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_slip.profile_id::text, 0));
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found then raise exception 'Payroll slip not found'; end if;

    v_requires_payment_choice := p_decision = 'APPROVED' and v_slip.net_pay > 0;
    if v_slip.status <> 'PENDING' then
      if v_slip.status = p_decision::public.approval_status
        and (
          not v_requires_payment_choice
          or v_slip.expense_location_id is not distinct from p_expense_location_id
        )
      then
        return jsonb_build_object(
          'status', lower(p_decision),
          'idempotent', true,
          'sourceType', p_source_type,
          'sourceId', p_source_id
        );
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_payment_choice then
      if p_expense_location_id is not null
        and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
      then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_slip);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.payroll_slips
      set
        status = 'APPROVED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id,
        approved_at = now(),
        expense_location_id = case
          when v_requires_payment_choice then p_expense_location_id
          else null
        end
      where id = v_slip.id;
    else
      update public.payroll_slips
      set
        status = 'REJECTED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id
      where id = v_slip.id;
    end if;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'DECIDE_PAYROLL_SLIP_APPROVAL',
      'payroll_slips',
      v_slip.id,
      v_old_data,
      jsonb_build_object(
        'decision', p_decision,
        'expenseLocationId', p_expense_location_id,
        'paymentMethod', case
          when v_requires_payment_choice and p_expense_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM'
          when v_requires_payment_choice then 'BRANCH'
          else null
        end
      ),
      coalesce(p_comment, '')
    );
  end if;

  return jsonb_build_object(
    'status', lower(p_decision),
    'idempotent', false,
    'sourceType', p_source_type,
    'sourceId', p_source_id
  );
end
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
set search_path = 'public', 'private'
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
set search_path = 'public', 'private'
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

    if v_tx.status = 'PENDING'
      and v_tx.type = 'WITHDRAWAL'
      and v_tx.profile_id = v_actor_id
    then
      null;
    elsif not private.can_manage_time_payroll_profile(v_tx.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_tx.profile_id::text, 0));
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
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
    if not found then raise exception 'Payroll slip not found'; end if;
    if not private.can_manage_time_payroll_profile(v_slip.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_slip.profile_id::text, 0));
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found then raise exception 'Payroll slip not found'; end if;

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

create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_can_manage_system boolean;
  v_can_use_money_transfer boolean;
  v_can_manage_time_payroll boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select
    p.role,
    p.role = 'super_admin' or p.can_access_super_admin_features = true,
    p.role = 'super_admin'
      or p.can_access_super_admin_features = true
      or p.can_access_money_transfer = true,
    p.role = 'super_admin'
      or p.can_access_super_admin_features = true
      or p.can_manage_time_payroll = true
  into v_role, v_can_manage_system, v_can_use_money_transfer, v_can_manage_time_payroll
  from public.profiles p
  where p.id = v_user_id and p.is_active = true;
  if v_role is null then raise exception 'Inactive profile'; end if;

  return query
  with accessible_locations as (
    select ul.location_id
    from public.user_locations ul
    join public.locations l on l.id = ul.location_id and l.is_active = true
    where ul.user_id = v_user_id
  ),
  scoped_time_requests as (
    select ft.id, ft.profile_id
    from public.financial_transactions ft
    where ft.status = 'PENDING'
    union all
    select ps.id, ps.profile_id
    from public.payroll_slips ps
    where ps.status = 'PENDING'
  ),
  counts as (
    select al.location_id, 'rubber'::text module_id, count(*)::bigint item_count
    from accessible_locations al
    cross join lateral private.rubber_bill_report_blockers(al.location_id, now()) b
    where v_can_manage_system or b.blocker_type = 'zero_price'
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
    where v_can_use_money_transfer
      and t.transfer_method = 'bank'
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
    from accessible_locations al
    cross join public.stock_product_approval_requests r
    where v_can_manage_system and r.request_status = 'pending'
    group by al.location_id

    union all
    select al.location_id, 'time-tracking', count(requests.id)::bigint
    from accessible_locations al
    cross join scoped_time_requests requests
    where v_can_manage_system
    group by al.location_id

    union all
    select target_primary.location_id, 'time-tracking', count(requests.id)::bigint
    from scoped_time_requests requests
    join public.user_locations target_primary
      on target_primary.user_id = requests.profile_id
     and target_primary.is_primary = true
    join accessible_locations al on al.location_id = target_primary.location_id
    where not v_can_manage_system
      and v_can_manage_time_payroll
      and private.can_manage_time_payroll_profile(requests.profile_id)
    group by target_primary.location_id

    union all
    select e.location_id, 'rubber-export', count(*)::bigint
    from public.rubber_exports e
    join accessible_locations al on al.location_id = e.location_id
    where (v_can_manage_system or v_role = 'admin') and e.status = 'draft'
    group by e.location_id
  )
  select c.location_id, c.module_id, sum(c.item_count)::bigint
  from counts c
  where c.item_count > 0
  group by c.location_id, c.module_id
  order by c.location_id, c.module_id;
end
$$;

-- Central outside-system payments intentionally keep expense_location_id null.
-- The RPC remains mandatory so direct writes still cannot bypass approval guards.
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

-- Keep the table-specific branches mutually exclusive. PostgreSQL records expose
-- only the columns of their trigger table, so a financial transaction must never
-- evaluate payroll-only fields such as net_pay.
create or replace function private.prevent_hard_delete_of_linked_time_tracking_source()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if current_setting('app.time_tracking_permanent_delete_rpc', true) = 'true' then
    return old;
  end if;

  if tg_table_name = 'financial_transactions' then
    if old.type = 'WITHDRAWAL'
      and old.status = 'APPROVED'
      and old.expense_location_id is not null then
      raise exception 'Approved withdrawal must be permanently deleted through the time tracking RPC';
    end if;
  elsif tg_table_name = 'payroll_slips' then
    if old.status = 'APPROVED'
      and old.net_pay > 0
      and old.expense_location_id is not null then
      raise exception 'Approved payroll slip must be permanently deleted through the time tracking RPC';
    end if;
  end if;

  return old;
end;
$$;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_withdrawal_expense_assignment;

alter table public.financial_transactions
  add constraint financial_transactions_withdrawal_expense_assignment
  check (
    type <> 'WITHDRAWAL'
    or status <> 'APPROVED'
    or cancelled_at is not null
    or approved_at is not null
  ) not valid;

alter table public.payroll_slips
  drop constraint if exists payroll_slips_expense_assignment;

alter table public.payroll_slips
  add constraint payroll_slips_expense_assignment
  check (
    status <> 'APPROVED'
    or cancelled_at is not null
    or net_pay <= 0
    or approved_at is not null
  ) not valid;
