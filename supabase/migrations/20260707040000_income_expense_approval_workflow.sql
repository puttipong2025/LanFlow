-- Income/Expense approval workflow.
-- Approval is online-only and gates transactions before they become income_expense rows.

create table public.income_expense_approval_settings (
  id boolean primary key default true check (id),
  applies_to text not null default 'both' check (applies_to in ('income', 'expense', 'both')),
  approval_min_amount numeric(12,2),
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  updated_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.income_expense_approval_settings (id, applies_to, approval_min_amount)
values (true, 'both', null)
on conflict (id) do nothing;

create table public.income_expense_approval_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  match_mode text not null default 'contains' check (match_mode in ('contains', 'exact')),
  applies_to text not null default 'expense' check (applies_to in ('income', 'expense', 'both')),
  is_active boolean not null default true,
  approval_min_amount numeric(12,2),
  created_by_user_id uuid references public.profiles(id),
  created_by_name text,
  created_by_phone text,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index income_expense_approval_keywords_active_unique
  on public.income_expense_approval_keywords (lower(trim(keyword)), applies_to)
  where is_active = true and deleted_at is null;

create table public.income_expense_approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_status text not null default 'pending'
    check (request_status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_operation text not null check (requested_operation in ('create', 'update', 'delete')),
  request_idempotency_key text not null unique,
  requested_payload jsonb not null,
  source_income_expense_id uuid references public.income_expense(id),
  approved_income_expense_id uuid references public.income_expense(id),
  matched_keyword_id uuid references public.income_expense_approval_keywords(id),
  matched_keyword text,
  matched_reason text not null default 'keyword'
    check (matched_reason in ('keyword', 'amount_threshold', 'keyword_and_amount')),
  location_id uuid not null references public.locations(id),
  tx_type text not null check (tx_type in ('income', 'expense')),
  title text not null,
  cost numeric(12,2) not null,
  requested_by_user_id uuid not null references public.profiles(id),
  requested_by_name text not null,
  requested_by_phone text not null,
  decided_by_user_id uuid references public.profiles(id),
  decided_by_name text,
  decided_by_phone text,
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.income_expense_approval_settings enable row level security;
alter table public.income_expense_approval_keywords enable row level security;
alter table public.income_expense_approval_requests enable row level security;

create policy "income_expense_approval_settings_read"
  on public.income_expense_approval_settings for select to authenticated
  using (true);

create policy "income_expense_approval_settings_super_admin_write"
  on public.income_expense_approval_settings for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "income_expense_approval_keywords_read"
  on public.income_expense_approval_keywords for select to authenticated
  using (is_active = true or public.is_super_admin());

create policy "income_expense_approval_keywords_super_admin_write"
  on public.income_expense_approval_keywords for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "income_expense_approval_requests_read"
  on public.income_expense_approval_requests for select to authenticated
  using (
    public.is_super_admin()
    or requested_by_user_id = auth.uid()
    or public.can_access_location(location_id)
  );

revoke all on table public.income_expense_approval_settings from anon, authenticated;
revoke all on table public.income_expense_approval_keywords from anon, authenticated;
revoke all on table public.income_expense_approval_requests from anon, authenticated;

grant select, insert, update on table public.income_expense_approval_settings to authenticated;
grant select, insert, update on table public.income_expense_approval_keywords to authenticated;
grant select on table public.income_expense_approval_requests to authenticated;

create or replace function public.create_income_expense_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation text;
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

  v_request_key := payload->>'idempotencyKey';
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
  where request_idempotency_key = v_request_key
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'pending',
      'requestId', v_existing_id,
      'requestStatus', v_existing_status
    );
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

create or replace function public.decide_income_expense_approval_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.income_expense_approval_requests%rowtype;
  v_decider_id uuid;
  v_decider_name text;
  v_decider_phone text;
  v_payload jsonb;
  v_operation text;
  v_location_id uuid;
  v_type text;
  v_bill_option text;
  v_cost numeric;
  v_client_temp_id text;
  v_idempotency_key text;
  v_existing_id uuid;
  v_existing_idempotency text;
  v_server_bill_no text;
  v_date text;
  v_next_seq integer;
  v_row_id uuid;
  v_revision integer;
  v_sync_result jsonb;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'เฉพาะ super_admin เท่านั้นที่อนุมัติหรือปฏิเสธได้');
  end if;

  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid decision');
  end if;

  select *
    into v_request
  from public.income_expense_approval_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบคำขออนุมัติ');
  end if;

  if v_request.request_status != 'pending' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'คำขอนี้ถูกดำเนินการแล้ว');
  end if;

  v_decider_id := auth.uid();
  select name, phone into v_decider_name, v_decider_phone
  from public.profiles
  where id = v_decider_id;

  if p_decision = 'rejected' then
    update public.income_expense_approval_requests
    set request_status = 'rejected',
        decided_by_user_id = v_decider_id,
        decided_by_name = coalesce(v_decider_name, ''),
        decided_by_phone = coalesce(v_decider_phone, ''),
        decided_at = now(),
        decision_comment = p_comment,
        updated_at = now()
    where id = v_request.id;

    return jsonb_build_object('status', 'rejected', 'requestId', v_request.id);
  end if;

  v_payload := v_request.requested_payload;
  v_operation := v_payload->>'operation';

  if v_operation = 'create' then
    v_location_id := (v_payload->>'locationId')::uuid;
    v_type := v_payload->>'type';
    v_bill_option := v_payload->>'billOption';
    v_cost := (v_payload->>'cost')::numeric;
    v_client_temp_id := v_payload->>'clientTempId';
    v_idempotency_key := v_payload->>'idempotencyKey';

    select id, idempotency_key, server_bill_no, revision_no
      into v_existing_id, v_existing_idempotency, v_server_bill_no, v_revision
    from public.income_expense
    where client_temp_id = v_client_temp_id
    for update;

    if v_existing_id is not null and v_existing_idempotency = v_idempotency_key then
      v_row_id := v_existing_id;
    elsif v_existing_id is not null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการนี้ถูกสร้างไปแล้ว');
    else
      v_date := to_char((v_payload->>'txDate')::date, 'YYMMDD');
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));

      select count(*) + 1 into v_next_seq
      from public.income_expense
      where location_id = v_location_id
        and tx_date = (v_payload->>'txDate')::date
        and server_bill_no is not null;

      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');

      insert into public.income_expense (
        client_temp_id, idempotency_key, revision_no, sync_status, record_status,
        location_id, type, number, local_bill_no, server_bill_no,
        tx_date, title, cost, unit, price, bill_option,
        client_recorded_at, client_created_at, server_received_at,
        created_by_user_id, created_by_name, created_by_phone
      ) values (
        v_client_temp_id,
        v_idempotency_key,
        1,
        'synced',
        'active',
        v_location_id,
        v_type::transaction_type,
        v_server_bill_no,
        v_payload->>'localBillNo',
        v_server_bill_no,
        (v_payload->>'txDate')::date,
        v_payload->>'title',
        v_cost,
        case when v_bill_option = 'บิลขาย' then v_payload->>'unit' else null end,
        case when v_bill_option = 'บิลขาย' then (v_payload->>'price')::numeric else null end,
        v_bill_option,
        (v_payload->>'clientRecordedAt')::timestamptz,
        (v_payload->>'clientCreatedAt')::timestamptz,
        now(),
        v_request.requested_by_user_id,
        v_request.requested_by_name,
        v_request.requested_by_phone
      )
      returning id, revision_no into v_row_id, v_revision;
    end if;
  else
    v_sync_result := public.sync_income_expense(v_payload);

    if coalesce(v_sync_result->>'status', 'failed') != 'synced' then
      return v_sync_result;
    end if;

    v_row_id := (v_sync_result->>'id')::uuid;
  end if;

  update public.income_expense_approval_requests
  set request_status = 'approved',
      approved_income_expense_id = v_row_id,
      decided_by_user_id = v_decider_id,
      decided_by_name = coalesce(v_decider_name, ''),
      decided_by_phone = coalesce(v_decider_phone, ''),
      decided_at = now(),
      decision_comment = p_comment,
      updated_at = now()
  where id = v_request.id;

  return jsonb_build_object(
    'status', 'approved',
    'requestId', v_request.id,
    'incomeExpenseId', v_row_id
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.create_income_expense_approval_request(jsonb) from public, anon;
revoke all on function public.decide_income_expense_approval_request(uuid, text, text) from public, anon;
grant execute on function public.create_income_expense_approval_request(jsonb) to authenticated;
grant execute on function public.decide_income_expense_approval_request(uuid, text, text) to authenticated;
