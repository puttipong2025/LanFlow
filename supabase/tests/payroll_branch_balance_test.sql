begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations (id, name, code, is_active) values
  ('81000000-0000-4000-8000-000000000001', 'Balance Test', 'PBB1', true),
  ('81000000-0000-4000-8000-000000000002', 'Balance Test 2', 'PBB2', true);
insert into public.profiles (id, phone, name, role, is_active, can_manage_time_payroll,
  can_access_money_transfer, daily_wage) values
  ('82000000-0000-4000-8000-000000000001', '0898200001', 'Balance Manager', 'admin', true, true, true, 500),
  ('82000000-0000-4000-8000-000000000002', '0898200002', 'Balance Employee', 'user', true, false, false, 500);
insert into public.user_locations (user_id, location_id, is_primary) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', true),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', false),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', true);
set constraints all immediate;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Full source totals are still operating costs. The balance and today's cash
-- expense must independently use the branch portion, including zero.
create function pg_temp.check_balance(branch_paid numeric, operating numeric, label text,
  location_id uuid default '81000000-0000-4000-8000-000000000001')
returns setof text language plpgsql as $$
declare
  summary jsonb := private.calculate_dashboard_summary(location_id);
  overview jsonb := public.get_dashboard_overview(location_id, null, null, 10)->'summary';
