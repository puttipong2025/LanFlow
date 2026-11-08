-- Hide transfers outside the caller's location scope in the detail lookup.
create or replace function public.get_money_transfer_detail(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_transfer public.money_transfers;
  v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  select * into v_transfer from public.money_transfers transfer
  where transfer.id = p_transfer_id
    and transfer.record_status <> 'deleted'
    and private.can_access_location(transfer.location_id);
  if v_transfer.id is null then raise exception 'Money transfer not found'; end if;
  select to_jsonb(v_transfer) || jsonb_build_object(
    'report_lock_no', public.report_lock_no(v_transfer),
    'rubber_export_no', (select export.export_no from public.rubber_exports export where export.id = v_transfer.rubber_export_id),
    'bundle_summary', case when v_transfer.is_payment_bundle then private.payment_bundle_summary(v_transfer.id) end,
    'money_transfer_slips', coalesce((select jsonb_agg(to_jsonb(slip) order by slip.sort_order, slip.id)
      from public.money_transfer_slips slip where slip.transfer_id = p_transfer_id), '[]'::jsonb),
    'money_transfer_items', coalesce((select jsonb_agg(to_jsonb(item) order by item.created_at, item.id)
      from public.money_transfer_items item where item.transfer_id = p_transfer_id), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_money_transfer_receipt_source_details(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  if not exists (
    select 1
    from public.money_transfers t
    where t.id = p_transfer_id
      and t.record_status <> 'deleted'
      and private.can_access_location(t.location_id)
  ) then
    raise exception 'Money transfer not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', i.id,
    'sourceType', 'rubber_bill',
    'sourceId', i.source_id,
    'sourceNumber', coalesce(rb.server_bill_no, rb.local_bill_no, rb.bill_no),
    'sourceDate', rb.bill_date::text,
    'customerName', coalesce(rb.customer_name, i.customer_name),
    'netWeightAfterDeduction', rb.net_weight,
    'averagePrice', rb.average_price,
    'rubberValue', rb.net_rubber_value,
    'deductedAmount', rb.deduction_total,
    'netPayableAmount', rb.net_total
  ) order by rb.created_at desc, i.source_id desc), '[]'::jsonb)
  into v_items
  from public.money_transfer_items i
  join public.rubber_bills rb on rb.id = i.rubber_bill_id
  where i.transfer_id = p_transfer_id;
  return jsonb_build_object('transferId', p_transfer_id, 'items', v_items);
end
$$;
