-- Keep payroll totals complete when transaction history exceeds PostgREST's
-- configured row cap.

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

  select coalesce(sum(transaction.remaining_amount), 0)
  into v_debt
  from public.financial_transactions transaction
  where transaction.profile_id = p_profile_id
    and transaction.type in ('DEBT', 'WITHDRAWAL')
    and transaction.status = 'APPROVED'
    and transaction.remaining_amount > 0;

  select coalesce(sum(transaction.amount), 0)
  into v_deductions
  from public.financial_transactions transaction
  where transaction.profile_id = p_profile_id
    and transaction.type in ('WITHDRAWAL_DEDUCTION', 'DEBT_DEDUCTION')
    and transaction.status = 'APPROVED'
    and transaction.applied_month = v_month;

  return jsonb_build_object(
    'totalDebt', v_debt,
    'usedThisMonth', v_deductions
  );
end
$$;

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
      and transaction.remaining_amount > 0
      and private.can_manage_time_payroll_profile(transaction.profile_id)
    group by transaction.profile_id
  ) totals
$$;

revoke all on function public.get_time_payroll_user_totals(uuid, text) from public, anon;
revoke all on function public.get_time_payroll_debt_totals() from public, anon;
grant execute on function public.get_time_payroll_user_totals(uuid, text) to authenticated;
grant execute on function public.get_time_payroll_debt_totals() to authenticated;

notify pgrst, 'reload schema';
