-- Add one independent non-current Bangkok business-date rule to each existing
-- approval workflow. Income approval rows are intentionally migrated only when
-- the table is empty; the production preflight established that precondition.

do $$
begin
  if exists (select 1 from public.income_expense_approval_requests) then
    raise exception 'income_expense_approval_requests must be empty before this migration';
  end if;
end;
$$;

alter table public.rubber_bill_approval_settings
  add column non_current_date_requires_approval boolean not null default false;

alter table public.income_expense_approval_settings
  add column non_current_date_requires_approval boolean not null default false;

alter table public.income_expense_approval_requests
  drop constraint income_expense_approval_requests_matched_reason_check;
alter table public.income_expense_approval_requests
  alter column matched_reason drop default;
alter table public.income_expense_approval_requests
  rename column matched_reason to matched_reasons;
alter table public.income_expense_approval_requests
  alter column matched_reasons type text[] using array[matched_reasons];
alter table public.income_expense_approval_requests
  add constraint income_expense_approval_requests_matched_reasons_check
  check (
    cardinality(matched_reasons) > 0
    and matched_reasons <@ array['keyword', 'amount_threshold', 'non_current_date']::text[]
  );

alter table public.rubber_bill_approval_requests
  drop constraint rubber_bill_approval_requests_matched_reasons_check;
alter table public.rubber_bill_approval_requests
  add constraint rubber_bill_approval_requests_matched_reasons_check
  check (
    cardinality(matched_reasons) > 0
    and matched_reasons <@ array['price', 'time', 'non_current_date']::text[]
  );

-- Keep the current validation/sale-bill implementation, changing only its
-- reason collection and Bangkok-date evaluation.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.create_income_expense_approval_request(jsonb)'::regprocedure
  ) into v_definition;

  v_definition := replace(
    v_definition,
    '  v_reason text;' || chr(10),
    '  v_reasons text[] := array[]::text[];' || chr(10)
      || '  v_business_date date;' || chr(10)
      || '  v_non_current_date_requires_approval boolean;' || chr(10)
  );
  v_definition := replace(
    v_definition,
    '  select approval_min_amount, applies_to' || chr(10)
      || '    into v_threshold, v_threshold_scope' || chr(10),
    '  select approval_min_amount, applies_to, non_current_date_requires_approval' || chr(10)
      || '    into v_threshold, v_threshold_scope, v_non_current_date_requires_approval' || chr(10)
  );
  v_definition := replace(
    v_definition,
    '  if v_keyword_id is null and not v_amount_match then' || chr(10)
      || '    return jsonb_build_object(''status'', ''no_approval'');' || chr(10)
      || '  end if;' || chr(10) || chr(10)
      || '  v_reason := case' || chr(10)
      || '    when v_keyword_id is not null and v_amount_match then ''keyword_and_amount''' || chr(10)
      || '    when v_amount_match then ''amount_threshold''' || chr(10)
      || '    else ''keyword''' || chr(10)
      || '  end;' || chr(10),
    '  if v_keyword_id is not null then' || chr(10)
      || '    v_reasons := array_append(v_reasons, ''keyword'');' || chr(10)
      || '  end if;' || chr(10)
      || '  if v_amount_match then' || chr(10)
      || '    v_reasons := array_append(v_reasons, ''amount_threshold'');' || chr(10)
      || '  end if;' || chr(10)
      || '  begin' || chr(10)
      || '    v_business_date := case when v_operation = ''delete''' || chr(10)
      || '      then v_existing.tx_date' || chr(10)
      || '      else (payload->>''txDate'')::date end;' || chr(10)
      || '  exception when others then' || chr(10)
      || '    return jsonb_build_object(''status'', ''failed'', ''errorMessage'', ''วันที่รายการไม่ถูกต้อง'');' || chr(10)
      || '  end;' || chr(10)
      || '  if coalesce(v_non_current_date_requires_approval, false)' || chr(10)
      || '     and v_business_date is distinct from (clock_timestamp() at time zone ''Asia/Bangkok'')::date then' || chr(10)
      || '    v_reasons := array_append(v_reasons, ''non_current_date'');' || chr(10)
      || '  end if;' || chr(10)
      || '  if cardinality(v_reasons) = 0 then' || chr(10)
      || '    return jsonb_build_object(''status'', ''no_approval'');' || chr(10)
      || '  end if;' || chr(10)
  );
  v_definition := replace(
    v_definition,
    'source_income_expense_id, matched_keyword_id, matched_keyword, matched_reason,',
    'source_income_expense_id, matched_keyword_id, matched_keyword, matched_reasons,'
  );
  v_definition := replace(
    v_definition,
    'v_existing.id, v_keyword_id, v_keyword, v_reason,',
    'v_existing.id, v_keyword_id, v_keyword, v_reasons,'
  );
  v_definition := replace(
    v_definition,
    '''matchedReason'', v_reason,',
    '''matchedReasons'', to_jsonb(v_reasons),'
  );

  if position('v_reason text;' in v_definition) > 0
     or position('matched_keyword, matched_reason,' in v_definition) > 0
     or position('v_keyword, v_reason,' in v_definition) > 0 then
    raise exception 'Could not update income approval function definition';
  end if;
  execute v_definition;
end;
$$;

