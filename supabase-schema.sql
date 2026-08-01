


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



CREATE TYPE "private"."income_sale_line_input" AS (
	"income_sale_item_id" "uuid",
	"stock_product_id" "uuid",
	"title" "text",
	"quantity" numeric,
	"unit_price" numeric,
	"line_total" numeric,
	"sequence_no" integer
);


ALTER TYPE "private"."income_sale_line_input" OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "private"."apply_time_tracking_deductions"("p_profile_id" "uuid", "p_through_month" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_month date;
  v_first_month date;
  v_through_month date := date_trunc('month', p_through_month)::date;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
  v_daily_wage numeric;
  v_gross numeric;
  v_used numeric;
  v_available numeric;
  v_amount numeric;
  v_total numeric := 0;
  v_parent record;
  v_child_type public.financial_transaction_type;
  v_comment text;
begin
  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));

  if v_through_month > v_current_month then
    v_through_month := v_current_month;
  end if;

  select p.daily_wage
  into v_daily_wage
  from public.profiles p
  where p.id = p_profile_id
    and p.is_active = true;

  if not found or coalesce(v_daily_wage, 0) <= 0 then
    return jsonb_build_object('deducted', 0);
  end if;

  select min(date_trunc('month', ft.effective_date)::date)
  into v_first_month
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and ft.type in ('DEBT', 'WITHDRAWAL')
    and ft.status = 'APPROVED'
    and ft.remaining_amount > 0
    and ft.effective_date < (v_through_month + interval '1 month')::date;

  if v_first_month is null then
    return jsonb_build_object('deducted', 0);
  end if;

  for v_month in
    select generate_series(
      v_first_month::timestamp,
      v_through_month::timestamp,
      interval '1 month'
    )::date
  loop
    if exists (
      select 1
      from public.payroll_slips ps
      where ps.profile_id = p_profile_id
        and ps.month = to_char(v_month, 'YYYY-MM')
    ) then
      continue;
    end if;

    v_gross := public.calculate_paid_work_days(
      p_profile_id,
      v_month::timestamp at time zone 'Asia/Bangkok',
      (v_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
    ) * v_daily_wage;

    select coalesce(sum(ft.amount), 0)
    into v_used
    from public.financial_transactions ft
    where ft.profile_id = p_profile_id
      and ft.status = 'APPROVED'
      and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and ft.applied_month = v_month;

    v_available := greatest(trunc(v_gross - v_used, 2), 0);
    if v_available <= 0 then
      continue;
    end if;

    for v_parent in
      select ft.*
      from public.financial_transactions ft
      where ft.profile_id = p_profile_id
        and ft.type in ('DEBT', 'WITHDRAWAL')
        and ft.status = 'APPROVED'
        and ft.remaining_amount > 0
        and ft.effective_date < (v_month + interval '1 month')::date
      order by ft.effective_date, ft.created_at, ft.id
      for update
    loop
      exit when v_available <= 0;

      v_amount := trunc(least(v_parent.remaining_amount, v_available), 2);
      if v_amount <= 0 then
        continue;
      end if;

      if v_parent.type = 'DEBT' then
        v_child_type := 'DEBT_DEDUCTION';
        v_comment := 'หักหนี้อัตโนมัติ';
      else
        v_child_type := 'WITHDRAWAL_DEDUCTION';
        v_comment := 'หักยอดเบิกเงินอัตโนมัติ';
      end if;

      update public.financial_transactions
      set remaining_amount = greatest(remaining_amount - v_amount, 0)
      where id = v_parent.id;

      insert into public.financial_transactions (
        profile_id,
        type,
        amount,
        status,
        parent_debt_id,
        applied_month,
        admin_comment,
        approved_by,
        approved_at
      )
      values (
        p_profile_id,
        v_child_type,
        v_amount,
        'APPROVED',
        v_parent.id,
        v_month,
        v_comment,
        v_parent.approved_by,
        now()
      );

      insert into public.time_tracking_audit_logs (
        admin_id,
        action,
        target_table,
        record_id,
        new_data,
        comment
      )
      values (
        coalesce(v_parent.approved_by, p_profile_id),
        'AUTO_DEDUCTION',
        'financial_transactions',
        v_parent.id,
        jsonb_build_object(
          'deducted_amount', v_amount,
          'remaining_amount', greatest(v_parent.remaining_amount - v_amount, 0),
          'type', v_child_type,
          'applied_month', v_month
        ),
        v_comment
      );

      v_parent.remaining_amount := greatest(v_parent.remaining_amount - v_amount, 0);
      v_available := trunc(v_available - v_amount, 2);
      v_total := v_total + v_amount;
    end loop;
  end loop;

  return jsonb_build_object('deducted', v_total);
end;
$$;


ALTER FUNCTION "private"."apply_time_tracking_deductions"("p_profile_id" "uuid", "p_through_month" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."assert_user_primary_location"("target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_assignment_count integer;
  v_primary_count integer;
begin
  if target_user_id is null then return; end if;
  select count(*), count(*) filter (where ul.is_primary)
  into v_assignment_count, v_primary_count
  from public.user_locations ul
  where ul.user_id = target_user_id;

  if v_assignment_count > 0 and v_primary_count <> 1 then
    raise exception 'PRIMARY_LOCATION_REQUIRED';
  end if;
end
$$;


ALTER FUNCTION "private"."assert_user_primary_location"("target_user_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "private"."calculate_dashboard_summary"("p_location_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with bounds as (
    select
      (current_timestamp at time zone 'Asia/Bangkok')::date as today,
      (current_timestamp at time zone 'Asia/Bangkok')::date - 6 as from_date
  ),
  active_bills as (
    select b.*
    from public.rubber_bills b
    where b.location_id = p_location_id
      and b.record_status = 'active'
  ),
  payable_bills as (
    select b.*
    from active_bills b
    where private.rubber_bill_is_payable(b.id)
  ),
  purchase_stats as (
    select
      count(*) filter (where b.bill_date = d.today) as today_bill_count,
      coalesce(sum(b.net_weight) filter (where b.bill_date = d.today), 0) as today_net_weight,
      coalesce(sum(b.net_total) filter (
        where b.bill_date = d.today
          and private.rubber_bill_is_payable(b.id)
      ), 0) as today_paid_total,
      coalesce(sum(b.net_weight) filter (
        where b.bill_date between d.from_date and d.today
          and private.rubber_bill_is_payable(b.id)
      ), 0) as seven_day_net_weight,
      coalesce(sum(b.net_total) filter (
        where b.bill_date between d.from_date and d.today
          and private.rubber_bill_is_payable(b.id)
      ), 0) as seven_day_paid_total,
      coalesce(sum(b.net_weight), 0) as accumulated_net_weight
    from active_bills b
    cross join bounds d
  ),
  payable_total as (
    select coalesce(sum(b.net_total), 0) as accumulated_purchase
    from payable_bills b
  ),
  export_stats as (
    select
      coalesce(sum(e.original_weight_total) filter (where e.status = 'verified'), 0)
        as accumulated_original_weight,
      count(*) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ) as seven_day_export_count,
      coalesce(sum(e.original_weight_total - e.current_weight) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ), 0) as seven_day_loss_weight,
      coalesce(sum(e.original_weight_total) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ), 0) as seven_day_original_weight
    from public.rubber_exports e
    cross join bounds d
    where e.location_id = p_location_id
  ),
  stock_balances as (
    select
      p.id,
      p.name,
      p.unit,
      round(coalesce(sum(m.quantity_delta), 0), 2) as balance
    from public.stock_products p
    left join public.stock_movements m
      on m.product_id = p.id
     and m.location_id = p_location_id
    where p.is_active = true
    group by p.id, p.name, p.unit
  ),
  stock_summary as (
    select
      count(*) filter (where balance > 0) as in_stock_count,
      count(*) filter (where balance <= 0) as out_of_stock_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'productId', id,
            'name', name,
            'unit', unit,
            'balance', balance
          )
          order by (balance <= 0) desc, name, id
        ),
        '[]'::jsonb
      ) as items
    from stock_balances
  ),
  financial_amounts as (
    select
      ie.type::text as direction,
      ie.cost as amount,
      true as affects_balance,
      ie.type = 'expense' as operating_expense
    from public.income_expense ie
    where ie.location_id = p_location_id
      and ie.record_status = 'active'
      and ie.cost > 0

    union all

    select 'income', mt.net_amount_to_pay, true, false
    from public.money_transfers mt
    where mt.transfer_type = 'branch'
      and coalesce(mt.transfer_method, 'bank') <> 'cash'
      and mt.target_location_id = p_location_id
      and mt.record_status <> 'deleted'
      and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
      and mt.net_amount_to_pay > 0

    union all

    select 'expense', mt.net_amount_to_pay, true, false
    from public.money_transfers mt
    where mt.transfer_type = 'branch'
      and coalesce(mt.transfer_method, 'bank') <> 'cash'
      and mt.location_id = p_location_id
      and mt.target_location_id <> mt.location_id
      and mt.record_status <> 'deleted'
      and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
      and mt.net_amount_to_pay > 0

    union all

    select 'expense', mt.branch_paid_amount, true, false
    from public.money_transfers mt
    where mt.transfer_type = 'customer'
      and mt.transfer_status = 'branch_and_transfer'
      and mt.location_id = p_location_id
      and mt.record_status <> 'deleted'
      and mt.branch_paid_amount > 0

    union all

    select 'expense', d.sent_total, true, false
    from public.money_transfers mt
    join public.money_transfer_cash_details d on d.transfer_id = mt.id
    where mt.transfer_type = 'cash'
      and mt.transfer_method = 'cash'
      and mt.location_id = p_location_id
      and mt.record_status <> 'deleted'
      and d.sent_total > 0

    union all

    select 'income', d.received_total, true, false
    from public.money_transfers mt
    join public.money_transfer_cash_details d on d.transfer_id = mt.id
    where mt.transfer_type = 'cash'
      and mt.transfer_method = 'cash'
      and mt.target_location_id = p_location_id
      and mt.record_status <> 'deleted'
      and d.cash_status in ('received', 'mismatched', 'difference_accepted')
      and d.received_total > 0

    union all

    select 'expense', ft.amount, true, true
    from public.financial_transactions ft
    where ft.type = 'WITHDRAWAL'
      and ft.status = 'APPROVED'
      and ft.cancelled_at is null
      and ft.expense_location_id = p_location_id
      and ft.amount > 0

    union all

    select 'expense', ps.net_pay, true, true
    from public.payroll_slips ps
    where ps.status = 'APPROVED'
      and ps.cancelled_at is null
      and ps.expense_location_id = p_location_id
      and ps.net_pay > 0

    union all

    select
      'expense',
      b.net_total,
      not exists (
        select 1
        from public.money_transfer_items i
        where i.source_type = 'rubber_bill'
          and i.source_id = b.id
      ),
      false
    from payable_bills b

    union all

    select
      'expense',
      ot.total_amount,
      not exists (
        select 1
        from public.money_transfer_items i
        where i.source_type = 'ocr_ticket'
          and i.source_id = ot.id
      ),
      false
    from public.ocr_tickets ot
    where ot.location_id = p_location_id
      and ot.record_status = 'active'
      and ot.total_amount > 0

    union all

    select 'expense', e.work_total, true, true
    from public.rubber_exports e
    where e.location_id = p_location_id
      and e.status = 'verified'
      and e.expense_destination = 'branch'
      and e.work_total > 0
  ),
  financial_totals as (
    select
      coalesce(sum(
        case
          when not affects_balance then 0
          when direction = 'income' then amount
          else -amount
        end
      ), 0) as net_cash_flow,
      coalesce(sum(amount) filter (where operating_expense), 0)
        as operating_expense
    from financial_amounts
  )
  select jsonb_build_object(
    'purchaseToday', jsonb_build_object(
      'billCount', ps.today_bill_count,
      'netWeight', round(ps.today_net_weight, 2),
      'paidTotal', round(ps.today_paid_total, 2)
    ),
    'purchase7Days', jsonb_build_object(
      'paidTotal', round(ps.seven_day_paid_total, 2),
      'dailyAverage', round(ps.seven_day_paid_total / 7, 2),
      'netWeight', round(ps.seven_day_net_weight, 2),
      'averageCostPerKg', case
        when ps.seven_day_net_weight > 0
          then round(ps.seven_day_paid_total / ps.seven_day_net_weight, 2)
        else null
      end
    ),
    'netCashFlow', round(ft.net_cash_flow, 2),
    'operatingExpenseAccumulated', round(ft.operating_expense, 2),
    'payablePurchaseAccumulated', round(pt.accumulated_purchase, 2),
    'operatingBurdenPercent', case
      when pt.accumulated_purchase > 0
        then round(ft.operating_expense / pt.accumulated_purchase * 100, 2)
      else null
    end,
    'rubberInventoryWeight', round(
      ps.accumulated_net_weight - es.accumulated_original_weight,
      2
    ),
    'waterLoss7Days', jsonb_build_object(
      'exportCount', es.seven_day_export_count,
      'weight', round(es.seven_day_loss_weight, 2),
      'percent', case
        when es.seven_day_original_weight > 0
          then round(es.seven_day_loss_weight / es.seven_day_original_weight * 100, 2)
        else null
      end
    ),
    'stock', jsonb_build_object(
      'inStockCount', ss.in_stock_count,
      'outOfStockCount', ss.out_of_stock_count,
      'items', ss.items
    )
  )
  from purchase_stats ps
  cross join payable_total pt
  cross join export_stats es
  cross join stock_summary ss
  cross join financial_totals ft
$$;


ALTER FUNCTION "private"."calculate_dashboard_summary"("p_location_id" "uuid") OWNER TO "postgres";


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
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.role in ('user', 'admin')
        and p.can_access_money_transfer = true
    )
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
  select private.can_manage_time_payroll_profile(target_profile_id)
$$;


