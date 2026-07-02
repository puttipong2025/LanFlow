-- Safe-delete RPC for income_sale_items
-- Delete is ONLY allowed through this function (no direct DELETE via REST)

-- Drop stale policy/grant if they exist (from prior migration edits)
drop policy if exists "Allow super_admin to delete" on public.income_sale_items;
revoke delete on table public.income_sale_items from authenticated;

-- RPC function: safe delete with usage check in a single transaction
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
  -- Check caller is super_admin
  if not public.is_super_admin() then
    raise exception 'Permission denied: only super_admin can delete sale items';
  end if;

  -- Get item name
  select name into item_name
  from public.income_sale_items
  where id = item_id;

  if item_name is null then
    raise exception 'Item not found';
  end if;

  -- Check usage in income_expense
  select count(*) into usage_count
  from public.income_expense
  where title = item_name
    and bill_option = 'บิลขาย'
    and record_status != 'deleted';

  if usage_count > 0 then
    raise exception 'ไม่สามารถลบได้ เพราะมีรายการรายรับที่ใช้ "%" อยู่ % รายการ', item_name, usage_count;
  end if;

  -- Safe to delete
  delete from public.income_sale_items where id = item_id;
end;
$$;

-- Only allow calling through RPC
grant execute on function public.delete_income_sale_item(uuid) to authenticated;
