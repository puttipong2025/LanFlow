begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations(id, name, code, is_active)
values ('91000000-0000-4000-8000-000000000001', 'Payroll Report Home', 'PBRH', true);
insert into public.profiles(id, phone, name, role, is_active, can_manage_time_payroll, can_access_money_transfer, daily_wage)
values
 ('92000000-0000-4000-8000-000000000001', '0899200001', 'Payroll Report Manager', 'admin', true, true, true, 500),
 ('92000000-0000-4000-8000-000000000002', '0899200002', 'Payroll Report Employee', 'user', true, false, false, 500);
insert into public.user_locations(user_id, location_id, is_primary) values
 ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', true),
 ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"92000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Separate branches keep each actual report comparable with its live accumulated balance.
create function pg_temp.check_payroll_report(
 label text, month_no integer, bank_amount numeric, paid_amount numeric,
 source_kind text default 'payroll_slip', legacy boolean default false
) returns setof text language plpgsql as $case$
declare
 branch_id uuid := gen_random_uuid();
 source_id uuid := gen_random_uuid();
 transfer_id uuid;
 v_report_id uuid;
 expected_expense numeric := 15000 - bank_amount;
 slip_input jsonb;
 summary jsonb;
begin
 insert into public.locations(id, name, code, is_active)
 values(branch_id, label, 'PBR' || month_no, true);
 insert into public.user_locations(user_id, location_id, is_primary)
 values('92000000-0000-4000-8000-000000000001', branch_id, false);

 if source_kind = 'payroll_slip' then
   insert into public.payroll_slips(id, profile_id, month, gross_pay, total_deductions,
     net_pay, total_days, daily_wage, status, created_by, approved_by, approved_at, expense_location_id)
   values(source_id, '92000000-0000-4000-8000-000000000002',
     '2026-' || lpad(month_no::text, 2, '0'), 16000, 1000, 15000, 32, 500, 'APPROVED',
     '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
     now(), branch_id);
   if not legacy then
     perform public.change_time_tracking_payment('payroll_slip', source_id,
       jsonb_build_object('channel', 'branch_and_transfer', 'expenseLocationId', branch_id,
         'transferAmount', bank_amount::text, 'expectedSourceAmount', 15000), null);
   end if;
 else
   perform public.create_time_tracking_withdrawal_with_payment(
     '92000000-0000-4000-8000-000000000002', 15000, current_date, label,
     jsonb_build_object('channel', 'branch_and_transfer', 'expenseLocationId', branch_id,
       'transferAmount', bank_amount::text, 'expectedSourceAmount', 15000), null);
   select id into source_id from public.financial_transactions where description = label;
 end if;

 select id into transfer_id from public.money_transfers
 where (source_kind = 'payroll_slip' and payroll_slip_id = source_id)
    or (source_kind = 'transaction' and withdrawal_transaction_id = source_id);
 if paid_amount > 0 then
   slip_input := jsonb_build_array(jsonb_build_object(
     'id', gen_random_uuid(), 'amount', paid_amount, 'fee', 0,
     'transactionDate', now(), 'inputMethod', 'manual', 'referenceNumber', null, 'sortOrder', 0));
   perform public.save_source_owned_money_transfer_slips(transfer_id,
     (select revision_no from public.money_transfers where id = transfer_id), slip_input);
 end if;

 v_report_id := (private.create_report_batch_at(branch_id, clock_timestamp() + interval '1 second',
   '92000000-0000-4000-8000-000000000001')->>'id')::uuid;
 summary := private.calculate_dashboard_summary(branch_id);
 return next extensions.is((select coalesce(sum(amount), 0)
   from private.report_income_expense_period_rows(v_report_id) where entry_type = 'expense'),
   expected_expense, label || ': report expense is branch portion');
 return next extensions.is((select closing_balance from public.report_batches where id = v_report_id),
   -expected_expense, label || ': saved report balance is branch portion');
 return next extensions.is((select coalesce(sum(case when row->>'entry_type' = 'income'
   then (row->>'amount')::numeric else -(row->>'amount')::numeric end), 0)
   from jsonb_array_elements(public.get_report_income_expense_rows_json(v_report_id)) row),
   -expected_expense, label || ': preview/PDF RPC agrees with saved report balance');
 return next extensions.is((summary->>'netCashFlow')::numeric, -expected_expense,
   label || ': accumulated branch balance agrees');
 return next extensions.is((summary->>'operatingExpenseAccumulated')::numeric, 15000::numeric,
   label || ': full operating cost is preserved');
 return next extensions.is((select count(*) from private.report_income_expense_period_rows(v_report_id)
   where sort_key like '62-%'), 0::bigint, label || ': transfer is excluded from branch ledger');
 if paid_amount >= bank_amount and bank_amount > 0 then
   return next extensions.ok(exists(select 1 from public.report_items
     where report_id = v_report_id
       and entity_type = 'bank_transfer_source' and entity_id = transfer_id),
     label || ': transfer retained for bank section and report lock');
   return next extensions.throws_like(format(
     'select public.save_source_owned_money_transfer_slips(%L::uuid, %s, %L::jsonb)',
     transfer_id, (select revision_no from public.money_transfers where id = transfer_id), slip_input::text),
     'REPORT_LOCKED:%%', label || ': bank slip stays report locked');
 end if;
