\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, rubber_value, average_price,
  deduction_total, net_total, created_by_user_id, created_by_name, created_by_phone
) values (
  '138f17ee-d252-4fef-aa7e-27d0ededc92a', 'atomic-save-source',
  'LOCAL-ATOMIC-SAVE', 'SERVER-ATOMIC-SAVE', 'atomic-save-source-20260819',
  'synced', 'active', '00000000-0000-4000-8000-000000000102',
  'SERVER-ATOMIC-SAVE', current_date, 'ลูกค้าทดสอบ atomic save', 'weighing',
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

select public.save_money_transfer(jsonb_build_object(
  'id', '10000000-0000-4000-8000-000000000011',
  'clientTempId', 'atomic-source-a',
  'idempotencyKey', 'atomic-source-a-20260819',
  'locationId', '00000000-0000-4000-8000-000000000102',
  'operation', 'create',
  'transferType', 'customer',
  'transferStatus', 'pending',
  'netAmountToPay', 20400,
  'revisionNo', 0,
  'slips', jsonb_build_array(jsonb_build_object(
    'id', '20000000-0000-4000-8000-000000000011', 'amount', 100,
    'fee', 0, 'sortOrder', 0
  )),
  'items', jsonb_build_array(jsonb_build_object(
    'id', '30000000-0000-4000-8000-000000000011',
    'sourceType', 'rubber_bill',
    'sourceId', '138f17ee-d252-4fef-aa7e-27d0ededc92a'
  ))
));

-- A retried create returns the canonical first write and must not increment revision or rewrite children.
select public.save_money_transfer(jsonb_build_object(
  'id', '10000000-0000-4000-8000-000000000011',
  'clientTempId', 'atomic-source-a',
  'idempotencyKey', 'atomic-source-a-20260819',
  'locationId', '00000000-0000-4000-8000-000000000102',
  'operation', 'create', 'transferType', 'customer', 'revisionNo', 0,
  'slips', '[]'::jsonb, 'items', '[]'::jsonb
));

do $idempotency$
begin
  if (select revision_no from public.money_transfers where id = '10000000-0000-4000-8000-000000000011') <> 0 then
    raise exception 'idempotent create changed revision';
  end if;
  if (select count(*) from public.money_transfer_slips where transfer_id = '10000000-0000-4000-8000-000000000011') <> 1 then
    raise exception 'idempotent create rewrote children';
  end if;
end
$idempotency$;

do $contract$
begin
  begin
    perform public.save_money_transfer(jsonb_build_object(
      'id', '10000000-0000-4000-8000-000000000012',
      'clientTempId', 'atomic-source-b',
      'idempotencyKey', 'atomic-source-b-20260819',
      'locationId', '00000000-0000-4000-8000-000000000102',
      'operation', 'create',
      'transferType', 'customer', 'transferStatus', 'pending',
      'netAmountToPay', 20400, 'revisionNo', 0,
      'slips', '[]'::jsonb,
      'items', jsonb_build_array(jsonb_build_object(
        'id', '30000000-0000-4000-8000-000000000012',
        'sourceType', 'rubber_bill',
        'sourceId', '138f17ee-d252-4fef-aa7e-27d0ededc92a'
      ))
    ));
    raise exception 'expected source conflict';
  exception when others then
    if position('MT_SOURCE_ALREADY_USED' in sqlerrm) = 0 then raise; end if;
  end;
  if exists (select 1 from public.money_transfers where id = '10000000-0000-4000-8000-000000000012') then
    raise exception 'failed save left a partial parent';
  end if;
  if (select count(*) from public.money_transfer_items where transfer_id = '10000000-0000-4000-8000-000000000011') <> 1 then
    raise exception 'successful save did not preserve exactly one source relation';
  end if;
  if (select count(*) from public.money_transfer_slips where transfer_id = '10000000-0000-4000-8000-000000000011') <> 1 then
    raise exception 'successful save did not preserve exactly one slip';
  end if;
end
$contract$;

select public.save_money_transfer(jsonb_build_object(
  'id', '10000000-0000-4000-8000-000000000011',
  'clientTempId', 'atomic-source-a',
  'idempotencyKey', 'atomic-source-a-20260819',
  'locationId', '00000000-0000-4000-8000-000000000102',
  'operation', 'update',
  'transferType', 'customer', 'transferStatus', 'pending',
  'netAmountToPay', 20400, 'revisionNo', 0,
  'slips', '[]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object(
    'id', '30000000-0000-4000-8000-000000000011',
    'sourceType', 'rubber_bill',
    'sourceId', '138f17ee-d252-4fef-aa7e-27d0ededc92a'
  ))
));

do $revision$
begin
  begin
    perform public.save_money_transfer(jsonb_build_object(
      'id', '10000000-0000-4000-8000-000000000011',
      'locationId', '00000000-0000-4000-8000-000000000102',
      'operation', 'update',
      'transferType', 'customer', 'revisionNo', 0,
      'slips', '[]'::jsonb, 'items', '[]'::jsonb
    ));
    raise exception 'expected revision conflict';
  exception when others then
    if position('MT_REVISION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
end
$revision$;

rollback;
select 'money-transfer-atomic-save-contract-ok' as result;
