-- Acid stock is a source-linked ledger:
-- stock-owned entries are stored here, while sales and rubber bill deductions
-- are derived from their source modules through acid_products.id.

create table if not exists public.acid_products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'ถัง',
  is_active boolean not null default true,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text,
  created_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.acid_products (name, unit)
values
  ('น้ำกรดตราเสือไฟท์', 'แพ็ค'),
  ('น้ำกรดตรามังกรไฟท์', 'แพ็ค')
on conflict (name) do nothing;

create table if not exists public.acid_stock_entries (
  id uuid primary key default gen_random_uuid(),
  server_bill_no text,
  tx_date date not null,
  product_id uuid not null references public.acid_products(id),
  product_name text not null,
  quantity_delta numeric(12,2) not null,
  amount numeric(12,2) not null default 0,
  location_id uuid not null references public.locations(id),
  tx_type text not null check (tx_type in ('receive', 'transfer_out', 'transfer_in')),
  transfer_bill_no text,
  record_status record_status not null default 'active',
  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null,
  created_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_name text,
  deleted_by_phone text
);

create index if not exists idx_acid_stock_entries_location_active
  on public.acid_stock_entries(location_id, tx_date desc)
  where record_status = 'active';

create index if not exists idx_acid_stock_entries_product_location
  on public.acid_stock_entries(product_id, location_id);

alter table public.income_sale_items
  add column if not exists stock_product_id uuid references public.acid_products(id);

alter table public.income_expense
  add column if not exists income_sale_item_id uuid references public.income_sale_items(id),
  add column if not exists stock_product_id uuid references public.acid_products(id),
  add column if not exists stock_quantity numeric(12,2);

alter table public.rubber_bill_items
  add column if not exists stock_product_id uuid references public.acid_products(id);

update public.income_sale_items i
set stock_product_id = p.id
from public.acid_products p
where i.stock_product_id is null
  and lower(trim(i.name)) = lower(trim(p.name));

alter table public.acid_products enable row level security;
alter table public.acid_stock_entries enable row level security;

drop policy if exists "acid_products_active_read" on public.acid_products;
drop policy if exists "acid_products_system_manager_read" on public.acid_products;
drop policy if exists "acid_products_system_manager_insert" on public.acid_products;
drop policy if exists "acid_products_system_manager_update" on public.acid_products;

create policy "acid_products_active_read"
  on public.acid_products for select to authenticated
  using (is_active = true);

create policy "acid_products_system_manager_read"
  on public.acid_products for select to authenticated
  using (public.can_access_super_admin_features());

create policy "acid_products_system_manager_insert"
  on public.acid_products for insert to authenticated
  with check (public.can_access_super_admin_features());

create policy "acid_products_system_manager_update"
  on public.acid_products for update to authenticated
  using (public.can_access_super_admin_features())
  with check (public.can_access_super_admin_features());

drop policy if exists "acid_stock_entries_location_read" on public.acid_stock_entries;

create policy "acid_stock_entries_location_read"
  on public.acid_stock_entries for select to authenticated
  using (public.can_access_location(location_id));

revoke all on table public.acid_products from anon, authenticated;
revoke all on table public.acid_stock_entries from anon, authenticated;
grant select, insert, update on table public.acid_products to authenticated;
grant select on table public.acid_stock_entries to authenticated;
grant all privileges on table public.acid_products to service_role;
grant all privileges on table public.acid_stock_entries to service_role;

create or replace view public.acid_stock_movements
with (security_invoker = true)
as
select
  ('stock-entry:' || e.id::text) as movement_id,
  'stock_entry'::text as source_type,
  e.id as source_id,
  null::uuid as source_line_id,
  e.tx_date,
  e.location_id,
  e.product_id,
  e.product_name,
  e.quantity_delta,
  e.amount,
  coalesce(e.server_bill_no, e.transfer_bill_no, e.id::text) as display_bill_no,
  e.tx_type,
  e.created_by_user_id,
  e.created_by_name,
  e.created_by_phone,
  e.created_at,
  null::text as relation_lock_reason
from public.acid_stock_entries e
where e.record_status = 'active'

union all

select
  ('income-sale:' || ie.id::text) as movement_id,
  'income_sale'::text as source_type,
  ie.id as source_id,
  null::uuid as source_line_id,
  ie.tx_date,
  ie.location_id,
  ie.stock_product_id as product_id,
  p.name as product_name,
  -abs(ie.stock_quantity) as quantity_delta,
  ie.cost as amount,
  coalesce(ie.server_bill_no, ie.local_bill_no, ie.id::text) as display_bill_no,
  'income_sale'::text as tx_type,
  ie.created_by_user_id,
  ie.created_by_name,
  ie.created_by_phone,
  ie.created_at,
  'รายการนี้มาจากบิลขาย ต้องแก้ไขหรือลบที่โมดูลรับ-จ่าย'::text as relation_lock_reason
