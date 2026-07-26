-- Finalize the Rubber Bill receipt/approval contract.
--
-- * configured_price is a cap and may be zero.
-- * create uses the trusted configuredPriceSnapshot supplied by the device.
-- * approval requests snapshot both cap and edit-window settings.
-- * the bill row exposes whether its current revision was approved.
-- * obsolete payment-responsibility and print-state columns are removed.

alter table public.rubber_bill_approval_settings
  drop constraint if exists rubber_bill_approval_settings_configured_price_check;

alter table public.rubber_bill_approval_settings
  add constraint rubber_bill_approval_settings_configured_price_check
  check (configured_price is null or configured_price >= 0);

alter table public.rubber_bill_approval_requests
  add column edit_window_minutes_snapshot integer;

update public.rubber_bill_approval_requests
set edit_window_minutes_snapshot = coalesce(
  (select edit_window_minutes
   from public.rubber_bill_approval_settings
   where id = true),
  0
);

alter table public.rubber_bill_approval_requests
  alter column edit_window_minutes_snapshot set not null,
  add constraint rubber_bill_approval_requests_edit_window_snapshot_check
    check (edit_window_minutes_snapshot >= 0);

alter table public.rubber_bills
  add column configured_price_snapshot numeric(12,2),
  add column approval_state text not null default 'not_required',
  add column approved_by_name text,
  add column approval_revision_no integer,
  add constraint rubber_bills_configured_price_snapshot_check
    check (configured_price_snapshot is null or configured_price_snapshot >= 0),
  add constraint rubber_bills_approval_state_check
    check (approval_state in ('not_required', 'approved')),
  add constraint rubber_bills_approval_revision_shape_check
    check (
      (
        approval_state = 'not_required'
        and approved_by_name is null
        and approval_revision_no is null
      )
      or
      (
        approval_state = 'approved'
        and approved_by_name is not null
        and approval_revision_no = revision_no
      )
    );

create or replace function private.current_rubber_bill_payload(p_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', b.revision_no,
    'clientTempId', b.client_temp_id,
    'idempotencyKey', b.idempotency_key,
    'locationId', b.location_id,
    'recordStatus', b.record_status,
    'localBillNo', b.local_bill_no,
    'billDate', b.bill_date,
    'customerId', b.customer_id,
    'customerName', b.customer_name,
    'configuredPriceSnapshot', b.configured_price_snapshot,
    'billType', b.bill_type,
    'deductWeight', b.deduct_weight,
    'weight', b.weight,
    'rubberValue', b.rubber_value,
    'averagePrice', b.average_price,
    'deductionTotal', b.deduction_total,
    'netTotal', b.net_total,
    'acidPackCount', b.acid_pack_count,
    'clientRecordedAt', b.client_recorded_at,
    'clientCreatedAt', b.client_created_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'itemType', i.item_type,
          'title', i.description,
          'description', i.description,
          'inWeight', i.weight_in,
          'outWeight', i.weight_out,
          'netWeight', i.net_weight,
          'stockProductId', i.stock_product_id,
          'quantity', i.quantity,
          'unit', i.unit,
          'unitPrice', i.price,
          'totalAmount', i.total,
          'sequenceNo', i.sequence_no
        )
        order by i.sequence_no
      )
      from public.rubber_bill_items i
      where i.bill_id = b.id
    ), '[]'::jsonb)
  )
  from public.rubber_bills b
  where b.id = p_bill_id;
$$;

