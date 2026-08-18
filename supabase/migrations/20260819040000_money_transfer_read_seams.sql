create or replace function private.money_transfer_source_relations(
  p_location_id uuid,
  p_source_type text default null
)
returns table(source_type text, source_id uuid, transfer_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select i.source_type, i.source_id, i.transfer_id
  from public.money_transfer_items i
  join public.money_transfers t on t.id = i.transfer_id
  where t.location_id = p_location_id
    and t.record_status <> 'deleted'
    and (p_source_type is null or i.source_type = p_source_type);
$$;

revoke all on function private.money_transfer_source_relations(uuid, text)
from public, anon, authenticated;

create or replace function public.get_money_transfer_sources(
  p_location_id uuid,
  p_source_type text,
  p_search text default '',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50,
  p_selected_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := lower(trim(coalesce(p_search, '')));
  v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  if not private.can_access_location(p_location_id) then raise exception 'Location access denied'; end if;
  if p_source_type not in ('rubber_bill', 'ocr_ticket') then raise exception 'Unsupported source type'; end if;
  if p_page_size < 1 or p_page_size > 100 then raise exception 'Invalid page size'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'Invalid source cursor'; end if;

  with source_rows as (
    select
      'rubber_bill'::text source_type,
      b.id source_id,
      coalesce(b.server_bill_no, b.local_bill_no, b.bill_no) source_number,
      b.bill_date::text source_date,
      b.customer_name,
      b.net_total::numeric amount,
      b.net_weight::numeric net_weight,
      b.average_price::numeric average_price,
      b.net_rubber_value::numeric rubber_value,
      b.deduction_total::numeric deducted_amount,
      null::text license_plate,
      b.created_at,
      r.transfer_id,
      public.report_lock_no(b) report_lock_no,
      private.rubber_bill_has_pending_approval(b.id) approval_pending,
      b.sync_status::text sync_status,
      b.server_bill_no is not null has_server_number,
      exists (
        select 1 from public.rubber_bill_items bi
        where bi.bill_id = b.id and bi.item_type = 'weigh' and coalesce(bi.price, 0) <= 0
      ) unpriced
    from public.rubber_bills b
    left join private.money_transfer_source_relations(p_location_id, 'rubber_bill') r
      on r.source_id = b.id
    where b.location_id = p_location_id and b.record_status = 'active'

    union all

    select
      'ocr_ticket'::text,
      o.id,
      coalesce(o.ticket_id, o.file_name),
      o.date_in::text,
      o.customer_name,
      (coalesce(o.total_amount, 0) - coalesce(o.money_deducted, 0))::numeric,
      coalesce(o.weight_remaining, o.weight_net, 0)::numeric,
      null::numeric,
      coalesce(o.total_amount, 0)::numeric,
      coalesce(o.money_deducted, 0)::numeric,
      o.license_plate,
      o.created_at,
      r.transfer_id,
      public.report_lock_no(o),
      false,
      o.sync_status::text,
      o.ticket_id is not null,
      false
    from public.ocr_tickets o
    left join private.money_transfer_source_relations(p_location_id, 'ocr_ticket') r
      on r.source_id = o.id
    where o.location_id = p_location_id and o.record_status = 'active'
  ), classified as (
    select s.*,
      case
        when s.transfer_id is not null then 'SOURCE_ALREADY_USED'
        when s.report_lock_no is not null then 'REPORT_LOCKED'
        when s.approval_pending then 'PENDING_APPROVAL'
        when s.sync_status <> 'synced' or not s.has_server_number then 'NOT_SYNCED'
        when s.unpriced then 'UNPRICED'
        when coalesce(s.amount, 0) <= 0 then 'NOT_PAYABLE'
        when nullif(trim(coalesce(s.customer_name, '')), '') is null then 'MISSING_CUSTOMER'
        else null
      end block_reason
    from source_rows s
    where s.source_type = p_source_type
      and (
        s.source_id = any(coalesce(p_selected_ids, array[]::uuid[]))
        or v_search = ''
        or position(v_search in lower(concat_ws(' ', s.source_number, s.source_date, s.customer_name, s.license_plate))) > 0
      )
      and (s.source_id = any(coalesce(p_selected_ids, array[]::uuid[]))
        or p_cursor_created_at is null or (s.created_at, s.source_id) < (p_cursor_created_at, p_cursor_id))
    order by (s.source_id = any(coalesce(p_selected_ids, array[]::uuid[]))) desc, s.created_at desc, s.source_id desc
    limit p_page_size + cardinality(coalesce(p_selected_ids, array[]::uuid[])) + 1
  ), visible as (
    select * from classified
    order by (source_id = any(coalesce(p_selected_ids, array[]::uuid[]))) desc, created_at desc, source_id desc
    limit p_page_size + cardinality(coalesce(p_selected_ids, array[]::uuid[]))
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'sourceType', v.source_type,
      'sourceId', v.source_id,
      'sourceNumber', v.source_number,
      'sourceDate', v.source_date,
      'customerName', v.customer_name,
      'amount', v.amount,
      'netWeight', v.net_weight,
      'averagePrice', v.average_price,
      'rubberValue', v.rubber_value,
      'deductedAmount', v.deducted_amount,
      'licensePlate', v.license_plate,
      'transferId', v.transfer_id,
      'reportLockNo', v.report_lock_no,
      'available', v.block_reason is null,
      'blockReason', v.block_reason,
      'createdAt', v.created_at
    ) order by (v.source_id = any(coalesce(p_selected_ids, array[]::uuid[]))) desc, v.created_at desc, v.source_id desc) from visible v), '[]'::jsonb),
    'hasMore', (select count(*) filter (where not (source_id = any(coalesce(p_selected_ids, array[]::uuid[])))) > p_page_size from classified),
    'nextCreatedAt', (select v.created_at from visible v where not (v.source_id = any(coalesce(p_selected_ids, array[]::uuid[]))) order by v.created_at, v.source_id limit 1),
    'nextId', (select v.source_id from visible v where not (v.source_id = any(coalesce(p_selected_ids, array[]::uuid[]))) order by v.created_at, v.source_id limit 1)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_money_transfer_sources(uuid, text, text, timestamptz, uuid, integer, uuid[])