from public.income_expense ie
join public.acid_products p on p.id = ie.stock_product_id
where ie.record_status = 'active'
  and ie.type = 'income'
  and ie.bill_option = 'บิลขาย'
  and ie.stock_product_id is not null
  and coalesce(ie.stock_quantity, 0) > 0

union all

select
  ('rubber-bill-stock:' || i.id::text) as movement_id,
  'rubber_bill_stock_deduction'::text as source_type,
  b.id as source_id,
  i.id as source_line_id,
  b.bill_date as tx_date,
  b.location_id,
  i.stock_product_id as product_id,
  p.name as product_name,
  -abs(i.quantity) as quantity_delta,
  i.total as amount,
  coalesce(b.server_bill_no, b.local_bill_no, b.id::text) as display_bill_no,
  'rubber_bill_stock_deduction'::text as tx_type,
  b.created_by_user_id,
  b.created_by_name,
  b.created_by_phone,
  i.created_at,
  'รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยาง'::text as relation_lock_reason
from public.rubber_bill_items i
join public.rubber_bills b on b.id = i.bill_id
join public.acid_products p on p.id = i.stock_product_id
where b.record_status = 'active'
  and i.item_type in ('acid', 'stock_deduction')
  and i.stock_product_id is not null
  and coalesce(i.quantity, 0) > 0;

grant select on public.acid_stock_movements to authenticated;
grant select on public.acid_stock_movements to service_role;

