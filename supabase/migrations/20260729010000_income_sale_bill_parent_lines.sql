-- One sale form submission is one income_expense parent with ordered product lines.
-- There is intentionally no backfill: production has no sale bills at rollout time.

create table public.income_expense_sale_lines (
  id uuid primary key default gen_random_uuid(),
  income_expense_id uuid not null references public.income_expense(id) on delete cascade,
  income_sale_item_id uuid not null references public.income_sale_items(id),
  stock_product_id uuid not null references public.stock_products(id),
  title text not null,
  quantity numeric(12, 0) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  line_total numeric(14, 2) not null check (line_total > 0),
  sequence_no integer not null check (sequence_no > 0),
  created_at timestamptz not null default now(),
  unique (income_expense_id, sequence_no)
);

create index income_expense_sale_lines_parent_idx
  on public.income_expense_sale_lines (income_expense_id, sequence_no);
create index income_expense_sale_lines_stock_idx
  on public.income_expense_sale_lines (stock_product_id, income_expense_id);

alter table public.income_expense_sale_lines enable row level security;

create policy "income_expense_sale_lines_location_read"
  on public.income_expense_sale_lines for select to authenticated
  using (
    exists (
      select 1
      from public.income_expense ie
      where ie.id = income_expense_id
        and public.can_access_location(ie.location_id)
    )
  );

revoke all on table public.income_expense_sale_lines from anon, authenticated;
grant select on table public.income_expense_sale_lines to authenticated;
grant all privileges on table public.income_expense_sale_lines to service_role;

drop index if exists public.income_expense_active_sale_group_line_uidx;
alter table public.income_expense
  drop constraint if exists income_expense_sale_group_shape_check,
  drop column if exists sale_group_id,
  drop column if exists sale_line_order,
  drop column if exists sale_expected_lines;

