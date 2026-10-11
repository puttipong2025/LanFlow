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
  'customerName', 'ผู้รับโอนอิสระ atomic save',
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

do $free_form_recipient$
begin
  if not exists (
    select 1 from public.money_transfers
    where id = '10000000-0000-4000-8000-000000000011'
      and customer_id is null
      and customer_name = 'ผู้รับโอนอิสระ atomic save'
  ) then
    raise exception 'free-form recipient was not stored independently from customer master data';
  end if;
  if public.get_money_transfer_detail('10000000-0000-4000-8000-000000000011')->>'customer_name'
    is distinct from 'ผู้รับโอนอิสระ atomic save' then
    raise exception 'free-form recipient was not returned by detail RPC';
  end if;
end
$free_form_recipient$;

-- A retried create returns the canonical first write and must not increment revision or rewrite children.
select public.save_money_transfer(jsonb_build_object(
  'id', '10000000-0000-4000-8000-000000000011',
  'clientTempId', 'atomic-source-a',
  'idempotencyKey', 'atomic-source-a-20260819',
  'locationId', '00000000-0000-4000-8000-000000000102',
  'operation', 'create',
  'transferType', 'customer',
  'customerName', 'ผู้รับโอนอิสระ atomic save',
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
      'transferType', 'customer', 'customerName', 'ผู้รับโอนอิสระ atomic save',
      'transferStatus', 'pending',
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
  'transferType', 'customer', 'customerName', 'ผู้รับโอนอิสระ atomic save',
  'transferStatus', 'pending',
  'netAmountToPay', 20400, 'revisionNo', 0,
  'slips', '[]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object(
    'id', '30000000-0000-4000-8000-000000000011',
    'sourceType', 'rubber_bill',
    'sourceId', '138f17ee-d252-4fef-aa7e-27d0ededc92a'
  ))
));

do $updated_free_form_recipient$
begin
  if public.get_money_transfer_detail('10000000-0000-4000-8000-000000000011')->>'customer_name'
    is distinct from 'ผู้รับโอนอิสระ atomic save' then
    raise exception 'free-form recipient was not preserved by update';
  end if;
end
$updated_free_form_recipient$;

