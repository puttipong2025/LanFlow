-- Mark Dashboard card snapshots dirty from authoritative physical sources.
-- A transaction ID is the source version, so a bulk write changes each branch
-- state at most once per transaction.

create or replace function private.mark_dashboard_dirty(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version bigint := pg_catalog.txid_current();
begin
  if p_location_id is null or not exists (
    select 1
    from public.locations l
    where l.id = p_location_id
      and l.is_active = true
  ) then
    return;
  end if;

  insert into public.dashboard_branch_snapshots (
    location_id,
    status,
    source_version
  )
  values (
    p_location_id,
    'dirty',
    next_version
  )
  on conflict (location_id) do update
  set status = case
        when dashboard_branch_snapshots.status in ('queued', 'running')
          then dashboard_branch_snapshots.status
        else 'dirty'
      end,
      source_version = excluded.source_version,
      updated_at = now()
  where dashboard_branch_snapshots.source_version < excluded.source_version;

  insert into public.dashboard_alert_thresholds (location_id)
  values (p_location_id)
  on conflict (location_id) do nothing;
end;
$$;

revoke all on function private.mark_dashboard_dirty(uuid)
  from public, anon, authenticated;

create or replace function private.dashboard_dirty_location_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  location_ids uuid[] := array[]::uuid[];
  column_name text;
  location_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_row := to_jsonb(new);
  end if;

  foreach column_name in array tg_argv loop
    if old_row is not null then
      location_id := nullif(old_row ->> column_name, '')::uuid;
      if location_id is not null
        and array_position(location_ids, location_id) is null
      then
        location_ids := array_append(location_ids, location_id);
      end if;
    end if;

    if new_row is not null then
      location_id := nullif(new_row ->> column_name, '')::uuid;
      if location_id is not null
        and array_position(location_ids, location_id) is null
      then
        location_ids := array_append(location_ids, location_id);
      end if;
    end if;
  end loop;

  foreach location_id in array location_ids loop
    perform private.mark_dashboard_dirty(location_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.dashboard_dirty_location_columns()
  from public, anon, authenticated;

create or replace function private.dashboard_dirty_rubber_bill_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bill_ids uuid[] := array[]::uuid[];
  location_id uuid;
begin
  if tg_op <> 'INSERT' and old.bill_id is not null then
    bill_ids := array_append(bill_ids, old.bill_id);
  end if;
  if tg_op <> 'DELETE'
    and new.bill_id is not null
    and array_position(bill_ids, new.bill_id) is null
  then
    bill_ids := array_append(bill_ids, new.bill_id);
  end if;

  for location_id in
    select distinct b.location_id
    from public.rubber_bills b
    where b.id = any(bill_ids)
  loop
    perform private.mark_dashboard_dirty(location_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.dashboard_dirty_rubber_bill_items()
  from public, anon, authenticated;

create or replace function private.dashboard_dirty_money_transfer_dependents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  transfer_ids uuid[] := array[]::uuid[];
  source_refs jsonb[] := array[]::jsonb[];
  transfer_id uuid;
  source_ref jsonb;
  location_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_row := to_jsonb(new);
  end if;

  if old_row is not null then
    transfer_id := nullif(old_row ->> 'transfer_id', '')::uuid;
    if transfer_id is not null then
      transfer_ids := array_append(transfer_ids, transfer_id);
    end if;
    if old_row ? 'source_type' and old_row ? 'source_id' then
      source_refs := array_append(
        source_refs,
        jsonb_build_object(
          'type', old_row ->> 'source_type',
          'id', old_row ->> 'source_id'
        )
      );
    end if;
  end if;

  if new_row is not null then
    transfer_id := nullif(new_row ->> 'transfer_id', '')::uuid;
    if transfer_id is not null
      and array_position(transfer_ids, transfer_id) is null
    then
      transfer_ids := array_append(transfer_ids, transfer_id);
    end if;
    if new_row ? 'source_type' and new_row ? 'source_id' then
      source_ref := jsonb_build_object(
        'type', new_row ->> 'source_type',
        'id', new_row ->> 'source_id'
      );
      if array_position(source_refs, source_ref) is null then
        source_refs := array_append(source_refs, source_ref);
      end if;
    end if;
  end if;

  for location_id in
    select distinct branch_id
    from (
      select mt.location_id as branch_id
      from public.money_transfers mt
      where mt.id = any(transfer_ids)
      union
      select mt.target_location_id
      from public.money_transfers mt
      where mt.id = any(transfer_ids)
    ) branches
    where branch_id is not null
  loop
    perform private.mark_dashboard_dirty(location_id);
  end loop;

  foreach source_ref in array source_refs loop
    if source_ref ->> 'type' = 'rubber_bill' then
      select b.location_id
      into location_id
      from public.rubber_bills b
      where b.id = nullif(source_ref ->> 'id', '')::uuid;
    elsif source_ref ->> 'type' = 'ocr_ticket' then
      select t.location_id
      into location_id
      from public.ocr_tickets t
      where t.id = nullif(source_ref ->> 'id', '')::uuid;
    else
      location_id := null;
    end if;

    perform private.mark_dashboard_dirty(location_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.dashboard_dirty_money_transfer_dependents()
  from public, anon, authenticated;

create or replace function private.dashboard_dirty_all_active_locations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  location_id uuid;
begin
  for location_id in
    select l.id
    from public.locations l
    where l.is_active = true
  loop
    perform private.mark_dashboard_dirty(location_id);
  end loop;
  return null;
end;
$$;

revoke all on function private.dashboard_dirty_all_active_locations()
  from public, anon, authenticated;

create or replace function private.dashboard_seed_active_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.is_active = true then
    perform private.mark_dashboard_dirty(new.id);
  elsif new.is_active = true
    and old.is_active is distinct from new.is_active
  then
    perform private.mark_dashboard_dirty(new.id);
  end if;
  return new;
end;
$$;

revoke all on function private.dashboard_seed_active_location()
  from public, anon, authenticated;

create trigger dashboard_dirty_rubber_bills
after insert or update or delete on public.rubber_bills
for each row execute function private.dashboard_dirty_location_columns('location_id');

create trigger dashboard_dirty_rubber_bill_items
after insert or update or delete on public.rubber_bill_items
for each row execute function private.dashboard_dirty_rubber_bill_items();

create trigger dashboard_dirty_income_expense
after insert or update or delete on public.income_expense
for each row execute function private.dashboard_dirty_location_columns('location_id');

create trigger dashboard_dirty_money_transfers
after insert or update or delete on public.money_transfers
for each row execute function private.dashboard_dirty_location_columns(
  'location_id',
  'target_location_id'
);

create trigger dashboard_dirty_money_transfer_cash_details
after insert or update or delete on public.money_transfer_cash_details
for each row execute function private.dashboard_dirty_money_transfer_dependents();

create trigger dashboard_dirty_money_transfer_items
after insert or update or delete on public.money_transfer_items
for each row execute function private.dashboard_dirty_money_transfer_dependents();

create trigger dashboard_dirty_ocr_tickets
after insert or update or delete on public.ocr_tickets
for each row execute function private.dashboard_dirty_location_columns('location_id');

create trigger dashboard_dirty_financial_transactions
after insert or update or delete on public.financial_transactions
for each row execute function private.dashboard_dirty_location_columns(
  'expense_location_id'
);

create trigger dashboard_dirty_payroll_slips
after insert or update or delete on public.payroll_slips
for each row execute function private.dashboard_dirty_location_columns(
  'expense_location_id'
);

create trigger dashboard_dirty_rubber_exports
after insert or update or delete on public.rubber_exports
for each row execute function private.dashboard_dirty_location_columns('location_id');

create trigger dashboard_dirty_stock_entries
after insert or update or delete on public.stock_entries
for each row execute function private.dashboard_dirty_location_columns('location_id');

create trigger dashboard_dirty_stock_products
after insert or update or delete on public.stock_products
for each statement execute function private.dashboard_dirty_all_active_locations();

create trigger dashboard_seed_locations
after insert or update of is_active on public.locations
for each row execute function private.dashboard_seed_active_location();
