-- Keep sale creation immediate, but route qualifying sale updates through the
-- existing Income/Expense approval contract. Expose pending state from the
-- operational feed so every user with branch access receives the same lock.

create index if not exists income_expense_approval_pending_source_idx
  on public.income_expense_approval_requests (
    location_id,
    source_income_expense_id,
    created_at,
    id
  )
  where request_status = 'pending' and source_income_expense_id is not null;

create or replace function public.create_income_expense_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
  v_request_key text := nullif(payload->>'idempotencyKey', '');
begin
  if payload->>'billOption' = 'บิลขาย'
     and payload->>'operation' = 'create' then
    if not coalesce(private.is_active_user(), false) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
    end if;
    if v_location_id is null
       or not exists (select 1 from public.locations where id = v_location_id)
       or not public.can_access_location(v_location_id) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
    end if;
    return jsonb_build_object('status', 'no_approval');
  end if;

  if coalesce(private.is_active_user(), false) and v_request_key is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('income-expense-approval:' || v_request_key, 0)
    );
  end if;

  return private.create_income_expense_approval_request_20260805080000(payload);
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_approval jsonb;
  v_stock_result jsonb;
begin
  if coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true' then
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;

  if payload->>'billOption' = 'บิลขาย'
     and payload->>'operation' in ('create', 'update') then
    v_approval := public.create_income_expense_approval_request(payload);
    if v_approval->>'status' = 'pending' then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_approval->>'requestId',
        'matchedReasons', coalesce(v_approval->'matchedReasons', '[]'::jsonb),
        'errorMessage', 'รายการนี้ต้องรออนุมัติ'
      );
    end if;
    if v_approval->>'status' <> 'no_approval' then
      return v_approval;
    end if;

    v_stock_result := private.preflight_income_sale_stock(payload);
    if v_stock_result->>'status' <> 'ok' then
      return v_stock_result;
    end if;
    perform set_config('app.bypass_income_expense_approval', 'true', true);
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

alter function public.get_income_expense_operational_feed(uuid, text, text, text)
  rename to get_income_expense_operational_feed_20260907010000_base;

revoke all on function public.get_income_expense_operational_feed_20260907010000_base(uuid, text, text, text)
  from public, anon, authenticated;

create or replace function private.income_expense_pending_fields(
  p_location_id uuid,
  p_row jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'approvalPending', true,
      'approvalRequestId', request.id,
      'approvalRequestType', 'income_expense',
      'approvalOperation', request.requested_operation,
      'approvalReasons', to_jsonb(request.matched_reasons)
    )
    from public.income_expense_approval_requests request
    where request.location_id = p_location_id
      and request.source_income_expense_id = case
        when p_row->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (p_row->>'id')::uuid
        else null
      end
      and request.request_status = 'pending'
    order by request.created_at, request.id
    limit 1
  ), '{}'::jsonb);
$$;

revoke all on function private.income_expense_pending_fields(uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.get_income_expense_operational_feed(
  p_location_id uuid,
  p_mode text default 'latest',
  p_search text default '',
  p_cursor text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_rows jsonb;
  v_pending_creates jsonb := '[]'::jsonb;
  v_search text := lower(regexp_replace(btrim(coalesce(p_search, '')), '\s+', ' ', 'g'));
begin
  v_result := public.get_income_expense_operational_feed_20260907010000_base(
    p_location_id,
    p_mode,
    p_search,
    p_cursor
  );

  if p_mode <> 'latest' then
    return v_result;
  end if;

  select coalesce(
    jsonb_agg(
      entry.row_data || private.income_expense_pending_fields(p_location_id, entry.row_data)
      order by entry.position
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(coalesce(v_result->'rows', '[]'::jsonb))
    with ordinality entry(row_data, position);

  if p_cursor is null then
    select coalesce(jsonb_agg(pending.row_data order by pending.created_at desc, pending.id desc), '[]'::jsonb)
    into v_pending_creates
    from (
      select request.id, request.created_at, jsonb_strip_nulls(jsonb_build_object(
        'id', 'approval-income:' || request.id,
        'clientTempId', coalesce(request.requested_payload->>'clientTempId', request.id::text),
        'localBillNo', coalesce(request.requested_payload->>'localBillNo', 'REQ-' || left(request.id::text, 8)),
        'serverBillNo', request.requested_payload->>'serverBillNo',
        'idempotencyKey', request.request_idempotency_key,
        'locationId', request.location_id,
        'syncStatus', 'pending',
        'recordStatus', 'active',
        'type', request.tx_type,
        'number', coalesce(
          request.requested_payload->>'number',
          request.requested_payload->>'serverBillNo',
          request.requested_payload->>'localBillNo',
          'REQ-' || left(request.id::text, 8)
        ),
        'txDate', case
          when coalesce(request.requested_payload->>'txDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
            then request.requested_payload->>'txDate'
          else (request.created_at at time zone 'Asia/Bangkok')::date::text
        end,
        'title', request.title,
        'cost', request.cost,
        'billOption', coalesce(
          request.requested_payload->>'billOption',
          case when request.tx_type = 'income' then 'รายรับ' else 'ค่าใช้จ่าย' end
        ),
        'clientRecordedAt', coalesce(request.requested_payload->>'clientRecordedAt', request.created_at::text),
        'clientCreatedAt', coalesce(request.requested_payload->>'clientCreatedAt', request.created_at::text),
        'serverReceivedAt', request.created_at,
        'revisionNo', coalesce((request.requested_payload->>'expectedRevisionNo')::integer, 0),
        'createdByUserId', request.requested_by_user_id,
        'createdByName', request.requested_by_name,
        'createdByPhone', request.requested_by_phone,
        'approvalPending', true,
        'approvalRequestId', request.id,
        'approvalRequestType', 'income_expense',
        'approvalOperation', request.requested_operation,
        'approvalReasons', to_jsonb(request.matched_reasons)
      )) row_data
      from public.income_expense_approval_requests request
      where request.location_id = p_location_id
        and request.request_status = 'pending'
        and request.requested_operation = 'create'
        and request.requested_by_user_id = auth.uid()
        and (
          v_search = ''
          or position(v_search in lower(regexp_replace(concat_ws(' ',
            coalesce(
              request.requested_payload->>'number',
              request.requested_payload->>'serverBillNo',
              request.requested_payload->>'localBillNo'
            ),
            coalesce(
              request.requested_payload->>'txDate',
              (request.created_at at time zone 'Asia/Bangkok')::date::text
            ),
            request.title,
            coalesce(request.requested_payload->>'billOption', request.tx_type),
            request.requested_by_name,
            request.requested_by_phone
          ), '\s+', ' ', 'g'))) > 0
        )
    ) pending;
  end if;

  return jsonb_set(v_result, '{rows}', v_pending_creates || v_rows, true);
end;
$$;

revoke all on function public.get_income_expense_operational_feed(uuid, text, text, text)
  from public, anon;
grant execute on function public.get_income_expense_operational_feed(uuid, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