create or replace function private.guard_reported_entity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_report_no text;
begin
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);

  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.sync_rubber_bill_core_20260725010000(payload jsonb)
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
  v_customer_id uuid;
  v_deduct_weight numeric;

  v_bill_id uuid;
  v_current_revision integer;
  v_server_bill_no text;
  v_existing_idempotency_key text;
  v_existing_record_status record_status;
  v_transfer_locked boolean;

  v_item jsonb;
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;

  v_date text;
  v_next_seq integer;
  v_stock_product_id uuid;
  v_stock_quantity numeric;
  v_stock_row record;
  v_current_balance numeric;
  v_projected_balance numeric;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  v_operation := payload->>'operation';
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  v_client_temp_id := payload->>'clientTempId';
  v_location_id := (payload->>'locationId')::uuid;
  v_record_status := (payload->>'recordStatus')::record_status;
  v_idempotency_key := payload->>'idempotencyKey';

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

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  select id, revision_no, server_bill_no, idempotency_key, record_status
    into v_bill_id, v_current_revision, v_server_bill_no, v_existing_idempotency_key, v_existing_record_status
  from public.rubber_bills
  where client_temp_id = v_client_temp_id
  for update;

  if v_bill_id is not null then
    if v_idempotency_key = v_existing_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_bill_id,
        'serverBillNo', v_server_bill_no,
        'revisionNo', v_current_revision,
        'serverReceivedAt', now()
      );
    end if;

    if v_operation = 'create' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
    elsif v_current_revision != coalesce(v_expected_revision, v_current_revision) then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
    end if;
  elsif v_operation != 'create' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
  end if;

  if v_bill_id is not null and v_operation in ('update', 'delete') then
    select exists (
      select 1
      from public.money_transfer_items i
      join public.money_transfers t on t.id = i.transfer_id
      where i.source_type = 'rubber_bill'
        and i.source_id = v_bill_id
        and t.record_status <> 'deleted'
    ) into v_transfer_locked;

    if coalesce(v_transfer_locked, false) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน'
      );
    end if;
  end if;

  if v_operation in ('create', 'update') then
    create temporary table if not exists pg_temp._acid_stock_delta (
      product_id uuid primary key,
      old_qty numeric not null default 0,
      new_qty numeric not null default 0
    ) on commit drop;
    truncate table pg_temp._acid_stock_delta;

    if v_bill_id is not null and v_existing_record_status = 'active' then
      insert into pg_temp._acid_stock_delta (product_id, old_qty)
      select stock_product_id, sum(quantity)
      from public.rubber_bill_items
      where bill_id = v_bill_id
        and item_type in ('acid', 'stock_deduction')
        and stock_product_id is not null
      group by stock_product_id;
    end if;

    for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
    loop
      if v_item->>'itemType' in ('acid', 'stock_deduction') then
        v_stock_product_id := nullif(v_item->>'stockProductId', '')::uuid;
        v_stock_quantity := nullif(v_item->>'quantity', '')::numeric;

        if v_stock_product_id is null or coalesce(v_stock_quantity, 0) <= 0 then
          return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการหักสินค้าต้องเลือกสินค้าในสต็อกและระบุจำนวน');
        end if;

        if not exists (
          select 1
          from public.acid_products
          where id = v_stock_product_id
            and is_active = true
        ) then
          return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อกสำหรับรายการหักสินค้า');
        end if;

        insert into pg_temp._acid_stock_delta (product_id, new_qty)
        values (v_stock_product_id, v_stock_quantity)
        on conflict (product_id) do update
          set new_qty = pg_temp._acid_stock_delta.new_qty + excluded.new_qty;
      end if;
    end loop;

    for v_stock_row in select * from pg_temp._acid_stock_delta
    loop
      perform pg_advisory_xact_lock(
        hashtext('acid-stock:' || v_location_id::text || ':' || v_stock_row.product_id::text)
      );
      v_current_balance := public.get_acid_stock_balance(v_location_id, v_stock_row.product_id);
      v_projected_balance := v_current_balance + v_stock_row.old_qty - v_stock_row.new_qty;

      if v_projected_balance < 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกสินค้าไม่พอสำหรับรายการหักสินค้าในบิลยาง');
      end if;
    end loop;
  end if;

  if v_operation = 'delete' then
    update public.rubber_bills
    set record_status = 'deleted',
        deleted_at = now(),
        deleted_by_name = payload->>'deletedByName',
        deleted_by_phone = payload->>'deletedByPhone',
        revision_no = revision_no + 1,
        idempotency_key = v_idempotency_key,
        server_received_at = now(),
        approval_state = 'not_required',
        approved_by_name = null,
        approval_revision_no = null
    where id = v_bill_id
    returning id, revision_no into v_bill_id, v_current_revision;

  else
    if v_bill_id is null then
      v_date := to_char((payload->>'billDate')::date, 'YYMMDD');
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));

      select count(*) + 1 into v_next_seq
      from public.rubber_bills
      where location_id = v_location_id
        and to_char(bill_date, 'YYMMDD') = v_date
        and server_bill_no is not null;

      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');
    end if;

    insert into public.rubber_bills (
      client_temp_id, idempotency_key, revision_no, sync_status, record_status,
      location_id, bill_no, local_bill_no, server_bill_no, bill_date,
      customer_id, customer_name, configured_price_snapshot, bill_type,
      deduct_weight, weight, rubber_value, average_price,
      deduction_total, net_total, acid_pack_count,
      client_recorded_at, client_created_at, server_received_at,
      created_by_user_id, created_by_name, created_by_phone,
      approval_state, approved_by_name, approval_revision_no
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
      v_customer_id,
      payload->>'customerName',
      case
        when v_operation = 'create' then (payload->>'configuredPriceSnapshot')::numeric
        else null
      end,
      coalesce(nullif(payload->>'billType', ''), 'weighing'),
      v_deduct_weight,
      (payload->>'weight')::numeric,
      (payload->>'rubberValue')::numeric,
      (payload->>'averagePrice')::numeric,
      (payload->>'deductionTotal')::numeric,
      (payload->>'netTotal')::numeric,
      (payload->>'acidPackCount')::numeric,
      (payload->>'clientRecordedAt')::timestamptz,
      (payload->>'clientCreatedAt')::timestamptz,
      now(),
      v_created_by_user_id,
      coalesce(v_created_by_name, ''),
      coalesce(v_created_by_phone, ''),
      'not_required',
      null,
      null
    )
    on conflict (client_temp_id) do update set
      revision_no = public.rubber_bills.revision_no + 1,
      idempotency_key = excluded.idempotency_key,
      sync_status = 'synced',
      record_status = 'active',
      bill_date = excluded.bill_date,
      customer_id = excluded.customer_id,
      customer_name = excluded.customer_name,
      bill_type = excluded.bill_type,
      deduct_weight = excluded.deduct_weight,
      weight = excluded.weight,
      rubber_value = excluded.rubber_value,
      average_price = excluded.average_price,
      deduction_total = excluded.deduction_total,
      net_total = excluded.net_total,
      acid_pack_count = excluded.acid_pack_count,
      client_recorded_at = excluded.client_recorded_at,
      server_received_at = now(),
      approval_state = 'not_required',
      approved_by_name = null,
      approval_revision_no = null
    returning id, revision_no into v_bill_id, v_current_revision;

    delete from public.rubber_bill_items where bill_id = v_bill_id;

    for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
    loop
      insert into public.rubber_bill_items (
        bill_id, item_type, description,
        weight_in, weight_out, net_weight,
        quantity, unit, price, total, stock_product_id, sequence_no
      ) values (
        v_bill_id,
        v_item->>'itemType',
        coalesce(v_item->>'description', v_item->>'title'),
        (v_item->>'inWeight')::numeric,
        (v_item->>'outWeight')::numeric,
        (v_item->>'netWeight')::numeric,
        (v_item->>'quantity')::numeric,
        v_item->>'unit',
        (v_item->>'unitPrice')::numeric,
        (v_item->>'totalAmount')::numeric,
        nullif(v_item->>'stockProductId', '')::uuid,
        nullif(v_item->>'sequenceNo', '')::integer
      );
    end loop;
  end if;

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