-- Preserve the current bill/sale-bill dispatcher behind a private boundary,
-- then enforce all existing approval rules for direct calls from old clients.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.sync_income_expense(jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(
    v_definition,
    'FUNCTION public.sync_income_expense(payload jsonb)',
    'FUNCTION private.sync_income_expense_dispatch_20260805020000(payload jsonb)'
  );
  if position('FUNCTION public.sync_income_expense(payload jsonb)' in v_definition) > 0 then
    raise exception 'Could not preserve income dispatcher';
  end if;
  execute v_definition;
end;
$$;

revoke all on function private.sync_income_expense_dispatch_20260805020000(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_approval jsonb;
begin
  if coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true' then
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;

  v_approval := public.create_income_expense_approval_request(payload);
  if v_approval->>'status' = 'no_approval' then
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;
  if v_approval->>'status' = 'pending' then
    return jsonb_build_object(
      'status', 'pending_approval',
      'requestId', v_approval->>'requestId',
      'matchedReasons', coalesce(v_approval->'matchedReasons', '[]'::jsonb),
      'errorMessage', 'รายการนี้ต้องรออนุมัติ'
    );
  end if;
  return v_approval;
end;
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;

-- Reuse the current rubber approval implementation and seed its reason array
-- from a private-only flag calculated by the public authoritative wrapper.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure)
    into v_definition;
  v_definition := replace(
    v_definition,
    'FUNCTION public.sync_rubber_bill(payload jsonb)',
    'FUNCTION private.sync_rubber_bill_approval_20260805020000(payload jsonb)'
  );
  v_definition := replace(
    v_definition,
    '  v_reasons text[] := array[]::text[];',
    '  v_reasons text[] := case when payload->>''forceNonCurrentDateApproval'' = ''true'' '
      || 'then array[''non_current_date'']::text[] else array[]::text[] end;'
  );
  v_definition := replace(
    v_definition,
    '    if v_price_cap is null or not v_has_exceeded_cap then',
    '    if cardinality(v_reasons) = 0 and (v_price_cap is null or not v_has_exceeded_cap) then'
  );
  if position('FUNCTION public.sync_rubber_bill(payload jsonb)' in v_definition) > 0
     or position('  v_reasons text[] := array[]::text[];' in v_definition) > 0
     or position('    if v_price_cap is null or not v_has_exceeded_cap then' in v_definition) > 0 then
    raise exception 'Could not preserve rubber approval dispatcher';
  end if;
  execute v_definition;
end;
$$;

revoke all on function private.sync_rubber_bill_approval_20260805020000(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_operation text := payload->>'operation';
  v_business_date date;
  v_requires_approval boolean := false;
begin
  begin
    if v_operation = 'delete' then
      select bill_date into v_business_date
      from public.rubber_bills
      where client_temp_id = payload->>'clientTempId';
    elsif v_operation in ('create', 'update') then
      v_business_date := (payload->>'billDate')::date;
    end if;
  exception when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'วันที่บิลไม่ถูกต้อง');
  end;

  select coalesce(non_current_date_requires_approval, false)
    into v_requires_approval
  from public.rubber_bill_approval_settings
  where id = true;

  if v_requires_approval
     and v_business_date is distinct from (clock_timestamp() at time zone 'Asia/Bangkok')::date then
    payload := payload || jsonb_build_object('forceNonCurrentDateApproval', true);
  end if;

  return private.sync_rubber_bill_approval_20260805020000(payload);
end;
$$;

revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

create or replace function public.save_rubber_bill_approval_settings(
  p_edit_window_minutes integer,
  p_configured_price numeric,
  p_non_current_date_requires_approval boolean
)
returns public.rubber_bill_approval_settings
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_result public.rubber_bill_approval_settings%rowtype;
  v_actor_name text;
  v_actor_phone text;
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าการอนุมัติบิลยาง';
  end if;
  if p_edit_window_minutes is null or p_edit_window_minutes < 0 then
    raise exception 'จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  if p_configured_price is not null
     and (p_configured_price < 0 or scale(p_configured_price) > 2) then
    raise exception 'ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;

  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bill_approval_settings
  set edit_window_minutes = p_edit_window_minutes,
      configured_price = p_configured_price,
      non_current_date_requires_approval = coalesce(p_non_current_date_requires_approval, false),
      updated_by_user_id = auth.uid(),
      updated_by_name = coalesce(v_actor_name, ''),
      updated_by_phone = coalesce(v_actor_phone, ''),
      updated_at = now()
  where id = true
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.save_rubber_bill_approval_settings(integer, numeric, boolean)
  from public, anon;
grant execute on function public.save_rubber_bill_approval_settings(integer, numeric, boolean)
  to authenticated;

-- Compatibility for an already-open settings screen from the previous client.
create or replace function public.save_rubber_bill_approval_settings(
  p_edit_window_minutes integer,
  p_configured_price numeric
)
returns public.rubber_bill_approval_settings
language sql
security definer
set search_path = public, private
as $$
  select public.save_rubber_bill_approval_settings(
    p_edit_window_minutes,
    p_configured_price,
    coalesce((select non_current_date_requires_approval from public.rubber_bill_approval_settings where id = true), false)
  );
$$;

revoke all on function public.save_rubber_bill_approval_settings(integer, numeric)
  from public, anon;
grant execute on function public.save_rubber_bill_approval_settings(integer, numeric)
  to authenticated;
