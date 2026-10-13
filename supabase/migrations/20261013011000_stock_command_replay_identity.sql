-- Make stock receive/transfer commands replay-safe without adding schema.
-- Client UUIDs are the durable command identity and existing stock rows are the receipt.

create or replace function public.sync_acid_stock_entry(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;
  v_entry_id uuid;
  v_location_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_tx_date date;
  v_quantity numeric;
  v_amount numeric;
  v_date text;
  v_next_seq integer;
  v_server_bill_no text;
  v_existing public.stock_entries%rowtype;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  v_entry_id := (payload->>'entryId')::uuid;
  v_location_id := (payload->>'locationId')::uuid;
  v_product_id := (payload->>'productId')::uuid;
  v_tx_date := (payload->>'txDate')::date;
  v_quantity := (payload->>'quantity')::numeric;
  v_amount := coalesce(nullif(payload->>'amount', '')::numeric, 0);

  if v_tx_date is null or not isfinite(v_tx_date) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'วันที่รับเข้าไม่ถูกต้อง');
  end if;
  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stock-receive:' || v_entry_id::text, 0));
  select * into v_existing
  from public.stock_entries
  where id = v_entry_id
  for update;

  if found then
    if v_existing.created_by_user_id = v_created_by_user_id
      and v_existing.location_id = v_location_id
      and v_existing.product_id = v_product_id
      and v_existing.tx_date = v_tx_date
      and v_existing.quantity_delta = v_quantity
      and v_existing.amount = v_amount
      and v_existing.tx_type = 'receive'
      and v_existing.record_status = 'active'
    then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_existing.id,
        'serverBillNo', v_existing.server_bill_no,
        'serverReceivedAt', v_existing.created_at
      );
    end if;
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'Stock command identity conflict');
  end if;

  if v_quantity is null or v_quantity <= 0 or v_quantity > 9999999999.99 or v_quantity <> round(v_quantity, 2) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนรับเข้าไม่ถูกต้อง');
  end if;
  if v_amount < 0 or v_amount > 9999999999.99 or v_amount <> round(v_amount, 2) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ยอดเงินรับเข้าไม่ถูกต้อง');
  end if;

  select name into v_product_name
  from public.stock_products
  where id = v_product_id and is_active = true;
  if v_product_name is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
  end if;

  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  v_date := to_char(v_tx_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext(v_location_id::text || ':acid-receive:' || v_date));
  select count(*) + 1 into v_next_seq
  from public.stock_entries
  where location_id = v_location_id
    and tx_date = v_tx_date
    and tx_type = 'receive'
    and server_bill_no is not null;
  v_server_bill_no := 'AS-' || v_date || '-' || lpad(v_next_seq::text, 4, '0');

  insert into public.stock_entries (
    id, server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_entry_id, v_server_bill_no, v_tx_date, v_product_id, v_product_name, v_quantity,
    v_amount, v_location_id, 'receive', v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning created_at into v_existing.created_at;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_entry_id,
    'serverBillNo', v_server_bill_no,
    'serverReceivedAt', v_existing.created_at
  );
exception when others then
  raise warning 'sync_acid_stock_entry failed [%]: %', sqlstate, sqlerrm;
  return jsonb_build_object('status', 'failed', 'errorMessage', 'บันทึกสต็อกไม่สำเร็จ');
end;
$$;

revoke all on function public.sync_acid_stock_entry(jsonb) from public, anon;
grant execute on function public.sync_acid_stock_entry(jsonb) to authenticated;

