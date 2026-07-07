-- Rejected approval requests are audit history. Re-submitting the same payload
-- must create a new request, while pending/approved requests remain idempotent.

create or replace function public.create_income_expense_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation text;
  v_base_request_key text;
  v_request_key text;
  v_location_id uuid;
  v_type text;
  v_title text;
  v_cost numeric;
  v_active_user boolean;
  v_user_id uuid;
  v_user_name text;
  v_user_phone text;
  v_keyword_id uuid;
  v_keyword text;
  v_keyword_match boolean := false;
  v_amount_match boolean := false;
  v_threshold numeric;
  v_threshold_scope text;
  v_existing_id uuid;
  v_existing_status text;
  v_source_id uuid;
  v_request_id uuid;
  v_reason text;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_operation := payload->>'operation';
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  if v_operation = 'delete' then
    return jsonb_build_object('status', 'no_approval');
  end if;

  v_base_request_key := payload->>'idempotencyKey';
  if coalesce(v_base_request_key, '') = '' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Missing idempotency key');
  end if;

  v_location_id := (payload->>'locationId')::uuid;
  v_type := payload->>'type';
  v_title := trim(coalesce(payload->>'title', ''));
  v_cost := (payload->>'cost')::numeric;

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_type not in ('income', 'expense') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid type');
  end if;

  if v_title = '' or v_cost is null or v_cost <= 0 then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ข้อมูลรายการหรือยอดเงินไม่ถูกต้อง');
  end if;

  select id, request_status
    into v_existing_id, v_existing_status
  from public.income_expense_approval_requests
  where requested_payload->>'idempotencyKey' = v_base_request_key
    and request_status in ('pending', 'approved')
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'pending',
      'requestId', v_existing_id,
      'requestStatus', v_existing_status
    );
  end if;

  v_request_key := v_base_request_key;
  if exists (
    select 1
    from public.income_expense_approval_requests
    where request_idempotency_key = v_request_key
  ) then
    v_request_key := v_base_request_key || ':retry:' || gen_random_uuid()::text;
  end if;

  select id, keyword
    into v_keyword_id, v_keyword
  from public.income_expense_approval_keywords
  where is_active = true
    and deleted_at is null
    and applies_to in (v_type, 'both')
    and (approval_min_amount is null or v_cost >= approval_min_amount)
    and (
      (match_mode = 'exact' and lower(trim(v_title)) = lower(trim(keyword)))
      or
      (match_mode = 'contains' and position(lower(trim(keyword)) in lower(trim(v_title))) > 0)
    )
  order by length(keyword) desc, created_at asc
  limit 1;

  v_keyword_match := v_keyword_id is not null;

  select approval_min_amount, applies_to
    into v_threshold, v_threshold_scope
  from public.income_expense_approval_settings
  where id = true;

  v_amount_match := v_threshold is not null
    and v_cost >= v_threshold
    and coalesce(v_threshold_scope, 'both') in (v_type, 'both');

  if not v_keyword_match and not v_amount_match then
    return jsonb_build_object('status', 'no_approval');
  end if;

  v_reason := case
    when v_keyword_match and v_amount_match then 'keyword_and_amount'
    when v_amount_match then 'amount_threshold'
    else 'keyword'
  end;

  v_user_id := auth.uid();
  select name, phone into v_user_name, v_user_phone
  from public.profiles
  where id = v_user_id;

  if v_operation in ('update', 'delete') then
    select id into v_source_id
    from public.income_expense
    where client_temp_id = payload->>'clientTempId'
    limit 1;
  end if;

  insert into public.income_expense_approval_requests (
    requested_operation,
    request_idempotency_key,
    requested_payload,
    source_income_expense_id,
    matched_keyword_id,
    matched_keyword,
    matched_reason,
    location_id,
    tx_type,
    title,
    cost,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  ) values (
    v_operation,
    v_request_key,
    payload,
    v_source_id,
    v_keyword_id,
    v_keyword,
    v_reason,
    v_location_id,
    v_type,
    v_title,
    v_cost,
    v_user_id,
    coalesce(v_user_name, ''),
    coalesce(v_user_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending',
    'requestId', v_request_id,
    'matchedReason', v_reason,
    'matchedKeyword', v_keyword
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.create_income_expense_approval_request(jsonb) from public, anon;
grant execute on function public.create_income_expense_approval_request(jsonb) to authenticated;
