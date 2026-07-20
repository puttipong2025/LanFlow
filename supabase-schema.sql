


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'user',
    'admin',
    'super_admin'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."approval_status" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED'
);


ALTER TYPE "public"."approval_status" OWNER TO "postgres";


CREATE TYPE "public"."financial_transaction_type" AS ENUM (
    'WITHDRAWAL',
    'DEBT_INSTALLMENT',
    'ADJUSTMENT',
    'SALARY',
    'DEBT',
    'DEBT_DEDUCTION',
    'WITHDRAWAL_DEDUCTION'
);


ALTER TYPE "public"."financial_transaction_type" OWNER TO "postgres";


CREATE TYPE "public"."leave_request_type" AS ENUM (
    'FULL_DAY',
    'HALF_DAY'
);


ALTER TYPE "public"."leave_request_type" OWNER TO "postgres";


CREATE TYPE "public"."record_status" AS ENUM (
    'active',
    'deleted',
    'cancelled'
);


ALTER TYPE "public"."record_status" OWNER TO "postgres";


CREATE TYPE "public"."sync_status" AS ENUM (
    'pending',
    'syncing',
    'synced',
    'failed',
    'conflict'
);


ALTER TYPE "public"."sync_status" OWNER TO "postgres";


CREATE TYPE "public"."transaction_type" AS ENUM (
    'income',
    'expense'
);


ALTER TYPE "public"."transaction_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_paid_work_days"("p_profile_id" "uuid", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(sum(public.calculate_time_segment_paid_days(start_time, end_time)), 0)
  from public.time_segments
  where profile_id = p_profile_id
    and end_time is not null
    and start_time >= p_period_start
    and (p_period_end is null or start_time < p_period_end);
$$;


ALTER FUNCTION "public"."calculate_paid_work_days"("p_profile_id" "uuid", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_time_segment_paid_days"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  v_start_bangkok timestamp;
  v_end_bangkok timestamp;
  v_cutoff_bangkok timestamp;
  v_cutoff_days numeric := 0;
  v_duration_days numeric;
begin
  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    return 0;
  end if;

  v_duration_days := extract(epoch from (p_end_time - p_start_time)) / (8.0 * 60.0 * 60.0);
  v_start_bangkok := p_start_time at time zone 'Asia/Bangkok';
  v_end_bangkok := p_end_time at time zone 'Asia/Bangkok';
  v_cutoff_bangkok := date_trunc('day', v_start_bangkok) + interval '15 hours';

  if v_cutoff_bangkok <= v_start_bangkok then
    v_cutoff_bangkok := v_cutoff_bangkok + interval '1 day';
  end if;

  while v_cutoff_bangkok <= v_end_bangkok loop
    v_cutoff_days := v_cutoff_days + 1;
    v_cutoff_bangkok := v_cutoff_bangkok + interval '1 day';
  end loop;

  if v_cutoff_days > 0 then
    return v_cutoff_days;
  end if;

  return v_duration_days;
end;
$$;


ALTER FUNCTION "public"."calculate_time_segment_paid_days"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.can_access_location(target_location)
$$;


ALTER FUNCTION "public"."can_access_location"("target_location" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_super_admin_features"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.can_access_super_admin_features()
$$;


ALTER FUNCTION "public"."can_access_super_admin_features"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_time_tracking_expense_source"("p_source_type" "text", "p_source_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
begin
  if v_actor_id is null or not private.is_active_user() then raise exception 'Authentication required'; end if;
  if p_source_type not in ('transaction', 'payroll_slip') then raise exception 'Invalid expense source'; end if;

  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found or v_tx.type <> 'WITHDRAWAL' or v_tx.status <> 'APPROVED' or v_tx.expense_location_id is null then raise exception 'Withdrawal expense not found'; end if;
    if not private.can_approve_time_tracking_profile(v_tx.profile_id) then raise exception 'Forbidden'; end if;
    if v_tx.cancelled_at is not null then return jsonb_build_object('status', 'cancelled', 'idempotent', true); end if;
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.financial_transactions set cancelled_at = now(), cancelled_by = v_actor_id, cancel_reason = coalesce(p_reason, '') where id = v_tx.id;
    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (v_actor_id, 'CANCEL_TRANSACTION_EXPENSE', 'financial_transactions', v_tx.id, to_jsonb(v_tx), jsonb_build_object('cancelledAt', now()), coalesce(p_reason, ''));
  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found or v_slip.status <> 'APPROVED' or v_slip.net_pay <= 0 or v_slip.expense_location_id is null then raise exception 'Payroll expense not found'; end if;
    if not private.can_approve_time_tracking_profile(v_slip.profile_id) then raise exception 'Forbidden'; end if;
    if v_slip.cancelled_at is not null then return jsonb_build_object('status', 'cancelled', 'idempotent', true); end if;
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.payroll_slips set cancelled_at = now(), cancelled_by = v_actor_id, cancel_reason = coalesce(p_reason, '') where id = v_slip.id;
    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (v_actor_id, 'CANCEL_PAYROLL_EXPENSE', 'payroll_slips', v_slip.id, to_jsonb(v_slip), jsonb_build_object('cancelledAt', now()), coalesce(p_reason, ''));
  end if;

  return jsonb_build_object('status', 'cancelled', 'idempotent', false);
end;
$$;


ALTER FUNCTION "public"."cancel_time_tracking_expense_source"("p_source_type" "text", "p_source_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."change_time_tracking_expense_location"("p_source_type" "text", "p_source_id" "uuid", "p_expense_location_id" "uuid", "p_comment" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_location_id uuid;
begin
  if v_actor_id is null or not private.is_active_user() then raise exception 'Authentication required'; end if;
  if p_source_type not in ('transaction', 'payroll_slip') or p_expense_location_id is null then raise exception 'Invalid expense source'; end if;
  if not private.can_assign_time_tracking_expense_location(p_expense_location_id) then raise exception 'New expense location access denied'; end if;

  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found or v_tx.type <> 'WITHDRAWAL' or v_tx.status <> 'APPROVED' or v_tx.cancelled_at is not null or v_tx.expense_location_id is null then
      raise exception 'Active withdrawal expense not found';
    end if;
    if not private.can_approve_time_tracking_profile(v_tx.profile_id) or not private.can_assign_time_tracking_expense_location(v_tx.expense_location_id) then
      raise exception 'Expense location access denied';
    end if;
    v_old_location_id := v_tx.expense_location_id;
    if v_old_location_id = p_expense_location_id then return jsonb_build_object('status', 'unchanged'); end if;
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.financial_transactions set expense_location_id = p_expense_location_id where id = v_tx.id;
    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (v_actor_id, 'CHANGE_TRANSACTION_EXPENSE_LOCATION', 'financial_transactions', v_tx.id, jsonb_build_object('expenseLocationId', v_old_location_id), jsonb_build_object('expenseLocationId', p_expense_location_id), coalesce(p_comment, ''));
  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found or v_slip.status <> 'APPROVED' or v_slip.net_pay <= 0 or v_slip.cancelled_at is not null or v_slip.expense_location_id is null then
      raise exception 'Active payroll expense not found';
    end if;
    if not private.can_approve_time_tracking_profile(v_slip.profile_id) or not private.can_assign_time_tracking_expense_location(v_slip.expense_location_id) then
      raise exception 'Expense location access denied';
    end if;
    v_old_location_id := v_slip.expense_location_id;
    if v_old_location_id = p_expense_location_id then return jsonb_build_object('status', 'unchanged'); end if;
    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.payroll_slips set expense_location_id = p_expense_location_id where id = v_slip.id;
    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (v_actor_id, 'CHANGE_PAYROLL_EXPENSE_LOCATION', 'payroll_slips', v_slip.id, jsonb_build_object('expenseLocationId', v_old_location_id), jsonb_build_object('expenseLocationId', p_expense_location_id), coalesce(p_comment, ''));
  end if;

  return jsonb_build_object('status', 'updated', 'oldExpenseLocationId', v_old_location_id, 'expenseLocationId', p_expense_location_id);
end;
$$;


ALTER FUNCTION "public"."change_time_tracking_expense_location"("p_source_type" "text", "p_source_id" "uuid", "p_expense_location_id" "uuid", "p_comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_income_expense_approval_request"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."create_income_expense_approval_request"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_stock_entry_delete_approval_request"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_active_user boolean;
  v_user_id uuid;
  v_user_name text;
  v_user_phone text;
  v_request_key text;
  v_entry_id uuid;
  v_entry public.stock_entries%rowtype;
  v_location_name text;
  v_target_entry public.stock_entries%rowtype;
  v_target_location_name text;
  v_existing_id uuid;
  v_existing_status text;
  v_request_id uuid;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_entry_id := nullif(payload->>'stockEntryId', '')::uuid;
  if v_entry_id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการสต็อก');
  end if;

  select *
    into v_entry
  from public.stock_entries
  where id = v_entry_id
  for update;

  if v_entry.id is null or v_entry.record_status != 'active' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการสต็อกที่ลบได้');
  end if;

  if v_entry.tx_type = 'transfer_in' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการย้ายสต็อกต้องลบจากฝั่งย้ายออกเท่านั้น');
  end if;

  if v_entry.tx_type not in ('receive', 'transfer_out') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ลบได้เฉพาะรายการรับเข้า หรือย้ายออก');
  end if;

  if not public.can_access_location(v_entry.location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  select name into v_location_name
  from public.locations
  where id = v_entry.location_id;

  if v_entry.tx_type = 'transfer_out' then
    if v_entry.transfer_bill_no is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการย้ายนี้ไม่สมบูรณ์');
    end if;

    select *
      into v_target_entry
    from public.stock_entries
    where transfer_bill_no = v_entry.transfer_bill_no
      and product_id = v_entry.product_id
      and tx_type = 'transfer_in'
      and record_status = 'active'
    limit 1;

    if v_target_entry.id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการย้ายเข้าคู่กัน');
    end if;

    select name into v_target_location_name
    from public.locations
    where id = v_target_entry.location_id;

    select id, request_status
      into v_existing_id, v_existing_status
    from public.stock_entry_approval_requests
    where request_status = 'pending'
      and transfer_bill_no = v_entry.transfer_bill_no
      and tx_type = 'transfer_out'
    limit 1;
  else
    select id, request_status
      into v_existing_id, v_existing_status
    from public.stock_entry_approval_requests
    where request_status = 'pending'
      and stock_entry_id = v_entry.id
    limit 1;
  end if;

  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'pending',
      'requestId', v_existing_id,
      'requestStatus', v_existing_status
    );
  end if;

  v_request_key := nullif(payload->>'requestIdempotencyKey', '');
  if v_request_key is null then
    v_request_key := gen_random_uuid()::text;
  end if;

  v_user_id := auth.uid();
  select name, phone into v_user_name, v_user_phone
  from public.profiles
  where id = v_user_id;

  insert into public.stock_entry_approval_requests (
    request_idempotency_key,
    requested_payload,
    stock_entry_id,
    transfer_bill_no,
    tx_type,
    product_id,
    product_name,
    quantity,
    location_id,
    location_name,
    target_location_id,
    target_location_name,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  ) values (
    v_request_key,
    jsonb_build_object(
      'action', 'delete_stock_entry',
      'stockEntryId', v_entry.id,
      'transferBillNo', v_entry.transfer_bill_no
    ),
    v_entry.id,
    v_entry.transfer_bill_no,
    v_entry.tx_type,
    v_entry.product_id,
    v_entry.product_name,
    abs(v_entry.quantity_delta),
    v_entry.location_id,
    coalesce(v_location_name, ''),
    case when v_entry.tx_type = 'transfer_out' then v_target_entry.location_id else null end,
    case when v_entry.tx_type = 'transfer_out' then coalesce(v_target_location_name, '') else null end,
    v_user_id,
    coalesce(v_user_name, ''),
    coalesce(v_user_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending',
    'requestId', v_request_id,
    'requestType', 'delete_stock_entry'
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."create_stock_entry_delete_approval_request"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_stock_product_approval_request"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_active_user boolean;
  v_user_id uuid;
  v_user_name text;
  v_user_phone text;
  v_request_type text;
  v_request_key text;
  v_name text;
  v_name_key text;
  v_unit text;
  v_create_sale_item boolean;
  v_product_id uuid;
  v_product public.stock_products%rowtype;
  v_existing_id uuid;
  v_existing_status text;
  v_request_id uuid;
  v_payload jsonb;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_request_type := payload->>'requestType';
  if v_request_type not in ('create_product', 'delete_product') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid stock product request type');
  end if;

  v_request_key := nullif(payload->>'requestIdempotencyKey', '');
  if v_request_key is null then
    v_request_key := gen_random_uuid()::text;
  end if;

  select id, request_status
    into v_existing_id, v_existing_status
  from public.stock_product_approval_requests
  where request_idempotency_key = v_request_key
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'pending',
      'requestId', v_existing_id,
      'requestStatus', v_existing_status
    );
  end if;

  v_user_id := auth.uid();
  select name, phone into v_user_name, v_user_phone
  from public.profiles
  where id = v_user_id;

  if v_request_type = 'create_product' then
    v_name := btrim(coalesce(payload->>'name', ''));
    v_name_key := lower(v_name);
    v_unit := nullif(btrim(coalesce(payload->>'unit', '')), '');
    v_create_sale_item := coalesce((payload->>'createSaleItem')::boolean, false);

    if v_name = '' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'กรุณาระบุชื่อสินค้า');
    end if;

    if exists (
      select 1
      from public.stock_products
      where lower(btrim(name)) = v_name_key
    ) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'มีสินค้านี้ในสต็อกแล้ว');
    end if;

    select id, request_status
      into v_existing_id, v_existing_status
    from public.stock_product_approval_requests
    where request_status = 'pending'
      and request_type = 'create_product'
      and lower(btrim(product_name)) = v_name_key
    limit 1;

    if v_existing_id is not null then
      return jsonb_build_object(
        'status', 'pending',
        'requestId', v_existing_id,
        'requestStatus', v_existing_status
      );
    end if;

    v_payload := jsonb_build_object(
      'action', 'create_product',
      'name', v_name,
      'unit', coalesce(v_unit, 'ชิ้น'),
      'createSaleItem', v_create_sale_item
    );
  else
    v_product_id := nullif(payload->>'productId', '')::uuid;
    if v_product_id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้า');
    end if;

    select *
      into v_product
    from public.stock_products
    where id = v_product_id
    for update;

    if v_product.id is null or v_product.is_active is not true then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
    end if;

    select id, request_status
      into v_existing_id, v_existing_status
    from public.stock_product_approval_requests
    where request_status = 'pending'
      and request_type = 'delete_product'
      and product_id = v_product_id
    limit 1;

    if v_existing_id is not null then
      return jsonb_build_object(
        'status', 'pending',
        'requestId', v_existing_id,
        'requestStatus', v_existing_status
      );
    end if;

    v_name := v_product.name;
    v_unit := v_product.unit;
    v_create_sale_item := null;
    v_payload := jsonb_build_object(
      'action', 'delete_product',
      'productId', v_product_id,
      'productName', v_product.name
    );
  end if;

  insert into public.stock_product_approval_requests (
    request_type,
    request_idempotency_key,
    requested_payload,
    product_id,
    product_name,
    unit,
    create_sale_item,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  ) values (
    v_request_type,
    v_request_key,
    v_payload,
    v_product_id,
    v_name,
    v_unit,
    v_create_sale_item,
    v_user_id,
    coalesce(v_user_name, ''),
    coalesce(v_user_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending',
    'requestId', v_request_id,
    'requestType', v_request_type
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."create_stock_product_approval_request"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_stock_product_with_sale_item"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;
  v_name text;
  v_name_key text;
  v_unit text;
  v_create_sale_item boolean;
  v_product public.stock_products%rowtype;
  v_active_sale_item public.income_sale_items%rowtype;
  v_sale_item public.income_sale_items%rowtype;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่มีสิทธิ์เพิ่มสินค้า');
  end if;

  v_name := btrim(coalesce(payload->>'name', ''));
  v_name_key := lower(v_name);
  v_unit := nullif(btrim(coalesce(payload->>'unit', '')), '');
  v_create_sale_item := coalesce((payload->>'createSaleItem')::boolean, false);

  if v_name = '' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'กรุณาระบุชื่อสินค้า');
  end if;

  perform pg_advisory_xact_lock(hashtext('stock-product:' || v_name_key));

  if exists (
    select 1
    from public.stock_products
    where lower(btrim(name)) = v_name_key
  ) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'มีสินค้านี้ในสต็อกแล้ว');
  end if;

  if v_create_sale_item then
    select *
      into v_active_sale_item
    from public.income_sale_items
    where lower(btrim(name)) = v_name_key
      and is_active = true
    order by created_at desc
    limit 1;

    if v_active_sale_item.id is not null
       and v_active_sale_item.stock_product_id is not null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการขายชื่อนี้ผูกกับสินค้าอื่นแล้ว');
    end if;
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  insert into public.stock_products (
    name, unit, created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_name,
    coalesce(v_unit, 'ชิ้น'),
    v_created_by_user_id,
    coalesce(v_created_by_name, ''),
    v_created_by_phone
  )
  returning * into v_product;

  if v_create_sale_item then
    if v_active_sale_item.id is not null then
      update public.income_sale_items
      set stock_product_id = v_product.id,
          updated_at = now()
      where id = v_active_sale_item.id
      returning * into v_sale_item;
    else
      select *
        into v_sale_item
      from public.income_sale_items
      where lower(btrim(name)) = v_name_key
        and is_active = false
      order by created_at desc
      limit 1;

      if v_sale_item.id is not null then
        update public.income_sale_items
        set stock_product_id = v_product.id,
            is_active = true,
            deleted_at = null,
            deleted_by_user_id = null,
            updated_at = now()
        where id = v_sale_item.id
        returning * into v_sale_item;
      else
        insert into public.income_sale_items (
          name, stock_product_id, created_by_user_id, created_by_name, created_by_phone
        ) values (
          v_product.name,
          v_product.id,
          v_created_by_user_id,
          coalesce(v_created_by_name, ''),
          v_created_by_phone
        )
        returning * into v_sale_item;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'product', jsonb_build_object(
      'id', v_product.id,
      'name', v_product.name,
      'unit', v_product.unit,
      'is_active', v_product.is_active,
      'created_by_name', v_product.created_by_name,
      'created_by_phone', v_product.created_by_phone,
      'created_at', v_product.created_at
    ),
    'saleItem', case
      when v_sale_item.id is null then null
      else jsonb_build_object(
        'id', v_sale_item.id,
        'name', v_sale_item.name,
        'stock_product_id', v_sale_item.stock_product_id,
        'is_active', v_sale_item.is_active,
        'created_by_name', v_sale_item.created_by_name,
        'created_by_phone', v_sale_item.created_by_phone,
        'created_at', v_sale_item.created_at
      )
    end
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', 'เพิ่มสินค้าไม่สำเร็จ: ' || sqlerrm);
end;
$$;


ALTER FUNCTION "public"."create_stock_product_with_sale_item"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select auth.uid()
$$;


ALTER FUNCTION "public"."current_profile_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_income_expense_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request record;
  v_decider_id uuid;
  v_decider_name text;
  v_decider_phone text;
  v_payload jsonb;
  v_sync_result jsonb;
  v_row_id uuid;
begin
  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้');
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
  perform set_config('app.bypass_income_expense_approval', 'true', true);
  v_sync_result := public.sync_income_expense(v_payload);

  if coalesce(v_sync_result->>'status', 'failed') != 'synced' then
    return v_sync_result;
  end if;

  v_row_id := (v_sync_result->>'id')::uuid;

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


ALTER FUNCTION "public"."decide_income_expense_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_stock_entry_delete_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request public.stock_entry_approval_requests%rowtype;
  v_decider_id uuid;
  v_decider_name text;
  v_decider_phone text;
  v_entry public.stock_entries%rowtype;
  v_entry_ids uuid[];
  v_pair_count integer;
  v_location_id uuid;
  v_validation jsonb;
begin
  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้');
  end if;

  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid decision');
  end if;

  select *
    into v_request
  from public.stock_entry_approval_requests
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
    update public.stock_entry_approval_requests
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

  select *
    into v_entry
  from public.stock_entries
  where id = v_request.stock_entry_id
  for update;

  if v_entry.id is null or v_entry.record_status != 'active' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการสต็อกที่ลบได้');
  end if;

  if v_entry.tx_type = 'receive' then
    v_entry_ids := array[v_entry.id];
  elsif v_entry.tx_type = 'transfer_out' then
    perform 1
    from public.stock_entries
    where transfer_bill_no = v_entry.transfer_bill_no
      and product_id = v_entry.product_id
      and record_status = 'active'
      and tx_type in ('transfer_out', 'transfer_in')
    for update;

    select array_agg(id order by tx_type), count(*)
      into v_entry_ids, v_pair_count
    from public.stock_entries
    where transfer_bill_no = v_entry.transfer_bill_no
      and product_id = v_entry.product_id
      and record_status = 'active'
      and tx_type in ('transfer_out', 'transfer_in');

    if coalesce(v_pair_count, 0) != 2 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการย้ายนี้ไม่สมบูรณ์ จึงลบไม่ได้');
    end if;
  else
    return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการย้ายสต็อกต้องลบจากฝั่งย้ายออกเท่านั้น');
  end if;

  for v_location_id in
    select distinct location_id
    from public.stock_entries
    where id = any(v_entry_ids)
  loop
    perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_location_id::text || ':' || v_entry.product_id::text));

    v_validation := public.validate_stock_non_negative_after_entry_delete(
      v_location_id,
      v_entry.product_id,
      v_entry_ids
    );

    if coalesce(v_validation->>'status', 'failed') != 'ok' then
      return v_validation;
    end if;
  end loop;

  update public.stock_entries
  set record_status = 'deleted',
      deleted_at = now(),
      deleted_by_name = coalesce(v_decider_name, ''),
      deleted_by_phone = coalesce(v_decider_phone, ''),
      updated_at = now()
  where id = any(v_entry_ids);

  update public.stock_entry_approval_requests
  set request_status = 'approved',
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
    'deletedEntryIds', to_jsonb(v_entry_ids)
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."decide_stock_entry_delete_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_stock_product_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_request public.stock_product_approval_requests%rowtype;
  v_decider_id uuid;
  v_decider_name text;
  v_decider_phone text;
  v_result jsonb;
  v_product_id uuid;
  v_has_balance boolean;
begin
  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้');
  end if;

  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid decision');
  end if;

  select *
    into v_request
  from public.stock_product_approval_requests
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
    update public.stock_product_approval_requests
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

  if v_request.request_type = 'create_product' then
    v_result := public.create_stock_product_with_sale_item(v_request.requested_payload);
    if coalesce(v_result->>'status', 'failed') != 'synced' then
      return v_result;
    end if;

    v_product_id := (v_result->'product'->>'id')::uuid;
  elsif v_request.request_type = 'delete_product' then
    v_product_id := v_request.product_id;

    select exists (
      select 1
      from (
        select location_id, sum(quantity_delta) as balance
        from public.stock_movements
        where product_id = v_product_id
        group by location_id
      ) balances
      where abs(coalesce(balance, 0)) > 0.000001
    )
    into v_has_balance;

    if coalesce(v_has_balance, false) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'ลบสินค้าไม่ได้ เพราะยังมียอดคงเหลือในสต็อก'
      );
    end if;

    update public.stock_products
    set is_active = false,
        updated_at = now()
    where id = v_product_id
      and is_active = true;

    update public.income_sale_items
    set is_active = false,
        deleted_at = now(),
        deleted_by_user_id = v_decider_id,
        updated_at = now()
    where stock_product_id = v_product_id
      and is_active = true;
  else
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid stock product request type');
  end if;

  update public.stock_product_approval_requests
  set request_status = 'approved',
      product_id = coalesce(product_id, v_product_id),
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
    'productId', v_product_id
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."decide_stock_product_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_time_tracking_approval"("p_source_type" "text", "p_source_id" "uuid", "p_decision" "text", "p_comment" "text" DEFAULT NULL::"text", "p_expense_location_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_data jsonb;
  v_requires_expense_location boolean := false;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid approval source';
  end if;
  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'Invalid approval decision';
  end if;

  select role::text into v_actor_role from public.profiles where id = v_actor_id;

  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found then raise exception 'Transaction not found'; end if;
    if not private.can_approve_time_tracking_profile(v_tx.profile_id) then raise exception 'Forbidden'; end if;
    if v_tx.type = 'DEBT' and v_actor_role <> 'super_admin' then raise exception 'Only super_admin can approve debts'; end if;

    v_requires_expense_location := p_decision = 'APPROVED' and v_tx.type = 'WITHDRAWAL';
    if v_tx.status <> 'PENDING' then
      if v_tx.status = p_decision::public.approval_status
        and (
          not v_requires_expense_location
          or v_tx.expense_location_id = p_expense_location_id
        ) then
        return jsonb_build_object('status', lower(p_decision), 'idempotent', true, 'sourceType', p_source_type, 'sourceId', p_source_id);
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_expense_location then
      if p_expense_location_id is null or not private.can_assign_time_tracking_expense_location(p_expense_location_id) then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_tx);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.financial_transactions
      set status = 'APPROVED',
          admin_comment = coalesce(p_comment, ''),
          approved_by = v_actor_id,
          approved_at = now(),
          expense_location_id = case when v_requires_expense_location then p_expense_location_id else null end,
          remaining_amount = case when v_tx.type in ('DEBT', 'WITHDRAWAL') then v_tx.amount else v_tx.remaining_amount end
      where id = v_tx.id;
    else
      update public.financial_transactions
      set status = 'REJECTED', admin_comment = coalesce(p_comment, ''), approved_by = v_actor_id
      where id = v_tx.id;
    end if;

    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (
      v_actor_id,
      'DECIDE_TRANSACTION_APPROVAL',
      'financial_transactions',
      v_tx.id,
      v_old_data,
      jsonb_build_object('decision', p_decision, 'expenseLocationId', p_expense_location_id),
      coalesce(p_comment, '')
    );

  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found then raise exception 'Payroll slip not found'; end if;
    if not private.can_approve_time_tracking_profile(v_slip.profile_id) then raise exception 'Forbidden'; end if;
    if v_slip.created_by = v_actor_id and v_actor_role <> 'super_admin' then raise exception 'Cannot approve your own slip'; end if;

    v_requires_expense_location := p_decision = 'APPROVED' and v_slip.net_pay > 0;
    if v_slip.status <> 'PENDING' then
      if v_slip.status = p_decision::public.approval_status
        and (
          not v_requires_expense_location
          or v_slip.expense_location_id = p_expense_location_id
        ) then
        return jsonb_build_object('status', lower(p_decision), 'idempotent', true, 'sourceType', p_source_type, 'sourceId', p_source_id);
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_expense_location then
      if p_expense_location_id is null or not private.can_assign_time_tracking_expense_location(p_expense_location_id) then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_slip);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.payroll_slips
      set status = 'APPROVED',
          admin_comment = coalesce(p_comment, ''),
          approved_by = v_actor_id,
          approved_at = now(),
          expense_location_id = case when v_requires_expense_location then p_expense_location_id else null end
      where id = v_slip.id;
    else
      update public.payroll_slips
      set status = 'REJECTED', admin_comment = coalesce(p_comment, ''), approved_by = v_actor_id
      where id = v_slip.id;
    end if;

    insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, old_data, new_data, comment)
    values (
      v_actor_id,
      'DECIDE_PAYROLL_SLIP_APPROVAL',
      'payroll_slips',
      v_slip.id,
      v_old_data,
      jsonb_build_object('decision', p_decision, 'expenseLocationId', p_expense_location_id),
      coalesce(p_comment, '')
    );
  end if;

  return jsonb_build_object('status', lower(p_decision), 'idempotent', false, 'sourceType', p_source_type, 'sourceId', p_source_id);
