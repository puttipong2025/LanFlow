-- Transactional production smoke check for the public old-client wrapper.
-- The final expected exception rolls back the temporary settings change and
-- pending request. The caller must treat only ROLLBACK_SMOKE_OK as success.
do $$
declare
  v_user_id uuid;
  v_location_id uuid;
  v_client_temp_id text := gen_random_uuid()::text;
  v_payload jsonb;
  v_result jsonb;
begin
  select ul.user_id, ul.location_id
    into v_user_id, v_location_id
  from public.user_locations ul
  join public.profiles p on p.id = ul.user_id
  where p.is_active
  order by ul.is_primary desc, ul.created_at
  limit 1;

  if v_user_id is null then
    raise exception 'ROLLBACK_SMOKE_FAILED no eligible user';
  end if;

  update public.rubber_bill_approval_settings
  set non_current_date_requires_approval = true
  where id = true;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  v_payload := jsonb_build_object(
    'operation', 'create',
    'expectedRevisionNo', 0,
    'clientTempId', v_client_temp_id,
    'idempotencyKey', 'cloud-rollback-smoke:' || v_client_temp_id,
    'locationId', v_location_id,
    'recordStatus', 'active',
    'localBillNo', 'SMK-' || left(v_client_temp_id, 8),
    'billDate', ((clock_timestamp() at time zone 'Asia/Bangkok')::date - 1)::text,
    'customerId', null,
    'customerName', 'Cloud rollback smoke',
    'configuredPriceSnapshot', null,
    'billType', 'บิลเครื่องชั่งเล็ก',
    'deductWeight', 0,
    'weight', 10,
    'rubberValue', 100,
    'averagePrice', 10,
    'deductionTotal', 0,
    'netTotal', 100,
    'acidPackCount', 0,
    'clientRecordedAt', clock_timestamp()::text,
    'clientCreatedAt', clock_timestamp()::text,
    'items', jsonb_build_array(jsonb_build_object(
      'itemType', 'weigh',
      'title', 'ชั่ง1',
      'description', 'ชั่ง1',
      'inWeight', 20,
      'outWeight', 10,
      'netWeight', 10,
      'unitPrice', 10,
      'totalAmount', 100,
      'sequenceNo', 1
    ))
  );

  v_result := public.sync_rubber_bill(v_payload);

  if v_result->>'status' <> 'pending_approval'
     or v_result->'matchedReasons' <> '["non_current_date"]'::jsonb then
    raise exception 'ROLLBACK_SMOKE_FAILED status=% reasons=%',
      v_result->>'status', v_result->'matchedReasons';
  end if;

  raise exception 'ROLLBACK_SMOKE_OK status=% reasons=%',
    v_result->>'status', v_result->'matchedReasons';
end;
$$;
