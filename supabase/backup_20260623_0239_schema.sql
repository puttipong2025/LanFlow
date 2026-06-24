


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


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



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


CREATE OR REPLACE FUNCTION "public"."can_access_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.user_locations ul
      join public.profiles p on p.id = ul.user_id
      where ul.location_id = target_location
        and ul.user_id = public.current_profile_id()
        and p.is_active = true
    )
$$;


ALTER FUNCTION "public"."can_access_location"("target_location" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;


ALTER FUNCTION "public"."current_profile_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1 from public.profiles p
    where p.id = public.current_profile_id()
      and p.role = 'super_admin'
      and p.is_active = true
  )
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
    CONSTRAINT "money_transfers_transfer_status_check" CHECK (("transfer_status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'cancelled'::"text"])))
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


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "name" "text" NOT NULL,
    "password_hash" "text",
    "role" "public"."app_role" DEFAULT 'user'::"public"."app_role" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
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



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_client_temp_id_key" UNIQUE ("client_temp_id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



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



ALTER TABLE ONLY "public"."ocr_tickets"
    ADD CONSTRAINT "ocr_tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."ocr_tickets"
    ADD CONSTRAINT "ocr_tickets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."offline_sync_events"
    ADD CONSTRAINT "offline_sync_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."offline_sync_events"
    ADD CONSTRAINT "offline_sync_events_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."rubber_bill_items"
    ADD CONSTRAINT "rubber_bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."rubber_bills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."rubber_bills"
    ADD CONSTRAINT "rubber_bills_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



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



CREATE POLICY "audit logs insert scoped" ON "public"."audit_logs" FOR INSERT WITH CHECK ((("location_id" IS NULL) OR "public"."can_access_location"("location_id")));



CREATE POLICY "audit logs scoped" ON "public"."audit_logs" FOR SELECT USING ((("location_id" IS NULL) OR "public"."can_access_location"("location_id")));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_bank_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_bank_accounts all through customer" ON "public"."customer_bank_accounts" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_bank_accounts"."customer_id") AND (("c"."default_location_id" IS NULL) OR "public"."can_access_location"("c"."default_location_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_bank_accounts"."customer_id") AND (("c"."default_location_id" IS NULL) OR "public"."can_access_location"("c"."default_location_id"))))));



ALTER TABLE "public"."customer_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_contacts all through customer" ON "public"."customer_contacts" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_contacts"."customer_id") AND (("c"."default_location_id" IS NULL) OR "public"."can_access_location"("c"."default_location_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_contacts"."customer_id") AND (("c"."default_location_id" IS NULL) OR "public"."can_access_location"("c"."default_location_id"))))));



ALTER TABLE "public"."customer_farms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_farms all through customer" ON "public"."customer_farms" USING ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_farms"."customer_id") AND (("c"."default_location_id" IS NULL) OR "public"."can_access_location"("c"."default_location_id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."customers" "c"
  WHERE (("c"."id" = "customer_farms"."customer_id") AND (("c"."default_location_id" IS NULL) OR "public"."can_access_location"("c"."default_location_id"))))));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers delete scoped" ON "public"."customers" FOR DELETE USING ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id")));



CREATE POLICY "customers insert scoped" ON "public"."customers" FOR INSERT WITH CHECK ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id")));



CREATE POLICY "customers scoped by default location" ON "public"."customers" FOR SELECT USING ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id")));



CREATE POLICY "customers update scoped" ON "public"."customers" FOR UPDATE USING ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id"))) WITH CHECK ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id")));



CREATE POLICY "income expense location scoped" ON "public"."income_expense" USING ("public"."can_access_location"("location_id")) WITH CHECK ("public"."can_access_location"("location_id"));



ALTER TABLE "public"."income_expense" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations accessible" ON "public"."locations" FOR SELECT USING (("public"."is_super_admin"() OR "public"."can_access_location"("id")));



CREATE POLICY "locations super admin manages" ON "public"."locations" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "money transfer items scoped through transfer" ON "public"."money_transfer_items" USING ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "public"."can_access_location"("t"."location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_items"."transfer_id") AND "public"."can_access_location"("t"."location_id")))));



CREATE POLICY "money transfer slips scoped through transfer" ON "public"."money_transfer_slips" USING ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "public"."can_access_location"("t"."location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."money_transfers" "t"
  WHERE (("t"."id" = "money_transfer_slips"."transfer_id") AND "public"."can_access_location"("t"."location_id")))));



CREATE POLICY "money transfers location scoped delete" ON "public"."money_transfers" FOR DELETE USING ("public"."can_access_location"("location_id"));



CREATE POLICY "money transfers location scoped insert" ON "public"."money_transfers" FOR INSERT WITH CHECK ("public"."can_access_location"("location_id"));



CREATE POLICY "money transfers location scoped select" ON "public"."money_transfers" FOR SELECT USING ("public"."can_access_location"("location_id"));



CREATE POLICY "money transfers location scoped update" ON "public"."money_transfers" FOR UPDATE USING ("public"."can_access_location"("location_id")) WITH CHECK ("public"."can_access_location"("location_id"));



