-- Migration: 20260702060000_rubber_bill_sync_rpc.sql

-- Drop existing function if exists to allow clean recreate
drop function if exists public.sync_rubber_bill(jsonb);

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
  v_record_status record_status;
  v_idempotency_key text;
  
  v_bill_id uuid;
  v_current_revision integer;
  v_server_bill_no text;
  v_existing_idempotency_key text;
  
  v_item jsonb;
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;
  
  v_date text;
  v_next_seq integer;
begin
  -- 1. Check Auth (Must be active user)
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone from public.profiles where id = v_created_by_user_id;

  -- 2. Extract Base Payload info
  v_operation := payload->>'operation';
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  v_client_temp_id := payload->>'clientTempId';
  v_location_id := (payload->>'locationId')::uuid;
  v_record_status := (payload->>'recordStatus')::record_status;
  v_idempotency_key := payload->>'idempotencyKey';

  -- Check if user has access to this location
  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  -- 3. Concurrency Control (Revision & Idempotency Check)
  select id, revision_no, server_bill_no, idempotency_key 
  into v_bill_id, v_current_revision, v_server_bill_no, v_existing_idempotency_key
  from public.rubber_bills
  where client_temp_id = v_client_temp_id
  for update; -- Lock the row

  if v_bill_id is not null then
    -- Idempotency check: if exact same request was already processed, return success immediately
    if v_idempotency_key = v_existing_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_bill_id,
        'serverBillNo', v_server_bill_no,
        'revisionNo', v_current_revision,
        'serverReceivedAt', now()
      );
    end if;

    -- Record exists
    if v_operation = 'create' then
      -- It's a create but idempotency key doesn't match? That means conflict.
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
    else
      -- Update or Delete
      if v_current_revision != coalesce(v_expected_revision, v_current_revision) then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
      end if;
    end if;
  else
    -- Record does not exist
    if v_operation != 'create' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;
  end if;

  -- 4. Process Operation
  if v_operation = 'delete' then
    -- Soft Delete Parent ONLY
    update public.rubber_bills
    set record_status = 'deleted',
        deleted_at = now(),
        deleted_by_name = payload->>'deletedByName',
        deleted_by_phone = payload->>'deletedByPhone',
        revision_no = revision_no + 1,
        idempotency_key = v_idempotency_key,
        server_received_at = now()
    where id = v_bill_id
    returning id, revision_no into v_bill_id, v_current_revision;
    
  else
    -- Create or Update
    
    -- Generate server_bill_no if this is a new bill
    if v_bill_id is null then
      v_date := to_char((payload->>'billDate')::date, 'YYMMDD');
      
      -- Acquire advisory lock to prevent sequence race conditions for this location and date
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));
      
      select count(*) + 1 into v_next_seq
      from public.rubber_bills
      where location_id = v_location_id
        and to_char(bill_date, 'YYMMDD') = v_date
        and server_bill_no is not null;
        
      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');
    end if;

    -- Upsert Parent Bill
    insert into public.rubber_bills (
      client_temp_id, idempotency_key, revision_no, sync_status, record_status,
      location_id, bill_no, local_bill_no, server_bill_no, bill_date,
      customer_name, customer_type, bill_type,
      weight, rubber_value, average_price,
      deduction_total, net_total,
      cash_payment, transfer_payment, acid_pack_count,
      client_recorded_at, client_created_at, server_received_at,
      created_by_user_id, created_by_name, created_by_phone
    ) values (
      v_client_temp_id,
      v_idempotency_key,
      coalesce(v_expected_revision + 1, 1),
      'synced',
      'active',
      v_location_id,
      coalesce(v_server_bill_no, payload->>'localBillNo'),
      payload->>'localBillNo',
      v_server_bill_no,
      (payload->>'billDate')::date,
      payload->>'customerName',
      payload->>'customerType',
      'weighing',
      (payload->>'weight')::numeric,
      (payload->>'rubberValue')::numeric,
      (payload->>'averagePrice')::numeric,
      (payload->>'deductionTotal')::numeric,
      (payload->>'netTotal')::numeric,
      (payload->>'cashPayment')::numeric,
      (payload->>'transferPayment')::numeric,
      (payload->>'acidPackCount')::numeric,
      (payload->>'clientRecordedAt')::timestamptz,
      (payload->>'clientCreatedAt')::timestamptz,
      now(),
      v_created_by_user_id,
      v_created_by_name,
      v_created_by_phone
    )
    on conflict (client_temp_id) do update set
      revision_no = public.rubber_bills.revision_no + 1,
      idempotency_key = excluded.idempotency_key,
      sync_status = 'synced',
      record_status = 'active',
      bill_date = excluded.bill_date,
      customer_name = excluded.customer_name,
      customer_type = excluded.customer_type,
      weight = excluded.weight,
      rubber_value = excluded.rubber_value,
      average_price = excluded.average_price,
      deduction_total = excluded.deduction_total,
      net_total = excluded.net_total,
      cash_payment = excluded.cash_payment,
      transfer_payment = excluded.transfer_payment,
      acid_pack_count = excluded.acid_pack_count,
      client_recorded_at = excluded.client_recorded_at,
      server_received_at = now()
    returning id, revision_no into v_bill_id, v_current_revision;

    -- Replace Child Items
    delete from public.rubber_bill_items where bill_id = v_bill_id;
    
    -- Insert new child items
    for v_item in select * from jsonb_array_elements(payload->'items')
    loop
      insert into public.rubber_bill_items (
        bill_id, item_type, description,
        weight_in, weight_out, net_weight,
        quantity, unit, price, total
      ) values (
        v_bill_id,
        v_item->>'itemType',
        v_item->>'description',
        (v_item->>'inWeight')::numeric,
        (v_item->>'outWeight')::numeric,
        (v_item->>'netWeight')::numeric,
        (v_item->>'quantity')::numeric,
        v_item->>'unit',
        (v_item->>'unitPrice')::numeric,
        (v_item->>'totalAmount')::numeric
      );
    end loop;
  end if;

  -- 5. Return success
  return jsonb_build_object(
    'status', 'synced',
    'id', v_bill_id,
    'serverBillNo', v_server_bill_no,
    'revisionNo', v_current_revision,
    'serverReceivedAt', now()
  );

exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;