end;
$$;


ALTER FUNCTION "public"."decide_time_tracking_approval"("p_source_type" "text", "p_source_id" "uuid", "p_decision" "text", "p_comment" "text", "p_expense_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_debts_daily"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_debt record;
  v_user_wage numeric;
  v_current_month_start timestamp with time zone;
  v_total_days numeric;
  v_gross_pay numeric;
  v_deduct_amount numeric;
  v_today date;
  v_deduction_type text;
  v_comment text;
begin
  v_today := current_date;
  v_current_month_start := date_trunc('month', current_timestamp at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';

  for v_debt in
    select id, profile_id, remaining_amount, due_date, created_at, type
    from public.financial_transactions
    where type in ('DEBT', 'WITHDRAWAL')
      and status = 'APPROVED'
      and remaining_amount > 0
  loop
    if v_debt.type = 'DEBT' and v_debt.due_date is not null and v_debt.due_date > v_today then
      continue;
    end if;

    select daily_wage into v_user_wage from public.profiles where id = v_debt.profile_id;

    if v_user_wage is null or v_user_wage <= 0 then
      continue;
    end if;

    v_total_days := public.calculate_paid_work_days(v_debt.profile_id, v_current_month_start, null);
    v_gross_pay := v_total_days * v_user_wage;

    declare
      v_already_used numeric;
      v_remaining_balance numeric;
    begin
      select coalesce(sum(amount), 0) into v_already_used
      from public.financial_transactions
      where profile_id = v_debt.profile_id
        and status = 'APPROVED'
        and type in ('WITHDRAWAL_DEDUCTION', 'DEBT_DEDUCTION', 'SALARY')
        and created_at >= v_current_month_start;

      v_remaining_balance := v_gross_pay - v_already_used;

      if v_remaining_balance <= 0 then
        continue;
      end if;

      v_deduct_amount := least(v_debt.remaining_amount, v_remaining_balance);
      v_deduct_amount := trunc(v_deduct_amount, 2);

      if v_deduct_amount <= 0 then
        continue;
      end if;

      update public.financial_transactions
      set remaining_amount = remaining_amount - v_deduct_amount
      where id = v_debt.id;

      if v_debt.type = 'DEBT' then
        v_deduction_type := 'DEBT_DEDUCTION';
        v_comment := 'หักหนี้อัตโนมัติประจำวัน';
      else
        v_deduction_type := 'WITHDRAWAL_DEDUCTION';
        v_comment := 'หักยอดเบิกเงินอัตโนมัติประจำวัน';
      end if;

      insert into public.financial_transactions (profile_id, type, amount, status, parent_debt_id, admin_comment)
      values (v_debt.profile_id, v_deduction_type::financial_transaction_type, v_deduct_amount, 'APPROVED', v_debt.id, v_comment);

      insert into public.time_tracking_audit_logs (admin_id, action, target_table, record_id, new_data, comment)
      values (
        v_debt.profile_id,
        'AUTO_DEDUCTION',
        'financial_transactions',
        v_debt.id,
        jsonb_build_object('deducted_amount', v_deduct_amount, 'remaining_amount', v_debt.remaining_amount - v_deduct_amount, 'type', v_deduction_type),
        v_comment
      );
    end;
  end loop;
end;
$$;


ALTER FUNCTION "public"."deduct_debts_daily"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_income_sale_item"("item_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  item_name text;
  usage_count bigint;
begin
  if not public.can_access_super_admin_features() then
    raise exception 'Permission denied: only system managers can delete sale items';
  end if;

  select name into item_name
  from public.income_sale_items
  where id = item_id;

  if item_name is null then
    raise exception 'Item not found';
  end if;

  select count(*) into usage_count
  from public.income_expense
  where income_sale_item_id = item_id
    and bill_option = 'บิลขาย'
    and record_status != 'deleted';

  if usage_count > 0 then
    raise exception 'ไม่สามารถลบได้ เพราะมีรายการรายรับที่ใช้ "%" อยู่ % รายการ', item_name, usage_count;
  end if;

  delete from public.income_sale_items where id = item_id;
end;
$$;


ALTER FUNCTION "public"."delete_income_sale_item"("item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_acid_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_balance numeric;
begin
  if not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;

  select coalesce(sum(quantity_delta), 0)
    into v_balance
  from public.acid_stock_movements
  where location_id = p_location_id
    and product_id = p_product_id;

  return coalesce(v_balance, 0);
end;
$$;


ALTER FUNCTION "public"."get_acid_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_income_expense_feed"("p_location_id" "uuid", "p_from_date" "date", "p_to_date" "date", "p_cursor_date" "date" DEFAULT NULL::"date", "p_cursor_key" "text" DEFAULT NULL::"text", "p_page_size" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 100);
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if p_from_date is null or p_to_date is null or p_from_date > p_to_date then
    raise exception 'Invalid date range';
  end if;

  return (
    with feed as (
      select ie.tx_date as sort_date, 'actual:' || ie.id::text as sort_key,
        jsonb_strip_nulls(jsonb_build_object(
          'id', ie.id, 'clientTempId', coalesce(ie.client_temp_id, ie.id::text),
          'localBillNo', ie.local_bill_no, 'serverBillNo', ie.server_bill_no,
          'idempotencyKey', coalesce(ie.idempotency_key, 'server:' || ie.id::text),
          'locationId', ie.location_id, 'syncStatus', 'synced', 'recordStatus', ie.record_status,
          'type', ie.type, 'number', coalesce(ie.number, ie.server_bill_no, ie.local_bill_no),
          'txDate', ie.tx_date, 'title', ie.title, 'cost', ie.cost, 'unit', ie.unit,
          'price', ie.price, 'incomeSaleItemId', ie.income_sale_item_id,
          'stockProductId', ie.stock_product_id, 'stockQuantity', ie.stock_quantity,
          'billOption', ie.bill_option, 'clientRecordedAt', coalesce(ie.client_recorded_at, ie.created_at),
          'clientCreatedAt', coalesce(ie.client_created_at, ie.created_at),
          'serverReceivedAt', ie.server_received_at, 'revisionNo', ie.revision_no,
          'createdByUserId', ie.created_by_user_id, 'createdByName', ie.created_by_name,
          'createdByPhone', ie.created_by_phone
        )) as row_data
      from public.income_expense ie
      where ie.location_id = p_location_id and ie.record_status = 'active'
        and ie.tx_date between p_from_date and p_to_date

      union all

      select mt.created_at::date, 'transfer-income:' || mt.id::text,
        jsonb_build_object(
          'id', 'money-transfer-income:' || mt.id, 'clientTempId', 'money-transfer-income:' || mt.id,
          'localBillNo', 'TR-' || left(mt.id::text, 8), 'serverBillNo', 'TR-' || left(mt.id::text, 8),
          'idempotencyKey', 'money-transfer:' || mt.id, 'locationId', mt.target_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'income',
          'number', 'TR-' || left(mt.id::text, 8), 'txDate', mt.created_at::date,
          'title', 'รับโอนจาก สาขาต้นทาง', 'cost', mt.net_amount_to_pay, 'billOption', 'รายรับ',
          'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
          'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', case when mt.location_id = mt.target_location_id then 'โอนให้สาขา' else 'โอนเงินสาขา' end,
          'relationLockReason', 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง'
        )
      from public.money_transfers mt
      where mt.transfer_type = 'branch' and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted' and mt.transfer_status <> 'cancelled'
        and mt.net_amount_to_pay > 0 and mt.created_at::date between p_from_date and p_to_date

      union all

      select mt.created_at::date, 'transfer-expense:' || mt.id::text,
        jsonb_build_object(
          'id', 'money-transfer-branch-expense:' || mt.id, 'clientTempId', 'money-transfer-branch-expense:' || mt.id,
          'localBillNo', 'TR-' || left(mt.id::text, 8), 'serverBillNo', 'TR-' || left(mt.id::text, 8),
          'idempotencyKey', 'money-transfer-branch-expense:' || mt.id, 'locationId', mt.location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'TR-' || left(mt.id::text, 8), 'txDate', mt.created_at::date,
          'title', 'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
          'cost', mt.net_amount_to_pay, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
          'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', 'โอนเงินสาขา',
          'relationLockReason', 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง'
        )
      from public.money_transfers mt
      where mt.transfer_type = 'branch' and mt.location_id = p_location_id
        and mt.target_location_id <> mt.location_id and mt.record_status <> 'deleted'
        and mt.transfer_status <> 'cancelled' and mt.net_amount_to_pay > 0
        and mt.created_at::date between p_from_date and p_to_date

      union all

      select mt.created_at::date, 'customer-transfer-expense:' || mt.id::text,
        jsonb_build_object(
          'id', 'money-transfer-branch-paid-expense:' || mt.id, 'clientTempId', 'money-transfer-branch-paid-expense:' || mt.id,
          'localBillNo', 'CT-' || left(mt.id::text, 8), 'serverBillNo', 'CT-' || left(mt.id::text, 8),
          'idempotencyKey', 'money-transfer-branch-paid:' || mt.id, 'locationId', mt.location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'CT-' || left(mt.id::text, 8), 'txDate', mt.created_at::date,
          'title', 'สาขาจ่ายส่วนต่างให้ ' || coalesce(mt.customer_name, 'ลูกค้า'),
          'cost', mt.branch_paid_amount, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
          'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', 'โอน+สาขาจ่าย',
          'relationLockReason', 'รายการนี้มาจากโอนเงินลูกค้าแบบโอน+สาขาจ่าย ต้องแก้ไขหรือลบที่โมดูลโอนเงินลูกค้าต้นทาง'
        )
      from public.money_transfers mt
      where mt.transfer_type = 'customer' and mt.transfer_status = 'branch_and_transfer'
        and mt.location_id = p_location_id and mt.record_status <> 'deleted'
        and mt.branch_paid_amount > 0 and mt.created_at::date between p_from_date and p_to_date

      union all

      select (ft.approved_at at time zone 'Asia/Bangkok')::date, 'time-tracking-withdrawal:' || ft.id::text,
        jsonb_build_object(
          'id', 'time-tracking-withdrawal:' || ft.id, 'clientTempId', 'time-tracking-withdrawal:' || ft.id,
          'localBillNo', 'TW-' || left(ft.id::text, 8), 'serverBillNo', 'TW-' || left(ft.id::text, 8),
          'idempotencyKey', 'time-tracking-withdrawal:' || ft.id, 'locationId', ft.expense_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'TW-' || left(ft.id::text, 8), 'txDate', (ft.approved_at at time zone 'Asia/Bangkok')::date,
          'title', 'เบิกเงิน — ' || coalesce(p.name, 'พนักงาน') || coalesce(': ' || nullif(ft.description, ''), ''),
          'cost', ft.amount, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', ft.approved_at, 'clientCreatedAt', ft.created_at,
          'serverReceivedAt', ft.updated_at, 'revisionNo', 1,
          'createdByUserId', ft.profile_id, 'createdByName', coalesce(p.name, 'พนักงาน'), 'createdByPhone', '',
          'relationSourceType', 'time_tracking_withdrawal', 'relationSourceId', ft.id,
          'relationSourceLocationId', ft.expense_location_id, 'relationLabel', 'เบิกเงิน',
          'relationLockReason', 'รายการนี้มาจากการเบิกเงินที่อนุมัติแล้ว ต้องแก้ไขสาขาหรือยกเลิกที่โมดูลลงเวลาต้นทาง'
        )
      from public.financial_transactions ft
      join public.profiles p on p.id = ft.profile_id
      where ft.type = 'WITHDRAWAL' and ft.status = 'APPROVED'
        and ft.cancelled_at is null and ft.expense_location_id = p_location_id and ft.amount > 0
        and (ft.approved_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date

      union all

      select (ps.approved_at at time zone 'Asia/Bangkok')::date, 'payroll-slip:' || ps.id::text,
        jsonb_build_object(
          'id', 'payroll-slip:' || ps.id, 'clientTempId', 'payroll-slip:' || ps.id,
          'localBillNo', 'PS-' || left(ps.id::text, 8), 'serverBillNo', 'PS-' || left(ps.id::text, 8),
          'idempotencyKey', 'payroll-slip:' || ps.id, 'locationId', ps.expense_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'PS-' || left(ps.id::text, 8), 'txDate', (ps.approved_at at time zone 'Asia/Bangkok')::date,
          'title', 'เงินเดือน — ' || coalesce(p.name, 'พนักงาน') || ' — ' || ps.month,
          'cost', ps.net_pay, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', ps.approved_at, 'clientCreatedAt', ps.created_at,
          'serverReceivedAt', ps.updated_at, 'revisionNo', 1,
          'createdByUserId', ps.profile_id, 'createdByName', coalesce(p.name, 'พนักงาน'), 'createdByPhone', '',
          'relationSourceType', 'payroll_slip', 'relationSourceId', ps.id,
          'relationSourceLocationId', ps.expense_location_id, 'relationLabel', 'เงินเดือน',
          'relationLockReason', 'รายการนี้มาจากเงินเดือนที่อนุมัติแล้ว ต้องแก้ไขสาขาหรือยกเลิกที่โมดูลลงเวลาต้นทาง'
        )
      from public.payroll_slips ps
      join public.profiles p on p.id = ps.profile_id
      where ps.status = 'APPROVED' and ps.net_pay > 0 and ps.cancelled_at is null
        and ps.expense_location_id = p_location_id
        and (ps.approved_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date

      union all

      select rb.bill_date, 'rubber:' || rb.bill_date::text,
        jsonb_build_object(
          'id', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'clientTempId', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'localBillNo', 'RB-' || to_char(rb.bill_date, 'YYMMDD'), 'serverBillNo', 'RB-' || to_char(rb.bill_date, 'YYMMDD'),
          'idempotencyKey', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'locationId', p_location_id, 'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'RB-' || to_char(rb.bill_date, 'YYMMDD'), 'txDate', rb.bill_date,
          'title', 'จ่ายค่ายางจากบิลยาง ' || rb.bill_count || ' ใบ', 'cost', rb.total,
          'billOption', 'ค่าใช้จ่าย', 'clientRecordedAt', rb.recorded_at, 'clientCreatedAt', rb.recorded_at,
          'serverReceivedAt', rb.updated_at, 'revisionNo', rb.revision_no,
          'createdByUserId', '', 'createdByName', 'ระบบบิลยาง', 'createdByPhone', '',
          'relationSourceType', 'rubber_bill_daily', 'relationSourceId', rb.bill_date,
          'relationSourceLocationId', p_location_id, 'relationSourceDate', rb.bill_date,
          'relationLabel', 'บิลยางรวมรายวัน',
          'relationLockReason', 'รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยางต้นทาง'
        )
      from (
        select bill_date, sum(net_total) as total, count(*) as bill_count,
          max(coalesce(client_recorded_at, updated_at, created_at)) as recorded_at,
          max(updated_at) as updated_at, max(revision_no) as revision_no
        from public.rubber_bills rb
        where rb.location_id = p_location_id and rb.record_status = 'active' and rb.net_total > 0
          and rb.bill_date between p_from_date and p_to_date
          and not exists (select 1 from public.money_transfer_items i where i.source_type = 'rubber_bill' and i.source_id = rb.id)
        group by bill_date
      ) rb

      union all

      select ot.date_in, 'ocr:' || ot.date_in::text,
        jsonb_build_object(
          'id', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'clientTempId', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'localBillNo', 'OCR-' || to_char(ot.date_in, 'YYMMDD'), 'serverBillNo', 'OCR-' || to_char(ot.date_in, 'YYMMDD'),
          'idempotencyKey', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'locationId', p_location_id, 'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'OCR-' || to_char(ot.date_in, 'YYMMDD'), 'txDate', ot.date_in,
          'title', 'จ่ายค่ายางจาก OCR บิลยาง ' || ot.ticket_count || ' ใบ', 'cost', ot.total,
          'billOption', 'ค่าใช้จ่าย', 'clientRecordedAt', ot.recorded_at, 'clientCreatedAt', ot.recorded_at,
          'serverReceivedAt', ot.updated_at, 'revisionNo', ot.revision_no,
          'createdByUserId', '', 'createdByName', 'ระบบ OCR บิลยาง', 'createdByPhone', '',
          'relationSourceType', 'ocr_ticket_daily', 'relationSourceId', ot.date_in,
          'relationSourceLocationId', p_location_id, 'relationSourceDate', ot.date_in,
          'relationLabel', 'OCR บิลยางรวมรายวัน',
          'relationLockReason', 'รายการนี้มาจาก OCR บิลยาง ต้องแก้ไขหรือลบที่โมดูล OCR บิลยางต้นทาง'
        )
      from (
        select date_in, sum(total_amount) as total, count(*) as ticket_count,
          max(coalesce(client_recorded_at, updated_at, created_at)) as recorded_at,
          max(updated_at) as updated_at, max(revision_no) as revision_no
        from public.ocr_tickets ot
        where ot.location_id = p_location_id and ot.record_status = 'active' and ot.total_amount > 0
          and ot.date_in between p_from_date and p_to_date
          and not exists (select 1 from public.money_transfer_items i where i.source_type = 'ocr_ticket' and i.source_id = ot.id)
        group by date_in
      ) ot
    ), filtered as (
      select *, row_number() over (order by sort_date desc, sort_key desc) as row_no
      from feed
      where p_cursor_date is null or (sort_date, sort_key) < (p_cursor_date, p_cursor_key)
    ), page as (
      select * from filtered where row_no <= v_page_size + 1
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(row_data order by sort_date desc, sort_key desc) from page where row_no <= v_page_size), '[]'::jsonb),
      'nextCursor', case when (select count(*) from page) > v_page_size then
        encode(convert_to((select sort_date::text || '|' || sort_key from page where row_no = v_page_size), 'utf8'), 'base64')
      else null end
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_income_expense_feed"("p_location_id" "uuid", "p_from_date" "date", "p_to_date" "date", "p_cursor_date" "date", "p_cursor_key" "text", "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(sum(quantity_delta), 0)
  from public.stock_movements
  where location_id = p_location_id
    and product_id = p_product_id;
$$;


ALTER FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_super_admin()
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_rubber_bill_printed"("p_bill_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_bill record;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  select id, location_id, record_status, print_status, revision_no
    into v_bill
  from public.rubber_bills
  where id = p_bill_id
  for update;

  if not found then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Rubber Bill not found');
  end if;

  if not public.can_access_location(v_bill.location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_bill.record_status <> 'active' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Only active Rubber Bills can be marked printed');
  end if;

  if v_bill.print_status <> 'ปริ้นแล้ว' then
    update public.rubber_bills
    set print_status = 'ปริ้นแล้ว'
    where id = p_bill_id;
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'id', p_bill_id,
    'printStatus', 'ปริ้นแล้ว',
    'revisionNo', v_bill.revision_no
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."mark_rubber_bill_printed"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_location_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if old.location_id is distinct from new.location_id then
    raise exception 'location_id is locked after creation';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_location_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_locked_ocr_ticket_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if exists (
    select 1
    from public.money_transfer_items i
    join public.money_transfers t on t.id = i.transfer_id
    where i.source_type = 'ocr_ticket'
      and i.source_id = old.id
      and t.record_status <> 'deleted'
  ) then
    raise exception 'รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_locked_ocr_ticket_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_acid_stock_entry"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;
  v_location_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_tx_date date;
  v_quantity numeric;
  v_amount numeric;
  v_date text;
  v_next_seq integer;
  v_server_bill_no text;
  v_entry_id uuid;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  v_location_id := (payload->>'locationId')::uuid;
  v_product_id := (payload->>'productId')::uuid;
  v_tx_date := (payload->>'txDate')::date;
  v_quantity := (payload->>'quantity')::numeric;
  v_amount := coalesce(nullif(payload->>'amount', '')::numeric, 0);

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_quantity is null or v_quantity <= 0 then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนรับเข้าต้องมากกว่า 0');
  end if;

  select name into v_product_name
  from public.acid_products
  where id = v_product_id
    and is_active = true;

  if v_product_name is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
  end if;

  v_date := to_char(v_tx_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext(v_location_id::text || ':acid-receive:' || v_date));

  select count(*) + 1 into v_next_seq
  from public.acid_stock_entries
  where location_id = v_location_id
    and tx_date = v_tx_date
    and tx_type = 'receive'
    and server_bill_no is not null;

  v_server_bill_no := 'AS-' || v_date || '-' || lpad(v_next_seq::text, 4, '0');

  insert into public.acid_stock_entries (
    server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_server_bill_no, v_tx_date, v_product_id, v_product_name, v_quantity,
    v_amount, v_location_id, 'receive', v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning id into v_entry_id;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_entry_id,
    'serverBillNo', v_server_bill_no,
    'serverReceivedAt', now()
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."sync_acid_stock_entry"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_income_expense"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  v_existing_location_id uuid;
  v_existing_stock_product_id uuid;
  v_existing_stock_quantity numeric;
  v_existing_record_status record_status;

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

  v_income_sale_item_id uuid;
  v_stock_product_id uuid;
  v_stock_quantity numeric;
  v_mapped_stock_product_id uuid;
  v_current_balance numeric;
  v_projected_balance numeric;
  v_existing_credit numeric;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_internal_bypass := coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true';

  if v_internal_bypass and nullif(payload->>'createdByUserId', '') is not null then
    v_created_by_user_id := (payload->>'createdByUserId')::uuid;
    select name, phone into v_created_by_name, v_created_by_phone
    from public.profiles where id = v_created_by_user_id;
    v_created_by_name := coalesce(nullif(payload->>'createdByName', ''), v_created_by_name, '');
    v_created_by_phone := coalesce(nullif(payload->>'createdByPhone', ''), v_created_by_phone, '');
  else
    v_created_by_user_id := auth.uid();
    select name, phone into v_created_by_name, v_created_by_phone
    from public.profiles where id = v_created_by_user_id;
  end if;

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
  v_income_sale_item_id := nullif(payload->>'incomeSaleItemId', '')::uuid;
  v_stock_product_id := nullif(payload->>'stockProductId', '')::uuid;
  v_stock_quantity := nullif(payload->>'stockQuantity', '')::numeric;

  if not v_internal_bypass and v_operation = 'create' then
    if v_title like 'รับโอนจาก%' or v_title like 'โยกเงินไป%' or v_title like 'สาขาจ่ายส่วนต่างให้%' or lower(v_title) = 'branch transfer' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'ไม่สามารถซิงก์รายการโยกเงินโดยตรงได้ ต้องทำผ่านระบบโยกเงินเท่านั้น');
    end if;
  end if;

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

  perform pg_advisory_xact_lock(hashtext('income_expense:' || v_client_temp_id));

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

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
    if v_type = 'income' and v_bill_option not in ('รายรับ', 'บิลขาย') then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid billOption for income');
    end if;
    if v_type = 'expense' and v_bill_option != 'ค่าใช้จ่าย' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid billOption for expense');
    end if;
    if v_bill_option = 'บิลขาย' then
      if coalesce((payload->>'unit')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'unit must be > 0 for บิลขาย');
      end if;
      if coalesce((payload->>'price')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'price must be > 0 for บิลขาย');
      end if;
      if v_income_sale_item_id is null or v_stock_product_id is null or coalesce(v_stock_quantity, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องเลือกรายการสินค้าที่ผูกกับสต็อก');
      end if;

      select stock_product_id
        into v_mapped_stock_product_id
      from public.income_sale_items
      where id = v_income_sale_item_id
        and is_active = true;

      if v_mapped_stock_product_id is null or v_mapped_stock_product_id <> v_stock_product_id then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการบิลขายไม่ตรงกับสินค้าในสต็อก');
      end if;
    else
      v_income_sale_item_id := null;
      v_stock_product_id := null;
      v_stock_quantity := null;
    end if;
  end if;

  select id, revision_no, server_bill_no, idempotency_key, location_id, stock_product_id, stock_quantity, record_status
    into v_row_id, v_current_revision, v_server_bill_no, v_existing_idempotency_key,
         v_existing_location_id, v_existing_stock_product_id, v_existing_stock_quantity, v_existing_record_status
  from public.income_expense
  where client_temp_id = v_client_temp_id
  for update;

  if v_row_id is not null then
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
      if v_current_revision != coalesce(v_expected_revision, v_current_revision) then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
      end if;
    end if;
  else
    if v_operation != 'create' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;
  end if;

  if v_operation in ('create', 'update') and v_bill_option = 'บิลขาย' then
    perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_location_id::text || ':' || v_stock_product_id::text));
    v_current_balance := public.get_acid_stock_balance(v_location_id, v_stock_product_id);
    v_existing_credit := 0;

    if v_row_id is not null
       and v_existing_record_status = 'active'
       and v_existing_location_id = v_location_id
       and v_existing_stock_product_id = v_stock_product_id then
      v_existing_credit := coalesce(v_existing_stock_quantity, 0);
    end if;

    v_projected_balance := v_current_balance + v_existing_credit - v_stock_quantity;
    if v_projected_balance < 0 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกสินค้าไม่พอสำหรับบิลขาย');
    end if;
  end if;

  if v_operation = 'delete' then
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
    if v_operation = 'create' then
      v_date := to_char((payload->>'txDate')::date, 'YYMMDD');
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));

      select count(*) + 1 into v_next_seq
      from public.income_expense
      where location_id = v_location_id
        and tx_date = (payload->>'txDate')::date
        and server_bill_no is not null;

      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');

      insert into public.income_expense (
        client_temp_id, idempotency_key, revision_no, sync_status, record_status,
        location_id, type, number, local_bill_no, server_bill_no,
        tx_date, title, cost, unit, price, bill_option,
        income_sale_item_id, stock_product_id, stock_quantity,
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
        v_income_sale_item_id,
        v_stock_product_id,
        v_stock_quantity,
        (payload->>'clientRecordedAt')::timestamptz,
        (payload->>'clientCreatedAt')::timestamptz,
        now(),
        v_created_by_user_id,
        coalesce(v_created_by_name, ''),
        coalesce(v_created_by_phone, '')
      )
      returning id, revision_no into v_row_id, v_current_revision;
    else
      update public.income_expense
      set location_id = v_location_id,
          type = v_type::transaction_type,
          tx_date = (payload->>'txDate')::date,
          title = v_title,
          cost = v_cost,
          unit = case when v_bill_option = 'บิลขาย' then payload->>'unit' else null end,
          price = case when v_bill_option = 'บิลขาย' then (payload->>'price')::numeric else null end,
          bill_option = v_bill_option,
          income_sale_item_id = v_income_sale_item_id,
          stock_product_id = v_stock_product_id,
          stock_quantity = v_stock_quantity,
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
$$;


ALTER FUNCTION "public"."sync_income_expense"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_rubber_bill"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation text := payload->>'operation';
  v_customer_id uuid;
  v_deduct_weight numeric;
  v_result jsonb;
  v_bill_id uuid;
begin
  if v_operation in ('create', 'update') then
    v_customer_id := nullif(payload->>'customerId', '')::uuid;
    v_deduct_weight := coalesce(nullif(payload->>'deductWeight', '')::numeric, 0);

    if v_deduct_weight < 0 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'deductWeight must be non-negative');
    end if;

    if v_customer_id is not null
       and not exists (select 1 from public.customers where id = v_customer_id) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Customer not found');
    end if;
  end if;

  v_result := public.sync_rubber_bill_core_20260716020000(payload);

  if v_operation in ('create', 'update') and v_result->>'status' = 'synced' then
    v_bill_id := (v_result->>'id')::uuid;
    update public.rubber_bills
    set customer_id = v_customer_id,
        deduct_weight = v_deduct_weight,
        bill_type = coalesce(nullif(payload->>'billType', ''), bill_type)
    where id = v_bill_id;
  end if;

  return v_result;
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."sync_rubber_bill"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_rubber_bill_core_20260716020000"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
  v_record_status record_status;
  v_idempotency_key text;

  v_bill_id uuid;
  v_current_revision integer;
  v_server_bill_no text;
  v_existing_idempotency_key text;
  v_existing_record_status record_status;
  v_transfer_locked boolean;

  v_item jsonb;
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;

  v_date text;
  v_next_seq integer;
  v_stock_product_id uuid;
  v_stock_quantity numeric;
  v_stock_row record;
  v_current_balance numeric;
  v_projected_balance numeric;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  v_operation := payload->>'operation';
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  v_client_temp_id := payload->>'clientTempId';
  v_location_id := (payload->>'locationId')::uuid;
  v_record_status := (payload->>'recordStatus')::record_status;
  v_idempotency_key := payload->>'idempotencyKey';

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  select id, revision_no, server_bill_no, idempotency_key, record_status
    into v_bill_id, v_current_revision, v_server_bill_no, v_existing_idempotency_key, v_existing_record_status
  from public.rubber_bills
  where client_temp_id = v_client_temp_id
  for update;

  if v_bill_id is not null then
    if v_idempotency_key = v_existing_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_bill_id,
        'serverBillNo', v_server_bill_no,
        'revisionNo', v_current_revision,
        'serverReceivedAt', now()
      );
    end if;

    if v_operation = 'create' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
    else
      if v_current_revision != coalesce(v_expected_revision, v_current_revision) then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
      end if;
    end if;
  else
    if v_operation != 'create' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;
  end if;

  if v_bill_id is not null and v_operation in ('update', 'delete') then
    select exists (
      select 1
      from public.money_transfer_items i
      join public.money_transfers t on t.id = i.transfer_id
      where i.source_type = 'rubber_bill'
        and i.source_id = v_bill_id
        and t.record_status <> 'deleted'
    ) into v_transfer_locked;

    if coalesce(v_transfer_locked, false) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน'
      );
    end if;
  end if;

  if v_operation in ('create', 'update') then
    create temporary table if not exists pg_temp._acid_stock_delta (
      product_id uuid primary key,
      old_qty numeric not null default 0,
      new_qty numeric not null default 0
    ) on commit drop;
    truncate table pg_temp._acid_stock_delta;

    if v_bill_id is not null and v_existing_record_status = 'active' then
      insert into pg_temp._acid_stock_delta (product_id, old_qty)
      select stock_product_id, sum(quantity)
      from public.rubber_bill_items
      where bill_id = v_bill_id
        and item_type in ('acid', 'stock_deduction')
        and stock_product_id is not null
      group by stock_product_id;
    end if;

    for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
    loop
      if v_item->>'itemType' in ('acid', 'stock_deduction') then
        v_stock_product_id := nullif(v_item->>'stockProductId', '')::uuid;
        v_stock_quantity := nullif(v_item->>'quantity', '')::numeric;

        if v_stock_product_id is null or coalesce(v_stock_quantity, 0) <= 0 then
          return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการหักสินค้าต้องเลือกสินค้าในสต็อกและระบุจำนวน');
        end if;

        if not exists (select 1 from public.acid_products where id = v_stock_product_id and is_active = true) then
          return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อกสำหรับรายการหักสินค้า');
        end if;

        insert into pg_temp._acid_stock_delta (product_id, new_qty)
        values (v_stock_product_id, v_stock_quantity)
        on conflict (product_id) do update
          set new_qty = pg_temp._acid_stock_delta.new_qty + excluded.new_qty;
      end if;
    end loop;

    for v_stock_row in select * from pg_temp._acid_stock_delta
    loop
      perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_location_id::text || ':' || v_stock_row.product_id::text));
      v_current_balance := public.get_acid_stock_balance(v_location_id, v_stock_row.product_id);
      v_projected_balance := v_current_balance + v_stock_row.old_qty - v_stock_row.new_qty;

      if v_projected_balance < 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกสินค้าไม่พอสำหรับรายการหักสินค้าในบิลยาง');
      end if;
    end loop;
  end if;

  if v_operation = 'delete' then
    update public.rubber_bills
    set record_status = 'deleted',
        deleted_at = now(),
        deleted_by_name = payload->>'deletedByName',
        deleted_by_phone = payload->>'deletedByPhone',
        revision_no = revision_no + 1,
        idempotency_key = v_idempotency_key,
        server_received_at = now()
    where id = v_bill_id
    returning id, revision_no into v_bill_id, v_current_revision;

  else
    if v_bill_id is null then
      v_date := to_char((payload->>'billDate')::date, 'YYMMDD');
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));

      select count(*) + 1 into v_next_seq
      from public.rubber_bills
      where location_id = v_location_id
        and to_char(bill_date, 'YYMMDD') = v_date
        and server_bill_no is not null;

      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');
    end if;

    insert into public.rubber_bills (
      client_temp_id, idempotency_key, revision_no, sync_status, record_status,
      location_id, bill_no, local_bill_no, server_bill_no, bill_date,
      customer_name, customer_type, bill_type,
      weight, rubber_value, average_price,
      deduction_total, net_total,
      cash_payment, transfer_payment, acid_pack_count,
      client_recorded_at, client_created_at, server_received_at,
      created_by_user_id, created_by_name, created_by_phone
    ) values (
      v_client_temp_id,
      v_idempotency_key,
      coalesce(v_expected_revision + 1, 1),
      'synced',
      'active',
      v_location_id,
      coalesce(v_server_bill_no, payload->>'localBillNo'),
      payload->>'localBillNo',
      v_server_bill_no,
      (payload->>'billDate')::date,
      payload->>'customerName',
      payload->>'customerType',
      'weighing',
      (payload->>'weight')::numeric,
      (payload->>'rubberValue')::numeric,
      (payload->>'averagePrice')::numeric,
      (payload->>'deductionTotal')::numeric,
      (payload->>'netTotal')::numeric,
      (payload->>'cashPayment')::numeric,
      (payload->>'transferPayment')::numeric,
      (payload->>'acidPackCount')::numeric,
      (payload->>'clientRecordedAt')::timestamptz,
      (payload->>'clientCreatedAt')::timestamptz,
      now(),
      v_created_by_user_id,
      coalesce(v_created_by_name, ''),
      coalesce(v_created_by_phone, '')
    )
    on conflict (client_temp_id) do update set
      revision_no = public.rubber_bills.revision_no + 1,
      idempotency_key = excluded.idempotency_key,
      sync_status = 'synced',
      record_status = 'active',
      bill_date = excluded.bill_date,
      customer_name = excluded.customer_name,
      customer_type = excluded.customer_type,
      weight = excluded.weight,
      rubber_value = excluded.rubber_value,
      average_price = excluded.average_price,
      deduction_total = excluded.deduction_total,
      net_total = excluded.net_total,
      cash_payment = excluded.cash_payment,
      transfer_payment = excluded.transfer_payment,
      acid_pack_count = excluded.acid_pack_count,
      client_recorded_at = excluded.client_recorded_at,
      server_received_at = now()
    returning id, revision_no into v_bill_id, v_current_revision;

    delete from public.rubber_bill_items where bill_id = v_bill_id;

    for v_item in select * from jsonb_array_elements(payload->'items')
    loop
      insert into public.rubber_bill_items (
        bill_id, item_type, description,
        weight_in, weight_out, net_weight,
        quantity, unit, price, total, stock_product_id
      ) values (
        v_bill_id,
        v_item->>'itemType',
        v_item->>'description',
        (v_item->>'inWeight')::numeric,
        (v_item->>'outWeight')::numeric,
        (v_item->>'netWeight')::numeric,
        (v_item->>'quantity')::numeric,
        v_item->>'unit',
        (v_item->>'unitPrice')::numeric,
        (v_item->>'totalAmount')::numeric,
        nullif(v_item->>'stockProductId', '')::uuid
      );
    end loop;
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_bill_id,
    'serverBillNo', v_server_bill_no,
    'revisionNo', v_current_revision,
    'serverReceivedAt', now()
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."sync_rubber_bill_core_20260716020000"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_stock_entry"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return public.sync_acid_stock_entry(payload);
end;
$$;


