-- Sale-bill create/update is immediate. Delete keeps the existing approval flow.
-- Stock is preflighted under transaction-scoped advisory locks so every shortage
-- is returned before the preserved dispatcher mutates the bill or stock ledger.

create or replace function private.preflight_income_sale_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
  v_existing public.income_expense%rowtype;
  v_product record;
  v_current_balance numeric;
  v_old_quantity numeric;
  v_new_quantity numeric;
  v_available numeric;
  v_shortages jsonb := '[]'::jsonb;
begin
  select * into v_existing
  from public.income_expense
  where client_temp_id = payload->>'clientTempId';

  -- An already-committed retry must return the original bill, even if stock has
  -- changed since that commit.
  if v_existing.id is not null
     and v_existing.idempotency_key = payload->>'idempotencyKey' then
    return jsonb_build_object('status', 'ok');
  end if;

  for v_product in
    select products.product_id, product.name
    from (
      select distinct line.stock_product_id as product_id
      from private.normalize_income_sale_lines(payload) line
      union
      select distinct line.stock_product_id
      from public.income_expense_sale_lines line
      where line.income_expense_id = v_existing.id
    ) products
    join public.stock_products product on product.id = products.product_id
    order by products.product_id
  loop
    perform pg_advisory_xact_lock(
      hashtext('acid-stock:' || v_location_id::text || ':' || v_product.product_id::text)
    );

    v_current_balance := public.get_stock_balance(v_location_id, v_product.product_id);
    select coalesce(sum(quantity), 0) into v_old_quantity
    from public.income_expense_sale_lines
    where income_expense_id = v_existing.id
      and stock_product_id = v_product.product_id;
    select coalesce(sum(quantity), 0) into v_new_quantity
    from private.normalize_income_sale_lines(payload)
    where stock_product_id = v_product.product_id;

    v_available := v_current_balance + v_old_quantity;
    if v_new_quantity > v_available then
      v_shortages := v_shortages || jsonb_build_array(jsonb_build_object(
        'productId', v_product.product_id,
        'productName', v_product.name,
        'requestedQuantity', v_new_quantity,
        'availableQuantity', greatest(v_available, 0)
      ));
    end if;
  end loop;

  if jsonb_array_length(v_shortages) > 0 then
    return jsonb_build_object(
      'status', 'failed',
      'errorCode', 'STOCK_SHORTAGE',
      'errorMessage', 'สินค้าในสต็อกไม่พอสำหรับบิลขาย',
      'stockShortages', v_shortages
    );
  end if;

  return jsonb_build_object('status', 'ok');
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function private.preflight_income_sale_stock(jsonb)
  from public, anon, authenticated;

-- Preserve the current approval request implementation for non-sale records and
-- sale deletes, then make sale create/update explicitly approval-free.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.create_income_expense_approval_request(jsonb)'::regprocedure
  ) into v_definition;
  v_definition := replace(
    v_definition,
    'FUNCTION public.create_income_expense_approval_request(payload jsonb)',
    'FUNCTION private.create_income_expense_approval_request_20260805080000(payload jsonb)'
  );
  if position('FUNCTION public.create_income_expense_approval_request(payload jsonb)' in v_definition) > 0 then
    raise exception 'Could not preserve income approval request implementation';
  end if;
  execute v_definition;
end;
$$;

revoke all on function private.create_income_expense_approval_request_20260805080000(jsonb)
  from public, anon, authenticated;

create or replace function public.create_income_expense_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
begin
  if payload->>'billOption' = 'บิลขาย'
     and payload->>'operation' in ('create', 'update') then
    if not coalesce(private.is_active_user(), false) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
    end if;
    if v_location_id is null or not public.can_access_location(v_location_id) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
    end if;
    return jsonb_build_object('status', 'no_approval');
  end if;

  return private.create_income_expense_approval_request_20260805080000(payload);
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.create_income_expense_approval_request(jsonb) from public, anon;
grant execute on function public.create_income_expense_approval_request(jsonb) to authenticated;

create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_approval jsonb;
  v_stock_result jsonb;
begin
  if coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true' then
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;

  if payload->>'billOption' = 'บิลขาย'
     and payload->>'operation' in ('create', 'update') then
    v_stock_result := private.preflight_income_sale_stock(payload);
    if v_stock_result->>'status' <> 'ok' then
      return v_stock_result;
    end if;
    perform set_config('app.bypass_income_expense_approval', 'true', true);
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;

  v_approval := public.create_income_expense_approval_request(payload);
  if v_approval->>'status' = 'no_approval' then
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;
  if v_approval->>'status' = 'pending' then
    return jsonb_build_object(
      'status', 'pending_approval',
      'requestId', v_approval->>'requestId',
      'matchedReasons', coalesce(v_approval->'matchedReasons', '[]'::jsonb),
      'errorMessage', 'รายการนี้ต้องรออนุมัติ'
    );
  end if;
  return v_approval;
end;
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;