from public, anon;
grant execute on function public.get_money_transfer_sources(uuid, text, text, timestamptz, uuid, integer, uuid[])
to authenticated;

create or replace function public.get_money_transfer_list(
  p_location_id uuid,
  p_status text default 'all',
  p_search text default '',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb; v_search text := lower(trim(coalesce(p_search, '')));
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  if not private.can_access_location(p_location_id) then raise exception 'Location access denied'; end if;
  if p_page_size < 1 or p_page_size > 100 then raise exception 'Invalid page size'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'Invalid transfer cursor'; end if;

  with candidates as (
    select t.*,
      public.report_lock_no(t) report_lock_no,
      coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = t.id), 0) paid_amount,
      coalesce((select count(*) from public.money_transfer_items i where i.transfer_id = t.id), 0) source_count
    from public.money_transfers t
    where t.location_id = p_location_id
      and t.record_status <> 'deleted'
      and (p_status = 'all' or t.transfer_status = p_status)
      and (v_search = '' or position(v_search in lower(concat_ws(' ', t.customer_name, t.account_number,
        t.account_name, t.bank_name, t.transport_staff_name, t.target_location_name, t.id::text))) > 0)
      and (p_cursor_created_at is null or (t.created_at, t.id) < (p_cursor_created_at, p_cursor_id))
    order by t.created_at desc, t.id desc
    limit p_page_size + 1
  ), visible as (
    select * from candidates order by created_at desc, id desc limit p_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc, v.id desc) from visible v), '[]'::jsonb),
    'statusCounts', (select jsonb_build_object(
      'all', count(*),
      'pending', count(*) filter (where t.transfer_status = 'pending'),
      'partial', count(*) filter (where t.transfer_status = 'partial'),
      'advance_payment', count(*) filter (where t.transfer_status = 'advance_payment'),
      'paid', count(*) filter (where t.transfer_status = 'paid'),
      'overpaid', count(*) filter (where t.transfer_status = 'overpaid'),
      'branch_and_transfer', count(*) filter (where t.transfer_status = 'branch_and_transfer'),
      'cancelled', count(*) filter (where t.transfer_status = 'cancelled')
    ) from public.money_transfers t where t.location_id = p_location_id and t.record_status <> 'deleted'),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextCreatedAt', (select v.created_at from visible v order by v.created_at, v.id limit 1),
    'nextId', (select v.id from visible v order by v.created_at, v.id limit 1)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_money_transfer_list(uuid, text, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_money_transfer_list(uuid, text, text, timestamptz, uuid, integer) to authenticated;

create or replace function public.get_money_transfer_detail(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_transfer public.money_transfers; v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  select * into v_transfer from public.money_transfers t
  where t.id = p_transfer_id and t.record_status <> 'deleted';
  if v_transfer.id is null then raise exception 'Money transfer not found'; end if;
  if not private.can_access_location(v_transfer.location_id) then raise exception 'Location access denied'; end if;
  select to_jsonb(v_transfer)
    || jsonb_build_object(
      'report_lock_no', public.report_lock_no(v_transfer),
      'money_transfer_slips', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order, s.id)
        from public.money_transfer_slips s where s.transfer_id = p_transfer_id), '[]'::jsonb),
      'money_transfer_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.id)
        from public.money_transfer_items i where i.transfer_id = p_transfer_id), '[]'::jsonb)
    ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_money_transfer_detail(uuid) from public, anon;