ALTER FUNCTION "public"."sync_stock_entry"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_acid_stock"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;
  v_from_location_id uuid;
  v_to_location_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_tx_date date;
  v_quantity numeric;
  v_balance numeric;
  v_date text;
  v_next_seq integer;
  v_transfer_bill_no text;
  v_out_id uuid;
  v_in_id uuid;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles
  where id = v_created_by_user_id;

  v_from_location_id := (payload->>'fromLocationId')::uuid;
  v_to_location_id := (payload->>'toLocationId')::uuid;
  v_product_id := (payload->>'productId')::uuid;
  v_tx_date := (payload->>'txDate')::date;
  v_quantity := (payload->>'quantity')::numeric;

  if v_from_location_id = v_to_location_id then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'สาขาต้นทางและปลายทางต้องไม่ซ้ำกัน');
  end if;

  if not public.can_access_location(v_from_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if not exists (select 1 from public.locations where id = v_to_location_id and is_active = true) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสาขาปลายทาง');
  end if;

  if v_quantity is null or v_quantity <= 0 then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนย้ายต้องมากกว่า 0');
  end if;

  select name into v_product_name
  from public.stock_products
  where id = v_product_id
    and is_active = true;

  if v_product_name is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบสินค้าในสต็อก');
  end if;

  perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_from_location_id::text || ':' || v_product_id::text));
  perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_to_location_id::text || ':' || v_product_id::text));

  v_balance := public.get_stock_balance(v_from_location_id, v_product_id);
  if v_balance < v_quantity then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกไม่พอสำหรับย้ายสินค้า');
  end if;

  v_date := to_char(v_tx_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext('acid-transfer:' || v_date));

  select count(*) + 1 into v_next_seq
  from public.stock_entries
  where tx_date = v_tx_date
    and transfer_bill_no is not null;

  v_transfer_bill_no := 'AT-' || v_date || '-' || lpad(v_next_seq::text, 4, '0');

  insert into public.stock_entries (
    server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, transfer_bill_no,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_transfer_bill_no, v_tx_date, v_product_id, v_product_name, -abs(v_quantity),
    0, v_from_location_id, 'transfer_out', v_transfer_bill_no,
    v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning id into v_out_id;

  insert into public.stock_entries (
    server_bill_no, tx_date, product_id, product_name, quantity_delta,
    amount, location_id, tx_type, transfer_bill_no,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_transfer_bill_no, v_tx_date, v_product_id, v_product_name, abs(v_quantity),
    0, v_to_location_id, 'transfer_in', v_transfer_bill_no,
    v_created_by_user_id, coalesce(v_created_by_name, ''), v_created_by_phone
  )
  returning id into v_in_id;

  return jsonb_build_object(
    'status', 'synced',
    'transferBillNo', v_transfer_bill_no,
    'outId', v_out_id,
    'inId', v_in_id,
    'serverReceivedAt', now()
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "public"."transfer_acid_stock"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_stock"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return public.transfer_acid_stock(payload);
end;
$$;


ALTER FUNCTION "public"."transfer_stock"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_stock_non_negative_after_entry_delete"("p_location_id" "uuid", "p_product_id" "uuid", "p_deleted_entry_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_balance numeric := 0;
  v_movement record;
begin
  for v_movement in
    select
      movement_id,
      source_type,
      source_id,
      tx_date,
      display_bill_no,
      quantity_delta
    from public.stock_movements
    where location_id = p_location_id
      and product_id = p_product_id
      and not (
        source_type = 'stock_entry'
        and source_id = any(p_deleted_entry_ids)
      )
    order by tx_date asc, movement_id asc
  loop
    v_balance := v_balance + coalesce(v_movement.quantity_delta, 0);

    if v_balance < -0.000001 then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'ลบรายการนี้ไม่ได้ เพราะรายการ ' || coalesce(v_movement.display_bill_no, v_movement.movement_id) || ' วันที่ ' || v_movement.tx_date::text || ' จะทำให้สต็อกติดลบ'
      );
    end if;
  end loop;

  return jsonb_build_object('status', 'ok');
end;
$$;


ALTER FUNCTION "public"."validate_stock_non_negative_after_entry_delete"("p_location_id" "uuid", "p_product_id" "uuid", "p_deleted_entry_ids" "uuid"[]) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."stock_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "unit" "text" DEFAULT 'ถัง'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by_user_id" "uuid",
    "created_by_name" "text",
    "created_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stock_products" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."acid_products" WITH ("security_invoker"='true') AS
 SELECT "id",
    "name",
    "unit",
    "is_active",
    "created_by_user_id",
    "created_by_name",
    "created_by_phone",
    "created_at",
    "updated_at"
   FROM "public"."stock_products";


ALTER VIEW "public"."acid_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "server_bill_no" "text",
    "tx_date" "date" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "product_name" "text" NOT NULL,
    "quantity_delta" numeric(12,2) NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "location_id" "uuid" NOT NULL,
    "tx_type" "text" NOT NULL,
    "transfer_bill_no" "text",
    "record_status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "created_by_name" "text" NOT NULL,
    "created_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by_name" "text",
    "deleted_by_phone" "text",
    CONSTRAINT "acid_stock_entries_tx_type_check" CHECK (("tx_type" = ANY (ARRAY['receive'::"text", 'transfer_out'::"text", 'transfer_in'::"text"])))
);


