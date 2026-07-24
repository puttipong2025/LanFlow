


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


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "private"."active_report_no"("p_entity_type" "text", "p_entity_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select b.report_no
  from public.report_items i
  join public.report_batches b on b.id = i.report_id
  where i.entity_type = p_entity_type
    and i.entity_id = p_entity_id
    and i.active = true
    and b.status = 'active'
  order by b.created_at desc, b.id desc
  limit 1;
$$;


ALTER FUNCTION "private"."active_report_no"("p_entity_type" "text", "p_entity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."active_rubber_export_no_for_report"("p_report_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select e.export_no
  from public.rubber_export_items x
  join public.rubber_exports e on e.id = x.export_id
  join public.report_items i on i.id = x.source_report_item_id
  where i.report_id = p_report_id
    and i.active = true
    and x.active = true
    and e.status in ('draft', 'verified')
  order by e.created_at, e.id
  limit 1;
$$;


ALTER FUNCTION "private"."active_rubber_export_no_for_report"("p_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."active_transfer_report_no"("p_transfer_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select b.report_no
  from public.report_items i
  join public.report_batches b on b.id = i.report_id
  where i.entity_id = p_transfer_id
    and i.entity_type in (
      'bank_transfer_source',
      'bank_transfer_target',
      'cash_transfer_sent',
      'cash_transfer_received'
    )
    and i.active = true
    and b.status = 'active'
  order by b.created_at desc, b.id desc
  limit 1;
$$;


ALTER FUNCTION "private"."active_transfer_report_no"("p_transfer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."assign_rubber_bill_item_sequence"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if new.sequence_no is null then
    select coalesce(max(i.sequence_no), 0) + 1
      into new.sequence_no
    from public.rubber_bill_items i
    where i.bill_id = new.bill_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."assign_rubber_bill_item_sequence"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_access_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.can_access_super_admin_features()
    or (
      private.is_active_user()
      and target_location is not null
      and exists (
        select 1
        from public.user_locations ul
        where ul.user_id = auth.uid()
          and ul.location_id = target_location
      )
    )
$$;


ALTER FUNCTION "private"."can_access_location"("target_location" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_access_money_transfer_module"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.can_access_super_admin_features()
$$;


ALTER FUNCTION "private"."can_access_money_transfer_module"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_access_optional_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.can_access_super_admin_features()
    or (
      target_location is not null
      and private.can_access_location(target_location)
    )
$$;


ALTER FUNCTION "private"."can_access_optional_location"("target_location" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_access_super_admin_features"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.role in ('user', 'admin')
        and p.can_access_super_admin_features = true
    )
$$;


ALTER FUNCTION "private"."can_access_super_admin_features"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_approve_time_tracking_profile"("target_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_active_user()
    and (
      private.current_user_role() = 'super_admin'
      or (
        private.current_user_role() = 'admin'
        and exists (
          select 1
          from public.profiles p
          where p.id = target_profile_id
            and p.role = 'user'
            and p.is_active = true
        )
      )
    )
$$;


ALTER FUNCTION "private"."can_approve_time_tracking_profile"("target_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_assign_time_tracking_expense_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_active_user()
    and target_location is not null
    and exists (
      select 1
      from public.user_locations ul
      join public.locations l on l.id = ul.location_id
      where ul.user_id = auth.uid()
        and ul.location_id = target_location
        and l.is_active = true
    )
$$;


ALTER FUNCTION "private"."can_assign_time_tracking_expense_location"("target_location" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_delete_reports"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select private.is_active_user()
    and public.can_access_super_admin_features();
$$;


ALTER FUNCTION "private"."can_delete_reports"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.can_access_super_admin_features()
    or (
      private.current_user_role() = 'admin'
      and private.can_access_location(target_location)
    )
$$;


ALTER FUNCTION "private"."can_manage_location"("target_location" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_profile"("target_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select (
      private.can_access_super_admin_features()
      and exists (
        select 1
        from public.profiles target
        where target.id = target_user
          and target.role <> 'super_admin'
          and target.is_active = true
      )
    )
    or (
      private.current_user_role() = 'admin'
      and exists (
        select 1
        from public.profiles target
        where target.id = target_user
          and target.role = 'user'
          and target.is_active = true
      )
      and exists (
        select 1
        from public.user_locations mine
        join public.user_locations theirs
          on theirs.location_id = mine.location_id
        where mine.user_id = auth.uid()
          and theirs.user_id = target_user
      )
    )
$$;


ALTER FUNCTION "private"."can_manage_profile"("target_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_reports"("p_location_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select private.is_active_user()
    and (
      public.can_access_super_admin_features()
      or exists (
        select 1
        from public.profiles p
        join public.user_locations ul on ul.user_id = p.id
        where p.id = auth.uid()
          and p.role = 'admin'
          and ul.location_id = p_location_id
      )
    );
$$;


ALTER FUNCTION "private"."can_manage_reports"("p_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_view_profile"("target_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_active_user()
    and (
      target_user = auth.uid()
      or private.can_access_super_admin_features()
      or (
        private.current_user_role() = 'admin'
        and exists (
          select 1
          from public.user_locations mine
          join public.user_locations theirs
            on theirs.location_id = mine.location_id
          where mine.user_id = auth.uid()
            and theirs.user_id = target_user
        )
      )
    )
$$;


ALTER FUNCTION "private"."can_view_profile"("target_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."cash_transfer_counts"("payload" "jsonb", "prefix" "text") RETURNS integer[]
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  keys text[] := array['coin1', 'coin2', 'coin5', 'coin10', 'banknote20', 'banknote50', 'banknote100', 'banknote500', 'banknote1000'];
  result integer[] := array[]::integer[];
  key text;
  value integer;
begin
  foreach key in array keys loop
    if payload #>> array[prefix, key] is null then raise exception 'กรอกจำนวนเงินสดให้ครบทุกช่อง'; end if;
    value := (payload #>> array[prefix, key])::integer;
    if value < 0 then raise exception 'จำนวนเงินสดต้องเป็นศูนย์หรือมากกว่า'; end if;
    result := array_append(result, value);
  end loop;
  return result;
end;
$$;


ALTER FUNCTION "private"."cash_transfer_counts"("payload" "jsonb", "prefix" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."current_rubber_bill_payload"("p_bill_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', b.revision_no,
    'clientTempId', b.client_temp_id,
    'idempotencyKey', b.idempotency_key,
    'locationId', b.location_id,
    'recordStatus', b.record_status,
    'localBillNo', b.local_bill_no,
    'billDate', b.bill_date,
    'customerId', b.customer_id,
    'customerName', b.customer_name,
    'customerType', b.customer_type,
    'billType', b.bill_type,
    'deductWeight', b.deduct_weight,
    'weight', b.weight,
    'rubberValue', b.rubber_value,
    'averagePrice', b.average_price,
    'deductionTotal', b.deduction_total,
    'netTotal', b.net_total,
    'cashPayment', b.cash_payment,
    'transferPayment', b.transfer_payment,
    'acidPackCount', b.acid_pack_count,
    'clientRecordedAt', b.client_recorded_at,
    'clientCreatedAt', b.client_created_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'itemType', i.item_type,
          'title', i.description,
          'description', i.description,
          'inWeight', i.weight_in,
          'outWeight', i.weight_out,
          'netWeight', i.net_weight,
          'stockProductId', i.stock_product_id,
          'quantity', i.quantity,
          'unit', i.unit,
          'unitPrice', i.price,
          'totalAmount', i.total,
          'sequenceNo', i.sequence_no
        )
        order by i.sequence_no
      )
      from public.rubber_bill_items i
      where i.bill_id = b.id
    ), '[]'::jsonb)
  )
  from public.rubber_bills b
  where b.id = p_bill_id;
$$;


ALTER FUNCTION "private"."current_rubber_bill_payload"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."current_user_role"() RETURNS "public"."app_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true
$$;


ALTER FUNCTION "private"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."enforce_time_tracking_expense_relation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_rpc_write boolean := coalesce(current_setting('app.time_tracking_expense_rpc', true), 'false') = 'true';
begin
  if tg_table_name = 'financial_transactions' then
    if old.status <> 'APPROVED'
      and new.status = 'APPROVED'
      and new.type = 'WITHDRAWAL' then
      if not v_rpc_write
        or new.expense_location_id is null
        or new.approved_at is null
        or new.cancelled_at is not null then
        raise exception 'Withdrawal approval must use the time tracking approval RPC';
      end if;
    end if;

    if old.status = 'APPROVED'
      and old.type = 'WITHDRAWAL'
      and (
        new.expense_location_id is distinct from old.expense_location_id
        or new.cancelled_at is distinct from old.cancelled_at
        or new.cancelled_by is distinct from old.cancelled_by
        or new.cancel_reason is distinct from old.cancel_reason
      )
      and not v_rpc_write then
      raise exception 'Withdrawal expense relation must be changed at its source through the time tracking RPC';
    end if;

  elsif tg_table_name = 'payroll_slips' then
    if old.status <> 'APPROVED' and new.status = 'APPROVED' then
      if not v_rpc_write
        or new.approved_at is null
        or (new.net_pay > 0 and new.expense_location_id is null)
        or new.cancelled_at is not null then
        raise exception 'Payroll approval must use the time tracking approval RPC';
      end if;
    end if;

    if old.status = 'APPROVED'
      and (
        new.expense_location_id is distinct from old.expense_location_id
        or new.cancelled_at is distinct from old.cancelled_at
        or new.cancelled_by is distinct from old.cancelled_by
        or new.cancel_reason is distinct from old.cancel_reason
      )
      and not v_rpc_write then
      raise exception 'Payroll expense relation must be changed at its source through the time tracking RPC';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."enforce_time_tracking_expense_relation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_approved_rubber_bill_request_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if old.request_status = 'approved' then
    raise exception 'ประวัติคำขอที่อนุมัติแล้วแก้ไขหรือลบไม่ได้';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_approved_rubber_bill_request_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_pending_rubber_bill_relation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_bill_id uuid;
begin
  if tg_table_name = 'report_items' then
    if new.entity_type <> 'rubber_bill' or new.active <> true then
      return new;
    end if;
    v_bill_id := new.entity_id;
  else
    if new.source_type <> 'rubber_bill' then
      return new;
    end if;
    v_bill_id := new.source_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_bill_id::text));
  if private.rubber_bill_has_pending_approval(v_bill_id) then
    raise exception 'บิลยางกำลังรออนุมัติ จึงนำไปทำรายงานหรือโอนเงินไม่ได้';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_pending_rubber_bill_relation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_reported_cash_details"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_sent_report text;
  v_received_report text;
begin
  v_sent_report := private.active_report_no('cash_transfer_sent', old.transfer_id);
  v_received_report := private.active_report_no('cash_transfer_received', old.transfer_id);

  if tg_op = 'DELETE' then
    if v_sent_report is not null then perform private.raise_report_lock(v_sent_report); end if;
    if v_received_report is not null then perform private.raise_report_lock(v_received_report); end if;
    return old;
  end if;

  if v_sent_report is not null and (
    new.sent_coin_1_count,
    new.sent_coin_2_count,
    new.sent_coin_5_count,
    new.sent_coin_10_count,
    new.sent_banknote_20_count,
    new.sent_banknote_50_count,
    new.sent_banknote_100_count,
    new.sent_banknote_500_count,
    new.sent_banknote_1000_count,
    new.note,
    new.sent_at
  ) is distinct from (
    old.sent_coin_1_count,
    old.sent_coin_2_count,
    old.sent_coin_5_count,
    old.sent_coin_10_count,
    old.sent_banknote_20_count,
    old.sent_banknote_50_count,
    old.sent_banknote_100_count,
    old.sent_banknote_500_count,
    old.sent_banknote_1000_count,
    old.note,
    old.sent_at
  ) then
    perform private.raise_report_lock(v_sent_report);
  end if;

  if v_received_report is not null and (
    new.received_coin_1_count,
    new.received_coin_2_count,
    new.received_coin_5_count,
    new.received_coin_10_count,
    new.received_banknote_20_count,
    new.received_banknote_50_count,
    new.received_banknote_100_count,
    new.received_banknote_500_count,
    new.received_banknote_1000_count,
    new.received_by_user_id,
    new.received_by_name,
    new.received_by_phone,
    new.received_at
  ) is distinct from (
    old.received_coin_1_count,
    old.received_coin_2_count,
    old.received_coin_5_count,
    old.received_coin_10_count,
    old.received_banknote_20_count,
    old.received_banknote_50_count,
    old.received_banknote_100_count,
    old.received_banknote_500_count,
    old.received_banknote_1000_count,
    old.received_by_user_id,
    old.received_by_name,
    old.received_by_phone,
    old.received_at
  ) then
    perform private.raise_report_lock(v_received_report);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."guard_reported_cash_details"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_reported_entity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_id uuid;
  v_report_no text;
begin
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);

  if v_report_no is not null then
    if tg_argv[0] = 'rubber_bill'
      and tg_op = 'UPDATE'
      and (to_jsonb(new) - array['print_status', 'updated_at'])
          = (to_jsonb(old) - array['print_status', 'updated_at']) then
      return new;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_reported_entity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_reported_money_transfer"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_report_no text;
begin
  v_report_no := private.active_transfer_report_no(
    case when tg_op = 'DELETE' then old.id else new.id end
  );

  if v_report_no is not null then
    if tg_op = 'UPDATE'
      and old.transfer_method = 'cash'
      and (to_jsonb(new) - array['transfer_status', 'revision_no', 'updated_at'])
          = (to_jsonb(old) - array['transfer_status', 'revision_no', 'updated_at']) then
      return new;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_reported_money_transfer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_reported_rubber_item"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_bill_id uuid := case when tg_op = 'DELETE' then old.bill_id else new.bill_id end;
  v_report_no text;
begin
  v_report_no := private.active_report_no('rubber_bill', v_bill_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_reported_rubber_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_reported_transfer_child"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_transfer_id uuid;
  v_report_no text;
begin
  v_transfer_id := case when tg_op = 'DELETE' then old.transfer_id else new.transfer_id end;
  v_report_no := private.active_transfer_report_no(v_transfer_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_reported_transfer_child"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_reported_transfer_item"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_transfer_id uuid;
  v_source_type text;
  v_source_id uuid;
  v_report_no text;
begin
  v_transfer_id := case when tg_op = 'DELETE' then old.transfer_id else new.transfer_id end;
  v_source_type := case when tg_op = 'DELETE' then old.source_type else new.source_type end;
  v_source_id := case when tg_op = 'DELETE' then old.source_id else new.source_id end;

  v_report_no := private.active_transfer_report_no(v_transfer_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  v_report_no := private.active_report_no(v_source_type, v_source_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_reported_transfer_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_rubber_export_state"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if old.status = 'deleted' then
    raise exception 'รายการส่งออกที่ลบแล้วแก้ไขไม่ได้';
  end if;
  if old.status = 'verified' and new.status <> 'deleted' then
    raise exception 'รายการส่งออกที่ตรวจสอบแล้วแก้ไขไม่ได้';
  end if;
  if (
    new.export_no,
    new.export_date,
    new.sequence_no,
    new.location_id,
    new.cutoff_at,
    new.cutoff_report_item_id,
    new.original_weight_total,
    new.paid_total,
    new.average_price,
    new.created_by_user_id,
    new.created_at
  ) is distinct from (
    old.export_no,
    old.export_date,
    old.sequence_no,
    old.location_id,
    old.cutoff_at,
    old.cutoff_report_item_id,
    old.original_weight_total,
    old.paid_total,
    old.average_price,
    old.created_by_user_id,
    old.created_at
  ) then
    raise exception 'ข้อมูล cutoff และ snapshot ของรายการส่งออกแก้ไขไม่ได้';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_rubber_export_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_active_user"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
  )
$$;


ALTER FUNCTION "private"."is_active_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(private.current_user_role() = 'super_admin', false)
$$;


ALTER FUNCTION "private"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if current_setting('app.time_tracking_permanent_delete_rpc', true) = 'true' then
    return old;
  end if;

  if tg_table_name = 'financial_transactions'
    and old.type = 'WITHDRAWAL'
    and old.status = 'APPROVED'
    and old.expense_location_id is not null then
    raise exception 'Approved withdrawal must be permanently deleted through the time tracking RPC';
  end if;

  if tg_table_name = 'payroll_slips'
    and old.status = 'APPROVED'
    and old.net_pay > 0
    and old.expense_location_id is not null then
    raise exception 'Approved payroll slip must be permanently deleted through the time tracking RPC';
  end if;

  return old;
end;
$$;


ALTER FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."raise_report_lock"("p_report_no" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  raise exception 'REPORT_LOCKED:%', p_report_no
    using errcode = 'P0001',
          hint = 'ลบรายงาน active ล่าสุดตามลำดับเพื่อปลดล็อก';
end;
$$;


ALTER FUNCTION "private"."raise_report_lock"("p_report_no" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."reportable_items"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) RETURNS TABLE("entity_type" "text", "entity_id" "uuid", "eligibility_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  with candidates(entity_type, entity_id, eligibility_at) as (
    select 'rubber_bill'::text, b.id,
      coalesce(b.server_received_at, b.updated_at, b.created_at)
    from public.rubber_bills b
    where b.location_id = p_location_id
      and b.record_status = 'active'
      and b.sync_status = 'synced'
      and b.server_bill_no is not null
      and not private.rubber_bill_has_pending_approval(b.id)

    union all

    select 'ocr_ticket', o.id,
      coalesce(o.server_received_at, o.updated_at, o.created_at)
    from public.ocr_tickets o
    where o.location_id = p_location_id
      and o.record_status = 'active'
      and o.sync_status = 'synced'
      and o.server_received_at is not null

    union all

    select 'income_expense', e.id,
      coalesce(e.server_received_at, e.updated_at, e.created_at)
    from public.income_expense e
    where e.location_id = p_location_id
      and e.record_status = 'active'
      and e.sync_status = 'synced'

    union all

    select 'acid_stock_entry', s.id, coalesce(s.updated_at, s.created_at)
    from public.stock_entries s
    where s.location_id = p_location_id
      and s.record_status = 'active'

    union all

    select 'financial_transaction', f.id,
      coalesce(f.approved_at, f.updated_at, f.created_at)
    from public.financial_transactions f
    where f.status = 'APPROVED'
      and f.cancelled_at is null
      and f.expense_location_id = p_location_id

    union all

    select 'payroll_slip', p.id,
      coalesce(p.approved_at, p.updated_at, p.created_at)
    from public.payroll_slips p
    where p.status = 'APPROVED'
      and p.cancelled_at is null
      and p.expense_location_id = p_location_id

    union all

    select 'rubber_export', e.id, e.verified_at
    from public.rubber_exports e
    where e.location_id = p_location_id
      and e.status = 'verified'
      and e.expense_destination = 'branch'
      and e.work_total > 0
      and e.verified_at is not null


    union all

    select 'bank_transfer_source', m.id,
      coalesce(m.server_received_at, m.updated_at, m.created_at)
    from public.money_transfers m
    where m.location_id = p_location_id
      and m.transfer_method = 'bank'
      and m.record_status = 'active'
      and m.sync_status = 'synced'
      and m.transfer_status in ('paid', 'overpaid', 'branch_and_transfer', 'advance_payment')

    union all

    select 'bank_transfer_target', m.id,
      coalesce(m.server_received_at, m.updated_at, m.created_at)
    from public.money_transfers m
    where m.target_location_id = p_location_id
      and m.location_id <> p_location_id
      and m.transfer_type = 'branch'
      and m.transfer_method = 'bank'
      and m.record_status = 'active'
      and m.sync_status = 'synced'
      and m.transfer_status in ('paid', 'overpaid', 'branch_and_transfer', 'advance_payment')

    union all

    select 'cash_transfer_sent', m.id, d.sent_at
    from public.money_transfers m
    join public.money_transfer_cash_details d on d.transfer_id = m.id
    where m.location_id = p_location_id
      and m.transfer_type = 'cash'
      and m.transfer_method = 'cash'
      and m.record_status = 'active'
      and m.sync_status = 'synced'
      and d.sent_at is not null

    union all

    select 'cash_transfer_received', m.id, d.received_at
    from public.money_transfers m
    join public.money_transfer_cash_details d on d.transfer_id = m.id
    where m.target_location_id = p_location_id
      and m.transfer_type = 'cash'
      and m.transfer_method = 'cash'
      and m.record_status = 'active'
      and m.sync_status = 'synced'
      and d.cash_status in ('received', 'mismatched', 'difference_accepted')
      and d.received_at is not null
  )
  select c.entity_type, c.entity_id, c.eligibility_at
  from candidates c
  where c.eligibility_at <= p_cutoff_at
    and not exists (
      select 1
      from public.report_items i
      where i.location_id = p_location_id
        and i.entity_type = c.entity_type
        and i.entity_id = c.entity_id
        and i.active = true
    );
$$;


ALTER FUNCTION "private"."reportable_items"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."rubber_bill_has_active_transfer"("p_bill_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select exists (
    select 1
    from public.money_transfer_items i
    join public.money_transfers t on t.id = i.transfer_id
    where i.source_type = 'rubber_bill'
      and i.source_id = p_bill_id
      and t.record_status <> 'deleted'
  );
$$;


ALTER FUNCTION "private"."rubber_bill_has_active_transfer"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."rubber_bill_has_pending_approval"("p_bill_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select exists (
    select 1
    from public.rubber_bill_approval_requests r
    where r.bill_id = p_bill_id
      and r.request_status = 'pending'
  );
$$;


ALTER FUNCTION "private"."rubber_bill_has_pending_approval"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."rubber_export_candidates"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) RETURNS TABLE("report_item_id" "uuid", "bill_id" "uuid", "bill_date" "date", "bill_no" "text", "customer_name" "text", "eligibility_at" timestamp with time zone, "net_weight" numeric, "paid_amount" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select
    i.id,
    b.id,
    b.bill_date,
    coalesce(b.server_bill_no, nullif(b.local_bill_no, ''), nullif(b.bill_no, ''), left(b.id::text, 8)),
    coalesce(b.customer_name, ''),
    i.eligibility_at,
    round(b.weight - b.deduct_weight, 2),
    round(b.net_total, 2)
  from public.report_items i
  join public.report_batches r on r.id = i.report_id
  join public.rubber_bills b on b.id = i.entity_id
  where i.location_id = p_location_id
    and i.entity_type = 'rubber_bill'
    and i.active = true
    and i.eligibility_at <= p_cutoff_at
    and r.status = 'active'
    and b.location_id = p_location_id
    and b.record_status = 'active'
    and not exists (
      select 1
      from public.rubber_export_items x
      where x.location_id = p_location_id
        and x.source_bill_id = b.id
        and x.active = true
    )
  order by i.eligibility_at, b.id;
$$;


ALTER FUNCTION "private"."rubber_export_candidates"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."validate_rubber_export_candidates"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_invalid text;
begin
  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id)
  into v_invalid
  from private.rubber_export_candidates(p_location_id, p_cutoff_at) c
  where c.net_weight <= 0 or c.paid_amount <= 0;

  if v_invalid is not null then
    raise exception 'INVALID_RUBBER_BILL:%', v_invalid
      using errcode = 'P0001',
            hint = 'น้ำหนักสุทธิหลังหักและยอดจ่ายจริงต้องมากกว่า 0';
  end if;
end;
$$;


ALTER FUNCTION "private"."validate_rubber_export_candidates"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_cash_branch_difference"("p_transfer_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare actor_id uuid := auth.uid(); actor_name text; actor_phone text;
begin
  if not private.is_super_admin() then raise exception 'เฉพาะ super_admin เท่านั้นที่ยอมรับผลต่างได้'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'กรุณาระบุเหตุผลยอมรับผลต่าง'; end if;
  select name, phone into actor_name, actor_phone from public.profiles where id = actor_id;
  update public.money_transfer_cash_details set cash_status = 'difference_accepted', difference_accepted_by_user_id = actor_id, difference_accept_reason = btrim(p_reason), difference_accepted_at = now(), updated_at = now()
  where transfer_id = p_transfer_id and cash_status = 'mismatched';
  if not found then raise exception 'รายการนี้ไม่อยู่ในสถานะยอดไม่ตรง'; end if;
  return jsonb_build_object('id', p_transfer_id, 'status', 'synced');
end;
$$;


ALTER FUNCTION "public"."accept_cash_branch_difference"("p_transfer_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_rubber_bill_approval_request"("p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_request public.rubber_bill_approval_requests%rowtype;
  v_result jsonb;
  v_actor_name text;
  v_actor_phone text;
  v_created_bill_id uuid;
  v_report_no text;
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์อนุมัติคำขอบิลยาง';
  end if;

  select *
    into v_request
  from public.rubber_bill_approval_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.request_status <> 'pending' then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;

  if v_request.bill_id is not null then
    perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_request.bill_id::text));
    v_report_no := private.active_report_no('rubber_bill', v_request.bill_id);
    if v_report_no is not null then
      raise exception 'บิลอยู่ในรายงาน % แล้ว จึงอนุมัติไม่ได้', v_report_no;
    end if;
    if private.rubber_bill_has_active_transfer(v_request.bill_id) then
      raise exception 'บิลอยู่ในรายการโอนเงินแล้ว จึงอนุมัติไม่ได้';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('rubber-bill-create:' || v_request.client_temp_id));
  end if;

  v_result := public.sync_rubber_bill_core_20260724020000(v_request.proposed_payload);
  if v_result->>'status' <> 'synced' then
    raise exception '%', coalesce(v_result->>'errorMessage', 'อนุมัติคำขอไม่สำเร็จ');
  end if;

  v_created_bill_id := (v_result->>'id')::uuid;

  if v_request.operation = 'create' then
    update public.rubber_bills
    set created_by_user_id = v_request.requested_by_user_id,
        created_by_name = v_request.requested_by_name,
        created_by_phone = v_request.requested_by_phone
    where id = v_created_bill_id;
  end if;

  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bill_approval_requests
  set request_status = 'approved',
      approved_by_user_id = auth.uid(),
      approved_by_name = coalesce(v_actor_name, ''),
      approved_by_phone = coalesce(v_actor_phone, ''),
      approved_at = now(),
      created_bill_id = case when operation = 'create' then v_created_bill_id else null end
  where id = p_request_id;

  return jsonb_build_object(
    'status', 'approved',
    'requestId', p_request_id,
    'operation', v_request.operation,
    'billId', v_created_bill_id,
    'syncResult', v_result
  );
end;
$$;


ALTER FUNCTION "public"."approve_rubber_bill_approval_request"("p_request_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."create_cash_branch_transfer"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  actor_id uuid := auth.uid(); actor_name text; actor_phone text;
  source_id uuid := (payload->>'sourceLocationId')::uuid;
  target_id uuid := (payload->>'targetLocationId')::uuid;
  target_name text; counts integer[]; new_transfer_id uuid := coalesce((payload->>'id')::uuid, gen_random_uuid());
  existing_transfer_id uuid;
begin
  if not private.is_active_user() or not private.can_access_location(source_id) then raise exception 'ไม่มีสิทธิ์สร้างรายการสำหรับสาขานี้'; end if;
  if source_id is null or target_id is null or source_id = target_id then raise exception 'สาขาปลายทางต้องต่างจากสาขาต้นทาง'; end if;
  select id into existing_transfer_id
  from public.money_transfers
  where idempotency_key = coalesce(payload->>'idempotencyKey', 'cash:' || new_transfer_id::text)
    and transfer_method = 'cash'
    and location_id = source_id
    and created_by_user_id = actor_id;
  if existing_transfer_id is not null then return jsonb_build_object('id', existing_transfer_id, 'status', 'synced'); end if;
  select name, phone into actor_name, actor_phone from public.profiles where id = actor_id;
  select name into target_name from public.locations where id = target_id and is_active = true;
  if target_name is null then raise exception 'ไม่พบสาขาปลายทางที่ใช้งาน'; end if;
  counts := private.cash_transfer_counts(payload, 'sent');
  insert into public.money_transfers (id, client_temp_id, idempotency_key, location_id, target_location_id, target_location_name, net_amount_to_pay, transfer_type, transfer_method, transfer_status, created_by_user_id, created_by_name, created_by_phone, revision_no, record_status)
  values (new_transfer_id, coalesce(payload->>'clientTempId', new_transfer_id::text), coalesce(payload->>'idempotencyKey', 'cash:' || new_transfer_id::text), source_id, target_id, target_name, 0, 'cash', 'cash', 'pending', actor_id, coalesce(actor_name, ''), coalesce(actor_phone, ''), 0, 'active');
  insert into public.money_transfer_cash_details (transfer_id, sent_coin_1_count, sent_coin_2_count, sent_coin_5_count, sent_coin_10_count, sent_banknote_20_count, sent_banknote_50_count, sent_banknote_100_count, sent_banknote_500_count, sent_banknote_1000_count, note)
  values (new_transfer_id, counts[1], counts[2], counts[3], counts[4], counts[5], counts[6], counts[7], counts[8], counts[9], nullif(btrim(payload->>'note'), ''));
  update public.money_transfers set net_amount_to_pay = d.sent_total, updated_at = now() from public.money_transfer_cash_details d where money_transfers.id = new_transfer_id and d.transfer_id = new_transfer_id;
  return jsonb_build_object('id', new_transfer_id, 'status', 'synced');
end;
$$;


ALTER FUNCTION "public"."create_cash_branch_transfer"("payload" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."create_report_batch"("p_location_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_phone text;
  v_cutoff_at timestamptz := clock_timestamp();
  v_report_date date;
  v_sequence_no integer;
  v_report_id uuid;
  v_report_no text;
  v_item_count integer;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายงานของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = v_actor_id;

  v_report_date := (v_cutoff_at at time zone 'Asia/Bangkok')::date;

  select coalesce(max(b.sequence_no), 0) + 1
  into v_sequence_no
  from public.report_batches b
  where b.location_id = p_location_id
    and b.report_date = v_report_date;

  v_report_no :=
    'RPT-' || to_char(v_report_date, 'YYYYMMDD') || '-' ||
    lpad(v_sequence_no::text, 3, '0');

  insert into public.report_batches (
    report_no,
    report_date,
    sequence_no,
    location_id,
    cutoff_at,
    created_by_user_id,
    created_by_name,
    created_by_phone
  )
  values (
    v_report_no,
    v_report_date,
    v_sequence_no,
    p_location_id,
    v_cutoff_at,
    v_actor_id,
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, '')
  )
  returning id into v_report_id;

  insert into public.report_items (
    report_id,
    location_id,
    entity_type,
    entity_id,
    eligibility_at
  )
  select
    v_report_id,
    p_location_id,
    r.entity_type,
    r.entity_id,
    r.eligibility_at
  from private.reportable_items(p_location_id, v_cutoff_at) r
  on conflict do nothing;

  get diagnostics v_item_count = row_count;

  if v_item_count = 0 then
    raise exception 'ไม่มีรายการที่พร้อมออกรายงาน';
  end if;

  return jsonb_build_object(
    'id', v_report_id,
    'reportNo', v_report_no,
    'cutoffAt', v_cutoff_at,
    'itemCount', v_item_count
  );
end;
$$;


ALTER FUNCTION "public"."create_report_batch"("p_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_rubber_export"("p_location_id" "uuid", "p_cutoff_report_item_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
  v_export_date date;
  v_sequence_no integer;
  v_export_no text;
  v_export_id uuid;
  v_cutoff_at timestamptz;
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || p_location_id::text, 0));

  select c.eligibility_at
  into v_cutoff_at
  from private.rubber_export_candidates(p_location_id, 'infinity'::timestamptz) c
  where c.report_item_id = p_cutoff_report_item_id;

  if v_cutoff_at is null then
    raise exception 'บิล cutoff ไม่พร้อมใช้งานหรือถูกจองแล้ว';
  end if;

  perform private.validate_rubber_export_candidates(p_location_id, v_cutoff_at);

  select count(*)::integer, round(sum(c.net_weight), 2), round(sum(c.paid_amount), 2)
  into v_item_count, v_original_weight, v_paid_total
  from private.rubber_export_candidates(p_location_id, v_cutoff_at) c;

  if coalesce(v_item_count, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = v_actor_id;

  v_export_date := (v_now at time zone 'Asia/Bangkok')::date;

  select coalesce(max(e.sequence_no), 0) + 1
  into v_sequence_no
  from public.rubber_exports e
  where e.location_id = p_location_id
    and e.export_date = v_export_date;

  v_export_no := 'REX-' || to_char(v_export_date, 'YYYYMMDD') || '-' ||
    lpad(v_sequence_no::text, 3, '0');

  insert into public.rubber_exports (
    export_no,
    export_date,
    sequence_no,
    location_id,
    cutoff_at,
    cutoff_report_item_id,
    original_weight_total,
    paid_total,
    average_price,
    created_by_user_id,
    created_by_name,
    created_by_phone,
    created_at
  )
  values (
    v_export_no,
    v_export_date,
    v_sequence_no,
    p_location_id,
    v_cutoff_at,
    p_cutoff_report_item_id,
    v_original_weight,
    v_paid_total,
    round(v_paid_total / v_original_weight, 2),
    v_actor_id,
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, ''),
    v_now
  )
  returning id into v_export_id;

  insert into public.rubber_export_items (
    export_id,
    location_id,
    source_report_item_id,
    source_bill_id,
    bill_date,
    bill_no,
    customer_name,
    eligibility_at,
    net_weight,
    paid_amount
  )
  select
    v_export_id,
    p_location_id,
    c.report_item_id,
    c.bill_id,
    c.bill_date,
    c.bill_no,
    c.customer_name,
    c.eligibility_at,
    c.net_weight,
    c.paid_amount
  from private.rubber_export_candidates(p_location_id, v_cutoff_at) c;

  get diagnostics v_item_count = row_count;

  return jsonb_build_object(
    'id', v_export_id,
    'exportNo', v_export_no,
    'cutoffAt', v_cutoff_at,
    'itemCount', v_item_count
  );
end;
$$;


ALTER FUNCTION "public"."create_rubber_export"("p_location_id" "uuid", "p_cutoff_report_item_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."delete_cash_branch_transfer"("p_transfer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if not private.is_super_admin() then raise exception 'เฉพาะ super_admin เท่านั้นที่ลบรายการเงินสดได้'; end if;
  delete from public.money_transfers where id = p_transfer_id and transfer_method = 'cash';
  if not found then raise exception 'ไม่พบรายการเงินสด'; end if;
  return jsonb_build_object('id', p_transfer_id, 'status', 'synced');
end;
$$;


ALTER FUNCTION "public"."delete_cash_branch_transfer"("p_transfer_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."delete_report_batch"("p_report_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_report public.report_batches%rowtype;
  v_export_no text;
  v_actor_name text;
  v_actor_phone text;
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบรายงานได้';
  end if;

  select *
  into v_report
  from public.report_batches
  where id = p_report_id
  for update;

  if v_report.id is null or v_report.status <> 'active' then
    raise exception 'ไม่พบรายงาน active';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('rubber-export:' || v_report.location_id::text, 0)
  );

  if exists (
    select 1
    from public.report_batches newer
    where newer.location_id = v_report.location_id
      and newer.status = 'active'
      and (newer.created_at, newer.id) > (v_report.created_at, v_report.id)
  ) then
    raise exception 'ลบได้เฉพาะรายงาน active ล่าสุดของสาขา';
  end if;

  v_export_no := private.active_rubber_export_no_for_report(p_report_id);
  if v_export_no is not null then
    raise exception 'RUBBER_EXPORT_LOCKED:%', v_export_no
      using errcode = 'P0001',
            hint = 'ลบรายการส่งออกยางก่อนจึงจะลบรายงานได้';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.report_batches
  set status = 'deleted',
      deleted_at = clock_timestamp(),
      deleted_by_user_id = auth.uid(),
      deleted_by_name = coalesce(v_actor_name, ''),
      deleted_by_phone = coalesce(v_actor_phone, '')
  where id = p_report_id;

  update public.report_items
  set active = false
  where report_id = p_report_id
    and active = true;

  return jsonb_build_object(
    'id', p_report_id,
    'reportNo', v_report.report_no,
    'status', 'deleted'
  );
end;
$$;


ALTER FUNCTION "public"."delete_report_batch"("p_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_rubber_bill_approval_request"("p_request_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์ลบคำขอบิลยาง';
  end if;

  delete from public.rubber_bill_approval_requests
  where id = p_request_id
    and request_status = 'pending';

  if not found then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;
end;
$$;


ALTER FUNCTION "public"."delete_rubber_bill_approval_request"("p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_rubber_export"("p_export_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_export public.rubber_exports%rowtype;
  v_report_no text;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ลบได้';
  end if;

  select *
  into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null then
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if v_export.status = 'deleted' then
    return jsonb_build_object('id', p_export_id, 'status', 'deleted');
  end if;

  v_report_no := private.active_report_no('rubber_export', p_export_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.rubber_exports
  set status = 'deleted',
      previous_status = v_export.status,
      deleted_by_user_id = auth.uid(),
      deleted_by_name = coalesce(v_actor_name, ''),
      deleted_by_phone = coalesce(v_actor_phone, ''),
      deleted_at = v_now
  where id = p_export_id;

  update public.rubber_export_items
  set active = false
  where export_id = p_export_id
    and active = true;

  return jsonb_build_object(
    'id', p_export_id,
    'exportNo', v_export.export_no,
    'status', 'deleted'
  );
end;
$$;


ALTER FUNCTION "public"."delete_rubber_export"("p_export_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_time_tracking_source_permanently"("p_source_type" "text", "p_source_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid deletion source';
  end if;

  select role::text into v_actor_role from public.profiles where id = v_actor_id;

  if p_source_type = 'transaction' then
    select * into v_tx from public.financial_transactions where id = p_source_id for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;

    if v_tx.status = 'APPROVED' and v_tx.type = 'WITHDRAWAL' and v_tx.expense_location_id is not null then
      if not private.can_approve_time_tracking_profile(v_tx.profile_id) then
        raise exception 'Forbidden';
      end if;
    elsif v_tx.status = 'APPROVED' and v_actor_role <> 'super_admin' then
      raise exception 'Only super_admin can delete approved records';
    elsif v_actor_role <> 'super_admin' and v_tx.profile_id <> v_actor_id then
      raise exception 'Forbidden';
    end if;

    if exists (
      select 1
      from public.payroll_slips
      where profile_id = v_tx.profile_id
        and month = to_char(v_tx.created_at, 'YYYY-MM')
    ) then
      raise exception 'ไม่สามารถลบได้เนื่องจากมีการออกสลิปเงินเดือนของเดือนนี้ไปแล้ว โปรดลบสลิปเงินเดือนก่อน';
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'financial_transactions'
      and (
        record_id = v_tx.id
        or record_id in (select id from public.financial_transactions where parent_debt_id = v_tx.id)
      );

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.financial_transactions where parent_debt_id = v_tx.id;
    delete from public.financial_transactions where id = v_tx.id;
  else
    select * into v_slip from public.payroll_slips where id = p_source_id for update;
    if not found then
      raise exception 'Payroll slip not found';
    end if;

    if v_slip.status = 'APPROVED' and v_slip.net_pay > 0 and v_slip.expense_location_id is not null then
      if not private.can_approve_time_tracking_profile(v_slip.profile_id) then
        raise exception 'Forbidden';
      end if;
    else
      if not private.can_approve_time_tracking_profile(v_slip.profile_id) then
        raise exception 'Forbidden';
      end if;
      if date_trunc('month', v_slip.created_at) <> date_trunc('month', now()) then
        raise exception 'Cannot delete slips from previous months';
      end if;
      if v_slip.status = 'APPROVED' and v_actor_role <> 'super_admin' then
        raise exception 'Only super_admin can delete approved records';
      end if;
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'payroll_slips' and record_id = v_slip.id;

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.payroll_slips where id = v_slip.id;
  end if;

  return jsonb_build_object('status', 'deleted', 'sourceType', p_source_type, 'sourceId', p_source_id);
end;
$$;


ALTER FUNCTION "public"."delete_time_tracking_source_permanently"("p_source_type" "text", "p_source_id" "uuid") OWNER TO "postgres";


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

      select (d.sent_at at time zone 'Asia/Bangkok')::date, 'cash-transfer-expense:' || mt.id::text,
        jsonb_build_object(
          'id', 'cash-transfer-expense:' || mt.id, 'clientTempId', 'cash-transfer-expense:' || mt.id,
          'localBillNo', 'CASH-' || left(mt.id::text, 8), 'serverBillNo', 'CASH-' || left(mt.id::text, 8),
          'idempotencyKey', 'cash-transfer-expense:' || mt.id, 'locationId', mt.location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'CASH-' || left(mt.id::text, 8),
          'txDate', (d.sent_at at time zone 'Asia/Bangkok')::date,
          'title', 'โยกเงินสดไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
          'cost', d.sent_total, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', d.sent_at, 'clientCreatedAt', d.sent_at,
          'serverReceivedAt', d.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', mt.created_by_name,
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', 'cash:' || mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', case d.cash_status
            when 'pending_receipt' then 'รอรับเงิน'
            when 'received' then 'รับเงินแล้ว'
            when 'mismatched' then 'ยอดไม่ตรง ' || case when d.difference_total >= 0 then '+฿' else '-฿' end || trim(to_char(abs(d.difference_total), 'FM999999999990'))
            else 'ยอมรับผลต่าง ' || case when d.difference_total >= 0 then '+฿' else '-฿' end || trim(to_char(abs(d.difference_total), 'FM999999999990'))
          end,
          'relationLockReason', 'รายการนี้มาจากการโยกเงินสด ต้องเปิดรายละเอียดเพื่อดูข้อมูล'
        )
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
        and mt.location_id = p_location_id and mt.record_status <> 'deleted'
        and (d.sent_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date

      union all

      select (d.received_at at time zone 'Asia/Bangkok')::date, 'cash-transfer-income:' || mt.id::text,
        jsonb_build_object(
          'id', 'cash-transfer-income:' || mt.id, 'clientTempId', 'cash-transfer-income:' || mt.id,
          'localBillNo', 'CASH-' || left(mt.id::text, 8), 'serverBillNo', 'CASH-' || left(mt.id::text, 8),
          'idempotencyKey', 'cash-transfer-income:' || mt.id, 'locationId', mt.target_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'income',
          'number', 'CASH-' || left(mt.id::text, 8),
          'txDate', (d.received_at at time zone 'Asia/Bangkok')::date,
          'title', 'รับโอนเงินสดจากสาขาต้นทาง',
          'cost', d.received_total, 'billOption', 'รายรับ',
          'clientRecordedAt', d.received_at, 'clientCreatedAt', d.received_at,
          'serverReceivedAt', d.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', mt.created_by_name,
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', 'cash:' || mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', case d.cash_status
            when 'received' then 'รับเงินแล้ว'
            when 'mismatched' then 'ยอดไม่ตรง ' || case when d.difference_total >= 0 then '+฿' else '-฿' end || trim(to_char(abs(d.difference_total), 'FM999999999990'))
            else 'ยอมรับผลต่าง ' || case when d.difference_total >= 0 then '+฿' else '-฿' end || trim(to_char(abs(d.difference_total), 'FM999999999990'))
          end,
          'relationLockReason', 'รายการนี้มาจากการโยกเงินสด ต้องเปิดรายละเอียดเพื่อดูข้อมูล'
        )
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
        and mt.target_location_id = p_location_id and mt.record_status <> 'deleted'
        and d.cash_status in ('received', 'mismatched', 'difference_accepted')
        and (d.received_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date

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

      select (e.verified_at at time zone 'Asia/Bangkok')::date,
        'rubber-export-expense:' || e.id::text,
        jsonb_build_object(
          'id', 'rubber-export-expense:' || e.id,
          'clientTempId', 'rubber-export-expense:' || e.id,
          'localBillNo', e.export_no,
          'serverBillNo', e.export_no,
          'idempotencyKey', 'rubber-export-expense:' || e.id,
          'locationId', e.location_id,
          'syncStatus', 'synced',
          'recordStatus', 'active',
          'type', 'expense',
          'number', e.export_no,
          'txDate', (e.verified_at at time zone 'Asia/Bangkok')::date,
          'title', 'ค่าทำงานส่งออกยาง — ' || e.export_no,
          'cost', e.work_total,
          'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', e.verified_at,
          'clientCreatedAt', e.created_at,
          'serverReceivedAt', e.verified_at,
          'revisionNo', 1,
          'createdByUserId', e.created_by_user_id,
          'createdByName', e.created_by_name,
          'createdByPhone', e.created_by_phone,
          'relationSourceType', 'rubber_export',
          'relationSourceId', e.id,
          'relationSourceLocationId', e.location_id,
          'relationLabel', 'ส่งออกยาง',
          'relationLockReason', 'รายการนี้มาจากรายการส่งออกยาง ต้องเปิดหรือจัดการที่โมดูลส่งออกยางต้นทาง'
        )
      from public.rubber_exports e
      where e.location_id = p_location_id
        and e.status = 'verified'
        and e.expense_destination = 'branch'
        and e.work_total > 0
        and (e.verified_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date

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


CREATE OR REPLACE FUNCTION "public"."get_report_income_expense_rows"("p_report_id" "uuid") RETURNS TABLE("tx_date" "date", "number" "text", "entry_type" "text", "title" "text", "amount" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_location_id uuid;
begin
  select b.location_id
  into v_location_id
  from public.report_batches b
  where b.id = p_report_id;

  if v_location_id is null or not private.can_manage_reports(v_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูรายงานนี้';
  end if;

  return query
  with rows as (
    select
      e.tx_date,
      coalesce(e.number, e.server_bill_no, e.local_bill_no) as number,
      e.type::text as entry_type,
      e.title,
      e.cost as amount,
      '10-' || e.id::text as sort_key
    from public.report_items i
    join public.income_expense e on e.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'income_expense'

    union all

    select
      b.bill_date,
      'RB-' || to_char(b.bill_date, 'YYMMDD'),
      'expense',
      'จ่ายค่ายางจากบิลยาง ' || count(*)::text || ' ใบ',
      sum(b.net_total),
      '20-' || b.bill_date::text
    from public.report_items i
    join public.rubber_bills b on b.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'rubber_bill'
      and b.net_total > 0
      and not exists (
        select 1
        from public.money_transfer_items mi
        where mi.source_type = 'rubber_bill'
          and mi.source_id = b.id
      )
    group by b.bill_date

    union all

    select
      o.date_in,
      'OCR-' || to_char(o.date_in, 'YYMMDD'),
      'expense',
      'จ่ายค่ายางจาก OCR บิลยาง ' || count(*)::text || ' ใบ',
      sum(o.total_amount),
      '30-' || o.date_in::text
    from public.report_items i
    join public.ocr_tickets o on o.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'ocr_ticket'
      and o.total_amount > 0
      and not exists (
        select 1
        from public.money_transfer_items mi
        where mi.source_type = 'ocr_ticket'
          and mi.source_id = o.id
      )
    group by o.date_in

    union all

    select
      (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date,
      'TR-' || left(m.id::text, 8),
      'expense',
      'โยกเงินไป ' || coalesce(m.target_location_name, 'สาขาปลายทาง'),
      m.net_amount_to_pay,
      '40-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'bank_transfer_source'
      and m.transfer_type = 'branch'
      and m.location_id <> m.target_location_id
      and m.net_amount_to_pay > 0

    union all

    select
      (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date,
      'CT-' || left(m.id::text, 8),
      'expense',
      'สาขาจ่ายส่วนต่างให้ ' || coalesce(m.customer_name, 'ลูกค้า'),
      m.branch_paid_amount,
      '41-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'bank_transfer_source'
      and m.transfer_type = 'customer'
      and m.transfer_status = 'branch_and_transfer'
      and m.branch_paid_amount > 0

    union all

    select
      (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date,
      'TR-' || left(m.id::text, 8),
      'income',
      'รับโอนจากสาขาต้นทาง',
      m.net_amount_to_pay,
      '42-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'bank_transfer_target'
      and m.net_amount_to_pay > 0

    union all

    select
      (d.sent_at at time zone 'Asia/Bangkok')::date,
      'CASH-' || left(m.id::text, 8),
      'expense',
      'โยกเงินสดไป ' || coalesce(m.target_location_name, 'สาขาปลายทาง'),
      d.sent_total,
      '50-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    join public.money_transfer_cash_details d on d.transfer_id = m.id
    where i.report_id = p_report_id
      and i.entity_type = 'cash_transfer_sent'

    union all

    select
      (d.received_at at time zone 'Asia/Bangkok')::date,
      'CASH-' || left(m.id::text, 8),
      'income',
      'รับเงินสดจากสาขาต้นทาง',
      d.received_total,
      '51-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    join public.money_transfer_cash_details d on d.transfer_id = m.id
    where i.report_id = p_report_id
      and i.entity_type = 'cash_transfer_received'

    union all

    select
      (e.verified_at at time zone 'Asia/Bangkok')::date,
      e.export_no,
      'expense',
      'ค่าทำงานส่งออกยาง — ' || e.export_no,
      e.work_total,
      '55-' || e.id::text
    from public.report_items i
    join public.rubber_exports e on e.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'rubber_export'
      and e.work_total > 0


    union all

    select
      (f.approved_at at time zone 'Asia/Bangkok')::date,
      'TW-' || left(f.id::text, 8),
      'expense',
      'เบิกเงิน — ' || coalesce(p.name, 'พนักงาน') ||
        coalesce(': ' || nullif(f.description, ''), ''),
      f.amount,
      '60-' || f.id::text
    from public.report_items i
    join public.financial_transactions f on f.id = i.entity_id
    join public.profiles p on p.id = f.profile_id
    where i.report_id = p_report_id
      and i.entity_type = 'financial_transaction'
      and f.type = 'WITHDRAWAL'
      and f.amount > 0

    union all

    select
      (p.approved_at at time zone 'Asia/Bangkok')::date,
      'PS-' || left(p.id::text, 8),
      'expense',
      'เงินเดือน — ' || coalesce(profile.name, 'พนักงาน') || ' — ' || p.month,
      p.net_pay,
      '61-' || p.id::text
    from public.report_items i
    join public.payroll_slips p on p.id = i.entity_id
    join public.profiles profile on profile.id = p.profile_id
    where i.report_id = p_report_id
      and i.entity_type = 'payroll_slip'
      and p.net_pay > 0
  )
  select r.tx_date, r.number, r.entry_type, r.title, r.amount
  from rows r
  order by r.tx_date, r.sort_key;
end;
$$;


ALTER FUNCTION "public"."get_report_income_expense_rows"("p_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rubber_export_cutoff_options"("p_location_id" "uuid") RETURNS TABLE("report_item_id" "uuid", "bill_id" "uuid", "bill_date" "date", "bill_no" "text", "customer_name" "text", "eligibility_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูบิลส่งออกของสาขานี้';
  end if;

  return query
  select
    c.report_item_id,
    c.bill_id,
    c.bill_date,
    c.bill_no,
    c.customer_name,
    c.eligibility_at
  from private.rubber_export_candidates(p_location_id, 'infinity'::timestamptz) c;
end;
$$;


ALTER FUNCTION "public"."get_rubber_export_cutoff_options"("p_location_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."list_rubber_bill_approval_markers"("p_location_id" "uuid") RETURNS TABLE("request_id" "uuid", "bill_id" "uuid", "client_temp_id" "text", "operation" "text", "matched_reasons" "text"[], "requested_at" timestamp with time zone, "proposed_create_payload" "jsonb")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูคำขอของสาขานี้';
  end if;

  return query
  select
    r.id,
    r.bill_id,
    r.client_temp_id,
    r.operation,
    r.matched_reasons,
    r.requested_at,
    case when r.operation = 'create' then r.proposed_payload else null end
  from public.rubber_bill_approval_requests r
  where r.location_id = p_location_id
    and r.request_status = 'pending'
  order by r.requested_at desc;
end;
$$;


ALTER FUNCTION "public"."list_rubber_bill_approval_markers"("p_location_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."preview_rubber_export"("p_location_id" "uuid", "p_cutoff_report_item_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_cutoff_at timestamptz;
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
  v_items jsonb;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;

  select c.eligibility_at
  into v_cutoff_at
  from private.rubber_export_candidates(p_location_id, 'infinity'::timestamptz) c
  where c.report_item_id = p_cutoff_report_item_id;

  if v_cutoff_at is null then
    raise exception 'บิล cutoff ไม่พร้อมใช้งานหรือถูกจองแล้ว';
  end if;

  perform private.validate_rubber_export_candidates(p_location_id, v_cutoff_at);

  select
    count(*)::integer,
    round(sum(c.net_weight), 2),
    round(sum(c.paid_amount), 2),
    jsonb_agg(jsonb_build_object(
      'reportItemId', c.report_item_id,
      'billId', c.bill_id,
      'billDate', c.bill_date,
      'billNo', c.bill_no,
      'customerName', c.customer_name,
      'eligibilityAt', c.eligibility_at,
      'netWeight', c.net_weight,
      'paidAmount', c.paid_amount
    ) order by c.eligibility_at, c.bill_id)
  into v_item_count, v_original_weight, v_paid_total, v_items
  from private.rubber_export_candidates(p_location_id, v_cutoff_at) c;

  if coalesce(v_item_count, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;

  return jsonb_build_object(
    'cutoffAt', v_cutoff_at,
    'itemCount', v_item_count,
    'originalWeightTotal', v_original_weight,
    'paidTotal', v_paid_total,
    'averagePrice', round(v_paid_total / v_original_weight, 2),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."preview_rubber_export"("p_location_id" "uuid", "p_cutoff_report_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."receive_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  transfer_row public.money_transfers%rowtype; counts integer[]; actor_id uuid := auth.uid(); actor_name text; actor_phone text; total numeric; sent numeric;
begin
  select * into transfer_row from public.money_transfers where id = p_transfer_id for update;
  if transfer_row.id is null or transfer_row.transfer_method <> 'cash' then raise exception 'ไม่พบรายการเงินสด'; end if;
  if not private.can_access_location(transfer_row.target_location_id) then raise exception 'ไม่มีสิทธิ์ตรวจรับสาขานี้'; end if;
  counts := private.cash_transfer_counts(payload, 'received');
  select name, phone into actor_name, actor_phone from public.profiles where id = actor_id;
  update public.money_transfer_cash_details set
    received_coin_1_count = counts[1], received_coin_2_count = counts[2], received_coin_5_count = counts[3], received_coin_10_count = counts[4],
    received_banknote_20_count = counts[5], received_banknote_50_count = counts[6], received_banknote_100_count = counts[7], received_banknote_500_count = counts[8], received_banknote_1000_count = counts[9],
    received_by_user_id = actor_id, received_by_name = coalesce(actor_name, ''), received_by_phone = coalesce(actor_phone, ''), received_at = now(), updated_at = now(),
    cash_status = case when counts[1] + counts[2] * 2 + counts[3] * 5 + counts[4] * 10 + counts[5] * 20 + counts[6] * 50 + counts[7] * 100 + counts[8] * 500 + counts[9] * 1000 = sent_total then 'received' else 'mismatched' end
  where transfer_id = p_transfer_id and cash_status = 'pending_receipt'
  returning received_total, sent_total into total, sent;
  if not found then raise exception 'รายการนี้ถูกตรวจรับแล้ว'; end if;
  update public.money_transfers set transfer_status = 'paid', revision_no = revision_no + 1, updated_at = now() where id = p_transfer_id;
  return jsonb_build_object('id', p_transfer_id, 'status', 'synced', 'mismatched', total <> sent);
end;
$$;


ALTER FUNCTION "public"."receive_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


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


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."financial_transactions") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_report_no('financial_transaction', source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."financial_transactions") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."income_expense") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_report_no('income_expense', source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."income_expense") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."leave_requests") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_report_no('leave_request', source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."leave_requests") OWNER TO "postgres";


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
    "sync_status" "public"."sync_status" DEFAULT 'synced'::"public"."sync_status" NOT NULL,
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
    "transfer_method" "text" DEFAULT 'bank'::"text" NOT NULL,
    CONSTRAINT "money_transfers_transfer_method_check" CHECK (("transfer_method" = ANY (ARRAY['bank'::"text", 'cash'::"text"]))),
    CONSTRAINT "money_transfers_transfer_status_check" CHECK (("transfer_status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'partial'::"text", 'overpaid'::"text", 'branch_and_transfer'::"text", 'advance_payment'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "money_transfers_transfer_type_check" CHECK (("transfer_type" = ANY (ARRAY['customer'::"text", 'transport'::"text", 'branch'::"text", 'cash'::"text"])))
);


ALTER TABLE "public"."money_transfers" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."money_transfers") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_transfer_report_no(source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."money_transfers") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."ocr_tickets") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_report_no('ocr_ticket', source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."ocr_tickets") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."payroll_slips") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_report_no('payroll_slip', source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."payroll_slips") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_bills") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_report_no('rubber_bill', source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_bills") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubber_exports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "export_no" "text" NOT NULL,
    "export_date" "date" NOT NULL,
    "sequence_no" integer NOT NULL,
    "location_id" "uuid" NOT NULL,
    "cutoff_at" timestamp with time zone NOT NULL,
    "cutoff_report_item_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "previous_status" "text",
    "original_weight_total" numeric(14,2) NOT NULL,
    "paid_total" numeric(14,2) NOT NULL,
    "average_price" numeric(14,2) NOT NULL,
    "current_weight" numeric(14,2),
    "weight_loss_percent" numeric(8,2),
    "work_rate" numeric(14,2),
    "other_operating_cost" numeric(14,2) DEFAULT 0 NOT NULL,
    "work_total" numeric(14,2),
    "expense_destination" "text",
    "created_by_user_id" "uuid" NOT NULL,
    "created_by_name" "text" NOT NULL,
    "created_by_phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verified_by_user_id" "uuid",
    "verified_by_name" "text",
    "verified_by_phone" "text",
    "verified_at" timestamp with time zone,
    "deleted_by_user_id" "uuid",
    "deleted_by_name" "text",
    "deleted_by_phone" "text",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "rubber_exports_average_price_check" CHECK (("average_price" > (0)::numeric)),
    CONSTRAINT "rubber_exports_check" CHECK ((("current_weight" IS NULL) OR (("current_weight" > (0)::numeric) AND ("current_weight" <= "original_weight_total")))),
    CONSTRAINT "rubber_exports_check1" CHECK (((("status" = 'draft'::"text") AND ("previous_status" IS NULL) AND ("verified_at" IS NULL) AND ("expense_destination" IS NULL)) OR (("status" = 'verified'::"text") AND ("previous_status" IS NULL) AND ("current_weight" IS NOT NULL) AND ("work_rate" IS NOT NULL) AND ("work_total" IS NOT NULL) AND ("expense_destination" IS NOT NULL) AND ("verified_by_user_id" IS NOT NULL) AND ("verified_at" IS NOT NULL)) OR (("status" = 'deleted'::"text") AND ("previous_status" IS NOT NULL) AND ("deleted_by_user_id" IS NOT NULL) AND ("deleted_at" IS NOT NULL)))),
    CONSTRAINT "rubber_exports_expense_destination_check" CHECK (("expense_destination" = ANY (ARRAY['branch'::"text", 'external'::"text"]))),
    CONSTRAINT "rubber_exports_original_weight_total_check" CHECK (("original_weight_total" > (0)::numeric)),
    CONSTRAINT "rubber_exports_other_operating_cost_check" CHECK (("other_operating_cost" >= (0)::numeric)),
    CONSTRAINT "rubber_exports_paid_total_check" CHECK (("paid_total" > (0)::numeric)),
    CONSTRAINT "rubber_exports_previous_status_check" CHECK (("previous_status" = ANY (ARRAY['draft'::"text", 'verified'::"text"]))),
    CONSTRAINT "rubber_exports_sequence_no_check" CHECK (("sequence_no" > 0)),
    CONSTRAINT "rubber_exports_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'verified'::"text", 'deleted'::"text"]))),
    CONSTRAINT "rubber_exports_weight_loss_percent_check" CHECK ((("weight_loss_percent" IS NULL) OR ("weight_loss_percent" >= (0)::numeric))),
    CONSTRAINT "rubber_exports_work_rate_check" CHECK ((("work_rate" IS NULL) OR ("work_rate" >= (0)::numeric))),
    CONSTRAINT "rubber_exports_work_total_check" CHECK ((("work_total" IS NULL) OR ("work_total" >= (0)::numeric)))
);


ALTER TABLE "public"."rubber_exports" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_exports") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select private.active_report_no('rubber_export', source_row.id);
$$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_exports") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."stock_entries") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_report_no('acid_stock_entry', source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."stock_entries") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."time_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "start_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "end_time" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."time_segments" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_lock_no"("source_row" "public"."time_segments") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$ select private.active_report_no('time_segment', source_row.id); $$;


ALTER FUNCTION "public"."report_lock_no"("source_row" "public"."time_segments") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_no" "text" NOT NULL,
    "report_date" "date" NOT NULL,
    "sequence_no" integer NOT NULL,
    "location_id" "uuid" NOT NULL,
    "cutoff_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by_user_id" "uuid" NOT NULL,
    "created_by_name" "text" NOT NULL,
    "created_by_phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by_user_id" "uuid",
    "deleted_by_name" "text",
    "deleted_by_phone" "text",
    CONSTRAINT "report_batches_sequence_no_check" CHECK (("sequence_no" > 0)),
    CONSTRAINT "report_batches_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'deleted'::"text"])))
);


ALTER TABLE "public"."report_batches" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rubber_export_lock_no"("source_row" "public"."report_batches") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select private.active_rubber_export_no_for_report(source_row.id);
$$;


ALTER FUNCTION "public"."rubber_export_lock_no"("source_row" "public"."report_batches") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubber_bill_approval_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "edit_window_minutes" integer DEFAULT 30 NOT NULL,
    "configured_price" numeric(12,2),
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "updated_by_phone" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rubber_bill_approval_settings_configured_price_check" CHECK ((("configured_price" IS NULL) OR ("configured_price" > (0)::numeric))),
    CONSTRAINT "rubber_bill_approval_settings_edit_window_minutes_check" CHECK (("edit_window_minutes" >= 0)),
    CONSTRAINT "rubber_bill_approval_settings_id_check" CHECK (("id" = true))
);


ALTER TABLE "public"."rubber_bill_approval_settings" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_rubber_bill_approval_settings"("p_edit_window_minutes" integer, "p_configured_price" numeric) RETURNS "public"."rubber_bill_approval_settings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
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
     and (p_configured_price <= 0 or scale(p_configured_price) > 2) then
    raise exception 'ราคายางต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;

  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bill_approval_settings
  set edit_window_minutes = p_edit_window_minutes,
      configured_price = p_configured_price,
      updated_by_user_id = auth.uid(),
      updated_by_name = coalesce(v_actor_name, ''),
      updated_by_phone = coalesce(v_actor_phone, ''),
      updated_at = now()
  where id = true
  returning * into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."save_rubber_bill_approval_settings"("p_edit_window_minutes" integer, "p_configured_price" numeric) OWNER TO "postgres";


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
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_operation text := payload->>'operation';
  v_client_temp_id text := payload->>'clientTempId';
  v_location_id uuid;
  v_idempotency_key text := payload->>'idempotencyKey';
  v_expected_revision integer;
  v_bill public.rubber_bills%rowtype;
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_original_payload jsonb;
  v_current_prices jsonb := '[]'::jsonb;
  v_proposed_prices jsonb := '[]'::jsonb;
  v_price numeric;
  v_price_scale integer;
  v_has_mismatch boolean := false;
  v_reasons text[] := array[]::text[];
  v_request_id uuid;
  v_existing_request_status text;
  v_existing_created_bill_id uuid;
  v_actor_name text;
  v_actor_phone text;
  v_report_no text;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  begin
    v_location_id := (payload->>'locationId')::uuid;
    v_expected_revision := coalesce((payload->>'expectedRevisionNo')::integer, 0);
  exception when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid approval payload');
  end;

  if coalesce(v_client_temp_id, '') = ''
     or coalesce(v_idempotency_key, '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;

  select name, phone
    into v_actor_name, v_actor_phone
  from public.profiles
  where id = auth.uid();

  select *
    into v_settings
  from public.rubber_bill_approval_settings
  where id = true;

  if v_operation in ('create', 'update') then
    for v_price, v_price_scale in
      select (item->>'unitPrice')::numeric, scale((item->>'unitPrice')::numeric)
      from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) item
      where item->>'itemType' = 'weigh'
    loop
      if v_price < 0 or v_price_scale > 2 then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง'
        );
      end if;
      if v_settings.configured_price is not null
         and v_price is distinct from v_settings.configured_price then
        v_has_mismatch := true;
      end if;
    end loop;

    select coalesce(jsonb_agg((item->>'unitPrice')::numeric order by (item->>'sequenceNo')::integer), '[]'::jsonb)
      into v_proposed_prices
    from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) item
    where item->>'itemType' = 'weigh';
  end if;

  if v_operation = 'create' then
    perform pg_advisory_xact_lock(hashtext('rubber-bill-create:' || v_client_temp_id));

    select id, request_status, created_bill_id
      into v_request_id, v_existing_request_status, v_existing_created_bill_id
    from public.rubber_bill_approval_requests
    where idempotency_key = v_idempotency_key;

    if v_request_id is not null then
      if v_existing_request_status = 'approved' and v_existing_created_bill_id is not null then
        select *
          into v_bill
        from public.rubber_bills
        where id = v_existing_created_bill_id;
        return jsonb_build_object(
          'status', 'synced',
          'id', v_bill.id,
          'serverBillNo', v_bill.server_bill_no,
          'revisionNo', v_bill.revision_no,
          'serverReceivedAt', v_bill.server_received_at
        );
      end if;
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;

    if v_settings.configured_price is null or not v_has_mismatch then
      return public.sync_rubber_bill_core_20260724020000(payload);
    end if;

    v_reasons := array_append(v_reasons, 'price');
  else
    select *
      into v_bill
    from public.rubber_bills
    where client_temp_id = v_client_temp_id
    for update;

    if v_bill.id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;

    perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_bill.id::text));

    if v_bill.location_id <> v_location_id then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Location mismatch');
    end if;

    if v_bill.idempotency_key = v_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_bill.id,
        'serverBillNo', v_bill.server_bill_no,
        'revisionNo', v_bill.revision_no,
        'serverReceivedAt', v_bill.server_received_at
      );
    end if;

    if v_bill.revision_no <> v_expected_revision then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
    end if;

    select id
      into v_request_id
    from public.rubber_bill_approval_requests
    where bill_id = v_bill.id
      and request_status = 'pending';

    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;

    v_report_no := private.active_report_no('rubber_bill', v_bill.id);
    if v_report_no is not null then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'บิลอยู่ในรายงาน ' || v_report_no || ' แล้ว จึงสร้างคำขอไม่ได้'
      );
    end if;

    if private.rubber_bill_has_active_transfer(v_bill.id) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'บิลอยู่ในรายการโอนเงินแล้ว จึงสร้างคำขอไม่ได้'
      );
    end if;

    if clock_timestamp() >= v_bill.created_at + make_interval(mins => v_settings.edit_window_minutes) then
      v_reasons := array_append(v_reasons, 'time');
    end if;

    if v_operation = 'update' and v_settings.configured_price is not null then
      select coalesce(jsonb_agg(i.price order by i.sequence_no), '[]'::jsonb)
        into v_current_prices
      from public.rubber_bill_items i
      where i.bill_id = v_bill.id
        and i.item_type = 'weigh';

      if v_current_prices is distinct from v_proposed_prices and v_has_mismatch then
        v_reasons := array_append(v_reasons, 'price');
      end if;
    end if;

    if cardinality(v_reasons) = 0 then
      return public.sync_rubber_bill_core_20260724020000(payload);
    end if;

    v_original_payload := private.current_rubber_bill_payload(v_bill.id);
  end if;

  insert into public.rubber_bill_approval_requests (
    operation,
    bill_id,
    location_id,
    client_temp_id,
    idempotency_key,
    base_revision_no,
    matched_reasons,
    configured_price_snapshot,
    original_payload,
    proposed_payload,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  )
  values (
    v_operation,
    v_bill.id,
    v_location_id,
    v_client_temp_id,
    v_idempotency_key,
    v_expected_revision,
    v_reasons,
    v_settings.configured_price,
    v_original_payload,
    payload,
    auth.uid(),
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending_approval',
    'requestId', v_request_id,
    'operation', v_operation,
    'clientTempId', v_client_temp_id,
    'matchedReasons', to_jsonb(v_reasons)
  );
exception
  when unique_violation then
    select id
      into v_request_id
    from public.rubber_bill_approval_requests
    where request_status = 'pending'
      and (
        idempotency_key = v_idempotency_key
        or bill_id = v_bill.id
        or (operation = 'create' and client_temp_id = v_client_temp_id)
      )
    order by requested_at desc
    limit 1;

    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
  when others then
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


CREATE OR REPLACE FUNCTION "public"."sync_rubber_bill_core_20260724020000"("payload" "jsonb") RETURNS "jsonb"
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


ALTER FUNCTION "public"."sync_rubber_bill_core_20260724020000"("payload" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  transfer_row public.money_transfers%rowtype;
  target_id uuid := (payload->>'targetLocationId')::uuid;
  target_name text;
  counts integer[];
begin
  select * into transfer_row from public.money_transfers where id = p_transfer_id for update;
  if transfer_row.id is null or transfer_row.transfer_method <> 'cash' then raise exception 'ไม่พบรายการเงินสด'; end if;
  if not private.is_active_user() or not private.can_access_location(transfer_row.location_id) then raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้'; end if;
  if auth.uid() <> transfer_row.created_by_user_id and not private.is_super_admin() then raise exception 'ผู้สร้างหรือ super_admin เท่านั้นที่แก้ไขได้'; end if;
  if target_id is null or target_id = transfer_row.location_id then raise exception 'สาขาปลายทางต้องต่างจากสาขาต้นทาง'; end if;
  if not exists (select 1 from public.money_transfer_cash_details where transfer_id = p_transfer_id and cash_status = 'pending_receipt') then raise exception 'แก้ไขได้ก่อนตรวจรับเงินเท่านั้น'; end if;
  select name into target_name from public.locations where id = target_id and is_active = true;
  if target_name is null then raise exception 'ไม่พบสาขาปลายทางที่ใช้งาน'; end if;
  counts := private.cash_transfer_counts(payload, 'sent');
  update public.money_transfer_cash_details set
    sent_coin_1_count = counts[1], sent_coin_2_count = counts[2], sent_coin_5_count = counts[3], sent_coin_10_count = counts[4],
    sent_banknote_20_count = counts[5], sent_banknote_50_count = counts[6], sent_banknote_100_count = counts[7], sent_banknote_500_count = counts[8], sent_banknote_1000_count = counts[9],
    note = nullif(btrim(payload->>'note'), ''), updated_at = now()
  where transfer_id = p_transfer_id;
  update public.money_transfers set
    target_location_id = target_id, target_location_name = target_name,
    net_amount_to_pay = d.sent_total, revision_no = revision_no + 1, updated_at = now()
  from public.money_transfer_cash_details d
  where money_transfers.id = p_transfer_id and d.transfer_id = p_transfer_id;
  return jsonb_build_object('id', p_transfer_id, 'status', 'synced');
end;
$$;


ALTER FUNCTION "public"."update_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_rubber_export"("p_export_id" "uuid", "p_current_weight" numeric, "p_work_rate" numeric, "p_other_operating_cost" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_export public.rubber_exports%rowtype;
  v_other numeric := coalesce(p_other_operating_cost, 0);
  v_loss numeric;
  v_total numeric;
begin
  select *
  into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการส่งออกนี้';
  end if;
  if v_export.status <> 'draft' then
    raise exception 'แก้ไขได้เฉพาะรายการฉบับร่าง';
  end if;
  if p_current_weight is not null
    and (p_current_weight <= 0 or p_current_weight > v_export.original_weight_total) then
    raise exception 'น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกินน้ำหนักสุทธิหลังหักรวม';
  end if;
  if p_work_rate is not null and p_work_rate < 0 then
    raise exception 'ค่าทำงานต้องไม่ติดลบ';
  end if;
  if v_other < 0 then
    raise exception 'ค่าดำเนินการอื่นต้องไม่ติดลบ';
  end if;

  v_loss := case when p_current_weight is null then null
    else round((v_export.original_weight_total - p_current_weight) /
      v_export.original_weight_total * 100, 2)
  end;
  v_total := case when p_current_weight is null or p_work_rate is null then null
    else round(p_current_weight * p_work_rate + v_other, 2)
  end;

  update public.rubber_exports
  set current_weight = p_current_weight,
      weight_loss_percent = v_loss,
      work_rate = p_work_rate,
      other_operating_cost = v_other,
      work_total = v_total
  where id = p_export_id;

  return jsonb_build_object(
    'id', p_export_id,
    'status', 'draft',
    'weightLossPercent', v_loss,
    'workTotal', v_total
  );
end;
$$;


ALTER FUNCTION "public"."update_rubber_export"("p_export_id" "uuid", "p_current_weight" numeric, "p_work_rate" numeric, "p_other_operating_cost" numeric) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."verify_rubber_export"("p_export_id" "uuid", "p_expense_destination" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_export public.rubber_exports%rowtype;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ตรวจสอบได้';
  end if;
  if p_expense_destination not in ('branch', 'external') then
    raise exception 'กรุณาเลือกปลายทางค่าใช้จ่าย';
  end if;

  select *
  into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null then
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if v_export.status = 'verified' then
    if v_export.expense_destination = p_expense_destination then
      return jsonb_build_object('id', p_export_id, 'status', 'verified');
    end if;
    raise exception 'รายการนี้ตรวจสอบแล้วด้วยปลายทางค่าใช้จ่ายอื่น';
  end if;
  if v_export.status <> 'draft' then
    raise exception 'ตรวจสอบได้เฉพาะรายการฉบับร่าง';
  end if;
  if v_export.current_weight is null or v_export.work_rate is null then
    raise exception 'กรุณากรอกน้ำหนักปัจจุบันและค่าทำงานก่อนตรวจสอบ';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.rubber_exports
  set status = 'verified',
      expense_destination = p_expense_destination,
      weight_loss_percent = round(
        (original_weight_total - current_weight) / original_weight_total * 100,
        2
      ),
      work_total = round(current_weight * work_rate + other_operating_cost, 2),
      verified_by_user_id = auth.uid(),
      verified_by_name = coalesce(v_actor_name, ''),
      verified_by_phone = coalesce(v_actor_phone, ''),
      verified_at = v_now
  where id = p_export_id;

  return jsonb_build_object(
    'id', p_export_id,
    'status', 'verified',
    'verifiedAt', v_now
  );
end;
$$;


ALTER FUNCTION "public"."verify_rubber_export"("p_export_id" "uuid", "p_expense_destination" "text") OWNER TO "postgres";


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
    "stock_product_id" "uuid",
    "sequence_no" integer NOT NULL,
    CONSTRAINT "rubber_bill_item_sequence_positive" CHECK (("sequence_no" > 0))
);


ALTER TABLE "public"."rubber_bill_items" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."money_transfer_cash_details" (
    "transfer_id" "uuid" NOT NULL,
    "sent_coin_1_count" integer NOT NULL,
    "sent_coin_2_count" integer NOT NULL,
    "sent_coin_5_count" integer NOT NULL,
    "sent_coin_10_count" integer NOT NULL,
    "sent_banknote_20_count" integer NOT NULL,
    "sent_banknote_50_count" integer NOT NULL,
    "sent_banknote_100_count" integer NOT NULL,
    "sent_banknote_500_count" integer NOT NULL,
    "sent_banknote_1000_count" integer NOT NULL,
    "received_coin_1_count" integer,
    "received_coin_2_count" integer,
    "received_coin_5_count" integer,
    "received_coin_10_count" integer,
    "received_banknote_20_count" integer,
    "received_banknote_50_count" integer,
    "received_banknote_100_count" integer,
    "received_banknote_500_count" integer,
    "received_banknote_1000_count" integer,
    "sent_total" numeric(12,2) GENERATED ALWAYS AS ((((((((("sent_coin_1_count" + ("sent_coin_2_count" * 2)) + ("sent_coin_5_count" * 5)) + ("sent_coin_10_count" * 10)) + ("sent_banknote_20_count" * 20)) + ("sent_banknote_50_count" * 50)) + ("sent_banknote_100_count" * 100)) + ("sent_banknote_500_count" * 500)) + ("sent_banknote_1000_count" * 1000))) STORED,
    "received_total" numeric(12,2) GENERATED ALWAYS AS (
CASE
    WHEN ("received_coin_1_count" IS NULL) THEN NULL::integer
    ELSE (((((((("received_coin_1_count" + ("received_coin_2_count" * 2)) + ("received_coin_5_count" * 5)) + ("received_coin_10_count" * 10)) + ("received_banknote_20_count" * 20)) + ("received_banknote_50_count" * 50)) + ("received_banknote_100_count" * 100)) + ("received_banknote_500_count" * 500)) + ("received_banknote_1000_count" * 1000))
END) STORED,
    "difference_total" numeric(12,2) GENERATED ALWAYS AS (
CASE
    WHEN ("received_coin_1_count" IS NULL) THEN NULL::integer
    ELSE ((((((((("received_coin_1_count" - "sent_coin_1_count") + (("received_coin_2_count" - "sent_coin_2_count") * 2)) + (("received_coin_5_count" - "sent_coin_5_count") * 5)) + (("received_coin_10_count" - "sent_coin_10_count") * 10)) + (("received_banknote_20_count" - "sent_banknote_20_count") * 20)) + (("received_banknote_50_count" - "sent_banknote_50_count") * 50)) + (("received_banknote_100_count" - "sent_banknote_100_count") * 100)) + (("received_banknote_500_count" - "sent_banknote_500_count") * 500)) + (("received_banknote_1000_count" - "sent_banknote_1000_count") * 1000))
END) STORED,
    "cash_status" "text" DEFAULT 'pending_receipt'::"text" NOT NULL,
    "note" "text",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "received_by_user_id" "uuid",
    "received_by_name" "text",
    "received_by_phone" "text",
    "received_at" timestamp with time zone,
    "difference_accepted_by_user_id" "uuid",
    "difference_accept_reason" "text",
    "difference_accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "money_transfer_cash_details_cash_status_check" CHECK (("cash_status" = ANY (ARRAY['pending_receipt'::"text", 'received'::"text", 'mismatched'::"text", 'difference_accepted'::"text"]))),
    CONSTRAINT "money_transfer_cash_details_check" CHECK (((("cash_status" = 'pending_receipt'::"text") AND ("num_nonnulls"("received_coin_1_count", "received_coin_2_count", "received_coin_5_count", "received_coin_10_count", "received_banknote_20_count", "received_banknote_50_count", "received_banknote_100_count", "received_banknote_500_count", "received_banknote_1000_count") = 0) AND ("received_by_user_id" IS NULL) AND ("received_at" IS NULL)) OR (("cash_status" = ANY (ARRAY['received'::"text", 'mismatched'::"text", 'difference_accepted'::"text"])) AND ("num_nonnulls"("received_coin_1_count", "received_coin_2_count", "received_coin_5_count", "received_coin_10_count", "received_banknote_20_count", "received_banknote_50_count", "received_banknote_100_count", "received_banknote_500_count", "received_banknote_1000_count") = 9) AND ("received_by_user_id" IS NOT NULL) AND ("received_at" IS NOT NULL)))),
    CONSTRAINT "money_transfer_cash_details_check1" CHECK (((("cash_status" = 'pending_receipt'::"text") AND ("difference_total" IS NULL)) OR (("cash_status" = 'received'::"text") AND ("difference_total" = (0)::numeric)) OR (("cash_status" = ANY (ARRAY['mismatched'::"text", 'difference_accepted'::"text"])) AND ("difference_total" <> (0)::numeric)))),
    CONSTRAINT "money_transfer_cash_details_check2" CHECK ((("cash_status" <> 'difference_accepted'::"text") OR (("difference_accepted_by_user_id" IS NOT NULL) AND (NULLIF("btrim"("difference_accept_reason"), ''::"text") IS NOT NULL) AND ("difference_accepted_at" IS NOT NULL)))),
    CONSTRAINT "money_transfer_cash_details_received_banknote_1000_count_check" CHECK (("received_banknote_1000_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_received_banknote_100_count_check" CHECK (("received_banknote_100_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_received_banknote_20_count_check" CHECK (("received_banknote_20_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_received_banknote_500_count_check" CHECK (("received_banknote_500_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_received_banknote_50_count_check" CHECK (("received_banknote_50_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_received_coin_10_count_check" CHECK (("received_coin_10_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_received_coin_1_count_check" CHECK (("received_coin_1_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_received_coin_2_count_check" CHECK (("received_coin_2_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_received_coin_5_count_check" CHECK (("received_coin_5_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_banknote_1000_count_check" CHECK (("sent_banknote_1000_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_banknote_100_count_check" CHECK (("sent_banknote_100_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_banknote_20_count_check" CHECK (("sent_banknote_20_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_banknote_500_count_check" CHECK (("sent_banknote_500_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_banknote_50_count_check" CHECK (("sent_banknote_50_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_coin_10_count_check" CHECK (("sent_coin_10_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_coin_1_count_check" CHECK (("sent_coin_1_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_coin_2_count_check" CHECK (("sent_coin_2_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_coin_5_count_check" CHECK (("sent_coin_5_count" >= 0)),
    CONSTRAINT "money_transfer_cash_details_sent_total_check" CHECK (("sent_total" > (0)::numeric))
);


ALTER TABLE "public"."money_transfer_cash_details" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."report_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "eligibility_at" timestamp with time zone NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "report_items_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['rubber_bill'::"text", 'rubber_export'::"text", 'ocr_ticket'::"text", 'income_expense'::"text", 'acid_stock_entry'::"text", 'time_segment'::"text", 'leave_request'::"text", 'financial_transaction'::"text", 'payroll_slip'::"text", 'bank_transfer_source'::"text", 'bank_transfer_target'::"text", 'cash_transfer_sent'::"text", 'cash_transfer_received'::"text"])))
);


ALTER TABLE "public"."report_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubber_bill_approval_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operation" "text" NOT NULL,
    "request_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "bill_id" "uuid",
    "location_id" "uuid" NOT NULL,
    "client_temp_id" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "base_revision_no" integer NOT NULL,
    "matched_reasons" "text"[] NOT NULL,
    "configured_price_snapshot" numeric(12,2),
    "original_payload" "jsonb",
    "proposed_payload" "jsonb" NOT NULL,
    "requested_by_user_id" "uuid" NOT NULL,
    "requested_by_name" "text" NOT NULL,
    "requested_by_phone" "text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_by_user_id" "uuid",
    "approved_by_name" "text",
    "approved_by_phone" "text",
    "approved_at" timestamp with time zone,
    "created_bill_id" "uuid",
    CONSTRAINT "rubber_bill_approval_decision_shape" CHECK (((("request_status" = 'pending'::"text") AND ("approved_by_user_id" IS NULL) AND ("approved_at" IS NULL)) OR (("request_status" = 'approved'::"text") AND ("approved_by_user_id" IS NOT NULL) AND ("approved_at" IS NOT NULL)))),
    CONSTRAINT "rubber_bill_approval_request_shape" CHECK (((("operation" = 'create'::"text") AND ("bill_id" IS NULL) AND ("original_payload" IS NULL)) OR (("operation" = ANY (ARRAY['update'::"text", 'delete'::"text"])) AND ("bill_id" IS NOT NULL) AND ("original_payload" IS NOT NULL)))),
    CONSTRAINT "rubber_bill_approval_requests_matched_reasons_check" CHECK (("cardinality"("matched_reasons") > 0)),
    CONSTRAINT "rubber_bill_approval_requests_operation_check" CHECK (("operation" = ANY (ARRAY['create'::"text", 'update'::"text", 'delete'::"text"]))),
    CONSTRAINT "rubber_bill_approval_requests_request_status_check" CHECK (("request_status" = ANY (ARRAY['pending'::"text", 'approved'::"text"])))
);


ALTER TABLE "public"."rubber_bill_approval_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubber_export_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "export_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "source_report_item_id" "uuid" NOT NULL,
    "source_bill_id" "uuid" NOT NULL,
    "bill_date" "date" NOT NULL,
    "bill_no" "text" NOT NULL,
    "customer_name" "text" NOT NULL,
    "eligibility_at" timestamp with time zone NOT NULL,
    "net_weight" numeric(14,2) NOT NULL,
    "paid_amount" numeric(14,2) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rubber_export_items_net_weight_check" CHECK (("net_weight" > (0)::numeric)),
    CONSTRAINT "rubber_export_items_paid_amount_check" CHECK (("paid_amount" > (0)::numeric))
);


ALTER TABLE "public"."rubber_export_items" OWNER TO "postgres";


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



ALTER TABLE ONLY "public"."money_transfer_cash_details"
    ADD CONSTRAINT "money_transfer_cash_details_pkey" PRIMARY KEY ("transfer_id");



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



ALTER TABLE ONLY "public"."report_batches"
    ADD CONSTRAINT "report_batches_location_id_report_date_sequence_no_key" UNIQUE ("location_id", "report_date", "sequence_no");



ALTER TABLE ONLY "public"."report_batches"
    ADD CONSTRAINT "report_batches_location_id_report_no_key" UNIQUE ("location_id", "report_no");



ALTER TABLE ONLY "public"."report_batches"
    ADD CONSTRAINT "report_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_items"
    ADD CONSTRAINT "report_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_items"
    ADD CONSTRAINT "report_items_report_id_entity_type_entity_id_key" UNIQUE ("report_id", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."rubber_bill_approval_requests"
    ADD CONSTRAINT "rubber_bill_approval_requests_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."rubber_bill_approval_requests"
    ADD CONSTRAINT "rubber_bill_approval_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubber_bill_approval_settings"
    ADD CONSTRAINT "rubber_bill_approval_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubber_bill_items"
    ADD CONSTRAINT "rubber_bill_item_sequence_unique" UNIQUE ("bill_id", "sequence_no");



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



ALTER TABLE ONLY "public"."rubber_export_items"
    ADD CONSTRAINT "rubber_export_items_export_id_source_bill_id_key" UNIQUE ("export_id", "source_bill_id");



ALTER TABLE ONLY "public"."rubber_export_items"
    ADD CONSTRAINT "rubber_export_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubber_exports"
    ADD CONSTRAINT "rubber_exports_location_id_export_date_sequence_no_key" UNIQUE ("location_id", "export_date", "sequence_no");



ALTER TABLE ONLY "public"."rubber_exports"
    ADD CONSTRAINT "rubber_exports_location_id_export_no_key" UNIQUE ("location_id", "export_no");



ALTER TABLE ONLY "public"."rubber_exports"
    ADD CONSTRAINT "rubber_exports_pkey" PRIMARY KEY ("id");



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



CREATE INDEX "money_transfer_cash_details_status_idx" ON "public"."money_transfer_cash_details" USING "btree" ("cash_status", "sent_at" DESC);



CREATE UNIQUE INDEX "money_transfer_items_source_unique" ON "public"."money_transfer_items" USING "btree" ("source_type", "source_id");



CREATE INDEX "money_transfers_feed_source_idx" ON "public"."money_transfers" USING "btree" ("location_id", "created_at" DESC, "id" DESC) WHERE ("record_status" <> 'deleted'::"public"."record_status");



CREATE INDEX "money_transfers_feed_target_idx" ON "public"."money_transfers" USING "btree" ("target_location_id", "created_at" DESC, "id" DESC) WHERE (("record_status" <> 'deleted'::"public"."record_status") AND ("transfer_status" <> 'cancelled'::"text") AND ("transfer_type" = 'branch'::"text"));



CREATE INDEX "ocr_tickets_feed_active_idx" ON "public"."ocr_tickets" USING "btree" ("location_id", "date_in" DESC, "id") WHERE (("record_status" = 'active'::"public"."record_status") AND ("total_amount" > (0)::numeric));



CREATE UNIQUE INDEX "ocr_tickets_location_file_unique" ON "public"."ocr_tickets" USING "btree" ("location_id", "file_name") WHERE ("record_status" = 'active'::"public"."record_status");



CREATE INDEX "payroll_slips_expense_feed_idx" ON "public"."payroll_slips" USING "btree" ("expense_location_id", "approved_at" DESC, "id" DESC) WHERE (("status" = 'APPROVED'::"public"."approval_status") AND ("cancelled_at" IS NULL) AND ("net_pay" > (0)::numeric));



CREATE UNIQUE INDEX "profiles_only_one_super_admin" ON "public"."profiles" USING "btree" ("role") WHERE ("role" = 'super_admin'::"public"."app_role");



CREATE INDEX "report_batches_latest_active" ON "public"."report_batches" USING "btree" ("location_id", "created_at" DESC, "id" DESC) WHERE ("status" = 'active'::"text");



CREATE INDEX "report_batches_location_history" ON "public"."report_batches" USING "btree" ("location_id", "created_at" DESC);



CREATE INDEX "report_items_active_source" ON "public"."report_items" USING "btree" ("entity_type", "entity_id") WHERE ("active" = true);



CREATE UNIQUE INDEX "report_items_one_active_context" ON "public"."report_items" USING "btree" ("location_id", "entity_type", "entity_id") WHERE ("active" = true);



CREATE UNIQUE INDEX "rubber_bill_approval_one_pending_bill" ON "public"."rubber_bill_approval_requests" USING "btree" ("bill_id") WHERE (("request_status" = 'pending'::"text") AND ("bill_id" IS NOT NULL));



CREATE UNIQUE INDEX "rubber_bill_approval_one_pending_create" ON "public"."rubber_bill_approval_requests" USING "btree" ("client_temp_id") WHERE (("request_status" = 'pending'::"text") AND ("operation" = 'create'::"text"));



CREATE INDEX "rubber_bill_approval_queue" ON "public"."rubber_bill_approval_requests" USING "btree" ("request_status", "requested_at" DESC);



CREATE INDEX "rubber_bills_feed_active_idx" ON "public"."rubber_bills" USING "btree" ("location_id", "bill_date" DESC, "id") WHERE (("record_status" = 'active'::"public"."record_status") AND ("net_total" > (0)::numeric));



CREATE UNIQUE INDEX "rubber_export_items_one_active_bill" ON "public"."rubber_export_items" USING "btree" ("location_id", "source_bill_id") WHERE ("active" = true);



CREATE INDEX "rubber_export_items_source_report" ON "public"."rubber_export_items" USING "btree" ("source_report_item_id") WHERE ("active" = true);



CREATE INDEX "rubber_exports_location_history" ON "public"."rubber_exports" USING "btree" ("location_id", "created_at" DESC, "id" DESC);



CREATE INDEX "rubber_exports_report_candidates" ON "public"."rubber_exports" USING "btree" ("location_id", "verified_at", "id") WHERE (("status" = 'verified'::"text") AND ("expense_destination" = 'branch'::"text") AND ("work_total" > (0)::numeric));



CREATE UNIQUE INDEX "stock_entry_approval_requests_pending_entry_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("stock_entry_id") WHERE ("request_status" = 'pending'::"text");



CREATE UNIQUE INDEX "stock_entry_approval_requests_pending_transfer_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("transfer_bill_no") WHERE (("request_status" = 'pending'::"text") AND ("transfer_bill_no" IS NOT NULL) AND ("tx_type" = 'transfer_out'::"text"));



CREATE INDEX "stock_entry_approval_requests_status_created_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("request_status", "created_at" DESC);



CREATE UNIQUE INDEX "stock_product_approval_requests_pending_create_name_idx" ON "public"."stock_product_approval_requests" USING "btree" ("lower"(TRIM(BOTH FROM "product_name"))) WHERE (("request_status" = 'pending'::"text") AND ("request_type" = 'create_product'::"text"));



CREATE UNIQUE INDEX "stock_product_approval_requests_pending_delete_product_idx" ON "public"."stock_product_approval_requests" USING "btree" ("product_id") WHERE (("request_status" = 'pending'::"text") AND ("request_type" = 'delete_product'::"text"));



CREATE INDEX "stock_product_approval_requests_status_created_idx" ON "public"."stock_product_approval_requests" USING "btree" ("request_status", "created_at" DESC);



CREATE UNIQUE INDEX "transport_staff_bank_accounts_one_primary" ON "public"."transport_staff_bank_accounts" USING "btree" ("staff_id") WHERE ("is_primary" = true);



CREATE OR REPLACE TRIGGER "assign_rubber_bill_item_sequence" BEFORE INSERT ON "public"."rubber_bill_items" FOR EACH ROW EXECUTE FUNCTION "private"."assign_rubber_bill_item_sequence"();



CREATE OR REPLACE TRIGGER "enforce_financial_transaction_expense_relation" BEFORE UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_time_tracking_expense_relation"();



CREATE OR REPLACE TRIGGER "enforce_payroll_slip_expense_relation" BEFORE UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_time_tracking_expense_relation"();



CREATE OR REPLACE TRIGGER "guard_approved_rubber_bill_request_history" BEFORE DELETE OR UPDATE ON "public"."rubber_bill_approval_requests" FOR EACH ROW EXECUTE FUNCTION "private"."guard_approved_rubber_bill_request_history"();



CREATE OR REPLACE TRIGGER "guard_rubber_export_state" BEFORE UPDATE ON "public"."rubber_exports" FOR EACH ROW EXECUTE FUNCTION "private"."guard_rubber_export_state"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."leave_requests" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."time_segments" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "income_expense_lock_location" BEFORE UPDATE ON "public"."income_expense" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_location_change"();



CREATE OR REPLACE TRIGGER "ocr_tickets_transfer_relation_delete_lock" BEFORE DELETE ON "public"."ocr_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_locked_ocr_ticket_change"();



CREATE OR REPLACE TRIGGER "ocr_tickets_transfer_relation_update_lock" BEFORE UPDATE ON "public"."ocr_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_locked_ocr_ticket_change"();



CREATE OR REPLACE TRIGGER "pending_rubber_bill_blocks_money_transfer" BEFORE INSERT OR UPDATE ON "public"."money_transfer_items" FOR EACH ROW EXECUTE FUNCTION "private"."guard_pending_rubber_bill_relation"();



CREATE OR REPLACE TRIGGER "pending_rubber_bill_blocks_report" BEFORE INSERT OR UPDATE ON "public"."report_items" FOR EACH ROW EXECUTE FUNCTION "private"."guard_pending_rubber_bill_relation"();



CREATE OR REPLACE TRIGGER "prevent_hard_delete_of_linked_financial_transaction" BEFORE DELETE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"();



CREATE OR REPLACE TRIGGER "prevent_hard_delete_of_linked_payroll_slip" BEFORE DELETE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"();



CREATE OR REPLACE TRIGGER "report_lock_financial_transactions" BEFORE DELETE OR UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('financial_transaction');



CREATE OR REPLACE TRIGGER "report_lock_income_expense" BEFORE DELETE OR UPDATE ON "public"."income_expense" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('income_expense');



CREATE OR REPLACE TRIGGER "report_lock_leave_requests" BEFORE DELETE OR UPDATE ON "public"."leave_requests" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('leave_request');



CREATE OR REPLACE TRIGGER "report_lock_money_transfer_cash_details" BEFORE DELETE OR UPDATE ON "public"."money_transfer_cash_details" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_cash_details"();



CREATE OR REPLACE TRIGGER "report_lock_money_transfer_items" BEFORE INSERT OR DELETE OR UPDATE ON "public"."money_transfer_items" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_transfer_item"();



CREATE OR REPLACE TRIGGER "report_lock_money_transfer_slips" BEFORE INSERT OR DELETE OR UPDATE ON "public"."money_transfer_slips" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_transfer_child"();



CREATE OR REPLACE TRIGGER "report_lock_money_transfers" BEFORE DELETE OR UPDATE ON "public"."money_transfers" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_money_transfer"();



CREATE OR REPLACE TRIGGER "report_lock_ocr_tickets" BEFORE DELETE OR UPDATE ON "public"."ocr_tickets" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('ocr_ticket');



CREATE OR REPLACE TRIGGER "report_lock_payroll_slips" BEFORE DELETE OR UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('payroll_slip');



CREATE OR REPLACE TRIGGER "report_lock_rubber_bill_items" BEFORE INSERT OR DELETE OR UPDATE ON "public"."rubber_bill_items" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_rubber_item"();



CREATE OR REPLACE TRIGGER "report_lock_rubber_bills" BEFORE DELETE OR UPDATE ON "public"."rubber_bills" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('rubber_bill');



CREATE OR REPLACE TRIGGER "report_lock_rubber_exports" BEFORE DELETE OR UPDATE ON "public"."rubber_exports" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('rubber_export');



CREATE OR REPLACE TRIGGER "report_lock_stock_entries" BEFORE DELETE OR UPDATE ON "public"."stock_entries" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('acid_stock_entry');



CREATE OR REPLACE TRIGGER "report_lock_time_segments" BEFORE DELETE OR UPDATE ON "public"."time_segments" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('time_segment');



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



ALTER TABLE ONLY "public"."money_transfer_cash_details"
    ADD CONSTRAINT "money_transfer_cash_details_difference_accepted_by_user_id_fkey" FOREIGN KEY ("difference_accepted_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."money_transfer_cash_details"
    ADD CONSTRAINT "money_transfer_cash_details_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."money_transfer_cash_details"
    ADD CONSTRAINT "money_transfer_cash_details_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "public"."money_transfers"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."report_batches"
    ADD CONSTRAINT "report_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."report_batches"
    ADD CONSTRAINT "report_batches_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."report_batches"
    ADD CONSTRAINT "report_batches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."report_items"
    ADD CONSTRAINT "report_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."report_items"
    ADD CONSTRAINT "report_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."report_batches"("id");



ALTER TABLE ONLY "public"."rubber_bill_approval_requests"
    ADD CONSTRAINT "rubber_bill_approval_requests_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_bill_approval_requests"
    ADD CONSTRAINT "rubber_bill_approval_requests_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."rubber_bills"("id");



ALTER TABLE ONLY "public"."rubber_bill_approval_requests"
    ADD CONSTRAINT "rubber_bill_approval_requests_created_bill_id_fkey" FOREIGN KEY ("created_bill_id") REFERENCES "public"."rubber_bills"("id");



ALTER TABLE ONLY "public"."rubber_bill_approval_requests"
    ADD CONSTRAINT "rubber_bill_approval_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."rubber_bill_approval_requests"
    ADD CONSTRAINT "rubber_bill_approval_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_bill_approval_settings"
    ADD CONSTRAINT "rubber_bill_approval_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("id");



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



ALTER TABLE ONLY "public"."rubber_export_items"
    ADD CONSTRAINT "rubber_export_items_export_id_fkey" FOREIGN KEY ("export_id") REFERENCES "public"."rubber_exports"("id");



ALTER TABLE ONLY "public"."rubber_export_items"
    ADD CONSTRAINT "rubber_export_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."rubber_export_items"
    ADD CONSTRAINT "rubber_export_items_source_bill_id_fkey" FOREIGN KEY ("source_bill_id") REFERENCES "public"."rubber_bills"("id");



ALTER TABLE ONLY "public"."rubber_export_items"
    ADD CONSTRAINT "rubber_export_items_source_report_item_id_fkey" FOREIGN KEY ("source_report_item_id") REFERENCES "public"."report_items"("id");



ALTER TABLE ONLY "public"."rubber_exports"
    ADD CONSTRAINT "rubber_exports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_exports"
    ADD CONSTRAINT "rubber_exports_cutoff_report_item_id_fkey" FOREIGN KEY ("cutoff_report_item_id") REFERENCES "public"."report_items"("id");



ALTER TABLE ONLY "public"."rubber_exports"
    ADD CONSTRAINT "rubber_exports_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_exports"
    ADD CONSTRAINT "rubber_exports_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."rubber_exports"
    ADD CONSTRAINT "rubber_exports_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."profiles"("id");



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



CREATE POLICY "active users read rubber bill approval settings" ON "public"."rubber_bill_approval_settings" FOR SELECT USING ("private"."is_active_user"());



CREATE POLICY "cash details source or target select" ON "public"."money_transfer_cash_details" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_cash_details"."transfer_id") AND ("private"."can_access_location"("t"."location_id") OR "private"."can_access_location"("t"."target_location_id"))))));



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



ALTER TABLE "public"."money_transfer_cash_details" ENABLE ROW LEVEL SECURITY;


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



CREATE POLICY "money_transfers_cash_target_select_scope" ON "public"."money_transfers" FOR SELECT TO "authenticated" USING ((("transfer_type" = 'cash'::"text") AND ("target_location_id" IS NOT NULL) AND "private"."can_access_location"("target_location_id")));



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



CREATE POLICY "report batches scoped read" ON "public"."report_batches" FOR SELECT TO "authenticated" USING ("private"."can_manage_reports"("location_id"));



CREATE POLICY "report items scoped read" ON "public"."report_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."report_batches" "b"
  WHERE (("b"."id" = "report_items"."report_id") AND "private"."can_manage_reports"("b"."location_id")))));



ALTER TABLE "public"."report_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."report_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rubber bill items select scoped through bill" ON "public"."rubber_bill_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."rubber_bills" "b"
  WHERE (("b"."id" = "rubber_bill_items"."bill_id") AND "public"."can_access_location"("b"."location_id")))));



CREATE POLICY "rubber bills location scoped" ON "public"."rubber_bills" FOR SELECT USING ("public"."can_access_location"("location_id"));



CREATE POLICY "rubber export items scoped read" ON "public"."rubber_export_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rubber_exports" "e"
  WHERE (("e"."id" = "rubber_export_items"."export_id") AND "private"."can_manage_reports"("e"."location_id")))));



CREATE POLICY "rubber exports scoped read" ON "public"."rubber_exports" FOR SELECT TO "authenticated" USING ("private"."can_manage_reports"("location_id"));



ALTER TABLE "public"."rubber_bill_approval_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubber_bill_approval_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubber_bill_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubber_bills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubber_export_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubber_exports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_entry_approval_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_entry_approval_requests_read" ON "public"."stock_entry_approval_requests" FOR SELECT TO "authenticated" USING (("public"."can_access_super_admin_features"() OR ("requested_by_user_id" = "auth"."uid"()) OR "public"."can_access_location"("location_id") OR (("target_location_id" IS NOT NULL) AND "public"."can_access_location"("target_location_id"))));



ALTER TABLE "public"."stock_product_approval_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_product_approval_requests_read" ON "public"."stock_product_approval_requests" FOR SELECT TO "authenticated" USING (("public"."can_access_super_admin_features"() OR ("requested_by_user_id" = "auth"."uid"())));



ALTER TABLE "public"."stock_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system managers read rubber bill approval requests" ON "public"."rubber_bill_approval_requests" FOR SELECT USING (("private"."is_active_user"() AND "public"."can_access_super_admin_features"()));



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



GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."can_access_location"("target_location" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_location"("target_location" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_access_money_transfer_module"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_money_transfer_module"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_access_optional_location"("target_location" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_optional_location"("target_location" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_access_super_admin_features"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_super_admin_features"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_manage_location"("target_location" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_location"("target_location" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_manage_profile"("target_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_profile"("target_user" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_view_profile"("target_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_view_profile"("target_user" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_active_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_active_user"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_super_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."accept_cash_branch_difference"("p_transfer_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_cash_branch_difference"("p_transfer_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."approve_rubber_bill_approval_request"("p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_rubber_bill_approval_request"("p_request_id" "uuid") TO "authenticated";



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



REVOKE ALL ON FUNCTION "public"."create_cash_branch_transfer"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_cash_branch_transfer"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_income_expense_approval_request"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_income_expense_approval_request"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_report_batch"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_report_batch"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_rubber_export"("p_location_id" "uuid", "p_cutoff_report_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_rubber_export"("p_location_id" "uuid", "p_cutoff_report_item_id" "uuid") TO "authenticated";



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



REVOKE ALL ON FUNCTION "public"."delete_cash_branch_transfer"("p_transfer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_cash_branch_transfer"("p_transfer_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_income_sale_item"("item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_income_sale_item"("item_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_report_batch"("p_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_report_batch"("p_report_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_rubber_bill_approval_request"("p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_rubber_bill_approval_request"("p_request_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_rubber_export"("p_export_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_rubber_export"("p_export_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."delete_time_tracking_source_permanently"("p_source_type" "text", "p_source_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_time_tracking_source_permanently"("p_source_type" "text", "p_source_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_acid_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_acid_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_income_expense_feed"("p_location_id" "uuid", "p_from_date" "date", "p_to_date" "date", "p_cursor_date" "date", "p_cursor_key" "text", "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_income_expense_feed"("p_location_id" "uuid", "p_from_date" "date", "p_to_date" "date", "p_cursor_date" "date", "p_cursor_key" "text", "p_page_size" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_report_income_expense_rows"("p_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_report_income_expense_rows"("p_report_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_rubber_export_cutoff_options"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_rubber_export_cutoff_options"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_rubber_bill_approval_markers"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_rubber_bill_approval_markers"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_rubber_bill_printed"("p_bill_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_rubber_bill_printed"("p_bill_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prevent_locked_ocr_ticket_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."preview_rubber_export"("p_location_id" "uuid", "p_cutoff_report_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preview_rubber_export"("p_location_id" "uuid", "p_cutoff_report_item_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."receive_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."receive_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."financial_transactions" TO "anon";
GRANT ALL ON TABLE "public"."financial_transactions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."financial_transactions" TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."financial_transactions") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."financial_transactions") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."financial_transactions") TO "service_role";



GRANT ALL ON TABLE "public"."income_expense" TO "service_role";
GRANT SELECT ON TABLE "public"."income_expense" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."income_expense") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."income_expense") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."income_expense") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_requests" TO "anon";
GRANT ALL ON TABLE "public"."leave_requests" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."leave_requests" TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."leave_requests") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."leave_requests") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."leave_requests") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfers" TO "anon";
GRANT ALL ON TABLE "public"."money_transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfers" TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."money_transfers") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."money_transfers") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."money_transfers") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ocr_tickets" TO "anon";
GRANT ALL ON TABLE "public"."ocr_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."ocr_tickets" TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."ocr_tickets") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."ocr_tickets") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."ocr_tickets") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payroll_slips" TO "anon";
GRANT ALL ON TABLE "public"."payroll_slips" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_slips" TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."payroll_slips") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."payroll_slips") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."payroll_slips") TO "service_role";



GRANT ALL ON TABLE "public"."rubber_bills" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_bills" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_bills") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_bills") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_bills") TO "service_role";



GRANT ALL ON TABLE "public"."rubber_exports" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_exports" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_exports") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_exports") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."rubber_exports") TO "service_role";



GRANT ALL ON TABLE "public"."stock_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_entries" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."stock_entries") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."stock_entries") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."stock_entries") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."time_segments" TO "anon";
GRANT ALL ON TABLE "public"."time_segments" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."time_segments" TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."time_segments") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."time_segments") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."time_segments") TO "service_role";



GRANT ALL ON TABLE "public"."report_batches" TO "service_role";
GRANT SELECT ON TABLE "public"."report_batches" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rubber_export_lock_no"("source_row" "public"."report_batches") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rubber_export_lock_no"("source_row" "public"."report_batches") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rubber_export_lock_no"("source_row" "public"."report_batches") TO "service_role";



GRANT ALL ON TABLE "public"."rubber_bill_approval_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_bill_approval_settings" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_rubber_bill_approval_settings"("p_edit_window_minutes" integer, "p_configured_price" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_rubber_bill_approval_settings"("p_edit_window_minutes" integer, "p_configured_price" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_acid_stock_entry"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_acid_stock_entry"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_income_expense"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_income_expense"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_rubber_bill"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_rubber_bill"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_rubber_bill_core_20260716020000"("payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."sync_rubber_bill_core_20260724020000"("payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."sync_stock_entry"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_stock_entry"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."transfer_acid_stock"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_acid_stock"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."transfer_stock"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_stock"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_rubber_export"("p_export_id" "uuid", "p_current_weight" numeric, "p_work_rate" numeric, "p_other_operating_cost" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_rubber_export"("p_export_id" "uuid", "p_current_weight" numeric, "p_work_rate" numeric, "p_other_operating_cost" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."validate_stock_non_negative_after_entry_delete"("p_location_id" "uuid", "p_product_id" "uuid", "p_deleted_entry_ids" "uuid"[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."verify_rubber_export"("p_export_id" "uuid", "p_expense_destination" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_rubber_export"("p_export_id" "uuid", "p_expense_destination" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."stock_products" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."stock_products" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_products" TO "service_role";
GRANT SELECT ON TABLE "public"."acid_products" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."acid_stock_entries" TO "authenticated";



GRANT ALL ON TABLE "public"."rubber_bill_items" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_bill_items" TO "authenticated";



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



GRANT ALL ON TABLE "public"."income_expense_approval_keywords" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."income_expense_approval_keywords" TO "authenticated";



GRANT ALL ON TABLE "public"."income_expense_approval_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."income_expense_approval_requests" TO "authenticated";



GRANT ALL ON TABLE "public"."income_expense_approval_settings" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."income_expense_approval_settings" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."income_sale_items" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."income_sale_items" TO "authenticated";
GRANT ALL ON TABLE "public"."income_sale_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."money_transfer_cash_details" TO "service_role";
GRANT SELECT ON TABLE "public"."money_transfer_cash_details" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfer_items" TO "anon";
GRANT ALL ON TABLE "public"."money_transfer_items" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfer_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfer_slips" TO "anon";
GRANT ALL ON TABLE "public"."money_transfer_slips" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfer_slips" TO "service_role";



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



GRANT ALL ON TABLE "public"."report_items" TO "service_role";
GRANT SELECT ON TABLE "public"."report_items" TO "authenticated";



GRANT ALL ON TABLE "public"."rubber_bill_approval_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_bill_approval_requests" TO "authenticated";



GRANT ALL ON TABLE "public"."rubber_export_items" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_export_items" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_entry_approval_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_entry_approval_requests" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."stock_product_approval_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_product_approval_requests" TO "authenticated";



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