ALTER FUNCTION "private"."can_approve_time_tracking_profile"("target_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_assign_time_tracking_expense_location"("target_location" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.has_time_payroll_manager_access()
    and target_location is not null
    and exists (
      select 1 from public.locations l
      where l.id = target_location and l.is_active = true
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


CREATE OR REPLACE FUNCTION "private"."can_manage_time_payroll_profile"("target_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_active_user()
    and exists (
      select 1
      from public.profiles target
      where target.id = target_profile_id
        and target.is_active = true
        and (
          private.can_access_super_admin_features()
          or (
            target.role in ('user', 'admin')
            and target.can_access_super_admin_features = false
            and exists (
              select 1
              from public.user_locations target_primary
              join public.locations target_location
                on target_location.id = target_primary.location_id
               and target_location.is_active = true
              join public.user_locations actor_location
                on actor_location.location_id = target_primary.location_id
               and actor_location.user_id = auth.uid()
              where target_primary.user_id = target_profile_id
                and target_primary.is_primary = true
            )
            and exists (
              select 1 from public.profiles actor
              where actor.id = auth.uid()
                and actor.role in ('user', 'admin')
                and actor.can_manage_time_payroll = true
            )
          )
        )
    )
$$;


ALTER FUNCTION "private"."can_manage_time_payroll_profile"("target_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_view_profile"("target_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_active_user()
    and (
      target_user = auth.uid()
      or private.can_access_super_admin_features()
      or private.can_manage_time_payroll_profile(target_user)
      or (
        private.current_user_role() = 'admin'
        and exists (
          select 1
          from public.user_locations mine
          join public.user_locations theirs on theirs.location_id = mine.location_id
          where mine.user_id = auth.uid() and theirs.user_id = target_user
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


CREATE OR REPLACE FUNCTION "private"."claim_dashboard_branch"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  branch_id uuid;
  refresh_minutes integer;
begin
  perform private.dashboard_rollover_if_needed();

  update public.dashboard_branch_snapshots
  set status = 'failed',
      claimed_version = null,
      claimed_at = null,
      last_error = 'งานคำนวณก่อนหน้าไม่สิ้นสุด',
      updated_at = now()
  where status = 'running'
    and claimed_at < now() - interval '15 minutes';

  select s.interval_minutes
  into refresh_minutes
  from public.dashboard_refresh_settings s
  where s.id = true;

  select snapshot.location_id
  into branch_id
  from public.dashboard_branch_snapshots snapshot
  join public.locations l
    on l.id = snapshot.location_id
   and l.is_active = true
  where snapshot.status = 'queued'
     or (
       snapshot.status = 'dirty'
       and (
         snapshot.summary is null
         or snapshot.updated_at <= now() - make_interval(mins => refresh_minutes)
       )
     )
     or (
       snapshot.status = 'failed'
       and snapshot.updated_at <= now() - make_interval(mins => refresh_minutes)
     )
  order by
    (snapshot.status = 'queued') desc,
    (snapshot.summary is null) desc,
    snapshot.updated_at,
    snapshot.location_id
  for update of snapshot skip locked
  limit 1;

  if branch_id is null then
    return null;
  end if;

  update public.dashboard_branch_snapshots
  set status = 'running',
      claimed_version = source_version,
      claimed_at = now(),
      last_error = null,
      updated_at = now()
  where location_id = branch_id;

  return branch_id;
end;
$$;


ALTER FUNCTION "private"."claim_dashboard_branch"() OWNER TO "postgres";


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
    'configuredPriceSnapshot', b.configured_price_snapshot,
    'billType', b.bill_type,
    'deductWeight', b.deduct_weight,
    'weight', b.weight,
    'rubberValue', b.rubber_value,
    'averagePrice', b.average_price,
    'deductionTotal', b.deduction_total,
    'netTotal', b.net_total,
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


CREATE OR REPLACE FUNCTION "private"."dashboard_dirty_all_active_locations"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  location_id uuid;
begin
  for location_id in
    select l.id
    from public.locations l
    where l.is_active = true
  loop
    perform private.mark_dashboard_dirty(location_id);
  end loop;
  return null;
end;
$$;


ALTER FUNCTION "private"."dashboard_dirty_all_active_locations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."dashboard_dirty_location_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  old_row jsonb;
  new_row jsonb;
  location_ids uuid[] := array[]::uuid[];
  column_name text;
  location_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_row := to_jsonb(new);
  end if;

  foreach column_name in array tg_argv loop
    if old_row is not null then
      location_id := nullif(old_row ->> column_name, '')::uuid;
      if location_id is not null
        and array_position(location_ids, location_id) is null
      then
        location_ids := array_append(location_ids, location_id);
      end if;
    end if;

    if new_row is not null then
      location_id := nullif(new_row ->> column_name, '')::uuid;
      if location_id is not null
        and array_position(location_ids, location_id) is null
      then
        location_ids := array_append(location_ids, location_id);
      end if;
    end if;
  end loop;

  foreach location_id in array location_ids loop
    perform private.mark_dashboard_dirty(location_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."dashboard_dirty_location_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."dashboard_dirty_money_transfer_dependents"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  old_row jsonb;
  new_row jsonb;
  transfer_ids uuid[] := array[]::uuid[];
  source_refs jsonb[] := array[]::jsonb[];
  transfer_id uuid;
  source_ref jsonb;
  location_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_row := to_jsonb(new);
  end if;

  if old_row is not null then
    transfer_id := nullif(old_row ->> 'transfer_id', '')::uuid;
    if transfer_id is not null then
      transfer_ids := array_append(transfer_ids, transfer_id);
    end if;
    if old_row ? 'source_type' and old_row ? 'source_id' then
      source_refs := array_append(
        source_refs,
        jsonb_build_object(
          'type', old_row ->> 'source_type',
          'id', old_row ->> 'source_id'
        )
      );
    end if;
  end if;

  if new_row is not null then
    transfer_id := nullif(new_row ->> 'transfer_id', '')::uuid;
    if transfer_id is not null
      and array_position(transfer_ids, transfer_id) is null
    then
      transfer_ids := array_append(transfer_ids, transfer_id);
    end if;
    if new_row ? 'source_type' and new_row ? 'source_id' then
      source_ref := jsonb_build_object(
        'type', new_row ->> 'source_type',
        'id', new_row ->> 'source_id'
      );
      if array_position(source_refs, source_ref) is null then
        source_refs := array_append(source_refs, source_ref);
      end if;
    end if;
  end if;

  for location_id in
    select distinct branch_id
    from (
      select mt.location_id as branch_id
      from public.money_transfers mt
      where mt.id = any(transfer_ids)
      union
      select mt.target_location_id
      from public.money_transfers mt
      where mt.id = any(transfer_ids)
    ) branches
    where branch_id is not null
  loop
    perform private.mark_dashboard_dirty(location_id);
  end loop;

  foreach source_ref in array source_refs loop
    if source_ref ->> 'type' = 'rubber_bill' then
      select b.location_id
      into location_id
      from public.rubber_bills b
      where b.id = nullif(source_ref ->> 'id', '')::uuid;
    elsif source_ref ->> 'type' = 'ocr_ticket' then
      select t.location_id
      into location_id
      from public.ocr_tickets t
      where t.id = nullif(source_ref ->> 'id', '')::uuid;
    else
      location_id := null;
    end if;

    perform private.mark_dashboard_dirty(location_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."dashboard_dirty_money_transfer_dependents"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."dashboard_dirty_rubber_bill_items"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  bill_ids uuid[] := array[]::uuid[];
  location_id uuid;
begin
  if tg_op <> 'INSERT' and old.bill_id is not null then
    bill_ids := array_append(bill_ids, old.bill_id);
  end if;
  if tg_op <> 'DELETE'
    and new.bill_id is not null
    and array_position(bill_ids, new.bill_id) is null
  then
    bill_ids := array_append(bill_ids, new.bill_id);
  end if;

  for location_id in
    select distinct b.location_id
    from public.rubber_bills b
    where b.id = any(bill_ids)
  loop
    perform private.mark_dashboard_dirty(location_id);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."dashboard_dirty_rubber_bill_items"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."dashboard_require_manager"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
  then
    raise exception 'ไม่มีสิทธิ์จัดการ Dashboard';
  end if;
end;
$$;


ALTER FUNCTION "private"."dashboard_require_manager"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."dashboard_rollover_if_needed"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  changed boolean := false;
  next_version bigint := pg_catalog.txid_current();
begin
  insert into public.dashboard_refresh_settings (id)
  values (true)
  on conflict (id) do nothing;

  insert into public.dashboard_branch_snapshots (location_id)
  select l.id
  from public.locations l
  where l.is_active = true
  on conflict (location_id) do nothing;

  insert into public.dashboard_alert_thresholds (location_id)
  select l.id
  from public.locations l
  where l.is_active = true
  on conflict (location_id) do nothing;

  update public.dashboard_refresh_settings
  set last_rollover_date = today,
      updated_at = now()
  where id = true
    and last_rollover_date < today
  returning true into changed;

  if not coalesce(changed, false) then
    return false;
  end if;

  update public.dashboard_branch_snapshots
  set status = case
        when dashboard_branch_snapshots.status in ('queued', 'running')
          then dashboard_branch_snapshots.status
        else 'dirty'
      end,
      source_version = greatest(
        dashboard_branch_snapshots.source_version + 1,
        next_version
      ),
      updated_at = now()
  where location_id in (
    select l.id
    from public.locations l
    where l.is_active = true
  );

  return true;
end;
$$;


ALTER FUNCTION "private"."dashboard_rollover_if_needed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."dashboard_seed_active_location"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' and new.is_active = true then
    perform private.mark_dashboard_dirty(new.id);
  elsif new.is_active = true
    and old.is_active is distinct from new.is_active
  then
    perform private.mark_dashboard_dirty(new.id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."dashboard_seed_active_location"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."default_first_user_location_primary"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform pg_advisory_xact_lock(hashtextextended('user-locations:' || new.user_id::text, 0));
  if not new.is_primary and not exists (
    select 1 from public.user_locations ul where ul.user_id = new.user_id
  ) then
    new.is_primary := true;
  end if;
  return new;
end
$$;


ALTER FUNCTION "private"."default_first_user_location_primary"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "private"."enforce_user_primary_location"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform private.assert_user_primary_location(old.user_id);
  end if;
  perform private.assert_user_primary_location(coalesce(new.user_id, old.user_id));
  return null;
end
$$;


ALTER FUNCTION "private"."enforce_user_primary_location"() OWNER TO "postgres";


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

  if not private.rubber_bill_is_payable(v_bill_id) then
    raise exception 'บิลยางยังมีรายการราคา 0 หรือยอดสุทธิไม่มากกว่า 0 จึงนำไปทำรายงานหรือโอนเงินไม่ได้';
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
    old.original_weight_total,
    old.paid_total,
    old.average_price,
    old.created_by_user_id,
    old.created_at
  ) then
    raise exception 'ข้อมูลสมาชิกและ snapshot ของรายการส่งออกแก้ไขไม่ได้';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_rubber_export_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."has_time_payroll_manager_access"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.is_active_user()
    and (
      private.can_access_super_admin_features()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('user', 'admin')
          and p.can_manage_time_payroll = true
      )
    )
$$;


ALTER FUNCTION "private"."has_time_payroll_manager_access"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "private"."is_time_payroll_manager"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select private.has_time_payroll_manager_access()
$$;


ALTER FUNCTION "private"."is_time_payroll_manager"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."mark_dashboard_dirty"("p_location_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  next_version bigint := pg_catalog.txid_current();
begin
  if p_location_id is null or not exists (
    select 1
    from public.locations l
    where l.id = p_location_id
      and l.is_active = true
  ) then
    return;
  end if;

  insert into public.dashboard_branch_snapshots (
    location_id,
    status,
    source_version
  )
  values (
    p_location_id,
    'dirty',
    next_version
  )
  on conflict (location_id) do update
  set status = case
        when dashboard_branch_snapshots.status in ('queued', 'running')
          then dashboard_branch_snapshots.status
        else 'dirty'
      end,
      source_version = excluded.source_version,
      updated_at = now()
  where dashboard_branch_snapshots.source_version < excluded.source_version;

  insert into public.dashboard_alert_thresholds (location_id)
  values (p_location_id)
  on conflict (location_id) do nothing;
end;
$$;


ALTER FUNCTION "private"."mark_dashboard_dirty"("p_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."normalize_income_sale_lines"("payload" "jsonb") RETURNS TABLE("income_sale_item_id" "uuid", "stock_product_id" "uuid", "title" "text", "quantity" numeric, "unit_price" numeric, "line_total" numeric, "sequence_no" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select
    item.id,
    item.stock_product_id,
    item.name,
    parsed.quantity,
    parsed.unit_price,
    round(parsed.quantity * parsed.unit_price, 2),
    parsed.sequence_no
  from (
    select
      nullif(line.value->>'incomeSaleItemId', '')::uuid as income_sale_item_id,
      nullif(line.value->>'quantity', '')::numeric as quantity,
      nullif(line.value->>'unitPrice', '')::numeric as unit_price,
      line.ordinality::integer as sequence_no
    from jsonb_array_elements(payload->'saleLines') with ordinality as line(value, ordinality)
  ) parsed
  join public.income_sale_items item
    on item.id = parsed.income_sale_item_id
   and item.is_active = true
   and item.stock_product_id is not null;
$$;


ALTER FUNCTION "private"."normalize_income_sale_lines"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."normalize_rubber_bill_calculation_payload"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_operation text := payload->>'operation';
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_item_type text;
  v_in_weight numeric;
  v_out_weight numeric;
  v_row_weight numeric;
  v_price numeric;
  v_quantity numeric;
  v_line_value numeric;
  v_total_weight numeric := 0;
  v_total_weigh_value numeric := 0;
  v_money_deduction_raw numeric := 0;
  v_deduct_weight numeric;
  v_net_weight numeric;
  v_average_price numeric;
  v_net_rubber_value numeric;
  v_deduction_total numeric;
  v_payable_before_rounding numeric;
  v_weigh_count integer := 0;
begin
  if v_operation not in ('create', 'update') then
    return payload;
  end if;

  if jsonb_typeof(payload->'items') <> 'array' then
    raise exception 'items must be an array';
  end if;

  v_deduct_weight := coalesce(nullif(payload->>'deductWeight', '')::numeric, 0);
  if v_deduct_weight < 0 or v_deduct_weight <> round(v_deduct_weight, 2) then
    raise exception 'deductWeight must be non-negative with at most 2 decimal places';
  end if;

  for v_item in
    select value from jsonb_array_elements(payload->'items')
  loop
    v_item_type := v_item->>'itemType';

    if v_item_type = 'weigh' then
      v_in_weight := nullif(v_item->>'inWeight', '')::numeric;
      v_out_weight := nullif(v_item->>'outWeight', '')::numeric;

      if v_in_weight is not null and v_out_weight is not null then
        if v_in_weight < 0 or v_out_weight < 0 then
          raise exception 'weigh-row weights must be non-negative';
        end if;
        if v_in_weight <> round(v_in_weight, 2)
           or v_out_weight <> round(v_out_weight, 2) then
          raise exception 'weigh-row weights must have at most 2 decimal places';
        end if;
        v_row_weight := v_in_weight - v_out_weight;
      else
        v_row_weight := nullif(v_item->>'netWeight', '')::numeric;
        if v_row_weight is null or v_row_weight <> round(v_row_weight, 2) then
          raise exception 'weigh-row net weight must have at most 2 decimal places';
        end if;
      end if;

      v_price := nullif(v_item->>'unitPrice', '')::numeric;
      if v_row_weight <= 0 then
        raise exception 'weigh-row net weight must be positive';
      end if;
      if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then
        raise exception 'weigh-row price must be non-negative with at most 2 decimal places';
      end if;

      v_row_weight := round(v_row_weight, 2);
      v_line_value := v_row_weight * v_price;
      v_total_weight := v_total_weight + v_row_weight;
      v_total_weigh_value := v_total_weigh_value + v_line_value;
      v_weigh_count := v_weigh_count + 1;
      v_item := v_item || jsonb_build_object(
        'netWeight', v_row_weight,
        'totalAmount', round(v_line_value, 2)
      );

    elsif v_item_type in ('acid', 'stock_deduction') then
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
      v_price := nullif(v_item->>'unitPrice', '')::numeric;
      if v_quantity is null
         or v_quantity <= 0
         or v_quantity <> round(v_quantity, 2)
         or v_price is null
         or v_price < 0
         or v_price <> round(v_price, 2) then
        raise exception 'stock deductions must use non-negative values with at most 2 decimal places';
      end if;

      v_line_value := v_quantity * v_price;
      v_money_deduction_raw := v_money_deduction_raw + v_line_value;
      v_item := v_item || jsonb_build_object(
        'totalAmount', round(v_line_value, 2)
      );

    elsif v_item_type = 'debt' then
      v_line_value := nullif(v_item->>'totalAmount', '')::numeric;
      if v_line_value is null
         or v_line_value < 0
         or v_line_value <> round(v_line_value, 2) then
        raise exception 'debt deductions must be non-negative with at most 2 decimal places';
      end if;
      v_money_deduction_raw := v_money_deduction_raw + v_line_value;
      v_item := v_item || jsonb_build_object(
        'totalAmount', round(v_line_value, 2)
      );
    end if;

    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  if v_weigh_count = 0 or v_total_weight <= 0 then
    raise exception 'at least one positive weigh row is required';
  end if;
  if v_deduct_weight >= v_total_weight then
    raise exception 'deductWeight must be less than total weight';
  end if;

  v_total_weight := round(v_total_weight, 2);
  v_total_weigh_value := round(v_total_weigh_value, 4);
  v_net_weight := trunc(v_total_weight - v_deduct_weight, 2);
  v_average_price := round(v_total_weigh_value / v_total_weight, 2);
  v_net_rubber_value := round(
    v_total_weigh_value * v_net_weight / v_total_weight,
    2
  );
  v_deduction_total := round(v_money_deduction_raw, 2);
  v_payable_before_rounding := greatest(
    v_net_rubber_value - v_deduction_total,
    0
  );

  return payload || jsonb_build_object(
    'items', v_items,
    'weight', v_total_weight,
    'netWeight', v_net_weight,
    'rubberValue', v_total_weigh_value,
    'netRubberValue', v_net_rubber_value,
    'averagePrice', v_average_price,
    'deductionTotal', v_deduction_total,
    'payableBeforeRounding', v_payable_before_rounding,
    'netTotal', floor(v_payable_before_rounding)
  );
end;
$$;


ALTER FUNCTION "private"."normalize_rubber_bill_calculation_payload"("payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "private"."normalize_rubber_bill_calculation_payload"("payload" "jsonb") IS 'Recalculates Rubber Bill source values from item inputs using the same fixed two-decimal contract as the offline browser.';



CREATE OR REPLACE FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
begin
  if current_setting('app.time_tracking_permanent_delete_rpc', true) = 'true' then
    return old;
  end if;

  if tg_table_name = 'financial_transactions' then
    if old.type = 'WITHDRAWAL'
      and old.status = 'APPROVED'
      and old.expense_location_id is not null then
      raise exception 'Approved withdrawal must be permanently deleted through the time tracking RPC';
    end if;
  elsif tg_table_name = 'payroll_slips' then
    if old.status = 'APPROVED'
      and old.net_pay > 0
      and old.expense_location_id is not null then
      raise exception 'Approved payroll slip must be permanently deleted through the time tracking RPC';
    end if;
  end if;

  return old;
end;
$$;


ALTER FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."prevent_location_code_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if old.code is distinct from new.code then
    raise exception 'BRANCH_CODE_IMMUTABLE'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."prevent_location_code_change"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "private"."rebuild_dashboard_branch"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  branch_id uuid;
  claim_version bigint;
  next_summary jsonb;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('lanflow-dashboard-rebuild')
  ) then
    return null;
  end if;

  select snapshot.location_id, snapshot.claimed_version
  into branch_id, claim_version
  from public.dashboard_branch_snapshots snapshot
  join public.locations l
    on l.id = snapshot.location_id
   and l.is_active = true
  where snapshot.status = 'running'
  order by snapshot.claimed_at, snapshot.location_id
  limit 1;

  if branch_id is null then
    return null;
  end if;

  begin
    next_summary := private.calculate_dashboard_summary(branch_id);

    update public.dashboard_branch_snapshots
    set summary = next_summary,
        calculated_at = now(),
        snapshot_version = claim_version,
        status = case
          when source_version = claim_version then 'ready'
          else 'dirty'
        end,
        claimed_version = null,
        claimed_at = null,
        manual_requested_at = null,
        last_error = null,
        updated_at = now()
    where location_id = branch_id
      and status = 'running'
      and claimed_version = claim_version;
  exception when others then
    update public.dashboard_branch_snapshots
    set status = 'failed',
        claimed_version = null,
        claimed_at = null,
        last_error = 'คำนวณ Dashboard ไม่สำเร็จ',
        updated_at = now()
    where location_id = branch_id
      and status = 'running'
      and claimed_version = claim_version;
  end;

  return branch_id;
end;
$$;


ALTER FUNCTION "private"."rebuild_dashboard_branch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."report_income_expense_period_rows"("p_report_id" "uuid") RETURNS TABLE("tx_date" "date", "number" "text", "entry_type" "text", "title" "text", "amount" numeric, "sort_key" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select
    e.tx_date,
    coalesce(e.number, e.server_bill_no, e.local_bill_no),
    e.type::text,
    e.title,
    e.cost,
    '10-' || e.id::text
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
    and p.net_pay > 0;
$$;


ALTER FUNCTION "private"."report_income_expense_period_rows"("p_report_id" "uuid") OWNER TO "postgres";


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
      and private.rubber_bill_is_payable(b.id)

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
      and m.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')

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
      and m.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')

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


CREATE OR REPLACE FUNCTION "private"."rubber_bill_is_payable"("p_bill_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select exists (
    select 1
    from public.rubber_bills b
    where b.id = p_bill_id
      and b.record_status = 'active'
      and b.sync_status = 'synced'
      and b.server_bill_no is not null
      and b.net_total > 0
      and exists (
        select 1
        from public.rubber_bill_items i
        where i.bill_id = b.id
          and i.item_type = 'weigh'
      )
      and not exists (
        select 1
        from public.rubber_bill_items i
        where i.bill_id = b.id
          and i.item_type = 'weigh'
          and coalesce(i.price, 0) <= 0
      )
  );
$$;


ALTER FUNCTION "private"."rubber_bill_is_payable"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."rubber_bill_report_blockers"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) RETURNS TABLE("blocker_type" "text", "blocker_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select 'zero_price'::text, b.id
  from public.rubber_bills b
  where b.location_id = p_location_id
    and b.record_status = 'active'
    and b.created_at <= p_cutoff_at
    and not private.rubber_bill_has_pending_approval(b.id)
    and exists (
      select 1
      from public.rubber_bill_items i
      where i.bill_id = b.id
        and i.item_type = 'weigh'
        and coalesce(i.price, 0) <= 0
    )

  union all

  select
    case when r.operation = 'create' then 'pending_create' else 'pending_change' end,
    r.id
  from public.rubber_bill_approval_requests r
  where r.location_id = p_location_id
    and r.request_status = 'pending'
    and r.requested_at <= p_cutoff_at
$$;


ALTER FUNCTION "private"."rubber_bill_report_blockers"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."rubber_export_candidates"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) RETURNS TABLE("report_item_id" "uuid", "bill_id" "uuid", "bill_date" "date", "bill_no" "text", "customer_name" "text", "eligibility_at" timestamp with time zone, "net_weight" numeric, "paid_amount" numeric)
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
    b.net_weight,
    round(b.net_total, 2)
  from public.report_items i
  join public.report_batches r on r.id = i.report_id
  join public.rubber_bills b on b.id = i.entity_id
  where i.location_id = p_location_id
    and i.entity_type = 'rubber_bill'
    and i.active = true
    and (
      p_selected_report_item_ids is null
      or i.id = any(p_selected_report_item_ids)
    )
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


ALTER FUNCTION "private"."rubber_export_candidates"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_income_sale_bill"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_operation text := payload->>'operation';
  v_expected_revision integer;
  v_client_temp_id text := payload->>'clientTempId';
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
  v_idempotency_key text := payload->>'idempotencyKey';
  v_bill_option text := payload->>'billOption';
  v_row public.income_expense%rowtype;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;
  v_internal_bypass boolean;
  v_line_count integer;
  v_total numeric;
  v_title text;
  v_keyword_id uuid;
  v_threshold numeric;
  v_threshold_scope text;
  v_date text;
  v_next_seq integer;
  v_server_bill_no text;
  v_product_id uuid;
  v_current_balance numeric;
  v_old_quantity numeric;
  v_new_quantity numeric;
  v_lines_json jsonb;
  v_lines private.income_sale_line_input[];
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;
  if coalesce(v_client_temp_id, '') = '' or coalesce(v_idempotency_key, '') = '' or v_location_id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ข้อมูลระบุตัวบิลขายไม่ครบ');
  end if;

  v_expected_revision := nullif(payload->>'expectedRevisionNo', '')::integer;
  v_internal_bypass := coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true';

  perform pg_advisory_xact_lock(hashtext('income_expense:' || v_client_temp_id));
  select *
    into v_row
  from public.income_expense
  where client_temp_id = v_client_temp_id
  for update;

  if v_row.id is not null then
    if v_row.bill_option <> 'บิลขาย' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการเดิมไม่ใช่บิลขาย');
    end if;
    if v_row.location_id <> v_location_id then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่สามารถย้ายบิลขายข้ามสาขาได้');
    end if;
  end if;
  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_row.id is not null and v_idempotency_key = v_row.idempotency_key then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', line.id,
        'incomeSaleItemId', line.income_sale_item_id,
        'stockProductId', line.stock_product_id,
        'title', line.title,
        'quantity', line.quantity,
        'unitPrice', line.unit_price,
        'lineTotal', line.line_total,
        'sequenceNo', line.sequence_no
      ) order by line.sequence_no
    ), '[]'::jsonb)
      into v_lines_json
    from public.income_expense_sale_lines line
    where line.income_expense_id = v_row.id;

    return jsonb_build_object(
      'status', 'synced',
      'id', v_row.id,
      'serverBillNo', v_row.server_bill_no,
      'revisionNo', v_row.revision_no,
      'serverReceivedAt', v_row.server_received_at,
      'title', v_row.title,
      'cost', v_row.cost,
      'saleLineCount', jsonb_array_length(v_lines_json),
      'saleLines', v_lines_json
    );
  end if;

  if v_operation = 'create' and v_row.id is not null then
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
  end if;
  if v_operation in ('update', 'delete') and v_row.id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
  end if;
  if v_row.id is not null then
    if v_row.record_status <> 'active' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'บิลขายนี้ถูกลบแล้ว');
    end if;
    if v_row.revision_no <> coalesce(v_expected_revision, v_row.revision_no) then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
    end if;
  end if;

  if v_operation <> 'delete' and v_bill_option <> 'บิลขาย' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่สามารถเปลี่ยนประเภทบิลขายได้');
  end if;
  if v_operation <> 'delete' and payload->>'type' <> 'income' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องเป็นรายรับ');
  end if;

  if v_operation = 'delete' then
    select array_agg(row(
      line.income_sale_item_id,
      line.stock_product_id,
      line.title,
      line.quantity,
      line.unit_price,
      line.line_total,
      line.sequence_no
    )::private.income_sale_line_input order by line.sequence_no)
      into v_lines
    from public.income_expense_sale_lines line
    where line.income_expense_id = v_row.id;
  else
    if jsonb_typeof(payload->'saleLines') <> 'array' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องมีรายการสินค้า');
    end if;
    v_line_count := jsonb_array_length(payload->'saleLines');
    if v_line_count < 1 or v_line_count > 50 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องมี 1 ถึง 50 รายการ');
    end if;

    select array_agg(row(
      line.income_sale_item_id,
      line.stock_product_id,
      line.title,
      line.quantity,
      line.unit_price,
      line.line_total,
      line.sequence_no
    )::private.income_sale_line_input order by line.sequence_no)
      into v_lines
    from private.normalize_income_sale_lines(payload) line;

    if coalesce(cardinality(v_lines), 0) <> v_line_count then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการบิลขายไม่ตรงกับสินค้าที่เปิดใช้งาน');
    end if;
    if exists (
      select 1
      from unnest(v_lines) line
      where quantity <= 0
         or quantity <> trunc(quantity)
         or unit_price <= 0
         or unit_price <> round(unit_price, 2)
    ) then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนต้องเป็นจำนวนเต็มมากกว่า 0 และราคามีทศนิยมไม่เกิน 2 ตำแหน่ง');
    end if;
  end if;

  select count(*)::integer, coalesce(sum(line_total), 0)
    into v_line_count, v_total
  from unnest(v_lines);
  v_title := 'บิลขาย — ' || v_line_count::text || ' รายการ';

  if not v_internal_bypass then
    select keyword.id
      into v_keyword_id
    from public.income_expense_approval_keywords keyword
    where keyword.is_active = true
      and keyword.deleted_at is null
      and keyword.applies_to in ('income', 'both')
      and (keyword.approval_min_amount is null or v_total >= keyword.approval_min_amount)
      and exists (
        select 1
        from unnest(v_lines) line
        where (keyword.match_mode = 'exact' and lower(trim(line.title)) = lower(trim(keyword.keyword)))
           or (keyword.match_mode = 'contains' and position(lower(trim(keyword.keyword)) in lower(trim(line.title))) > 0)
      )
    order by length(keyword.keyword) desc, keyword.created_at
    limit 1;

    select approval_min_amount, applies_to
      into v_threshold, v_threshold_scope
    from public.income_expense_approval_settings
    where id = true;

    if v_keyword_id is not null
       or (
         v_threshold is not null
         and v_total >= v_threshold
         and coalesce(v_threshold_scope, 'both') in ('income', 'both')
       ) then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'บิลขายนี้ต้องขออนุมัติ ไม่สามารถซิงก์โดยตรงได้');
    end if;
  end if;

  if v_operation in ('create', 'update') then
    for v_product_id in
      select product_id
      from (
        select distinct stock_product_id as product_id from unnest(v_lines)
        union
        select distinct line.stock_product_id
        from public.income_expense_sale_lines line
        where line.income_expense_id = v_row.id
      ) products
      order by product_id
    loop
      perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_location_id::text || ':' || v_product_id::text));

      v_current_balance := public.get_stock_balance(v_location_id, v_product_id);
      select coalesce(sum(quantity), 0)
        into v_old_quantity
      from public.income_expense_sale_lines
      where income_expense_id = v_row.id
        and stock_product_id = v_product_id;
      select coalesce(sum(quantity), 0)
        into v_new_quantity
      from unnest(v_lines)
      where stock_product_id = v_product_id;

      if v_current_balance + v_old_quantity - v_new_quantity < 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'สต็อกสินค้าไม่พอสำหรับบิลขาย');
      end if;
    end loop;
  end if;

  if v_internal_bypass and nullif(payload->>'createdByUserId', '') is not null then
    v_created_by_user_id := (payload->>'createdByUserId')::uuid;
    select name, phone
      into v_created_by_name, v_created_by_phone
    from public.profiles
    where id = v_created_by_user_id;
    v_created_by_name := coalesce(nullif(payload->>'createdByName', ''), v_created_by_name, '');
    v_created_by_phone := coalesce(nullif(payload->>'createdByPhone', ''), v_created_by_phone, '');
  else
    v_created_by_user_id := auth.uid();
    select name, phone
      into v_created_by_name, v_created_by_phone
    from public.profiles
    where id = v_created_by_user_id;
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
    where id = v_row.id
    returning * into v_row;
  elsif v_operation = 'create' then
    v_date := to_char((payload->>'txDate')::date, 'YYMMDD');
    perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));
    select count(*) + 1
      into v_next_seq
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
      v_client_temp_id, v_idempotency_key, 1, 'synced', 'active',
      v_location_id, 'income', v_server_bill_no, payload->>'localBillNo', v_server_bill_no,
      (payload->>'txDate')::date, v_title, v_total, null, null, 'บิลขาย',
      null, null, null,
      (payload->>'clientRecordedAt')::timestamptz,
      (payload->>'clientCreatedAt')::timestamptz,
      now(),
      v_created_by_user_id, coalesce(v_created_by_name, ''), coalesce(v_created_by_phone, '')
    )
    returning * into v_row;
  else
    update public.income_expense
    set tx_date = (payload->>'txDate')::date,
        title = v_title,
        cost = v_total,
        unit = null,
        price = null,
        income_sale_item_id = null,
        stock_product_id = null,
        stock_quantity = null,
        client_recorded_at = (payload->>'clientRecordedAt')::timestamptz,
        revision_no = revision_no + 1,
        idempotency_key = v_idempotency_key,
        server_received_at = now()
    where id = v_row.id
    returning * into v_row;
  end if;

  if v_operation in ('create', 'update') then
    delete from public.income_expense_sale_lines
    where income_expense_id = v_row.id;

    insert into public.income_expense_sale_lines (
      income_expense_id, income_sale_item_id, stock_product_id,
      title, quantity, unit_price, line_total, sequence_no
    )
    select
      v_row.id, income_sale_item_id, stock_product_id,
      title, quantity, unit_price, line_total, sequence_no
    from unnest(v_lines)
    order by sequence_no;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', line.id,
      'incomeSaleItemId', line.income_sale_item_id,
      'stockProductId', line.stock_product_id,
      'title', line.title,
      'quantity', line.quantity,
      'unitPrice', line.unit_price,
      'lineTotal', line.line_total,
      'sequenceNo', line.sequence_no
    ) order by line.sequence_no
  ), '[]'::jsonb)
    into v_lines_json
  from public.income_expense_sale_lines line
  where line.income_expense_id = v_row.id;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_row.id,
    'serverBillNo', v_row.server_bill_no,
    'revisionNo', v_row.revision_no,
    'serverReceivedAt', v_row.server_received_at,
    'title', v_row.title,
    'cost', v_row.cost,
    'saleLineCount', jsonb_array_length(v_lines_json),
    'saleLines', v_lines_json
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;


ALTER FUNCTION "private"."sync_income_sale_bill"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."telegram_badge_latest_slot"("p_now" timestamp with time zone, "p_start_time" time without time zone, "p_end_time" time without time zone, "p_interval_minutes" integer) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  local_now timestamp := p_now at time zone 'Asia/Bangkok';
  window_start timestamptz;
  window_end timestamptz;
  elapsed_minutes integer;
begin
  window_start := ((local_now::date + p_start_time) at time zone 'Asia/Bangkok');
  window_end := ((local_now::date + p_end_time) at time zone 'Asia/Bangkok');

  if p_now < window_start or p_now > window_end then
    return null;
  end if;

  elapsed_minutes := floor(extract(epoch from (p_now - window_start)) / 60)::integer;
  return window_start
    + make_interval(mins => (elapsed_minutes / p_interval_minutes) * p_interval_minutes);
end;
$$;


ALTER FUNCTION "private"."telegram_badge_latest_slot"("p_now" timestamp with time zone, "p_start_time" time without time zone, "p_end_time" time without time zone, "p_interval_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."telegram_badge_require_manager"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
  then
    raise exception 'ไม่มีสิทธิ์จัดการ Telegram Badge';
  end if;
end;
$$;


ALTER FUNCTION "private"."telegram_badge_require_manager"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."validate_rubber_export_selection"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_selected_count integer;
  v_candidate_count integer;
  v_invalid text;
begin
  v_selected_count := coalesce(cardinality(p_selected_report_item_ids), 0);

  if v_selected_count = 0 then
    raise exception 'RUBBER_EXPORT_SELECTION_EMPTY: กรุณาเลือกบิลอย่างน้อย 1 ใบ'
      using errcode = 'P0001';
  end if;

  if (
    select count(distinct selected_id)
    from unnest(p_selected_report_item_ids) selected_id
  ) <> v_selected_count then
    raise exception 'RUBBER_EXPORT_SELECTION_DUPLICATE: พบบิลที่เลือกซ้ำ'
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_candidate_count
  from private.rubber_export_candidates(
    p_location_id,
    p_selected_report_item_ids
  );

  if v_candidate_count <> v_selected_count then
    raise exception 'RUBBER_EXPORT_SELECTION_STALE: บิลที่เลือกบางรายการไม่พร้อมส่งออกแล้ว'
      using errcode = 'P0001',
            hint = 'รีเฟรชรายการบิลแล้วเลือกใหม่';
  end if;

  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id)
  into v_invalid
  from private.rubber_export_candidates(
    p_location_id,
    p_selected_report_item_ids
  ) c
  where c.net_weight <= 0 or c.paid_amount <= 0;

  if v_invalid is not null then
    raise exception 'INVALID_RUBBER_BILL:%', v_invalid
      using errcode = 'P0001',
            hint = 'น้ำหนักสุทธิหลังหักและยอดจ่ายจริงต้องมากกว่า 0';
  end if;
end;
$$;


ALTER FUNCTION "private"."validate_rubber_export_selection"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) OWNER TO "postgres";


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

  perform pg_advisory_xact_lock(hashtextextended(v_request.location_id::text, 0));

  v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);
  if v_result->>'status' <> 'synced' then
    raise exception '%', coalesce(v_result->>'errorMessage', 'อนุมัติคำขอไม่สำเร็จ');
  end if;

  v_created_bill_id := (v_result->>'id')::uuid;

  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bills
  set created_by_user_id = case
        when v_request.operation = 'create' then v_request.requested_by_user_id
        else created_by_user_id
      end,
      created_by_name = case
        when v_request.operation = 'create' then v_request.requested_by_name
        else created_by_name
      end,
      created_by_phone = case
        when v_request.operation = 'create' then v_request.requested_by_phone
        else created_by_phone
      end,
      approval_state = 'approved',
      approved_by_name = coalesce(v_actor_name, ''),
      approval_revision_no = revision_no
  where id = v_created_bill_id;

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
    SET "search_path" TO ''
    AS $$
  select coalesce(sum(
    public.calculate_time_segment_paid_days(
      greatest(s.start_time, p_period_start),
      least(
        s.end_time,
        coalesce(p_period_end, s.end_time)
      )
    )
  ), 0)
  from public.time_segments s
  where s.profile_id = p_profile_id
    and s.end_time is not null
    and s.end_time > p_period_start
    and (p_period_end is null or s.start_time < p_period_end)
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
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid expense source';
  end if;
  if p_expense_location_id is not null
    and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
  then
    raise exception 'New expense location access denied';
  end if;

  if p_source_type = 'transaction' then
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found
      or v_tx.type <> 'WITHDRAWAL'
      or v_tx.status <> 'APPROVED'
      or v_tx.cancelled_at is not null
    then
      raise exception 'Active withdrawal expense not found';
    end if;
    if not private.can_manage_time_payroll_profile(v_tx.profile_id) then
      raise exception 'Expense location access denied';
    end if;

    v_old_location_id := v_tx.expense_location_id;
    if v_old_location_id is not distinct from p_expense_location_id then
      return jsonb_build_object('status', 'unchanged');
    end if;

    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.financial_transactions
    set expense_location_id = p_expense_location_id
    where id = v_tx.id;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'CHANGE_TRANSACTION_EXPENSE_LOCATION',
      'financial_transactions',
      v_tx.id,
      jsonb_build_object(
        'expenseLocationId', v_old_location_id,
        'paymentMethod', case when v_old_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM' else 'BRANCH' end
      ),
      jsonb_build_object(
        'expenseLocationId', p_expense_location_id,
        'paymentMethod', case when p_expense_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM' else 'BRANCH' end
      ),
      coalesce(p_comment, '')
    );
  else
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found
      or v_slip.status <> 'APPROVED'
      or v_slip.net_pay <= 0
      or v_slip.cancelled_at is not null
    then
      raise exception 'Active payroll expense not found';
    end if;
    if not private.can_manage_time_payroll_profile(v_slip.profile_id) then
      raise exception 'Expense location access denied';
    end if;

    v_old_location_id := v_slip.expense_location_id;
    if v_old_location_id is not distinct from p_expense_location_id then
      return jsonb_build_object('status', 'unchanged');
    end if;

    perform set_config('app.time_tracking_expense_rpc', 'true', true);
    update public.payroll_slips
    set expense_location_id = p_expense_location_id
    where id = v_slip.id;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'CHANGE_PAYROLL_EXPENSE_LOCATION',
      'payroll_slips',
      v_slip.id,
      jsonb_build_object(
        'expenseLocationId', v_old_location_id,
        'paymentMethod', case when v_old_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM' else 'BRANCH' end
      ),
      jsonb_build_object(
        'expenseLocationId', p_expense_location_id,
        'paymentMethod', case when p_expense_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM' else 'BRANCH' end
      ),
      coalesce(p_comment, '')
    );
  end if;

  return jsonb_build_object(
    'status', 'updated',
    'oldExpenseLocationId', v_old_location_id,
    'expenseLocationId', p_expense_location_id
  );
end
$$;