ALTER TABLE "public"."stock_entries" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."acid_stock_entries" WITH ("security_invoker"='true') AS
 SELECT "id",
    "server_bill_no",
    "tx_date",
    "product_id",
    "product_name",
    "quantity_delta",
    "amount",
    "location_id",
    "tx_type",
    "transfer_bill_no",
    "record_status",
    "created_by_user_id",
    "created_by_name",
    "created_by_phone",
    "created_at",
    "updated_at",
    "deleted_at",
    "deleted_by_name",
    "deleted_by_phone"
   FROM "public"."stock_entries";


ALTER VIEW "public"."acid_stock_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_expense" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_temp_id" "text",
    "local_bill_no" "text" NOT NULL,
    "server_bill_no" "text",
    "idempotency_key" "text",
    "sync_status" "public"."sync_status" DEFAULT 'pending'::"public"."sync_status" NOT NULL,
    "record_status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "type" "public"."transaction_type" NOT NULL,
    "number" "text" NOT NULL,
    "tx_date" "date" NOT NULL,
    "title" "text" NOT NULL,
    "cost" numeric(12,2) DEFAULT 0 NOT NULL,
    "gateway" "text",
    "color" "text",
    "unit" "text",
    "price" numeric(12,2),
    "bill_option" "text",
    "locked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_recorded_at" timestamp with time zone,
    "client_created_at" timestamp with time zone,
    "server_received_at" timestamp with time zone,
    "revision_no" integer DEFAULT 0 NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by_name" "text",
    "deleted_by_phone" "text",
    "created_by_user_id" "uuid" NOT NULL,
    "created_by_name" "text" NOT NULL,
    "created_by_phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "income_sale_item_id" "uuid",
    "stock_product_id" "uuid",
    "stock_quantity" numeric(12,2),
    CONSTRAINT "income_expense_bill_option_check" CHECK ((("record_status" = 'deleted'::"public"."record_status") OR (("bill_option" IS NOT NULL) AND ((("type" = 'income'::"public"."transaction_type") AND ("bill_option" = ANY (ARRAY['รายรับ'::"text", 'บิลขาย'::"text"]))) OR (("type" = 'expense'::"public"."transaction_type") AND ("bill_option" = 'ค่าใช้จ่าย'::"text"))))))
);