create or replace function private.normalize_income_sale_lines(payload jsonb)
returns table (
  income_sale_item_id uuid,
  stock_product_id uuid,
  title text,
  quantity numeric,
  unit_price numeric,
  line_total numeric,
  sequence_no integer
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    item.id,
    item.stock_product_id,
    item.name,
    parsed.quantity,
    parsed.unit_price,
    round(parsed.quantity * parsed.unit_price, 2),
    parsed.sequence_no
  from (
    select
      nullif(line.value->>'incomeSaleItemId', '')::uuid as income_sale_item_id,
      nullif(line.value->>'quantity', '')::numeric as quantity,
      nullif(line.value->>'unitPrice', '')::numeric as unit_price,
      line.ordinality::integer as sequence_no
    from jsonb_array_elements(payload->'saleLines') with ordinality as line(value, ordinality)
  ) parsed
  join public.income_sale_items item
    on item.id = parsed.income_sale_item_id
   and item.is_active = true
   and item.stock_product_id is not null;
$$;

revoke all on function private.normalize_income_sale_lines(jsonb) from public, anon, authenticated;

create type private.income_sale_line_input as (
  income_sale_item_id uuid,
  stock_product_id uuid,
  title text,
  quantity numeric,
  unit_price numeric,
  line_total numeric,
  sequence_no integer
);

create or replace function private.sync_income_sale_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_operation text := payload->>'operation';
  v_expected_revision integer;
  v_client_temp_id text := payload->>'clientTempId';
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
  v_idempotency_key text := payload->>'idempotencyKey';
  v_bill_option text := payload->>'billOption';
  v_row public.income_expense%rowtype;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;
  v_internal_bypass boolean;
  v_line_count integer;
  v_total numeric;
  v_title text;
  v_keyword_id uuid;
  v_threshold numeric;
  v_threshold_scope text;
  v_date text;
  v_next_seq integer;
  v_server_bill_no text;
  v_product_id uuid;
  v_current_balance numeric;
  v_old_quantity numeric;
  v_new_quantity numeric;
  v_lines_json jsonb;
  v_lines private.income_sale_line_input[];
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;
  if coalesce(v_client_temp_id, '') = '' or coalesce(v_idempotency_key, '') = '' or v_location_id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ข้อมูลระบุตัวบิลขายไม่ครบ');
  end if;

  v_expected_revision := nullif(payload->>'expectedRevisionNo', '')::integer;
  v_internal_bypass := coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true';

  perform pg_advisory_xact_lock(hashtext('income_expense:' || v_client_temp_id));
  select *
    into v_row
  from public.income_expense
  where client_temp_id = v_client_temp_id
  for update;

  if v_row.id is not null then
    if v_row.bill_option <> 'บิลขาย' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการเดิมไม่ใช่บิลขาย');
    end if;
    if v_row.location_id <> v_location_id then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่สามารถย้ายบิลขายข้ามสาขาได้');
    end if;
  end if;
  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_row.id is not null and v_idempotency_key = v_row.idempotency_key then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', line.id,
        'incomeSaleItemId', line.income_sale_item_id,
        'stockProductId', line.stock_product_id,
        'title', line.title,
        'quantity', line.quantity,
        'unitPrice', line.unit_price,
        'lineTotal', line.line_total,
        'sequenceNo', line.sequence_no
      ) order by line.sequence_no
    ), '[]'::jsonb)
      into v_lines_json
    from public.income_expense_sale_lines line
    where line.income_expense_id = v_row.id;

    return jsonb_build_object(
      'status', 'synced',
      'id', v_row.id,
      'serverBillNo', v_row.server_bill_no,
      'revisionNo', v_row.revision_no,
      'serverReceivedAt', v_row.server_received_at,
      'title', v_row.title,
      'cost', v_row.cost,
      'saleLineCount', jsonb_array_length(v_lines_json),
      'saleLines', v_lines_json
    );
  end if;

  if v_operation = 'create' and v_row.id is not null then
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
  end if;
  if v_operation in ('update', 'delete') and v_row.id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
  end if;
  if v_row.id is not null then
    if v_row.record_status <> 'active' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'บิลขายนี้ถูกลบแล้ว');
    end if;
    if v_row.revision_no <> coalesce(v_expected_revision, v_row.revision_no) then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
    end if;
  end if;

  if v_operation <> 'delete' and v_bill_option <> 'บิลขาย' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่สามารถเปลี่ยนประเภทบิลขายได้');
  end if;
  if v_operation <> 'delete' and payload->>'type' <> 'income' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องเป็นรายรับ');
  end if;

  if v_operation = 'delete' then
    select array_agg(row(
      line.income_sale_item_id,
      line.stock_product_id,
      line.title,
      line.quantity,
      line.unit_price,
      line.line_total,
      line.sequence_no
    )::private.income_sale_line_input order by line.sequence_no)
      into v_lines
    from public.income_expense_sale_lines line
    where line.income_expense_id = v_row.id;
  else
    if jsonb_typeof(payload->'saleLines') <> 'array' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องมีรายการสินค้า');
    end if;
    v_line_count := jsonb_array_length(payload->'saleLines');
    if v_line_count < 1 or v_line_count > 50 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องมี 1 ถึง 50 รายการ');
    end if;

    select array_agg(row(
      line.income_sale_item_id,
      line.stock_product_id,
      line.title,
      line.quantity,
      line.unit_price,
      line.line_total,
      line.sequence_no
    )::private.income_sale_line_input order by line.sequence_no)
      into v_lines
    from private.normalize_income_sale_lines(payload) line;

    if coalesce(cardinality(v_lines), 0) <> v_line_count then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการบิลขายไม่ตรงกับสินค้าที่เปิดใช้งาน');
    end if;
    if exists (
      select 1
      from unnest(v_lines) line
      where quantity <= 0
         or quantity <> trunc(quantity)
         or unit_price <= 0
         or unit_price <> round(unit_price, 2)
    ) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนต้องเป็นจำนวนเต็มมากกว่า 0 และราคามีทศนิยมไม่เกิน 2 ตำแหน่ง');
    end if;
  end if;

  select count(*)::integer, coalesce(sum(line_total), 0)
    into v_line_count, v_total
  from unnest(v_lines);
  v_title := 'บิลขาย — ' || v_line_count::text || ' รายการ';

  if not v_internal_bypass then
    select keyword.id
      into v_keyword_id
    from public.income_expense_approval_keywords keyword
    where keyword.is_active = true
      and keyword.deleted_at is null
      and keyword.applies_to in ('income', 'both')
      and (keyword.approval_min_amount is null or v_total >= keyword.approval_min_amount)
      and exists (
        select 1
        from unnest(v_lines) line
        where (keyword.match_mode = 'exact' and lower(trim(line.title)) = lower(trim(keyword.keyword)))
           or (keyword.match_mode = 'contains' and position(lower(trim(keyword.keyword)) in lower(trim(line.title))) > 0)
      )
    order by length(keyword.keyword) desc, keyword.created_at
    limit 1;

    select approval_min_amount, applies_to
      into v_threshold, v_threshold_scope
    from public.income_expense_approval_settings
    where id = true;

    if v_keyword_id is not null
       or (
         v_threshold is not null
         and v_total >= v_threshold
         and coalesce(v_threshold_scope, 'both') in ('income', 'both')
       ) then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'บิลขายนี้ต้องขออนุมัติ ไม่สามารถซิงก์โดยตรงได้');
    end if;
  end if;

  if v_operation in ('create', 'update') then
    for v_product_id in
      select product_id
      from (
        select distinct stock_product_id as product_id from unnest(v_lines)
        union
        select distinct line.stock_product_id
        from public.income_expense_sale_lines line
        where line.income_expense_id = v_row.id
      ) products
      order by product_id
    loop
      perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_location_id::text || ':' || v_product_id::text));

      v_current_balance := public.get_stock_balance(v_location_id, v_product_id);
      select coalesce(sum(quantity), 0)
        into v_old_quantity
      from public.income_expense_sale_lines
      where income_expense_id = v_row.id
        and stock_product_id = v_product_id;
      select coalesce(sum(quantity), 0)
        into v_new_quantity
      from unnest(v_lines)
      where stock_product_id = v_product_id;

      if v_current_balance + v_old_quantity - v_new_quantity < 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกสินค้าไม่พอสำหรับบิลขาย');
      end if;
    end loop;
  end if;

  if v_internal_bypass and nullif(payload->>'createdByUserId', '') is not null then
    v_created_by_user_id := (payload->>'createdByUserId')::uuid;
    select name, phone
      into v_created_by_name, v_created_by_phone
    from public.profiles
    where id = v_created_by_user_id;
    v_created_by_name := coalesce(nullif(payload->>'createdByName', ''), v_created_by_name, '');
    v_created_by_phone := coalesce(nullif(payload->>'createdByPhone', ''), v_created_by_phone, '');
  else
    v_created_by_user_id := auth.uid();
    select name, phone
      into v_created_by_name, v_created_by_phone
    from public.profiles
    where id = v_created_by_user_id;
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
    where id = v_row.id
    returning * into v_row;
  elsif v_operation = 'create' then
    v_date := to_char((payload->>'txDate')::date, 'YYMMDD');
    perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));
    select count(*) + 1
      into v_next_seq
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
      v_client_temp_id, v_idempotency_key, 1, 'synced', 'active',
      v_location_id, 'income', v_server_bill_no, payload->>'localBillNo', v_server_bill_no,
      (payload->>'txDate')::date, v_title, v_total, null, null, 'บิลขาย',
      null, null, null,
      (payload->>'clientRecordedAt')::timestamptz,
      (payload->>'clientCreatedAt')::timestamptz,
      now(),
      v_created_by_user_id, coalesce(v_created_by_name, ''), coalesce(v_created_by_phone, '')
    )
    returning * into v_row;
  else
    update public.income_expense
    set tx_date = (payload->>'txDate')::date,
        title = v_title,
        cost = v_total,
        unit = null,
        price = null,
        income_sale_item_id = null,
        stock_product_id = null,
        stock_quantity = null,
        client_recorded_at = (payload->>'clientRecordedAt')::timestamptz,
        revision_no = revision_no + 1,
        idempotency_key = v_idempotency_key,
        server_received_at = now()
    where id = v_row.id
    returning * into v_row;
  end if;

  if v_operation in ('create', 'update') then
    delete from public.income_expense_sale_lines
    where income_expense_id = v_row.id;

    insert into public.income_expense_sale_lines (
      income_expense_id, income_sale_item_id, stock_product_id,
      title, quantity, unit_price, line_total, sequence_no
    )
    select
      v_row.id, income_sale_item_id, stock_product_id,
      title, quantity, unit_price, line_total, sequence_no
    from unnest(v_lines)
    order by sequence_no;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', line.id,
      'incomeSaleItemId', line.income_sale_item_id,
      'stockProductId', line.stock_product_id,
      'title', line.title,
      'quantity', line.quantity,
      'unitPrice', line.unit_price,
      'lineTotal', line.line_total,
      'sequenceNo', line.sequence_no
    ) order by line.sequence_no
  ), '[]'::jsonb)
    into v_lines_json
  from public.income_expense_sale_lines line
  where line.income_expense_id = v_row.id;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_row.id,
    'serverBillNo', v_row.server_bill_no,
    'revisionNo', v_row.revision_no,
    'serverReceivedAt', v_row.server_received_at,
    'title', v_row.title,
    'cost', v_row.cost,
    'saleLineCount', jsonb_array_length(v_lines_json),
    'saleLines', v_lines_json
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function private.sync_income_sale_bill(jsonb) from public, anon, authenticated;

