-- A pending adjustment whose withdrawal was cancelled is audit history, not
-- actionable work. Keep missing-slip discovery and payroll creation aligned.

do $migration$
declare
  v_definition text;
  v_old text := $old$and pending.cancelled_at is null
          and pending.effective_date < (candidate.month_start + interval '1 month')::date$old$;
  v_new text := $new$and pending.cancelled_at is null
          and (
            pending.type <> 'ADJUSTMENT'
            or exists (
              select 1
              from public.financial_transactions parent
              where parent.id = pending.parent_debt_id
                and parent.type = 'WITHDRAWAL'
                and parent.status = 'APPROVED'
                and parent.cancelled_at is null
            )
          )
          and pending.effective_date < (candidate.month_start + interval '1 month')::date$new$;
begin
  select pg_get_functiondef(
    'private.time_payroll_missing_slip_months(timestamptz)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PAYROLL_CANCELLED_ADJUSTMENT_PARENT_GUARD_BLOCKED: missing-slip blocker changed';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := $old$and adjustment.cancelled_at is null
    and adjustment.effective_date < (v_month + interval '1 month')::date$old$;
  v_new text := $new$and adjustment.cancelled_at is null
    and exists (
      select 1
      from public.financial_transactions parent
      where parent.id = adjustment.parent_debt_id
        and parent.type = 'WITHDRAWAL'
        and parent.status = 'APPROVED'
        and parent.cancelled_at is null
    )
    and adjustment.effective_date < (v_month + interval '1 month')::date$new$;
begin
  select pg_get_functiondef(
    'private.prepare_payroll_slip_adjustment_snapshot()'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'PAYROLL_CANCELLED_ADJUSTMENT_PARENT_GUARD_BLOCKED: payroll blocker changed';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

create or replace function public.get_actionable_badge_counts_before_missing_payroll_slips()
returns table(location_id uuid, module_id text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with combined as (
    select *
    from public.get_actionable_badge_counts_before_withdrawal_adjustments()

    union all

    select primary_location.location_id, 'time-tracking'::text, count(*)::bigint
    from public.financial_transactions adjustment
    join public.financial_transactions parent
      on parent.id = adjustment.parent_debt_id
      and parent.type = 'WITHDRAWAL'
      and parent.status = 'APPROVED'
      and parent.cancelled_at is null
    join public.user_locations primary_location
      on primary_location.user_id = adjustment.profile_id
      and primary_location.is_primary = true
    where adjustment.type = 'ADJUSTMENT'
      and adjustment.status = 'PENDING'
      and adjustment.cancelled_at is null
      and public.can_access_location(primary_location.location_id)
      and private.can_manage_time_payroll_profile(adjustment.profile_id)
    group by primary_location.location_id
  )
  select combined.location_id, combined.module_id, sum(combined.item_count)::bigint
  from combined
  group by combined.location_id, combined.module_id
  order by combined.location_id, combined.module_id;
$$;

revoke all on function public.get_actionable_badge_counts_before_missing_payroll_slips()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