ALTER FUNCTION "public"."change_time_tracking_expense_location"("p_source_type" "text", "p_source_id" "uuid", "p_expense_location_id" "uuid", "p_comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_telegram_badge_dispatch"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  settings public.telegram_badge_settings%rowtype;
  now_at timestamptz := now();
  latest_slot timestamptz;
  due_slot timestamptz;
  next_claim_token uuid;
  local_today date := (now_at at time zone 'Asia/Bangkok')::date;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select * into strict settings
  from public.telegram_badge_settings
  where id = true
  for update;

  if not settings.enabled then
    return jsonb_build_object('claimed', false, 'reason', 'disabled');
  end if;

  latest_slot := private.telegram_badge_latest_slot(
    now_at,
    settings.start_time,
    settings.end_time,
    settings.interval_minutes
  );
  if latest_slot is null then
    return jsonb_build_object('claimed', false, 'reason', 'outside_window');
  end if;

  if settings.claim_token is not null
    and settings.claimed_at > now_at - interval '5 minutes'
  then
    return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  end if;

  if settings.pending_slot_at is not null
    and (settings.pending_slot_at at time zone 'Asia/Bangkok')::date <> local_today
  then
    settings.pending_slot_at := null;
    settings.retry_at := null;
  end if;

  if settings.pending_slot_at is not null
    and settings.retry_at is not null
    and settings.retry_at <= now_at
  then
    due_slot := settings.pending_slot_at;
  elsif settings.initial_attempt_at is not null
    and settings.initial_attempt_at <= now_at
  then
    due_slot := latest_slot;
  elsif settings.initial_attempt_at is null
    and settings.pending_slot_at is null
    and (
      settings.last_completed_slot_at is null
      or latest_slot > settings.last_completed_slot_at
    )
  then
    due_slot := latest_slot;
  else
    return jsonb_build_object('claimed', false, 'reason', 'not_due');
  end if;

  next_claim_token := extensions.gen_random_uuid();
  update public.telegram_badge_settings
  set pending_slot_at = due_slot,
      claim_token = next_claim_token,
      claimed_at = now_at,
      initial_attempt_at = null,
      last_attempt_at = now_at,
      updated_at = now_at
  where id = true;

  return jsonb_build_object(
    'claimed', true,
    'claimToken', next_claim_token,
    'slotAt', due_slot
  );
end;
$$;


ALTER FUNCTION "public"."claim_telegram_badge_dispatch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_telegram_badge_dispatch"("p_claim_token" "uuid", "p_outcome" "text", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  settings public.telegram_badge_settings%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_outcome not in ('sent', 'no_items', 'failed') then
    raise exception 'ผลการส่งไม่ถูกต้อง';
  end if;

  select * into strict settings
  from public.telegram_badge_settings
  where id = true
  for update;

  if settings.claim_token is distinct from p_claim_token then
    raise exception 'claim ไม่ตรงหรือหมดอายุ';
  end if;

  update public.telegram_badge_settings
  set last_completed_slot_at = case
        when p_outcome in ('sent', 'no_items') then pending_slot_at
        else last_completed_slot_at
      end,
      last_success_at = case
        when p_outcome = 'sent' then now()
        else last_success_at
      end,
      last_error = case
        when p_outcome = 'failed' then left(coalesce(p_error, 'ส่ง Telegram ไม่สำเร็จ'), 500)
        else null
      end,
      retry_at = case
        when p_outcome = 'failed' then now() + interval '10 minutes'
        else null
      end,
      pending_slot_at = case
        when p_outcome = 'failed' then pending_slot_at
        else null
      end,
      claim_token = null,
      claimed_at = null,
      updated_at = now()
  where id = true;
end;
$$;


ALTER FUNCTION "public"."complete_telegram_badge_dispatch"("p_claim_token" "uuid", "p_outcome" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."configure_telegram_badge_dispatcher"("p_edge_url" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  settings public.telegram_badge_settings%rowtype;
  normalized_url text := nullif(btrim(p_edge_url), '');
  dispatch_secret text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if normalized_url is null or normalized_url !~ '^https?://' then
    raise exception 'Edge Function URL ไม่ถูกต้อง';
  end if;

  select * into strict settings
  from public.telegram_badge_settings
  where id = true
  for update;

  if settings.edge_url_secret_id is null then
    settings.edge_url_secret_id := vault.create_secret(
      normalized_url,
      'lanflow_telegram_badge_edge_url',
      'Telegram badge Edge Function URL'
    );
  else
    perform vault.update_secret(
      settings.edge_url_secret_id,
      normalized_url,
      'lanflow_telegram_badge_edge_url',
      'Telegram badge Edge Function URL'
    );
  end if;

  if settings.dispatch_secret_id is null then
    dispatch_secret := encode(extensions.gen_random_bytes(32), 'hex');
    settings.dispatch_secret_id := vault.create_secret(
      dispatch_secret,
      'lanflow_telegram_badge_dispatch_secret',
      'Internal secret used by pg_cron to invoke the badge Edge Function'
    );
  end if;

  update public.telegram_badge_settings
  set edge_url_secret_id = settings.edge_url_secret_id,
      dispatch_secret_id = settings.dispatch_secret_id,
      updated_at = now()
  where id = true;
end;
$$;


ALTER FUNCTION "public"."configure_telegram_badge_dispatcher"("p_edge_url" "text") OWNER TO "postgres";


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
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_operation text := payload->>'operation';
  v_base_request_key text := payload->>'idempotencyKey';
  v_request_key text;
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
  v_type text := payload->>'type';
  v_bill_option text := payload->>'billOption';
  v_title text;
  v_cost numeric;
  v_existing public.income_expense%rowtype;
  v_line_count integer;
  v_keyword_id uuid;
  v_keyword text;
  v_amount_match boolean;
  v_threshold numeric;
  v_threshold_scope text;
  v_existing_id uuid;
  v_existing_status text;
  v_user_id uuid;
  v_user_name text;
  v_user_phone text;
  v_request_id uuid;
  v_reason text;
  v_sale_lines_json jsonb;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;
  if coalesce(v_base_request_key, '') = '' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Missing idempotency key');
  end if;

  if v_operation in ('update', 'delete') then
    select *
      into v_existing
    from public.income_expense
    where client_temp_id = payload->>'clientTempId';
    if v_existing.id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการรับ-จ่าย');
    end if;
    if v_existing.record_status <> 'active' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'รายการนี้ถูกลบแล้ว');
    end if;
    if v_location_id is distinct from v_existing.location_id then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่สามารถย้ายรายการรับ-จ่ายข้ามสาขาได้');
    end if;
    if v_operation = 'update' and v_bill_option is distinct from v_existing.bill_option then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่สามารถเปลี่ยนรูปแบบของรายการที่บันทึกแล้ว');
    end if;
    v_location_id := v_existing.location_id;
    v_type := v_existing.type::text;
    if v_operation = 'delete' then
      v_bill_option := v_existing.bill_option;
    end if;
  end if;

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_bill_option = 'บิลขาย' then
    if v_operation = 'delete' then
      select
        count(*)::integer,
        coalesce(sum(line.line_total), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'id', line.id,
          'incomeSaleItemId', line.income_sale_item_id,
          'stockProductId', line.stock_product_id,
          'title', line.title,
          'quantity', line.quantity,
          'unitPrice', line.unit_price,
          'lineTotal', line.line_total,
          'sequenceNo', line.sequence_no
        ) order by line.sequence_no), '[]'::jsonb)
        into v_line_count, v_cost, v_sale_lines_json
      from public.income_expense_sale_lines line
      where line.income_expense_id = v_existing.id;
    else
      if jsonb_typeof(payload->'saleLines') <> 'array' then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องมีรายการสินค้า');
      end if;
      v_line_count := jsonb_array_length(payload->'saleLines');
      if v_line_count < 1 or v_line_count > 50 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'บิลขายต้องมี 1 ถึง 50 รายการ');
      end if;
      if (select count(*) from private.normalize_income_sale_lines(payload)) <> v_line_count then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการบิลขายไม่ตรงกับสินค้าที่เปิดใช้งาน');
      end if;
      if exists (
        select 1 from private.normalize_income_sale_lines(payload)
        where quantity <= 0
           or quantity <> trunc(quantity)
           or unit_price <= 0
           or unit_price <> round(unit_price, 2)
      ) then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'จำนวนต้องเป็นจำนวนเต็มมากกว่า 0 และราคามีทศนิยมไม่เกิน 2 ตำแหน่ง');
      end if;
      select
        count(*)::integer,
        coalesce(sum(line.line_total), 0),
        coalesce(jsonb_agg(jsonb_build_object(
          'incomeSaleItemId', line.income_sale_item_id,
          'stockProductId', line.stock_product_id,
          'title', line.title,
          'quantity', line.quantity,
          'unitPrice', line.unit_price,
          'lineTotal', line.line_total,
          'sequenceNo', line.sequence_no
        ) order by line.sequence_no), '[]'::jsonb)
        into v_line_count, v_cost, v_sale_lines_json
      from private.normalize_income_sale_lines(payload) line;
    end if;
    v_title := 'บิลขาย — ' || v_line_count::text || ' รายการ';
    v_type := 'income';
    payload := payload || jsonb_build_object(
      'locationId', v_location_id,
      'type', v_type,
      'billOption', 'บิลขาย',
      'title', v_title,
      'cost', v_cost,
      'saleLines', v_sale_lines_json
    );
  elsif v_operation = 'delete' then
    v_title := v_existing.title;
    v_cost := v_existing.cost;
    payload := payload || jsonb_build_object(
      'locationId', v_location_id,
      'type', v_type,
      'billOption', v_existing.bill_option,
      'title', v_title,
      'cost', v_cost
    );
  else
    v_title := trim(coalesce(payload->>'title', ''));
    v_cost := nullif(payload->>'cost', '')::numeric;
  end if;

  if v_type not in ('income', 'expense') or v_title = '' or coalesce(v_cost, 0) <= 0 then
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

  select setting.id, setting.keyword
    into v_keyword_id, v_keyword
  from public.income_expense_approval_keywords setting
  where setting.is_active = true
    and setting.deleted_at is null
    and setting.applies_to in (v_type, 'both')
    and (setting.approval_min_amount is null or v_cost >= setting.approval_min_amount)
    and (
      (
        v_bill_option = 'บิลขาย'
        and (
          (
            v_operation = 'delete'
            and exists (
              select 1
              from public.income_expense_sale_lines line
              where line.income_expense_id = v_existing.id
                and (
                  (setting.match_mode = 'exact' and lower(trim(line.title)) = lower(trim(setting.keyword)))
                  or (setting.match_mode = 'contains' and position(lower(trim(setting.keyword)) in lower(trim(line.title))) > 0)
                )
            )
          )
          or
          (
            v_operation <> 'delete'
            and exists (
              select 1
              from private.normalize_income_sale_lines(payload) line
              where (setting.match_mode = 'exact' and lower(trim(line.title)) = lower(trim(setting.keyword)))
                 or (setting.match_mode = 'contains' and position(lower(trim(setting.keyword)) in lower(trim(line.title))) > 0)
            )
          )
        )
      )
      or
      (
        v_bill_option <> 'บิลขาย'
        and (
          (setting.match_mode = 'exact' and lower(trim(v_title)) = lower(trim(setting.keyword)))
          or (setting.match_mode = 'contains' and position(lower(trim(setting.keyword)) in lower(trim(v_title))) > 0)
        )
      )
    )
  order by length(setting.keyword) desc, setting.created_at
  limit 1;

  select approval_min_amount, applies_to
    into v_threshold, v_threshold_scope
  from public.income_expense_approval_settings
  where id = true;
  v_amount_match := v_threshold is not null
    and v_cost >= v_threshold
    and coalesce(v_threshold_scope, 'both') in (v_type, 'both');

  if v_keyword_id is null and not v_amount_match then
    return jsonb_build_object('status', 'no_approval');
  end if;

  v_reason := case
    when v_keyword_id is not null and v_amount_match then 'keyword_and_amount'
    when v_amount_match then 'amount_threshold'
    else 'keyword'
  end;
  v_request_key := v_base_request_key;
  if exists (
    select 1 from public.income_expense_approval_requests
    where request_idempotency_key = v_request_key
  ) then
    v_request_key := v_base_request_key || ':retry:' || gen_random_uuid()::text;
  end if;

  v_user_id := auth.uid();
  select name, phone
    into v_user_name, v_user_phone
  from public.profiles
  where id = v_user_id;

  insert into public.income_expense_approval_requests (
    requested_operation, request_idempotency_key, requested_payload,
    source_income_expense_id, matched_keyword_id, matched_keyword, matched_reason,
    location_id, tx_type, title, cost,
    requested_by_user_id, requested_by_name, requested_by_phone
  ) values (
    v_operation, v_request_key, payload,
    v_existing.id, v_keyword_id, v_keyword, v_reason,
    v_location_id, v_type, v_title, v_cost,
    v_user_id, coalesce(v_user_name, ''), coalesce(v_user_phone, '')
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
  v_previous_report_id uuid;
  v_opening_balance numeric := 0;
  v_period_balance numeric := 0;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายงานของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));

  if exists (
    select 1
    from private.rubber_bill_report_blockers(p_location_id, v_cutoff_at)
  ) then
    raise exception 'RUBBER_BILL_PENDING: ยังมีงานบิลยางที่ต้องจัดการก่อนสร้างรายงาน';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = v_actor_id;

  select b.id, b.closing_balance
  into v_previous_report_id, v_opening_balance
  from public.report_batches b
  where b.location_id = p_location_id
    and b.status = 'active'
  order by b.created_at desc, b.id desc
  limit 1;

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
    previous_report_id,
    opening_balance,
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
    v_previous_report_id,
    coalesce(v_opening_balance, 0),
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

  select coalesce(sum(
    case when r.entry_type = 'income' then r.amount else -r.amount end
  ), 0)
  into v_period_balance
  from private.report_income_expense_period_rows(v_report_id) r;

  update public.report_batches
  set closing_balance = coalesce(v_opening_balance, 0) + v_period_balance
  where id = v_report_id;

  return jsonb_build_object(
    'id', v_report_id,
    'reportNo', v_report_no,
    'cutoffAt', v_cutoff_at,
    'itemCount', v_item_count
  );
end;
$$;


ALTER FUNCTION "public"."create_report_batch"("p_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_rubber_export"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) RETURNS "jsonb"
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
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || p_location_id::text, 0));

  perform private.validate_rubber_export_selection(
    p_location_id,
    p_selected_report_item_ids
  );

  select count(*)::integer, round(sum(c.net_weight), 2), round(sum(c.paid_amount), 2)
  into v_item_count, v_original_weight, v_paid_total
  from private.rubber_export_candidates(
    p_location_id,
    p_selected_report_item_ids
  ) c;

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
  from private.rubber_export_candidates(
    p_location_id,
    p_selected_report_item_ids
  ) c;

  get diagnostics v_item_count = row_count;

  return jsonb_build_object(
    'id', v_export_id,
    'exportNo', v_export_no,
    'itemCount', v_item_count
  );
end;
$$;


ALTER FUNCTION "public"."create_rubber_export"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."create_time_tracking_payroll_slip"("p_profile_id" "uuid", "p_month" "text", "p_auto_start_next_month" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_actor_id uuid := auth.uid();
  v_month date;
  v_next_month date;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
  v_scan_month date;
  v_first_segment_month date;
  v_active_segment public.time_segments%rowtype;
  v_was_running boolean := false;
  v_daily_wage numeric;
  v_total_days numeric;
  v_gross numeric;
  v_deductions numeric;
  v_net numeric;
  v_segments jsonb;
  v_transactions jsonb;
  v_slip public.payroll_slips%rowtype;
  v_blocker record;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'INVALID_MONTH';
  end if;

  begin
    v_month := (p_month || '-01')::date;
  exception when others then
    raise exception 'INVALID_MONTH';
  end;
  if to_char(v_month, 'YYYY-MM') <> p_month or v_month > v_current_month then
    raise exception 'INVALID_MONTH';
  end if;
  v_next_month := (v_month + interval '1 month')::date;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));

  if exists (
    select 1 from public.payroll_slips ps
    where ps.profile_id = p_profile_id and ps.month = p_month
  ) then
    raise exception 'MONTH_CLOSED:%', p_month;
  end if;

  select ft.id, ft.type::text type, ft.effective_date
  into v_blocker
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and ft.type in ('DEBT', 'WITHDRAWAL')
    and ft.status = 'PENDING'
    and ft.effective_date < v_next_month
  order by ft.effective_date, ft.created_at, ft.id
  limit 1;
  if found then
    raise exception 'PENDING_BLOCKER:%:%:%',
      v_blocker.type,
      v_blocker.id,
      to_char(v_blocker.effective_date, 'YYYY-MM');
  end if;

  select min(date_trunc('month', s.start_time at time zone 'Asia/Bangkok')::date)
  into v_first_segment_month
  from public.time_segments s
  where s.profile_id = p_profile_id;

  if v_first_segment_month is not null then
    for v_scan_month in
      select generate_series(
        v_first_segment_month::timestamp,
        (v_month - interval '1 month')::timestamp,
        interval '1 month'
      )::date
    loop
      if not exists (
        select 1 from public.payroll_slips ps
        where ps.profile_id = p_profile_id
          and ps.month = to_char(v_scan_month, 'YYYY-MM')
      ) and public.calculate_paid_work_days(
        p_profile_id,
        v_scan_month::timestamp at time zone 'Asia/Bangkok',
        (v_scan_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
      ) > 0 then
        raise exception 'OLDER_WORK_MONTH:%', to_char(v_scan_month, 'YYYY-MM');
      end if;
    end loop;
  end if;

  if v_month = v_current_month then
    select * into v_active_segment
    from public.time_segments s
    where s.profile_id = p_profile_id and s.end_time is null
    for update;
    if found then
      v_was_running := true;
      update public.time_segments
      set end_time = now()
      where id = v_active_segment.id;
    end if;
  end if;

  v_total_days := public.calculate_paid_work_days(
    p_profile_id,
    v_month::timestamp at time zone 'Asia/Bangkok',
    v_next_month::timestamp at time zone 'Asia/Bangkok'
  );

  if v_month < v_current_month and v_total_days <= 0 then
    raise exception 'NO_WORK_MONTH:%', p_month;
  end if;

  perform private.apply_time_tracking_deductions(p_profile_id, v_month);

  select p.daily_wage into v_daily_wage
  from public.profiles p
  where p.id = p_profile_id;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  v_gross := trunc(v_total_days * v_daily_wage, 2);
  select coalesce(sum(ft.amount), 0)
  into v_deductions
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and ft.status = 'APPROVED'
    and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
    and ft.applied_month = v_month;
  v_net := greatest(trunc(v_gross - v_deductions, 2), 0);

  select coalesce(jsonb_agg(to_jsonb(s) order by s.start_time), '[]'::jsonb)
  into v_segments
  from public.time_segments s
  where s.profile_id = p_profile_id
    and s.end_time is not null
    and s.end_time > (v_month::timestamp at time zone 'Asia/Bangkok')
    and s.start_time < (v_next_month::timestamp at time zone 'Asia/Bangkok');

  select coalesce(jsonb_agg(to_jsonb(ft) order by ft.created_at, ft.id), '[]'::jsonb)
  into v_transactions
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and (
      (
        ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and ft.applied_month = v_month
      )
      or
      (
        ft.type in ('DEBT', 'WITHDRAWAL')
        and ft.effective_date >= v_month
        and ft.effective_date < v_next_month
      )
    );

  insert into public.payroll_slips (
    profile_id,
    month,
    gross_pay,
    total_deductions,
    net_pay,
    total_days,
    daily_wage,
    slip_data,
    status,
    created_by
  )
  values (
    p_profile_id,
    p_month,
    v_gross,
    v_deductions,
    v_net,
    v_total_days,
    v_daily_wage,
    jsonb_build_object(
      'segments', v_segments,
      'transactions', v_transactions,
      'lockedAt', now()
    ),
    'PENDING',
    v_actor_id
  )
  returning * into v_slip;

  if v_month = v_current_month and v_was_running and p_auto_start_next_month then
    insert into public.time_tracking_resume_schedules (
      profile_id,
      payroll_slip_id,
      resume_at,
      created_by
    )
    values (
      p_profile_id,
      v_slip.id,
      v_next_month::timestamp at time zone 'Asia/Bangkok',
      v_actor_id
    )
    on conflict (profile_id) do update
    set
      payroll_slip_id = excluded.payroll_slip_id,
      resume_at = excluded.resume_at,
      created_by = excluded.created_by,
      created_at = now();
  else
    delete from public.time_tracking_resume_schedules
    where profile_id = p_profile_id;
  end if;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data, comment
  )
  values (
    v_actor_id,
    'CREATE_PAYROLL_SLIP',
    'payroll_slips',
    v_slip.id,
    to_jsonb(v_slip) || jsonb_build_object(
      'was_running', v_was_running,
      'auto_start_next_month', v_month = v_current_month
        and v_was_running
        and p_auto_start_next_month
    ),
    'สร้างสลิปเดือน ' || p_month
  );

  return to_jsonb(v_slip) || jsonb_build_object(
    'auto_start_scheduled',
    v_month = v_current_month and v_was_running and p_auto_start_next_month
  );
end;
$_$;


ALTER FUNCTION "public"."create_time_tracking_payroll_slip"("p_profile_id" "uuid", "p_month" "text", "p_auto_start_next_month" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_time_tracking_transaction"("p_profile_id" "uuid", "p_type" "text", "p_amount" numeric, "p_effective_date" "date", "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_id uuid;
  v_comment text;
  v_actor_name text;
  v_bangkok_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_type not in ('DEBT', 'WITHDRAWAL') then
    raise exception 'INVALID_TRANSACTION_TYPE';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_effective_date is null or p_effective_date > v_bangkok_today then
    raise exception 'FUTURE_EFFECTIVE_DATE';
  end if;
  if p_type = 'DEBT' and not private.can_manage_time_payroll_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_type = 'WITHDRAWAL'
    and p_profile_id <> v_actor_id
    and not private.can_manage_time_payroll_profile(p_profile_id)
  then
    raise exception 'Forbidden';
  end if;
  if p_type = 'DEBT' and nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.is_active = true
  ) then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.payroll_slips ps
    where ps.profile_id = p_profile_id
      and ps.month = to_char(p_effective_date, 'YYYY-MM')
  ) then
    raise exception 'MONTH_CLOSED:%', to_char(p_effective_date, 'YYYY-MM');
  end if;

  select p.name into v_actor_name from public.profiles p where p.id = v_actor_id;
  v_comment := case
    when v_actor_id = p_profile_id and p_type = 'WITHDRAWAL' then null
    when p_type = 'DEBT' then 'สร้างหนี้สินโดย: ' || coalesce(v_actor_name, 'ผู้จัดการ')
    else 'ยื่นแทนโดยผู้จัดการ: ' || coalesce(v_actor_name, 'ผู้จัดการ')
  end;

  insert into public.financial_transactions (
    profile_id, type, amount, effective_date, due_date, description, admin_comment
  ) values (
    p_profile_id,
    p_type::public.financial_transaction_type,
    trunc(p_amount, 2),
    p_effective_date,
    case when p_type = 'DEBT' then p_effective_date else null end,
    nullif(btrim(coalesce(p_description, '')), ''),
    v_comment
  ) returning id into v_id;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data, comment
  ) values (
    v_actor_id,
    case when p_type = 'DEBT' then 'CREATE_DEBT' else 'REQUEST_WITHDRAWAL' end,
    'financial_transactions',
    v_id,
    jsonb_build_object(
      'profile_id', p_profile_id,
      'type', p_type,
      'amount', trunc(p_amount, 2),
      'effective_date', p_effective_date,
      'description', nullif(btrim(coalesce(p_description, '')), '')
    ),
    v_comment
  );

  return jsonb_build_object('id', v_id, 'status', 'pending');
end
$$;


ALTER FUNCTION "public"."create_time_tracking_transaction"("p_profile_id" "uuid", "p_type" "text", "p_amount" numeric, "p_effective_date" "date", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_profile_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select auth.uid()
$$;


ALTER FUNCTION "public"."current_profile_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cutoff_time_tracking"("p_profile_id" "uuid", "p_cutoff_time" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_segment public.time_segments%rowtype;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_cutoff_time is null or p_cutoff_time > now() + interval '5 minutes' then
    raise exception 'INVALID_CUTOFF_TIME';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  select * into v_segment
  from public.time_segments s
  where s.profile_id = p_profile_id and s.end_time is null
  for update;

  if not found or p_cutoff_time <= v_segment.start_time then
    return jsonb_build_object('status', 'unchanged');
  end if;

  update public.time_segments set end_time = p_cutoff_time where id = v_segment.id;
  insert into public.time_segments(profile_id, start_time)
  values (p_profile_id, p_cutoff_time);

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data, comment
  )
  values (
    v_actor_id,
    'CUTOFF_TRACKING',
    'time_segments',
    p_profile_id,
    jsonb_build_object('cutoff_time', p_cutoff_time),
    'Auto split at 15:00'
  );

  return jsonb_build_object('status', 'split');
end;
$$;


ALTER FUNCTION "public"."cutoff_time_tracking"("p_profile_id" "uuid", "p_cutoff_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decide_cash_transfer_delete_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  request_row public.cash_transfer_delete_requests%rowtype;
  decider_id uuid := auth.uid();
  decider_name text;
  decider_phone text;
  report_no text;
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
  then
    raise exception 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'คำตัดสินไม่ถูกต้อง';
  end if;

  select * into request_row
  from public.cash_transfer_delete_requests
  where id = p_request_id;

  if request_row.id is null then
    raise exception 'ไม่พบคำขอลบรายการโยกเงิน';
  end if;
  if request_row.request_status <> 'pending' then
    raise exception 'คำขอนี้ถูกดำเนินการแล้ว';
  end if;

  if request_row.transfer_id is not null then
    perform 1
    from public.money_transfers
    where id = request_row.transfer_id
      and transfer_type = 'cash'
      and transfer_method = 'cash'
    for update;
    if not found and p_decision = 'approved' then
      select * into request_row
      from public.cash_transfer_delete_requests
      where id = p_request_id
      for update;
      if request_row.request_status <> 'pending' then
        raise exception 'คำขอนี้ถูกดำเนินการแล้ว';
      end if;
      raise exception 'ไม่พบรายการเงินสดต้นทาง';
    end if;
  end if;

  select * into request_row
  from public.cash_transfer_delete_requests
  where id = p_request_id
  for update;

  if request_row.request_status <> 'pending' then
    raise exception 'คำขอนี้ถูกดำเนินการแล้ว';
  end if;

  select name, phone into decider_name, decider_phone
  from public.profiles
  where id = decider_id;

  if p_decision = 'approved' then
    if request_row.transfer_id is null then
      raise exception 'ไม่พบรายการเงินสดต้นทาง';
    end if;

    report_no := private.active_transfer_report_no(request_row.transfer_id);
    if report_no is not null then
      perform private.raise_report_lock(report_no);
    end if;

    delete from public.money_transfers
    where id = request_row.transfer_id;
  end if;

  update public.cash_transfer_delete_requests
  set request_status = p_decision,
      decided_by_user_id = decider_id,
      decided_by_name = coalesce(decider_name, ''),
      decided_by_phone = coalesce(decider_phone, ''),
      decided_at = now(),
      decision_comment = nullif(btrim(p_comment), ''),
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'status', p_decision,
    'requestId', p_request_id
  );
end;
$$;


ALTER FUNCTION "public"."decide_cash_transfer_delete_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") OWNER TO "postgres";


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
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_data jsonb;
  v_requires_payment_choice boolean := false;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
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

  if p_source_type = 'transaction' then
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;
    if not private.can_manage_time_payroll_profile(v_tx.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_tx.profile_id::text, 0));
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;
    if exists (
      select 1 from public.payroll_slips ps
      where ps.profile_id = v_tx.profile_id
        and ps.month = to_char(v_tx.effective_date, 'YYYY-MM')
    ) then
      raise exception 'MONTH_CLOSED:%', to_char(v_tx.effective_date, 'YYYY-MM');
    end if;

    v_requires_payment_choice := p_decision = 'APPROVED' and v_tx.type = 'WITHDRAWAL';
    if v_tx.status <> 'PENDING' then
      if v_tx.status = p_decision::public.approval_status
        and (
          not v_requires_payment_choice
          or v_tx.expense_location_id is not distinct from p_expense_location_id
        )
      then
        return jsonb_build_object(
          'status', lower(p_decision),
          'idempotent', true,
          'sourceType', p_source_type,
          'sourceId', p_source_id
        );
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_payment_choice then
      if p_expense_location_id is not null
        and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
      then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_tx);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.financial_transactions
      set
        status = 'APPROVED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id,
        approved_at = now(),
        expense_location_id = case
          when v_requires_payment_choice then p_expense_location_id
          else null
        end,
        remaining_amount = amount
      where id = v_tx.id;

      perform private.apply_time_tracking_deductions(v_tx.profile_id, v_current_month);
    else
      update public.financial_transactions
      set
        status = 'REJECTED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id
      where id = v_tx.id;
    end if;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'DECIDE_TRANSACTION_APPROVAL',
      'financial_transactions',
      v_tx.id,
      v_old_data,
      jsonb_build_object(
        'decision', p_decision,
        'expenseLocationId', p_expense_location_id,
        'paymentMethod', case
          when v_requires_payment_choice and p_expense_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM'
          when v_requires_payment_choice then 'BRANCH'
          else null
        end
      ),
      coalesce(p_comment, '')
    );
  else
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id;
    if not found then raise exception 'Payroll slip not found'; end if;
    if not private.can_manage_time_payroll_profile(v_slip.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_slip.profile_id::text, 0));
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found then raise exception 'Payroll slip not found'; end if;

    v_requires_payment_choice := p_decision = 'APPROVED' and v_slip.net_pay > 0;
    if v_slip.status <> 'PENDING' then
      if v_slip.status = p_decision::public.approval_status
        and (
          not v_requires_payment_choice
          or v_slip.expense_location_id is not distinct from p_expense_location_id
        )
      then
        return jsonb_build_object(
          'status', lower(p_decision),
          'idempotent', true,
          'sourceType', p_source_type,
          'sourceId', p_source_id
        );
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_payment_choice then
      if p_expense_location_id is not null
        and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
      then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_slip);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.payroll_slips
      set
        status = 'APPROVED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id,
        approved_at = now(),
        expense_location_id = case
          when v_requires_payment_choice then p_expense_location_id
          else null
        end
      where id = v_slip.id;
    else
      update public.payroll_slips
      set
        status = 'REJECTED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id
      where id = v_slip.id;
    end if;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'DECIDE_PAYROLL_SLIP_APPROVAL',
      'payroll_slips',
      v_slip.id,
      v_old_data,
      jsonb_build_object(
        'decision', p_decision,
        'expenseLocationId', p_expense_location_id,
        'paymentMethod', case
          when v_requires_payment_choice and p_expense_location_id is null then 'CENTRAL_OUTSIDE_SYSTEM'
          when v_requires_payment_choice then 'BRANCH'
          else null
        end
      ),
      coalesce(p_comment, '')
    );
  end if;

  return jsonb_build_object(
    'status', lower(p_decision),
    'idempotent', false,
    'sourceType', p_source_type,
    'sourceId', p_source_id
  );
end
$$;


ALTER FUNCTION "public"."decide_time_tracking_approval"("p_source_type" "text", "p_source_id" "uuid", "p_decision" "text", "p_comment" "text", "p_expense_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_debts_daily"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_profile_id uuid;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
begin
  for v_profile_id in
    select distinct ft.profile_id
    from public.financial_transactions ft
    where ft.type in ('DEBT', 'WITHDRAWAL')
      and ft.status = 'APPROVED'
      and ft.remaining_amount > 0
  loop
    perform private.apply_time_tracking_deductions(v_profile_id, v_current_month);
  end loop;
end;
$$;


ALTER FUNCTION "public"."deduct_debts_daily"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_cash_branch_transfer"("p_transfer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  transfer_row public.money_transfers%rowtype;
  cash_row public.money_transfer_cash_details%rowtype;
  actor_id uuid := auth.uid();
  actor_name text;
  actor_phone text;
  source_name text;
  target_name text;
  requires_approval boolean;
  existing_request_id uuid;
  request_id uuid;
  report_no text;
begin
  if not private.is_active_user() then
    raise exception 'ไม่มีสิทธิ์ลบรายการเงินสด';
  end if;

  select * into transfer_row
  from public.money_transfers
  where id = p_transfer_id
  for update;

  if transfer_row.id is null
    or transfer_row.transfer_type <> 'cash'
    or transfer_row.transfer_method <> 'cash'
  then
    raise exception 'ไม่พบรายการเงินสด';
  end if;

  if not private.can_manage_location(transfer_row.location_id) then
    raise exception 'เฉพาะผู้ดูแลสาขาต้นทางหรือผู้จัดการระบบเท่านั้นที่ลบรายการเงินสดได้';
  end if;

  select * into cash_row
  from public.money_transfer_cash_details
  where transfer_id = p_transfer_id
  for update;

  if cash_row.transfer_id is null then
    raise exception 'ไม่พบรายละเอียดเงินสด';
  end if;

  report_no := private.active_transfer_report_no(p_transfer_id);
  if report_no is not null then
    perform private.raise_report_lock(report_no);
  end if;

  select id into existing_request_id
  from public.cash_transfer_delete_requests
  where transfer_id = p_transfer_id
    and request_status = 'pending'
  for update;

  if existing_request_id is not null then
    return jsonb_build_object(
      'id', p_transfer_id,
      'status', 'pending_approval',
      'requestId', existing_request_id
    );
  end if;

  select coalesce(cash_transfer_delete_requires_approval, true)
  into requires_approval
  from public.income_expense_approval_settings
  where id = true;

  if cash_row.cash_status = 'pending_receipt'
    or not coalesce(requires_approval, true)
  then
    delete from public.money_transfers where id = p_transfer_id;
    return jsonb_build_object('id', p_transfer_id, 'status', 'deleted');
  end if;

  select name, phone into actor_name, actor_phone
  from public.profiles
  where id = actor_id;
  select name into source_name
  from public.locations
  where id = transfer_row.location_id;
  select name into target_name
  from public.locations
  where id = transfer_row.target_location_id;

  insert into public.cash_transfer_delete_requests (
    transfer_id,
    source_location_id,
    source_location_name,
    target_location_id,
    target_location_name,
    transfer_display_no,
    sent_total,
    received_total,
    difference_total,
    note,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  )
  values (
    p_transfer_id,
    transfer_row.location_id,
    coalesce(source_name, 'ไม่ทราบสาขา'),
    transfer_row.target_location_id,
    coalesce(target_name, transfer_row.target_location_name, 'ไม่ทราบสาขา'),
    'CASH-' || left(p_transfer_id::text, 8),
    cash_row.sent_total,
    cash_row.received_total,
    cash_row.difference_total,
    cash_row.note,
    actor_id,
    coalesce(actor_name, ''),
    coalesce(actor_phone, '')
  )
  returning id into request_id;

  return jsonb_build_object(
    'id', p_transfer_id,
    'status', 'pending_approval',
    'requestId', request_id
  );
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
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_blocked_month text;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid deletion source';
  end if;

  if p_source_type = 'transaction' then
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;

    if v_tx.status = 'PENDING'
      and v_tx.type = 'WITHDRAWAL'
      and v_tx.profile_id = v_actor_id
    then
      null;
    elsif not private.can_manage_time_payroll_profile(v_tx.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_tx.profile_id::text, 0));
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;

    select ps.month into v_blocked_month
    from public.payroll_slips ps
    where ps.profile_id = v_tx.profile_id
      and (
        ps.month = to_char(v_tx.effective_date, 'YYYY-MM')
        or exists (
          select 1
          from public.financial_transactions child
          where child.parent_debt_id = v_tx.id
            and child.applied_month is not null
            and ps.month = to_char(child.applied_month, 'YYYY-MM')
        )
      )
    order by ps.month
    limit 1;
    if v_blocked_month is not null then
      raise exception 'MONTH_CLOSED:%', v_blocked_month;
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'financial_transactions'
      and (
        record_id = v_tx.id
        or record_id in (
          select id from public.financial_transactions where parent_debt_id = v_tx.id
        )
      );

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.financial_transactions where parent_debt_id = v_tx.id;
    delete from public.financial_transactions where id = v_tx.id;
  else
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id;
    if not found then raise exception 'Payroll slip not found'; end if;
    if not private.can_manage_time_payroll_profile(v_slip.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_slip.profile_id::text, 0));
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found then raise exception 'Payroll slip not found'; end if;

    if exists (
      select 1
      from public.payroll_slips newer
      where newer.profile_id = v_slip.profile_id and newer.month > v_slip.month
    ) then
      select min(newer.month) into v_blocked_month
      from public.payroll_slips newer
      where newer.profile_id = v_slip.profile_id and newer.month > v_slip.month;
      raise exception 'DELETE_NEWER_SLIP_FIRST:%', v_blocked_month;
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'payroll_slips' and record_id = v_slip.id;

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.payroll_slips where id = v_slip.id;
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'sourceType', p_source_type,
    'sourceId', p_source_id
  );