grant execute on function public.get_money_transfer_detail(uuid) to authenticated;

create or replace function public.get_money_transfer_receipt_source_details(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_location_id uuid; v_items jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  select t.location_id into v_location_id from public.money_transfers t
  where t.id = p_transfer_id and t.record_status <> 'deleted';
  if v_location_id is null then raise exception 'Money transfer not found'; end if;
  if not private.can_access_location(v_location_id) then raise exception 'Location access denied'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', i.id,
    'sourceType', i.source_type,
    'sourceId', i.source_id,
    'sourceNumber', case when i.source_type = 'rubber_bill'
      then coalesce(rb.server_bill_no, rb.local_bill_no, rb.bill_no) else coalesce(ot.ticket_id, ot.file_name) end,
    'sourceDate', case when i.source_type = 'rubber_bill' then rb.bill_date::text else ot.date_in::text end,
    'customerName', coalesce(rb.customer_name, ot.customer_name, i.customer_name),
    'netWeightAfterDeduction', case when i.source_type = 'rubber_bill' then rb.net_weight else coalesce(ot.weight_remaining, 0) end,
    'averagePrice', case when i.source_type = 'rubber_bill' then rb.average_price
      when coalesce(ot.weight_remaining, 0) > 0 then coalesce(ot.total_amount, 0) / ot.weight_remaining
      else null end,
    'rubberValue', case when i.source_type = 'rubber_bill' then rb.net_rubber_value else coalesce(ot.total_amount, 0) end,
    'deductedAmount', case when i.source_type = 'rubber_bill' then rb.deduction_total else ot.money_deducted end,
    'netPayableAmount', case when i.source_type = 'rubber_bill' then rb.net_total
      else coalesce(ot.total_amount, 0) - coalesce(ot.money_deducted, 0) end
  ) order by coalesce(rb.created_at, ot.created_at) desc, i.source_id desc), '[]'::jsonb) into v_items
  from public.money_transfer_items i
  left join public.rubber_bills rb on rb.id = i.rubber_bill_id
  left join public.ocr_tickets ot on ot.id = i.ocr_ticket_id
  where i.transfer_id = p_transfer_id;
  return jsonb_build_object('transferId', p_transfer_id, 'items', v_items);
end;
$$;

revoke all on function public.get_money_transfer_receipt_source_details(uuid) from public, anon;
grant execute on function public.get_money_transfer_receipt_source_details(uuid) to authenticated;

notify pgrst, 'reload schema';