ALTER TABLE "public"."income_expense" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubber_bill_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_id" "uuid" NOT NULL,
    "item_type" "text" NOT NULL,
    "description" "text",
    "weight_in" numeric(12,2),
    "weight_out" numeric(12,2),
    "net_weight" numeric(12,2),
    "quantity" numeric(12,2),
    "unit" "text",
    "price" numeric(12,2),
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stock_product_id" "uuid"
);


ALTER TABLE "public"."rubber_bill_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubber_bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_temp_id" "text",
    "local_bill_no" "text" NOT NULL,
    "server_bill_no" "text",
    "idempotency_key" "text",
    "sync_status" "public"."sync_status" DEFAULT 'pending'::"public"."sync_status" NOT NULL,
    "record_status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "bill_no" "text" NOT NULL,
    "bill_date" "date" NOT NULL,
    "customer_id" "uuid",
    "customer_name" "text",
    "customer_type" "text",
    "bill_type" "text" NOT NULL,
    "deduct_weight" numeric(12,2) DEFAULT 0 NOT NULL,
    "weight" numeric(12,2) DEFAULT 0 NOT NULL,
    "rubber_value" numeric(12,2) DEFAULT 0 NOT NULL,
    "average_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "deduction_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "net_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "cash_payment" numeric(12,2) DEFAULT 0 NOT NULL,
    "transfer_payment" numeric(12,2) DEFAULT 0 NOT NULL,
    "acid_pack_count" numeric(12,2) DEFAULT 0 NOT NULL,
    "print_status" "text" DEFAULT 'ยังไม่ได้ปริ้น'::"text" NOT NULL,
    "locked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_recorded_at" timestamp with time zone,
    "client_created_at" timestamp with time zone,
    "server_received_at" timestamp with time zone,
    "revision_no" integer DEFAULT 0 NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by_name" "text",
    "deleted_by_phone" "text",
    "created_by_user_id" "uuid" NOT NULL,
    "created_by_name" "text" NOT NULL,
    "created_by_phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rubber_bills_customer_type_check" CHECK (("customer_type" = ANY (ARRAY['สาขานี้จ่าย'::"text", 'สาขาใหญ่จ่าย'::"text"])))
);


ALTER TABLE "public"."rubber_bills" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."acid_stock_movements" WITH ("security_invoker"='true') AS
 SELECT ('stock-entry:'::"text" || ("e"."id")::"text") AS "movement_id",
    'stock_entry'::"text" AS "source_type",
    "e"."id" AS "source_id",
    NULL::"uuid" AS "source_line_id",
    "e"."tx_date",
    "e"."location_id",
    "e"."product_id",
    "e"."product_name",
    "e"."quantity_delta",
    "e"."amount",
    COALESCE("e"."server_bill_no", "e"."transfer_bill_no", ("e"."id")::"text") AS "display_bill_no",
    "e"."tx_type",
    "e"."created_by_user_id",
    "e"."created_by_name",
    "e"."created_by_phone",
    "e"."created_at",
    NULL::"text" AS "relation_lock_reason"
   FROM "public"."stock_entries" "e"
  WHERE ("e"."record_status" = 'active'::"public"."record_status")
UNION ALL
 SELECT ('income-sale:'::"text" || ("ie"."id")::"text") AS "movement_id",
    'income_sale'::"text" AS "source_type",
    "ie"."id" AS "source_id",
    NULL::"uuid" AS "source_line_id",
    "ie"."tx_date",
    "ie"."location_id",
    "ie"."stock_product_id" AS "product_id",
    "p"."name" AS "product_name",
    (- "abs"("ie"."stock_quantity")) AS "quantity_delta",
    "ie"."cost" AS "amount",
    COALESCE("ie"."server_bill_no", "ie"."local_bill_no", ("ie"."id")::"text") AS "display_bill_no",
    'income_sale'::"text" AS "tx_type",
    "ie"."created_by_user_id",
    "ie"."created_by_name",
    "ie"."created_by_phone",
    "ie"."created_at",
    'รายการนี้มาจากบิลขาย ต้องแก้ไขหรือลบที่โมดูลรับ-จ่าย'::"text" AS "relation_lock_reason"
   FROM ("public"."income_expense" "ie"
     JOIN "public"."stock_products" "p" ON (("p"."id" = "ie"."stock_product_id")))
  WHERE (("ie"."record_status" = 'active'::"public"."record_status") AND ("ie"."type" = 'income'::"public"."transaction_type") AND ("ie"."bill_option" = 'บิลขาย'::"text") AND ("ie"."stock_product_id" IS NOT NULL) AND (COALESCE("ie"."stock_quantity", (0)::numeric) > (0)::numeric))
UNION ALL
 SELECT ('rubber-bill-stock:'::"text" || ("i"."id")::"text") AS "movement_id",
    'rubber_bill_stock_deduction'::"text" AS "source_type",
    "b"."id" AS "source_id",
    "i"."id" AS "source_line_id",
    "b"."bill_date" AS "tx_date",
    "b"."location_id",
    "i"."stock_product_id" AS "product_id",
    "p"."name" AS "product_name",
    (- "abs"("i"."quantity")) AS "quantity_delta",
    "i"."total" AS "amount",
    COALESCE("b"."server_bill_no", "b"."local_bill_no", ("b"."id")::"text") AS "display_bill_no",
    'rubber_bill_stock_deduction'::"text" AS "tx_type",
    "b"."created_by_user_id",
    "b"."created_by_name",
    "b"."created_by_phone",
    "i"."created_at",
    'รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยาง'::"text" AS "relation_lock_reason"
   FROM (("public"."rubber_bill_items" "i"
     JOIN "public"."rubber_bills" "b" ON (("b"."id" = "i"."bill_id")))
     JOIN "public"."stock_products" "p" ON (("p"."id" = "i"."stock_product_id")))
  WHERE (("b"."record_status" = 'active'::"public"."record_status") AND ("i"."item_type" = ANY (ARRAY['acid'::"text", 'stock_deduction'::"text"])) AND ("i"."stock_product_id" IS NOT NULL) AND (COALESCE("i"."quantity", (0)::numeric) > (0)::numeric));