create or replace function public.transfer_acid_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;
  v_out_id uuid;
  v_in_id uuid;
  v_from_location_id uuid;
  v_to_location_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_tx_date date;
  v_quantity numeric;
  v_balance numeric;
  v_date text;
  v_next_seq integer;
  v_transfer_bill_no text;
  v_first_identity text;
  v_second_identity text;
  v_first_stock_key text;
  v_second_stock_key text;
  v_out_found boolean;
  v_in_found boolean;
  v_existing_out public.stock_entries%rowtype;
  v_existing_in public.stock_entries%rowtype;
  v_server_received_at timestamptz;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  v_out_id := (payload->>'outId')::uuid;
  v_in_id := (payload->>'inId')::uuid;
  v_from_location_id := (payload->>'fromLocationId')::uuid;
  v_to_location_id := (payload->>'toLocationId')::uuid;
  v_product_id := (payload->>'productId')::uuid;
  v_tx_date := (payload->>'txDate')::date;
  v_quantity := (payload->>'quantity')::numeric;

  if v_tx_date is null or not isfinite(v_tx_date) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'วันที่ย้ายไม่ถูกต้อง');
  end if;
  if v_from_location_id = v_to_location_id or v_out_id = v_in_id then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ข้อมูลย้ายสต็อกไม่ถูกต้อง');
  end if;
  if not public.can_access_location(v_from_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;
  if not exists (select 1 from public.locations where id = v_to_location_id and is_active = true) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสาขาปลายทาง');
  end if;

  v_first_identity := least(v_out_id::text, v_in_id::text);
  v_second_identity := greatest(v_out_id::text, v_in_id::text);
  perform pg_advisory_xact_lock(hashtextextended('stock-transfer:' || v_first_identity, 0));
  perform pg_advisory_xact_lock(hashtextextended('stock-transfer:' || v_second_identity, 0));

  select * into v_existing_out from public.stock_entries where id = v_out_id for update;
  v_out_found := found;
  select * into v_existing_in from public.stock_entries where id = v_in_id for update;
  v_in_found := found;

  if v_out_found or v_in_found then
    if v_out_found and v_in_found
      and v_existing_out.created_by_user_id = v_created_by_user_id
      and v_existing_in.created_by_user_id = v_created_by_user_id
      and v_existing_out.location_id = v_from_location_id
      and v_existing_in.location_id = v_to_location_id
      and v_existing_out.product_id = v_product_id
      and v_existing_in.product_id = v_product_id
      and v_existing_out.tx_date = v_tx_date
      and v_existing_in.tx_date = v_tx_date
      and v_quantity > 0
      and v_existing_out.quantity_delta = -v_quantity
      and v_existing_in.quantity_delta = v_quantity
      and v_existing_out.amount = 0
      and v_existing_in.amount = 0
      and v_existing_out.tx_type = 'transfer_out'
      and v_existing_in.tx_type = 'transfer_in'
      and v_existing_out.transfer_bill_no is not null
      and v_existing_out.transfer_bill_no = v_existing_in.transfer_bill_no
      and v_existing_out.record_status = 'active'
      and v_existing_in.record_status = 'active'
    then
      return jsonb_build_object(
        'status', 'synced',
        'transferBillNo', v_existing_out.transfer_bill_no,
        'outId', v_existing_out.id,
        'inId', v_existing_in.id,
        'serverReceivedAt', greatest(v_existing_out.created_at, v_existing_in.created_at)
      );
    end if;
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'Stock command identity conflict');
  end if;

  if v_quantity is null or v_quantity <= 0 or v_quantity > 9999999999.99 or v_quantity <> round(v_quantity, 2) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนย้ายไม่ถูกต้อง');
  end if;

  select name into v_product_name
  from public.stock_products
  where id = v_product_id and is_active = true;
  if v_product_name is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
  end if;

  v_first_stock_key := least(
    'acid-stock:' || v_from_location_id::text || ':' || v_product_id::text,
    'acid-stock:' || v_to_location_id::text || ':' || v_product_id::text
  );
  v_second_stock_key := greatest(
    'acid-stock:' || v_from_location_id::text || ':' || v_product_id::text,
    'acid-stock:' || v_to_location_id::text || ':' || v_product_id::text
  );
  perform pg_advisory_xact_lock(hashtext(v_first_stock_key));
  perform pg_advisory_xact_lock(hashtext(v_second_stock_key));

  v_balance := public.get_stock_balance(v_from_location_id, v_product_id);
  if v_balance < v_quantity then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกไม่พอสำหรับย้ายสินค้า');
  end if;

  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  v_date := to_char(v_tx_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext('acid-transfer:' || v_date));
  select count(*) + 1 into v_next_seq
  from public.stock_entries
  where tx_date = v_tx_date and transfer_bill_no is not null;
  v_transfer_bill_no := 'AT-' || v_date || '-' || lpad(v_next_seq::text, 4, '0');

  insert into public.stock_entries (
    id, server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, transfer_bill_no,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_out_id, v_transfer_bill_no, v_tx_date, v_product_id, v_product_name, -abs(v_quantity),
    0, v_from_location_id, 'transfer_out', v_transfer_bill_no,
    v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  );

  insert into public.stock_entries (
    id, server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, transfer_bill_no,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_in_id, v_transfer_bill_no, v_tx_date, v_product_id, v_product_name, abs(v_quantity),
    0, v_to_location_id, 'transfer_in', v_transfer_bill_no,
    v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning created_at into v_server_received_at;

  return jsonb_build_object(
    'status', 'synced',
    'transferBillNo', v_transfer_bill_no,
    'outId', v_out_id,
    'inId', v_in_id,
    'serverReceivedAt', v_server_received_at
  );
exception when others then
  raise warning 'transfer_acid_stock failed [%]: %', sqlstate, sqlerrm;
  return jsonb_build_object('status', 'failed', 'errorMessage', 'ย้ายสต็อกไม่สำเร็จ');
end;
$$;

revoke all on function public.transfer_acid_stock(jsonb) from public, anon;
grant execute on function public.transfer_acid_stock(jsonb) to authenticated;
