-- Local fixture-based contract check; all changes roll back.
begin;
set local statement_timeout = '15s';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  request_id uuid := gen_random_uuid();
  branch_id uuid;
  error_code text;
begin
  select location_id into strict branch_id from public.user_locations
  where user_id = auth.uid() order by is_primary desc, location_id limit 1;
  insert into public.rubber_bill_approval_requests (
    id, operation, request_status, location_id, client_temp_id, idempotency_key,
    base_revision_no, matched_reasons, configured_price_snapshot,
    edit_window_minutes_snapshot, proposed_payload, requested_by_user_id,
    requested_by_name, requested_by_phone
  ) select request_id, 'create', 'pending', branch_id, request_id::text,
    'corrupt-contract:' || request_id::text, 0, array['non_current_date'], null,
    30, '{}'::jsonb, id, name, phone from public.profiles where id = auth.uid();

  begin
    perform public.approve_rubber_bill_approval_request(request_id);
  exception when others then error_code := sqlstate;
  end;
  if error_code is distinct from 'RB500' then
    raise exception 'Expected RB500 for persisted corrupt payload, got %', error_code;
  end if;
  if not exists (select 1 from public.rubber_bill_approval_requests
    where id = request_id and request_status = 'pending' and approved_at is null) then
    raise exception 'Failed approval changed request state';
  end if;

  error_code := null;
  begin
    perform public.approve_rubber_bill_approval_request(gen_random_uuid());
  exception when others then error_code := sqlstate;
  end;
  if error_code is distinct from 'P0001' then
    raise exception 'Expected P0001 for a missing request, got %', error_code;
  end if;
end $$;
rollback;