ALTER VIEW "public"."acid_stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_bank_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "bank_name" "text" NOT NULL,
    "account_number" "text" NOT NULL,
    "account_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."customer_bank_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_farms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "owner_name" "text",
    "address" "text",
    "card_number" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_farms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "legacy_rec_id" "text",
    "legacy_member_id" "text",
    "class" "text",
    "main_name" "text" NOT NULL,
    "fsc_status" "text",
    "starting_points_date" "date",
    "default_location_id" "uuid",
    "created_by_user_id" "uuid",
    "created_by_name" "text" NOT NULL,
    "created_by_phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_temp_id" "text",
    "idempotency_key" "text",
    "revision_no" integer DEFAULT 0 NOT NULL,
    "sync_status" "public"."sync_status" DEFAULT 'synced'::"public"."sync_status" NOT NULL,
    "record_status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by_name" "text",
    "deleted_by_phone" "text",
    "client_recorded_at" timestamp with time zone,
    "client_created_at" timestamp with time zone,
    "server_received_at" timestamp with time zone,
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "updated_by_phone" "text",
    CONSTRAINT "customers_class_check" CHECK (("class" = ANY (ARRAY['สาขานี้จ่าย'::"text", 'สาขาใหญ่จ่าย'::"text"]))),
    CONSTRAINT "customers_main_name_check" CHECK (("main_name" <> ''::"text"))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "type" "public"."financial_transaction_type" NOT NULL,
    "amount" numeric NOT NULL,
    "status" "public"."approval_status" DEFAULT 'PENDING'::"public"."approval_status" NOT NULL,
    "admin_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "due_date" "date",
    "description" "text",
    "remaining_amount" numeric DEFAULT 0,
    "parent_debt_id" "uuid",
    "approved_by" "uuid",
    "expense_location_id" "uuid",
    "approved_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "cancel_reason" "text"
);


ALTER TABLE "public"."financial_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_expense_approval_keywords" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "keyword" "text" NOT NULL,
    "match_mode" "text" DEFAULT 'contains'::"text" NOT NULL,
    "applies_to" "text" DEFAULT 'expense'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "approval_min_amount" numeric(12,2),
    "created_by_user_id" "uuid",
    "created_by_name" "text",
    "created_by_phone" "text",
    "deleted_at" timestamp with time zone,
    "deleted_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "income_expense_approval_keywords_applies_to_check" CHECK (("applies_to" = ANY (ARRAY['income'::"text", 'expense'::"text", 'both'::"text"]))),
    CONSTRAINT "income_expense_approval_keywords_match_mode_check" CHECK (("match_mode" = ANY (ARRAY['contains'::"text", 'exact'::"text"])))
);


ALTER TABLE "public"."income_expense_approval_keywords" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_expense_approval_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_operation" "text" NOT NULL,
    "request_idempotency_key" "text" NOT NULL,
    "requested_payload" "jsonb" NOT NULL,
    "source_income_expense_id" "uuid",
    "approved_income_expense_id" "uuid",
    "matched_keyword_id" "uuid",
    "matched_keyword" "text",
    "matched_reason" "text" DEFAULT 'keyword'::"text" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "tx_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "cost" numeric(12,2) NOT NULL,
    "requested_by_user_id" "uuid" NOT NULL,
    "requested_by_name" "text" NOT NULL,
    "requested_by_phone" "text" NOT NULL,
    "decided_by_user_id" "uuid",
    "decided_by_name" "text",
    "decided_by_phone" "text",
    "decided_at" timestamp with time zone,
    "decision_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "income_expense_approval_requests_matched_reason_check" CHECK (("matched_reason" = ANY (ARRAY['keyword'::"text", 'amount_threshold'::"text", 'keyword_and_amount'::"text"]))),
    CONSTRAINT "income_expense_approval_requests_request_status_check" CHECK (("request_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "income_expense_approval_requests_requested_operation_check" CHECK (("requested_operation" = ANY (ARRAY['create'::"text", 'update'::"text", 'delete'::"text"]))),
    CONSTRAINT "income_expense_approval_requests_tx_type_check" CHECK (("tx_type" = ANY (ARRAY['income'::"text", 'expense'::"text"])))
);


ALTER TABLE "public"."income_expense_approval_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_expense_approval_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "applies_to" "text" DEFAULT 'both'::"text" NOT NULL,
    "approval_min_amount" numeric(12,2),
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "updated_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "income_expense_approval_settings_applies_to_check" CHECK (("applies_to" = ANY (ARRAY['income'::"text", 'expense'::"text", 'both'::"text"]))),
    CONSTRAINT "income_expense_approval_settings_id_check" CHECK ("id")
);


ALTER TABLE "public"."income_expense_approval_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_sale_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by_user_id" "uuid",
    "created_by_name" "text",
    "created_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by_user_id" "uuid",
    "stock_product_id" "uuid"
);


ALTER TABLE "public"."income_sale_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leave_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "type" "public"."leave_request_type" DEFAULT 'FULL_DAY'::"public"."leave_request_type" NOT NULL,
    "status" "public"."approval_status" DEFAULT 'PENDING'::"public"."approval_status" NOT NULL,
    "admin_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_by" "uuid"
);


ALTER TABLE "public"."leave_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text",
    "address" "text",
    "phone" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."money_transfer_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transfer_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "customer_name" "text",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "money_transfer_items_source_type_check" CHECK (("source_type" = ANY (ARRAY['rubber_bill'::"text", 'ocr_ticket'::"text"])))
);


ALTER TABLE "public"."money_transfer_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."money_transfer_slips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transfer_id" "uuid" NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "reference_number" "text",
    "fee" numeric(12,2) DEFAULT 0 NOT NULL,
    "sender_name" "text",
    "receiver_name" "text",
    "transaction_date" timestamp with time zone,
    "slip_image_url" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."money_transfer_slips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."money_transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_temp_id" "text",
    "idempotency_key" "text",
    "location_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "customer_name" "text",
    "account_number" "text",
    "account_name" "text",
    "bank_name" "text",
    "net_amount_to_pay" numeric(12,2) DEFAULT 0 NOT NULL,
    "transfer_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sync_status" "public"."sync_status" DEFAULT 'pending'::"public"."sync_status" NOT NULL,
    "record_status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "revision_no" integer DEFAULT 0 NOT NULL,
    "created_by_user_id" "uuid",
    "created_by_name" "text" DEFAULT ''::"text" NOT NULL,
    "created_by_phone" "text" DEFAULT ''::"text" NOT NULL,
    "client_recorded_at" timestamp with time zone,
    "server_received_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "deleted_by_name" "text",
    "deleted_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "branch_paid_amount" numeric(12,2) DEFAULT 0,
    "transfer_type" "text" DEFAULT 'customer'::"text" NOT NULL,
    "transport_cost" numeric(12,2) DEFAULT 0,
    "transport_staff_id" "uuid",
    "transport_staff_name" "text",
    "target_location_id" "uuid",
    "target_location_name" "text",
    CONSTRAINT "money_transfers_transfer_status_check" CHECK (("transfer_status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'partial'::"text", 'overpaid'::"text", 'branch_and_transfer'::"text", 'advance_payment'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "money_transfers_transfer_type_check" CHECK (("transfer_type" = ANY (ARRAY['customer'::"text", 'transport'::"text", 'branch'::"text"])))
);


ALTER TABLE "public"."money_transfers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ocr_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_temp_id" "text",
    "idempotency_key" "text",
    "location_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "ticket_id" "text",
    "license_plate" "text",
    "date_in" "date",
    "weight_in" integer,
    "weight_out" integer,
    "weight_net" integer,
    "weight_deducted" numeric(12,2) DEFAULT 0,
    "weight_remaining" numeric(12,2) DEFAULT 0,
    "total_amount" numeric(12,2) DEFAULT 0,
    "sync_status" "public"."sync_status" DEFAULT 'pending'::"public"."sync_status" NOT NULL,
    "record_status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "revision_no" integer DEFAULT 0 NOT NULL,
    "created_by_user_id" "uuid",
    "created_by_name" "text" DEFAULT 'ผู้ดูแลระบบ'::"text" NOT NULL,
    "created_by_phone" "text" DEFAULT '0800000000'::"text" NOT NULL,
    "client_recorded_at" timestamp with time zone,
    "server_received_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "deleted_by_name" "text",
    "deleted_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "drive_file_id" "text",
    "drive_url" "text",
    "customer_name" "text",
    "money_deducted" numeric DEFAULT 0
);


ALTER TABLE "public"."ocr_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payroll_slips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "gross_pay" numeric DEFAULT 0 NOT NULL,
    "total_deductions" numeric DEFAULT 0 NOT NULL,
    "net_pay" numeric DEFAULT 0 NOT NULL,
    "total_days" numeric DEFAULT 0 NOT NULL,
    "daily_wage" numeric DEFAULT 0 NOT NULL,
    "slip_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "public"."approval_status" DEFAULT 'PENDING'::"public"."approval_status" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "approved_by" "uuid",
    "admin_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expense_location_id" "uuid",
    "approved_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "cancel_reason" "text"
);


