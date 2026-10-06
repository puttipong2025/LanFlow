-- A retry may reuse an idempotency key, but it must represent the same bill payload.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    $old$  if v_operation = 'create' and v_existing_request.id is not null then$old$,
    $new$  if v_existing_request.id is not null
     and (
       private.normalize_rubber_bill_calculation_payload(v_existing_request.proposed_payload)
         - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
       is distinct from
       private.normalize_rubber_bill_calculation_payload(payload)
         - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
     ) then
    return jsonb_build_object(
      'status', 'conflict',
      'errorMessage', 'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่รอดำเนินการอยู่'
    );
  end if;
  if v_operation = 'create' and v_existing_request.id is not null then$new$
  );
  if v_updated = v_definition then
    raise exception 'public replay branch not found';
  end if;

  execute v_updated;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.sync_rubber_bill_approval_20260823010000(jsonb)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$  v_existing_request_idempotency_key text;$old$,
    $new$  v_existing_request_idempotency_key text;
  v_existing_request_payload jsonb;$new$
  );
  if v_updated = v_definition then
    raise exception 'private replay declaration not found';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $old$    select r.id, r.request_status, r.created_bill_id,
           r.client_temp_id, r.location_id, r.idempotency_key
      into v_request_id, v_existing_request_status, v_existing_created_bill_id,
           v_existing_request_client_temp_id, v_existing_request_location_id,
           v_existing_request_idempotency_key$old$,
    $new$    select r.id, r.request_status, r.created_bill_id,
           r.client_temp_id, r.location_id, r.idempotency_key, r.proposed_payload
      into v_request_id, v_existing_request_status, v_existing_created_bill_id,
           v_existing_request_client_temp_id, v_existing_request_location_id,
           v_existing_request_idempotency_key, v_existing_request_payload$new$
  );
  if v_updated = v_definition then
    raise exception 'private create replay lookup not found';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $old$      if v_existing_request_status = 'approved' and v_existing_created_bill_id is not null then$old$,
    $new$      if (
        v_existing_request_payload
          - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
        is distinct from
        payload
          - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
      ) then
        return jsonb_build_object(
          'status', 'conflict',
          'errorMessage', 'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่รอดำเนินการอยู่'
        );
      end if;
      if v_existing_request_status = 'approved' and v_existing_created_bill_id is not null then$new$
  );
  if v_updated = v_definition then
    raise exception 'private create replay comparison point not found';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $old$    select r.id, r.operation, r.idempotency_key
      into v_request_id, v_existing_request_operation, v_existing_request_idempotency_key
    from public.rubber_bill_approval_requests r
    where r.bill_id = v_bill.id
      and r.request_status = 'pending';$old$,
    $new$    select r.id, r.operation, r.idempotency_key, r.proposed_payload
      into v_request_id, v_existing_request_operation, v_existing_request_idempotency_key,
           v_existing_request_payload
    from public.rubber_bill_approval_requests r
    where r.bill_id = v_bill.id
      and r.request_status = 'pending';$new$
  );
  if v_updated = v_definition then
    raise exception 'private mutation replay lookup not found';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $old$      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_existing_request_operation,
        'clientTempId', v_client_temp_id
      );$old$,
    $new$      if (
        v_existing_request_payload
          - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
        is distinct from
        payload
          - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
      ) then
        return jsonb_build_object(
          'status', 'conflict',
          'errorMessage', 'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่รอดำเนินการอยู่'
        );
      end if;
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_existing_request_operation,
        'clientTempId', v_client_temp_id
      );$new$
  );
  if v_updated = v_definition then
    raise exception 'private mutation replay return not found';
  end if;

  execute v_updated;
end;
$migration$;
