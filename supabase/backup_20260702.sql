


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


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "moddatetime" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






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


CREATE OR REPLACE FUNCTION "private"."can_access_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_super_admin()
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


CREATE OR REPLACE FUNCTION "private"."can_access_optional_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_super_admin()
    or (
      target_location is not null
      and private.can_access_location(target_location)
    )
$$;


ALTER FUNCTION "private"."can_access_optional_location"("target_location" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_super_admin()
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
  select private.is_super_admin()
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


CREATE OR REPLACE FUNCTION "private"."can_view_profile"("target_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_active_user()
    and (
      target_user = auth.uid()
      or private.is_super_admin()
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


CREATE OR REPLACE FUNCTION "public"."can_access_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.can_access_location(target_location)
$$;


ALTER FUNCTION "public"."can_access_location"("target_location" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select auth.uid()
$$;


ALTER FUNCTION "public"."current_profile_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_debts_daily"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_debt record;
  v_user_wage numeric;
  v_current_month_start timestamp with time zone;
  v_total_ms numeric;
  v_total_days numeric;
  v_gross_pay numeric;
  v_deduct_amount numeric;
  v_today date;
  v_deduction_type text;
  v_comment text;
BEGIN
  v_today := current_date;
  v_current_month_start := date_trunc('month', current_timestamp AT TIME ZONE 'Asia/Bangkok');
  
  -- Iterate through approved debts and withdrawals that still have remaining balance
  FOR v_debt IN 
    SELECT id, profile_id, remaining_amount, due_date, created_at, type 
    FROM public.financial_transactions 
    WHERE type IN ('DEBT', 'WITHDRAWAL') 
      AND status = 'APPROVED' 
      AND remaining_amount > 0 
  LOOP
    IF v_debt.type = 'DEBT' AND v_debt.due_date IS NOT NULL AND v_debt.due_date > v_today THEN
      CONTINUE;
    END IF;

    SELECT daily_wage INTO v_user_wage FROM public.profiles WHERE id = v_debt.profile_id;
    
    IF v_user_wage IS NULL OR v_user_wage <= 0 THEN
      CONTINUE;
    END IF;

    -- Calculate total time in ms for current month
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) * 1000), 0)
    INTO v_total_ms
    FROM public.time_segments
    WHERE profile_id = v_debt.profile_id
      AND end_time IS NOT NULL
      AND start_time >= v_current_month_start;

    -- Calculate gross pay
    v_total_days := v_total_ms / (1000.0 * 60.0 * 60.0 * 8.0);
    v_gross_pay := v_total_days * v_user_wage;

    DECLARE
      v_already_used numeric;
      v_remaining_balance numeric;
    BEGIN
      -- Sum already deducted amounts this month
      SELECT COALESCE(SUM(amount), 0) INTO v_already_used
      FROM public.financial_transactions
      WHERE profile_id = v_debt.profile_id
        AND status = 'APPROVED'
        AND type IN ('WITHDRAWAL_DEDUCTION', 'DEBT_DEDUCTION', 'SALARY')
        AND created_at >= v_current_month_start;
        
      v_remaining_balance := v_gross_pay - v_already_used;

      IF v_remaining_balance <= 0 THEN
        CONTINUE; -- No wage left to deduct from
      END IF;

      -- Calculate deduction amount
      v_deduct_amount := LEAST(v_debt.remaining_amount, v_remaining_balance);
      v_deduct_amount := trunc(v_deduct_amount, 2);

      IF v_deduct_amount <= 0 THEN
        CONTINUE;
      END IF;

      -- Update remaining amount of the debt/withdrawal
      UPDATE public.financial_transactions
      SET remaining_amount = remaining_amount - v_deduct_amount
      WHERE id = v_debt.id;

      -- Determine type and comment
      IF v_debt.type = 'DEBT' THEN
        v_deduction_type := 'DEBT_DEDUCTION';
        v_comment := 'หักหนี้อัตโนมัติประจำวัน';
      ELSE
        v_deduction_type := 'WITHDRAWAL_DEDUCTION';
        v_comment := 'หักยอดเบิกเงินอัตโนมัติประจำวัน';
      END IF;

      -- Insert deduction transaction
      INSERT INTO public.financial_transactions (profile_id, type, amount, status, parent_debt_id, admin_comment)
      VALUES (v_debt.profile_id, v_deduction_type::financial_transaction_type, v_deduct_amount, 'APPROVED', v_debt.id, v_comment);

      -- Insert audit log
      INSERT INTO public.time_tracking_audit_logs (admin_id, action, target_table, record_id, new_data, comment)
      VALUES (
        v_debt.profile_id, 
        'AUTO_DEDUCTION', 
        'financial_transactions', 
        v_debt.id, 
        jsonb_build_object('deducted_amount', v_deduct_amount, 'remaining_amount', v_debt.remaining_amount - v_deduct_amount, 'type', v_deduction_type), 
        v_comment
      );
    END;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."deduct_debts_daily"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_super_admin()
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


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

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid",
    "actor_user_id" "uuid",
    "actor_name" "text" NOT NULL,
    "actor_phone" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "action" "text" NOT NULL,
    "old_data" "jsonb",
    "new_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."debts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "remaining_amount" numeric DEFAULT 0 NOT NULL,
    "installment_amount" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."debts" OWNER TO "postgres";


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
    "approved_by" "uuid"
);


