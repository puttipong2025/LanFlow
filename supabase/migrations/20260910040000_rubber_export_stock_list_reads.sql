-- Bounded, searchable list reads for Rubber Export and Stock.

drop function if exists public.get_rubber_export_page_ids(uuid, text, timestamptz, uuid, integer);

create function public.get_rubber_export_page_ids(
  p_location_id uuid,
  p_view text default 'active',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50,
  p_search text default '',
  p_subfilter text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := lower(regexp_replace(trim(coalesce(p_search, '')), '\s+', ' ', 'g'));
  v_result jsonb;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูรายการส่งออกของสาขานี้';
  end if;
  if p_view is null or p_view not in ('active', 'history') then
    raise exception 'RUBBER_EXPORT_INVALID_VIEW';
  end if;
  if p_subfilter is null
     or (p_view = 'active' and p_subfilter not in ('all', 'draft', 'verified'))
     or (p_view = 'history' and p_subfilter not in ('all', 'sold', 'received')) then
    raise exception 'RUBBER_EXPORT_INVALID_SUBFILTER';
  end if;
  if length(v_search) > 200 then
    raise exception 'RUBBER_EXPORT_SEARCH_TOO_LONG';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception 'RUBBER_EXPORT_INVALID_PAGE_SIZE';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'RUBBER_EXPORT_CURSOR_INCOMPLETE';
  end if;

  with candidates as (
    select e.id, e.created_at
    from public.rubber_exports e
    left join lateral (
      select b.id, b.server_bill_no, b.local_bill_no
      from public.rubber_bills b
      where b.source_rubber_export_id = e.id
        and b.record_status = 'active'
      order by b.created_at desc, b.id desc
      limit 1
    ) receipt on true
    where e.location_id = p_location_id
      and e.status in ('draft', 'verified')
      and case when p_view = 'active' then
        e.sold_out_at is null and receipt.id is null
      else e.sold_out_at is not null or receipt.id is not null
      end
      and case
        when p_subfilter = 'all' then true
        when p_subfilter = 'draft' then e.status = 'draft'
        when p_subfilter = 'verified' then e.status = 'verified'
        when p_subfilter = 'sold' then e.sold_out_at is not null
        when p_subfilter = 'received' then receipt.id is not null
        else false
      end
      and (
        v_search = ''
        or position(v_search in lower(concat_ws(' ',
          e.export_no,
          e.created_by_name,
          receipt.server_bill_no,
          receipt.local_bill_no
        ))) > 0
      )
      and (p_cursor_created_at is null or (e.created_at, e.id) < (p_cursor_created_at, p_cursor_id))
    order by e.created_at desc, e.id desc
    limit p_page_size + 1
  ), visible as (
    select * from candidates order by created_at desc, id desc limit p_page_size
  )
  select jsonb_build_object(
    'ids', coalesce((select jsonb_agg(id order by created_at desc, id desc) from visible), '[]'::jsonb),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextCreatedAt', (select created_at from visible order by created_at, id limit 1),
    'nextId', (select id from visible order by created_at, id limit 1)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_stock_balances(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_location_id is null or not public.can_access_location(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูสต็อกของสาขานี้';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'productId', balance.product_id,
    'name', balance.product_name,
    'unit', balance.unit,
    'balance', balance.quantity
  ) order by balance.product_name, balance.product_id), '[]'::jsonb)
  into v_result
  from (
    select
      product.id as product_id,
      product.name as product_name,
      product.unit,
      round(coalesce(sum(movement.quantity_delta), 0), 2) as quantity
    from public.stock_products product
    left join public.stock_movements movement
      on movement.product_id = product.id
     and movement.location_id = p_location_id
    where product.is_active = true
    group by product.id, product.name, product.unit
  ) balance;

  return v_result;
end;
$$;

create or replace function public.get_stock_movement_page(
  p_location_id uuid,
  p_search text default '',
  p_type text default 'all',
  p_from_date date default null,
  p_to_date date default null,
  p_cursor_tx_date date default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_movement_id text default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := lower(regexp_replace(trim(coalesce(p_search, '')), '\s+', ' ', 'g'));
  v_cursor_count integer := num_nonnulls(p_cursor_tx_date, p_cursor_created_at, p_cursor_movement_id);
  v_result jsonb;
begin
  if p_location_id is null or not public.can_access_location(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูสต็อกของสาขานี้';
  end if;
  if p_type is null or p_type not in ('all', 'receive', 'transfer', 'sale', 'rubber_bill') then
    raise exception 'STOCK_INVALID_TYPE';
  end if;
  if length(v_search) > 200 then
    raise exception 'STOCK_SEARCH_TOO_LONG';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'STOCK_INVALID_DATE_RANGE';
  end if;
  if v_cursor_count not in (0, 3) then
    raise exception 'STOCK_CURSOR_INCOMPLETE';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception 'STOCK_INVALID_PAGE_SIZE';
  end if;

  with candidates as (
    select movement.*
    from public.stock_movements movement
    where movement.location_id = p_location_id
      and (p_from_date is null or movement.tx_date >= p_from_date)
      and (p_to_date is null or movement.tx_date <= p_to_date)
      and case p_type
        when 'all' then true
        when 'receive' then movement.tx_type = 'receive'
        when 'transfer' then movement.tx_type in ('transfer_out', 'transfer_in')
        when 'sale' then movement.source_type = 'income_sale'
        when 'rubber_bill' then movement.source_type in ('rubber_bill_acid', 'rubber_bill_stock_deduction')
        else false
      end
      and (
        v_search = ''
        or position(v_search in lower(concat_ws(' ',
          movement.display_bill_no,
          movement.product_name,
          movement.created_by_name,
          movement.created_by_phone
        ))) > 0
      )
      and (
        v_cursor_count = 0
        or (movement.tx_date, movement.created_at, movement.movement_id)
          < (p_cursor_tx_date, p_cursor_created_at, p_cursor_movement_id)
      )
    order by movement.tx_date desc, movement.created_at desc, movement.movement_id desc
    limit p_page_size + 1
  ), visible as (
    select * from candidates
    order by tx_date desc, created_at desc, movement_id desc
    limit p_page_size
  ), rows as (
    select
      visible.*,
      case when visible.source_type = 'stock_entry' then public.report_lock_no(entry) else null end as report_lock_no
    from visible
    left join public.stock_entries entry
      on visible.source_type = 'stock_entry' and entry.id = visible.source_id
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(rows) order by tx_date desc, created_at desc, movement_id desc) from rows), '[]'::jsonb),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextTxDate', (select tx_date from visible order by tx_date, created_at, movement_id limit 1),
    'nextCreatedAt', (select created_at from visible order by tx_date, created_at, movement_id limit 1),
    'nextMovementId', (select movement_id from visible order by tx_date, created_at, movement_id limit 1)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_rubber_export_page_ids(uuid, text, timestamptz, uuid, integer, text, text) from public, anon;
revoke all on function public.get_stock_balances(uuid) from public, anon;
revoke all on function public.get_stock_movement_page(uuid, text, text, date, date, date, timestamptz, text, integer) from public, anon;

grant execute on function public.get_rubber_export_page_ids(uuid, text, timestamptz, uuid, integer, text, text) to authenticated;
grant execute on function public.get_stock_balances(uuid) to authenticated;
grant execute on function public.get_stock_movement_page(uuid, text, text, date, date, date, timestamptz, text, integer) to authenticated;

notify pgrst, 'reload schema';