end
$$;


ALTER FUNCTION "public"."delete_time_tracking_source_permanently"("p_source_type" "text", "p_source_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_telegram_badge_tick"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  edge_url text;
  dispatch_secret text;
  request_id bigint;
begin
  if not exists (
    select 1
    from public.telegram_badge_settings s
    where s.id = true and s.enabled = true
  ) then
    return null;
  end if;

  select url_secret.decrypted_secret, dispatch_secret_row.decrypted_secret
  into edge_url, dispatch_secret
  from public.telegram_badge_settings s
  left join vault.decrypted_secrets url_secret on url_secret.id = s.edge_url_secret_id
  left join vault.decrypted_secrets dispatch_secret_row on dispatch_secret_row.id = s.dispatch_secret_id
  where s.id = true;

  if edge_url is null or dispatch_secret is null then
    return null;
  end if;

  select net.http_post(
    url := edge_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-lanflow-dispatch-secret', dispatch_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  into request_id;

  return request_id;
end;
$$;


ALTER FUNCTION "public"."dispatch_telegram_badge_tick"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."get_actionable_badge_counts"() RETURNS TABLE("location_id" "uuid", "module_id" "text", "item_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_can_manage_system boolean;
  v_can_use_money_transfer boolean;
  v_can_manage_time_payroll boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select
    p.role,
    p.role = 'super_admin' or p.can_access_super_admin_features = true,
    p.role = 'super_admin'
      or p.can_access_super_admin_features = true
      or p.can_access_money_transfer = true,
    p.role = 'super_admin'
      or p.can_access_super_admin_features = true
      or p.can_manage_time_payroll = true
  into v_role, v_can_manage_system, v_can_use_money_transfer, v_can_manage_time_payroll
  from public.profiles p
  where p.id = v_user_id and p.is_active = true;
  if v_role is null then raise exception 'Inactive profile'; end if;

  return query
  with accessible_locations as (
    select ul.location_id
    from public.user_locations ul
    join public.locations l on l.id = ul.location_id and l.is_active = true
    where ul.user_id = v_user_id
  ),
  scoped_time_requests as (
    select ft.id, ft.profile_id
    from public.financial_transactions ft
    where ft.status = 'PENDING'
    union all
    select ps.id, ps.profile_id
    from public.payroll_slips ps
    where ps.status = 'PENDING'
  ),
  counts as (
    select al.location_id, 'rubber'::text module_id, count(*)::bigint item_count
    from accessible_locations al
    cross join lateral private.rubber_bill_report_blockers(al.location_id, now()) b
    where v_can_manage_system or b.blocker_type = 'zero_price'
    group by al.location_id

    union all
    select t.target_location_id, 'cash', count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    join accessible_locations al on al.location_id = t.target_location_id
    where d.cash_status = 'pending_receipt' and t.record_status <> 'deleted'
    group by t.target_location_id

    union all
    select r.location_id, 'cash', count(*)::bigint
    from public.income_expense_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select r.source_location_id, 'cash', count(*)::bigint
    from public.cash_transfer_delete_requests r
    join accessible_locations al on al.location_id = r.source_location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.source_location_id

    union all
    select t.location_id, 'money-transfer', count(*)::bigint
    from public.money_transfers t
    join accessible_locations al on al.location_id = t.location_id
    where v_can_use_money_transfer
      and t.transfer_method = 'bank'
      and t.transfer_status in ('pending', 'partial', 'advance_payment')
      and t.record_status <> 'deleted'
    group by t.location_id

    union all
    select r.location_id, 'acid-stock', count(*)::bigint
    from public.stock_entry_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select al.location_id, 'acid-stock', count(r.id)::bigint
    from accessible_locations al
    cross join public.stock_product_approval_requests r
    where v_can_manage_system and r.request_status = 'pending'
    group by al.location_id

    union all
    select al.location_id, 'time-tracking', count(requests.id)::bigint
    from accessible_locations al
    cross join scoped_time_requests requests
    where v_can_manage_system
    group by al.location_id

    union all
    select target_primary.location_id, 'time-tracking', count(requests.id)::bigint
    from scoped_time_requests requests
    join public.user_locations target_primary
      on target_primary.user_id = requests.profile_id
     and target_primary.is_primary = true
    join accessible_locations al on al.location_id = target_primary.location_id
    where not v_can_manage_system
      and v_can_manage_time_payroll
      and private.can_manage_time_payroll_profile(requests.profile_id)
    group by target_primary.location_id

    union all
    select e.location_id, 'rubber-export', count(*)::bigint
    from public.rubber_exports e
    join accessible_locations al on al.location_id = e.location_id
    where (v_can_manage_system or v_role = 'admin') and e.status = 'draft'
    group by e.location_id
  )
  select c.location_id, c.module_id, sum(c.item_count)::bigint
  from counts c
  where c.item_count > 0
  group by c.location_id, c.module_id
  order by c.location_id, c.module_id;
end
$$;


ALTER FUNCTION "public"."get_actionable_badge_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_alert_thresholds"("p_location_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  thresholds public.dashboard_alert_thresholds%rowtype;
  stock_items jsonb;
begin
  perform private.dashboard_require_manager();

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.is_active = true
  ) then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน';
  end if;

  select *
  into thresholds
  from public.dashboard_alert_thresholds t
  where t.location_id = p_location_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'productId', p.id,
        'name', p.name,
        'unit', p.unit,
        'minimumBalance', st.minimum_balance
      )
      order by p.name, p.id
    ),
    '[]'::jsonb
  )
  into stock_items
  from public.stock_products p
  left join public.dashboard_stock_alert_thresholds st
    on st.product_id = p.id
   and st.location_id = p_location_id
  where p.is_active = true;

  return jsonb_build_object(
    'locationId', p_location_id,
    'purchaseAverageMin', thresholds.purchase_average_min,
    'netCashMin', coalesce(thresholds.net_cash_min, 30000),
    'stockItems', stock_items,
    'updatedAt', thresholds.updated_at,
    'updatedByName', thresholds.updated_by_name
  );
end;
$$;