ALTER TABLE "public"."financial_transactions" OWNER TO "postgres";


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
    "transaction_option" "text",
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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."income_expense" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."offline_sync_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_temp_id" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "operation_type" "text" DEFAULT 'create'::"text" NOT NULL,
    "location_id" "uuid",
    "payload" "jsonb" NOT NULL,
    "status" "public"."sync_status" DEFAULT 'pending'::"public"."sync_status" NOT NULL,
    "server_id" "uuid",
    "error_message" "text",
    "created_by_user_id" "uuid",
    "client_recorded_at" timestamp with time zone,
    "client_created_at" timestamp with time zone,
    "server_received_at" timestamp with time zone,
    "server_created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."offline_sync_events" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
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
    "daily_wage" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
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
    "comment" "text" NOT NULL,
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


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_profile_id_key" UNIQUE ("profile_id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_client_temp_id_key" UNIQUE ("client_temp_id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."offline_sync_events"
    ADD CONSTRAINT "offline_sync_events_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."offline_sync_events"
    ADD CONSTRAINT "offline_sync_events_pkey" PRIMARY KEY ("id");



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



CREATE UNIQUE INDEX "idx_customer_bank_accounts_primary" ON "public"."customer_bank_accounts" USING "btree" ("customer_id") WHERE ("is_primary" = true);



CREATE UNIQUE INDEX "money_transfer_items_source_unique" ON "public"."money_transfer_items" USING "btree" ("source_type", "source_id");



CREATE UNIQUE INDEX "ocr_tickets_location_file_unique" ON "public"."ocr_tickets" USING "btree" ("location_id", "file_name") WHERE ("record_status" = 'active'::"public"."record_status");



CREATE UNIQUE INDEX "profiles_only_one_super_admin" ON "public"."profiles" USING "btree" ("role") WHERE ("role" = 'super_admin'::"public"."app_role");



CREATE UNIQUE INDEX "transport_staff_bank_accounts_one_primary" ON "public"."transport_staff_bank_accounts" USING "btree" ("staff_id") WHERE ("is_primary" = true);



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."debts" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."leave_requests" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."time_segments" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "income_expense_lock_location" BEFORE UPDATE ON "public"."income_expense" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_location_change"();



CREATE OR REPLACE TRIGGER "rubber_bills_lock_location" BEFORE UPDATE ON "public"."rubber_bills" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_location_change"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



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



