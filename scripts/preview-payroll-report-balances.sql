-- Run before rollout and save the CSV output; this script never writes.
-- Uses the same active-report order and zero initial balance as the existing rebuild.
begin transaction isolation level repeatable read read only;
with affected_branches as (
  select distinct batch.location_id
  from public.report_batches batch
  join public.report_items item on item.report_id = batch.id
  join public.money_transfers transfer on transfer.id = item.entity_id
  where batch.status = 'active'
    and item.entity_type = 'bank_transfer_source'
    and transfer.transfer_type = 'time_payroll'
    and transfer.transfer_status in ('paid', 'overpaid')
    and transfer.net_amount_to_pay > 0
), periods as (
  select batch.*,
    coalesce((select sum(case when row.entry_type = 'income' then row.amount else -row.amount end)
      from private.report_income_expense_period_rows(batch.id) row
      where row.sort_key not like '62-%'), 0) as corrected_period
  from public.report_batches batch
  join affected_branches affected on affected.location_id = batch.location_id
  where batch.status = 'active'
), balances as (
  select periods.*,
    coalesce(sum(corrected_period) over (
      partition by location_id order by created_at, id
      rows between unbounded preceding and 1 preceding), 0) as new_opening,
    sum(corrected_period) over (
      partition by location_id order by created_at, id
      rows between unbounded preceding and current row) as new_closing
  from periods
)
select balances.location_id, location.name as branch, balances.id as report_id, report_no,
  opening_balance as old_opening, new_opening,
  closing_balance as old_closing, new_closing,
  new_closing - closing_balance as closing_correction
from balances
join public.locations location on location.id = balances.location_id
where (opening_balance, closing_balance) is distinct from (new_opening, new_closing)
order by balances.location_id, balances.created_at, balances.id;
commit;