ALTER FUNCTION "public"."get_dashboard_alert_thresholds"("p_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_alerts_for_telegram"() RETURNS TABLE("location_id" "uuid", "branch_name" "text", "alert_key" "text", "metric_label" "text", "current_value" numeric, "minimum_value" numeric, "unit" "text", "detail" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with branch_metrics as (
    select
      l.id as location_id,
      l.name as branch_name,
      s.summary,
      s.status,
      s.calculated_at,
      t.purchase_average_min,
      t.net_cash_min,
      'ต่ำกว่ายอดขั้นต่ำ · ผลคำนวณ '
        || to_char(
          s.calculated_at at time zone 'Asia/Bangkok',
          'DD/MM/YYYY HH24:MI'
        )
        || case
          when s.status = 'ready' then ''
          else ' · ข้อมูลกำลังรออัปเดต'
        end as alert_detail
    from public.locations l
    join public.dashboard_branch_snapshots s on s.location_id = l.id
    join public.dashboard_alert_thresholds t on t.location_id = l.id
    where l.is_active = true
      and t.is_configured = true
      and s.summary is not null
      and s.calculated_at is not null
  ),
  scalar_alerts as (
    select
      b.location_id,
      b.branch_name,
      'purchase_average_7_days'::text as alert_key,
      'ยอดซื้อเฉลี่ย 7 วัน'::text as metric_label,
      round((b.summary #>> '{purchase7Days,dailyAverage}')::numeric, 2)
        as current_value,
      b.purchase_average_min as minimum_value,
      'บาท/วัน'::text as unit,
      b.alert_detail as detail
    from branch_metrics b
    where b.purchase_average_min is not null
      and (b.summary #>> '{purchase7Days,dailyAverage}')::numeric
        < b.purchase_average_min

    union all

    select
      b.location_id,
      b.branch_name,
      'net_cash_accumulated',
      'รับ–จ่ายสุทธิสะสม',
      round((b.summary ->> 'netCashFlow')::numeric, 2),
      b.net_cash_min,
      'บาท',
      b.alert_detail
    from branch_metrics b
    where (b.summary ->> 'netCashFlow')::numeric < b.net_cash_min
  ),
  stock_alerts as (
    select
      b.location_id,
      b.branch_name,
      'stock:' || (product.item ->> 'productId') as alert_key,
      'สต็อกสินค้า · ' || (product.item ->> 'name') as metric_label,
      round((product.item ->> 'balance')::numeric, 2) as current_value,
      threshold.minimum_balance as minimum_value,
      product.item ->> 'unit' as unit,
      b.alert_detail as detail
    from branch_metrics b
    cross join lateral jsonb_array_elements(
      coalesce(b.summary #> '{stock,items}', '[]'::jsonb)
    ) product(item)
    join public.dashboard_stock_alert_thresholds threshold
      on threshold.location_id = b.location_id
     and threshold.product_id = (product.item ->> 'productId')::uuid
    where (product.item ->> 'balance')::numeric < threshold.minimum_balance
  )
  select * from scalar_alerts
  union all
  select * from stock_alerts
  order by branch_name, alert_key;
$$;


ALTER FUNCTION "public"."get_dashboard_alerts_for_telegram"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_branch_summaries"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  payload jsonb;
begin
  if not private.is_active_user() then
    raise exception 'Access denied';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'locationId', l.id,
        'snapshotStatus', s.status,
        'calculatedAt', s.calculated_at,
        'cashStatus', case
          when s.summary is null then 'no_data'
          when coalesce(t.is_configured, false) = false then 'unconfigured'
          when (s.summary ->> 'netCashFlow')::numeric < t.net_cash_min then 'low'
          else 'normal'
        end,
        'summary', case
          when s.summary is null then null
          else jsonb_build_object(
            'netCashFlow', s.summary -> 'netCashFlow',
            'rubberInventoryWeight', s.summary -> 'rubberInventoryWeight',
            'purchaseToday', s.summary -> 'purchaseToday'
          )
        end
      )
      order by l.created_at, l.id
    ),
    '[]'::jsonb
  )
  into payload
  from public.locations l
  left join public.dashboard_branch_snapshots s on s.location_id = l.id
  left join public.dashboard_alert_thresholds t on t.location_id = l.id
  where l.is_active = true
    and public.can_access_location(l.id);

  return payload;
end;
$$;


ALTER FUNCTION "public"."get_dashboard_branch_summaries"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_money_feed"("p_location_id" "uuid", "p_cursor_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_key" "text" DEFAULT NULL::"text", "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'Location access denied';
  end if;

  if (p_cursor_at is null) <> (p_cursor_key is null) then
    raise exception 'Invalid dashboard cursor';
  end if;

  return (
    with income_expense_candidates as (
      select
        coalesce(ie.client_recorded_at, ie.created_at) as occurred_at,
        'actual:' || ie.id::text as sort_key,
        ie.id::text as id,
        ie.type::text as kind,
        coalesce(
          ie.number,
          ie.server_bill_no,
          ie.local_bill_no,
          left(ie.id::text, 8)
        ) as number,
        ie.title,
        ie.type::text as direction,
        ie.cost as amount,
        ie.created_by_name
      from public.income_expense ie
      where ie.location_id = p_location_id
        and ie.record_status = 'active'
        and ie.cost > 0
        and (
          p_cursor_at is null
          or (
            coalesce(ie.client_recorded_at, ie.created_at),
            'actual:' || ie.id::text
          ) < (p_cursor_at, p_cursor_key)
        )
      order by
        coalesce(ie.client_recorded_at, ie.created_at) desc,
        'actual:' || ie.id::text desc
      limit page_size + 1
    ),
    branch_transfer_in_candidates as (
      select
        mt.created_at as occurred_at,
        'branch-transfer-in:' || mt.id::text as sort_key,
        'branch-transfer-in:' || mt.id::text as id,
        'transfer_in'::text as kind,
        'TR-' || left(mt.id::text, 8) as number,
        'รับโอนเงินเข้าสาขา'::text as title,
        'income'::text as direction,
        mt.net_amount_to_pay as amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน') as created_by_name
      from public.money_transfers mt
      where mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0
        and (
          p_cursor_at is null
          or (mt.created_at, 'branch-transfer-in:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by mt.created_at desc, 'branch-transfer-in:' || mt.id::text desc
      limit page_size + 1
    ),
    branch_transfer_out_candidates as (
      select
        mt.created_at as occurred_at,
        'branch-transfer-out:' || mt.id::text as sort_key,
        'branch-transfer-out:' || mt.id::text as id,
        'transfer_out'::text as kind,
        'TR-' || left(mt.id::text, 8) as number,
        'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง')
          as title,
        'expense'::text as direction,
        mt.net_amount_to_pay as amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน') as created_by_name
      from public.money_transfers mt
      where mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.location_id = p_location_id
        and mt.target_location_id <> mt.location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0
        and (
          p_cursor_at is null
          or (mt.created_at, 'branch-transfer-out:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by mt.created_at desc, 'branch-transfer-out:' || mt.id::text desc
      limit page_size + 1
    ),
    customer_paid_candidates as (
      select
        mt.created_at as occurred_at,
        'customer-branch-paid:' || mt.id::text as sort_key,
        'customer-branch-paid:' || mt.id::text as id,
        'transfer_out'::text as kind,
        'CT-' || left(mt.id::text, 8) as number,
        'สาขาจ่ายส่วนต่างให้ ' || coalesce(mt.customer_name, 'ลูกค้า') as title,
        'expense'::text as direction,
        mt.branch_paid_amount as amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน') as created_by_name
      from public.money_transfers mt
      where mt.transfer_type = 'customer'
        and mt.transfer_status = 'branch_and_transfer'
        and mt.location_id = p_location_id
        and mt.record_status <> 'deleted'
        and mt.branch_paid_amount > 0
        and (
          p_cursor_at is null
          or (mt.created_at, 'customer-branch-paid:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by mt.created_at desc, 'customer-branch-paid:' || mt.id::text desc
      limit page_size + 1
    ),
    cash_out_candidates as (
      select
        d.sent_at as occurred_at,
        'cash-transfer-out:' || mt.id::text as sort_key,
        'cash-transfer-out:' || mt.id::text as id,
        'transfer_out'::text as kind,
        'CASH-' || left(mt.id::text, 8) as number,
        'โยกเงินสดไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง')
          as title,
        'expense'::text as direction,
        d.sent_total as amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน') as created_by_name
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.location_id = p_location_id
        and mt.record_status <> 'deleted'
        and d.sent_total > 0
        and (
          p_cursor_at is null
          or (d.sent_at, 'cash-transfer-out:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by d.sent_at desc, 'cash-transfer-out:' || mt.id::text desc
      limit page_size + 1
    ),
    cash_in_candidates as (
      select
        d.received_at as occurred_at,
        'cash-transfer-in:' || mt.id::text as sort_key,
        'cash-transfer-in:' || mt.id::text as id,
        'transfer_in'::text as kind,
        'CASH-' || left(mt.id::text, 8) as number,
        'รับโอนเงินสดเข้าสาขา'::text as title,
        'income'::text as direction,
        d.received_total as amount,
        coalesce(
          d.received_by_name,
          mt.created_by_name,
          'ระบบโอนเงิน'
        ) as created_by_name
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted'
        and d.cash_status in ('received', 'mismatched', 'difference_accepted')
        and d.received_total > 0
        and (
          p_cursor_at is null
          or (d.received_at, 'cash-transfer-in:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by d.received_at desc, 'cash-transfer-in:' || mt.id::text desc
      limit page_size + 1
    ),
    withdrawal_candidates as (
      select
        ft.approved_at as occurred_at,
        'withdrawal:' || ft.id::text as sort_key,
        'withdrawal:' || ft.id::text as id,
        'expense'::text as kind,
        'TW-' || left(ft.id::text, 8) as number,
        'เบิกเงิน — ' || coalesce(p.name, 'พนักงาน')
          || coalesce(': ' || nullif(ft.description, ''), '') as title,
        'expense'::text as direction,
        ft.amount,
        coalesce(p.name, 'พนักงาน') as created_by_name
      from public.financial_transactions ft
      join public.profiles p on p.id = ft.profile_id
      where ft.type = 'WITHDRAWAL'
        and ft.status = 'APPROVED'
        and ft.cancelled_at is null
        and ft.expense_location_id = p_location_id
        and ft.amount > 0
        and (
          p_cursor_at is null
          or (ft.approved_at, 'withdrawal:' || ft.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by ft.approved_at desc, 'withdrawal:' || ft.id::text desc
      limit page_size + 1
    ),
    payroll_candidates as (
      select
        ps.approved_at as occurred_at,
        'payroll:' || ps.id::text as sort_key,
        'payroll:' || ps.id::text as id,
        'expense'::text as kind,
        'PS-' || left(ps.id::text, 8) as number,
        'เงินเดือน — ' || coalesce(p.name, 'พนักงาน') || ' — ' || ps.month
          as title,
        'expense'::text as direction,
        ps.net_pay as amount,
        coalesce(p.name, 'พนักงาน') as created_by_name
      from public.payroll_slips ps
      join public.profiles p on p.id = ps.profile_id
      where ps.status = 'APPROVED'
        and ps.cancelled_at is null
        and ps.expense_location_id = p_location_id
        and ps.net_pay > 0
        and (
          p_cursor_at is null
          or (ps.approved_at, 'payroll:' || ps.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by ps.approved_at desc, 'payroll:' || ps.id::text desc
      limit page_size + 1
    ),
    rubber_bill_candidates as (
      select
        coalesce(b.client_recorded_at, b.created_at) as occurred_at,
        'rubber-bill:' || b.id::text as sort_key,
        'rubber-bill:' || b.id::text as id,
        'rubber_bill'::text as kind,
        coalesce(
          b.server_bill_no,
          nullif(b.local_bill_no, ''),
          nullif(b.bill_no, ''),
          left(b.id::text, 8)
        ) as number,
        'รับซื้อยาง — ' || coalesce(nullif(b.customer_name, ''), 'ไม่ระบุลูกค้า')
          as title,
        'expense'::text as direction,
        b.net_total as amount,
        b.created_by_name
      from public.rubber_bills b
      where b.location_id = p_location_id
        and b.record_status = 'active'
        and private.rubber_bill_is_payable(b.id)
        and (
          p_cursor_at is null
          or (
            coalesce(b.client_recorded_at, b.created_at),
            'rubber-bill:' || b.id::text
          ) < (p_cursor_at, p_cursor_key)
        )
      order by
        coalesce(b.client_recorded_at, b.created_at) desc,
        'rubber-bill:' || b.id::text desc
      limit page_size + 1
    ),
    ocr_candidates as (
      select
        coalesce(ot.client_recorded_at, ot.created_at) as occurred_at,
        'ocr-ticket:' || ot.id::text as sort_key,
        'ocr-ticket:' || ot.id::text as id,
        'rubber_bill'::text as kind,
        coalesce(nullif(ot.ticket_id, ''), left(ot.id::text, 8)) as number,
        'รับซื้อยางจากใบชั่ง — '
          || coalesce(nullif(ot.customer_name, ''), 'ไม่ระบุลูกค้า') as title,
        'expense'::text as direction,
        ot.total_amount as amount,
        ot.created_by_name
      from public.ocr_tickets ot
      where ot.location_id = p_location_id
        and ot.record_status = 'active'
        and ot.total_amount > 0
        and (
          p_cursor_at is null
          or (
            coalesce(ot.client_recorded_at, ot.created_at),
            'ocr-ticket:' || ot.id::text
          ) < (p_cursor_at, p_cursor_key)
        )
      order by
        coalesce(ot.client_recorded_at, ot.created_at) desc,
        'ocr-ticket:' || ot.id::text desc
      limit page_size + 1
    ),
    export_candidates as (
      select
        e.verified_at as occurred_at,
        'rubber-export:' || e.id::text as sort_key,
        'rubber-export:' || e.id::text as id,
        'rubber_export'::text as kind,
        e.export_no as number,
        'ค่าทำงานส่งออกยาง — ' || e.export_no as title,
        'expense'::text as direction,
        e.work_total as amount,
        e.created_by_name
      from public.rubber_exports e
      where e.location_id = p_location_id
        and e.status = 'verified'
        and e.expense_destination = 'branch'
        and e.work_total > 0
        and (
          p_cursor_at is null
          or (e.verified_at, 'rubber-export:' || e.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by e.verified_at desc, 'rubber-export:' || e.id::text desc
      limit page_size + 1
    ),
    candidates as (
      select * from income_expense_candidates
      union all select * from branch_transfer_in_candidates
      union all select * from branch_transfer_out_candidates
      union all select * from customer_paid_candidates
      union all select * from cash_out_candidates
      union all select * from cash_in_candidates
      union all select * from withdrawal_candidates
      union all select * from payroll_candidates
      union all select * from rubber_bill_candidates
      union all select * from ocr_candidates
      union all select * from export_candidates
    ),
    page as (
      select *
      from candidates
      order by occurred_at desc, sort_key desc
      limit page_size + 1
    )
    select jsonb_build_object(
      'rows',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'kind', kind,
            'number', number,
            'title', title,
            'direction', direction,
            'amount', round(amount, 2),
            'occurredAt', occurred_at,
            'createdByName', created_by_name
          )
          order by occurred_at desc, sort_key desc
        )
        from (
          select *
          from page
          order by occurred_at desc, sort_key desc
          limit page_size
        ) visible
      ), '[]'::jsonb),
      'nextCursor',
      case
        when (select count(*) from page) > page_size then (
          select jsonb_build_object('at', occurred_at, 'key', sort_key)
          from page
          order by occurred_at desc, sort_key desc
          offset page_size - 1
          limit 1
        )
        else null
      end
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_dashboard_money_feed"("p_location_id" "uuid", "p_cursor_at" timestamp with time zone, "p_cursor_key" "text", "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_overview"("p_location_id" "uuid", "p_cursor_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cursor_key" "text" DEFAULT NULL::"text", "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  v_from date := v_today - 6;
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;

  if (p_cursor_at is null) <> (p_cursor_key is null) then
    raise exception 'Invalid dashboard cursor';
  end if;

  return (
    with active_bills as (
      select b.*
      from public.rubber_bills b
      where b.location_id = p_location_id
        and b.record_status = 'active'
    ),
    payable_bills as (
      select b.*
      from active_bills b
      where private.rubber_bill_is_payable(b.id)
    ),
    purchase_stats as (
      select
        (select count(*) from active_bills b where b.bill_date = v_today) as today_bill_count,
        (select coalesce(sum(b.net_weight), 0) from active_bills b where b.bill_date = v_today) as today_net_weight,
        (select coalesce(sum(b.net_total), 0) from payable_bills b where b.bill_date = v_today) as today_paid_total,
        (select coalesce(sum(b.net_weight), 0) from payable_bills b where b.bill_date between v_from and v_today) as seven_day_net_weight,
        (select coalesce(sum(b.net_total), 0) from payable_bills b where b.bill_date between v_from and v_today) as seven_day_paid_total,
        (select coalesce(sum(b.net_weight), 0) from active_bills b) as accumulated_net_weight
    ),
    export_stats as (
      select
        coalesce(sum(e.original_weight_total) filter (where e.status = 'verified'), 0) as accumulated_original_weight,
        count(*) filter (
          where e.status = 'verified'
            and (e.verified_at at time zone 'Asia/Bangkok')::date between v_from and v_today
        ) as seven_day_export_count,
        coalesce(sum(e.original_weight_total - e.current_weight) filter (
          where e.status = 'verified'
            and (e.verified_at at time zone 'Asia/Bangkok')::date between v_from and v_today
        ), 0) as seven_day_loss_weight,
        coalesce(sum(e.original_weight_total) filter (
          where e.status = 'verified'
            and (e.verified_at at time zone 'Asia/Bangkok')::date between v_from and v_today
        ), 0) as seven_day_original_weight
      from public.rubber_exports e
      where e.location_id = p_location_id
    ),
    stock_balances as (
      select
        p.id,
        p.name,
        p.unit,
        round(coalesce(sum(m.quantity_delta), 0), 2) as balance
      from public.stock_products p
      left join public.stock_movements m
        on m.product_id = p.id
       and m.location_id = p_location_id
      where p.is_active = true
      group by p.id, p.name, p.unit
    ),
    stock_summary as (
      select
        count(*) filter (where balance > 0) as in_stock_count,
        count(*) filter (where balance <= 0) as out_of_stock_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'productId', id,
              'name', name,
              'unit', unit,
              'balance', balance
            )
            order by (balance <= 0) desc, name, id
          ),
          '[]'::jsonb
        ) as items
      from stock_balances
    ),
    financial_events as (
      select
        coalesce(ie.client_recorded_at, ie.created_at) as occurred_at,
        ie.tx_date as business_date,
        'actual:' || ie.id::text as sort_key,
        ie.id::text as id,
        ie.type::text as kind,
        coalesce(ie.number, ie.server_bill_no, ie.local_bill_no, left(ie.id::text, 8)) as number,
        ie.title,
        ie.type::text as direction,
        ie.cost as amount,
        ie.created_by_name,
        true as affects_balance,
        ie.type = 'expense' as operating_expense
      from public.income_expense ie
      where ie.location_id = p_location_id
        and ie.record_status = 'active'
        and ie.cost > 0

      union all

      select
        mt.created_at,
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'branch-transfer-in:' || mt.id::text,
        'branch-transfer-in:' || mt.id::text,
        'transfer_in',
        'TR-' || left(mt.id::text, 8),
        'รับโอนเงินเข้าสาขา',
        'income',
        mt.net_amount_to_pay,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      where mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0

      union all

      select
        mt.created_at,
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'branch-transfer-out:' || mt.id::text,
        'branch-transfer-out:' || mt.id::text,
        'transfer_out',
        'TR-' || left(mt.id::text, 8),
        'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
        'expense',
        mt.net_amount_to_pay,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      where mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.location_id = p_location_id
        and mt.target_location_id <> mt.location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0

      union all

      select
        mt.created_at,
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'customer-branch-paid:' || mt.id::text,
        'customer-branch-paid:' || mt.id::text,
        'transfer_out',
        'CT-' || left(mt.id::text, 8),
        'สาขาจ่ายส่วนต่างให้ ' || coalesce(mt.customer_name, 'ลูกค้า'),
        'expense',
        mt.branch_paid_amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      where mt.transfer_type = 'customer'
        and mt.transfer_status = 'branch_and_transfer'
        and mt.location_id = p_location_id
        and mt.record_status <> 'deleted'
        and mt.branch_paid_amount > 0

      union all

      select
        d.sent_at,
        (d.sent_at at time zone 'Asia/Bangkok')::date,
        'cash-transfer-out:' || mt.id::text,
        'cash-transfer-out:' || mt.id::text,
        'transfer_out',
        'CASH-' || left(mt.id::text, 8),
        'โยกเงินสดไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
        'expense',
        d.sent_total,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.location_id = p_location_id
        and mt.record_status <> 'deleted'
        and d.sent_total > 0

      union all

      select
        d.received_at,
        (d.received_at at time zone 'Asia/Bangkok')::date,
        'cash-transfer-in:' || mt.id::text,
        'cash-transfer-in:' || mt.id::text,
        'transfer_in',
        'CASH-' || left(mt.id::text, 8),
        'รับโอนเงินสดเข้าสาขา',
        'income',
        d.received_total,
        coalesce(d.received_by_name, mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted'
        and d.cash_status in ('received', 'mismatched', 'difference_accepted')
        and d.received_total > 0

      union all

      select
        ft.approved_at,
        (ft.approved_at at time zone 'Asia/Bangkok')::date,
        'withdrawal:' || ft.id::text,
        'withdrawal:' || ft.id::text,
        'expense',
        'TW-' || left(ft.id::text, 8),
        'เบิกเงิน — ' || coalesce(p.name, 'พนักงาน') ||
          coalesce(': ' || nullif(ft.description, ''), ''),
        'expense',
        ft.amount,
        coalesce(p.name, 'พนักงาน'),
        true,
        true
      from public.financial_transactions ft
      join public.profiles p on p.id = ft.profile_id
      where ft.type = 'WITHDRAWAL'
        and ft.status = 'APPROVED'
        and ft.cancelled_at is null
        and ft.expense_location_id = p_location_id
        and ft.amount > 0

      union all

      select
        ps.approved_at,
        (ps.approved_at at time zone 'Asia/Bangkok')::date,
        'payroll:' || ps.id::text,
        'payroll:' || ps.id::text,
        'expense',
        'PS-' || left(ps.id::text, 8),
        'เงินเดือน — ' || coalesce(p.name, 'พนักงาน') || ' — ' || ps.month,
        'expense',
        ps.net_pay,
        coalesce(p.name, 'พนักงาน'),
        true,
        true
      from public.payroll_slips ps
      join public.profiles p on p.id = ps.profile_id
      where ps.status = 'APPROVED'
        and ps.cancelled_at is null
        and ps.expense_location_id = p_location_id
        and ps.net_pay > 0

      union all

      select
        coalesce(b.client_recorded_at, b.created_at),
        b.bill_date,
        'rubber-bill:' || b.id::text,
        'rubber-bill:' || b.id::text,
        'rubber_bill',
        coalesce(b.server_bill_no, nullif(b.local_bill_no, ''), nullif(b.bill_no, ''), left(b.id::text, 8)),
        'รับซื้อยาง — ' || coalesce(nullif(b.customer_name, ''), 'ไม่ระบุลูกค้า'),
        'expense',
        b.net_total,
        b.created_by_name,
        not exists (
          select 1
          from public.money_transfer_items i
          where i.source_type = 'rubber_bill'
            and i.source_id = b.id
        ),
        false
      from payable_bills b

      union all

      select
        coalesce(ot.client_recorded_at, ot.created_at),
        ot.date_in,
        'ocr-ticket:' || ot.id::text,
        'ocr-ticket:' || ot.id::text,
        'rubber_bill',
        coalesce(nullif(ot.ticket_id, ''), left(ot.id::text, 8)),
        'รับซื้อยางจากใบชั่ง — ' || coalesce(nullif(ot.customer_name, ''), 'ไม่ระบุลูกค้า'),
        'expense',
        ot.total_amount,
        ot.created_by_name,
        not exists (
          select 1
          from public.money_transfer_items i
          where i.source_type = 'ocr_ticket'
            and i.source_id = ot.id
        ),
        false
      from public.ocr_tickets ot
      where ot.location_id = p_location_id
        and ot.record_status = 'active'
        and ot.total_amount > 0

      union all

      select
        e.verified_at,
        (e.verified_at at time zone 'Asia/Bangkok')::date,
        'rubber-export:' || e.id::text,
        'rubber-export:' || e.id::text,
        'rubber_export',
        e.export_no,
        'ค่าทำงานส่งออกยาง — ' || e.export_no,
        'expense',
        e.work_total,
        e.created_by_name,
        true,
        true
      from public.rubber_exports e
      where e.location_id = p_location_id
        and e.status = 'verified'
        and e.expense_destination = 'branch'
        and e.work_total > 0
    ),
    financial_totals as (
      select coalesce(sum(
        case
          when not affects_balance then 0
          when direction = 'income' then amount
          else -amount
        end
      ), 0) as net_cash_flow
      from financial_events
    ),
    operating_stats as (
      select coalesce(sum(amount), 0) as accumulated_expense
      from financial_events
      where operating_expense
    ),
    filtered_events as (
      select *
      from financial_events
      where p_cursor_at is null
         or (occurred_at, sort_key) < (p_cursor_at, p_cursor_key)
    ),
    numbered_events as (
      select
        *,
        row_number() over (order by occurred_at desc, sort_key desc) as row_no
      from filtered_events
    ),
    page as (
      select *
      from numbered_events
      where row_no <= v_page_size + 1
    )
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'purchaseToday', jsonb_build_object(
          'billCount', ps.today_bill_count,
          'netWeight', round(ps.today_net_weight, 2),
          'paidTotal', round(ps.today_paid_total, 2)
        ),
        'purchase7Days', jsonb_build_object(
          'paidTotal', round(ps.seven_day_paid_total, 2),
          'dailyAverage', round(ps.seven_day_paid_total / 7, 2),
          'netWeight', round(ps.seven_day_net_weight, 2),
          'averageCostPerKg', case
            when ps.seven_day_net_weight > 0
              then round(ps.seven_day_paid_total / ps.seven_day_net_weight, 2)
            else null
          end
        ),
        'netCashFlow', round(ft.net_cash_flow, 2),
        'operatingExpenseAccumulated', round(os.accumulated_expense, 2),
        'rubberInventoryWeight', round(
          ps.accumulated_net_weight - es.accumulated_original_weight,
          2
        ),
        'waterLoss7Days', jsonb_build_object(
          'exportCount', es.seven_day_export_count,
          'weight', round(es.seven_day_loss_weight, 2),
          'percent', case
            when es.seven_day_original_weight > 0
              then round(es.seven_day_loss_weight / es.seven_day_original_weight * 100, 2)
            else null
          end
        ),
        'stock', jsonb_build_object(
          'inStockCount', ss.in_stock_count,
          'outOfStockCount', ss.out_of_stock_count,
          'items', ss.items
        )
      ),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'kind', kind,
            'number', number,
            'title', title,
            'direction', direction,
            'amount', round(amount, 2),
            'occurredAt', occurred_at,
            'createdByName', created_by_name
          )
          order by occurred_at desc, sort_key desc
        )
        from page
        where row_no <= v_page_size
      ), '[]'::jsonb),
      'nextCursor', case
        when (select count(*) from page) > v_page_size then (
          select jsonb_build_object('at', occurred_at, 'key', sort_key)
          from page
          where row_no = v_page_size
        )
        else null
      end
    )
    from purchase_stats ps
    cross join export_stats es
    cross join stock_summary ss
    cross join financial_totals ft
    cross join operating_stats os
  );
end;
$$;


ALTER FUNCTION "public"."get_dashboard_overview"("p_location_id" "uuid", "p_cursor_at" timestamp with time zone, "p_cursor_key" "text", "p_page_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_refresh_settings"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  settings public.dashboard_refresh_settings%rowtype;
begin
  perform private.dashboard_require_manager();

  select *
  into strict settings
  from public.dashboard_refresh_settings
  where id = true;

  return jsonb_build_object(
    'intervalMinutes', settings.interval_minutes,
    'updatedAt', settings.updated_at,
    'updatedByName', settings.updated_by_name
  );
end;
$$;


ALTER FUNCTION "public"."get_dashboard_refresh_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_snapshot"("p_location_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  snapshot public.dashboard_branch_snapshots%rowtype;
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'Location access denied';
  end if;

  select *
  into snapshot
  from public.dashboard_branch_snapshots s
  where s.location_id = p_location_id;

  if snapshot.location_id is null then
    return jsonb_build_object(
      'status', 'dirty',
      'sourceVersion', 1,
      'snapshotVersion', 0,
      'summary', null,
      'calculatedAt', null,
      'manualRequestedAt', null,
      'lastError', null
    );
  end if;

  return jsonb_build_object(
    'status', snapshot.status,
    'sourceVersion', snapshot.source_version,
    'snapshotVersion', snapshot.snapshot_version,
    'summary', snapshot.summary,
    'calculatedAt', snapshot.calculated_at,
    'manualRequestedAt', snapshot.manual_requested_at,
    'lastError', snapshot.last_error
  );
end;
$$;


ALTER FUNCTION "public"."get_dashboard_snapshot"("p_location_id" "uuid") OWNER TO "postgres";


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
          and private.rubber_bill_is_payable(rb.id)
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


CREATE OR REPLACE FUNCTION "public"."get_money_transfer_receipt_source_details"("p_transfer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_location_id uuid;
  v_items jsonb;
begin
  if not private.is_active_user() then
    raise exception 'Unauthorized or inactive user';
  end if;

  if not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;

  select t.location_id
  into v_location_id
  from public.money_transfers t
  where t.id = p_transfer_id
    and t.record_status <> 'deleted';

  if v_location_id is null then
    raise exception 'Money transfer not found';
  end if;

  if not private.can_access_location(v_location_id) then
    raise exception 'Location access denied';
  end if;

  if exists (
    select 1
    from public.money_transfer_items i
    left join public.rubber_bills rb on rb.id = i.rubber_bill_id
    left join public.ocr_tickets ot on ot.id = i.ocr_ticket_id
    where i.transfer_id = p_transfer_id
      and (
        (i.source_type = 'rubber_bill' and rb.id is null)
        or (i.source_type = 'ocr_ticket' and ot.id is null)
        or (i.source_type = 'rubber_bill' and rb.location_id <> v_location_id)
        or (i.source_type = 'ocr_ticket' and ot.location_id <> v_location_id)
        or (i.source_type = 'rubber_bill' and rb.record_status = 'deleted')
        or (i.source_type = 'ocr_ticket' and ot.record_status = 'deleted')
      )
  ) then
    raise exception 'Money transfer source is missing or belongs to another location';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'itemId', i.id,
        'sourceType', i.source_type,
        'sourceId', i.source_id,
        'netWeightAfterDeduction',
          case
            when i.source_type = 'rubber_bill' then rb.net_weight
            else coalesce(ot.weight_remaining, 0)
          end,
        'deductedAmount',
          case
            when i.source_type = 'rubber_bill' then rb.deduction_total
            else ot.money_deducted
          end,
        'netPayableAmount',
          case
            when i.source_type = 'rubber_bill' then rb.net_total
            else coalesce(ot.total_amount, 0) - coalesce(ot.money_deducted, 0)
          end
      )
      order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
  into v_items
  from public.money_transfer_items i
  left join public.rubber_bills rb on rb.id = i.rubber_bill_id
  left join public.ocr_tickets ot on ot.id = i.ocr_ticket_id
  where i.transfer_id = p_transfer_id;

  return jsonb_build_object(
    'transferId', p_transfer_id,
    'items', v_items
  );
end;
$$;


ALTER FUNCTION "public"."get_money_transfer_receipt_source_details"("p_transfer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_report_income_expense_rows"("p_report_id" "uuid") RETURNS TABLE("tx_date" "date", "number" "text", "entry_type" "text", "title" "text", "amount" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_report public.report_batches%rowtype;
begin
  select b.*
  into v_report
  from public.report_batches b
  where b.id = p_report_id;

  if v_report.id is null or not private.can_manage_reports(v_report.location_id) then
    raise exception 'ไม่มีสิทธิ์ดูรายงานนี้';
  end if;

  return query
  with rows as (
    select
      0 as row_order,
      (previous.cutoff_at at time zone 'Asia/Bangkok')::date as tx_date,
      previous.report_no as number,
      case when v_report.opening_balance >= 0 then 'income' else 'expense' end as entry_type,
      'ยอดยกมา'::text as title,
      abs(v_report.opening_balance) as amount,
      '00-opening-balance'::text as sort_key
    from public.report_batches previous
    where previous.id = v_report.previous_report_id

    union all

    select
      1,
      period.tx_date,
      period.number,
      period.entry_type,
      period.title,
      period.amount,
      period.sort_key
    from private.report_income_expense_period_rows(p_report_id) period
  )
  select
    rows.tx_date,
    rows.number,
    rows.entry_type,
    rows.title,
    rows.amount
  from rows
  order by rows.row_order, rows.tx_date, rows.sort_key;
end;
$$;


ALTER FUNCTION "public"."get_report_income_expense_rows"("p_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rubber_export_available_bills"("p_location_id" "uuid") RETURNS TABLE("report_item_id" "uuid", "bill_id" "uuid", "bill_date" "date", "bill_no" "text", "customer_name" "text", "eligibility_at" timestamp with time zone, "net_weight" numeric, "paid_amount" numeric)
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
    c.eligibility_at,
    c.net_weight,
    c.paid_amount
  from private.rubber_export_candidates(p_location_id, null) c;
end;
$$;


ALTER FUNCTION "public"."get_rubber_export_available_bills"("p_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(sum(quantity_delta), 0)
  from public.stock_movements
  where location_id = p_location_id
    and product_id = p_product_id;
$$;


ALTER FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_telegram_badge_config"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  settings public.telegram_badge_settings%rowtype;
  catalog jsonb;
begin
  perform private.telegram_badge_require_manager();

  select * into strict settings
  from public.telegram_badge_settings
  where id = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', c.badge_key,
        'moduleLabel', c.module_name,
        'statusLabel', c.status_label,
        'sortOrder', c.sort_order,
        'enabled', c.badge_key = any(settings.enabled_badge_keys)
      )
      order by c.sort_order
    ),
    '[]'::jsonb
  )
  into catalog
  from public.telegram_badge_catalog c;

  return jsonb_build_object(
    'enabled', settings.enabled,
    'chatId', coalesce(settings.chat_id, ''),
    'startTime', to_char(settings.start_time, 'HH24:MI'),
    'endTime', to_char(settings.end_time, 'HH24:MI'),
    'intervalMinutes', settings.interval_minutes,
    'enabledBadgeKeys', to_jsonb(settings.enabled_badge_keys),
    'tokenConfigured', settings.bot_token_secret_id is not null,
    'catalog', catalog,
    'lastAttemptAt', settings.last_attempt_at,
    'lastSuccessAt', settings.last_success_at,
    'lastError', settings.last_error,
    'updatedAt', settings.updated_at,
    'updatedByName', settings.updated_by_name
  );
end;
$$;


ALTER FUNCTION "public"."get_telegram_badge_config"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_telegram_badge_counts"() RETURNS TABLE("badge_key" "text", "location_id" "uuid", "branch_name" "text", "module_name" "text", "status_label" "text", "item_count" bigint, "sort_order" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with enabled as (
    select c.badge_key, c.module_name, c.status_label, c.sort_order
    from public.telegram_badge_catalog c
    join public.telegram_badge_settings s
      on s.id = true and c.badge_key = any(s.enabled_badge_keys)
  ),
  pending as (
    select 'rubber_bill_approval_pending'::text badge_key,
      r.location_id, coalesce(l.name, 'ส่วนกลาง') branch_name, count(*)::bigint item_count
    from public.rubber_bill_approval_requests r
    left join public.locations l on l.id = r.location_id
    where r.request_status = 'pending'
    group by r.location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'income_expense_approval_pending',
      r.location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.income_expense_approval_requests r
    left join public.locations l on l.id = r.location_id
    where r.request_status = 'pending'
    group by r.location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'cash_transfer_pending_receipt',
      t.target_location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    left join public.locations l on l.id = t.target_location_id
    where d.cash_status = 'pending_receipt' and t.record_status <> 'deleted'
    group by t.target_location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'cash_transfer_mismatched',
      t.target_location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    left join public.locations l on l.id = t.target_location_id
    where d.cash_status = 'mismatched' and t.record_status <> 'deleted'
    group by t.target_location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'stock_approval_pending', null::uuid, 'ส่วนกลาง', count(*)::bigint
    from public.stock_product_approval_requests r
    where r.request_status = 'pending'
    having count(*) > 0

    union all
    select 'stock_approval_pending',
      r.location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.stock_entry_approval_requests r
    left join public.locations l on l.id = r.location_id
    where r.request_status = 'pending'
    group by r.location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select
      case t.transfer_status
        when 'pending' then 'money_transfer_pending'
        when 'partial' then 'money_transfer_partial'
        else 'money_transfer_advance'
      end,
      t.location_id,
      coalesce(l.name, 'ส่วนกลาง'),
      count(*)::bigint
    from public.money_transfers t
    left join public.locations l on l.id = t.location_id
    where t.transfer_method = 'bank'
      and t.transfer_status in ('pending', 'partial', 'advance_payment')
      and t.record_status <> 'deleted'
    group by t.transfer_status, t.location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'time_tracking_approval_pending', null::uuid, 'ส่วนกลาง', count(*)::bigint
    from (
      select id from public.financial_transactions where status = 'PENDING'
      union all
      select id from public.payroll_slips where status = 'PENDING'
    ) requests
    having count(*) > 0

    union all
    select 'rubber_export_draft',
      e.location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.rubber_exports e
    left join public.locations l on l.id = e.location_id
    where e.status = 'draft'
    group by e.location_id, coalesce(l.name, 'ส่วนกลาง')
  )
  select e.badge_key, p.location_id, p.branch_name, e.module_name, e.status_label,
    sum(p.item_count)::bigint item_count, e.sort_order
  from pending p
  join enabled e on e.badge_key = p.badge_key
  where p.item_count > 0
  group by e.badge_key, p.location_id, p.branch_name, e.module_name, e.status_label, e.sort_order
  order by
    case when p.branch_name = 'ส่วนกลาง' then 1 else 0 end,
    p.branch_name,
    e.sort_order
$$;


ALTER FUNCTION "public"."get_telegram_badge_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_telegram_badge_delivery_credentials"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  token_value text;
  target_chat_id text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select ds.decrypted_secret, s.chat_id
  into token_value, target_chat_id
  from public.telegram_badge_settings s
  left join vault.decrypted_secrets ds on ds.id = s.bot_token_secret_id
  where s.id = true;

  return jsonb_build_object('botToken', token_value, 'chatId', target_chat_id);
end;
$$;


ALTER FUNCTION "public"."get_telegram_badge_delivery_credentials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_time_payroll_payment_locations"() RETURNS TABLE("id" "uuid", "name" "text", "code" "text", "active" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select l.id, l.name, l.code, l.is_active
  from public.locations l
  where private.has_time_payroll_manager_access()
    and l.is_active = true
  order by l.created_at, l.id
$$;


ALTER FUNCTION "public"."get_time_payroll_payment_locations"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."preview_rubber_export"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
  v_items jsonb;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;

  perform private.validate_rubber_export_selection(
    p_location_id,
    p_selected_report_item_ids
  );

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
  from private.rubber_export_candidates(
    p_location_id,
    p_selected_report_item_ids
  ) c;

  if coalesce(v_item_count, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;

  return jsonb_build_object(
    'itemCount', v_item_count,
    'originalWeightTotal', v_original_weight,
    'paidTotal', v_paid_total,
    'averagePrice', round(v_paid_total / v_original_weight, 2),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."preview_rubber_export"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_location"("p_request_id" "uuid", "p_name" "text", "p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  normalized_name text :=
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(p_name, '')),
      '[[:space:]]+',
      ' ',
      'g'
    );
  normalized_code text :=
    pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')));
  location public.locations%rowtype;
  replayed boolean := false;
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
  then
    raise exception 'BRANCH_FORBIDDEN'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'BRANCH_REQUEST_ID_REQUIRED'
      using errcode = '22023';
  end if;

  if normalized_name = '' or char_length(normalized_name) > 100 then
    raise exception 'BRANCH_NAME_INVALID'
      using errcode = '22023';
  end if;

  if normalized_code !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'BRANCH_CODE_INVALID'
      using errcode = '22023';
  end if;

  select l.*
  into location
  from public.locations l
  where l.provision_request_id = p_request_id;

  if found then
    replayed := true;
  else
    insert into public.locations (
      name,
      code,
      is_active,
      created_by,
      provision_request_id
    )
    values (
      normalized_name,
      normalized_code,
      true,
      auth.uid(),
      p_request_id
    )
    on conflict (provision_request_id) do nothing
    returning * into location;

    if not found then
      select l.*
      into strict location
      from public.locations l
      where l.provision_request_id = p_request_id;
      replayed := true;
    else
      insert into public.user_locations (
        user_id,
        location_id,
        assigned_by,
        is_primary
      )
      values (
        auth.uid(),
        location.id,
        auth.uid(),
        false
      );
    end if;
  end if;

  if location.created_by is distinct from auth.uid()
    or location.name is distinct from normalized_name
    or location.code is distinct from normalized_code
  then
    raise exception 'BRANCH_IDEMPOTENCY_CONFLICT'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'location',
    jsonb_build_object(
      'id', location.id,
      'name', location.name,
      'code', location.code,
      'active', location.is_active
    ),
    'replayed', replayed
  );
end;
$_$;


ALTER FUNCTION "public"."provision_location"("p_request_id" "uuid", "p_name" "text", "p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_dashboard_refresh"("p_location_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  location_active boolean;
begin
  perform private.dashboard_require_manager();

  select l.is_active
  into location_active
  from public.locations l
  where l.id = p_location_id;

  if coalesce(location_active, false) = false then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน';
  end if;

  insert into public.dashboard_branch_snapshots (
    location_id,
    status,
    source_version,
    manual_requested_at
  )
  values (
    p_location_id,
    'queued',
    1,
    now()
  )
  on conflict (location_id) do update
  set status = case
        when dashboard_branch_snapshots.status = 'running' then 'running'
        else 'queued'
      end,
      source_version = case
        when dashboard_branch_snapshots.status in ('queued', 'running')
          then dashboard_branch_snapshots.source_version
        else dashboard_branch_snapshots.source_version + 1
      end,
      manual_requested_at = case
        when dashboard_branch_snapshots.status = 'running'
          then dashboard_branch_snapshots.manual_requested_at
        else now()
      end,
      updated_at = now();

  return public.get_dashboard_snapshot(p_location_id);
end;
$$;


ALTER FUNCTION "public"."queue_dashboard_refresh"("p_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."receive_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  transfer_row public.money_transfers%rowtype;
  counts integer[];
  actor_id uuid := auth.uid();
  actor_name text;
  actor_phone text;
  total numeric;
  sent numeric;
begin
  select * into transfer_row
  from public.money_transfers
  where id = p_transfer_id
  for update;

  if transfer_row.id is null or transfer_row.transfer_method <> 'cash' then
    raise exception 'ไม่พบรายการเงินสด';
  end if;
  if not private.can_access_location(transfer_row.target_location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจรับสาขานี้';
  end if;

  counts := private.cash_transfer_counts(payload, 'received');
  select name, phone into actor_name, actor_phone
  from public.profiles
  where id = actor_id;

  update public.money_transfer_cash_details
  set received_coin_1_count = counts[1],
      received_coin_2_count = counts[2],
      received_coin_5_count = counts[3],
      received_coin_10_count = counts[4],
      received_banknote_20_count = counts[5],
      received_banknote_50_count = counts[6],
      received_banknote_100_count = counts[7],
      received_banknote_500_count = counts[8],
      received_banknote_1000_count = counts[9],
      received_by_user_id = actor_id,
      received_by_name = coalesce(actor_name, ''),
      received_by_phone = coalesce(actor_phone, ''),
      received_at = now(),
      updated_at = now(),
      cash_status = 'received'
  where transfer_id = p_transfer_id
    and cash_status = 'pending_receipt'
  returning received_total, sent_total into total, sent;

  if not found then
    raise exception 'รายการนี้ถูกตรวจรับแล้ว';
  end if;

  update public.money_transfers
  set transfer_status = 'paid',
      revision_no = revision_no + 1,
      updated_at = now()
  where id = p_transfer_id;

  return jsonb_build_object(
    'id', p_transfer_id,
    'status', 'synced',
    'difference', total - sent
  );
end;
$$;


ALTER FUNCTION "public"."receive_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_user_location_with_primary_replacement"("p_user_id" "uuid", "p_location_id" "uuid", "p_replacement_location_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_was_primary boolean;
  v_remaining_count integer;
begin
  if v_actor_id is null or not private.can_access_super_admin_features() then
    raise exception 'Forbidden';
  end if;
  if exists (
    select 1 from public.profiles p where p.id = p_user_id and p.role = 'super_admin'
  ) then
    raise exception 'Cannot modify super_admin locations';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('user-locations:' || p_user_id::text, 0));
  select ul.is_primary into v_was_primary
  from public.user_locations ul
  where ul.user_id = p_user_id and ul.location_id = p_location_id
  for update;
  if not found then return jsonb_build_object('status', 'unchanged'); end if;

  select count(*) into v_remaining_count
  from public.user_locations ul
  where ul.user_id = p_user_id and ul.location_id <> p_location_id;

  if v_was_primary and v_remaining_count > 0 then
    if p_replacement_location_id is null
      or p_replacement_location_id = p_location_id
      or not exists (
        select 1 from public.user_locations ul
        where ul.user_id = p_user_id
          and ul.location_id = p_replacement_location_id
      )
    then
      raise exception 'REPLACEMENT_PRIMARY_REQUIRED';
    end if;

    update public.user_locations
    set is_primary = false
    where user_id = p_user_id and location_id = p_location_id;

    update public.user_locations
    set is_primary = true
    where user_id = p_user_id and location_id = p_replacement_location_id;
  elsif p_replacement_location_id is not null then
    raise exception 'REPLACEMENT_PRIMARY_NOT_ALLOWED';
  end if;

  delete from public.user_locations
  where user_id = p_user_id and location_id = p_location_id;

  if v_was_primary then
    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    ) values (
      v_actor_id,
      'REMOVE_PRIMARY_LOCATION',
      'profiles',
      p_user_id,
      jsonb_build_object('primaryLocationId', p_location_id),
      jsonb_build_object('primaryLocationId', p_replacement_location_id),
      ''
    );
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'primaryLocationId', case when v_was_primary then p_replacement_location_id else null end
  );
end
$$;


ALTER FUNCTION "public"."remove_user_location_with_primary_replacement"("p_user_id" "uuid", "p_location_id" "uuid", "p_replacement_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_time_tracking_segments"("p_profile_id" "uuid", "p_selections" "jsonb", "p_full_snapshot" "jsonb" DEFAULT '{}'::"jsonb", "p_comment" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_item jsonb;
  v_date date;
  v_work_type text;
  v_start timestamptz;
  v_end timestamptz;
  v_old jsonb := '[]'::jsonb;
  v_new jsonb := '[]'::jsonb;
  v_inserted public.time_segments%rowtype;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if jsonb_typeof(p_selections) <> 'array' then
    raise exception 'INVALID_SELECTIONS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));

  for v_item in select value from jsonb_array_elements(p_selections)
  loop
    v_date := (v_item->>'date')::date;
    v_work_type := v_item->>'work_type';
    if v_date is null
      or v_date > (now() at time zone 'Asia/Bangkok')::date
      or v_work_type not in ('FULL_DAY', 'HALF_DAY', 'NONE')
    then
      raise exception 'INVALID_SELECTION';
    end if;
    if exists (
      select 1 from public.payroll_slips ps
      where ps.profile_id = p_profile_id
        and ps.month = to_char(v_date, 'YYYY-MM')
    ) then
      raise exception 'MONTH_CLOSED:%', to_char(v_date, 'YYYY-MM');
    end if;
    if exists (
      select 1
      from public.financial_transactions ft
      where ft.profile_id = p_profile_id
        and ft.status = 'APPROVED'
        and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and ft.applied_month = date_trunc('month', v_date)::date
    ) then
      raise exception 'DEDUCTION_LOCKED:%', to_char(v_date, 'YYYY-MM');
    end if;

    v_start := v_date::timestamp at time zone 'Asia/Bangkok';
    v_end := (v_date + 1)::timestamp at time zone 'Asia/Bangkok';

    select v_old || coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    into v_old
    from public.time_segments s
    where s.profile_id = p_profile_id
      and s.start_time >= v_start
      and s.start_time < v_end;

    delete from public.time_segments s
    where s.profile_id = p_profile_id
      and s.start_time >= v_start
      and s.start_time < v_end;

    if v_work_type <> 'NONE' then
      insert into public.time_segments(profile_id, start_time, end_time)
      values (
        p_profile_id,
        (v_date::text || ' 08:00:00')::timestamp at time zone 'Asia/Bangkok',
        (
          v_date::text
          || case when v_work_type = 'HALF_DAY' then ' 12:00:00' else ' 16:00:00' end
        )::timestamp at time zone 'Asia/Bangkok'
      )
      returning * into v_inserted;
      v_new := v_new || jsonb_build_array(to_jsonb(v_inserted));
    end if;
  end loop;

  insert into public.time_tracking_audit_logs (
    admin_id,
    action,
    target_table,
    record_id,
    old_data,
    new_data,
    comment
  )
  values (
    v_actor_id,
    'BULK_UPDATE_SEGMENTS',
    'time_segments',
    p_profile_id,
    jsonb_build_object('segments', v_old),
    jsonb_build_object('segments', v_new, 'selections', p_selections, 'full_snapshot', p_full_snapshot),
    p_comment
  );

  return jsonb_build_object('status', 'updated');
end;
$$;


ALTER FUNCTION "public"."replace_time_tracking_segments"("p_profile_id" "uuid", "p_selections" "jsonb", "p_full_snapshot" "jsonb", "p_comment" "text") OWNER TO "postgres";

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
    "cancel_reason" "text",
    "effective_date" "date",
    "applied_month" "date",
    CONSTRAINT "financial_transactions_applied_month_shape" CHECK (((("type" = ANY (ARRAY['DEBT_DEDUCTION'::"public"."financial_transaction_type", 'WITHDRAWAL_DEDUCTION'::"public"."financial_transaction_type"])) AND ("applied_month" IS NOT NULL) AND ("applied_month" = ("date_trunc"('month'::"text", ("applied_month")::timestamp with time zone))::"date")) OR (("type" <> ALL (ARRAY['DEBT_DEDUCTION'::"public"."financial_transaction_type", 'WITHDRAWAL_DEDUCTION'::"public"."financial_transaction_type"])) AND ("applied_month" IS NULL)))),
    CONSTRAINT "financial_transactions_effective_date_shape" CHECK (((("type" = ANY (ARRAY['DEBT'::"public"."financial_transaction_type", 'WITHDRAWAL'::"public"."financial_transaction_type"])) AND ("effective_date" IS NOT NULL)) OR ("type" <> ALL (ARRAY['DEBT'::"public"."financial_transaction_type", 'WITHDRAWAL'::"public"."financial_transaction_type"]))))
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
    "bill_type" "text" NOT NULL,
    "deduct_weight" numeric(12,2) DEFAULT 0 NOT NULL,
    "weight" numeric(12,2) DEFAULT 0 NOT NULL,
    "rubber_value" numeric(14,4) DEFAULT 0 NOT NULL,
    "average_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "deduction_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "net_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "acid_pack_count" numeric(12,2) DEFAULT 0 NOT NULL,
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
    "configured_price_snapshot" numeric(12,2),
    "approval_state" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "approved_by_name" "text",
    "approval_revision_no" integer,
    "net_weight" numeric(12,2) GENERATED ALWAYS AS ("trunc"(GREATEST(("weight" - "deduct_weight"), (0)::numeric), 2)) STORED,
    "net_rubber_value" numeric(14,2) GENERATED ALWAYS AS (
CASE
    WHEN ("weight" > (0)::numeric) THEN "round"((("rubber_value" * "trunc"(GREATEST(("weight" - "deduct_weight"), (0)::numeric), 2)) / "weight"), 2)
    ELSE (0)::numeric
END) STORED,
    "payable_before_rounding" numeric(14,2) GENERATED ALWAYS AS (GREATEST((
CASE
    WHEN ("weight" > (0)::numeric) THEN "round"((("rubber_value" * "trunc"(GREATEST(("weight" - "deduct_weight"), (0)::numeric), 2)) / "weight"), 2)
    ELSE (0)::numeric
END - "deduction_total"), (0)::numeric)) STORED,
    CONSTRAINT "rubber_bills_approval_revision_shape_check" CHECK (((("approval_state" = 'not_required'::"text") AND ("approved_by_name" IS NULL) AND ("approval_revision_no" IS NULL)) OR (("approval_state" = 'approved'::"text") AND ("approved_by_name" IS NOT NULL) AND ("approval_revision_no" = "revision_no")))),
    CONSTRAINT "rubber_bills_approval_state_check" CHECK (("approval_state" = ANY (ARRAY['not_required'::"text", 'approved'::"text"]))),
    CONSTRAINT "rubber_bills_configured_price_snapshot_check" CHECK ((("configured_price_snapshot" IS NULL) OR ("configured_price_snapshot" >= (0)::numeric))),
    CONSTRAINT "rubber_bills_deduct_weight_range_check" CHECK ((("deduct_weight" >= (0)::numeric) AND ("deduct_weight" < "weight"))),
    CONSTRAINT "rubber_bills_money_values_nonnegative_check" CHECK ((("rubber_value" >= (0)::numeric) AND ("average_price" >= (0)::numeric) AND ("deduction_total" >= (0)::numeric) AND ("net_total" >= (0)::numeric))),
    CONSTRAINT "rubber_bills_net_total_formula_check" CHECK (("net_total" = "floor"("payable_before_rounding"))),
    CONSTRAINT "rubber_bills_net_total_whole_baht_check" CHECK (("net_total" = "trunc"("net_total"))),
    CONSTRAINT "rubber_bills_weight_positive_check" CHECK (("weight" > (0)::numeric))
);


ALTER TABLE "public"."rubber_bills" OWNER TO "postgres";


COMMENT ON COLUMN "public"."rubber_bills"."deduct_weight" IS 'Single bill-level weight deduction entered by the user.';



COMMENT ON COLUMN "public"."rubber_bills"."weight" IS 'Sum of weigh-row net weights before the single bill-level weight deduction.';



COMMENT ON COLUMN "public"."rubber_bills"."rubber_value" IS 'Exact weigh-row value total before applying the bill-level weight proportion.';



COMMENT ON COLUMN "public"."rubber_bills"."deduction_total" IS 'Money deductions only (stock and debt); excludes the bill-level weight deduction.';



COMMENT ON COLUMN "public"."rubber_bills"."net_total" IS 'Actual customer payable amount floored to whole baht.';



COMMENT ON COLUMN "public"."rubber_bills"."net_weight" IS 'Bill net weight: total weigh-row weight minus the bill-level weight deduction.';



COMMENT ON COLUMN "public"."rubber_bills"."net_rubber_value" IS 'Rubber value after applying the bill net-weight proportion, rounded half-up to 2 decimals.';



COMMENT ON COLUMN "public"."rubber_bills"."payable_before_rounding" IS 'Net rubber value minus money deductions before whole-baht flooring.';



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
    "previous_report_id" "uuid",
    "opening_balance" numeric DEFAULT 0 NOT NULL,
    "closing_balance" numeric DEFAULT 0 NOT NULL,
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


CREATE OR REPLACE FUNCTION "public"."run_time_tracking_auto_start"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_schedule record;
  v_started integer := 0;
begin
  for v_schedule in
    select rs.*
    from public.time_tracking_resume_schedules rs
    join public.profiles p on p.id = rs.profile_id and p.is_active = true
    where rs.resume_at <= now()
    order by rs.resume_at, rs.profile_id
    for update of rs skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_schedule.profile_id::text, 0));

    if not exists (
      select 1
      from public.time_segments s
      where s.profile_id = v_schedule.profile_id
        and s.end_time is null
    ) and not exists (
      select 1
      from public.payroll_slips ps
      where ps.profile_id = v_schedule.profile_id
        and ps.month = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    ) then
      insert into public.time_segments(profile_id, start_time)
      values (v_schedule.profile_id, v_schedule.resume_at);

      insert into public.time_tracking_audit_logs (
        admin_id, action, target_table, record_id, new_data, comment
      )
      values (
        v_schedule.created_by,
        'AUTO_START_NEXT_MONTH',
        'time_segments',
        v_schedule.profile_id,
        jsonb_build_object(
          'start_time', v_schedule.resume_at,
          'payroll_slip_id', v_schedule.payroll_slip_id
        ),
        'เริ่มนับเวลาอัตโนมัติหลังปิดเดือน'
      );
      v_started := v_started + 1;
    end if;

    delete from public.time_tracking_resume_schedules
    where profile_id = v_schedule.profile_id;
  end loop;

  return v_started;
end;
$$;


ALTER FUNCTION "public"."run_time_tracking_auto_start"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_time_tracking_daily_cutoff"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_segment record;
  v_cutoff timestamptz := (
    (now() at time zone 'Asia/Bangkok')::date::text || ' 15:00:00'
  )::timestamp at time zone 'Asia/Bangkok';
  v_count integer := 0;
begin
  if now() < v_cutoff then
    return 0;
  end if;

  for v_segment in
    select s.id, s.profile_id
    from public.time_segments s
    join public.profiles p on p.id = s.profile_id and p.is_active = true
    where s.end_time is null
      and s.start_time < v_cutoff
    order by s.profile_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_segment.profile_id::text, 0));

    update public.time_segments
    set end_time = v_cutoff
    where id = v_segment.id
      and end_time is null
      and start_time < v_cutoff;
    if not found then
      continue;
    end if;

    if not exists (
      select 1
      from public.payroll_slips ps
      where ps.profile_id = v_segment.profile_id
        and ps.month = to_char(v_cutoff at time zone 'Asia/Bangkok', 'YYYY-MM')
    ) then
      insert into public.time_segments(profile_id, start_time)
      values (v_segment.profile_id, v_cutoff);
    end if;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, new_data, comment
    )
    values (
      v_segment.profile_id,
      'SYSTEM_DAILY_CUTOFF',
      'time_segments',
      v_segment.profile_id,
      jsonb_build_object('cutoff_time', v_cutoff),
      'ตัดรอบอัตโนมัติ 15:00 น.'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."run_time_tracking_daily_cutoff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_dashboard_alert_thresholds"("p_location_id" "uuid", "p_purchase_average_min" numeric, "p_net_cash_min" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_name text;
begin
  perform private.dashboard_require_manager();

  if p_purchase_average_min < 0
    or p_net_cash_min is null
    or p_net_cash_min < 0
  then
    raise exception 'เกณฑ์แจ้งเตือนต้องไม่ติดลบ';
  end if;

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.is_active = true
  ) then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน';
  end if;

  select p.name
  into actor_name
  from public.profiles p
  where p.id = auth.uid();

  insert into public.dashboard_alert_thresholds (
    location_id,
    purchase_average_min,
    net_cash_min,
    updated_by_user_id,
    updated_by_name,
    is_configured
  )
  values (
    p_location_id,
    p_purchase_average_min,
    p_net_cash_min,
    auth.uid(),
    actor_name,
    true
  )
  on conflict (location_id) do update
  set purchase_average_min = excluded.purchase_average_min,
      net_cash_min = excluded.net_cash_min,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_by_name = excluded.updated_by_name,
      is_configured = true,
      updated_at = now();

  return public.get_dashboard_alert_thresholds(p_location_id);
end;
$$;


ALTER FUNCTION "public"."save_dashboard_alert_thresholds"("p_location_id" "uuid", "p_purchase_average_min" numeric, "p_net_cash_min" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_dashboard_manager_config"("p_location_id" "uuid", "p_interval_minutes" integer, "p_purchase_average_min" numeric, "p_net_cash_min" numeric, "p_stock_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  item jsonb;
begin
  perform private.dashboard_require_manager();

  if jsonb_typeof(p_stock_items) <> 'array' then
    raise exception 'เกณฑ์สต็อกไม่ถูกต้อง';
  end if;

  perform public.save_dashboard_refresh_interval(p_interval_minutes);
  perform public.save_dashboard_alert_thresholds(
    p_location_id,
    p_purchase_average_min,
    p_net_cash_min
  );

  for item in select value from jsonb_array_elements(p_stock_items)
  loop
    perform public.save_dashboard_stock_alert_threshold(
      p_location_id,
      (item ->> 'productId')::uuid,
      case
        when item -> 'minimumBalance' = 'null'::jsonb then null
        else (item ->> 'minimumBalance')::numeric
      end
    );
  end loop;

  return jsonb_build_object(
    'settings', public.get_dashboard_refresh_settings(),
    'thresholds', public.get_dashboard_alert_thresholds(p_location_id)
  );
end;
$$;


ALTER FUNCTION "public"."save_dashboard_manager_config"("p_location_id" "uuid", "p_interval_minutes" integer, "p_purchase_average_min" numeric, "p_net_cash_min" numeric, "p_stock_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_dashboard_refresh_interval"("p_interval_minutes" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_name text;
begin
  perform private.dashboard_require_manager();

  if p_interval_minutes is null
    or p_interval_minutes < 10
    or p_interval_minutes > 1440
  then
    raise exception 'รอบคำนวณต้องอยู่ระหว่าง 10 ถึง 1,440 นาที';
  end if;

  select p.name
  into actor_name
  from public.profiles p
  where p.id = auth.uid();

  update public.dashboard_refresh_settings
  set interval_minutes = p_interval_minutes,
      updated_by_user_id = auth.uid(),
      updated_by_name = actor_name,
      updated_at = now()
  where id = true;

  return public.get_dashboard_refresh_settings();
end;
$$;


ALTER FUNCTION "public"."save_dashboard_refresh_interval"("p_interval_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_dashboard_stock_alert_threshold"("p_location_id" "uuid", "p_product_id" "uuid", "p_minimum_balance" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_name text;
begin
  perform private.dashboard_require_manager();

  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.is_active = true
  ) then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน';
  end if;

  if not exists (
    select 1 from public.stock_products p
    where p.id = p_product_id and p.is_active = true
  ) then
    raise exception 'ไม่พบสินค้าที่เปิดใช้งาน';
  end if;

  if p_minimum_balance is not null and p_minimum_balance < 0 then
    raise exception 'เกณฑ์สต็อกต้องไม่ติดลบ';
  end if;

  if p_minimum_balance is null then
    delete from public.dashboard_stock_alert_thresholds
    where location_id = p_location_id
      and product_id = p_product_id;
  else
    select p.name
    into actor_name
    from public.profiles p
    where p.id = auth.uid();

    insert into public.dashboard_stock_alert_thresholds (
      location_id,
      product_id,
      minimum_balance,
      updated_by_user_id,
      updated_by_name
    )
    values (
      p_location_id,
      p_product_id,
      p_minimum_balance,
      auth.uid(),
      actor_name
    )
    on conflict (location_id, product_id) do update
    set minimum_balance = excluded.minimum_balance,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_by_name = excluded.updated_by_name,
        updated_at = now();
  end if;

  return public.get_dashboard_alert_thresholds(p_location_id);
end;
$$;


ALTER FUNCTION "public"."save_dashboard_stock_alert_threshold"("p_location_id" "uuid", "p_product_id" "uuid", "p_minimum_balance" numeric) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubber_bill_approval_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "edit_window_minutes" integer DEFAULT 30 NOT NULL,
    "configured_price" numeric(12,2),
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "updated_by_phone" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rubber_bill_approval_settings_configured_price_check" CHECK ((("configured_price" IS NULL) OR ("configured_price" >= (0)::numeric))),
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
     and (p_configured_price < 0 or scale(p_configured_price) > 2) then
    raise exception 'ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง';
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


CREATE OR REPLACE FUNCTION "public"."save_telegram_badge_config"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  current_settings public.telegram_badge_settings%rowtype;
  next_enabled boolean;
  next_chat_id text;
  next_start_time time;
  next_end_time time;
  next_interval integer;
  next_keys text[];
  token_value text;
  actor_name text;
  actor_phone text;
  unknown_keys text[];
  schedule_changed boolean;
begin
  perform private.telegram_badge_require_manager();

  select * into strict current_settings
  from public.telegram_badge_settings
  where id = true
  for update;

  next_enabled := coalesce((payload->>'enabled')::boolean, current_settings.enabled);
  next_chat_id := nullif(btrim(coalesce(payload->>'chatId', current_settings.chat_id)), '');
  next_start_time := coalesce(nullif(payload->>'startTime', '')::time, current_settings.start_time);
  next_end_time := coalesce(nullif(payload->>'endTime', '')::time, current_settings.end_time);
  next_interval := coalesce((payload->>'intervalMinutes')::integer, current_settings.interval_minutes);
  token_value := nullif(btrim(payload->>'botToken'), '');

  if jsonb_typeof(payload->'enabledBadgeKeys') = 'array' then
    select coalesce(array_agg(value order by value), array[]::text[])
    into next_keys
    from (
      select distinct jsonb_array_elements_text(payload->'enabledBadgeKeys') as value
    ) selected;
  else
    next_keys := current_settings.enabled_badge_keys;
  end if;

  select array_agg(key)
  into unknown_keys
  from unnest(next_keys) key
  where not exists (
    select 1 from public.telegram_badge_catalog c where c.badge_key = key
  );

  if unknown_keys is not null then
    raise exception 'ประเภท Badge ไม่ถูกต้อง';
  end if;
  if next_start_time >= next_end_time then
    raise exception 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด';
  end if;
  if next_interval not between 10 and 240 then
    raise exception 'ระยะห่างต้องอยู่ระหว่าง 10 ถึง 240 นาที';
  end if;
  if next_enabled and next_chat_id is null then
    raise exception 'กรุณาระบุ Chat ID';
  end if;
  if next_enabled and current_settings.bot_token_secret_id is null and token_value is null then
    raise exception 'กรุณาระบุ Bot Token';
  end if;

  schedule_changed :=
    next_start_time is distinct from current_settings.start_time
    or next_end_time is distinct from current_settings.end_time
    or next_interval is distinct from current_settings.interval_minutes;

  if token_value is not null then
    if current_settings.bot_token_secret_id is null then
      current_settings.bot_token_secret_id := vault.create_secret(
        token_value,
        'lanflow_telegram_badge_bot_token',
        'Telegram Bot Token for the LanFlow badge digest'
      );
    else
      perform vault.update_secret(
        current_settings.bot_token_secret_id,
        token_value,
        'lanflow_telegram_badge_bot_token',
        'Telegram Bot Token for the LanFlow badge digest'
      );
    end if;
  end if;

  select p.name, p.phone
  into actor_name, actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.telegram_badge_settings
  set enabled = next_enabled,
      chat_id = next_chat_id,
      start_time = next_start_time,
      end_time = next_end_time,
      interval_minutes = next_interval,
      enabled_badge_keys = next_keys,
      bot_token_secret_id = current_settings.bot_token_secret_id,
      initial_attempt_at = case
        when next_enabled and not current_settings.enabled then now() + interval '10 minutes'
        when not next_enabled then null
        when schedule_changed then null
        else initial_attempt_at
      end,
      retry_at = case
        when not next_enabled or schedule_changed then null
        else retry_at
      end,
      pending_slot_at = case
        when not next_enabled or schedule_changed then null
        else pending_slot_at
      end,
      claim_token = case
        when not next_enabled or schedule_changed then null
        else claim_token
      end,
      claimed_at = case
        when not next_enabled or schedule_changed then null
        else claimed_at
      end,
      last_completed_slot_at = case
        when next_enabled and current_settings.enabled and schedule_changed
          then private.telegram_badge_latest_slot(
            now(),
            next_start_time,
            next_end_time,
            next_interval
          )
        else last_completed_slot_at
      end,
      last_error = case when not next_enabled then null else last_error end,
      updated_by_user_id = auth.uid(),
      updated_by_name = actor_name,
      updated_by_phone = actor_phone,
      updated_at = now()
  where id = true;

  return public.get_telegram_badge_config();
end;
$$;


ALTER FUNCTION "public"."save_telegram_badge_config"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_time_tracking_status"("p_profile_id" "uuid", "p_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_segment_id uuid;
  v_now timestamptz := now();
  v_current_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_status not in ('RUNNING', 'PAUSED') then
    raise exception 'INVALID_TRACKING_STATUS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  select s.id into v_segment_id
  from public.time_segments s
  where s.profile_id = p_profile_id and s.end_time is null
  for update;

  if p_status = 'RUNNING' then
    if exists (
      select 1 from public.payroll_slips ps
      where ps.profile_id = p_profile_id and ps.month = v_current_month
    ) then
      raise exception 'MONTH_CLOSED:%', v_current_month;
    end if;
    if v_segment_id is null then
      insert into public.time_segments(profile_id, start_time)
      values (p_profile_id, v_now)
      returning id into v_segment_id;
    end if;
  else
    if v_segment_id is not null then
      update public.time_segments set end_time = v_now where id = v_segment_id;
    end if;
    delete from public.time_tracking_resume_schedules where profile_id = p_profile_id;
  end if;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data
  )
  values (
    v_actor_id,
    'TOGGLE_TRACKING',
    'time_segments',
    p_profile_id,
    jsonb_build_object('status', p_status, 'server_time', v_now)
  );

  return jsonb_build_object('status', lower(p_status), 'segmentId', v_segment_id);
end;
$$;


ALTER FUNCTION "public"."set_time_tracking_status"("p_profile_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_primary_location"("p_user_id" "uuid", "p_location_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_old_location_id uuid;
begin
  if v_actor_id is null or not private.can_access_super_admin_features() then
    raise exception 'Forbidden';
  end if;
  if exists (
    select 1 from public.profiles p where p.id = p_user_id and p.role = 'super_admin'
  ) then
    raise exception 'Cannot modify super_admin locations';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('user-locations:' || p_user_id::text, 0));
  if not exists (
    select 1 from public.user_locations ul
    where ul.user_id = p_user_id and ul.location_id = p_location_id
  ) then
    raise exception 'LOCATION_NOT_ASSIGNED';
  end if;

  select ul.location_id into v_old_location_id
  from public.user_locations ul
  where ul.user_id = p_user_id and ul.is_primary = true;

  if v_old_location_id = p_location_id then
    return jsonb_build_object('status', 'unchanged', 'primaryLocationId', p_location_id);
  end if;

  update public.user_locations
  set is_primary = false
  where user_id = p_user_id and is_primary = true;

  update public.user_locations
  set is_primary = true
  where user_id = p_user_id and location_id = p_location_id;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, new_data, comment
  ) values (
    v_actor_id,
    'CHANGE_PRIMARY_LOCATION',
    'profiles',
    p_user_id,
    jsonb_build_object('primaryLocationId', v_old_location_id),
    jsonb_build_object('primaryLocationId', p_location_id),
    ''
  );

  return jsonb_build_object(
    'status', 'updated',
    'oldPrimaryLocationId', v_old_location_id,
    'primaryLocationId', p_location_id
  );
end
$$;


ALTER FUNCTION "public"."set_user_primary_location"("p_user_id" "uuid", "p_location_id" "uuid") OWNER TO "postgres";


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
    SET "search_path" TO 'public', 'private'
    AS $$
declare
  v_existing_bill_option text;
begin
  if payload->>'operation' in ('update', 'delete') then
    select bill_option
      into v_existing_bill_option
    from public.income_expense
    where client_temp_id = payload->>'clientTempId';
  end if;

  if payload->>'billOption' = 'บิลขาย' or v_existing_bill_option = 'บิลขาย' then
    return private.sync_income_sale_bill(payload);
  end if;
  if jsonb_typeof(payload->'saleLines') = 'array'
     and jsonb_array_length(payload->'saleLines') > 0 then
    return jsonb_build_object(
      'status', 'failed',
      'errorMessage', 'รายการที่ไม่ใช่บิลขายต้องไม่มีรายการสินค้า'
    );
  end if;
  return public.sync_income_expense_core(payload);
end;
$$;


ALTER FUNCTION "public"."sync_income_expense"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_income_expense_core"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
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
  perform (payload->>'recordStatus')::record_status;
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


ALTER FUNCTION "public"."sync_income_expense_core"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_money_transfer_item_source_fks"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_transfer_location_id uuid;
  v_source_location_id uuid;
begin
  select t.location_id
  into v_transfer_location_id
  from public.money_transfers t
  where t.id = new.transfer_id
    and t.record_status <> 'deleted'
  for update;

  if v_transfer_location_id is null then
    raise exception 'money transfer not found';
  end if;

  if new.source_type = 'rubber_bill' then
    if new.rubber_bill_id is not null and new.rubber_bill_id <> new.source_id then
      raise exception 'rubber_bill_id must match source_id';
    end if;
    new.rubber_bill_id := new.source_id;
    new.ocr_ticket_id := null;
    select rb.location_id
    into v_source_location_id
    from public.rubber_bills rb
    where rb.id = new.rubber_bill_id
      and rb.record_status <> 'deleted'
    for update;
  elsif new.source_type = 'ocr_ticket' then
    if new.ocr_ticket_id is not null and new.ocr_ticket_id <> new.source_id then
      raise exception 'ocr_ticket_id must match source_id';
    end if;
    new.rubber_bill_id := null;
    new.ocr_ticket_id := new.source_id;
    select ot.location_id
    into v_source_location_id
    from public.ocr_tickets ot
    where ot.id = new.ocr_ticket_id
      and ot.record_status <> 'deleted'
    for update;
  else
    raise exception 'unsupported money transfer source type: %', new.source_type;
  end if;

  if v_source_location_id is null then
    raise exception 'money transfer source not found';
  end if;

  if v_source_location_id <> v_transfer_location_id then
    raise exception 'money transfer source must belong to the transfer location';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_money_transfer_item_source_fks"() OWNER TO "postgres";


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
  v_price_cap numeric;
  v_has_exceeded_cap boolean := false;
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

  payload := private.normalize_rubber_bill_calculation_payload(payload);

  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));

  select name, phone
    into v_actor_name, v_actor_phone
  from public.profiles
  where id = auth.uid();

  select *
    into v_settings
  from public.rubber_bill_approval_settings
  where id = true;

  if v_operation = 'create' then
    if not (payload ? 'configuredPriceSnapshot') then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'configuredPriceSnapshot is required for create'
      );
    end if;

    if jsonb_typeof(payload->'configuredPriceSnapshot') = 'null' then
      v_price_cap := null;
    elsif jsonb_typeof(payload->'configuredPriceSnapshot') = 'number' then
      begin
        v_price_cap := (payload->>'configuredPriceSnapshot')::numeric;
      exception when others then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'configuredPriceSnapshot must be numeric or null'
        );
      end;

      if v_price_cap < 0 or scale(v_price_cap) > 2 then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'configuredPriceSnapshot must be non-negative with at most 2 decimal places'
        );
      end if;
    else
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'configuredPriceSnapshot must be numeric or null'
      );
    end if;
  else
    v_price_cap := v_settings.configured_price;
  end if;

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
      if v_price_cap is not null and v_price > v_price_cap then
        v_has_exceeded_cap := true;
      end if;
    end loop;

    select coalesce(
      jsonb_agg((item->>'unitPrice')::numeric order by (item->>'sequenceNo')::integer),
      '[]'::jsonb
    )
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

    if v_price_cap is null or not v_has_exceeded_cap then
      return public.sync_rubber_bill_core_20260725010000(payload);
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

    if v_operation = 'update' and v_price_cap is not null then
      select coalesce(jsonb_agg(i.price order by i.sequence_no), '[]'::jsonb)
        into v_current_prices
      from public.rubber_bill_items i
      where i.bill_id = v_bill.id
        and i.item_type = 'weigh';

      if v_current_prices is distinct from v_proposed_prices and v_has_exceeded_cap then
        v_reasons := array_append(v_reasons, 'price');
      end if;
    end if;

    if cardinality(v_reasons) = 0 then
      return public.sync_rubber_bill_core_20260725010000(payload);
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
    edit_window_minutes_snapshot,
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
    v_price_cap,
    v_settings.edit_window_minutes,
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


CREATE OR REPLACE FUNCTION "public"."sync_rubber_bill_core_20260725010000"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
  v_idempotency_key text;
  v_customer_id uuid;
  v_deduct_weight numeric;

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
  payload := private.normalize_rubber_bill_calculation_payload(payload);
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
  perform (payload->>'recordStatus')::record_status;
  v_idempotency_key := payload->>'idempotencyKey';

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
    elsif v_current_revision != coalesce(v_expected_revision, v_current_revision) then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
    end if;
  elsif v_operation != 'create' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
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
    for v_item in
      select *
      from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
    loop
      if v_item->>'itemType' in ('acid', 'stock_deduction') then
        v_stock_product_id := nullif(v_item->>'stockProductId', '')::uuid;
        v_stock_quantity := nullif(v_item->>'quantity', '')::numeric;

        if v_stock_product_id is null or coalesce(v_stock_quantity, 0) <= 0 then
          return jsonb_build_object(
            'status', 'failed',
            'errorMessage', 'รายการหักสินค้าต้องเลือกสินค้าในสต็อกและระบุจำนวน'
          );
        end if;

        if not exists (
          select 1
          from public.acid_products
          where id = v_stock_product_id
            and is_active = true
        ) then
          return jsonb_build_object(
            'status', 'failed',
            'errorMessage', 'ไม่พบสินค้าในสต็อกสำหรับรายการหักสินค้า'
          );
        end if;
      end if;
    end loop;

    for v_stock_row in
      with old_stock as (
        select
          stock_product_id as product_id,
          sum(quantity) as old_qty
        from public.rubber_bill_items
        where v_bill_id is not null
          and v_existing_record_status = 'active'
          and bill_id = v_bill_id
          and item_type in ('acid', 'stock_deduction')
          and stock_product_id is not null
        group by stock_product_id
      ),
      new_stock as (
        select
          nullif(item->>'stockProductId', '')::uuid as product_id,
          sum(nullif(item->>'quantity', '')::numeric) as new_qty
        from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) as item
        where item->>'itemType' in ('acid', 'stock_deduction')
        group by nullif(item->>'stockProductId', '')::uuid
      )
      select
        coalesce(old_stock.product_id, new_stock.product_id) as product_id,
        coalesce(old_stock.old_qty, 0) as old_qty,
        coalesce(new_stock.new_qty, 0) as new_qty
      from old_stock
      full join new_stock using (product_id)
      order by product_id
    loop
      perform pg_advisory_xact_lock(
        hashtext('acid-stock:' || v_location_id::text || ':' || v_stock_row.product_id::text)
      );
      v_current_balance := public.get_acid_stock_balance(
        v_location_id,
        v_stock_row.product_id
      );
      v_projected_balance :=
        v_current_balance + v_stock_row.old_qty - v_stock_row.new_qty;

      if v_projected_balance < 0 then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'สต็อกสินค้าไม่พอสำหรับรายการหักสินค้าในบิลยาง'
        );
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
        server_received_at = now(),
        approval_state = 'not_required',
        approved_by_name = null,
        approval_revision_no = null
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
      customer_id, customer_name, configured_price_snapshot, bill_type,
      deduct_weight, weight, rubber_value, average_price,
      deduction_total, net_total, acid_pack_count,
      client_recorded_at, client_created_at, server_received_at,
      created_by_user_id, created_by_name, created_by_phone,
      approval_state, approved_by_name, approval_revision_no
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
      v_customer_id,
      payload->>'customerName',
      case
        when v_operation = 'create' then (payload->>'configuredPriceSnapshot')::numeric
        else null
      end,
      coalesce(nullif(payload->>'billType', ''), 'weighing'),
      v_deduct_weight,
      (payload->>'weight')::numeric,
      (payload->>'rubberValue')::numeric,
      (payload->>'averagePrice')::numeric,
      (payload->>'deductionTotal')::numeric,
      (payload->>'netTotal')::numeric,
      (payload->>'acidPackCount')::numeric,
      (payload->>'clientRecordedAt')::timestamptz,
      (payload->>'clientCreatedAt')::timestamptz,
      now(),
      v_created_by_user_id,
      coalesce(v_created_by_name, ''),
      coalesce(v_created_by_phone, ''),
      'not_required',
      null,
      null
    )
    on conflict (client_temp_id) do update set
      revision_no = public.rubber_bills.revision_no + 1,
      idempotency_key = excluded.idempotency_key,
      sync_status = 'synced',
      record_status = 'active',
      bill_date = excluded.bill_date,
      customer_id = excluded.customer_id,
      customer_name = excluded.customer_name,
      bill_type = excluded.bill_type,
      deduct_weight = excluded.deduct_weight,
      weight = excluded.weight,
      rubber_value = excluded.rubber_value,
      average_price = excluded.average_price,
      deduction_total = excluded.deduction_total,
      net_total = excluded.net_total,
      acid_pack_count = excluded.acid_pack_count,
      client_recorded_at = excluded.client_recorded_at,
      server_received_at = now(),
      approval_state = 'not_required',
      approved_by_name = null,
      approval_revision_no = null
    returning id, revision_no into v_bill_id, v_current_revision;

    delete from public.rubber_bill_items where bill_id = v_bill_id;

    for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
    loop
      insert into public.rubber_bill_items (
        bill_id, item_type, description,
        weight_in, weight_out, net_weight,
        quantity, unit, price, total, stock_product_id, sequence_no
      ) values (
        v_bill_id,
        v_item->>'itemType',
        coalesce(v_item->>'description', v_item->>'title'),
        (v_item->>'inWeight')::numeric,
        (v_item->>'outWeight')::numeric,
        (v_item->>'netWeight')::numeric,
        (v_item->>'quantity')::numeric,
        v_item->>'unit',
        (v_item->>'unitPrice')::numeric,
        (v_item->>'totalAmount')::numeric,
        nullif(v_item->>'stockProductId', '')::uuid,
        nullif(v_item->>'sequenceNo', '')::integer
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


ALTER FUNCTION "public"."sync_rubber_bill_core_20260725010000"("payload" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_time_tracking_wage"("p_profile_id" "uuid", "p_daily_wage" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_actor_id uuid := auth.uid();
  v_old_wage numeric;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_daily_wage is null or p_daily_wage < 0 then
    raise exception 'INVALID_WAGE';
  end if;

  select p.daily_wage into v_old_wage
  from public.profiles p
  where p.id = p_profile_id
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if exists (
    select 1
    from public.financial_transactions ft
    where ft.profile_id = p_profile_id
      and ft.status = 'APPROVED'
      and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and not exists (
        select 1
        from public.payroll_slips ps
        where ps.profile_id = p_profile_id
          and ps.month = to_char(ft.applied_month, 'YYYY-MM')
      )
  ) then
    raise exception 'DEDUCTION_WAGE_LOCKED';
  end if;

  update public.profiles
  set daily_wage = trunc(p_daily_wage, 2)
  where id = p_profile_id;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, new_data
  )
  values (
    v_actor_id,
    'UPDATE_WAGE',
    'profiles',
    p_profile_id,
    jsonb_build_object('daily_wage', v_old_wage),
    jsonb_build_object('daily_wage', trunc(p_daily_wage, 2))
  );

  return jsonb_build_object('dailyWage', trunc(p_daily_wage, 2));
end;
$$;


ALTER FUNCTION "public"."update_time_tracking_wage"("p_profile_id" "uuid", "p_daily_wage" numeric) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."verify_telegram_badge_dispatch_secret"("p_secret" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select auth.role() = 'service_role'
    and coalesce(
      (
        select p_secret = ds.decrypted_secret
        from public.telegram_badge_settings s
        join vault.decrypted_secrets ds on ds.id = s.dispatch_secret_id
        where s.id = true
      ),
      false
    )
$$;


ALTER FUNCTION "public"."verify_telegram_badge_dispatch_secret"("p_secret" "text") OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."income_expense_sale_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "income_expense_id" "uuid" NOT NULL,
    "income_sale_item_id" "uuid" NOT NULL,
    "stock_product_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "quantity" numeric(12,0) NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "line_total" numeric(14,2) NOT NULL,
    "sequence_no" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "income_expense_sale_lines_line_total_check" CHECK (("line_total" > (0)::numeric)),
    CONSTRAINT "income_expense_sale_lines_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "income_expense_sale_lines_sequence_no_check" CHECK (("sequence_no" > 0)),
    CONSTRAINT "income_expense_sale_lines_unit_price_check" CHECK (("unit_price" > (0)::numeric))
);


ALTER TABLE "public"."income_expense_sale_lines" OWNER TO "postgres";


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
 SELECT ('stock-entry:'::"text" || ("entry"."id")::"text") AS "movement_id",
    'stock_entry'::"text" AS "source_type",
    "entry"."id" AS "source_id",
    NULL::"uuid" AS "source_line_id",
    "entry"."tx_date",
    "entry"."location_id",
    "entry"."product_id",
    "entry"."product_name",
    "entry"."quantity_delta",
    "entry"."amount",
    COALESCE("entry"."server_bill_no", "entry"."transfer_bill_no", ("entry"."id")::"text") AS "display_bill_no",
    "entry"."tx_type",
    "entry"."created_by_user_id",
    "entry"."created_by_name",
    "entry"."created_by_phone",
    "entry"."created_at",
    NULL::"text" AS "relation_lock_reason"
   FROM "public"."stock_entries" "entry"
  WHERE ("entry"."record_status" = 'active'::"public"."record_status")
UNION ALL
 SELECT ('income-sale:'::"text" || ("line"."id")::"text") AS "movement_id",
    'income_sale'::"text" AS "source_type",
    "bill"."id" AS "source_id",
    "line"."id" AS "source_line_id",
    "bill"."tx_date",
    "bill"."location_id",
    "line"."stock_product_id" AS "product_id",
    "product"."name" AS "product_name",
    (- "abs"("line"."quantity")) AS "quantity_delta",
    ("line"."line_total")::numeric(12,2) AS "amount",
    COALESCE("bill"."server_bill_no", "bill"."local_bill_no", ("bill"."id")::"text") AS "display_bill_no",
    'income_sale'::"text" AS "tx_type",
    "bill"."created_by_user_id",
    "bill"."created_by_name",
    "bill"."created_by_phone",
    "line"."created_at",
    'รายการนี้มาจากบิลขาย ต้องแก้ไขหรือลบที่โมดูลรับ-จ่าย'::"text" AS "relation_lock_reason"
   FROM (("public"."income_expense_sale_lines" "line"
     JOIN "public"."income_expense" "bill" ON (("bill"."id" = "line"."income_expense_id")))
     JOIN "public"."stock_products" "product" ON (("product"."id" = "line"."stock_product_id")))
  WHERE (("bill"."record_status" = 'active'::"public"."record_status") AND ("bill"."type" = 'income'::"public"."transaction_type") AND ("bill"."bill_option" = 'บิลขาย'::"text"))
UNION ALL
 SELECT ('rubber-bill-stock:'::"text" || ("item"."id")::"text") AS "movement_id",
    'rubber_bill_stock_deduction'::"text" AS "source_type",
    "bill"."id" AS "source_id",
    "item"."id" AS "source_line_id",
    "bill"."bill_date" AS "tx_date",
    "bill"."location_id",
    "item"."stock_product_id" AS "product_id",
    "product"."name" AS "product_name",
    (- "abs"("item"."quantity")) AS "quantity_delta",
    "item"."total" AS "amount",
    COALESCE("bill"."server_bill_no", "bill"."local_bill_no", ("bill"."id")::"text") AS "display_bill_no",
    'rubber_bill_stock_deduction'::"text" AS "tx_type",
    "bill"."created_by_user_id",
    "bill"."created_by_name",
    "bill"."created_by_phone",
    "item"."created_at",
    'รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยาง'::"text" AS "relation_lock_reason"
   FROM (("public"."rubber_bill_items" "item"
     JOIN "public"."rubber_bills" "bill" ON (("bill"."id" = "item"."bill_id")))
     JOIN "public"."stock_products" "product" ON (("product"."id" = "item"."stock_product_id")))
  WHERE (("bill"."record_status" = 'active'::"public"."record_status") AND ("item"."item_type" = ANY (ARRAY['acid'::"text", 'stock_deduction'::"text"])) AND ("item"."stock_product_id" IS NOT NULL) AND (COALESCE("item"."quantity", (0)::numeric) > (0)::numeric));


ALTER VIEW "public"."acid_stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_transfer_delete_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transfer_id" "uuid",
    "source_location_id" "uuid" NOT NULL,
    "source_location_name" "text" NOT NULL,
    "target_location_id" "uuid" NOT NULL,
    "target_location_name" "text" NOT NULL,
    "transfer_display_no" "text" NOT NULL,
    "sent_total" numeric(12,2) NOT NULL,
    "received_total" numeric(12,2) NOT NULL,
    "difference_total" numeric(12,2) NOT NULL,
    "note" "text",
    "request_status" "text" DEFAULT 'pending'::"text" NOT NULL,
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
    CONSTRAINT "cash_transfer_delete_requests_check" CHECK (((("request_status" = 'pending'::"text") AND ("decided_by_user_id" IS NULL) AND ("decided_at" IS NULL)) OR (("request_status" = ANY (ARRAY['approved'::"text", 'rejected'::"text"])) AND ("decided_by_user_id" IS NOT NULL) AND ("decided_at" IS NOT NULL)))),
    CONSTRAINT "cash_transfer_delete_requests_received_total_check" CHECK (("received_total" >= (0)::numeric)),
    CONSTRAINT "cash_transfer_delete_requests_request_status_check" CHECK (("request_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "cash_transfer_delete_requests_sent_total_check" CHECK (("sent_total" > (0)::numeric))
);


ALTER TABLE "public"."cash_transfer_delete_requests" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."dashboard_alert_thresholds" (
    "location_id" "uuid" NOT NULL,
    "purchase_average_min" numeric(14,2) DEFAULT 30000,
    "net_cash_min" numeric(14,2) DEFAULT 30000 NOT NULL,
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_configured" boolean DEFAULT false NOT NULL,
    CONSTRAINT "dashboard_alert_thresholds_net_cash_min_check" CHECK (("net_cash_min" >= (0)::numeric)),
    CONSTRAINT "dashboard_alert_thresholds_purchase_average_min_check" CHECK ((("purchase_average_min" IS NULL) OR ("purchase_average_min" >= (0)::numeric)))
);


ALTER TABLE "public"."dashboard_alert_thresholds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dashboard_branch_snapshots" (
    "location_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'dirty'::"text" NOT NULL,
    "source_version" bigint DEFAULT 1 NOT NULL,
    "snapshot_version" bigint DEFAULT 0 NOT NULL,
    "claimed_version" bigint,
    "summary" "jsonb",
    "calculated_at" timestamp with time zone,
    "manual_requested_at" timestamp with time zone,
    "claimed_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_branch_snapshots_check" CHECK ((("snapshot_version" >= 0) AND ("snapshot_version" <= "source_version"))),
    CONSTRAINT "dashboard_branch_snapshots_check1" CHECK ((("claimed_version" IS NULL) OR (("claimed_version" >= 1) AND ("claimed_version" <= "source_version")))),
    CONSTRAINT "dashboard_branch_snapshots_check2" CHECK (((("summary" IS NULL) AND ("calculated_at" IS NULL)) OR (("summary" IS NOT NULL) AND ("calculated_at" IS NOT NULL)))),
    CONSTRAINT "dashboard_branch_snapshots_source_version_check" CHECK (("source_version" >= 1)),
    CONSTRAINT "dashboard_branch_snapshots_status_check" CHECK (("status" = ANY (ARRAY['dirty'::"text", 'queued'::"text", 'running'::"text", 'ready'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."dashboard_branch_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dashboard_refresh_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "interval_minutes" integer DEFAULT 10 NOT NULL,
    "last_rollover_date" "date" DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok'::"text"))::"date" NOT NULL,
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_refresh_settings_id_check" CHECK (("id" = true)),
    CONSTRAINT "dashboard_refresh_settings_interval_minutes_check" CHECK ((("interval_minutes" >= 10) AND ("interval_minutes" <= 1440)))
);


ALTER TABLE "public"."dashboard_refresh_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dashboard_stock_alert_thresholds" (
    "location_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "minimum_balance" numeric(14,2) NOT NULL,
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_stock_alert_thresholds_minimum_balance_check" CHECK (("minimum_balance" >= (0)::numeric))
);


ALTER TABLE "public"."dashboard_stock_alert_thresholds" OWNER TO "postgres";


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
    "cash_transfer_delete_requires_approval" boolean DEFAULT true NOT NULL,
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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provision_request_id" "uuid"
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
    CONSTRAINT "money_transfer_cash_details_cash_status_check" CHECK (("cash_status" = ANY (ARRAY['pending_receipt'::"text", 'received'::"text"]))),
    CONSTRAINT "money_transfer_cash_details_difference_shape_check" CHECK (((("cash_status" = 'pending_receipt'::"text") AND ("difference_total" IS NULL)) OR (("cash_status" = 'received'::"text") AND ("difference_total" IS NOT NULL)))),
    CONSTRAINT "money_transfer_cash_details_receipt_shape_check" CHECK (((("cash_status" = 'pending_receipt'::"text") AND ("num_nonnulls"("received_coin_1_count", "received_coin_2_count", "received_coin_5_count", "received_coin_10_count", "received_banknote_20_count", "received_banknote_50_count", "received_banknote_100_count", "received_banknote_500_count", "received_banknote_1000_count") = 0) AND ("received_by_user_id" IS NULL) AND ("received_at" IS NULL)) OR (("cash_status" = 'received'::"text") AND ("num_nonnulls"("received_coin_1_count", "received_coin_2_count", "received_coin_5_count", "received_coin_10_count", "received_banknote_20_count", "received_banknote_50_count", "received_banknote_100_count", "received_banknote_500_count", "received_banknote_1000_count") = 9) AND ("received_by_user_id" IS NOT NULL) AND ("received_at" IS NOT NULL)))),
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
    CONSTRAINT "money_transfer_cash_details_sent_total_check" CHECK (("sent_total" > (0)::numeric)),
    CONSTRAINT "money_transfer_cash_details_sent_total_positive_check" CHECK (("sent_total" > (0)::numeric))
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
    "rubber_bill_id" "uuid",
    "ocr_ticket_id" "uuid",
    CONSTRAINT "money_transfer_items_source_fk_shape_check" CHECK (((("source_type" = 'rubber_bill'::"text") AND ("rubber_bill_id" IS NOT NULL) AND ("rubber_bill_id" = "source_id") AND ("ocr_ticket_id" IS NULL)) OR (("source_type" = 'ocr_ticket'::"text") AND ("ocr_ticket_id" IS NOT NULL) AND ("ocr_ticket_id" = "source_id") AND ("rubber_bill_id" IS NULL)))),
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
    "can_access_super_admin_features" boolean DEFAULT false NOT NULL,
    "can_manage_time_payroll" boolean DEFAULT false NOT NULL
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
    "edit_window_minutes_snapshot" integer NOT NULL,
    CONSTRAINT "rubber_bill_approval_decision_shape" CHECK (((("request_status" = 'pending'::"text") AND ("approved_by_user_id" IS NULL) AND ("approved_at" IS NULL)) OR (("request_status" = 'approved'::"text") AND ("approved_by_user_id" IS NOT NULL) AND ("approved_at" IS NOT NULL)))),
    CONSTRAINT "rubber_bill_approval_request_shape" CHECK (((("operation" = 'create'::"text") AND ("bill_id" IS NULL) AND ("original_payload" IS NULL)) OR (("operation" = ANY (ARRAY['update'::"text", 'delete'::"text"])) AND ("bill_id" IS NOT NULL) AND ("original_payload" IS NOT NULL)))),
    CONSTRAINT "rubber_bill_approval_requests_edit_window_snapshot_check" CHECK (("edit_window_minutes_snapshot" >= 0)),
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


CREATE TABLE IF NOT EXISTS "public"."telegram_badge_catalog" (
    "badge_key" "text" NOT NULL,
    "module_name" "text" NOT NULL,
    "status_label" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    CONSTRAINT "telegram_badge_catalog_badge_key_check" CHECK (("badge_key" ~ '^[a-z0-9_]+$'::"text"))
);


ALTER TABLE "public"."telegram_badge_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telegram_badge_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "chat_id" "text",
    "start_time" time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    "end_time" time without time zone DEFAULT '20:00:00'::time without time zone NOT NULL,
    "interval_minutes" integer DEFAULT 60 NOT NULL,
    "enabled_badge_keys" "text"[] DEFAULT ARRAY['rubber_bill_approval_pending'::"text", 'income_expense_approval_pending'::"text", 'cash_transfer_pending_receipt'::"text", 'stock_approval_pending'::"text", 'money_transfer_pending'::"text", 'money_transfer_partial'::"text", 'money_transfer_advance'::"text", 'time_tracking_approval_pending'::"text", 'rubber_export_draft'::"text"] NOT NULL,
    "bot_token_secret_id" "uuid",
    "dispatch_secret_id" "uuid",
    "edge_url_secret_id" "uuid",
    "initial_attempt_at" timestamp with time zone,
    "retry_at" timestamp with time zone,
    "pending_slot_at" timestamp with time zone,
    "claim_token" "uuid",
    "claimed_at" timestamp with time zone,
    "last_completed_slot_at" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "last_success_at" timestamp with time zone,
    "last_error" "text",
    "updated_by_user_id" "uuid",
    "updated_by_name" "text",
    "updated_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "telegram_badge_settings_chat_id_check" CHECK ((("chat_id" IS NULL) OR (NULLIF("btrim"("chat_id"), ''::"text") IS NOT NULL))),
    CONSTRAINT "telegram_badge_settings_check" CHECK (("start_time" < "end_time")),
    CONSTRAINT "telegram_badge_settings_id_check" CHECK (("id" = true)),
    CONSTRAINT "telegram_badge_settings_interval_minutes_check" CHECK ((("interval_minutes" >= 10) AND ("interval_minutes" <= 240)))
);


ALTER TABLE "public"."telegram_badge_settings" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."time_tracking_resume_schedules" (
    "profile_id" "uuid" NOT NULL,
    "payroll_slip_id" "uuid" NOT NULL,
    "resume_at" timestamp with time zone NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."time_tracking_resume_schedules" OWNER TO "postgres";


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



ALTER TABLE ONLY "public"."cash_transfer_delete_requests"
    ADD CONSTRAINT "cash_transfer_delete_requests_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."dashboard_alert_thresholds"
    ADD CONSTRAINT "dashboard_alert_thresholds_pkey" PRIMARY KEY ("location_id");



ALTER TABLE ONLY "public"."dashboard_branch_snapshots"
    ADD CONSTRAINT "dashboard_branch_snapshots_pkey" PRIMARY KEY ("location_id");



ALTER TABLE ONLY "public"."dashboard_refresh_settings"
    ADD CONSTRAINT "dashboard_refresh_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dashboard_stock_alert_thresholds"
    ADD CONSTRAINT "dashboard_stock_alert_thresholds_pkey" PRIMARY KEY ("location_id", "product_id");



ALTER TABLE ONLY "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."financial_transactions"
    ADD CONSTRAINT "financial_transactions_withdrawal_expense_assignment" CHECK ((("type" <> 'WITHDRAWAL'::"public"."financial_transaction_type") OR ("status" <> 'APPROVED'::"public"."approval_status") OR ("cancelled_at" IS NOT NULL) OR ("approved_at" IS NOT NULL))) NOT VALID;



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



ALTER TABLE ONLY "public"."income_expense_sale_lines"
    ADD CONSTRAINT "income_expense_sale_lines_income_expense_id_sequence_no_key" UNIQUE ("income_expense_id", "sequence_no");



ALTER TABLE ONLY "public"."income_expense_sale_lines"
    ADD CONSTRAINT "income_expense_sale_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income_sale_items"
    ADD CONSTRAINT "income_sale_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_provision_request_id_key" UNIQUE ("provision_request_id");



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
    ADD CONSTRAINT "payroll_slips_expense_assignment" CHECK ((("status" <> 'APPROVED'::"public"."approval_status") OR ("cancelled_at" IS NOT NULL) OR ("net_pay" <= (0)::numeric) OR ("approved_at" IS NOT NULL))) NOT VALID;



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



ALTER TABLE ONLY "public"."telegram_badge_catalog"
    ADD CONSTRAINT "telegram_badge_catalog_pkey" PRIMARY KEY ("badge_key");



ALTER TABLE ONLY "public"."telegram_badge_catalog"
    ADD CONSTRAINT "telegram_badge_catalog_sort_order_key" UNIQUE ("sort_order");



ALTER TABLE ONLY "public"."telegram_badge_settings"
    ADD CONSTRAINT "telegram_badge_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_segments"
    ADD CONSTRAINT "time_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_tracking_audit_logs"
    ADD CONSTRAINT "time_tracking_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_tracking_resume_schedules"
    ADD CONSTRAINT "time_tracking_resume_schedules_payroll_slip_id_key" UNIQUE ("payroll_slip_id");



ALTER TABLE ONLY "public"."time_tracking_resume_schedules"
    ADD CONSTRAINT "time_tracking_resume_schedules_pkey" PRIMARY KEY ("profile_id");



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



CREATE UNIQUE INDEX "cash_transfer_delete_requests_one_pending" ON "public"."cash_transfer_delete_requests" USING "btree" ("transfer_id") WHERE (("request_status" = 'pending'::"text") AND ("transfer_id" IS NOT NULL));



CREATE INDEX "cash_transfer_delete_requests_status_created" ON "public"."cash_transfer_delete_requests" USING "btree" ("request_status", "created_at" DESC);



CREATE INDEX "cash_transfer_pending_digest" ON "public"."money_transfer_cash_details" USING "btree" ("transfer_id") WHERE ("cash_status" = 'pending_receipt'::"text");



CREATE UNIQUE INDEX "customer_bank_accounts_only_one_primary" ON "public"."customer_bank_accounts" USING "btree" ("customer_id") WHERE ("is_primary" = true);



CREATE INDEX "dashboard_branch_snapshots_work_idx" ON "public"."dashboard_branch_snapshots" USING "btree" ("status", "updated_at", "location_id") WHERE ("status" = ANY (ARRAY['dirty'::"text", 'queued'::"text", 'failed'::"text"]));



CREATE INDEX "dashboard_income_expense_money_feed_idx" ON "public"."income_expense" USING "btree" ("location_id", COALESCE("client_recorded_at", "created_at") DESC, (('actual:'::"text" || ("id")::"text")) DESC) WHERE (("record_status" = 'active'::"public"."record_status") AND ("cost" > (0)::numeric));



CREATE INDEX "dashboard_ocr_money_feed_idx" ON "public"."ocr_tickets" USING "btree" ("location_id", COALESCE("client_recorded_at", "created_at") DESC, (('ocr-ticket:'::"text" || ("id")::"text")) DESC) WHERE (("record_status" = 'active'::"public"."record_status") AND ("total_amount" > (0)::numeric));



CREATE INDEX "dashboard_rubber_bill_money_feed_idx" ON "public"."rubber_bills" USING "btree" ("location_id", COALESCE("client_recorded_at", "created_at") DESC, (('rubber-bill:'::"text" || ("id")::"text")) DESC) WHERE ("record_status" = 'active'::"public"."record_status");



CREATE INDEX "financial_transactions_deduction_month" ON "public"."financial_transactions" USING "btree" ("profile_id", "applied_month", "parent_debt_id") WHERE (("type" = ANY (ARRAY['DEBT_DEDUCTION'::"public"."financial_transaction_type", 'WITHDRAWAL_DEDUCTION'::"public"."financial_transaction_type"])) AND ("status" = 'APPROVED'::"public"."approval_status"));



CREATE INDEX "financial_transactions_outstanding_queue" ON "public"."financial_transactions" USING "btree" ("profile_id", "effective_date", "created_at", "id") WHERE (("type" = ANY (ARRAY['DEBT'::"public"."financial_transaction_type", 'WITHDRAWAL'::"public"."financial_transaction_type"])) AND ("status" = 'APPROVED'::"public"."approval_status") AND ("remaining_amount" > (0)::numeric));



CREATE INDEX "financial_transactions_pending_digest" ON "public"."financial_transactions" USING "btree" ("id") WHERE ("status" = 'PENDING'::"public"."approval_status");



CREATE INDEX "financial_transactions_pending_effective_date" ON "public"."financial_transactions" USING "btree" ("profile_id", "effective_date") WHERE (("type" = ANY (ARRAY['DEBT'::"public"."financial_transaction_type", 'WITHDRAWAL'::"public"."financial_transaction_type"])) AND ("status" = 'PENDING'::"public"."approval_status"));



CREATE INDEX "financial_transactions_withdrawal_expense_feed_idx" ON "public"."financial_transactions" USING "btree" ("expense_location_id", "approved_at" DESC, "id" DESC) WHERE (("type" = 'WITHDRAWAL'::"public"."financial_transaction_type") AND ("status" = 'APPROVED'::"public"."approval_status") AND ("cancelled_at" IS NULL));



CREATE UNIQUE INDEX "idx_customer_bank_accounts_primary" ON "public"."customer_bank_accounts" USING "btree" ("customer_id") WHERE ("is_primary" = true);



CREATE INDEX "idx_stock_entries_location_active" ON "public"."stock_entries" USING "btree" ("location_id", "tx_date" DESC) WHERE ("record_status" = 'active'::"public"."record_status");



CREATE INDEX "idx_stock_entries_product_location" ON "public"."stock_entries" USING "btree" ("product_id", "location_id");



CREATE UNIQUE INDEX "income_expense_approval_keywords_active_unique" ON "public"."income_expense_approval_keywords" USING "btree" ("lower"(TRIM(BOTH FROM "keyword")), "applies_to") WHERE (("is_active" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "income_expense_approval_pending_digest" ON "public"."income_expense_approval_requests" USING "btree" ("location_id") WHERE ("request_status" = 'pending'::"text");



CREATE INDEX "income_expense_feed_active_idx" ON "public"."income_expense" USING "btree" ("location_id", "tx_date" DESC, "created_at" DESC, "id" DESC) WHERE ("record_status" = 'active'::"public"."record_status");



CREATE INDEX "income_expense_sale_lines_parent_idx" ON "public"."income_expense_sale_lines" USING "btree" ("income_expense_id", "sequence_no");



CREATE INDEX "income_expense_sale_lines_stock_idx" ON "public"."income_expense_sale_lines" USING "btree" ("stock_product_id", "income_expense_id");



CREATE UNIQUE INDEX "income_sale_items_name_active_idx" ON "public"."income_sale_items" USING "btree" ("lower"(TRIM(BOTH FROM "name"))) WHERE ("is_active" = true);



CREATE UNIQUE INDEX "locations_code_case_insensitive_key" ON "public"."locations" USING "btree" ("upper"("code")) WHERE ("code" IS NOT NULL);



CREATE INDEX "money_transfer_cash_details_status_idx" ON "public"."money_transfer_cash_details" USING "btree" ("cash_status", "sent_at" DESC);



CREATE UNIQUE INDEX "money_transfer_items_source_unique" ON "public"."money_transfer_items" USING "btree" ("source_type", "source_id");



CREATE INDEX "money_transfer_pending_digest" ON "public"."money_transfers" USING "btree" ("location_id", "transfer_status") WHERE (("transfer_method" = 'bank'::"text") AND ("transfer_status" = ANY (ARRAY['pending'::"text", 'partial'::"text", 'advance_payment'::"text"])) AND ("record_status" <> 'deleted'::"public"."record_status"));



CREATE INDEX "money_transfers_feed_source_idx" ON "public"."money_transfers" USING "btree" ("location_id", "created_at" DESC, "id" DESC) WHERE ("record_status" <> 'deleted'::"public"."record_status");



CREATE INDEX "money_transfers_feed_target_idx" ON "public"."money_transfers" USING "btree" ("target_location_id", "created_at" DESC, "id" DESC) WHERE (("record_status" <> 'deleted'::"public"."record_status") AND ("transfer_status" <> 'cancelled'::"text") AND ("transfer_type" = 'branch'::"text"));



CREATE INDEX "ocr_tickets_feed_active_idx" ON "public"."ocr_tickets" USING "btree" ("location_id", "date_in" DESC, "id") WHERE (("record_status" = 'active'::"public"."record_status") AND ("total_amount" > (0)::numeric));



CREATE UNIQUE INDEX "ocr_tickets_location_file_unique" ON "public"."ocr_tickets" USING "btree" ("location_id", "file_name") WHERE ("record_status" = 'active'::"public"."record_status");



CREATE INDEX "payroll_slips_expense_feed_idx" ON "public"."payroll_slips" USING "btree" ("expense_location_id", "approved_at" DESC, "id" DESC) WHERE (("status" = 'APPROVED'::"public"."approval_status") AND ("cancelled_at" IS NULL) AND ("net_pay" > (0)::numeric));



CREATE INDEX "payroll_slips_pending_digest" ON "public"."payroll_slips" USING "btree" ("id") WHERE ("status" = 'PENDING'::"public"."approval_status");



CREATE UNIQUE INDEX "profiles_only_one_super_admin" ON "public"."profiles" USING "btree" ("role") WHERE ("role" = 'super_admin'::"public"."app_role");



CREATE INDEX "report_batches_latest_active" ON "public"."report_batches" USING "btree" ("location_id", "created_at" DESC, "id" DESC) WHERE ("status" = 'active'::"text");



CREATE INDEX "report_batches_location_history" ON "public"."report_batches" USING "btree" ("location_id", "created_at" DESC);



CREATE INDEX "report_items_active_source" ON "public"."report_items" USING "btree" ("entity_type", "entity_id") WHERE ("active" = true);



CREATE UNIQUE INDEX "report_items_one_active_context" ON "public"."report_items" USING "btree" ("location_id", "entity_type", "entity_id") WHERE ("active" = true);



CREATE UNIQUE INDEX "rubber_bill_approval_one_pending_bill" ON "public"."rubber_bill_approval_requests" USING "btree" ("bill_id") WHERE (("request_status" = 'pending'::"text") AND ("bill_id" IS NOT NULL));



CREATE UNIQUE INDEX "rubber_bill_approval_one_pending_create" ON "public"."rubber_bill_approval_requests" USING "btree" ("client_temp_id") WHERE (("request_status" = 'pending'::"text") AND ("operation" = 'create'::"text"));



CREATE INDEX "rubber_bill_approval_queue" ON "public"."rubber_bill_approval_requests" USING "btree" ("request_status", "requested_at" DESC);



CREATE INDEX "rubber_bill_items_payable_lookup" ON "public"."rubber_bill_items" USING "btree" ("bill_id", "item_type", "price");



CREATE INDEX "rubber_bills_feed_active_idx" ON "public"."rubber_bills" USING "btree" ("location_id", "bill_date" DESC, "id") WHERE (("record_status" = 'active'::"public"."record_status") AND ("net_total" > (0)::numeric));



CREATE UNIQUE INDEX "rubber_export_items_one_active_bill" ON "public"."rubber_export_items" USING "btree" ("location_id", "source_bill_id") WHERE ("active" = true);



CREATE INDEX "rubber_export_items_source_report" ON "public"."rubber_export_items" USING "btree" ("source_report_item_id") WHERE ("active" = true);



CREATE INDEX "rubber_exports_draft_digest" ON "public"."rubber_exports" USING "btree" ("location_id") WHERE ("status" = 'draft'::"text");



CREATE INDEX "rubber_exports_location_history" ON "public"."rubber_exports" USING "btree" ("location_id", "created_at" DESC, "id" DESC);



CREATE INDEX "rubber_exports_report_candidates" ON "public"."rubber_exports" USING "btree" ("location_id", "verified_at", "id") WHERE (("status" = 'verified'::"text") AND ("expense_destination" = 'branch'::"text") AND ("work_total" > (0)::numeric));



CREATE UNIQUE INDEX "stock_entry_approval_requests_pending_entry_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("stock_entry_id") WHERE ("request_status" = 'pending'::"text");



CREATE UNIQUE INDEX "stock_entry_approval_requests_pending_transfer_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("transfer_bill_no") WHERE (("request_status" = 'pending'::"text") AND ("transfer_bill_no" IS NOT NULL) AND ("tx_type" = 'transfer_out'::"text"));



CREATE INDEX "stock_entry_approval_requests_status_created_idx" ON "public"."stock_entry_approval_requests" USING "btree" ("request_status", "created_at" DESC);



CREATE UNIQUE INDEX "stock_product_approval_requests_pending_create_name_idx" ON "public"."stock_product_approval_requests" USING "btree" ("lower"(TRIM(BOTH FROM "product_name"))) WHERE (("request_status" = 'pending'::"text") AND ("request_type" = 'create_product'::"text"));



CREATE UNIQUE INDEX "stock_product_approval_requests_pending_delete_product_idx" ON "public"."stock_product_approval_requests" USING "btree" ("product_id") WHERE (("request_status" = 'pending'::"text") AND ("request_type" = 'delete_product'::"text"));



CREATE INDEX "stock_product_approval_requests_status_created_idx" ON "public"."stock_product_approval_requests" USING "btree" ("request_status", "created_at" DESC);



CREATE UNIQUE INDEX "time_segments_one_active_per_profile" ON "public"."time_segments" USING "btree" ("profile_id") WHERE ("end_time" IS NULL);



CREATE INDEX "time_tracking_resume_schedules_due" ON "public"."time_tracking_resume_schedules" USING "btree" ("resume_at");



CREATE UNIQUE INDEX "transport_staff_bank_accounts_one_primary" ON "public"."transport_staff_bank_accounts" USING "btree" ("staff_id") WHERE ("is_primary" = true);



CREATE UNIQUE INDEX "user_locations_one_primary_per_user" ON "public"."user_locations" USING "btree" ("user_id") WHERE ("is_primary" = true);



CREATE OR REPLACE TRIGGER "assign_rubber_bill_item_sequence" BEFORE INSERT ON "public"."rubber_bill_items" FOR EACH ROW EXECUTE FUNCTION "private"."assign_rubber_bill_item_sequence"();



CREATE OR REPLACE TRIGGER "dashboard_dirty_financial_transactions" AFTER INSERT OR DELETE OR UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_location_columns"('expense_location_id');



CREATE OR REPLACE TRIGGER "dashboard_dirty_income_expense" AFTER INSERT OR DELETE OR UPDATE ON "public"."income_expense" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_location_columns"('location_id');



CREATE OR REPLACE TRIGGER "dashboard_dirty_money_transfer_cash_details" AFTER INSERT OR DELETE OR UPDATE ON "public"."money_transfer_cash_details" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_money_transfer_dependents"();



CREATE OR REPLACE TRIGGER "dashboard_dirty_money_transfer_items" AFTER INSERT OR DELETE OR UPDATE ON "public"."money_transfer_items" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_money_transfer_dependents"();



CREATE OR REPLACE TRIGGER "dashboard_dirty_money_transfers" AFTER INSERT OR DELETE OR UPDATE ON "public"."money_transfers" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_location_columns"('location_id', 'target_location_id');



CREATE OR REPLACE TRIGGER "dashboard_dirty_ocr_tickets" AFTER INSERT OR DELETE OR UPDATE ON "public"."ocr_tickets" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_location_columns"('location_id');



CREATE OR REPLACE TRIGGER "dashboard_dirty_payroll_slips" AFTER INSERT OR DELETE OR UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_location_columns"('expense_location_id');



CREATE OR REPLACE TRIGGER "dashboard_dirty_rubber_bill_items" AFTER INSERT OR DELETE OR UPDATE ON "public"."rubber_bill_items" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_rubber_bill_items"();



CREATE OR REPLACE TRIGGER "dashboard_dirty_rubber_bills" AFTER INSERT OR DELETE OR UPDATE ON "public"."rubber_bills" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_location_columns"('location_id');



CREATE OR REPLACE TRIGGER "dashboard_dirty_rubber_exports" AFTER INSERT OR DELETE OR UPDATE ON "public"."rubber_exports" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_location_columns"('location_id');



CREATE OR REPLACE TRIGGER "dashboard_dirty_stock_entries" AFTER INSERT OR DELETE OR UPDATE ON "public"."stock_entries" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_dirty_location_columns"('location_id');



CREATE OR REPLACE TRIGGER "dashboard_dirty_stock_products" AFTER INSERT OR DELETE OR UPDATE ON "public"."stock_products" FOR EACH STATEMENT EXECUTE FUNCTION "private"."dashboard_dirty_all_active_locations"();



CREATE OR REPLACE TRIGGER "dashboard_seed_locations" AFTER INSERT OR UPDATE OF "is_active" ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "private"."dashboard_seed_active_location"();



CREATE OR REPLACE TRIGGER "default_first_user_location_primary" BEFORE INSERT ON "public"."user_locations" FOR EACH ROW EXECUTE FUNCTION "private"."default_first_user_location_primary"();



CREATE OR REPLACE TRIGGER "enforce_financial_transaction_expense_relation" BEFORE UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_time_tracking_expense_relation"();



CREATE OR REPLACE TRIGGER "enforce_payroll_slip_expense_relation" BEFORE UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "private"."enforce_time_tracking_expense_relation"();



CREATE CONSTRAINT TRIGGER "enforce_user_primary_location" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_locations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "private"."enforce_user_primary_location"();



CREATE OR REPLACE TRIGGER "guard_approved_rubber_bill_request_history" BEFORE DELETE OR UPDATE ON "public"."rubber_bill_approval_requests" FOR EACH ROW EXECUTE FUNCTION "private"."guard_approved_rubber_bill_request_history"();



CREATE OR REPLACE TRIGGER "guard_rubber_export_state" BEFORE UPDATE ON "public"."rubber_exports" FOR EACH ROW EXECUTE FUNCTION "private"."guard_rubber_export_state"();



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."time_segments" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "income_expense_lock_location" BEFORE UPDATE ON "public"."income_expense" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_location_change"();



CREATE OR REPLACE TRIGGER "locations_code_immutable" BEFORE UPDATE OF "code" ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_location_code_change"();



CREATE OR REPLACE TRIGGER "money_transfer_items_sync_source_fks" BEFORE INSERT OR UPDATE OF "source_type", "source_id", "rubber_bill_id", "ocr_ticket_id" ON "public"."money_transfer_items" FOR EACH ROW EXECUTE FUNCTION "public"."sync_money_transfer_item_source_fks"();



CREATE OR REPLACE TRIGGER "ocr_tickets_transfer_relation_delete_lock" BEFORE DELETE ON "public"."ocr_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_locked_ocr_ticket_change"();



CREATE OR REPLACE TRIGGER "ocr_tickets_transfer_relation_update_lock" BEFORE UPDATE ON "public"."ocr_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_locked_ocr_ticket_change"();



CREATE OR REPLACE TRIGGER "pending_rubber_bill_blocks_money_transfer" BEFORE INSERT OR UPDATE ON "public"."money_transfer_items" FOR EACH ROW EXECUTE FUNCTION "private"."guard_pending_rubber_bill_relation"();



CREATE OR REPLACE TRIGGER "pending_rubber_bill_blocks_report" BEFORE INSERT OR UPDATE ON "public"."report_items" FOR EACH ROW EXECUTE FUNCTION "private"."guard_pending_rubber_bill_relation"();



CREATE OR REPLACE TRIGGER "prevent_hard_delete_of_linked_financial_transaction" BEFORE DELETE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"();



CREATE OR REPLACE TRIGGER "prevent_hard_delete_of_linked_payroll_slip" BEFORE DELETE ON "public"."payroll_slips" FOR EACH ROW EXECUTE FUNCTION "private"."prevent_hard_delete_of_linked_time_tracking_source"();



CREATE OR REPLACE TRIGGER "report_lock_financial_transactions" BEFORE DELETE OR UPDATE ON "public"."financial_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('financial_transaction');



CREATE OR REPLACE TRIGGER "report_lock_income_expense" BEFORE DELETE OR UPDATE ON "public"."income_expense" FOR EACH ROW EXECUTE FUNCTION "private"."guard_reported_entity"('income_expense');



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



ALTER TABLE ONLY "public"."cash_transfer_delete_requests"
    ADD CONSTRAINT "cash_transfer_delete_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cash_transfer_delete_requests"
    ADD CONSTRAINT "cash_transfer_delete_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cash_transfer_delete_requests"
    ADD CONSTRAINT "cash_transfer_delete_requests_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."cash_transfer_delete_requests"
    ADD CONSTRAINT "cash_transfer_delete_requests_target_location_id_fkey" FOREIGN KEY ("target_location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."cash_transfer_delete_requests"
    ADD CONSTRAINT "cash_transfer_delete_requests_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "public"."money_transfers"("id") ON DELETE SET NULL;



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



ALTER TABLE ONLY "public"."dashboard_alert_thresholds"
    ADD CONSTRAINT "dashboard_alert_thresholds_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_alert_thresholds"
    ADD CONSTRAINT "dashboard_alert_thresholds_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."dashboard_branch_snapshots"
    ADD CONSTRAINT "dashboard_branch_snapshots_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_refresh_settings"
    ADD CONSTRAINT "dashboard_refresh_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."dashboard_stock_alert_thresholds"
    ADD CONSTRAINT "dashboard_stock_alert_thresholds_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_stock_alert_thresholds"
    ADD CONSTRAINT "dashboard_stock_alert_thresholds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."stock_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_stock_alert_thresholds"
    ADD CONSTRAINT "dashboard_stock_alert_thresholds_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("id");



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



ALTER TABLE ONLY "public"."income_expense_sale_lines"
    ADD CONSTRAINT "income_expense_sale_lines_income_expense_id_fkey" FOREIGN KEY ("income_expense_id") REFERENCES "public"."income_expense"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."income_expense_sale_lines"
    ADD CONSTRAINT "income_expense_sale_lines_income_sale_item_id_fkey" FOREIGN KEY ("income_sale_item_id") REFERENCES "public"."income_sale_items"("id");



ALTER TABLE ONLY "public"."income_expense_sale_lines"
    ADD CONSTRAINT "income_expense_sale_lines_stock_product_id_fkey" FOREIGN KEY ("stock_product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."income_expense"
    ADD CONSTRAINT "income_expense_stock_product_id_fkey" FOREIGN KEY ("stock_product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."income_sale_items"
    ADD CONSTRAINT "income_sale_items_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_sale_items"
    ADD CONSTRAINT "income_sale_items_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."income_sale_items"
    ADD CONSTRAINT "income_sale_items_stock_product_id_fkey" FOREIGN KEY ("stock_product_id") REFERENCES "public"."stock_products"("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."money_transfer_cash_details"
    ADD CONSTRAINT "money_transfer_cash_details_difference_accepted_by_user_id_fkey" FOREIGN KEY ("difference_accepted_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."money_transfer_cash_details"
    ADD CONSTRAINT "money_transfer_cash_details_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."money_transfer_cash_details"
    ADD CONSTRAINT "money_transfer_cash_details_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "public"."money_transfers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."money_transfer_items"
    ADD CONSTRAINT "money_transfer_items_ocr_ticket_fk" FOREIGN KEY ("ocr_ticket_id") REFERENCES "public"."ocr_tickets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."money_transfer_items"
    ADD CONSTRAINT "money_transfer_items_rubber_bill_fk" FOREIGN KEY ("rubber_bill_id") REFERENCES "public"."rubber_bills"("id") ON DELETE RESTRICT;



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



ALTER TABLE ONLY "public"."report_batches"
    ADD CONSTRAINT "report_batches_previous_report_id_fkey" FOREIGN KEY ("previous_report_id") REFERENCES "public"."report_batches"("id");



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



ALTER TABLE ONLY "public"."telegram_badge_settings"
    ADD CONSTRAINT "telegram_badge_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."time_segments"
    ADD CONSTRAINT "time_segments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."time_tracking_audit_logs"
    ADD CONSTRAINT "time_tracking_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."time_tracking_resume_schedules"
    ADD CONSTRAINT "time_tracking_resume_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."time_tracking_resume_schedules"
    ADD CONSTRAINT "time_tracking_resume_schedules_payroll_slip_id_fkey" FOREIGN KEY ("payroll_slip_id") REFERENCES "public"."payroll_slips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."time_tracking_resume_schedules"
    ADD CONSTRAINT "time_tracking_resume_schedules_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



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



CREATE POLICY "cash transfer delete requests read" ON "public"."cash_transfer_delete_requests" FOR SELECT TO "authenticated" USING (("private"."can_access_super_admin_features"() OR ("requested_by_user_id" = "auth"."uid"()) OR "private"."can_access_location"("source_location_id")));



ALTER TABLE "public"."cash_transfer_delete_requests" ENABLE ROW LEVEL SECURITY;


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



ALTER TABLE "public"."dashboard_alert_thresholds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_branch_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_refresh_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dashboard_stock_alert_thresholds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."financial_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "financial_transactions_read_self_or_manager" ON "public"."financial_transactions" FOR SELECT TO "authenticated" USING ((("profile_id" = "auth"."uid"()) OR "private"."can_manage_time_payroll_profile"("profile_id")));



ALTER TABLE "public"."income_expense" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."income_expense_approval_keywords" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_expense_approval_keywords_read" ON "public"."income_expense_approval_keywords" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR "public"."is_super_admin"()));



CREATE POLICY "income_expense_approval_keywords_system_manager_write" ON "public"."income_expense_approval_keywords" TO "authenticated" USING ("public"."can_access_super_admin_features"()) WITH CHECK ("public"."can_access_super_admin_features"());



ALTER TABLE "public"."income_expense_approval_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_expense_approval_requests_read" ON "public"."income_expense_approval_requests" FOR SELECT TO "authenticated" USING (("public"."can_access_super_admin_features"() OR ("requested_by_user_id" = "auth"."uid"()) OR "public"."can_access_location"("location_id")));



ALTER TABLE "public"."income_expense_approval_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_expense_approval_settings_read" ON "public"."income_expense_approval_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "income_expense_approval_settings_system_manager_write" ON "public"."income_expense_approval_settings" TO "authenticated" USING ("public"."can_access_super_admin_features"()) WITH CHECK ("public"."can_access_super_admin_features"());



ALTER TABLE "public"."income_expense_sale_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_expense_sale_lines_location_read" ON "public"."income_expense_sale_lines" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."income_expense" "ie"
  WHERE (("ie"."id" = "income_expense_sale_lines"."income_expense_id") AND "public"."can_access_location"("ie"."location_id")))));



CREATE POLICY "income_expense_select_location_scope" ON "public"."income_expense" FOR SELECT TO "authenticated" USING ("public"."can_access_location"("location_id"));



ALTER TABLE "public"."income_sale_items" ENABLE ROW LEVEL SECURITY;


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


CREATE POLICY "payroll_slips_read_self_or_manager" ON "public"."payroll_slips" FOR SELECT TO "authenticated" USING ((("profile_id" = "auth"."uid"()) OR "private"."can_manage_time_payroll_profile"("profile_id")));



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



CREATE POLICY "system managers read telegram badge catalog" ON "public"."telegram_badge_catalog" FOR SELECT TO "authenticated" USING (("private"."is_active_user"() AND "public"."can_access_super_admin_features"()));



CREATE POLICY "system managers read telegram badge settings" ON "public"."telegram_badge_settings" FOR SELECT TO "authenticated" USING (("private"."is_active_user"() AND "public"."can_access_super_admin_features"()));



ALTER TABLE "public"."telegram_badge_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."telegram_badge_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."time_segments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "time_segments_read_self_or_manager" ON "public"."time_segments" FOR SELECT TO "authenticated" USING ((("profile_id" = "auth"."uid"()) OR "private"."can_manage_time_payroll_profile"("profile_id")));



ALTER TABLE "public"."time_tracking_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "time_tracking_audit_logs_read_manager" ON "public"."time_tracking_audit_logs" FOR SELECT TO "authenticated" USING (("private"."can_access_super_admin_features"() OR ("private"."has_time_payroll_manager_access"() AND ("admin_id" = "auth"."uid"()))));



ALTER TABLE "public"."time_tracking_resume_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "time_tracking_resume_schedules_read_self_or_manager" ON "public"."time_tracking_resume_schedules" FOR SELECT TO "authenticated" USING ((("profile_id" = "auth"."uid"()) OR "private"."can_manage_time_payroll_profile"("profile_id")));



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



REVOKE ALL ON FUNCTION "private"."apply_time_tracking_deductions"("p_profile_id" "uuid", "p_through_month" "date") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."calculate_dashboard_summary"("p_location_id" "uuid") FROM PUBLIC;



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



REVOKE ALL ON FUNCTION "private"."can_manage_time_payroll_profile"("target_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_time_payroll_profile"("target_profile_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_view_profile"("target_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_view_profile"("target_user" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."claim_dashboard_branch"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."dashboard_dirty_all_active_locations"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."dashboard_dirty_location_columns"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."dashboard_dirty_money_transfer_dependents"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."dashboard_dirty_rubber_bill_items"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."dashboard_require_manager"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."dashboard_rollover_if_needed"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."dashboard_seed_active_location"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."has_time_payroll_manager_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."has_time_payroll_manager_access"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_active_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_active_user"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_super_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_time_payroll_manager"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_time_payroll_manager"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."mark_dashboard_dirty"("p_location_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."normalize_income_sale_lines"("payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."normalize_rubber_bill_calculation_payload"("payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."prevent_location_code_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."rebuild_dashboard_branch"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."report_income_expense_period_rows"("p_report_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."rubber_bill_is_payable"("p_bill_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."rubber_bill_report_blockers"("p_location_id" "uuid", "p_cutoff_at" timestamp with time zone) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."sync_income_sale_bill"("payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."telegram_badge_latest_slot"("p_now" timestamp with time zone, "p_start_time" time without time zone, "p_end_time" time without time zone, "p_interval_minutes" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."telegram_badge_require_manager"() FROM PUBLIC;



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



REVOKE ALL ON FUNCTION "public"."claim_telegram_badge_dispatch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_telegram_badge_dispatch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_telegram_badge_dispatch"("p_claim_token" "uuid", "p_outcome" "text", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_telegram_badge_dispatch"("p_claim_token" "uuid", "p_outcome" "text", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."configure_telegram_badge_dispatcher"("p_edge_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."configure_telegram_badge_dispatcher"("p_edge_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_cash_branch_transfer"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_cash_branch_transfer"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_income_expense_approval_request"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_income_expense_approval_request"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_report_batch"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_report_batch"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_rubber_export"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_rubber_export"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_stock_entry_delete_approval_request"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_stock_entry_delete_approval_request"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_stock_product_approval_request"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_stock_product_approval_request"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_stock_product_with_sale_item"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_stock_product_with_sale_item"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_time_tracking_payroll_slip"("p_profile_id" "uuid", "p_month" "text", "p_auto_start_next_month" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_time_tracking_payroll_slip"("p_profile_id" "uuid", "p_month" "text", "p_auto_start_next_month" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_time_tracking_transaction"("p_profile_id" "uuid", "p_type" "text", "p_amount" numeric, "p_effective_date" "date", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_time_tracking_transaction"("p_profile_id" "uuid", "p_type" "text", "p_amount" numeric, "p_effective_date" "date", "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_profile_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_profile_id"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cutoff_time_tracking"("p_profile_id" "uuid", "p_cutoff_time" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cutoff_time_tracking"("p_profile_id" "uuid", "p_cutoff_time" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_cash_transfer_delete_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_cash_transfer_delete_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_income_expense_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_income_expense_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_stock_entry_delete_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_stock_entry_delete_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_stock_product_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_stock_product_approval_request"("p_request_id" "uuid", "p_decision" "text", "p_comment" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."decide_time_tracking_approval"("p_source_type" "text", "p_source_id" "uuid", "p_decision" "text", "p_comment" "text", "p_expense_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decide_time_tracking_approval"("p_source_type" "text", "p_source_id" "uuid", "p_decision" "text", "p_comment" "text", "p_expense_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."deduct_debts_daily"() FROM PUBLIC;



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



REVOKE ALL ON FUNCTION "public"."dispatch_telegram_badge_tick"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dispatch_telegram_badge_tick"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_acid_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_acid_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_actionable_badge_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_actionable_badge_counts"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_dashboard_alert_thresholds"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_alert_thresholds"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_dashboard_alerts_for_telegram"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_alerts_for_telegram"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_dashboard_branch_summaries"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_branch_summaries"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_dashboard_money_feed"("p_location_id" "uuid", "p_cursor_at" timestamp with time zone, "p_cursor_key" "text", "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_money_feed"("p_location_id" "uuid", "p_cursor_at" timestamp with time zone, "p_cursor_key" "text", "p_page_size" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_dashboard_overview"("p_location_id" "uuid", "p_cursor_at" timestamp with time zone, "p_cursor_key" "text", "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_overview"("p_location_id" "uuid", "p_cursor_at" timestamp with time zone, "p_cursor_key" "text", "p_page_size" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_dashboard_refresh_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_refresh_settings"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_dashboard_snapshot"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_snapshot"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_income_expense_feed"("p_location_id" "uuid", "p_from_date" "date", "p_to_date" "date", "p_cursor_date" "date", "p_cursor_key" "text", "p_page_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_income_expense_feed"("p_location_id" "uuid", "p_from_date" "date", "p_to_date" "date", "p_cursor_date" "date", "p_cursor_key" "text", "p_page_size" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_money_transfer_receipt_source_details"("p_transfer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_money_transfer_receipt_source_details"("p_transfer_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_report_income_expense_rows"("p_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_report_income_expense_rows"("p_report_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_rubber_export_available_bills"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_rubber_export_available_bills"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_stock_balance"("p_location_id" "uuid", "p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_telegram_badge_config"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_telegram_badge_config"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_telegram_badge_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_telegram_badge_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_telegram_badge_delivery_credentials"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_telegram_badge_delivery_credentials"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_time_payroll_payment_locations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_time_payroll_payment_locations"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_rubber_bill_approval_markers"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_rubber_bill_approval_markers"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prevent_locked_ocr_ticket_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."preview_rubber_export"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preview_rubber_export"("p_location_id" "uuid", "p_selected_report_item_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."provision_location"("p_request_id" "uuid", "p_name" "text", "p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."provision_location"("p_request_id" "uuid", "p_name" "text", "p_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."queue_dashboard_refresh"("p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."queue_dashboard_refresh"("p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."receive_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."receive_cash_branch_transfer"("p_transfer_id" "uuid", "payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."remove_user_location_with_primary_replacement"("p_user_id" "uuid", "p_location_id" "uuid", "p_replacement_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_user_location_with_primary_replacement"("p_user_id" "uuid", "p_location_id" "uuid", "p_replacement_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."replace_time_tracking_segments"("p_profile_id" "uuid", "p_selections" "jsonb", "p_full_snapshot" "jsonb", "p_comment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_time_tracking_segments"("p_profile_id" "uuid", "p_selections" "jsonb", "p_full_snapshot" "jsonb", "p_comment" "text") TO "authenticated";



GRANT ALL ON TABLE "public"."financial_transactions" TO "service_role";
GRANT SELECT ON TABLE "public"."financial_transactions" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."financial_transactions") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."financial_transactions") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."financial_transactions") TO "service_role";



GRANT ALL ON TABLE "public"."income_expense" TO "service_role";
GRANT SELECT ON TABLE "public"."income_expense" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."income_expense") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."income_expense") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."income_expense") TO "service_role";



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



GRANT ALL ON TABLE "public"."payroll_slips" TO "service_role";
GRANT SELECT ON TABLE "public"."payroll_slips" TO "authenticated";



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



GRANT ALL ON TABLE "public"."time_segments" TO "service_role";
GRANT SELECT ON TABLE "public"."time_segments" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."time_segments") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."time_segments") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_lock_no"("source_row" "public"."time_segments") TO "service_role";



GRANT ALL ON TABLE "public"."report_batches" TO "service_role";
GRANT SELECT ON TABLE "public"."report_batches" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rubber_export_lock_no"("source_row" "public"."report_batches") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rubber_export_lock_no"("source_row" "public"."report_batches") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rubber_export_lock_no"("source_row" "public"."report_batches") TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_time_tracking_auto_start"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."run_time_tracking_daily_cutoff"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."save_dashboard_alert_thresholds"("p_location_id" "uuid", "p_purchase_average_min" numeric, "p_net_cash_min" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_dashboard_alert_thresholds"("p_location_id" "uuid", "p_purchase_average_min" numeric, "p_net_cash_min" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_dashboard_manager_config"("p_location_id" "uuid", "p_interval_minutes" integer, "p_purchase_average_min" numeric, "p_net_cash_min" numeric, "p_stock_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_dashboard_manager_config"("p_location_id" "uuid", "p_interval_minutes" integer, "p_purchase_average_min" numeric, "p_net_cash_min" numeric, "p_stock_items" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_dashboard_refresh_interval"("p_interval_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_dashboard_refresh_interval"("p_interval_minutes" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_dashboard_stock_alert_threshold"("p_location_id" "uuid", "p_product_id" "uuid", "p_minimum_balance" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_dashboard_stock_alert_threshold"("p_location_id" "uuid", "p_product_id" "uuid", "p_minimum_balance" numeric) TO "authenticated";



GRANT ALL ON TABLE "public"."rubber_bill_approval_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_bill_approval_settings" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_rubber_bill_approval_settings"("p_edit_window_minutes" integer, "p_configured_price" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_rubber_bill_approval_settings"("p_edit_window_minutes" integer, "p_configured_price" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_telegram_badge_config"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_telegram_badge_config"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_time_tracking_status"("p_profile_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_time_tracking_status"("p_profile_id" "uuid", "p_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_user_primary_location"("p_user_id" "uuid", "p_location_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_user_primary_location"("p_user_id" "uuid", "p_location_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_acid_stock_entry"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_acid_stock_entry"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_income_expense"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_income_expense"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_income_expense_core"("payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."sync_money_transfer_item_source_fks"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."sync_rubber_bill"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_rubber_bill"("payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sync_rubber_bill_core_20260725010000"("payload" "jsonb") FROM PUBLIC;



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



REVOKE ALL ON FUNCTION "public"."update_time_tracking_wage"("p_profile_id" "uuid", "p_daily_wage" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_time_tracking_wage"("p_profile_id" "uuid", "p_daily_wage" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."validate_stock_non_negative_after_entry_delete"("p_location_id" "uuid", "p_product_id" "uuid", "p_deleted_entry_ids" "uuid"[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."verify_rubber_export"("p_export_id" "uuid", "p_expense_destination" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_rubber_export"("p_export_id" "uuid", "p_expense_destination" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."verify_telegram_badge_dispatch_secret"("p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_telegram_badge_dispatch_secret"("p_secret" "text") TO "service_role";



GRANT ALL ON TABLE "public"."stock_products" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."stock_products" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_products" TO "service_role";
GRANT SELECT ON TABLE "public"."acid_products" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."acid_stock_entries" TO "authenticated";



GRANT ALL ON TABLE "public"."income_expense_sale_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."income_expense_sale_lines" TO "authenticated";



GRANT ALL ON TABLE "public"."rubber_bill_items" TO "service_role";
GRANT SELECT ON TABLE "public"."rubber_bill_items" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_movements" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_movements" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."acid_stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."cash_transfer_delete_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."cash_transfer_delete_requests" TO "authenticated";



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



GRANT ALL ON TABLE "public"."dashboard_alert_thresholds" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_branch_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_refresh_settings" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_stock_alert_thresholds" TO "service_role";



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



GRANT SELECT("can_manage_time_payroll") ON TABLE "public"."profiles" TO "authenticated";



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



GRANT ALL ON TABLE "public"."telegram_badge_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."telegram_badge_catalog" TO "authenticated";



GRANT ALL ON TABLE "public"."telegram_badge_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."telegram_badge_settings" TO "authenticated";



GRANT ALL ON TABLE "public"."time_tracking_audit_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."time_tracking_audit_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."time_tracking_resume_schedules" TO "service_role";
GRANT SELECT ON TABLE "public"."time_tracking_resume_schedules" TO "authenticated";



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