revoke all on function public.sync_rubber_bill_core_20260725010000(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_operation text := payload->>'operation';
  v_client_temp_id text := payload->>'clientTempId';
  v_location_id uuid;
  v_idempotency_key text := payload->>'idempotencyKey';
  v_expected_revision integer;
  v_bill public.rubber_bills%rowtype;
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_original_payload jsonb;
  v_current_prices jsonb := '[]'::jsonb;
  v_proposed_prices jsonb := '[]'::jsonb;
  v_price numeric;
  v_price_scale integer;
  v_price_cap numeric;
  v_has_exceeded_cap boolean := false;
  v_reasons text[] := array[]::text[];
  v_request_id uuid;
  v_existing_request_status text;
  v_existing_created_bill_id uuid;
  v_actor_name text;
  v_actor_phone text;
  v_report_no text;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  begin
    v_location_id := (payload->>'locationId')::uuid;
    v_expected_revision := coalesce((payload->>'expectedRevisionNo')::integer, 0);
  exception when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid approval payload');
  end;

  if coalesce(v_client_temp_id, '') = ''
     or coalesce(v_idempotency_key, '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;

  select name, phone
    into v_actor_name, v_actor_phone
  from public.profiles
  where id = auth.uid();

  select *
    into v_settings
  from public.rubber_bill_approval_settings
  where id = true;

  if v_operation = 'create' then
    if not (payload ? 'configuredPriceSnapshot') then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'configuredPriceSnapshot is required for create'
      );
    end if;

    if jsonb_typeof(payload->'configuredPriceSnapshot') = 'null' then
      v_price_cap := null;
    elsif jsonb_typeof(payload->'configuredPriceSnapshot') = 'number' then
      begin
        v_price_cap := (payload->>'configuredPriceSnapshot')::numeric;
      exception when others then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'configuredPriceSnapshot must be numeric or null'
        );
      end;

      if v_price_cap < 0 or scale(v_price_cap) > 2 then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'configuredPriceSnapshot must be non-negative with at most 2 decimal places'
        );
      end if;
    else
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'configuredPriceSnapshot must be numeric or null'
      );
    end if;
  else
    v_price_cap := v_settings.configured_price;
  end if;

  if v_operation in ('create', 'update') then
    for v_price, v_price_scale in
      select (item->>'unitPrice')::numeric, scale((item->>'unitPrice')::numeric)
      from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) item
      where item->>'itemType' = 'weigh'
    loop
      if v_price < 0 or v_price_scale > 2 then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง'
        );
      end if;
      if v_price_cap is not null and v_price > v_price_cap then
        v_has_exceeded_cap := true;
      end if;
    end loop;

    select coalesce(
      jsonb_agg((item->>'unitPrice')::numeric order by (item->>'sequenceNo')::integer),
      '[]'::jsonb
    )
      into v_proposed_prices
    from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) item
    where item->>'itemType' = 'weigh';
  end if;

  if v_operation = 'create' then
    perform pg_advisory_xact_lock(hashtext('rubber-bill-create:' || v_client_temp_id));

    select id, request_status, created_bill_id
      into v_request_id, v_existing_request_status, v_existing_created_bill_id
    from public.rubber_bill_approval_requests
    where idempotency_key = v_idempotency_key;

    if v_request_id is not null then
      if v_existing_request_status = 'approved' and v_existing_created_bill_id is not null then
        select *
          into v_bill
        from public.rubber_bills
        where id = v_existing_created_bill_id;
        return jsonb_build_object(
          'status', 'synced',
          'id', v_bill.id,
          'serverBillNo', v_bill.server_bill_no,
          'revisionNo', v_bill.revision_no,
          'serverReceivedAt', v_bill.server_received_at
        );
      end if;
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;

    if v_price_cap is null or not v_has_exceeded_cap then
      return public.sync_rubber_bill_core_20260725010000(payload);
    end if;

    v_reasons := array_append(v_reasons, 'price');
  else
    select *
      into v_bill
    from public.rubber_bills
    where client_temp_id = v_client_temp_id
    for update;

    if v_bill.id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;

    perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_bill.id::text));

    if v_bill.location_id <> v_location_id then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Location mismatch');
    end if;

    if v_bill.idempotency_key = v_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_bill.id,
        'serverBillNo', v_bill.server_bill_no,
        'revisionNo', v_bill.revision_no,
        'serverReceivedAt', v_bill.server_received_at
      );
    end if;

    if v_bill.revision_no <> v_expected_revision then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
    end if;

    select id
      into v_request_id
    from public.rubber_bill_approval_requests
    where bill_id = v_bill.id
      and request_status = 'pending';

    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;

    v_report_no := private.active_report_no('rubber_bill', v_bill.id);
    if v_report_no is not null then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'บิลอยู่ในรายงาน ' || v_report_no || ' แล้ว จึงสร้างคำขอไม่ได้'
      );
    end if;

    if private.rubber_bill_has_active_transfer(v_bill.id) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'บิลอยู่ในรายการโอนเงินแล้ว จึงสร้างคำขอไม่ได้'
      );
    end if;

    if clock_timestamp() >= v_bill.created_at + make_interval(mins => v_settings.edit_window_minutes) then
      v_reasons := array_append(v_reasons, 'time');
    end if;

    if v_operation = 'update' and v_price_cap is not null then
      select coalesce(jsonb_agg(i.price order by i.sequence_no), '[]'::jsonb)
        into v_current_prices
      from public.rubber_bill_items i
      where i.bill_id = v_bill.id
        and i.item_type = 'weigh';

      if v_current_prices is distinct from v_proposed_prices and v_has_exceeded_cap then
        v_reasons := array_append(v_reasons, 'price');
      end if;
    end if;

    if cardinality(v_reasons) = 0 then
      return public.sync_rubber_bill_core_20260725010000(payload);
    end if;

    v_original_payload := private.current_rubber_bill_payload(v_bill.id);
  end if;

  insert into public.rubber_bill_approval_requests (
    operation,
    bill_id,
    location_id,
    client_temp_id,
    idempotency_key,
    base_revision_no,
    matched_reasons,
    configured_price_snapshot,
    edit_window_minutes_snapshot,
    original_payload,
    proposed_payload,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  )
  values (
    v_operation,
    v_bill.id,
    v_location_id,
    v_client_temp_id,
    v_idempotency_key,
    v_expected_revision,
    v_reasons,
    v_price_cap,
    v_settings.edit_window_minutes,
    v_original_payload,
    payload,
    auth.uid(),
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending_approval',
    'requestId', v_request_id,
    'operation', v_operation,
    'clientTempId', v_client_temp_id,
    'matchedReasons', to_jsonb(v_reasons)
  );