ALTER TABLE ONLY "public"."debts"
    ADD CONSTRAINT "debts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_parent_debt_id_fkey" FOREIGN KEY ("parent_debt_id") REFERENCES "public"."financial_transactions"("id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



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



ALTER TABLE ONLY "public"."offline_sync_events"
    ADD CONSTRAINT "offline_sync_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."offline_sync_events"
    ADD CONSTRAINT "offline_sync_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payroll_slips"
    ADD CONSTRAINT "payroll_slips_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_bill_items"
    ADD CONSTRAINT "rubber_bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."rubber_bills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



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



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_scope" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK (("private"."is_super_admin"() OR ("private"."is_active_user"() AND ("actor_user_id" = "auth"."uid"()) AND ("private"."can_access_location"("location_id") OR ("location_id" IS NULL)))));



CREATE POLICY "audit_logs_select_scope" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (("private"."is_super_admin"() OR ("private"."is_active_user"() AND ("private"."can_access_location"("location_id") OR (("location_id" IS NULL) AND ("actor_user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."customer_bank_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_bank_accounts_parent_scope" ON "public"."customer_bank_accounts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_bank_accounts"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_bank_accounts"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id")))));



ALTER TABLE "public"."customer_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_contacts_parent_scope" ON "public"."customer_contacts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_contacts"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_contacts"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id")))));



ALTER TABLE "public"."customer_farms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_farms_parent_scope" ON "public"."customer_farms" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_farms"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_farms"."customer_id") AND "private"."can_access_optional_location"("c"."default_location_id")))));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_delete_location" ON "public"."customers" FOR DELETE TO "authenticated" USING ("private"."can_access_optional_location"("default_location_id"));



CREATE POLICY "customers_insert_location" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ("private"."can_access_optional_location"("default_location_id"));



CREATE POLICY "customers_select_location" ON "public"."customers" FOR SELECT TO "authenticated" USING ("private"."can_access_optional_location"("default_location_id"));



CREATE POLICY "customers_update_location" ON "public"."customers" FOR UPDATE TO "authenticated" USING ("private"."can_access_optional_location"("default_location_id")) WITH CHECK ("private"."can_access_optional_location"("default_location_id"));



ALTER TABLE "public"."debts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "debts_all" ON "public"."debts" TO "authenticated" USING (true);



ALTER TABLE "public"."financial_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "financial_transactions_all" ON "public"."financial_transactions" TO "authenticated" USING (true);



ALTER TABLE "public"."income_expense" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_expense_location_scope" ON "public"."income_expense" TO "authenticated" USING ("private"."can_access_location"("location_id")) WITH CHECK ("private"."can_access_location"("location_id"));



ALTER TABLE "public"."leave_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leave_requests_all" ON "public"."leave_requests" TO "authenticated" USING (true);



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_manage_super_admin" ON "public"."locations" TO "authenticated" USING ("private"."is_super_admin"()) WITH CHECK ("private"."is_super_admin"());



CREATE POLICY "locations_select_assigned" ON "public"."locations" FOR SELECT TO "authenticated" USING ("private"."can_access_location"("id"));



ALTER TABLE "public"."money_transfer_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "money_transfer_items_parent_scope" ON "public"."money_transfer_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "private"."can_access_location"("t"."location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "private"."can_access_location"("t"."location_id")))));



ALTER TABLE "public"."money_transfer_slips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "money_transfer_slips_parent_scope" ON "public"."money_transfer_slips" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "private"."can_access_location"("t"."location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "private"."can_access_location"("t"."location_id")))));



ALTER TABLE "public"."money_transfers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "money_transfers_location_scope" ON "public"."money_transfers" TO "authenticated" USING ("private"."can_access_location"("location_id")) WITH CHECK ("private"."can_access_location"("location_id"));



ALTER TABLE "public"."ocr_tickets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ocr_tickets_location_scope" ON "public"."ocr_tickets" TO "authenticated" USING ("private"."can_access_location"("location_id")) WITH CHECK ("private"."can_access_location"("location_id"));



ALTER TABLE "public"."offline_sync_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "offline_sync_events_actor_scope" ON "public"."offline_sync_events" TO "authenticated" USING (("private"."is_super_admin"() OR ("private"."is_active_user"() AND ("private"."can_access_location"("location_id") OR (("location_id" IS NULL) AND ("created_by_user_id" = "auth"."uid"())))))) WITH CHECK (("private"."is_super_admin"() OR ("private"."is_active_user"() AND ("created_by_user_id" = "auth"."uid"()) AND ("private"."can_access_location"("location_id") OR ("location_id" IS NULL)))));



