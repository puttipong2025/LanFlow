-- Migration: 20260706050000_income_expense_sync_rpc.sql

drop function if exists public.sync_income_expense(jsonb);

create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- Serialize all operations for the same client temp id before checking existence.
  -- Without this, duplicate offline create replays can both miss the row, then
  -- fall through to ON CONFLICT and incorrectly bump revision_no.
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
    if v_row_id is null then
      v_date := to_char((payload->>'txDate')::date, 'YYMMDD');

      -- Advisory lock: prevent bill number race for same location+date
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));

      select count(*) + 1 into v_next_seq
      from public.income_expense
      where location_id = v_location_id
        and tx_date = (payload->>'txDate')::date
        and server_bill_no is not null;

      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');
    end if;

    -- Upsert
    insert into public.income_expense (
      client_temp_id, idempotency_key, revision_no, sync_status, record_status,
      location_id, type, number, local_bill_no, server_bill_no,
      tx_date, title, cost, unit, price, bill_option,
      client_recorded_at, client_created_at, server_received_at,
      created_by_user_id, created_by_name, created_by_phone
    ) values (
      v_client_temp_id,
      v_idempotency_key,
      coalesce(v_expected_revision + 1, 1),
      'synced',
      'active',
      v_location_id,
      v_type::transaction_type,
      coalesce(v_server_bill_no, payload->>'localBillNo'),
      payload->>'localBillNo',
      v_server_bill_no,
      (payload->>'txDate')::date,
      payload->>'title',
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
    on conflict (client_temp_id) do update set
      revision_no = public.income_expense.revision_no + 1,
      idempotency_key = excluded.idempotency_key,
      sync_status = 'synced',
      record_status = 'active',
      tx_date = excluded.tx_date,
      title = excluded.title,
      cost = excluded.cost,
      unit = excluded.unit,
      price = excluded.price,
      bill_option = excluded.bill_option,
      client_recorded_at = excluded.client_recorded_at,
      server_received_at = now()
    returning id, revision_no into v_row_id, v_current_revision;
  end if;

  -- 7. Return success
  return jsonb_build_object(
    'status', 'synced',
    'id', v_row_id,
    'serverBillNo', v_server_bill_no,
    'revisionNo', v_current_revision,
    'serverReceivedAt', now()
  );

exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;
