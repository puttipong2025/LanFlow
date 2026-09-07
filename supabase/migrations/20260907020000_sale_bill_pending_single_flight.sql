create or replace function public.create_income_expense_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := lower(coalesce(payload->>'operation', ''));
  v_bill_option text := coalesce(payload->>'billOption', '');
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
  v_client_temp_id text := nullif(btrim(payload->>'clientTempId'), '');
  v_idempotency_key text := nullif(btrim(payload->>'idempotencyKey'), '');
  v_existing_request record;
  v_result jsonb;
begin
  if v_bill_option = 'บิลขาย'
     and v_operation = 'create' then
    if not coalesce(private.is_active_user(), false) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'Unauthorized or inactive user'
      );
    end if;

    if v_location_id is null
       or not exists (select 1 from public.locations where id = v_location_id)
       or not public.can_access_location(v_location_id) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'Location access denied'
      );
    end if;

    return jsonb_build_object('status', 'no_approval');
  end if;

  if coalesce(private.is_active_user(), false)
     and v_bill_option = 'บิลขาย'
     and v_operation in ('update', 'delete')
     and v_client_temp_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('income-expense-approval-source:' || v_client_temp_id, 0)
    );

    select
      request.id,
      request.matched_reasons,
      request.matched_keyword
    into v_existing_request
    from public.income_expense_approval_requests request
    join public.income_expense source
      on source.id = request.source_income_expense_id
    where source.client_temp_id = v_client_temp_id
      and source.location_id = v_location_id
      and public.can_access_location(source.location_id)
      and request.request_status = 'pending'
    order by request.created_at desc, request.id desc
    limit 1;

    if v_existing_request.id is not null then
      return jsonb_build_object(
        'status', 'pending',
        'requestId', v_existing_request.id,
        'requestStatus', 'pending',
        'matchedReasons', to_jsonb(coalesce(v_existing_request.matched_reasons, array[]::text[])),
        'matchedKeyword', v_existing_request.matched_keyword
      );
    end if;
  elsif v_idempotency_key is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('income-expense-approval-idempotency:' || v_idempotency_key, 0)
    );
  end if;

  v_result := private.create_income_expense_approval_request_20260805080000(payload);

  if v_result->>'status' = 'pending'
     and v_result->>'requestStatus' = 'approved' then
    return jsonb_build_object('status', 'no_approval');
  end if;

  return v_result;
exception
  when others then
    return jsonb_build_object(
      'status', 'failed',
      'errorMessage', sqlerrm
    );
end;
$$;

revoke all on function public.create_income_expense_approval_request(jsonb) from public;
grant execute on function public.create_income_expense_approval_request(jsonb) to authenticated;

notify pgrst, 'reload schema';
