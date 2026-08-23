-- A create replay is an identity check, not a new authorization decision.
-- Resolve trusted bill/request identities before applying the current price rules.

do $$
declare
  v_definition text;
  v_old_declarations constant text := E'  v_existing_created_bill_id uuid;\n  v_actor_name text;';
  v_new_declarations constant text := E'  v_existing_created_bill_id uuid;\n  v_existing_request_client_temp_id text;\n  v_existing_request_location_id uuid;\n  v_existing_request_idempotency_key text;\n  v_actor_name text;';
  v_old_lock constant text := E'  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));\n\n  select name, phone';
  v_new_lock constant text := E'  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));\n\n  if v_operation = ''create'' then\n    perform pg_advisory_xact_lock(hashtext(''rubber-bill-create:'' || v_client_temp_id));\n\n    select * into v_bill\n    from public.rubber_bills b\n    where b.client_temp_id = v_client_temp_id\n    for update;\n\n    if v_bill.id is not null then\n      if v_bill.location_id is distinct from v_location_id\n         or v_bill.idempotency_key is distinct from v_idempotency_key then\n        return jsonb_build_object(''status'', ''conflict'', ''errorMessage'', ''Record already exists'');\n      end if;\n      return jsonb_build_object(\n        ''status'', ''synced'',\n        ''id'', v_bill.id,\n        ''serverBillNo'', v_bill.server_bill_no,\n        ''revisionNo'', v_bill.revision_no,\n        ''serverReceivedAt'', v_bill.server_received_at\n      );\n    end if;\n\n    select * into v_bill\n    from public.rubber_bills b\n    where b.idempotency_key = v_idempotency_key\n    for update;\n    if v_bill.id is not null then\n      return jsonb_build_object(''status'', ''conflict'', ''errorMessage'', ''Idempotency key already exists'');\n    end if;\n\n    select r.id, r.request_status, r.created_bill_id,\n           r.client_temp_id, r.location_id, r.idempotency_key\n      into v_request_id, v_existing_request_status, v_existing_created_bill_id,\n           v_existing_request_client_temp_id, v_existing_request_location_id,\n           v_existing_request_idempotency_key\n    from public.rubber_bill_approval_requests r\n    where r.client_temp_id = v_client_temp_id\n       or r.idempotency_key = v_idempotency_key\n    order by (r.client_temp_id = v_client_temp_id\n              and r.idempotency_key = v_idempotency_key) desc, r.created_at\n    limit 1\n    for update;\n\n    if v_request_id is not null then\n      if v_existing_request_client_temp_id is distinct from v_client_temp_id\n         or v_existing_request_location_id is distinct from v_location_id\n         or v_existing_request_idempotency_key is distinct from v_idempotency_key then\n        return jsonb_build_object(''status'', ''conflict'', ''errorMessage'', ''Approval request identity conflict'');\n      end if;\n      if v_existing_request_status = ''approved'' and v_existing_created_bill_id is not null then\n        select * into v_bill\n        from public.rubber_bills b\n        where b.id = v_existing_created_bill_id\n          and b.client_temp_id = v_client_temp_id\n          and b.location_id = v_location_id\n          and b.idempotency_key = v_idempotency_key;\n        if v_bill.id is null then\n          return jsonb_build_object(''status'', ''conflict'', ''errorMessage'', ''Approved request identity conflict'');\n        end if;\n        return jsonb_build_object(\n          ''status'', ''synced'',\n          ''id'', v_bill.id,\n          ''serverBillNo'', v_bill.server_bill_no,\n          ''revisionNo'', v_bill.revision_no,\n          ''serverReceivedAt'', v_bill.server_received_at\n        );\n      end if;\n      return jsonb_build_object(\n        ''status'', ''pending_approval'',\n        ''requestId'', v_request_id,\n        ''operation'', v_operation,\n        ''clientTempId'', v_client_temp_id\n      );\n    end if;\n  end if;\n\n  select name, phone';
  v_new_lock_corrected constant text := replace(v_new_lock, 'r.created_at', 'r.requested_at');
  v_old_late_lookup constant text := E'  if v_operation = ''create'' then\n    perform pg_advisory_xact_lock(hashtext(''rubber-bill-create:'' || v_client_temp_id));\n\n    select id, request_status, created_bill_id\n      into v_request_id, v_existing_request_status, v_existing_created_bill_id\n    from public.rubber_bill_approval_requests\n    where idempotency_key = v_idempotency_key;\n\n    if v_request_id is not null then\n      if v_existing_request_status = ''approved'' and v_existing_created_bill_id is not null then\n        select *\n          into v_bill\n        from public.rubber_bills\n        where id = v_existing_created_bill_id;\n        return jsonb_build_object(\n          ''status'', ''synced'',\n          ''id'', v_bill.id,\n          ''serverBillNo'', v_bill.server_bill_no,\n          ''revisionNo'', v_bill.revision_no,\n          ''serverReceivedAt'', v_bill.server_received_at\n        );\n      end if;\n      return jsonb_build_object(\n        ''status'', ''pending_approval'',\n        ''requestId'', v_request_id,\n        ''operation'', v_operation,\n        ''clientTempId'', v_client_temp_id\n      );\n    end if;\n\n    if v_price_cap is not null and v_has_exceeded_cap then';
  v_new_late_lookup constant text := E'  if v_operation = ''create'' then\n    if v_price_cap is not null and v_has_exceeded_cap then';
begin
  select pg_get_functiondef(
    'private.sync_rubber_bill_approval_20260823010000(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_new_declarations in v_definition) > 0
     and position(v_new_lock_corrected in v_definition) > 0
     and position(v_new_late_lookup in v_definition) > 0
     and position(v_old_late_lookup in v_definition) = 0 then
    return;
  end if;
  if position(v_old_declarations in v_definition) = 0
     or position(v_old_lock in v_definition) = 0
     or position(v_old_late_lookup in v_definition) = 0
     or length(v_definition) - length(replace(v_definition, v_old_declarations, ''))
       <> length(v_old_declarations)
     or length(v_definition) - length(replace(v_definition, v_old_lock, ''))
       <> length(v_old_lock)
     or length(v_definition) - length(replace(v_definition, v_old_late_lookup, ''))
       <> length(v_old_late_lookup) then
    raise exception 'Could not install early Rubber Bill create replay identity checks';
  end if;

  v_definition := replace(v_definition, v_old_declarations, v_new_declarations);
  v_definition := replace(v_definition, v_old_lock, v_new_lock_corrected);
  v_definition := replace(v_definition, v_old_late_lookup, v_new_late_lookup);
  if position(v_old_declarations in v_definition) > 0
     or position(v_old_late_lookup in v_definition) > 0
     or position(v_new_declarations in v_definition) = 0
     or position(v_new_lock_corrected in v_definition) = 0
     or position(v_new_late_lookup in v_definition) = 0 then
    raise exception 'Could not install early Rubber Bill create replay identity checks';
  end if;
  execute v_definition;
end
$$;

revoke all on function private.sync_rubber_bill_approval_20260823010000(jsonb)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
