-- Migration: 20260707070000_income_expense_sync_rpc_lockdown.sql

-- 1. Redefine decide_income_expense_approval_request to inject bypass flag
create or replace function public.decide_income_expense_approval_request(p_request_id uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
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
    return jsonb_build_object('status', 'failed', 'errorMessage', 'คำขอนี้ถูกดำเนินการไปแล้ว');
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
    perform set_config('app.bypass_income_expense_approval', 'true', true);
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

-- 2. Redefine sync_income_expense to enforce approval keyword lockdown and branch transfer lockdown
create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $block$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
  v_record_status record_status;
  v_idempotency_key text;

  v_row_id uuid;
  v_current_revision integer;
  v_server_bill_no text;
  v_existing_idempotency_key text;

  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;

  v_type text;
  v_bill_option text;
  v_cost numeric;
  v_date text;
  v_next_seq integer;
  
  v_title text;
  v_internal_bypass boolean;
  v_keyword_id uuid;
  v_threshold numeric;
  v_threshold_scope text;
  v_amount_match boolean;
  v_keyword_match boolean;
begin
  -- 1. Auth check
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles where id = v_created_by_user_id;

  -- 2. Extract payload fields
  v_operation := payload->>'operation';
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  v_client_temp_id := payload->>'clientTempId';
  v_location_id := (payload->>'locationId')::uuid;
  v_record_status := (payload->>'recordStatus')::record_status;
  v_idempotency_key := payload->>'idempotencyKey';
  v_type := payload->>'type';
  v_bill_option := payload->>'billOption';
  v_cost := (payload->>'cost')::numeric;
  v_title := trim(coalesce(payload->>'title', ''));

  -- Phase 3: Check for internal bypass flag from decide_income_expense_approval_request
  v_internal_bypass := coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true';

  -- Phase 3: Lockdown Branch Transfers direct creation
  if not v_internal_bypass and v_operation = 'create' then
    if v_title like 'รับโอนจาก%' or v_title like 'โยกเงินไป%' or v_title like 'สาขาจ่ายส่วนต่างให้%' or lower(v_title) = 'branch transfer' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'ไม่สามารถซิงก์รายการโยกเงินโดยตรงได้ ต้องทำผ่านระบบโยกเงินเท่านั้น');
    end if;
  end if;

  -- Phase 3: Lockdown Approval Keywords direct creation/update
  if not v_internal_bypass and v_operation in ('create', 'update') then
    select id
      into v_keyword_id
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
    limit 1;
    v_keyword_match := v_keyword_id is not null;

    select approval_min_amount, applies_to
      into v_threshold, v_threshold_scope
    from public.income_expense_approval_settings
    where id = true;

    v_amount_match := v_threshold is not null
      and v_cost >= v_threshold
      and coalesce(v_threshold_scope, 'both') in (v_type, 'both');

    if v_keyword_match or v_amount_match then
       return jsonb_build_object('status', 'conflict', 'errorMessage', 'รายการนี้ต้องขออนุมัติ ไม่สามารถซิงก์โดยตรงได้');
    end if;
  end if;

  -- Serialize all operations for the same client temp id before checking existence.
  perform pg_advisory_xact_lock(hashtext('income_expense:' || v_client_temp_id));

  -- 3. Location access check
  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  -- 4. Validate business rules (skip for delete)
  if v_operation != 'delete' then
    if v_type not in ('income', 'expense') then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid type');
    end if;
    if v_cost is null or v_cost <= 0 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'cost must be > 0');
    end if;
    if v_bill_option is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'billOption is required');
    end if;
    -- bill_option must match type
    if v_type = 'income' and v_bill_option not in ('รายรับ', 'บิลขาย') then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid billOption for income');
    end if;
    if v_type = 'expense' and v_bill_option != 'ค่าใช้จ่าย' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid billOption for expense');
    end if;
    -- บิลขาย requires unit > 0 and price > 0
    if v_bill_option = 'บิลขาย' then
      if coalesce((payload->>'unit')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'unit must be > 0 for บิลขาย');
      end if;
      if coalesce((payload->>'price')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'price must be > 0 for บิลขาย');
      end if;
    end if;
  end if;

  -- 5. Concurrency control (revision & idempotency)
  select id, revision_no, server_bill_no, idempotency_key
  into v_row_id, v_current_revision, v_server_bill_no, v_existing_idempotency_key
  from public.income_expense
  where client_temp_id = v_client_temp_id
  for update;

  if v_row_id is not null then
    -- Idempotency: exact same request already processed
    if v_idempotency_key = v_existing_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_row_id,
        'serverBillNo', v_server_bill_no,
        'revisionNo', v_current_revision,
        'serverReceivedAt', now()
      );
    end if;

    if v_operation = 'create' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
    else
      -- update or delete: check revision
      if v_current_revision != coalesce(v_expected_revision, v_current_revision) then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
      end if;
    end if;
  else
    -- Row does not exist
    if v_operation != 'create' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;
  end if;

  -- 6. Process operation
  if v_operation = 'delete' then
    -- Soft delete only
    update public.income_expense
    set record_status = 'deleted',
        deleted_at = now(),
        deleted_by_name = payload->>'deletedByName',
        deleted_by_phone = payload->>'deletedByPhone',
        revision_no = revision_no + 1,
        idempotency_key = v_idempotency_key,
        server_received_at = now()
    where id = v_row_id
    returning id, revision_no into v_row_id, v_current_revision;

  else
    -- Create or Update

    -- Generate server_bill_no for new records
    if v_operation = 'create' then
      v_date := to_char((payload->>'txDate')::date, 'YYMMDD');
      
      -- Lock to serialize sequence generation per location and date
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));
      
      select count(*) + 1 into v_next_seq
      from public.income_expense
      where location_id = v_location_id 
        and tx_date = (payload->>'txDate')::date
        and server_bill_no is not null;
        
      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');
    end if;

    if v_operation = 'create' then
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
        payload->>'localBillNo',
        v_server_bill_no,
        (payload->>'txDate')::date,
        v_title,
        v_cost,
        case when v_bill_option = 'บิลขาย' then payload->>'unit' else null end,
        case when v_bill_option = 'บิลขาย' then (payload->>'price')::numeric else null end,
        v_bill_option,
        (payload->>'clientRecordedAt')::timestamptz,
        (payload->>'clientCreatedAt')::timestamptz,
        now(),
        v_created_by_user_id,
        v_created_by_name,
        v_created_by_phone
      )
      returning id, revision_no into v_row_id, v_current_revision;
    else
      -- Update
      update public.income_expense
      set location_id = v_location_id,
          type = v_type::transaction_type,
          tx_date = (payload->>'txDate')::date,
          title = v_title,
          cost = v_cost,
          unit = case when v_bill_option = 'บิลขาย' then payload->>'unit' else null end,
          price = case when v_bill_option = 'บิลขาย' then (payload->>'price')::numeric else null end,
          bill_option = v_bill_option,
          client_recorded_at = (payload->>'clientRecordedAt')::timestamptz,
          revision_no = revision_no + 1,
          idempotency_key = v_idempotency_key,
          server_received_at = now()
      where id = v_row_id
      returning id, revision_no into v_row_id, v_current_revision;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_row_id,
    'serverBillNo', coalesce(v_server_bill_no, payload->>'localBillNo'),
    'revisionNo', v_current_revision,
    'serverReceivedAt', now()
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$block$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;