create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_existing_bill_option text;
begin
  if payload->>'operation' in ('update', 'delete') then
    select bill_option
      into v_existing_bill_option
    from public.income_expense
    where client_temp_id = payload->>'clientTempId';
  end if;

  if payload->>'billOption' = 'บิลขาย' or v_existing_bill_option = 'บิลขาย' then
    return private.sync_income_sale_bill(payload);
  end if;
  if jsonb_typeof(payload->'saleLines') = 'array'
     and jsonb_array_length(payload->'saleLines') > 0 then
    return jsonb_build_object(
      'status', 'failed',
      'errorMessage', 'รายการที่ไม่ใช่บิลขายต้องไม่มีรายการสินค้า'
    );
  end if;
  return public.sync_income_expense_core(payload);
end;
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;

create or replace function public.create_income_expense_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_operation text := payload->>'operation';
  v_base_request_key text := payload->>'idempotencyKey';
  v_request_key text;
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
  v_type text := payload->>'type';
  v_bill_option text := payload->>'billOption';
  v_title text;
  v_cost numeric;
  v_existing public.income_expense%rowtype;
  v_line_count integer;
  v_keyword_id uuid;
  v_keyword text;
  v_amount_match boolean;
  v_threshold numeric;
  v_threshold_scope text;
  v_existing_id uuid;
  v_existing_status text;
  v_user_id uuid;
  v_user_name text;
  v_user_phone text;
  v_request_id uuid;
  v_reason text;
  v_sale_lines_json jsonb;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;
  if coalesce(v_base_request_key, '') = '' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Missing idempotency key');
  end if;

  if v_operation in ('update', 'delete') then
    select *
      into v_existing
    from public.income_expense
    where client_temp_id = payload->>'clientTempId';
    if v_existing.id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการรับ-จ่าย');
    end if;
    if v_existing.record_status <> 'active' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'รายการนี้ถูกลบแล้ว');
    end if;
    if v_location_id is distinct from v_existing.location_id then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่สามารถย้ายรายการรับ-จ่ายข้ามสาขาได้');
    end if;
    if v_operation = 'update' and v_bill_option is distinct from v_existing.bill_option then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่สามารถเปลี่ยนรูปแบบของรายการที่บันทึกแล้ว');
    end if;
    v_location_id := v_existing.location_id;
    v_type := v_existing.type::text;
    if v_operation = 'delete' then
      v_bill_option := v_existing.bill_option;
    end if;
  end if;

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_bill_option = 'บิลขาย' then
    if v_operation = 'delete' then
      select
        count(*)::integer,
        coalesce(sum(line.line_total), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'id', line.id,
          'incomeSaleItemId', line.income_sale_item_id,
          'stockProductId', line.stock_product_id,
          'title', line.title,
          'quantity', line.quantity,
          'unitPrice', line.unit_price,
          'lineTotal', line.line_total,
          'sequenceNo', line.sequence_no
        ) order by line.sequence_no), '[]'::jsonb)
        into v_line_count, v_cost, v_sale_lines_json
      from public.income_expense_sale_lines line
      where line.income_expense_id = v_existing.id;
    else
      if jsonb_typeof(payload->'saleLines') <> 'array' then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องมีรายการสินค้า');
      end if;
      v_line_count := jsonb_array_length(payload->'saleLines');
      if v_line_count < 1 or v_line_count > 50 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องมี 1 ถึง 50 รายการ');
      end if;
      if (select count(*) from private.normalize_income_sale_lines(payload)) <> v_line_count then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการบิลขายไม่ตรงกับสินค้าที่เปิดใช้งาน');
      end if;
      if exists (
        select 1 from private.normalize_income_sale_lines(payload)
        where quantity <= 0
           or quantity <> trunc(quantity)
           or unit_price <= 0
           or unit_price <> round(unit_price, 2)
      ) then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนต้องเป็นจำนวนเต็มมากกว่า 0 และราคามีทศนิยมไม่เกิน 2 ตำแหน่ง');
      end if;
      select
        count(*)::integer,
        coalesce(sum(line.line_total), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'incomeSaleItemId', line.income_sale_item_id,
          'stockProductId', line.stock_product_id,
          'title', line.title,
          'quantity', line.quantity,
          'unitPrice', line.unit_price,
          'lineTotal', line.line_total,
          'sequenceNo', line.sequence_no
        ) order by line.sequence_no), '[]'::jsonb)
        into v_line_count, v_cost, v_sale_lines_json
      from private.normalize_income_sale_lines(payload) line;
    end if;
    v_title := 'บิลขาย — ' || v_line_count::text || ' รายการ';
    v_type := 'income';
    payload := payload || jsonb_build_object(
      'locationId', v_location_id,
      'type', v_type,
      'billOption', 'บิลขาย',
      'title', v_title,
      'cost', v_cost,
      'saleLines', v_sale_lines_json
    );
  elsif v_operation = 'delete' then
    v_title := v_existing.title;
    v_cost := v_existing.cost;
    payload := payload || jsonb_build_object(
      'locationId', v_location_id,
      'type', v_type,
      'billOption', v_existing.bill_option,
      'title', v_title,
      'cost', v_cost
    );
  else
    v_title := trim(coalesce(payload->>'title', ''));
    v_cost := nullif(payload->>'cost', '')::numeric;
  end if;

  if v_type not in ('income', 'expense') or v_title = '' or coalesce(v_cost, 0) <= 0 then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ข้อมูลรายการหรือยอดเงินไม่ถูกต้อง');
  end if;

  select id, request_status
    into v_existing_id, v_existing_status
  from public.income_expense_approval_requests
  where requested_payload->>'idempotencyKey' = v_base_request_key
    and request_status in ('pending', 'approved')
  order by created_at desc
  limit 1;
  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'pending',
      'requestId', v_existing_id,
      'requestStatus', v_existing_status
    );
  end if;

  select setting.id, setting.keyword
    into v_keyword_id, v_keyword
  from public.income_expense_approval_keywords setting
  where setting.is_active = true
    and setting.deleted_at is null
    and setting.applies_to in (v_type, 'both')
    and (setting.approval_min_amount is null or v_cost >= setting.approval_min_amount)
    and (
      (
        v_bill_option = 'บิลขาย'
        and (
          (
            v_operation = 'delete'
            and exists (
              select 1
              from public.income_expense_sale_lines line
              where line.income_expense_id = v_existing.id
                and (
                  (setting.match_mode = 'exact' and lower(trim(line.title)) = lower(trim(setting.keyword)))
                  or (setting.match_mode = 'contains' and position(lower(trim(setting.keyword)) in lower(trim(line.title))) > 0)
                )
            )
          )
          or
          (
            v_operation <> 'delete'
            and exists (
              select 1
              from private.normalize_income_sale_lines(payload) line
              where (setting.match_mode = 'exact' and lower(trim(line.title)) = lower(trim(setting.keyword)))
                 or (setting.match_mode = 'contains' and position(lower(trim(setting.keyword)) in lower(trim(line.title))) > 0)
            )
          )
        )
      )
      or
      (
        v_bill_option <> 'บิลขาย'
        and (
          (setting.match_mode = 'exact' and lower(trim(v_title)) = lower(trim(setting.keyword)))
          or (setting.match_mode = 'contains' and position(lower(trim(setting.keyword)) in lower(trim(v_title))) > 0)
        )
      )
    )
  order by length(setting.keyword) desc, setting.created_at
  limit 1;

  select approval_min_amount, applies_to
    into v_threshold, v_threshold_scope
  from public.income_expense_approval_settings
  where id = true;
  v_amount_match := v_threshold is not null
    and v_cost >= v_threshold
    and coalesce(v_threshold_scope, 'both') in (v_type, 'both');

  if v_keyword_id is null and not v_amount_match then
    return jsonb_build_object('status', 'no_approval');
  end if;

  v_reason := case
    when v_keyword_id is not null and v_amount_match then 'keyword_and_amount'
    when v_amount_match then 'amount_threshold'
    else 'keyword'
  end;
  v_request_key := v_base_request_key;
  if exists (
    select 1 from public.income_expense_approval_requests
    where request_idempotency_key = v_request_key
  ) then
    v_request_key := v_base_request_key || ':retry:' || gen_random_uuid()::text;
  end if;

  v_user_id := auth.uid();
  select name, phone
    into v_user_name, v_user_phone
  from public.profiles
  where id = v_user_id;

  insert into public.income_expense_approval_requests (
    requested_operation, request_idempotency_key, requested_payload,
    source_income_expense_id, matched_keyword_id, matched_keyword, matched_reason,
    location_id, tx_type, title, cost,
    requested_by_user_id, requested_by_name, requested_by_phone
  ) values (
    v_operation, v_request_key, payload,
    v_existing.id, v_keyword_id, v_keyword, v_reason,
    v_location_id, v_type, v_title, v_cost,
    v_user_id, coalesce(v_user_name, ''), coalesce(v_user_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending',
    'requestId', v_request_id,
    'matchedReason', v_reason,
    'matchedKeyword', v_keyword
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.create_income_expense_approval_request(jsonb) from public, anon;
grant execute on function public.create_income_expense_approval_request(jsonb) to authenticated;

create or replace view public.acid_stock_movements
with (security_invoker = true)
as
select
  ('stock-entry:' || entry.id::text) as movement_id,
  'stock_entry'::text as source_type,
  entry.id as source_id,
  null::uuid as source_line_id,
  entry.tx_date,
  entry.location_id,
  entry.product_id,
  entry.product_name,
  entry.quantity_delta,
  entry.amount::numeric(12, 2) as amount,
  coalesce(entry.server_bill_no, entry.transfer_bill_no, entry.id::text) as display_bill_no,
  entry.tx_type,
  entry.created_by_user_id,
  entry.created_by_name,
  entry.created_by_phone,
  entry.created_at,
  null::text as relation_lock_reason
from public.stock_entries entry
where entry.record_status = 'active'

union all

select
  ('income-sale:' || line.id::text) as movement_id,
  'income_sale'::text as source_type,
  bill.id as source_id,
  line.id as source_line_id,
  bill.tx_date,
  bill.location_id,
  line.stock_product_id as product_id,
  product.name as product_name,
  -abs(line.quantity) as quantity_delta,
  line.line_total::numeric(12, 2) as amount,
  coalesce(bill.server_bill_no, bill.local_bill_no, bill.id::text) as display_bill_no,
  'income_sale'::text as tx_type,
  bill.created_by_user_id,
  bill.created_by_name,
  bill.created_by_phone,
  line.created_at,
  'รายการนี้มาจากบิลขาย ต้องแก้ไขหรือลบที่โมดูลรับ-จ่าย'::text as relation_lock_reason
from public.income_expense_sale_lines line
join public.income_expense bill on bill.id = line.income_expense_id
join public.stock_products product on product.id = line.stock_product_id
where bill.record_status = 'active'
  and bill.type = 'income'
  and bill.bill_option = 'บิลขาย'

union all

select
  ('rubber-bill-stock:' || item.id::text) as movement_id,
  'rubber_bill_stock_deduction'::text as source_type,
  bill.id as source_id,
  item.id as source_line_id,
  bill.bill_date as tx_date,
  bill.location_id,
  item.stock_product_id as product_id,
  product.name as product_name,
  -abs(item.quantity) as quantity_delta,
  item.total::numeric(12, 2) as amount,
  coalesce(bill.server_bill_no, bill.local_bill_no, bill.id::text) as display_bill_no,
  'rubber_bill_stock_deduction'::text as tx_type,
  bill.created_by_user_id,
  bill.created_by_name,
  bill.created_by_phone,
  item.created_at,
  'รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยาง'::text as relation_lock_reason
from public.rubber_bill_items item
join public.rubber_bills bill on bill.id = item.bill_id
join public.stock_products product on product.id = item.stock_product_id
where bill.record_status = 'active'
  and item.item_type in ('acid', 'stock_deduction')
  and item.stock_product_id is not null
  and coalesce(item.quantity, 0) > 0;

grant select on public.acid_stock_movements to authenticated, service_role;
