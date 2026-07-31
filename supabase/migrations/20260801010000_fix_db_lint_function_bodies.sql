-- Remove the two remaining local db lint findings without changing API contracts.
-- Keep recordStatus validation, and replace the runtime temp-table stock delta
-- with a statically checkable CTE ordered by product_id.

CREATE OR REPLACE FUNCTION "public"."sync_income_expense_core"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
  v_idempotency_key text;

  v_row_id uuid;
  v_current_revision integer;
  v_server_bill_no text;
  v_existing_idempotency_key text;
  v_existing_location_id uuid;
  v_existing_stock_product_id uuid;
  v_existing_stock_quantity numeric;
  v_existing_record_status record_status;

  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;

  v_type text;
  v_bill_option text;
  v_cost numeric;
  v_date text;
  v_next_seq integer;

  v_title text;
  v_internal_bypass boolean;
  v_keyword_id uuid;
  v_threshold numeric;
  v_threshold_scope text;
  v_amount_match boolean;
  v_keyword_match boolean;

  v_income_sale_item_id uuid;
  v_stock_product_id uuid;
  v_stock_quantity numeric;
  v_mapped_stock_product_id uuid;
  v_current_balance numeric;
  v_projected_balance numeric;
  v_existing_credit numeric;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_internal_bypass := coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true';

  if v_internal_bypass and nullif(payload->>'createdByUserId', '') is not null then
    v_created_by_user_id := (payload->>'createdByUserId')::uuid;
    select name, phone into v_created_by_name, v_created_by_phone
    from public.profiles where id = v_created_by_user_id;
    v_created_by_name := coalesce(nullif(payload->>'createdByName', ''), v_created_by_name, '');
    v_created_by_phone := coalesce(nullif(payload->>'createdByPhone', ''), v_created_by_phone, '');
  else
    v_created_by_user_id := auth.uid();
    select name, phone into v_created_by_name, v_created_by_phone
    from public.profiles where id = v_created_by_user_id;
  end if;

  v_operation := payload->>'operation';
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  v_client_temp_id := payload->>'clientTempId';
  v_location_id := (payload->>'locationId')::uuid;
  perform (payload->>'recordStatus')::record_status;
  v_idempotency_key := payload->>'idempotencyKey';
  v_type := payload->>'type';
  v_bill_option := payload->>'billOption';
  v_cost := (payload->>'cost')::numeric;
  v_title := trim(coalesce(payload->>'title', ''));
  v_income_sale_item_id := nullif(payload->>'incomeSaleItemId', '')::uuid;
  v_stock_product_id := nullif(payload->>'stockProductId', '')::uuid;
  v_stock_quantity := nullif(payload->>'stockQuantity', '')::numeric;

  if not v_internal_bypass and v_operation = 'create' then
    if v_title like 'รับโอนจาก%' or v_title like 'โยกเงินไป%' or v_title like 'สาขาจ่ายส่วนต่างให้%' or lower(v_title) = 'branch transfer' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'ไม่สามารถซิงก์รายการโยกเงินโดยตรงได้ ต้องทำผ่านระบบโยกเงินเท่านั้น');
    end if;
  end if;

  if not v_internal_bypass and v_operation in ('create', 'update') then
    select id
      into v_keyword_id
    from public.income_expense_approval_keywords
    where is_active = true
      and deleted_at is null
      and applies_to in (v_type, 'both')
      and (approval_min_amount is null or v_cost >= approval_min_amount)
      and (
        (match_mode = 'exact' and lower(trim(v_title)) = lower(trim(keyword)))
        or
        (match_mode = 'contains' and position(lower(trim(keyword)) in lower(trim(v_title))) > 0)
      )
    limit 1;
    v_keyword_match := v_keyword_id is not null;

    select approval_min_amount, applies_to
      into v_threshold, v_threshold_scope
    from public.income_expense_approval_settings
    where id = true;

    v_amount_match := v_threshold is not null
      and v_cost >= v_threshold
      and coalesce(v_threshold_scope, 'both') in (v_type, 'both');

    if v_keyword_match or v_amount_match then
       return jsonb_build_object('status', 'conflict', 'errorMessage', 'รายการนี้ต้องขออนุมัติ ไม่สามารถซิงก์โดยตรงได้');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('income_expense:' || v_client_temp_id));

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_operation != 'delete' then
    if v_type not in ('income', 'expense') then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid type');
    end if;
    if v_cost is null or v_cost <= 0 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'cost must be > 0');
    end if;
    if v_bill_option is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'billOption is required');
    end if;
    if v_type = 'income' and v_bill_option not in ('รายรับ', 'บิลขาย') then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid billOption for income');
    end if;
    if v_type = 'expense' and v_bill_option != 'ค่าใช้จ่าย' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid billOption for expense');
    end if;
    if v_bill_option = 'บิลขาย' then
      if coalesce((payload->>'unit')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'unit must be > 0 for บิลขาย');
      end if;
      if coalesce((payload->>'price')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'price must be > 0 for บิลขาย');
      end if;
      if v_income_sale_item_id is null or v_stock_product_id is null or coalesce(v_stock_quantity, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องเลือกรายการสินค้าที่ผูกกับสต็อก');
      end if;

      select stock_product_id
        into v_mapped_stock_product_id
      from public.income_sale_items
      where id = v_income_sale_item_id
        and is_active = true;

      if v_mapped_stock_product_id is null or v_mapped_stock_product_id <> v_stock_product_id then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการบิลขายไม่ตรงกับสินค้าในสต็อก');
      end if;
    else
      v_income_sale_item_id := null;
      v_stock_product_id := null;
      v_stock_quantity := null;
    end if;
  end if;

  select id, revision_no, server_bill_no, idempotency_key, location_id, stock_product_id, stock_quantity, record_status
    into v_row_id, v_current_revision, v_server_bill_no, v_existing_idempotency_key,
         v_existing_location_id, v_existing_stock_product_id, v_existing_stock_quantity, v_existing_record_status
  from public.income_expense
  where client_temp_id = v_client_temp_id
  for update;

  if v_row_id is not null then
    if v_idempotency_key = v_existing_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_row_id,
        'serverBillNo', v_server_bill_no,
        'revisionNo', v_current_revision,
        'serverReceivedAt', now()
      );
    end if;

    if v_operation = 'create' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
    else
      if v_current_revision != coalesce(v_expected_revision, v_current_revision) then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
      end if;
    end if;
  else
    if v_operation != 'create' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;
  end if;

  if v_operation in ('create', 'update') and v_bill_option = 'บิลขาย' then
    perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_location_id::text || ':' || v_stock_product_id::text));
    v_current_balance := public.get_acid_stock_balance(v_location_id, v_stock_product_id);
    v_existing_credit := 0;

    if v_row_id is not null
       and v_existing_record_status = 'active'
       and v_existing_location_id = v_location_id
       and v_existing_stock_product_id = v_stock_product_id then
      v_existing_credit := coalesce(v_existing_stock_quantity, 0);
    end if;

    v_projected_balance := v_current_balance + v_existing_credit - v_stock_quantity;
    if v_projected_balance < 0 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกสินค้าไม่พอสำหรับบิลขาย');
    end if;
  end if;

  if v_operation = 'delete' then
    update public.income_expense
    set record_status = 'deleted',
        deleted_at = now(),
        deleted_by_name = payload->>'deletedByName',
        deleted_by_phone = payload->>'deletedByPhone',
        revision_no = revision_no + 1,
        idempotency_key = v_idempotency_key,
        server_received_at = now()
    where id = v_row_id
    returning id, revision_no into v_row_id, v_current_revision;

  else
    if v_operation = 'create' then
      v_date := to_char((payload->>'txDate')::date, 'YYMMDD');
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));

      select count(*) + 1 into v_next_seq
      from public.income_expense
      where location_id = v_location_id
        and tx_date = (payload->>'txDate')::date
        and server_bill_no is not null;

      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');

      insert into public.income_expense (
        client_temp_id, idempotency_key, revision_no, sync_status, record_status,
        location_id, type, number, local_bill_no, server_bill_no,
        tx_date, title, cost, unit, price, bill_option,
        income_sale_item_id, stock_product_id, stock_quantity,
        client_recorded_at, client_created_at, server_received_at,
        created_by_user_id, created_by_name, created_by_phone
      ) values (
        v_client_temp_id,
        v_idempotency_key,
        1,
        'synced',
        'active',
        v_location_id,
        v_type::transaction_type,
        v_server_bill_no,
        payload->>'localBillNo',
        v_server_bill_no,
        (payload->>'txDate')::date,
        v_title,
        v_cost,
        case when v_bill_option = 'บิลขาย' then payload->>'unit' else null end,
        case when v_bill_option = 'บิลขาย' then (payload->>'price')::numeric else null end,
        v_bill_option,
        v_income_sale_item_id,
        v_stock_product_id,
        v_stock_quantity,
        (payload->>'clientRecordedAt')::timestamptz,
        (payload->>'clientCreatedAt')::timestamptz,
        now(),
        v_created_by_user_id,
        coalesce(v_created_by_name, ''),
        coalesce(v_created_by_phone, '')
      )
      returning id, revision_no into v_row_id, v_current_revision;
    else
      update public.income_expense
      set location_id = v_location_id,
          type = v_type::transaction_type,
          tx_date = (payload->>'txDate')::date,
          title = v_title,
          cost = v_cost,
          unit = case when v_bill_option = 'บิลขาย' then payload->>'unit' else null end,
          price = case when v_bill_option = 'บิลขาย' then (payload->>'price')::numeric else null end,
          bill_option = v_bill_option,
          income_sale_item_id = v_income_sale_item_id,
          stock_product_id = v_stock_product_id,
          stock_quantity = v_stock_quantity,
          client_recorded_at = (payload->>'clientRecordedAt')::timestamptz,
          revision_no = revision_no + 1,
          idempotency_key = v_idempotency_key,
          server_received_at = now()
      where id = v_row_id
      returning id, revision_no into v_row_id, v_current_revision;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_row_id,
    'serverBillNo', coalesce(v_server_bill_no, payload->>'localBillNo'),
    'revisionNo', v_current_revision,
    'serverReceivedAt', now()
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_income_expense_core(jsonb)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION "public"."sync_rubber_bill_core_20260725010000"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
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
  payload := private.normalize_rubber_bill_calculation_payload(payload);
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
  perform (payload->>'recordStatus')::record_status;
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
    for v_item in
      select *
      from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
    loop
      if v_item->>'itemType' in ('acid', 'stock_deduction') then
        v_stock_product_id := nullif(v_item->>'stockProductId', '')::uuid;
        v_stock_quantity := nullif(v_item->>'quantity', '')::numeric;

        if v_stock_product_id is null or coalesce(v_stock_quantity, 0) <= 0 then
          return jsonb_build_object(
            'status', 'failed',
            'errorMessage', 'รายการหักสินค้าต้องเลือกสินค้าในสต็อกและระบุจำนวน'
          );
        end if;

        if not exists (
          select 1
          from public.acid_products
          where id = v_stock_product_id
            and is_active = true
        ) then
          return jsonb_build_object(
            'status', 'failed',
            'errorMessage', 'ไม่พบสินค้าในสต็อกสำหรับรายการหักสินค้า'
          );
        end if;
      end if;
    end loop;

    for v_stock_row in
      with old_stock as (
        select
          stock_product_id as product_id,
          sum(quantity) as old_qty
        from public.rubber_bill_items
        where v_bill_id is not null
          and v_existing_record_status = 'active'
          and bill_id = v_bill_id
          and item_type in ('acid', 'stock_deduction')
          and stock_product_id is not null
        group by stock_product_id
      ),
      new_stock as (
        select
          nullif(item->>'stockProductId', '')::uuid as product_id,
          sum(nullif(item->>'quantity', '')::numeric) as new_qty
        from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) as item
        where item->>'itemType' in ('acid', 'stock_deduction')
        group by nullif(item->>'stockProductId', '')::uuid
      )
      select
        coalesce(old_stock.product_id, new_stock.product_id) as product_id,
        coalesce(old_stock.old_qty, 0) as old_qty,
        coalesce(new_stock.new_qty, 0) as new_qty
      from old_stock
      full join new_stock using (product_id)
      order by product_id
    loop
      perform pg_advisory_xact_lock(
        hashtext('acid-stock:' || v_location_id::text || ':' || v_stock_row.product_id::text)
      );
      v_current_balance := public.get_acid_stock_balance(
        v_location_id,
        v_stock_row.product_id
      );
      v_projected_balance :=
        v_current_balance + v_stock_row.old_qty - v_stock_row.new_qty;

      if v_projected_balance < 0 then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'สต็อกสินค้าไม่พอสำหรับรายการหักสินค้าในบิลยาง'
        );
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