exception
  when unique_violation then
    select id
      into v_request_id
    from public.rubber_bill_approval_requests
    where request_status = 'pending'
      and (
        idempotency_key = v_idempotency_key
        or bill_id = v_bill.id
        or (operation = 'create' and client_temp_id = v_client_temp_id)
      )
    order by requested_at desc
    limit 1;

    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
  when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

create or replace function public.save_rubber_bill_approval_settings(
  p_edit_window_minutes integer,
  p_configured_price numeric
)
returns public.rubber_bill_approval_settings
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_result public.rubber_bill_approval_settings%rowtype;
  v_actor_name text;
  v_actor_phone text;
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าการอนุมัติบิลยาง';
  end if;
  if p_edit_window_minutes is null or p_edit_window_minutes < 0 then
    raise exception 'จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  if p_configured_price is not null
     and (p_configured_price < 0 or scale(p_configured_price) > 2) then
    raise exception 'ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;

  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bill_approval_settings
  set edit_window_minutes = p_edit_window_minutes,
      configured_price = p_configured_price,
      updated_by_user_id = auth.uid(),
      updated_by_name = coalesce(v_actor_name, ''),
      updated_by_phone = coalesce(v_actor_phone, ''),
      updated_at = now()
  where id = true
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.save_rubber_bill_approval_settings(integer, numeric)
  from public, anon;