do $revision$
begin
  begin
    perform public.save_money_transfer(jsonb_build_object(
      'id', '10000000-0000-4000-8000-000000000011',
      'locationId', '00000000-0000-4000-8000-000000000102',
      'operation', 'update',
      'transferType', 'customer', 'customerName', 'ผู้รับโอนอิสระ atomic save',
      'revisionNo', 0,
      'slips', '[]'::jsonb, 'items', '[]'::jsonb
    ));
    raise exception 'expected revision conflict';
  exception when others then
    if position('MT_REVISION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
end
$revision$;

do $legacy_blank_recipient_replay$
declare
  v_payload jsonb := jsonb_build_object(
    'id', '10000000-0000-4000-8000-000000000097',
    'clientTempId', 'legacy-blank-replay',
    'idempotencyKey', 'legacy-blank-replay-20261012',
    'locationId', '00000000-0000-4000-8000-000000000102',
    'operation', 'create',
    'transferType', 'customer',
    'customerName', '   ',
    'transferStatus', 'advance_payment',
    'netAmountToPay', 100,
    'revisionNo', 0,
    'slips', jsonb_build_array(jsonb_build_object(
      'id', '20000000-0000-4000-8000-000000000097',
      'inputMethod', 'manual',
      'amount', 100,
      'fee', 0,
      'sortOrder', 0
    )),
    'items', '[]'::jsonb
  );
  v_result jsonb;
begin
  perform public.save_money_transfer_before_customer_name_validation(v_payload);
  v_result := public.save_money_transfer(v_payload);
  if coalesce((v_result->>'idempotentReplay')::boolean, false) is not true then
    raise exception 'legacy blank-recipient create was not replayed idempotently';
  end if;

  begin
    perform public.save_money_transfer(
      v_payload || jsonb_build_object('netAmountToPay', 101)
    );
    raise exception 'expected legacy blank-recipient replay mismatch';
  exception when others then
    if position('MT_IDEMPOTENCY_PAYLOAD_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;
end
$legacy_blank_recipient_replay$;

do $customer_name_required$
declare
  v_customer_name text;
begin
  foreach v_customer_name in array array['   ', E'\t\r\n', chr(160), chr(65279)] loop
    begin
      perform public.save_money_transfer(jsonb_build_object(
        'id', '10000000-0000-4000-8000-000000000013',
        'clientTempId', 'blank-recipient',
        'idempotencyKey', 'blank-recipient-20261011',
        'locationId', '00000000-0000-4000-8000-000000000102',
        'operation', 'create',
        'transferType', 'customer',
        'customerName', v_customer_name,
        'transferStatus', 'advance_payment',
        'netAmountToPay', 100,
        'revisionNo', 0,
        'slips', jsonb_build_array(jsonb_build_object(
          'id', '20000000-0000-4000-8000-000000000013',
          'inputMethod', 'manual',
          'amount', 100,
          'fee', 0,
          'sortOrder', 0
        )),
        'items', '[]'::jsonb
      ));
      raise exception 'expected blank customer recipient rejection';
    exception when others then
      if position('MT_CUSTOMER_NAME_REQUIRED' in sqlerrm) = 0 then raise; end if;
    end;
  end loop;
end
$customer_name_required$;

do $customer_name_must_be_text$
declare
  v_customer_name jsonb;
begin
  foreach v_customer_name in array array[
    jsonb_build_object('unexpected', true),
    '[]'::jsonb,
    '123'::jsonb,
    'true'::jsonb
  ] loop
    begin
      perform public.save_money_transfer(jsonb_build_object(
        'id', '10000000-0000-4000-8000-000000000098',
        'clientTempId', 'non-text-recipient',
        'idempotencyKey', 'non-text-recipient-20261011',
        'locationId', '00000000-0000-4000-8000-000000000102',
        'operation', 'create',
        'transferType', 'customer',
        'customerName', v_customer_name,
        'transferStatus', 'advance_payment',
        'netAmountToPay', 100,
        'revisionNo', 0,
        'slips', jsonb_build_array(jsonb_build_object(
          'id', '20000000-0000-4000-8000-000000000098',
          'inputMethod', 'manual',
          'amount', 100,
          'fee', 0,
          'sortOrder', 0
        )),
        'items', '[]'::jsonb
      ));
      raise exception 'expected non-text customer recipient rejection';
    exception when others then
      if position('MT_CUSTOMER_NAME_REQUIRED' in sqlerrm) = 0 then raise; end if;
    end;
  end loop;
end
$customer_name_must_be_text$;

do $payload_must_be_object$
declare
  v_payload jsonb;
begin
  foreach v_payload in array array[
    '[]'::jsonb,
    'null'::jsonb,
    '"unexpected"'::jsonb,
    '123'::jsonb,
    'true'::jsonb,
    null::jsonb
  ] loop
    begin
      perform public.save_money_transfer(v_payload);
      raise exception 'expected non-object payload rejection';
    exception when others then
      if position('MT_INVALID_PAYLOAD' in sqlerrm) = 0 then raise; end if;
    end;
  end loop;
end
$payload_must_be_object$;

do $malformed_scalar_payload$
declare
  v_payload jsonb;
  v_base jsonb := jsonb_build_object(
    'id', '10000000-0000-4000-8000-000000000096',
    'clientTempId', 'malformed-scalar-payload',
    'idempotencyKey', 'malformed-scalar-payload-20261012',
    'locationId', '00000000-0000-4000-8000-000000000102',
    'operation', 'create',
    'transferType', 'customer',
    'customerName', 'ผู้รับโอนทดสอบ malformed payload',
    'transferStatus', 'advance_payment',
    'netAmountToPay', 100,
    'revisionNo', 0,
    'slips', '[]'::jsonb,
    'items', '[]'::jsonb
  );
begin
  foreach v_payload in array array[
    v_base || jsonb_build_object('id', 'not-a-uuid'),
    v_base || jsonb_build_object('locationId', 'not-a-uuid'),
    v_base || jsonb_build_object('operation', 'update', 'revisionNo', 'not-an-integer'),
    v_base || jsonb_build_object('netAmountToPay', 'not-a-number'),
    v_base || jsonb_build_object(
      'slips', jsonb_build_array(jsonb_build_object(
        'id', '20000000-0000-4000-8000-000000000096',
        'inputMethod', 'manual',
        'amount', 100,
        'fee', 0,
        'transactionDate', 'not-a-timestamp',
        'sortOrder', 0
      ))
    )
  ] loop
    begin
      perform public.save_money_transfer(v_payload);
      raise exception 'expected malformed scalar payload rejection';
    exception when others then
      if position('MT_INVALID_PAYLOAD' in sqlerrm) = 0 then raise; end if;
    end;
  end loop;
end
$malformed_scalar_payload$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-999999999999', true);

do $authorization_precedes_customer_name_validation$
begin
  begin
    perform public.save_money_transfer(jsonb_build_object(
      'id', '10000000-0000-4000-8000-000000000099',
      'locationId', '00000000-0000-4000-8000-000000000102',
      'operation', 'create',
      'transferType', 'customer',
      'customerName', E'\t',
      'slips', '[]'::jsonb,
      'items', '[]'::jsonb
    ));
    raise exception 'expected access denial before customer-name validation';
  exception when others then
    if position('MT_ACCESS_DENIED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.save_money_transfer('[]'::jsonb);
    raise exception 'expected access denial before payload-shape validation';
  exception when others then
    if position('MT_ACCESS_DENIED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.save_money_transfer(jsonb_build_object(
      'transferType', 'branch'
    ));
    raise exception 'expected access denial before delegated branch validation';
  exception when others then
    if position('MT_ACCESS_DENIED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.save_money_transfer(jsonb_build_object(
      'id', '10000000-0000-4000-8000-000000000097',
      'clientTempId', 'legacy-blank-replay',
      'idempotencyKey', 'legacy-blank-replay-20261012',
      'locationId', '00000000-0000-4000-8000-000000000102',
      'operation', 'create',
      'transferType', 'customer',
      'customerName', '   ',
      'transferStatus', 'advance_payment',
      'netAmountToPay', 100,
      'revisionNo', 0,
      'slips', jsonb_build_array(jsonb_build_object(
        'id', '20000000-0000-4000-8000-000000000097',
        'inputMethod', 'manual',
        'amount', 100,
        'fee', 0,
        'sortOrder', 0
      )),
      'items', '[]'::jsonb
    ));
    raise exception 'expected access denial before legacy replay lookup';
  exception when others then
    if position('MT_ACCESS_DENIED' in sqlerrm) = 0 then raise; end if;
  end;
end
$authorization_precedes_customer_name_validation$;

rollback;
select 'money-transfer-atomic-save-contract-ok' as result;
