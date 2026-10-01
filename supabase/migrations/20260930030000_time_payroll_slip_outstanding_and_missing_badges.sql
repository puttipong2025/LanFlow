-- Keep payroll-slip outstanding amounts immutable and expose server-authoritative
-- missing-slip months for the in-app Time/Payroll work badges.

create or replace function private.time_payroll_slip_outstanding_snapshot(
  p_profile_id uuid,
  p_month text,
  p_as_of timestamptz,
  p_deducted_this_slip numeric
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with source_targets as (
    select
      source.id,
      coalesce((
        select adjustment.amount
        from public.financial_transactions adjustment
        where adjustment.type = 'ADJUSTMENT'
          and adjustment.parent_debt_id = source.id
          and adjustment.status = 'APPROVED'
          and coalesce(adjustment.approved_at, adjustment.created_at) <= p_as_of
          and (adjustment.cancelled_at is null or adjustment.cancelled_at > p_as_of)
        order by adjustment.approved_at desc nulls last, adjustment.created_at desc, adjustment.id desc
        limit 1
      ), source.amount) as target_amount
    from public.financial_transactions source
    where source.profile_id = p_profile_id
      and source.type in ('DEBT', 'WITHDRAWAL')
      and source.status = 'APPROVED'
      and coalesce(source.approved_at, source.created_at) <= p_as_of
      and (source.cancelled_at is null or source.cancelled_at > p_as_of)
      and source.effective_date < ((p_month || '-01')::date + interval '1 month')::date
  ), deducted_through_slip as (
    select child.parent_debt_id, coalesce(sum(child.amount), 0) as amount
    from public.financial_transactions child
    where child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and child.status = 'APPROVED'
      and child.applied_month <= (p_month || '-01')::date
      and coalesce(child.approved_at, child.created_at) <= p_as_of
      and (child.cancelled_at is null or child.cancelled_at > p_as_of)
    group by child.parent_debt_id
  ), totals as (
    select coalesce(sum(greatest(source.target_amount - coalesce(deducted.amount, 0), 0)), 0) as remaining
    from source_targets source
    left join deducted_through_slip deducted on deducted.parent_debt_id = source.id
  )
  select jsonb_build_object(
    'beforeDeductions', trunc(totals.remaining + greatest(coalesce(p_deducted_this_slip, 0), 0), 2),
    'deductedThisSlip', trunc(greatest(coalesce(p_deducted_this_slip, 0), 0), 2),
    'remainingAfterDeductions', trunc(totals.remaining, 2)
  )
  from totals
$$;

revoke all on function private.time_payroll_slip_outstanding_snapshot(uuid, text, timestamptz, numeric)
  from public, anon, authenticated;

create or replace function private.prepare_payroll_slip_outstanding_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.slip_data := coalesce(new.slip_data, '{}'::jsonb) || jsonb_build_object(
    'outstandingAdjustments',
    private.time_payroll_slip_outstanding_snapshot(
      new.profile_id,
      new.month,
      new.created_at,
      new.total_deductions
    )
  );
  return new;
end
$$;

revoke all on function private.prepare_payroll_slip_outstanding_snapshot()
  from public, anon, authenticated;

drop trigger if exists prepare_payroll_slip_outstanding_snapshot on public.payroll_slips;
create trigger prepare_payroll_slip_outstanding_snapshot
  before insert on public.payroll_slips
  for each row execute function private.prepare_payroll_slip_outstanding_snapshot();

-- Historical slips can already belong to an active locked report. This backfill
-- only adds immutable display metadata, so suspend the report guard for this
-- transaction-scoped update and restore it immediately afterwards. The deferred
-- dashboard trigger is also unnecessary for a metadata-only change and would
-- leave pending trigger events that prevent re-enabling the report guard.
alter table public.payroll_slips disable trigger report_lock_payroll_slips;
alter table public.payroll_slips disable trigger dashboard_money_event_payroll;

update public.payroll_slips slip
set slip_data = coalesce(slip.slip_data, '{}'::jsonb) || jsonb_build_object(
  'outstandingAdjustments',
  private.time_payroll_slip_outstanding_snapshot(
    slip.profile_id,
    slip.month,
    slip.created_at,
    slip.total_deductions
  )
)
where slip.status in ('PENDING', 'APPROVED')
  and slip.cancelled_at is null;

alter table public.payroll_slips enable trigger dashboard_money_event_payroll;
alter table public.payroll_slips enable trigger report_lock_payroll_slips;

create or replace function private.is_time_payroll_month_closed(
  p_profile_id uuid,
  p_month text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.payroll_slips slip
    where slip.profile_id = p_profile_id
      and slip.month = p_month
      and slip.status in ('PENDING', 'APPROVED')
      and slip.cancelled_at is null
  )
$$;

revoke all on function private.is_time_payroll_month_closed(uuid, text)
  from public, anon, authenticated;

create or replace function private.time_payroll_missing_slip_months(
  p_now timestamptz default now()
)
returns table(profile_id uuid, missing_months text[])
language sql
stable
security definer
set search_path = ''
as $$
  with clock as (
    select
      (p_now at time zone 'Asia/Bangkok')::date as today,
      (p_now at time zone 'Asia/Bangkok')::time as local_time
  ), payroll_clock as (
    select
      clock.today,
      clock.local_time,
      coalesce((
        select case
          when settings.pending_effective_date <= clock.today
            then settings.pending_workday_end_time
          else settings.workday_end_time
        end
        from public.time_payroll_settings settings
        where settings.singleton = true
      ), time '16:00') as cutoff
    from clock
  ), regular_limit as (
    select
      payroll_clock.*,
      case
        when payroll_clock.today = (date_trunc('month', payroll_clock.today) + interval '1 month - 1 day')::date
          and payroll_clock.local_time >= payroll_clock.cutoff
        then date_trunc('month', payroll_clock.today)::date
        else (date_trunc('month', payroll_clock.today) - interval '1 month')::date
      end as ready_through
    from payroll_clock
  ), employee_bounds as (
    select
      profile.id as profile_id,
      min(date_trunc('month', period.start_on)::date) as first_month,
      boundary.last_end_action_on,
      regular_limit.today,
      regular_limit.ready_through
    from public.profiles profile
    join public.time_payroll_active_periods period on period.profile_id = profile.id
    cross join regular_limit
    left join private.time_payroll_employment_boundaries boundary on boundary.profile_id = profile.id
    where profile.is_active = true
      and profile.role in ('user', 'admin')
      and coalesce(profile.can_access_super_admin_features, false) = false
    group by profile.id, boundary.last_end_action_on,
      regular_limit.today, regular_limit.ready_through
  ), ready_bounds as (
    select
      bounds.profile_id,
      bounds.first_month,
      greatest(
        bounds.ready_through,
        case
          when bounds.last_end_action_on is not null
            and bounds.last_end_action_on <= bounds.today
            and not exists (
              select 1
              from public.time_payroll_active_periods later
              where later.profile_id = bounds.profile_id
                and (
                  later.start_on > bounds.last_end_action_on
                  or (later.end_on is null and later.start_on <= bounds.today)
                )
            )
          then date_trunc('month', bounds.last_end_action_on)::date
          else bounds.ready_through
        end
      ) as ready_through
    from employee_bounds bounds
  ), candidate_months as (
    select
      bounds.profile_id,
      month_start::date as month_start,
      to_char(month_start, 'YYYY-MM') as month
    from ready_bounds bounds
    cross join lateral generate_series(
      bounds.first_month::timestamp,
      bounds.ready_through::timestamp,
      interval '1 month'
    ) month_start
  ), missing as (
    select candidate.profile_id, candidate.month, candidate.month_start
    from candidate_months candidate
    where exists (
      select 1
      from public.time_payroll_active_periods period
      cross join lateral generate_series(
        greatest(period.start_on, candidate.month_start)::timestamp,
        least(
          coalesce(period.end_on, (candidate.month_start + interval '1 month - 1 day')::date),
          (candidate.month_start + interval '1 month - 1 day')::date
        )::timestamp,
        interval '1 day'
      ) work_day
      left join public.time_payroll_attendance_exceptions exception
        on exception.profile_id = candidate.profile_id
        and exception.work_date = work_day::date
      where period.profile_id = candidate.profile_id
        and period.start_on < (candidate.month_start + interval '1 month')::date
        and coalesce(period.end_on, candidate.month_start) >= candidate.month_start
        and coalesce(exception.status::text, 'FULL_DAY') <> 'OFF'
    )
      and not exists (
        select 1
        from public.payroll_slips slip
        where slip.profile_id = candidate.profile_id
          and slip.month = candidate.month
          and slip.status in ('PENDING', 'APPROVED')
          and slip.cancelled_at is null
      )
      and not exists (
        select 1
        from public.financial_transactions pending
        where pending.profile_id = candidate.profile_id
          and pending.type in ('DEBT', 'WITHDRAWAL', 'ADJUSTMENT')
          and pending.status = 'PENDING'
          and pending.cancelled_at is null
          and pending.effective_date < (candidate.month_start + interval '1 month')::date
      )
      and not exists (
        select 1
        from public.time_payroll_active_periods scheduled
        where scheduled.profile_id = candidate.profile_id
          and scheduled.scheduled_action is not null
          and scheduled.scheduled_activation_on > (p_now at time zone 'Asia/Bangkok')::date
          and (
            date_trunc('month', scheduled.scheduled_effective_on)::date = candidate.month_start
            or date_trunc('month', scheduled.scheduled_activation_on)::date = candidate.month_start
          )
      )
  )
  select missing.profile_id, array_agg(missing.month order by missing.month_start)
  from missing
  group by missing.profile_id
$$;

revoke all on function private.time_payroll_missing_slip_months(timestamptz)
  from public, anon, authenticated;

create or replace function private.time_payroll_missing_slip_badge_counts(
  p_now timestamptz default now()
)
returns table(location_id uuid, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select primary_location.location_id, sum(cardinality(missing.missing_months))::bigint
  from private.time_payroll_missing_slip_months(p_now) missing
  join public.user_locations primary_location
    on primary_location.user_id = missing.profile_id
    and primary_location.is_primary = true
  join public.locations location
    on location.id = primary_location.location_id
    and location.is_active = true
  where cardinality(missing.missing_months) > 0
    and public.can_access_location(primary_location.location_id)
    and private.can_manage_time_payroll_profile(missing.profile_id)
  group by primary_location.location_id
$$;

revoke all on function private.time_payroll_missing_slip_badge_counts(timestamptz)
  from public, anon, authenticated;

create or replace function public.get_time_payroll_manager_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with debt_totals as (
    select transaction.profile_id, sum(transaction.remaining_amount) as amount
    from public.financial_transactions transaction
    where transaction.type in ('DEBT', 'WITHDRAWAL')
      and transaction.status = 'APPROVED'
      and transaction.cancelled_at is null
      and transaction.remaining_amount > 0
    group by transaction.profile_id
  ), missing as (
    select * from private.time_payroll_missing_slip_months(now())
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'profileId', profile.id,
    'debtAmount', coalesce(debt.amount, 0),
    'missingPayrollMonths', to_jsonb(coalesce(missing.missing_months, '{}'::text[]))
  ) order by profile.id), '[]'::jsonb)
  from public.profiles profile
  left join debt_totals debt on debt.profile_id = profile.id
  left join missing on missing.profile_id = profile.id
  where private.can_manage_time_payroll_profile(profile.id)
