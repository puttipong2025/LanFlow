-- Treat bill mutations and approval requests as one idempotency-key namespace.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    $old$  if v_location_id is null or v_expected_revision is null or v_expected_revision < 0
     or coalesce(payload->>'clientTempId', '') = ''
     or coalesce(payload->>'idempotencyKey', '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;

  select * into v_existing_bill$old$,
    $new$  if v_location_id is null or v_expected_revision is null or v_expected_revision < 0
     or coalesce(payload->>'clientTempId', '') = ''
     or coalesce(payload->>'idempotencyKey', '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'rubber-bill-idempotency:' || (payload->>'idempotencyKey'),
    0
  ));
  if exists (
    select 1
    from public.rubber_bills b
    where b.idempotency_key = payload->>'idempotencyKey'
      and (
        b.client_temp_id is distinct from payload->>'clientTempId'
        or b.location_id is distinct from v_location_id
      )
  ) or exists (
    select 1
    from public.rubber_bill_approval_requests r
    where r.idempotency_key = payload->>'idempotencyKey'
      and (
        r.client_temp_id is distinct from payload->>'clientTempId'
        or r.location_id is distinct from v_location_id
      )
  ) then
    return jsonb_build_object(
      'status', 'conflict',
      'errorMessage', 'รหัสคำขอถูกใช้กับรายการอื่นแล้ว'
    );
  end if;

  select * into v_existing_bill$new$
  );
  if v_updated = v_definition then
    raise exception 'rubber idempotency namespace guard not found';
  end if;

  execute v_updated;
end;
$migration$;
