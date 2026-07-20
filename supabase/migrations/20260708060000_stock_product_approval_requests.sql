-- Stock product changes are approval-gated.
-- Product identity changes are separate from stock movements.

create table if not exists public.stock_product_approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_status text not null default 'pending'
    check (request_status in ('pending', 'approved', 'rejected', 'cancelled')),
  request_type text not null
    check (request_type in ('create_product', 'delete_product')),
  request_idempotency_key text not null unique,
  requested_payload jsonb not null,
  product_id uuid references public.stock_products(id),
  product_name text not null,
  unit text,
  create_sale_item boolean,
  requested_by_user_id uuid not null references public.profiles(id),
  requested_by_name text not null,
  requested_by_phone text not null,
  decided_by_user_id uuid references public.profiles(id),
  decided_by_name text,
  decided_by_phone text,
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stock_product_approval_requests_status_created_idx
  on public.stock_product_approval_requests(request_status, created_at desc);

create unique index if not exists stock_product_approval_requests_pending_create_name_idx
  on public.stock_product_approval_requests(lower(trim(product_name)))
  where request_status = 'pending' and request_type = 'create_product';

create unique index if not exists stock_product_approval_requests_pending_delete_product_idx
  on public.stock_product_approval_requests(product_id)
  where request_status = 'pending' and request_type = 'delete_product';

alter table public.stock_product_approval_requests enable row level security;

drop policy if exists "stock_product_approval_requests_read" on public.stock_product_approval_requests;

create policy "stock_product_approval_requests_read"
  on public.stock_product_approval_requests for select to authenticated
  using (
    public.can_access_super_admin_features()
    or requested_by_user_id = auth.uid()
  );

revoke all on table public.stock_product_approval_requests from anon, authenticated;
grant select on table public.stock_product_approval_requests to authenticated;
grant all privileges on table public.stock_product_approval_requests to service_role;

create or replace function public.create_stock_product_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_user boolean;
  v_user_id uuid;
  v_user_name text;
  v_user_phone text;
  v_request_type text;
  v_request_key text;
  v_name text;
  v_name_key text;
  v_unit text;
  v_create_sale_item boolean;
  v_product_id uuid;
  v_product public.stock_products%rowtype;
  v_existing_id uuid;
  v_existing_status text;
  v_request_id uuid;
  v_payload jsonb;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_request_type := payload->>'requestType';
  if v_request_type not in ('create_product', 'delete_product') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid stock product request type');
  end if;

  v_request_key := nullif(payload->>'requestIdempotencyKey', '');
  if v_request_key is null then
    v_request_key := gen_random_uuid()::text;
  end if;

  select id, request_status
    into v_existing_id, v_existing_status
  from public.stock_product_approval_requests
  where request_idempotency_key = v_request_key
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'pending',
      'requestId', v_existing_id,
      'requestStatus', v_existing_status
    );
  end if;

  v_user_id := auth.uid();
  select name, phone into v_user_name, v_user_phone
  from public.profiles
  where id = v_user_id;

  if v_request_type = 'create_product' then
    v_name := btrim(coalesce(payload->>'name', ''));
    v_name_key := lower(v_name);
    v_unit := nullif(btrim(coalesce(payload->>'unit', '')), '');
    v_create_sale_item := coalesce((payload->>'createSaleItem')::boolean, false);

    if v_name = '' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'กรุณาระบุชื่อสินค้า');
    end if;

    if exists (
      select 1
      from public.stock_products
      where lower(btrim(name)) = v_name_key
    ) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'มีสินค้านี้ในสต็อกแล้ว');
    end if;

    select id, request_status
      into v_existing_id, v_existing_status
    from public.stock_product_approval_requests
    where request_status = 'pending'
      and request_type = 'create_product'
      and lower(btrim(product_name)) = v_name_key
    limit 1;

    if v_existing_id is not null then
      return jsonb_build_object(
        'status', 'pending',
        'requestId', v_existing_id,
        'requestStatus', v_existing_status
      );
    end if;

    v_payload := jsonb_build_object(
      'action', 'create_product',
      'name', v_name,
      'unit', coalesce(v_unit, 'ชิ้น'),
      'createSaleItem', v_create_sale_item
    );
  else
    v_product_id := nullif(payload->>'productId', '')::uuid;
    if v_product_id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้า');
    end if;

    select *
      into v_product
    from public.stock_products
    where id = v_product_id
    for update;

    if v_product.id is null or v_product.is_active is not true then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
    end if;

    select id, request_status
      into v_existing_id, v_existing_status
    from public.stock_product_approval_requests
    where request_status = 'pending'
      and request_type = 'delete_product'
      and product_id = v_product_id
    limit 1;

    if v_existing_id is not null then
      return jsonb_build_object(
        'status', 'pending',
        'requestId', v_existing_id,
        'requestStatus', v_existing_status
      );
    end if;

    v_name := v_product.name;
    v_unit := v_product.unit;
    v_create_sale_item := null;
    v_payload := jsonb_build_object(
      'action', 'delete_product',
      'productId', v_product_id,
      'productName', v_product.name
    );
  end if;

  insert into public.stock_product_approval_requests (
    request_type,
    request_idempotency_key,
    requested_payload,
    product_id,
    product_name,
    unit,
    create_sale_item,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  ) values (
    v_request_type,
    v_request_key,
    v_payload,
    v_product_id,
    v_name,
    v_unit,
    v_create_sale_item,
    v_user_id,
    coalesce(v_user_name, ''),
    coalesce(v_user_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending',
    'requestId', v_request_id,
    'requestType', v_request_type
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

create or replace function public.decide_stock_product_approval_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_product_approval_requests%rowtype;
  v_decider_id uuid;
  v_decider_name text;
  v_decider_phone text;
  v_result jsonb;
  v_product_id uuid;
  v_has_balance boolean;
begin
  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้');
  end if;

  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid decision');
  end if;

  select *
    into v_request
  from public.stock_product_approval_requests
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
    update public.stock_product_approval_requests
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

  if v_request.request_type = 'create_product' then
    v_result := public.create_stock_product_with_sale_item(v_request.requested_payload);
    if coalesce(v_result->>'status', 'failed') != 'synced' then
      return v_result;
    end if;

    v_product_id := (v_result->'product'->>'id')::uuid;
  elsif v_request.request_type = 'delete_product' then
    v_product_id := v_request.product_id;

    select exists (
      select 1
      from (
        select location_id, sum(quantity_delta) as balance
        from public.stock_movements
        where product_id = v_product_id
        group by location_id
      ) balances
      where abs(coalesce(balance, 0)) > 0.000001
    )
    into v_has_balance;

    if coalesce(v_has_balance, false) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'ลบสินค้าไม่ได้ เพราะยังมียอดคงเหลือในสต็อก'
      );
    end if;

    update public.stock_products
    set is_active = false,
        updated_at = now()
    where id = v_product_id
      and is_active = true;

    update public.income_sale_items
    set is_active = false,
        deleted_at = now(),
        deleted_by_user_id = v_decider_id,
        updated_at = now()
    where stock_product_id = v_product_id
      and is_active = true;
  else
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid stock product request type');
  end if;

  update public.stock_product_approval_requests
  set request_status = 'approved',
      product_id = coalesce(product_id, v_product_id),
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
    'productId', v_product_id
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.create_stock_product_approval_request(jsonb) from public, anon;
revoke all on function public.decide_stock_product_approval_request(uuid, text, text) from public, anon;
grant execute on function public.create_stock_product_approval_request(jsonb) to authenticated;
grant execute on function public.decide_stock_product_approval_request(uuid, text, text) to authenticated;