end
$case$;

select * from pg_temp.check_payroll_report('split paid', 1, 10000, 10000);
select * from pg_temp.check_payroll_report('full transfer', 2, 15000, 15000);
select * from pg_temp.check_payroll_report('branch only', 3, 0, 0);
select * from pg_temp.check_payroll_report('split no slips', 4, 10000, 0);
select * from pg_temp.check_payroll_report('split partial', 5, 10000, 4000);
select * from pg_temp.check_payroll_report('split overpaid', 6, 10000, 11000);
select * from pg_temp.check_payroll_report('legacy branch', 7, 0, 0, 'payroll_slip', true);
select * from pg_temp.check_payroll_report('withdrawal split paid', 8, 10000, 10000, 'transaction');
select * from pg_temp.check_payroll_report('withdrawal full transfer', 9, 15000, 15000, 'transaction');

-- Deliberately stale historical headers. Rebuild must preserve source membership
-- and document numbers, skip deleted reports, carry corrected values and be idempotent.
create temp table repair_branch as
 select id from public.locations where code = 'PBR1';
create temp table first_report as
 select * from public.report_batches where location_id = (select id from repair_branch);
update public.report_batches set closing_balance = -15000
 where id = (select id from first_report);
insert into public.report_batches(id, report_no, report_date, sequence_no, location_id, cutoff_at,
 status, created_by_user_id, created_by_name, created_by_phone, created_at,
 previous_report_id, opening_balance, closing_balance)
values
 ('94000000-0000-4000-8000-000000000002', 'RPT-PBR-DELETED', current_date, 2,
 (select id from repair_branch), now(), 'deleted',
 '92000000-0000-4000-8000-000000000001', 'Manager', '0899200001',
 now() + interval '2 seconds', (select id from first_report), 777, 888),
 ('94000000-0000-4000-8000-000000000003', 'RPT-PBR-NEXT', current_date, 3,
 (select id from repair_branch), now(), 'active',
 '92000000-0000-4000-8000-000000000001', 'Manager', '0899200001',
 now() + interval '3 seconds', (select id from first_report), -15000, -15000);
create temp table original_items as select * from public.report_items;
create temp table original_slips as select * from public.money_transfer_slips;
create temp table original_sources as select * from public.payroll_slips;
create temp table original_numbers as select id, report_no from public.report_batches;
select private.rebuild_active_report_balance_chain((select id from repair_branch));
select extensions.is((select closing_balance from public.report_batches where id = (select id from first_report)),
 -5000::numeric, 'historical first closing is corrected');
select extensions.results_eq(
 $$select opening_balance, closing_balance from public.report_batches where report_no = 'RPT-PBR-NEXT'$$,
 $$values (-5000::numeric, -5000::numeric)$$, 'next report carries corrected opening and closing');
select extensions.results_eq(
 $$select opening_balance, closing_balance from public.report_batches where report_no = 'RPT-PBR-DELETED'$$,
 $$values (777::numeric, 888::numeric)$$, 'deleted report balances are preserved');
select extensions.is((select previous_report_id from public.report_batches where report_no = 'RPT-PBR-NEXT'),
 (select id from first_report), 'chain still skips deleted report');
select extensions.results_eq($$select * from public.report_items order by id$$,
 $$select * from original_items order by id$$, 'repair preserves complete report membership');
select extensions.results_eq($$select * from public.money_transfer_slips order by id$$,
 $$select * from original_slips order by id$$, 'repair preserves bank evidence');
select extensions.results_eq($$select * from public.payroll_slips order by id$$,
 $$select * from original_sources order by id$$, 'repair preserves payroll sources');
select extensions.results_eq($$select id, report_no from public.report_batches order by id$$,
 $$select * from original_numbers order by id$$, 'repair preserves document numbers');
create temp table repaired_headers as select * from public.report_batches;
select private.rebuild_active_report_balance_chain((select id from repair_branch));
select extensions.results_eq($$select * from public.report_batches order by id$$,
 $$select * from repaired_headers order by id$$, 'repair is idempotent');
select extensions.ok(not has_function_privilege('authenticated',
 'private.rebuild_active_report_balance_chain(uuid)', 'execute'), 'browser cannot run historical repair');
select * from extensions.finish();
rollback;