create or replace function public.get_acid_stock_balance(p_location_id uuid, p_product_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;

  select coalesce(sum(quantity_delta), 0)
    into v_balance
  from public.acid_stock_movements
  where location_id = p_location_id
    and product_id = p_product_id;

  return coalesce(v_balance, 0);
end;
$$;

revoke all on function public.get_acid_stock_balance(uuid, uuid) from public, anon;
grant execute on function public.get_acid_stock_balance(uuid, uuid) to authenticated;

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
  v_location_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_tx_date date;
  v_quantity numeric;
  v_amount numeric;
  v_date text;
  v_next_seq integer;
  v_server_bill_no text;
  v_entry_id uuid;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  v_location_id := (payload->>'locationId')::uuid;
  v_product_id := (payload->>'productId')::uuid;
  v_tx_date := (payload->>'txDate')::date;
  v_quantity := (payload->>'quantity')::numeric;
  v_amount := coalesce(nullif(payload->>'amount', '')::numeric, 0);

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_quantity is null or v_quantity <= 0 then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนรับเข้าต้องมากกว่า 0');
  end if;

  select name into v_product_name
  from public.acid_products
  where id = v_product_id
    and is_active = true;

  if v_product_name is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
  end if;

  v_date := to_char(v_tx_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext(v_location_id::text || ':acid-receive:' || v_date));

  select count(*) + 1 into v_next_seq
  from public.acid_stock_entries
  where location_id = v_location_id
    and tx_date = v_tx_date
    and tx_type = 'receive'
    and server_bill_no is not null;

  v_server_bill_no := 'AS-' || v_date || '-' || lpad(v_next_seq::text, 4, '0');

  insert into public.acid_stock_entries (
    server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_server_bill_no, v_tx_date, v_product_id, v_product_name, v_quantity,
    v_amount, v_location_id, 'receive', v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning id into v_entry_id;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_entry_id,
    'serverBillNo', v_server_bill_no,
    'serverReceivedAt', now()
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
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

  if not exists (select 1 from public.locations where id = v_to_location_id and active = true) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสาขาปลายทาง');
  end if;

  if v_quantity is null or v_quantity <= 0 then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนย้ายต้องมากกว่า 0');
  end if;

  select name into v_product_name
  from public.acid_products
  where id = v_product_id
    and is_active = true;

  if v_product_name is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
  end if;

  perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_from_location_id::text || ':' || v_product_id::text));
  perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_to_location_id::text || ':' || v_product_id::text));

  v_balance := public.get_acid_stock_balance(v_from_location_id, v_product_id);
  if v_balance < v_quantity then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกไม่พอสำหรับย้ายสินค้า');
  end if;

  v_date := to_char(v_tx_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext('acid-transfer:' || v_date));

  select count(*) + 1 into v_next_seq
  from public.acid_stock_entries
  where tx_date = v_tx_date
    and transfer_bill_no is not null;

  v_transfer_bill_no := 'AT-' || v_date || '-' || lpad(v_next_seq::text, 4, '0');

  insert into public.acid_stock_entries (
    server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, transfer_bill_no,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_transfer_bill_no, v_tx_date, v_product_id, v_product_name, -abs(v_quantity),
    0, v_from_location_id, 'transfer_out', v_transfer_bill_no,
    v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning id into v_out_id;

  insert into public.acid_stock_entries (
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

create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $block$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
  v_record_status record_status;
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
  v_record_status := (payload->>'recordStatus')::record_status;
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
$block$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;

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

        if not exists (select 1 from public.acid_products where id = v_stock_product_id and is_active = true) then
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
      perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_location_id::text || ':' || v_stock_row.product_id::text));
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
        server_received_at = now()
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
      coalesce(v_created_by_name, ''),
      coalesce(v_created_by_phone, '')
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

    delete from public.rubber_bill_items where bill_id = v_bill_id;

    for v_item in select * from jsonb_array_elements(payload->'items')
    loop
      insert into public.rubber_bill_items (
        bill_id, item_type, description,
        weight_in, weight_out, net_weight,
        quantity, unit, price, total, stock_product_id
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
        (v_item->>'totalAmount')::numeric,
        nullif(v_item->>'stockProductId', '')::uuid
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

revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

create or replace function public.decide_income_expense_approval_request(p_request_id uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_decider_id uuid;
  v_decider_name text;
  v_decider_phone text;
  v_payload jsonb;
  v_sync_result jsonb;
  v_row_id uuid;
begin
  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้');
  end if;

  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid decision');
  end if;

  select *
    into v_request
  from public.income_expense_approval_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบคำขออนุมัติ');
  end if;

  if v_request.request_status != 'pending' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'คำขอนี้ถูกดำเนินการไปแล้ว');
  end if;

  v_decider_id := auth.uid();
  select name, phone into v_decider_name, v_decider_phone
  from public.profiles
  where id = v_decider_id;

  if p_decision = 'rejected' then
    update public.income_expense_approval_requests
    set request_status = 'rejected',
        decided_by_user_id = v_decider_id,
        decided_by_name = coalesce(v_decider_name, ''),
        decided_by_phone = coalesce(v_decider_phone, ''),
        decided_at = now(),
        decision_comment = p_comment,
        updated_at = now()
    where id = v_request.id;

    return jsonb_build_object('status', 'rejected', 'requestId', v_request.id);
  end if;

  v_payload := v_request.requested_payload;
  perform set_config('app.bypass_income_expense_approval', 'true', true);
  v_sync_result := public.sync_income_expense(v_payload);

  if coalesce(v_sync_result->>'status', 'failed') != 'synced' then
    return v_sync_result;
  end if;

  v_row_id := (v_sync_result->>'id')::uuid;

  update public.income_expense_approval_requests
  set request_status = 'approved',
      approved_income_expense_id = v_row_id,
      decided_by_user_id = v_decider_id,
      decided_by_name = coalesce(v_decider_name, ''),
      decided_by_phone = coalesce(v_decider_phone, ''),
      decided_at = now(),
      decision_comment = p_comment,
      updated_at = now()
  where id = v_request.id;

  return jsonb_build_object(
    'status', 'approved',
    'requestId', v_request.id,
    'incomeExpenseId', v_row_id
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.decide_income_expense_approval_request(uuid, text, text) from public, anon;
grant execute on function public.decide_income_expense_approval_request(uuid, text, text) to authenticated;

create or replace function public.delete_income_sale_item(item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
  usage_count bigint;
begin
  if not public.can_access_super_admin_features() then
    raise exception 'Permission denied: only system managers can delete sale items';
  end if;

  select name into item_name
  from public.income_sale_items
  where id = item_id;

  if item_name is null then
    raise exception 'Item not found';
  end if;

  select count(*) into usage_count
  from public.income_expense
  where income_sale_item_id = item_id
    and bill_option = 'บิลขาย'
    and record_status != 'deleted';

  if usage_count > 0 then
    raise exception 'ไม่สามารถลบได้ เพราะมีรายการรายรับที่ใช้ "%" อยู่ % รายการ', item_name, usage_count;
  end if;

  delete from public.income_sale_items where id = item_id;
end;
$$;

revoke all on function public.delete_income_sale_item(uuid) from public, anon;
grant execute on function public.delete_income_sale_item(uuid) to authenticated;