$$;

revoke all on function public.get_time_payroll_manager_overview() from public, anon;
grant execute on function public.get_time_payroll_manager_overview() to authenticated;

create or replace function public.get_time_payroll_debt_totals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('profileId', totals.profile_id, 'amount', totals.amount)
      order by totals.profile_id
    ),
    '[]'::jsonb
  )
  from (
    select transaction.profile_id, sum(transaction.remaining_amount) as amount
    from public.financial_transactions transaction
    where transaction.type in ('DEBT', 'WITHDRAWAL')
      and transaction.status = 'APPROVED'
      and transaction.cancelled_at is null
      and transaction.remaining_amount > 0
      and private.can_manage_time_payroll_profile(transaction.profile_id)
    group by transaction.profile_id
  ) totals
$$;

revoke all on function public.get_time_payroll_debt_totals() from public, anon;
grant execute on function public.get_time_payroll_debt_totals() to authenticated;

create or replace function public.get_time_payroll_user_totals(
  p_profile_id uuid,
  p_month text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_debt numeric;
  v_deductions numeric;
begin
  if p_profile_id is null
     or not private.is_active_user()
     or not (
       p_profile_id = auth.uid()
       or private.can_manage_time_payroll_profile(p_profile_id)
     ) then
    raise exception 'FORBIDDEN: access denied';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'INVALID_MONTH';
  end if;
  v_month := (p_month || '-01')::date;

  select coalesce(sum(source.remaining_amount), 0)
  into v_debt
  from public.financial_transactions source
  where source.profile_id = p_profile_id
    and source.type in ('DEBT', 'WITHDRAWAL')
    and source.status = 'APPROVED'
    and source.cancelled_at is null
    and source.remaining_amount > 0;

  select coalesce(sum(child.amount), 0)
  into v_deductions
  from public.financial_transactions child
  left join public.financial_transactions parent on parent.id = child.parent_debt_id
  where child.profile_id = p_profile_id
    and child.type in ('WITHDRAWAL_DEDUCTION', 'DEBT_DEDUCTION')
    and child.status = 'APPROVED'
    and child.cancelled_at is null
    and child.applied_month = v_month
    and (
      parent.id is null
      or (parent.status = 'APPROVED' and parent.cancelled_at is null)
    );

  return jsonb_build_object(
    'totalDebt', v_debt,
    'usedThisMonth', v_deductions
  );
end
$$;

revoke all on function public.get_time_payroll_user_totals(uuid, text) from public, anon;
grant execute on function public.get_time_payroll_user_totals(uuid, text) to authenticated;

create or replace function public.preview_time_tracking_payroll_slip(
  p_profile_id uuid,
  p_month text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_gross numeric;
  v_used numeric;
  v_remaining numeric;
  v_wage numeric;
begin
  if not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_MONTH'; end if;
  v_month := (p_month || '-01')::date;
  if v_month > date_trunc('month', now() at time zone 'Asia/Bangkok')::date then raise exception 'INVALID_MONTH'; end if;
  if private.is_time_payroll_month_closed(p_profile_id, p_month)
  then raise exception 'MONTH_CLOSED:%', p_month; end if;
  select daily_wage into v_wage from public.profiles where id = p_profile_id;
  v_gross := trunc(public.calculate_paid_work_days(
    p_profile_id,
    v_month::timestamp at time zone 'Asia/Bangkok',
    (v_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
  ) * v_wage, 2);
  select coalesce(sum(child.amount), 0) into v_used
  from public.financial_transactions child
  left join public.financial_transactions parent on parent.id = child.parent_debt_id
  where child.profile_id = p_profile_id
    and child.status = 'APPROVED'
    and child.cancelled_at is null
    and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
    and child.applied_month = v_month
    and (
      parent.id is null
      or (parent.status = 'APPROVED' and parent.cancelled_at is null)
    );
  select coalesce(sum(source.remaining_amount), 0) into v_remaining
  from public.financial_transactions source
  where source.profile_id = p_profile_id
    and source.status = 'APPROVED'
    and source.cancelled_at is null
    and source.type in ('DEBT', 'WITHDRAWAL')
    and source.effective_date < (v_month + interval '1 month')::date;
  return jsonb_build_object('netPay', round(greatest(v_gross - v_used - v_remaining, 0), 0));
end
$$;

revoke all on function public.preview_time_tracking_payroll_slip(uuid, text) from public, anon;
grant execute on function public.preview_time_tracking_payroll_slip(uuid, text) to authenticated;

alter function public.get_actionable_badge_counts()
  rename to get_actionable_badge_counts_before_missing_payroll_slips;

do $migration$
declare
  v_definition text;
  v_transaction_old text := $old$where ft.status = 'PENDING' and ft.type in ('DEBT', 'WITHDRAWAL')$old$;
  v_transaction_new text := $new$where ft.status = 'PENDING'
      and ft.cancelled_at is null
      and ft.type in ('DEBT', 'WITHDRAWAL')$new$;
  v_slip_old text := $old$where ps.status = 'PENDING'$old$;
  v_slip_new text := $new$where ps.status = 'PENDING'
      and ps.cancelled_at is null$new$;
  v_adjustment_old text := $old$and adjustment.status = 'PENDING'$old$;
  v_adjustment_new text := $new$and adjustment.status = 'PENDING'
      and adjustment.cancelled_at is null$new$;
begin
  select pg_get_functiondef(
    'public.get_actionable_badge_counts_before_withdrawal_adjustments()'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_transaction_old) = 0 or strpos(v_definition, v_slip_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: base actionable guards changed';
  end if;
  execute replace(replace(v_definition, v_transaction_old, v_transaction_new), v_slip_old, v_slip_new);

  select pg_get_functiondef(
    'public.get_actionable_badge_counts_before_missing_payroll_slips()'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_adjustment_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: adjustment actionable guard changed';
  end if;
  execute replace(v_definition, v_adjustment_old, v_adjustment_new);
end
$migration$;

create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with combined as (
    select * from public.get_actionable_badge_counts_before_missing_payroll_slips()
    union all
    select missing.location_id, 'time-tracking'::text, missing.item_count
    from private.time_payroll_missing_slip_badge_counts(now()) missing
  )
  select combined.location_id, combined.module_id, sum(combined.item_count)::bigint
  from combined
  group by combined.location_id, combined.module_id
  order by combined.location_id, combined.module_id
$$;

revoke all on function public.get_actionable_badge_counts_before_missing_payroll_slips()
  from public, anon, authenticated;
revoke all on function public.get_actionable_badge_counts() from public, anon;
grant execute on function public.get_actionable_badge_counts() to authenticated;

-- Keep legacy cancelled sources out of future deduction planning without
-- copying the large planner into this migration.
do $migration$
declare
  v_definition text;
  v_child_old text := $old$and child.status = 'APPROVED'$old$;
  v_child_new text := $new$and child.status = 'APPROVED'
      and child.cancelled_at is null$new$;
  v_parent_old text := $old$and parent.status = 'APPROVED'$old$;
  v_parent_new text := $new$and parent.status = 'APPROVED'
      and parent.cancelled_at is null$new$;
  v_slip_old text := $old$and ps.status in ('PENDING', 'APPROVED')
      limit 1$old$;
  v_slip_new text := $new$and ps.status in ('PENDING', 'APPROVED')
        and ps.cancelled_at is null
      limit 1$new$;
begin
  select pg_get_functiondef(
    'private.plan_time_tracking_deductions(uuid,numeric,date,boolean)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_child_old) = 0
    or strpos(v_definition, v_parent_old) = 0
    or strpos(v_definition, v_slip_old) = 0
  then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: deduction planner guards changed';
  end if;
  execute replace(
    replace(
      replace(v_definition, v_child_old, v_child_new),
      v_parent_old,
      v_parent_new
    ),
    v_slip_old,
    v_slip_new
  );
end
$migration$;

-- A rejected or cancelled row does not close its month. Patch the two existing
-- creation guards in place so the missing-month projection and the mutation
-- continue to share the same definition of a closed month.
do $migration$
declare
  v_definition text;
  v_target_old text := $old$where ps.profile_id = p_profile_id and ps.month = p_month$old$;
  v_target_new text := $new$where ps.profile_id = p_profile_id
      and ps.month = p_month
      and ps.status in ('PENDING', 'APPROVED')
      and ps.cancelled_at is null$new$;
  v_prior_old text := $old$and ps.month = to_char(v_scan_month, 'YYYY-MM')$old$;
  v_prior_new text := $new$and ps.month = to_char(v_scan_month, 'YYYY-MM')
          and ps.status in ('PENDING', 'APPROVED')
          and ps.cancelled_at is null$new$;
  v_financial_old text := $old$where ft.profile_id = p_profile_id$old$;
  v_financial_new text := $new$where ft.profile_id = p_profile_id
    and ft.cancelled_at is null$new$;
  v_deduction_old text := $old$and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
    and ft.applied_month = v_month;$old$;
  v_deduction_new text := $new$and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
    and ft.applied_month = v_month
    and (
      ft.parent_debt_id is null
      or exists (
        select 1
        from public.financial_transactions parent
        where parent.id = ft.parent_debt_id
          and parent.status = 'APPROVED'
          and parent.cancelled_at is null
      )
    );$new$;
  v_snapshot_old text := $old$and (
      (
        ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and ft.applied_month = v_month
      )$old$;
  v_snapshot_new text := $new$and (
      (
        ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and ft.applied_month = v_month
        and (
          ft.parent_debt_id is null
          or exists (
            select 1
            from public.financial_transactions parent
            where parent.id = ft.parent_debt_id
              and parent.status = 'APPROVED'
              and parent.cancelled_at is null
          )
        )
      )$new$;
begin
  select pg_get_functiondef(
    'public.create_time_tracking_payroll_slip_internal_20260901(uuid,text,boolean)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_target_old) = 0
    or strpos(v_definition, v_prior_old) = 0
    or strpos(v_definition, v_financial_old) = 0
    or strpos(v_definition, v_deduction_old) = 0
    or strpos(v_definition, v_snapshot_old) = 0
  then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: internal creation guards changed (target %, prior %, financial %, deduction %, snapshot %)',
      strpos(v_definition, v_target_old),
      strpos(v_definition, v_prior_old),
      strpos(v_definition, v_financial_old),
      strpos(v_definition, v_deduction_old),
      strpos(v_definition, v_snapshot_old);
  end if;
  execute replace(
    replace(
      replace(
        replace(
          replace(v_definition, v_target_old, v_target_new),
          v_prior_old,
          v_prior_new
        ),
        v_financial_old,
        v_financial_new
      ),
      v_deduction_old,
      v_deduction_new
    ),
    v_snapshot_old,
    v_snapshot_new
  );
end
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := $old$where ps.profile_id = p_profile_id and ps.month = to_char(v_scan_month, 'YYYY-MM')$old$;
  v_new text := $new$where ps.profile_id = p_profile_id
          and ps.month = to_char(v_scan_month, 'YYYY-MM')
          and ps.status in ('PENDING', 'APPROVED')
          and ps.cancelled_at is null$new$;
begin
  select pg_get_functiondef(
    'public.create_time_tracking_payroll_slip(uuid,text,boolean,uuid,text,numeric)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: public creation guard changed';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

-- Cancelled adjustments are audit history, not pending work. Keep every live
-- read/mutation path aligned so a cancelled PENDING row cannot reappear, block
-- a replacement request, or be decided/withdrawn after cancellation.
drop index if exists public.financial_transactions_one_pending_adjustment_per_withdrawal;
create unique index financial_transactions_one_pending_adjustment_per_withdrawal
  on public.financial_transactions (parent_debt_id)
  where type = 'ADJUSTMENT' and status = 'PENDING' and cancelled_at is null;

create or replace function private.latest_withdrawal_target(p_withdrawal_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select adjustment.amount
      from public.financial_transactions adjustment
      where adjustment.type = 'ADJUSTMENT'
        and adjustment.parent_debt_id = source.id
        and adjustment.status = 'APPROVED'
        and adjustment.cancelled_at is null
      order by adjustment.approved_at desc nulls last, adjustment.created_at desc, adjustment.id desc
      limit 1
    ),
    source.amount
  )
  from public.financial_transactions source
  where source.id = p_withdrawal_id
    and source.type = 'WITHDRAWAL'
    and source.cancelled_at is null;
$$;

create or replace function private.withdrawal_closed_floor(p_withdrawal_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(child.amount), 0)
  from public.financial_transactions source
  join public.financial_transactions child on child.parent_debt_id = source.id
  where source.id = p_withdrawal_id
    and source.type = 'WITHDRAWAL'
    and source.cancelled_at is null
    and child.type = 'WITHDRAWAL_DEDUCTION'
    and child.status = 'APPROVED'
    and child.cancelled_at is null
    and exists (
      select 1
      from public.payroll_slips slip
      where slip.profile_id = source.profile_id
        and slip.month = to_char(child.applied_month, 'YYYY-MM')
        and slip.status in ('PENDING', 'APPROVED')
        and slip.cancelled_at is null
    );
$$;

create or replace function public.get_withdrawal_adjustment_summaries(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if auth.uid() <> p_profile_id and not private.can_manage_time_payroll_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'withdrawalId', source.id,
      'latestTarget', private.latest_withdrawal_target(source.id),
      'closedSlipFloor', private.withdrawal_closed_floor(source.id),
      'pendingAdjustmentId', pending.id
    ) order by source.effective_date desc, source.created_at desc, source.id desc)
    from public.financial_transactions source
    left join lateral (
      select adjustment.id
      from public.financial_transactions adjustment
      where adjustment.type = 'ADJUSTMENT'
        and adjustment.parent_debt_id = source.id
        and adjustment.status = 'PENDING'
        and adjustment.cancelled_at is null
      order by adjustment.created_at desc, adjustment.id desc
      limit 1
    ) pending on true
    where source.profile_id = p_profile_id
      and source.type = 'WITHDRAWAL'
      and source.status = 'APPROVED'
      and source.cancelled_at is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_withdrawal_adjustment_summaries(uuid) from public, anon;
grant execute on function public.get_withdrawal_adjustment_summaries(uuid) to authenticated;
revoke all on function private.latest_withdrawal_target(uuid)
  from public, anon, authenticated;
revoke all on function private.withdrawal_closed_floor(uuid)
  from public, anon, authenticated;
revoke all on function private.rebuild_open_deductions_for_adjustment(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.prepare_payroll_slip_adjustment_snapshot()
  from public, anon, authenticated;
revoke all on function private.prevent_approved_adjustment_delete()
  from public, anon, authenticated;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.request_time_tracking_withdrawal_adjustment(uuid,numeric,uuid,text)'::regprocedure
  ) into v_definition;
  v_old := $old$where type = 'ADJUSTMENT' and parent_debt_id = v_source.id and status = 'PENDING'$old$;
  v_new := $new$where type = 'ADJUSTMENT'
      and parent_debt_id = v_source.id
      and status = 'PENDING'
      and cancelled_at is null$new$;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: adjustment request guard changed';
  end if;
  execute replace(v_definition, v_old, v_new);

  select pg_get_functiondef(
    'public.decide_time_tracking_withdrawal_adjustment(uuid,text,uuid,text)'::regprocedure
  ) into v_definition;
  v_old := $old$if v_adjustment.status <> 'PENDING' then$old$;
  v_new := $new$if v_adjustment.cancelled_at is not null then
    raise exception 'ADJUSTMENT_ALREADY_DECIDED';
  end if;
  if v_adjustment.status <> 'PENDING' then$new$;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: adjustment decision guard changed';
  end if;
  execute replace(v_definition, v_old, v_new);

  select pg_get_functiondef(
    'public.withdraw_time_tracking_withdrawal_adjustment(uuid)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: adjustment withdrawal guard changed';
  end if;
  execute replace(v_definition, v_old, v_new);

  select pg_get_functiondef(
    'private.prepare_payroll_slip_adjustment_snapshot()'::regprocedure
  ) into v_definition;
  v_old := $old$and adjustment.status = 'PENDING'$old$;
  v_new := $new$and adjustment.status = 'PENDING'
    and adjustment.cancelled_at is null$new$;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: payroll adjustment blocker changed';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

-- Recalculation paths must preserve cancelled debt/deduction rows as audit
-- history. The planner already ignores them; align each mutation query so a
-- rebuild cannot restore, delete, or lock those inactive rows.
do $migration$
declare
  v_definition text;
  v_child_old text := $old$and child.status = 'APPROVED'$old$;
  v_child_new text := $new$and child.status = 'APPROVED'
      and child.cancelled_at is null$new$;
  v_parent_old text := $old$and parent.status = 'APPROVED'$old$;
  v_parent_new text := $new$and parent.status = 'APPROVED'
      and parent.cancelled_at is null$new$;
  v_source_old text := $old$and source.status = 'APPROVED';$old$;
  v_source_new text := $new$and source.status = 'APPROVED'
      and source.cancelled_at is null;$new$;
  v_adjustment_old text := $old$and adjustment.type = 'ADJUSTMENT'
      and adjustment.parent_debt_id = source.id$old$;
  v_adjustment_new text := $new$and adjustment.type = 'ADJUSTMENT'
      and adjustment.cancelled_at is null
      and adjustment.parent_debt_id = source.id$new$;
  v_wage_old text := $old$and child.status = 'APPROVED'
      and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')$old$;
  v_wage_new text := $new$and child.status = 'APPROVED'
      and child.cancelled_at is null
      and (
        child.parent_debt_id is null
        or exists (
          select 1
          from public.financial_transactions parent
          where parent.id = child.parent_debt_id
            and parent.status = 'APPROVED'
            and parent.cancelled_at is null
            and parent.type in ('DEBT', 'WITHDRAWAL')
        )
      )
      and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')$new$;
begin
  select pg_get_functiondef(
    'private.rebuild_open_deductions_for_adjustment(uuid,uuid,uuid)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_child_old) = 0
    or strpos(v_definition, v_parent_old) = 0
    or strpos(v_definition, v_source_old) = 0
    or strpos(v_definition, v_adjustment_old) = 0
  then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: adjustment rebuild guards changed';
  end if;
  execute replace(
    replace(
      replace(
        replace(v_definition, v_child_old, v_child_new),
        v_parent_old,
        v_parent_new
      ),
      v_source_old,
      v_source_new
    ),
    v_adjustment_old,
    v_adjustment_new
  );

  select pg_get_functiondef(
    'private.rebuild_open_deductions_after_attendance(uuid,uuid)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_child_old) = 0 or strpos(v_definition, v_parent_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: attendance rebuild guards changed';
  end if;
  execute replace(
    replace(v_definition, v_child_old, v_child_new),
    v_parent_old,
    v_parent_new
  );

  select pg_get_functiondef(
    'public.commit_time_tracking_wage_recalculation(uuid,numeric,text)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_child_old) = 0 or strpos(v_definition, v_parent_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: wage recalculation guards changed';
  end if;
  execute replace(
    replace(v_definition, v_child_old, v_child_new),
    v_parent_old,
    v_parent_new
  );

  select pg_get_functiondef(
    'public.update_time_tracking_wage(uuid,numeric)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_wage_old) = 0 then
    raise exception 'PAYROLL_MISSING_MONTH_MIGRATION_BLOCKED: direct wage guard changed';
  end if;
  execute replace(v_definition, v_wage_old, v_wage_new);
end
$migration$;

notify pgrst, 'reload schema';
