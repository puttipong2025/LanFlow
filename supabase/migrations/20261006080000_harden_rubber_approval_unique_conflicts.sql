-- A unique-key collision may only replay the exact same pending approval request.

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
    $old$  v_existing_request_payload jsonb;$old$,
    $new$  v_existing_request_payload jsonb;
  v_existing_request_base_revision_no integer;$new$
  );
  if v_updated = v_definition then
    raise exception 'approval-collision declaration not found';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $old$exception
  when unique_violation then
    select id
      into v_request_id
    from public.rubber_bill_approval_requests
    where request_status = 'pending'
      and (
        idempotency_key = v_idempotency_key
        or bill_id = v_bill.id
        or (operation = 'create' and client_temp_id = v_client_temp_id)
      )
    order by requested_at desc
    limit 1;

    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
  when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);$old$,
    $new$exception
  when unique_violation then
    select r.id, r.operation, r.request_status, r.client_temp_id,
           r.location_id, r.idempotency_key, r.base_revision_no, r.proposed_payload
      into v_request_id, v_existing_request_operation, v_existing_request_status,
           v_existing_request_client_temp_id, v_existing_request_location_id,
           v_existing_request_idempotency_key, v_existing_request_base_revision_no,
           v_existing_request_payload
    from public.rubber_bill_approval_requests r
    where r.idempotency_key = v_idempotency_key
       or (
         r.request_status = 'pending'
         and (
           r.bill_id = v_bill.id
           or (r.operation = 'create' and r.client_temp_id = v_client_temp_id)
         )
       )
    order by (
      r.client_temp_id = v_client_temp_id
      and r.location_id = v_location_id
      and r.idempotency_key = v_idempotency_key
    ) desc, r.requested_at desc
    limit 1;

    if v_request_id is not null
       and v_existing_request_status = 'pending'
       and v_existing_request_operation is not distinct from v_operation
       and v_existing_request_client_temp_id is not distinct from v_client_temp_id
       and v_existing_request_location_id is not distinct from v_location_id
       and v_existing_request_idempotency_key is not distinct from v_idempotency_key
       and v_existing_request_base_revision_no is not distinct from v_expected_revision
       and private.rubber_bill_submission_fingerprint(v_existing_request_payload)
         is not distinct from private.rubber_bill_submission_fingerprint(payload) then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_existing_request_operation,
        'clientTempId', v_existing_request_client_temp_id
      );
    end if;
    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'conflict',
        'errorMessage', 'รหัสคำขออนุมัติถูกใช้กับรายการอื่นแล้ว'
      );
    end if;
    return jsonb_build_object(
      'status', 'failed',
      'errorMessage', 'สร้างคำขออนุมัติบิลยางไม่สำเร็จ'
    );
  when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);$new$
  );
  if v_updated = v_definition then
    raise exception 'approval-collision handler not found';
  end if;

  execute v_updated;
end;
$migration$;
