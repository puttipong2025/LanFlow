-- Bank-funded payroll remains an operating cost, but only the branch-funded
-- portion changes branch money. Keep the existing legacy/outside-system rules.
do $migration$
declare
  definition text := pg_get_functiondef('private.calculate_dashboard_summary(uuid)'::regprocedure);
  old_withdrawal text := $old$select 'expense', ft.amount, true, true,
      (ft.approved_at at time zone 'Asia/Bangkok')::date
    from public.financial_transactions ft$old$;
  new_withdrawal text := $new$select 'expense', portion.amount, portion.affects_balance, portion.operating_expense,
      (ft.approved_at at time zone 'Asia/Bangkok')::date
    from public.financial_transactions ft
    cross join lateral (values
      (private.time_payroll_branch_paid_amount(ft.amount, ft.payment_contract_version,
        ft.payment_channel, ft.payment_transfer_amount, ft.expense_location_id), true, false),
      (ft.amount, false, true)
    ) portion(amount, affects_balance, operating_expense)$new$;
  old_payroll text := $old$select 'expense', ps.net_pay, true, true,
      (ps.approved_at at time zone 'Asia/Bangkok')::date
    from public.payroll_slips ps$old$;
  new_payroll text := $new$select 'expense', portion.amount, portion.affects_balance, portion.operating_expense,
      (ps.approved_at at time zone 'Asia/Bangkok')::date
    from public.payroll_slips ps
    cross join lateral (values
      (private.time_payroll_branch_paid_amount(ps.net_pay, ps.payment_contract_version,
        ps.payment_channel, ps.payment_transfer_amount, ps.expense_location_id), true, false),
      (ps.net_pay, false, true)
    ) portion(amount, affects_balance, operating_expense)$new$;
begin
  if position(old_withdrawal in definition) = 0 or position(old_payroll in definition) = 0 then
    raise exception 'PAYROLL_BRANCH_BALANCE_SUMMARY_ANCHOR_MISSING';
  end if;
  execute replace(replace(definition, old_withdrawal, new_withdrawal), old_payroll, new_payroll);
end
$migration$;

-- Rebuild affected cached summaries through the existing freshness worker.
-- No source records, reports, history events, or completed counts are rewritten.
do $$
declare branch_id uuid;
begin
  for branch_id in
    select expense_location_id from public.financial_transactions
    where type = 'WITHDRAWAL' and status = 'APPROVED' and cancelled_at is null
      and payment_contract_version = 1 and expense_location_id is not null
    union
    select expense_location_id from public.payroll_slips
    where status = 'APPROVED' and cancelled_at is null
      and payment_contract_version = 1 and expense_location_id is not null
  loop
    perform private.mark_dashboard_dirty(branch_id);
  end loop;
end $$;
