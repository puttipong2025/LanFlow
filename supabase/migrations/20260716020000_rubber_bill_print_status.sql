-- Migration: persist Rubber Bill receipt identity/deduction fields and mark print status safely.
-- The existing sync implementation remains the stock/revision authority. This wrapper validates
-- the extra receipt fields, delegates the atomic sync, then persists them in the same transaction.

alter function public.sync_rubber_bill(jsonb)
  rename to sync_rubber_bill_core_20260716020000;

revoke all on function public.sync_rubber_bill_core_20260716020000(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation text := payload->>'operation';
  v_customer_id uuid;
  v_deduct_weight numeric;
  v_result jsonb;
  v_bill_id uuid;
begin
  if v_operation in ('create', 'update') then
    v_customer_id := nullif(payload->>'customerId', '')::uuid;
    v_deduct_weight := coalesce(nullif(payload->>'deductWeight', '')::numeric, 0);

    if v_deduct_weight < 0 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'deductWeight must be non-negative');
    end if;

    if v_customer_id is not null
       and not exists (select 1 from public.customers where id = v_customer_id) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Customer not found');
    end if;
  end if;

  v_result := public.sync_rubber_bill_core_20260716020000(payload);

  if v_operation in ('create', 'update') and v_result->>'status' = 'synced' then
    v_bill_id := (v_result->>'id')::uuid;
    update public.rubber_bills
    set customer_id = v_customer_id,
        deduct_weight = v_deduct_weight,
        bill_type = coalesce(nullif(payload->>'billType', ''), bill_type)
    where id = v_bill_id;
  end if;

  return v_result;
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

create or replace function public.mark_rubber_bill_printed(p_bill_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  select id, location_id, record_status, print_status, revision_no
    into v_bill
  from public.rubber_bills
  where id = p_bill_id
  for update;

  if not found then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Rubber Bill not found');
  end if;

  if not public.can_access_location(v_bill.location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_bill.record_status <> 'active' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Only active Rubber Bills can be marked printed');
  end if;

  if v_bill.print_status <> 'ปริ้นแล้ว' then
    update public.rubber_bills
    set print_status = 'ปริ้นแล้ว'
    where id = p_bill_id;
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'id', p_bill_id,
    'printStatus', 'ปริ้นแล้ว',
    'revisionNo', v_bill.revision_no
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.mark_rubber_bill_printed(uuid) from public, anon;
grant execute on function public.mark_rubber_bill_printed(uuid) to authenticated;

