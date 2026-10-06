-- An approved mutation must not accept a different payload under its old idempotency key.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    $old$    return jsonb_build_object(
      'status', 'synced',
      'id', v_existing_bill.id,
      'serverBillNo', v_existing_bill.server_bill_no,
      'revisionNo', v_existing_bill.revision_no,
      'serverReceivedAt', v_existing_bill.server_received_at
    );
  end if;

  select * into v_existing_request$old$,
    $new$    select * into v_existing_request
    from public.rubber_bill_approval_requests r
    where r.client_temp_id = payload->>'clientTempId'
      and r.location_id = v_location_id
      and r.idempotency_key = payload->>'idempotencyKey'
    order by r.requested_at
    limit 1;
    if v_existing_request.id is not null
       and (
         private.normalize_rubber_bill_calculation_payload(v_existing_request.proposed_payload)
           - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
         is distinct from
         private.normalize_rubber_bill_calculation_payload(payload)
           - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
       ) then
      return jsonb_build_object(
        'status', 'conflict',
        'errorMessage', 'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่อนุมัติแล้ว'
      );
    end if;
    return jsonb_build_object(
      'status', 'synced',
      'id', v_existing_bill.id,
      'serverBillNo', v_existing_bill.server_bill_no,
      'revisionNo', v_existing_bill.revision_no,
      'serverReceivedAt', v_existing_bill.server_received_at
    );
  end if;

  select * into v_existing_request$new$
  );
  if v_updated = v_definition then
    raise exception 'approved replay branch not found';
  end if;

  execute v_updated;
end;
$migration$;
