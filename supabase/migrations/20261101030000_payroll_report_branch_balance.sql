-- Bank-funded payroll/withdrawals remain in the bank section and report locks.
-- Only the branch-funded portion belongs in the branch income/expense ledger.
create or replace function private.report_income_expense_period_rows(p_report_id uuid)
returns table(tx_date date, number text, entry_type text, title text, amount numeric, sort_key text)
language sql
stable
security definer
set search_path = 'public', 'private'
as $$
  select base.*
  from private.report_income_expense_period_rows_before_time_payroll_payment(p_report_id) base
  where base.sort_key not like '60-%' and base.sort_key not like '61-%'

  union all

  select (source.approved_at at time zone 'Asia/Bangkok')::date,
    'TW-' || left(source.id::text, 8), 'expense',
    case when coalesce(source.payment_transfer_amount, 0) > 0 then 'สาขาจ่ายส่วนต่างเงินเบิกให้ ' else 'สาขาจ่ายเงินเบิกให้ ' end
      || coalesce(profile.name, 'พนักงาน'),
    private.time_payroll_branch_paid_amount(
      source.amount, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ),
    '60-' || source.id::text
  from public.report_items item
  join public.financial_transactions source on source.id = item.entity_id
  join public.profiles profile on profile.id = source.profile_id
  where item.report_id = p_report_id and item.entity_type = 'financial_transaction'
    and source.type = 'WITHDRAWAL'
    and private.time_payroll_branch_paid_amount(
      source.amount, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ) > 0

  union all

  select (source.approved_at at time zone 'Asia/Bangkok')::date,
    'PS-' || left(source.id::text, 8), 'expense',
    case when coalesce(source.payment_transfer_amount, 0) > 0 then 'สาขาจ่ายส่วนต่างเงินเดือนให้ ' else 'สาขาจ่ายเงินเดือนให้ ' end
      || coalesce(profile.name, 'พนักงาน') || ' — ' || source.month,
    private.time_payroll_branch_paid_amount(
      source.net_pay, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ),
    '61-' || source.id::text
  from public.report_items item
  join public.payroll_slips source on source.id = item.entity_id
  join public.profiles profile on profile.id = source.profile_id
  where item.report_id = p_report_id and item.entity_type = 'payroll_slip'
    and private.time_payroll_branch_paid_amount(
      source.net_pay, source.payment_contract_version, source.payment_channel,
      source.payment_transfer_amount, source.expense_location_id
    ) > 0;
$$;

revoke all on function private.report_income_expense_period_rows(uuid)
from public, anon, authenticated;

-- Preserve the migration output as the before/after repair evidence.
-- Briefly serialize report reads/writes during repair. Do not acquire advisory
-- locks after this table lock: a concurrent creator may hold a branch lock
-- while waiting to insert its report. Use the existing rebuild math directly.
-- Source documents, report membership, numbers and completed cash counts stay intact.
do $repair$
declare
  v_location_id uuid;
  v_before jsonb;
  v_change record;
begin
  lock table public.report_batches, public.report_items in access exclusive mode;
  for v_location_id in
    select distinct batch.location_id
    from public.report_batches batch
    join public.report_items item on item.report_id = batch.id
    join public.money_transfers transfer on transfer.id = item.entity_id
    where batch.status = 'active'
      and item.entity_type = 'bank_transfer_source'
      and transfer.transfer_type = 'time_payroll'
      and transfer.transfer_status in ('paid', 'overpaid')
      and transfer.net_amount_to_pay > 0
    order by batch.location_id
  loop
    select jsonb_agg(jsonb_build_object(
      'id', id, 'opening_balance', opening_balance, 'closing_balance', closing_balance
    )) into v_before
    from public.report_batches
    where location_id = v_location_id and status = 'active';

    with periods as (
      select batch.id, batch.created_at,
        coalesce((select sum(case when row.entry_type = 'income' then row.amount else -row.amount end)
          from private.report_income_expense_period_rows(batch.id) row), 0) as period_balance
      from public.report_batches batch
      where batch.location_id = v_location_id and batch.status = 'active'
    ), balances as (
      select id, lag(id) over (order by created_at, id) as previous_report_id,
        coalesce(sum(period_balance) over (order by created_at, id
          rows between unbounded preceding and 1 preceding), 0) as opening_balance,
        sum(period_balance) over (order by created_at, id
          rows between unbounded preceding and current row) as closing_balance
      from periods
    )
    update public.report_batches batch
    set previous_report_id = balances.previous_report_id,
        opening_balance = balances.opening_balance,
        closing_balance = balances.closing_balance
    from balances
    where batch.id = balances.id
      and (batch.previous_report_id, batch.opening_balance, batch.closing_balance)
        is distinct from (balances.previous_report_id, balances.opening_balance, balances.closing_balance);

    for v_change in
      select batch.id, batch.report_no,
        previous.opening_balance as old_opening, batch.opening_balance as new_opening,
        previous.closing_balance as old_closing, batch.closing_balance as new_closing
      from jsonb_to_recordset(v_before)
        as previous(id uuid, opening_balance numeric, closing_balance numeric)
      join public.report_batches batch on batch.id = previous.id
      where (batch.opening_balance, batch.closing_balance)
        is distinct from (previous.opening_balance, previous.closing_balance)
      order by batch.created_at, batch.id
    loop
      raise notice 'PAYROLL_REPORT_BALANCE_REPAIR %',
        jsonb_build_object('locationId', v_location_id, 'reportId', v_change.id,
          'reportNo', v_change.report_no,
          'oldOpening', v_change.old_opening, 'newOpening', v_change.new_opening,
          'oldClosing', v_change.old_closing, 'newClosing', v_change.new_closing);
    end loop;
  end loop;
end
$repair$;