begin
  return next extensions.is((summary->>'netCashFlow')::numeric, -branch_paid, label || ': net');
  return next extensions.is((summary#>>'{cashToday,expense}')::numeric, branch_paid, label || ': today expense');
  return next extensions.is((summary#>>'{cashToday,net}')::numeric, -branch_paid, label || ': today net');
  return next extensions.is((summary->>'operatingExpenseAccumulated')::numeric, operating, label || ': full operating cost');
  return next extensions.is((overview->>'netCashFlow')::numeric, -branch_paid, label || ': overview balance');
  return next extensions.is((overview->>'operatingExpenseAccumulated')::numeric, operating, label || ': overview operating cost');
end $$;

insert into public.payroll_slips (id, profile_id, month, gross_pay, total_deductions, net_pay,
  total_days, daily_wage, status, created_by, approved_by, approved_at, expense_location_id)
values ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002',
  '2026-09', 16000, 1000, 15000, 32, 500, 'APPROVED',
  '82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  now(), '81000000-0000-4000-8000-000000000001');
select * from pg_temp.check_balance(15000, 15000, 'legacy unchanged');

select public.change_time_tracking_payment('payroll_slip', '84000000-0000-4000-8000-000000000001',
  '{"channel":"branch_and_transfer","expenseLocationId":"81000000-0000-4000-8000-000000000001","transferAmount":"10000","expectedSourceAmount":15000}', null);
select * from pg_temp.check_balance(5000, 15000, 'split 15000/10000');
-- Fixture-only status/date changes; public allocation/slip/delete paths below
-- still exercise their normal authorization and locking boundaries.
select set_config('app.time_tracking_expense_rpc', 'true', true);
update public.payroll_slips set status = 'PENDING' where id = '84000000-0000-4000-8000-000000000001';
select * from pg_temp.check_balance(0, 0, 'pending payroll excluded');
update public.payroll_slips set status = 'APPROVED'
where id = '84000000-0000-4000-8000-000000000001';
update public.payroll_slips set cancelled_at = now()
where id = '84000000-0000-4000-8000-000000000001';
select * from pg_temp.check_balance(0, 0, 'cancelled payroll excluded');
update public.payroll_slips set cancelled_at = null, approved_at = now() - interval '1 day'
where id = '84000000-0000-4000-8000-000000000001';
select extensions.is((private.calculate_dashboard_summary('81000000-0000-4000-8000-000000000001')->>'netCashFlow')::numeric,
  -5000::numeric, 'prior business date still affects accumulated balance');
select extensions.is((private.calculate_dashboard_summary('81000000-0000-4000-8000-000000000001')#>>'{cashToday,expense}')::numeric,
  0::numeric, 'prior business date does not affect today');
update public.payroll_slips set approved_at = now() where id = '84000000-0000-4000-8000-000000000001';
select extensions.is((
  select (row->>'cost')::numeric from jsonb_array_elements(public.get_income_expense_operational_feed(
    '81000000-0000-4000-8000-000000000001', 'latest', '', null)->'rows') row
  where row->>'relationSourceId' = '84000000-0000-4000-8000-000000000001'
), 5000::numeric, 'income expense agrees with dashboard branch portion');

select public.change_time_tracking_payment('payroll_slip', '84000000-0000-4000-8000-000000000001',
  '{"channel":"branch_and_transfer","expenseLocationId":"81000000-0000-4000-8000-000000000001","transferAmount":"15000","expectedSourceAmount":15000}', null);
select * from pg_temp.check_balance(0, 15000, 'full bank transfer');
select public.change_time_tracking_payment('payroll_slip', '84000000-0000-4000-8000-000000000001',
  '{"channel":"branch_and_transfer","expenseLocationId":"81000000-0000-4000-8000-000000000001","transferAmount":"0","expectedSourceAmount":15000}', null);
select * from pg_temp.check_balance(15000, 15000, 'branch only');
update public.payroll_slips set net_pay = 0 where id = '84000000-0000-4000-8000-000000000001';
select * from pg_temp.check_balance(0, 0, 'zero payroll');
update public.payroll_slips set net_pay = 15000 where id = '84000000-0000-4000-8000-000000000001';
select public.change_time_tracking_payment('payroll_slip', '84000000-0000-4000-8000-000000000001',
  '{"channel":"outside_system","expenseLocationId":null,"transferAmount":null,"expectedSourceAmount":15000}', null);
select * from pg_temp.check_balance(0, 0, 'outside system unchanged');

select public.change_time_tracking_payment('payroll_slip', '84000000-0000-4000-8000-000000000001',
  '{"channel":"branch_and_transfer","expenseLocationId":"81000000-0000-4000-8000-000000000002","transferAmount":"10000","expectedSourceAmount":15000}', null);
select * from pg_temp.check_balance(0, 0, 'old branch cleared');
select * from pg_temp.check_balance(5000, 15000, 'new branch', '81000000-0000-4000-8000-000000000002');
select public.change_time_tracking_payment('payroll_slip', '84000000-0000-4000-8000-000000000001',
  '{"channel":"branch_and_transfer","expenseLocationId":"81000000-0000-4000-8000-000000000001","transferAmount":"10000","expectedSourceAmount":15000}', null);

select public.save_source_owned_money_transfer_slips(
  (select id from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'),
  (select revision_no from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'),
  '[{"id":"85000000-0000-4000-8000-000000000001","amount":4000,"fee":0,"transactionDate":"2026-10-31T09:00:00+07:00","inputMethod":"manual","referenceNumber":null,"sortOrder":0}]');
select * from pg_temp.check_balance(5000, 15000, 'partial bank slip');
select public.save_source_owned_money_transfer_slips(
  (select id from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'),
  (select revision_no from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'),
  '[{"id":"85000000-0000-4000-8000-000000000001","amount":10000,"fee":0,"transactionDate":"2026-10-31T09:00:00+07:00","inputMethod":"manual","referenceNumber":null,"sortOrder":0}]');
select * from pg_temp.check_balance(5000, 15000, 'paid bank slip');
select extensions.ok(exists (
  select 1 from jsonb_array_elements(private.dashboard_money_source_entries('money_transfer',
    (select id from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'))) entry
  where entry->>'eventKey' like 'time-payroll-transfer:%'
), 'paid transfer remains visible in history');
select public.save_source_owned_money_transfer_slips(
  (select id from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'),
  (select revision_no from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'),
  '[{"id":"85000000-0000-4000-8000-000000000001","amount":11000,"fee":0,"transactionDate":"2026-10-31T09:00:00+07:00","inputMethod":"manual","referenceNumber":null,"sortOrder":0}]');
select * from pg_temp.check_balance(5000, 15000, 'overpaid bank slip does not change branch money');
select public.save_source_owned_money_transfer_slips(
  (select id from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'),
  (select revision_no from public.money_transfers where payroll_slip_id = '84000000-0000-4000-8000-000000000001'), '[]');
select * from pg_temp.check_balance(5000, 15000, 'removed bank slip');

select public.start_cash_count_session('81000000-0000-4000-8000-000000000001');
select extensions.is((select system_balance from public.cash_count_sessions
  where location_id = '81000000-0000-4000-8000-000000000001' and status = 'active'),
  -5000::numeric, 'new cash count freezes the branch portion from the live formula');
select public.cancel_cash_count_session((select id from public.cash_count_sessions
  where location_id = '81000000-0000-4000-8000-000000000001' and status = 'active'));

select public.delete_time_tracking_source_permanently('payroll_slip', '84000000-0000-4000-8000-000000000001');
select * from pg_temp.check_balance(0, 0, 'deleted source restores branch balance and cost');
select extensions.is((select system_balance from public.cash_count_sessions
  where location_id = '81000000-0000-4000-8000-000000000001'),
  -5000::numeric, 'later source deletion does not rewrite the frozen historical count balance');

select public.create_time_tracking_withdrawal_with_payment('82000000-0000-4000-8000-000000000002',
  15000, current_date, 'balance split withdrawal',
  '{"channel":"branch_and_transfer","expenseLocationId":"81000000-0000-4000-8000-000000000001","transferAmount":"10000","expectedSourceAmount":15000}', null);
select * from pg_temp.check_balance(5000, 15000, 'withdrawal split uses same contract');
select public.change_time_tracking_payment('transaction',
  (select id from public.financial_transactions where description = 'balance split withdrawal'),
  '{"channel":"branch_and_transfer","expenseLocationId":"81000000-0000-4000-8000-000000000001","transferAmount":"15000","expectedSourceAmount":15000}', null);
select * from pg_temp.check_balance(0, 15000, 'withdrawal full transfer');
select public.delete_time_tracking_source_permanently('transaction',
  (select id from public.financial_transactions where description = 'balance split withdrawal'));
select * from pg_temp.check_balance(0, 0, 'withdrawal deletion');

-- A real purchase denominator proves the expense ratio uses full operating
-- cost, not the bank-excluded balance amount.
insert into public.rubber_bills (id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date, customer_name, bill_type,
  weight, rubber_value, average_price, deduction_total, net_total,
  client_recorded_at, client_created_at, server_received_at, created_by_user_id, created_by_name, created_by_phone)
values ('86000000-0000-4000-8000-000000000001', 'PBB-B1', 'PBB-B1', 'PBB-B1', 'PBB-B1',
  'synced', 'active', '81000000-0000-4000-8000-000000000001', 'PBB-B1',
  (now() at time zone 'Asia/Bangkok')::date, 'Balance purchase', 'weighing',
  1000, 100000, 100, 0, 100000, now(), now(), now(),
  '82000000-0000-4000-8000-000000000001', 'Balance Manager', '0898200001');
insert into public.rubber_bill_items (bill_id, item_type, description, net_weight, price, total, sequence_no)
values ('86000000-0000-4000-8000-000000000001', 'weigh', 'Balance purchase', 1000, 100, 100000, 1);
select public.create_time_tracking_withdrawal_with_payment('82000000-0000-4000-8000-000000000002',
  15000, current_date, 'balance ratio withdrawal',
  '{"channel":"branch_and_transfer","expenseLocationId":"81000000-0000-4000-8000-000000000001","transferAmount":"10000","expectedSourceAmount":15000}', null);
select extensions.is((private.calculate_dashboard_summary('81000000-0000-4000-8000-000000000001')->>'operatingBurdenPercent')::numeric,
  15::numeric, 'full 15000 operating expense / 100000 purchases yields 15 percent');
select extensions.is((private.calculate_dashboard_summary('81000000-0000-4000-8000-000000000001')->>'netCashFlow')::numeric,
  -105000::numeric, 'purchase balance plus branch-funded withdrawal only');

select * from extensions.finish();
rollback;