ALTER TABLE "public"."payroll_slips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "name" "text" NOT NULL,
    "password_hash" "text",
    "role" "public"."app_role" DEFAULT 'user'::"public"."app_role" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "daily_wage" numeric DEFAULT 0 NOT NULL,
    "can_access_money_transfer" boolean DEFAULT false NOT NULL,
    "can_access_super_admin_features" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_entry_approval_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "request_type" "text" DEFAULT 'delete_stock_entry'::"text" NOT NULL,
    "request_idempotency_key" "text" NOT NULL,
    "requested_payload" "jsonb" NOT NULL,
    "stock_entry_id" "uuid" NOT NULL,
    "transfer_bill_no" "text",
    "tx_type" "text" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "product_name" "text" NOT NULL,
    "quantity" numeric(12,2) NOT NULL,
    "location_id" "uuid" NOT NULL,
    "location_name" "text" NOT NULL,
    "target_location_id" "uuid",
    "target_location_name" "text",
    "requested_by_user_id" "uuid" NOT NULL,
    "requested_by_name" "text" NOT NULL,
    "requested_by_phone" "text" NOT NULL,
    "decided_by_user_id" "uuid",
    "decided_by_name" "text",
    "decided_by_phone" "text",
    "decided_at" timestamp with time zone,
    "decision_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_entry_approval_requests_request_status_check" CHECK (("request_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "stock_entry_approval_requests_request_type_check" CHECK (("request_type" = 'delete_stock_entry'::"text")),
    CONSTRAINT "stock_entry_approval_requests_tx_type_check" CHECK (("tx_type" = ANY (ARRAY['receive'::"text", 'transfer_out'::"text"])))
);


ALTER TABLE "public"."stock_entry_approval_requests" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."stock_movements" WITH ("security_invoker"='true') AS
 SELECT "movement_id",
    "source_type",
    "source_id",
    "source_line_id",
    "tx_date",
    "location_id",
    "product_id",
    "product_name",
    "quantity_delta",
    "amount",
    "display_bill_no",
    "tx_type",
    "created_by_user_id",
    "created_by_name",
    "created_by_phone",
    "created_at",
    "relation_lock_reason"
   FROM "public"."acid_stock_movements";


ALTER VIEW "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_product_approval_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "request_type" "text" NOT NULL,
    "request_idempotency_key" "text" NOT NULL,
    "requested_payload" "jsonb" NOT NULL,
    "product_id" "uuid",
    "product_name" "text" NOT NULL,
    "unit" "text",
    "create_sale_item" boolean,
    "requested_by_user_id" "uuid" NOT NULL,
    "requested_by_name" "text" NOT NULL,
    "requested_by_phone" "text" NOT NULL,
    "decided_by_user_id" "uuid",
    "decided_by_name" "text",
    "decided_by_phone" "text",
    "decided_at" timestamp with time zone,
    "decision_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_product_approval_requests_request_status_check" CHECK (("request_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "stock_product_approval_requests_request_type_check" CHECK (("request_type" = ANY (ARRAY['create_product'::"text", 'delete_product'::"text"])))
);


ALTER TABLE "public"."stock_product_approval_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."time_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "start_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "end_time" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."time_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."time_tracking_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "target_table" "text" NOT NULL,
    "record_id" "uuid",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "comment" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."time_tracking_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_staff_bank_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "bank_name" "text" NOT NULL,
    "account_number" "text" NOT NULL,
    "account_name" "text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transport_staff_bank_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_staff_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transport_staff_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_staff_plates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "plate_number" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transport_staff_plates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_staffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_temp_id" "text",
    "idempotency_key" "text",
    "legacy_rec_id" "text",
    "legacy_member_id" "text",
    "main_name" "text" NOT NULL,
    "sync_status" "public"."sync_status" DEFAULT 'pending'::"public"."sync_status" NOT NULL,
    "record_status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "revision_no" integer DEFAULT 0 NOT NULL,
    "default_location_id" "uuid",
    "created_by_user_id" "uuid",
    "created_by_name" "text" DEFAULT ''::"text" NOT NULL,
    "created_by_phone" "text" DEFAULT ''::"text" NOT NULL,
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "updated_by_phone" "text",
    "server_received_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transport_staffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_locations" OWNER TO "postgres";


ALTER TABLE ONLY "public"."stock_products"
    ADD CONSTRAINT "acid_products_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."customer_bank_accounts"
    ADD CONSTRAINT "customer_bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_contacts"
    ADD CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_farms"
    ADD CONSTRAINT "customer_farms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_client_temp_id_key" UNIQUE ("client_temp_id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_withdrawal_expense_assignment" CHECK ((("type" <> 'WITHDRAWAL'::"public"."financial_transaction_type") OR ("status" <> 'APPROVED'::"public"."approval_status") OR ("cancelled_at" IS NOT NULL) OR (("expense_location_id" IS NOT NULL) AND ("approved_at" IS NOT NULL)))) NOT VALID;



ALTER TABLE ONLY "public"."income_expense_approval_keywords"
    ADD CONSTRAINT "income_expense_approval_keywords_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income_expense_approval_requests"
    ADD CONSTRAINT "income_expense_approval_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income_expense_approval_requests"
    ADD CONSTRAINT "income_expense_approval_requests_request_idempotency_key_key" UNIQUE ("request_idempotency_key");



ALTER TABLE ONLY "public"."income_expense_approval_settings"
    ADD CONSTRAINT "income_expense_approval_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_client_temp_id_key" UNIQUE ("client_temp_id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income_sale_items"
    ADD CONSTRAINT "income_sale_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."money_transfer_items"
    ADD CONSTRAINT "money_transfer_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."money_transfer_slips"
    ADD CONSTRAINT "money_transfer_slips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."money_transfers"
    ADD CONSTRAINT "money_transfers_client_temp_id_key" UNIQUE ("client_temp_id");



ALTER TABLE ONLY "public"."money_transfers"
    ADD CONSTRAINT "money_transfers_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."money_transfers"
    ADD CONSTRAINT "money_transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ocr_tickets"
    ADD CONSTRAINT "ocr_tickets_client_temp_id_key" UNIQUE ("client_temp_id");



ALTER TABLE ONLY "public"."ocr_tickets"
    ADD CONSTRAINT "ocr_tickets_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."ocr_tickets"
    ADD CONSTRAINT "ocr_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_expense_assignment" CHECK ((("status" <> 'APPROVED'::"public"."approval_status") OR ("cancelled_at" IS NOT NULL) OR ("net_pay" <= (0)::numeric) OR (("expense_location_id" IS NOT NULL) AND ("approved_at" IS NOT NULL)))) NOT VALID;



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubber_bill_items"
    ADD CONSTRAINT "rubber_bill_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_client_temp_id_key" UNIQUE ("client_temp_id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_location_id_local_bill_no_key" UNIQUE ("location_id", "local_bill_no");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_location_id_server_bill_no_bill_date_bill_type_key" UNIQUE ("location_id", "server_bill_no", "bill_date", "bill_type");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_entries"
    ADD CONSTRAINT "stock_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_entry_approval_requests"
    ADD CONSTRAINT "stock_entry_approval_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_entry_approval_requests"
    ADD CONSTRAINT "stock_entry_approval_requests_request_idempotency_key_key" UNIQUE ("request_idempotency_key");



ALTER TABLE ONLY "public"."stock_product_approval_requests"
    ADD CONSTRAINT "stock_product_approval_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_product_approval_requests"
    ADD CONSTRAINT "stock_product_approval_requests_request_idempotency_key_key" UNIQUE ("request_idempotency_key");



ALTER TABLE ONLY "public"."stock_products"
    ADD CONSTRAINT "stock_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_segments"
    ADD CONSTRAINT "time_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_tracking_audit_logs"
    ADD CONSTRAINT "time_tracking_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_staff_bank_accounts"
    ADD CONSTRAINT "transport_staff_bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_staff_contacts"
    ADD CONSTRAINT "transport_staff_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_staff_plates"
    ADD CONSTRAINT "transport_staff_plates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_staffs"
    ADD CONSTRAINT "transport_staffs_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."transport_staffs"
    ADD CONSTRAINT "transport_staffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_user_id_location_id_key" UNIQUE ("user_id", "location_id");



CREATE UNIQUE INDEX "customer_bank_accounts_only_one_primary" ON "public"."customer_bank_accounts" USING "btree" ("customer_id") WHERE ("is_primary" = true);



CREATE INDEX "financial_transactions_withdrawal_expense_feed_idx" ON "public"."financial_transactions" USING "btree" ("expense_location_id", "approved_at" DESC, "id" DESC) WHERE (("type" = 'WITHDRAWAL'::"public"."financial_transaction_type") AND ("status" = 'APPROVED'::"public"."approval_status") AND ("cancelled_at" IS NULL));



CREATE UNIQUE INDEX "idx_customer_bank_accounts_primary" ON "public"."customer_bank_accounts" USING "btree" ("customer_id") WHERE ("is_primary" = true);



CREATE INDEX "idx_stock_entries_location_active" ON "public"."stock_entries" USING "btree" ("location_id", "tx_date" DESC) WHERE ("record_status" = 'active'::"public"."record_status");



CREATE INDEX "idx_stock_entries_product_location" ON "public"."stock_entries" USING "btree" ("product_id", "location_id");



CREATE UNIQUE INDEX "income_expense_approval_keywords_active_unique" ON "public"."income_expense_approval_keywords" USING "btree" ("lower"(TRIM(BOTH FROM "keyword")), "applies_to") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "income_expense_feed_active_idx" ON "public"."income_expense" USING "btree" ("location_id", "tx_date" DESC, "created_at" DESC, "id" DESC) WHERE ("record_status" = 'active'::"public"."record_status");



CREATE UNIQUE INDEX "income_sale_items_name_active_idx" ON "public"."income_sale_items" USING "btree" ("lower"(TRIM(BOTH FROM "name"))) WHERE ("is_active" = true);



CREATE UNIQUE INDEX "money_transfer_items_source_unique" ON "public"."money_transfer_items" USING "btree" ("source_type", "source_id");



CREATE INDEX "money_transfers_feed_source_idx" ON "public"."money_transfers" USING "btree" ("location_id", "created_at" DESC, "id" DESC) WHERE ("record_status" <> 'deleted'::"public"."record_status");



CREATE INDEX "money_transfers_feed_target_idx" ON "public"."money_transfers" USING "btree" ("target_location_id", "created_at" DESC, "id" DESC) WHERE (("record_status" <> 'deleted'::"public"."record_status") AND ("transfer_status" <> 'cancelled'::"text") AND ("transfer_type" = 'branch'::"text"));



CREATE INDEX "ocr_tickets_feed_active_idx" ON "public"."ocr_tickets" USING "btree" ("location_id", "date_in" DESC, "id") WHERE (("record_status" = 'active'::"public"."record_status") AND ("total_amount" > (0)::numeric));



CREATE UNIQUE INDEX "ocr_tickets_location_file_unique" ON "public"."ocr_tickets" USING "btree" ("location_id", "file_name") WHERE ("record_status" = 'active'::"public"."record_status");



CREATE INDEX "payroll_slips_expense_feed_idx" ON "public"."payroll_slips" USING "btree" ("expense_location_id", "approved_at" DESC, "id" DESC) WHERE (("status" = 'APPROVED'::"public"."approval_status") AND ("cancelled_at" IS NULL) AND ("net_pay" > (0)::numeric));



CREATE UNIQUE INDEX "profiles_only_one_super_admin" ON "public"."profiles" USING "btree" ("role") WHERE ("role" = 'super_admin'::"public"."app_role");



CREATE INDEX "rubber_bills_feed_active_idx" ON "public"."rubber_bills" USING "btree" ("location_id", "bill_date" DESC, "id") WHERE (("record_status" = 'active'::"public"."record_status") AND ("net_total" > (0)::numeric));



CREATE UNIQUE INDEX "stock_entry_approval_requests_pending_entry_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("stock_entry_id") WHERE ("request_status" = 'pending'::"text");



CREATE UNIQUE INDEX "stock_entry_approval_requests_pending_transfer_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("transfer_bill_no") WHERE (("request_status" = 'pending'::"text") AND ("transfer_bill_no" IS NOT NULL) AND ("tx_type" = 'transfer_out'::"text"));



CREATE INDEX "stock_entry_approval_requests_status_created_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("request_status", "created_at" DESC);



CREATE UNIQUE INDEX "stock_product_approval_requests_pending_create_name_idx" ON "public"."stock_product_approval_requests" USING "btree" ("lower"(TRIM(BOTH FROM "product_name"))) WHERE (("request_status" = 'pending'::"text") AND ("request_type" = 'create_product'::"text"));



CREATE UNIQUE INDEX "stock_product_approval_requests_pending_delete_product_idx" ON "public"."stock_product_approval_requests" USING "btree" ("product_id") WHERE (("request_status" = 'pending'::"text") AND ("request_type" = 'delete_product'::"text"));



CREATE INDEX "stock_product_approval_requests_status_created_idx" ON "public"."stock_product_approval_requests" USING "btree" ("request_status", "created_at" DESC);



CREATE UNIQUE INDEX "transport_staff_bank_accounts_one_primary" ON "public"."transport_staff_bank_accounts" USING "btree" ("staff_id") WHERE ("is_primary" = true);



CREATE OR REPLACE TRIGGER "enforce_financial_transaction_expense_relation" BEFORE UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_time_tracking_expense_relation"();



CREATE OR REPLACE TRIGGER "enforce_payroll_slip_expense_relation" BEFORE UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_time_tracking_expense_relation"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."leave_requests" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."time_segments" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "income_expense_lock_location" BEFORE UPDATE ON "public"."income_expense" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_location_change"();



CREATE OR REPLACE TRIGGER "ocr_tickets_transfer_relation_delete_lock" BEFORE DELETE ON "public"."ocr_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_locked_ocr_ticket_change"();



CREATE OR REPLACE TRIGGER "ocr_tickets_transfer_relation_update_lock" BEFORE UPDATE ON "public"."ocr_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_locked_ocr_ticket_change"();



CREATE OR REPLACE TRIGGER "prevent_hard_delete_of_linked_financial_transaction" BEFORE DELETE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"();



CREATE OR REPLACE TRIGGER "prevent_hard_delete_of_linked_payroll_slip" BEFORE DELETE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"();



CREATE OR REPLACE TRIGGER "rubber_bills_lock_location" BEFORE UPDATE ON "public"."rubber_bills" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_location_change"();



ALTER TABLE ONLY "public"."stock_products"
    ADD CONSTRAINT "acid_products_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_entries"
    ADD CONSTRAINT "acid_stock_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_entries"
    ADD CONSTRAINT "acid_stock_entries_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."stock_entries"
    ADD CONSTRAINT "acid_stock_entries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."customer_bank_accounts"
    ADD CONSTRAINT "customer_bank_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_contacts"
    ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_farms"
    ADD CONSTRAINT "customer_farms_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_default_location_id_fkey" FOREIGN KEY ("default_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_expense_location_id_fkey" FOREIGN KEY ("expense_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_parent_debt_id_fkey" FOREIGN KEY ("parent_debt_id") REFERENCES "public"."financial_transactions"("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense_approval_keywords"
    ADD CONSTRAINT "income_expense_approval_keywords_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense_approval_keywords"
    ADD CONSTRAINT "income_expense_approval_keywords_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense_approval_requests"
    ADD CONSTRAINT "income_expense_approval_request_approved_income_expense_id_fkey" FOREIGN KEY ("approved_income_expense_id") REFERENCES "public"."income_expense"("id");



ALTER TABLE ONLY "public"."income_expense_approval_requests"
    ADD CONSTRAINT "income_expense_approval_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense_approval_requests"
    ADD CONSTRAINT "income_expense_approval_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."income_expense_approval_requests"
    ADD CONSTRAINT "income_expense_approval_requests_matched_keyword_id_fkey" FOREIGN KEY ("matched_keyword_id") REFERENCES "public"."income_expense_approval_keywords"("id");



ALTER TABLE ONLY "public"."income_expense_approval_requests"
    ADD CONSTRAINT "income_expense_approval_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense_approval_requests"
    ADD CONSTRAINT "income_expense_approval_requests_source_income_expense_id_fkey" FOREIGN KEY ("source_income_expense_id") REFERENCES "public"."income_expense"("id");



ALTER TABLE ONLY "public"."income_expense_approval_settings"
    ADD CONSTRAINT "income_expense_approval_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_income_sale_item_id_fkey" FOREIGN KEY ("income_sale_item_id") REFERENCES "public"."income_sale_items"("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_stock_product_id_fkey" FOREIGN KEY ("stock_product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."income_sale_items"
    ADD CONSTRAINT "income_sale_items_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_sale_items"
    ADD CONSTRAINT "income_sale_items_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_sale_items"
    ADD CONSTRAINT "income_sale_items_stock_product_id_fkey" FOREIGN KEY ("stock_product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."money_transfer_items"
    ADD CONSTRAINT "money_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "public"."money_transfers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."money_transfer_slips"
    ADD CONSTRAINT "money_transfer_slips_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "public"."money_transfers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."money_transfers"
    ADD CONSTRAINT "money_transfers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."money_transfers"
    ADD CONSTRAINT "money_transfers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."money_transfers"
    ADD CONSTRAINT "money_transfers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."money_transfers"
    ADD CONSTRAINT "money_transfers_target_location_id_fkey" FOREIGN KEY ("target_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."money_transfers"
    ADD CONSTRAINT "money_transfers_transport_staff_id_fkey" FOREIGN KEY ("transport_staff_id") REFERENCES "public"."transport_staffs"("id");



ALTER TABLE ONLY "public"."ocr_tickets"
    ADD CONSTRAINT "ocr_tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."ocr_tickets"
    ADD CONSTRAINT "ocr_tickets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_expense_location_id_fkey" FOREIGN KEY ("expense_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_bill_items"
    ADD CONSTRAINT "rubber_bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."rubber_bills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rubber_bill_items"
    ADD CONSTRAINT "rubber_bill_items_stock_product_id_fkey" FOREIGN KEY ("stock_product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."stock_entry_approval_requests"
    ADD CONSTRAINT "stock_entry_approval_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_entry_approval_requests"
    ADD CONSTRAINT "stock_entry_approval_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."stock_entry_approval_requests"
    ADD CONSTRAINT "stock_entry_approval_requests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."stock_entry_approval_requests"
    ADD CONSTRAINT "stock_entry_approval_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_entry_approval_requests"
    ADD CONSTRAINT "stock_entry_approval_requests_stock_entry_id_fkey" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entries"("id");



ALTER TABLE ONLY "public"."stock_entry_approval_requests"
    ADD CONSTRAINT "stock_entry_approval_requests_target_location_id_fkey" FOREIGN KEY ("target_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."stock_product_approval_requests"
    ADD CONSTRAINT "stock_product_approval_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_product_approval_requests"
    ADD CONSTRAINT "stock_product_approval_requests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."stock_product_approval_requests"
    ADD CONSTRAINT "stock_product_approval_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."time_segments"
    ADD CONSTRAINT "time_segments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."time_tracking_audit_logs"
    ADD CONSTRAINT "time_tracking_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."transport_staff_bank_accounts"
    ADD CONSTRAINT "transport_staff_bank_accounts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."transport_staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_staff_contacts"
    ADD CONSTRAINT "transport_staff_contacts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."transport_staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_staff_plates"
    ADD CONSTRAINT "transport_staff_plates_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."transport_staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_staffs"
    ADD CONSTRAINT "transport_staffs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."transport_staffs"
    ADD CONSTRAINT "transport_staffs_default_location_id_fkey" FOREIGN KEY ("default_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."transport_staffs"
    ADD CONSTRAINT "transport_staffs_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Allow all authenticated users to read active items" ON "public"."income_sale_items" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "Allow system managers to insert" ON "public"."income_sale_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_access_super_admin_features"());



CREATE POLICY "Allow system managers to read all items" ON "public"."income_sale_items" FOR SELECT TO "authenticated" USING ("public"."can_access_super_admin_features"());



CREATE POLICY "Allow system managers to update" ON "public"."income_sale_items" FOR UPDATE TO "authenticated" USING ("public"."can_access_super_admin_features"()) WITH CHECK ("public"."can_access_super_admin_features"());



CREATE POLICY "acid_products_active_read" ON "public"."stock_products" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "acid_products_system_manager_insert" ON "public"."stock_products" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_access_super_admin_features"());



CREATE POLICY "acid_products_system_manager_read" ON "public"."stock_products" FOR SELECT TO "authenticated" USING ("public"."can_access_super_admin_features"());



CREATE POLICY "acid_products_system_manager_update" ON "public"."stock_products" FOR UPDATE TO "authenticated" USING ("public"."can_access_super_admin_features"()) WITH CHECK ("public"."can_access_super_admin_features"());



CREATE POLICY "acid_stock_entries_location_read" ON "public"."stock_entries" FOR SELECT TO "authenticated" USING ("public"."can_access_location"("location_id"));



ALTER TABLE "public"."customer_bank_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_bank_accounts_parent_scope" ON "public"."customer_bank_accounts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_bank_accounts"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_bank_accounts"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id")))));



CREATE POLICY "customer_bank_accounts_select_legacy_global" ON "public"."customer_bank_accounts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_bank_accounts"."customer_id") AND ("c"."default_location_id" IS NULL) AND "private"."is_active_user"()))));



ALTER TABLE "public"."customer_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_contacts_parent_scope" ON "public"."customer_contacts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_contacts"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_contacts"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id")))));



CREATE POLICY "customer_contacts_select_legacy_global" ON "public"."customer_contacts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_contacts"."customer_id") AND ("c"."default_location_id" IS NULL) AND "private"."is_active_user"()))));



ALTER TABLE "public"."customer_farms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_farms_parent_scope" ON "public"."customer_farms" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_farms"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_farms"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id")))));



CREATE POLICY "customer_farms_select_legacy_global" ON "public"."customer_farms" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_farms"."customer_id") AND ("c"."default_location_id" IS NULL) AND "private"."is_active_user"()))));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_delete_location" ON "public"."customers" FOR DELETE TO "authenticated" USING ("private"."can_access_optional_location"("default_location_id"));



CREATE POLICY "customers_insert_location" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ("private"."can_access_optional_location"("default_location_id"));



CREATE POLICY "customers_select_legacy_global" ON "public"."customers" FOR SELECT TO "authenticated" USING ((("default_location_id" IS NULL) AND "private"."is_active_user"()));



CREATE POLICY "customers_select_location" ON "public"."customers" FOR SELECT TO "authenticated" USING ("private"."can_access_optional_location"("default_location_id"));



CREATE POLICY "customers_update_location" ON "public"."customers" FOR UPDATE TO "authenticated" USING ("private"."can_access_optional_location"("default_location_id")) WITH CHECK ("private"."can_access_optional_location"("default_location_id"));