ALTER TABLE "public"."money_transfer_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."money_transfer_slips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."money_transfers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ocr tickets insert scoped" ON "public"."ocr_tickets" FOR INSERT WITH CHECK ("public"."can_access_location"("location_id"));



CREATE POLICY "ocr tickets location scoped" ON "public"."ocr_tickets" FOR SELECT USING ("public"."can_access_location"("location_id"));



CREATE POLICY "ocr tickets update scoped" ON "public"."ocr_tickets" FOR UPDATE USING ("public"."can_access_location"("location_id")) WITH CHECK ("public"."can_access_location"("location_id"));



ALTER TABLE "public"."ocr_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offline_sync_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles see own or super admin" ON "public"."profiles" FOR SELECT USING ((("id" = "public"."current_profile_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "profiles super admin manages" ON "public"."profiles" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "rubber bill items scoped through bill" ON "public"."rubber_bill_items" USING ((EXISTS ( SELECT 1
   FROM "public"."rubber_bills" "b"
  WHERE (("b"."id" = "rubber_bill_items"."bill_id") AND "public"."can_access_location"("b"."location_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."rubber_bills" "b"
  WHERE (("b"."id" = "rubber_bill_items"."bill_id") AND "public"."can_access_location"("b"."location_id")))));



CREATE POLICY "rubber bills insert scoped" ON "public"."rubber_bills" FOR INSERT WITH CHECK ("public"."can_access_location"("location_id"));



CREATE POLICY "rubber bills location scoped" ON "public"."rubber_bills" FOR SELECT USING ("public"."can_access_location"("location_id"));



CREATE POLICY "rubber bills update scoped no location change" ON "public"."rubber_bills" FOR UPDATE USING ("public"."can_access_location"("location_id")) WITH CHECK ("public"."can_access_location"("location_id"));



ALTER TABLE "public"."rubber_bill_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubber_bills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sync events scoped" ON "public"."offline_sync_events" USING ((("location_id" IS NULL) OR "public"."can_access_location"("location_id"))) WITH CHECK ((("location_id" IS NULL) OR "public"."can_access_location"("location_id")));



ALTER TABLE "public"."transport_staff_bank_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staff_bank_accounts through parent" ON "public"."transport_staff_bank_accounts" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE ("s"."id" = "transport_staff_bank_accounts"."staff_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE ("s"."id" = "transport_staff_bank_accounts"."staff_id"))));



ALTER TABLE "public"."transport_staff_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staff_contacts through parent" ON "public"."transport_staff_contacts" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE ("s"."id" = "transport_staff_contacts"."staff_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE ("s"."id" = "transport_staff_contacts"."staff_id"))));



ALTER TABLE "public"."transport_staff_plates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staff_plates through parent" ON "public"."transport_staff_plates" USING ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE ("s"."id" = "transport_staff_plates"."staff_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."transport_staffs" "s"
  WHERE ("s"."id" = "transport_staff_plates"."staff_id"))));



ALTER TABLE "public"."transport_staffs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_staffs delete scoped" ON "public"."transport_staffs" FOR DELETE USING ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id")));



CREATE POLICY "transport_staffs insert scoped" ON "public"."transport_staffs" FOR INSERT WITH CHECK ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id")));



CREATE POLICY "transport_staffs scoped by default location" ON "public"."transport_staffs" FOR SELECT USING ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id")));



CREATE POLICY "transport_staffs update scoped" ON "public"."transport_staffs" FOR UPDATE USING ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id"))) WITH CHECK ((("default_location_id" IS NULL) OR "public"."can_access_location"("default_location_id")));



CREATE POLICY "user locations super admin manages" ON "public"."user_locations" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "user locations visible" ON "public"."user_locations" FOR SELECT USING (("public"."is_super_admin"() OR ("user_id" = "public"."current_profile_id"()) OR "public"."can_access_location"("location_id")));



ALTER TABLE "public"."user_locations" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_bank_accounts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_bank_accounts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_contacts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_contacts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_farms" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customer_farms" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_farms" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customers" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."income_expense" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."income_expense" TO "authenticated";
GRANT ALL ON TABLE "public"."income_expense" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."locations" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfer_items" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfer_items" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfer_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfer_slips" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfer_slips" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfer_slips" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfers" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."money_transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."money_transfers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ocr_tickets" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ocr_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."ocr_tickets" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."offline_sync_events" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."offline_sync_events" TO "authenticated";
GRANT ALL ON TABLE "public"."offline_sync_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rubber_bill_items" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rubber_bill_items" TO "authenticated";
GRANT ALL ON TABLE "public"."rubber_bill_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rubber_bills" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rubber_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."rubber_bills" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_bank_accounts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_staff_bank_accounts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_contacts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_staff_contacts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_plates" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staff_plates" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_staff_plates" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staffs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."transport_staffs" TO "authenticated";
GRANT ALL ON TABLE "public"."transport_staffs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_locations" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_locations" TO "authenticated";
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































