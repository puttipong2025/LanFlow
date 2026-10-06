-- Do not report an existing pending mutation as if it represented a different submission.

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
    $old$  v_request_id uuid;$old$,
    $new$  v_request_id uuid;
  v_existing_request_operation text;$new$
  );
  if v_updated = v_definition then
    raise exception 'pending-request declarations not found';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $old$    select id
      into v_request_id
    from public.rubber_bill_approval_requests
    where bill_id = v_bill.id
      and request_status = 'pending';

    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;$old$,
    $new$    select r.id, r.operation, r.idempotency_key
      into v_request_id, v_existing_request_operation, v_existing_request_idempotency_key
    from public.rubber_bill_approval_requests r
    where r.bill_id = v_bill.id
      and r.request_status = 'pending';

    if v_request_id is not null then
      if v_existing_request_operation is distinct from v_operation
         or v_existing_request_idempotency_key is distinct from v_idempotency_key then
        return jsonb_build_object(
          'status', 'conflict',
          'errorMessage', 'บิลนี้มีคำขออนุมัติอื่นที่รอดำเนินการอยู่'
        );
      end if;
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_existing_request_operation,
        'clientTempId', v_client_temp_id
      );
    end if;$new$
  );
  if v_updated = v_definition then
    raise exception 'pending-request branch not found';
  end if;

  execute v_updated;
end;
$migration$;
