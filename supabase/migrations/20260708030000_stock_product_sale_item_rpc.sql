create or replace function public.create_stock_product_with_sale_item(payload jsonb)
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
  v_name text;
  v_name_key text;
  v_unit text;
  v_create_sale_item boolean;
  v_product public.acid_products%rowtype;
  v_active_sale_item public.income_sale_items%rowtype;
  v_sale_item public.income_sale_items%rowtype;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่มีสิทธิ์เพิ่มสินค้า');
  end if;

  v_name := btrim(coalesce(payload->>'name', ''));
  v_name_key := lower(v_name);
  v_unit := nullif(btrim(coalesce(payload->>'unit', '')), '');
  v_create_sale_item := coalesce((payload->>'createSaleItem')::boolean, false);

  if v_name = '' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'กรุณาระบุชื่อสินค้า');
  end if;

  perform pg_advisory_xact_lock(hashtext('stock-product:' || v_name_key));

  if exists (
    select 1
    from public.acid_products
    where lower(btrim(name)) = v_name_key
  ) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'มีสินค้านี้ในสต็อกแล้ว');
  end if;

  if v_create_sale_item then
    select *
      into v_active_sale_item
    from public.income_sale_items
    where lower(btrim(name)) = v_name_key
      and is_active = true
    order by created_at desc
    limit 1;

    if v_active_sale_item.id is not null
       and v_active_sale_item.stock_product_id is not null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการขายชื่อนี้ผูกกับสินค้าอื่นแล้ว');
    end if;
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  insert into public.acid_products (
    name, unit, created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_name,
    coalesce(v_unit, 'ชิ้น'),
    v_created_by_user_id,
    coalesce(v_created_by_name, ''),
    v_created_by_phone
  )
  returning * into v_product;

  if v_create_sale_item then
    if v_active_sale_item.id is not null then
      update public.income_sale_items
      set stock_product_id = v_product.id,
          updated_at = now()
      where id = v_active_sale_item.id
      returning * into v_sale_item;
    else
      select *
        into v_sale_item
      from public.income_sale_items
      where lower(btrim(name)) = v_name_key
        and is_active = false
      order by created_at desc
      limit 1;

      if v_sale_item.id is not null then
        update public.income_sale_items
        set stock_product_id = v_product.id,
            is_active = true,
            deleted_at = null,
            deleted_by_user_id = null,
            updated_at = now()
        where id = v_sale_item.id
        returning * into v_sale_item;
      else
        insert into public.income_sale_items (
          name, stock_product_id, created_by_user_id, created_by_name, created_by_phone
        ) values (
          v_product.name,
          v_product.id,
          v_created_by_user_id,
          coalesce(v_created_by_name, ''),
          v_created_by_phone
        )
        returning * into v_sale_item;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'product', jsonb_build_object(
      'id', v_product.id,
      'name', v_product.name,
      'unit', v_product.unit,
      'is_active', v_product.is_active,
      'created_by_name', v_product.created_by_name,
      'created_by_phone', v_product.created_by_phone,
      'created_at', v_product.created_at
    ),
    'saleItem', case
      when v_sale_item.id is null then null
      else jsonb_build_object(
        'id', v_sale_item.id,
        'name', v_sale_item.name,
        'stock_product_id', v_sale_item.stock_product_id,
        'is_active', v_sale_item.is_active,
        'created_by_name', v_sale_item.created_by_name,
        'created_by_phone', v_sale_item.created_by_phone,
        'created_at', v_sale_item.created_at
      )
    end
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', 'เพิ่มสินค้าไม่สำเร็จ: ' || sqlerrm);
end;
$$;

revoke all on function public.create_stock_product_with_sale_item(jsonb) from public, anon;
grant execute on function public.create_stock_product_with_sale_item(jsonb) to authenticated;
