-- The compatibility overview endpoint still has its own live event aggregation.
-- Preserve its rows, pagination and full operating costs, but credit back the
-- bank-funded part that its legacy expense events subtract from branch money.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_dashboard_overview(uuid,timestamptz,text,integer)'::regprocedure);
  old_total text := $old$), 0) as net_cash_flow
      from financial_events$old$;
  new_total text := $new$), 0)
      + (select coalesce(sum(ft.amount - private.time_payroll_branch_paid_amount(
          ft.amount, ft.payment_contract_version, ft.payment_channel,
          ft.payment_transfer_amount, ft.expense_location_id)), 0)
        from public.financial_transactions ft
        where ft.type = 'WITHDRAWAL' and ft.status = 'APPROVED'
          and ft.cancelled_at is null and ft.expense_location_id = p_location_id
          and ft.payment_contract_version = 1 and ft.amount > 0)
      + (select coalesce(sum(ps.net_pay - private.time_payroll_branch_paid_amount(
          ps.net_pay, ps.payment_contract_version, ps.payment_channel,
          ps.payment_transfer_amount, ps.expense_location_id)), 0)
        from public.payroll_slips ps
        where ps.status = 'APPROVED' and ps.cancelled_at is null
          and ps.expense_location_id = p_location_id
          and ps.payment_contract_version = 1 and ps.net_pay > 0) as net_cash_flow
      from financial_events$new$;
begin
  if position(old_total in definition) = 0 then
    raise exception 'PAYROLL_OVERVIEW_BALANCE_ANCHOR_MISSING';
  end if;
  execute replace(definition, old_total, new_total);
end
$migration$;