grant execute on function public.save_rubber_bill_approval_settings(integer, numeric)
  to authenticated;

create or replace function public.approve_rubber_bill_approval_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.rubber_bill_approval_requests%rowtype;
  v_result jsonb;
  v_actor_name text;
  v_actor_phone text;
  v_created_bill_id uuid;
  v_report_no text;
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์อนุมัติคำขอบิลยาง';
  end if;

  select *
    into v_request
  from public.rubber_bill_approval_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.request_status <> 'pending' then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;

  if v_request.bill_id is not null then
    perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_request.bill_id::text));
    v_report_no := private.active_report_no('rubber_bill', v_request.bill_id);
    if v_report_no is not null then
      raise exception 'บิลอยู่ในรายงาน % แล้ว จึงอนุมัติไม่ได้', v_report_no;
    end if;
    if private.rubber_bill_has_active_transfer(v_request.bill_id) then
      raise exception 'บิลอยู่ในรายการโอนเงินแล้ว จึงอนุมัติไม่ได้';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('rubber-bill-create:' || v_request.client_temp_id));
  end if;

  v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);
  if v_result->>'status' <> 'synced' then
    raise exception '%', coalesce(v_result->>'errorMessage', 'อนุมัติคำขอไม่สำเร็จ');
  end if;

  v_created_bill_id := (v_result->>'id')::uuid;

  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bills
  set created_by_user_id = case
        when v_request.operation = 'create' then v_request.requested_by_user_id
        else created_by_user_id
      end,
      created_by_name = case
        when v_request.operation = 'create' then v_request.requested_by_name
        else created_by_name
      end,
      created_by_phone = case
        when v_request.operation = 'create' then v_request.requested_by_phone
        else created_by_phone
      end,
      approval_state = 'approved',
      approved_by_name = coalesce(v_actor_name, ''),
      approval_revision_no = revision_no
  where id = v_created_bill_id;

  update public.rubber_bill_approval_requests
  set request_status = 'approved',
      approved_by_user_id = auth.uid(),
      approved_by_name = coalesce(v_actor_name, ''),
      approved_by_phone = coalesce(v_actor_phone, ''),
      approved_at = now(),
      created_bill_id = case when operation = 'create' then v_created_bill_id else null end
  where id = p_request_id;

  return jsonb_build_object(
    'status', 'approved',
    'requestId', p_request_id,
    'operation', v_request.operation,
    'billId', v_created_bill_id,
    'syncResult', v_result
  );
end;
$$;

revoke all on function public.approve_rubber_bill_approval_request(uuid)
  from public, anon;
grant execute on function public.approve_rubber_bill_approval_request(uuid)
  to authenticated;

drop function if exists public.mark_rubber_bill_printed(uuid);
drop function if exists public.sync_rubber_bill_core_20260724020000(jsonb);
drop function if exists public.sync_rubber_bill_core_20260716020000(jsonb);

alter table public.rubber_bills
  drop column print_status,
  drop column customer_type,
  drop column cash_payment,
  drop column transfer_payment;
