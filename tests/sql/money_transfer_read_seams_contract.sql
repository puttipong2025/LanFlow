\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, rubber_value, average_price,
  deduction_total, net_total, created_by_user_id, created_by_name, created_by_phone
) values (
  '138f17ee-d252-4fef-aa7e-27d0ededc92a', 'read-seam-source',
  'LOCAL-READ-SEAM', 'SERVER-READ-SEAM', 'read-seam-source-20260819',
  'synced', 'active', '00000000-0000-4000-8000-000000000102',
  'SERVER-READ-SEAM', current_date, 'ลูกค้าทดสอบ read seam', 'weighing',
  100, 2500, 25, 0, 2500,
  '00000000-0000-4000-8000-000000000001', 'System Admin', '0000000000'
);

insert into public.rubber_bill_items (
  bill_id, item_type, description, weight_in, weight_out, net_weight,
  quantity, unit, price, total, sequence_no
) values (
  '138f17ee-d252-4fef-aa7e-27d0ededc92a', 'weigh', 'ยางทดสอบ',
  110, 10, 100, 100, 'kg', 25, 2500, 1
);

do $seams$
declare
  v_location uuid := '00000000-0000-4000-8000-000000000102';
  v_source uuid;
  v_transfer uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_sources jsonb;
  v_list jsonb;
begin
  select (x->>'sourceId')::uuid into v_source
  from jsonb_array_elements(public.get_money_transfer_sources(v_location, 'rubber_bill')->'rows') x
  where (x->>'available')::boolean
  limit 1;
  if v_source is null then raise exception 'contract source is not available'; end if;

  perform public.save_money_transfer(jsonb_build_object(
    'id', v_transfer, 'clientTempId', v_transfer::text,
    'idempotencyKey', 'read-seam:' || v_transfer::text,
    'locationId', v_location, 'operation', 'create',
    'transferType', 'customer', 'transferStatus', 'pending',
    'netAmountToPay', 1, 'revisionNo', 0, 'slips', '[]'::jsonb,
    'items', jsonb_build_array(jsonb_build_object(
      'id', v_item, 'sourceType', 'rubber_bill', 'sourceId', v_source
    ))
  ));

  select public.get_money_transfer_sources(
    v_location, 'rubber_bill', 'คำค้นที่ไม่ตรงแน่นอน', null, null, 50, array[v_source]
  ) into v_sources;
  if not exists (
    select 1 from jsonb_array_elements(v_sources->'rows') x
    where (x->>'sourceId')::uuid = v_source
      and x->>'blockReason' = 'SOURCE_ALREADY_USED'
  ) then raise exception 'selected source was not retained with authoritative block reason'; end if;

  if not exists (
    select 1 from public.get_money_transfer_source_locks(v_location, 'rubber_bill', array[v_source]) l
    where l.transfer_id = v_transfer
  ) then raise exception 'lock RPC is not derived from canonical relation projection'; end if;

  select public.get_money_transfer_list(v_location, 'all', v_transfer::text) into v_list;
  if jsonb_array_length(v_list->'rows') <> 1 then raise exception 'summary list did not find transfer'; end if;
  if (v_list->'rows'->0) ? 'money_transfer_items' or (v_list->'rows'->0) ? 'money_transfer_slips' then
    raise exception 'summary list leaked nested children';
  end if;
  if jsonb_array_length(public.get_money_transfer_detail(v_transfer)->'money_transfer_items') <> 1 then
    raise exception 'detail read did not return children';
  end if;
end
$seams$;

rollback;
select 'money-transfer-read-seams-ok' as result;
