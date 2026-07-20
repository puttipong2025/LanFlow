-- Fix transfer stock destination branch check.
-- locations uses is_active, not active.

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
  v_out_id uuid;
  v_in_id uuid;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  v_from_location_id := (payload->>'fromLocationId')::uuid;
  v_to_location_id := (payload->>'toLocationId')::uuid;
  v_product_id := (payload->>'productId')::uuid;
  v_tx_date := (payload->>'txDate')::date;
  v_quantity := (payload->>'quantity')::numeric;

  if v_from_location_id = v_to_location_id then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'สาขาต้นทางและปลายทางต้องไม่ซ้ำกัน');
  end if;

  if not public.can_access_location(v_from_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if not exists (select 1 from public.locations where id = v_to_location_id and is_active = true) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสาขาปลายทาง');
  end if;

  if v_quantity is null or v_quantity <= 0 then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนย้ายต้องมากกว่า 0');
  end if;

  select name into v_product_name
  from public.stock_products
  where id = v_product_id
    and is_active = true;

  if v_product_name is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
  end if;

  perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_from_location_id::text || ':' || v_product_id::text));
  perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_to_location_id::text || ':' || v_product_id::text));

  v_balance := public.get_stock_balance(v_from_location_id, v_product_id);
  if v_balance < v_quantity then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกไม่พอสำหรับย้ายสินค้า');
  end if;

  v_date := to_char(v_tx_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext('acid-transfer:' || v_date));

  select count(*) + 1 into v_next_seq
  from public.stock_entries
  where tx_date = v_tx_date
    and transfer_bill_no is not null;

  v_transfer_bill_no := 'AT-' || v_date || '-' || lpad(v_next_seq::text, 4, '0');

  insert into public.stock_entries (
    server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, transfer_bill_no,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_transfer_bill_no, v_tx_date, v_product_id, v_product_name, -abs(v_quantity),
    0, v_from_location_id, 'transfer_out', v_transfer_bill_no,
    v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning id into v_out_id;

  insert into public.stock_entries (
    server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, transfer_bill_no,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_transfer_bill_no, v_tx_date, v_product_id, v_product_name, abs(v_quantity),
    0, v_to_location_id, 'transfer_in', v_transfer_bill_no,
    v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning id into v_in_id;

  return jsonb_build_object(
    'status', 'synced',
    'transferBillNo', v_transfer_bill_no,
    'outId', v_out_id,
    'inId', v_in_id,
    'serverReceivedAt', now()
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.transfer_acid_stock(jsonb) from public, anon;
grant execute on function public.transfer_acid_stock(jsonb) to authenticated;
