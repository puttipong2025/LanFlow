-- Rename the physical stock tables to match the business module name.
-- Keep acid_* compatibility views/functions so older RPC bodies in previous
-- migrations keep working during the transition.

alter table if exists public.acid_products rename to stock_products;
alter table if exists public.acid_stock_entries rename to stock_entries;

alter index if exists idx_acid_stock_entries_location_active rename to idx_stock_entries_location_active;
alter index if exists idx_acid_stock_entries_product_location rename to idx_stock_entries_product_location;

alter table if exists public.stock_products rename constraint acid_products_pkey to stock_products_pkey;
alter table if exists public.stock_entries rename constraint acid_stock_entries_pkey to stock_entries_pkey;

revoke all on table public.stock_products from anon, authenticated;
revoke all on table public.stock_entries from anon, authenticated;
grant select, insert, update on table public.stock_products to authenticated;
grant select on table public.stock_entries to authenticated;
grant all privileges on table public.stock_products to service_role;
grant all privileges on table public.stock_entries to service_role;

create or replace view public.acid_products
with (security_invoker = true)
as
select * from public.stock_products;

create or replace view public.acid_stock_entries
with (security_invoker = true)
as
select * from public.stock_entries;

revoke all on public.acid_products from anon, authenticated;
revoke all on public.acid_stock_entries from anon, authenticated;
grant select on public.acid_products to authenticated;
grant select on public.acid_stock_entries to authenticated;

create or replace view public.stock_movements
with (security_invoker = true)
as
select * from public.acid_stock_movements;

grant select on public.stock_movements to authenticated;
grant select on public.stock_movements to service_role;

create or replace function public.get_stock_balance(p_location_id uuid, p_product_id uuid)
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(quantity_delta), 0)
  from public.stock_movements
  where location_id = p_location_id
    and product_id = p_product_id;
$$;

revoke all on function public.get_stock_balance(uuid, uuid) from public, anon;
grant execute on function public.get_stock_balance(uuid, uuid) to authenticated;

create or replace function public.sync_stock_entry(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.sync_acid_stock_entry(payload);
end;
$$;

revoke all on function public.sync_stock_entry(jsonb) from public, anon;
grant execute on function public.sync_stock_entry(jsonb) to authenticated;

create or replace function public.transfer_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.transfer_acid_stock(payload);
end;
$$;

revoke all on function public.transfer_stock(jsonb) from public, anon;
grant execute on function public.transfer_stock(jsonb) to authenticated;

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
  v_product public.stock_products%rowtype;
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
    from public.stock_products
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

  insert into public.stock_products (
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
