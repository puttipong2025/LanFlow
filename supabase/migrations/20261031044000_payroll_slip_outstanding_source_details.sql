-- Display metadata only: preserve all payroll amounts and deduction rules.
-- Use the same as-of boundary as time_payroll_slip_outstanding_snapshot.
create or replace function private.time_payroll_slip_source_snapshot(
  p_profile_id uuid,
  p_month text,
  p_as_of timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sources as (
    select source.id, source.type, source.effective_date, source.description,
      source.created_at,
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
  ), deductions as (
    select child.parent_debt_id,
      sum(child.amount) as through_slip,
      sum(child.amount) filter (where child.applied_month = (p_month || '-01')::date) as this_slip
    from public.financial_transactions child
    join sources source on source.id = child.parent_debt_id
    where child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and child.status = 'APPROVED'
      and child.applied_month <= (p_month || '-01')::date
      and coalesce(child.approved_at, child.created_at) <= p_as_of
      and (child.cancelled_at is null or child.cancelled_at > p_as_of)
    group by child.parent_debt_id
  ), balances as (
    select source.*,
      trunc(greatest(source.target_amount - coalesce(deduction.through_slip, 0), 0)
        + coalesce(deduction.this_slip, 0), 2) as before_deductions
    from sources source
    left join deductions deduction on deduction.parent_debt_id = source.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'type', type,
    'status', 'APPROVED',
    'effective_date', effective_date,
    'description', description,
    'amount', before_deductions,
    'carried_forward', effective_date < (p_month || '-01')::date
  ) order by effective_date, created_at, id), '[]'::jsonb)
  from balances
  where before_deductions > 0
$$;

revoke all on function private.time_payroll_slip_source_snapshot(uuid, text, timestamptz)
  from public, anon, authenticated;

create or replace function private.prepare_payroll_slip_source_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.slip_data := coalesce(new.slip_data, '{}'::jsonb) || jsonb_build_object(
    'outstandingSources',
    private.time_payroll_slip_source_snapshot(new.profile_id, new.month, new.created_at)
  );
  return new;
end
$$;

revoke all on function private.prepare_payroll_slip_source_snapshot()
  from public, anon, authenticated;

create or replace trigger prepare_payroll_slip_source_snapshot
  before insert on public.payroll_slips
  for each row execute function private.prepare_payroll_slip_source_snapshot();

-- Backfill display metadata only. Prefer the source description/date already
-- saved in a historical slip when present; never replace its monetary snapshot.
-- Match the existing outstanding-metadata migration's Report Lock exception.
alter table public.payroll_slips disable trigger report_lock_payroll_slips;
alter table public.payroll_slips disable trigger dashboard_money_event_payroll;

update public.payroll_slips slip
set slip_data = coalesce(slip.slip_data, '{}'::jsonb) || jsonb_build_object(
  'outstandingSources', (
    select coalesce(jsonb_agg(item.value || coalesce((
      select jsonb_build_object(
        'description', original.value -> 'description',
        'effective_date', coalesce(original.value -> 'effective_date', item.value -> 'effective_date')
      )
      from jsonb_array_elements(coalesce(slip.slip_data -> 'transactions', '[]'::jsonb)) original(value)
      where original.value ->> 'id' = item.value ->> 'id'
      limit 1
    ), '{}'::jsonb) order by item.ordinality), '[]'::jsonb)
    from jsonb_array_elements(private.time_payroll_slip_source_snapshot(
      slip.profile_id, slip.month, slip.created_at
    )) with ordinality item(value, ordinality)
  )
)
where slip.status in ('PENDING', 'APPROVED')
  and slip.cancelled_at is null
  and not (coalesce(slip.slip_data, '{}'::jsonb) ? 'outstandingSources')
  -- Missing historical sources must not replace saved legacy details with an
  -- incomplete list. Keep the existing renderer fallback for those slips.
  and (select coalesce(sum((item ->> 'amount')::numeric), 0)
    from jsonb_array_elements(private.time_payroll_slip_source_snapshot(
      slip.profile_id, slip.month, slip.created_at
    )) item
  ) = (slip.slip_data -> 'outstandingAdjustments' ->> 'beforeDeductions')::numeric;

alter table public.payroll_slips enable trigger dashboard_money_event_payroll;
alter table public.payroll_slips enable trigger report_lock_payroll_slips;