ALTER TABLE "public"."financial_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "financial_transactions_all" ON "public"."financial_transactions" TO "authenticated" USING (true);



ALTER TABLE "public"."income_expense" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."income_expense_approval_keywords" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_expense_approval_keywords_read" ON "public"."income_expense_approval_keywords" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR "public"."is_super_admin"()));



CREATE POLICY "income_expense_approval_keywords_system_manager_write" ON "public"."income_expense_approval_keywords" TO "authenticated" USING ("public"."can_access_super_admin_features"()) WITH CHECK ("public"."can_access_super_admin_features"());



ALTER TABLE "public"."income_expense_approval_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_expense_approval_requests_read" ON "public"."income_expense_approval_requests" FOR SELECT TO "authenticated" USING (("public"."can_access_super_admin_features"() OR ("requested_by_user_id" = "auth"."uid"()) OR "public"."can_access_location"("location_id")));



ALTER TABLE "public"."income_expense_approval_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_expense_approval_settings_read" ON "public"."income_expense_approval_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "income_expense_approval_settings_system_manager_write" ON "public"."income_expense_approval_settings" TO "authenticated" USING ("public"."can_access_super_admin_features"()) WITH CHECK ("public"."can_access_super_admin_features"());



CREATE POLICY "income_expense_select_location_scope" ON "public"."income_expense" FOR SELECT TO "authenticated" USING ("public"."can_access_location"("location_id"));



ALTER TABLE "public"."income_sale_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leave_requests_all" ON "public"."leave_requests" TO "authenticated" USING (true);



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_manage_super_admin" ON "public"."locations" TO "authenticated" USING ("private"."is_super_admin"()) WITH CHECK ("private"."is_super_admin"());



CREATE POLICY "locations_select_active_for_branch_transfer" ON "public"."locations" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "locations_select_assigned" ON "public"."locations" FOR SELECT TO "authenticated" USING ("private"."can_access_location"("id"));



ALTER TABLE "public"."money_transfer_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "money_transfer_items_delete_module_scope" ON "public"."money_transfer_items" FOR DELETE TO "authenticated" USING (("private"."can_access_money_transfer_module"() AND (EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "private"."can_access_location"("t"."location_id"))))));



CREATE POLICY "money_transfer_items_insert_module_scope" ON "public"."money_transfer_items" FOR INSERT TO "authenticated" WITH CHECK (("private"."can_access_money_transfer_module"() AND (EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "private"."can_access_location"("t"."location_id"))))));



CREATE POLICY "money_transfer_items_select_parent_scope" ON "public"."money_transfer_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "private"."can_access_location"("t"."location_id")))));



CREATE POLICY "money_transfer_items_update_module_scope" ON "public"."money_transfer_items" FOR UPDATE TO "authenticated" USING (("private"."can_access_money_transfer_module"() AND (EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "private"."can_access_location"("t"."location_id")))))) WITH CHECK (("private"."can_access_money_transfer_module"() AND (EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "private"."can_access_location"("t"."location_id"))))));



ALTER TABLE "public"."money_transfer_slips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "money_transfer_slips_delete_module_scope" ON "public"."money_transfer_slips" FOR DELETE TO "authenticated" USING (("private"."can_access_money_transfer_module"() AND (EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "private"."can_access_location"("t"."location_id"))))));



CREATE POLICY "money_transfer_slips_insert_module_scope" ON "public"."money_transfer_slips" FOR INSERT TO "authenticated" WITH CHECK (("private"."can_access_money_transfer_module"() AND (EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "private"."can_access_location"("t"."location_id"))))));



CREATE POLICY "money_transfer_slips_select_parent_scope" ON "public"."money_transfer_slips" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "private"."can_access_location"("t"."location_id")))));



CREATE POLICY "money_transfer_slips_update_module_scope" ON "public"."money_transfer_slips" FOR UPDATE TO "authenticated" USING (("private"."can_access_money_transfer_module"() AND (EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "private"."can_access_location"("t"."location_id")))))) WITH CHECK (("private"."can_access_money_transfer_module"() AND (EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "private"."can_access_location"("t"."location_id"))))));



ALTER TABLE "public"."money_transfers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "money_transfers_branch_target_select_scope" ON "public"."money_transfers" FOR SELECT TO "authenticated" USING ((("transfer_type" = 'branch'::"text") AND ("target_location_id" IS NOT NULL) AND "private"."can_access_location"("target_location_id")));



CREATE POLICY "money_transfers_delete_module_scope" ON "public"."money_transfers" FOR DELETE TO "authenticated" USING (("private"."can_access_money_transfer_module"() AND "private"."can_access_location"("location_id")));



CREATE POLICY "money_transfers_insert_module_scope" ON "public"."money_transfers" FOR INSERT TO "authenticated" WITH CHECK (("private"."can_access_money_transfer_module"() AND "private"."can_access_location"("location_id")));



CREATE POLICY "money_transfers_select_location_scope" ON "public"."money_transfers" FOR SELECT TO "authenticated" USING ("private"."can_access_location"("location_id"));



CREATE POLICY "money_transfers_update_module_scope" ON "public"."money_transfers" FOR UPDATE TO "authenticated" USING (("private"."can_access_money_transfer_module"() AND "private"."can_access_location"("location_id"))) WITH CHECK (("private"."can_access_money_transfer_module"() AND "private"."can_access_location"("location_id")));



ALTER TABLE "public"."ocr_tickets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ocr_tickets_location_scope" ON "public"."ocr_tickets" TO "authenticated" USING ("private"."can_access_location"("location_id")) WITH CHECK ("private"."can_access_location"("location_id"));



ALTER TABLE "public"."payroll_slips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payroll_slips_all" ON "public"."payroll_slips" TO "authenticated" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_authorized" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("private"."can_view_profile"("id"));



CREATE POLICY "profiles_update_super_admin" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("private"."is_super_admin"()) WITH CHECK ("private"."is_super_admin"());



CREATE POLICY "rubber bill items select scoped through bill" ON "public"."rubber_bill_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."rubber_bills" "b"
  WHERE (("b"."id" = "rubber_bill_items"."bill_id") AND "public"."can_access_location"("b"."location_id")))));



CREATE POLICY "rubber bills location scoped" ON "public"."rubber_bills" FOR SELECT USING ("public"."can_access_location"("location_id"));



ALTER TABLE "public"."rubber_bill_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubber_bills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_entry_approval_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_entry_approval_requests_read" ON "public"."stock_entry_approval_requests" FOR SELECT TO "authenticated" USING (("public"."can_access_super_admin_features"() OR ("requested_by_user_id" = "auth"."uid"()) OR "public"."can_access_location"("location_id") OR (("target_location_id" IS NOT NULL) AND "public"."can_access_location"("target_location_id"))));



ALTER TABLE "public"."stock_product_approval_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_product_approval_requests_read" ON "public"."stock_product_approval_requests" FOR SELECT TO "authenticated" USING (("public"."can_access_super_admin_features"() OR ("requested_by_user_id" = "auth"."uid"())));



ALTER TABLE "public"."stock_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."time_segments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "time_segments_all" ON "public"."time_segments" TO "authenticated" USING (true);



ALTER TABLE "public"."time_tracking_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "time_tracking_audit_logs_all" ON "public"."time_tracking_audit_logs" TO "authenticated" USING (true);



ALTER TABLE "public"."transport_staff_bank_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staff_bank_accounts_parent_scope" ON "public"."transport_staff_bank_accounts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_bank_accounts"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_bank_accounts"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id")))));



CREATE POLICY "transport_staff_bank_accounts_select_legacy_global" ON "public"."transport_staff_bank_accounts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_bank_accounts"."staff_id") AND ("s"."default_location_id" IS NULL) AND "private"."is_active_user"()))));



ALTER TABLE "public"."transport_staff_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staff_contacts_parent_scope" ON "public"."transport_staff_contacts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_contacts"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_contacts"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id")))));



CREATE POLICY "transport_staff_contacts_select_legacy_global" ON "public"."transport_staff_contacts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_contacts"."staff_id") AND ("s"."default_location_id" IS NULL) AND "private"."is_active_user"()))));



ALTER TABLE "public"."transport_staff_plates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staff_plates_parent_scope" ON "public"."transport_staff_plates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_plates"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_plates"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id")))));



CREATE POLICY "transport_staff_plates_select_legacy_global" ON "public"."transport_staff_plates" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_plates"."staff_id") AND ("s"."default_location_id" IS NULL) AND "private"."is_active_user"()))));



ALTER TABLE "public"."transport_staffs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staffs_location_scope" ON "public"."transport_staffs" TO "authenticated" USING ("private"."can_access_optional_location"("default_location_id")) WITH CHECK ("private"."can_access_optional_location"("default_location_id"));



CREATE POLICY "transport_staffs_select_legacy_global" ON "public"."transport_staffs" FOR SELECT TO "authenticated" USING ((("default_location_id" IS NULL) AND "private"."is_active_user"()));



ALTER TABLE "public"."user_locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_locations_delete_scoped_admin" ON "public"."user_locations" FOR DELETE TO "authenticated" USING (("private"."can_manage_location"("location_id") AND "private"."can_manage_profile"("user_id")));



CREATE POLICY "user_locations_insert_scoped_admin" ON "public"."user_locations" FOR INSERT TO "authenticated" WITH CHECK (("private"."can_manage_location"("location_id") AND "private"."can_manage_profile"("user_id")));



CREATE POLICY "user_locations_select_authorized" ON "public"."user_locations" FOR SELECT TO "authenticated" USING (("private"."is_active_user"() AND (("user_id" = "auth"."uid"()) OR "private"."can_view_profile"("user_id"))));



CREATE POLICY "user_locations_update_scoped_admin" ON "public"."user_locations" FOR UPDATE TO "authenticated" USING (("private"."can_manage_location"("location_id") AND "private"."can_manage_profile"("user_id"))) WITH CHECK (("private"."can_manage_location"("location_id") AND "private"."can_manage_profile"("user_id")));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_paid_work_days"("p_profile_id" "uuid", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_paid_work_days"("p_profile_id" "uuid", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_paid_work_days"("p_profile_id" "uuid", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_time_segment_paid_days"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_time_segment_paid_days"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_time_segment_paid_days"("p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_location"("target_location" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_location"("target_location" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."can_access_super_admin_features"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_super_admin_features"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_time_tracking_expense_source"("p_source_type" "text", "p_source_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_time_tracking_expense_source"("p_source_type" "text", "p_source_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."change_time_tracking_expense_location"("p_source_type" "text", "p_source_id" "uuid", "p_expense_location_id" "uuid", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."change_time_tracking_expense_location"("p_source_type" "text", "p_source_id" "uuid", "p_expense_location_id" "uuid", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_income_expense_approval_request"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_income_expense_approval_request"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_stock_entry_delete_approval_request"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_stock_entry_delete_approval_request"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_stock_product_approval_request"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_stock_product_approval_request"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_stock_product_with_sale_item"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_stock_product_with_sale_item"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_profile_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_id"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_income_expense_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_income_expense_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_stock_entry_delete_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_stock_entry_delete_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_stock_product_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_stock_product_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_time_tracking_approval"("p_source_type" "text", "p_source_id" "uuid", "p_decision" "text", "p_comment" "text", "p_expense_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_time_tracking_approval"("p_source_type" "text", "p_source_id" "uuid", "p_decision" "text", "p_comment" "text", "p_expense_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_income_sale_item"("item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_income_sale_item"("item_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_acid_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_acid_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_income_expense_feed"("p_location_id" "uuid", "p_from_date" "date", "p_to_date" "date", "p_cursor_date" "date", "p_cursor_key" "text", "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_income_expense_feed"("p_location_id" "uuid", "p_from_date" "date", "p_to_date" "date", "p_cursor_date" "date", "p_cursor_key" "text", "p_page_size" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_rubber_bill_printed"("p_bill_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_rubber_bill_printed"("p_bill_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prevent_locked_ocr_ticket_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."sync_acid_stock_entry"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_acid_stock_entry"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_income_expense"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_income_expense"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_rubber_bill"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_rubber_bill"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_rubber_bill_core_20260716020000"("payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."sync_stock_entry"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_stock_entry"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."transfer_acid_stock"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_acid_stock"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."transfer_stock"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_stock"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."validate_stock_non_negative_after_entry_delete"("p_location_id" "uuid", "p_product_id" "uuid", "p_deleted_entry_ids" "uuid"[]) FROM PUBLIC;



GRANT ALL ON TABLE "public"."stock_products" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."stock_products" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_products" TO "service_role";
GRANT SELECT ON TABLE "public"."acid_products" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_entries" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."acid_stock_entries" TO "authenticated";



GRANT ALL ON TABLE "public"."income_expense" TO "service_role";
GRANT SELECT ON TABLE "public"."income_expense" TO "authenticated";



GRANT ALL ON TABLE "public"."rubber_bill_items" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_bill_items" TO "authenticated";



GRANT ALL ON TABLE "public"."rubber_bills" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_bills" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_movements" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_movements" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_movements" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_bank_accounts" TO "anon";
GRANT ALL ON TABLE "public"."customer_bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_bank_accounts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_contacts" TO "anon";
GRANT ALL ON TABLE "public"."customer_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_contacts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_farms" TO "anon";
GRANT ALL ON TABLE "public"."customer_farms" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_farms" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."financial_transactions" TO "anon";
GRANT ALL ON TABLE "public"."financial_transactions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."financial_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."income_expense_approval_keywords" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."income_expense_approval_keywords" TO "authenticated";



GRANT ALL ON TABLE "public"."income_expense_approval_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."income_expense_approval_requests" TO "authenticated";



GRANT ALL ON TABLE "public"."income_expense_approval_settings" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."income_expense_approval_settings" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."income_sale_items" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."income_sale_items" TO "authenticated";
GRANT ALL ON TABLE "public"."income_sale_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_requests" TO "anon";
GRANT ALL ON TABLE "public"."leave_requests" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_requests" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfer_items" TO "anon";
GRANT ALL ON TABLE "public"."money_transfer_items" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfer_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfer_slips" TO "anon";
GRANT ALL ON TABLE "public"."money_transfer_slips" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfer_slips" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfers" TO "anon";
GRANT ALL ON TABLE "public"."money_transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ocr_tickets" TO "anon";
GRANT ALL ON TABLE "public"."ocr_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."ocr_tickets" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payroll_slips" TO "anon";
GRANT ALL ON TABLE "public"."payroll_slips" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_slips" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("phone") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("name"),UPDATE("name") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("role"),UPDATE("role") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("is_active"),UPDATE("is_active") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("updated_at"),UPDATE("updated_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("daily_wage"),UPDATE("daily_wage") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("can_access_money_transfer"),UPDATE("can_access_money_transfer") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("can_access_super_admin_features"),UPDATE("can_access_super_admin_features") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_entry_approval_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_entry_approval_requests" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."stock_product_approval_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_product_approval_requests" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."time_segments" TO "anon";
GRANT ALL ON TABLE "public"."time_segments" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."time_segments" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."time_tracking_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."time_tracking_audit_logs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."time_tracking_audit_logs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_bank_accounts" TO "anon";
GRANT ALL ON TABLE "public"."transport_staff_bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_staff_bank_accounts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_contacts" TO "anon";
GRANT ALL ON TABLE "public"."transport_staff_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_staff_contacts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_plates" TO "anon";
GRANT ALL ON TABLE "public"."transport_staff_plates" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_staff_plates" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staffs" TO "anon";
GRANT ALL ON TABLE "public"."transport_staffs" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_staffs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_locations" TO "anon";
GRANT ALL ON TABLE "public"."user_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."user_locations" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