ALTER TABLE "public"."payroll_slips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payroll_slips_all" ON "public"."payroll_slips" TO "authenticated" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_authorized" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("private"."can_view_profile"("id"));



CREATE POLICY "profiles_update_super_admin" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("private"."is_super_admin"()) WITH CHECK ("private"."is_super_admin"());



ALTER TABLE "public"."rubber_bill_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rubber_bill_items_parent_scope" ON "public"."rubber_bill_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rubber_bills" "b"
  WHERE (("b"."id" = "rubber_bill_items"."bill_id") AND "private"."can_access_location"("b"."location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."rubber_bills" "b"
  WHERE (("b"."id" = "rubber_bill_items"."bill_id") AND "private"."can_access_location"("b"."location_id")))));



ALTER TABLE "public"."rubber_bills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rubber_bills_location_scope" ON "public"."rubber_bills" TO "authenticated" USING ("private"."can_access_location"("location_id")) WITH CHECK ("private"."can_access_location"("location_id"));



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



ALTER TABLE "public"."transport_staff_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staff_contacts_parent_scope" ON "public"."transport_staff_contacts" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_contacts"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_contacts"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id")))));



ALTER TABLE "public"."transport_staff_plates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staff_plates_parent_scope" ON "public"."transport_staff_plates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_plates"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE (("s"."id" = "transport_staff_plates"."staff_id") AND "private"."can_access_optional_location"("s"."default_location_id")))));



ALTER TABLE "public"."transport_staffs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staffs_location_scope" ON "public"."transport_staffs" TO "authenticated" USING ("private"."can_access_optional_location"("default_location_id")) WITH CHECK ("private"."can_access_optional_location"("default_location_id"));



ALTER TABLE "public"."user_locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_locations_delete_scoped_admin" ON "public"."user_locations" FOR DELETE TO "authenticated" USING (("private"."can_manage_location"("location_id") AND "private"."can_manage_profile"("user_id")));



CREATE POLICY "user_locations_insert_scoped_admin" ON "public"."user_locations" FOR INSERT TO "authenticated" WITH CHECK (("private"."can_manage_location"("location_id") AND "private"."can_manage_profile"("user_id")));



CREATE POLICY "user_locations_select_authorized" ON "public"."user_locations" FOR SELECT TO "authenticated" USING (("private"."is_active_user"() AND (("user_id" = "auth"."uid"()) OR "private"."can_view_profile"("user_id"))));



CREATE POLICY "user_locations_update_scoped_admin" ON "public"."user_locations" FOR UPDATE TO "authenticated" USING (("private"."can_manage_location"("location_id") AND "private"."can_manage_profile"("user_id"))) WITH CHECK (("private"."can_manage_location"("location_id") AND "private"."can_manage_profile"("user_id")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




















































































































































































REVOKE ALL ON FUNCTION "private"."can_access_location"("target_location" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_location"("target_location" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_access_optional_location"("target_location" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_optional_location"("target_location" "uuid") TO "authenticated";



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



REVOKE ALL ON FUNCTION "public"."can_access_location"("target_location" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_location"("target_location" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_profile_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_id"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
























GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



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



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debts" TO "anon";
GRANT ALL ON TABLE "public"."debts" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."debts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."financial_transactions" TO "anon";
GRANT ALL ON TABLE "public"."financial_transactions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."financial_transactions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."income_expense" TO "anon";
GRANT ALL ON TABLE "public"."income_expense" TO "authenticated";
GRANT ALL ON TABLE "public"."income_expense" TO "service_role";



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



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."offline_sync_events" TO "anon";
GRANT ALL ON TABLE "public"."offline_sync_events" TO "authenticated";
GRANT ALL ON TABLE "public"."offline_sync_events" TO "service_role";



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



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rubber_bill_items" TO "anon";
GRANT ALL ON TABLE "public"."rubber_bill_items" TO "authenticated";
GRANT ALL ON TABLE "public"."rubber_bill_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rubber_bills" TO "anon";
GRANT ALL ON TABLE "public"."rubber_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."rubber_bills" TO "service_role";



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































