-- Fix local DB: close direct DELETE path, force RPC-only, lock search_path

-- 1. Drop the direct delete policy (was applied by earlier migration edit)
drop policy if exists "Allow super_admin to delete" on public.income_sale_items;

-- 2. Revoke DELETE privilege from authenticated (force RPC-only)
revoke delete on table public.income_sale_items from authenticated;

-- 3. Recreate RPC with search_path locked
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
  if not public.is_super_admin() then
    raise exception 'Permission denied: only super_admin can delete sale items';
  end if;

  select name into item_name
  from public.income_sale_items
  where id = item_id;

  if item_name is null then
    raise exception 'Item not found';
  end if;

  select count(*) into usage_count
  from public.income_expense
  where title = item_name
    and bill_option = 'บิลขาย'
    and record_status != 'deleted';

  if usage_count > 0 then
    raise exception 'ไม่สามารถลบได้ เพราะมีรายการรายรับที่ใช้ "%" อยู่ % รายการ', item_name, usage_count;
  end if;

  delete from public.income_sale_items where id = item_id;
end;
$$;

grant execute on function public.delete_income_sale_item(uuid) to authenticated;
