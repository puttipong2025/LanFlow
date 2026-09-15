begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations(id, name, code, is_active) values
  ('7c000000-0000-4000-8000-000000000001', 'Wage Recalculation', 'WAGEREC', true),
  ('7c000000-0000-4000-8000-000000000002', 'Other Wage Branch', 'WAGEOUT', true);

insert into public.profiles(
  id, phone, name, role, is_active, can_manage_time_payroll,
  can_access_super_admin_features, daily_wage
) values
  ('7c100000-0000-4000-8000-000000000001', '0897310001', 'Wage Manager', 'admin', true, true, false, 500),
  ('7c100000-0000-4000-8000-000000000002', '0897310002', 'Wage Employee', 'user', true, false, false, 500),
  ('7c100000-0000-4000-8000-000000000003', '0897310003', 'Ordinary Employee', 'user', true, false, false, 500),
  ('7c100000-0000-4000-8000-000000000004', '0897310004', 'Global Wage Manager', 'admin', true, false, true, 500),
  ('7c100000-0000-4000-8000-000000000005', '0897310005', 'Other Branch Wage Manager', 'admin', true, true, false, 500);

insert into public.user_locations(user_id, location_id, is_primary) values
  ('7c100000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000001', true),
  ('7c100000-0000-4000-8000-000000000002', '7c000000-0000-4000-8000-000000000001', true),
  ('7c100000-0000-4000-8000-000000000003', '7c000000-0000-4000-8000-000000000001', true),
  ('7c100000-0000-4000-8000-000000000004', '7c000000-0000-4000-8000-000000000002', true),
  ('7c100000-0000-4000-8000-000000000005', '7c000000-0000-4000-8000-000000000002', true);

insert into public.time_payroll_active_periods(
  profile_id, start_on, created_by, updated_by
) values (
  '7c100000-0000-4000-8000-000000000002',
  (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months')::date,
  '7c100000-0000-4000-8000-000000000001',
  '7c100000-0000-4000-8000-000000000001'
);

insert into public.financial_transactions(
  id, profile_id, type, amount, status, description, remaining_amount,
  effective_date, approved_by, approved_at
) values (
  '7c200000-0000-4000-8000-000000000001',
  '7c100000-0000-4000-8000-000000000002',
  'WITHDRAWAL',
  1000000,
  'APPROVED',
  'Wage recalculation report-locked parent',
  1000000,
  (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months')::date,
  '7c100000-0000-4000-8000-000000000001',
  now()
);

select extensions.lives_ok(
  $$select private.apply_time_tracking_deductions(
    '7c100000-0000-4000-8000-000000000002',
    date_trunc('month', now() at time zone 'Asia/Bangkok')::date
  )$$,
  'the existing engine creates deterministic deductions before the wage change'
);

insert into public.payroll_slips(
  id, profile_id, month, gross_pay, total_deductions, net_pay,
  total_days, daily_wage, status, created_by
) values
  (
    '7c300000-0000-4000-8000-000000000001',
    '7c100000-0000-4000-8000-000000000002',
    to_char(date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months', 'YYYY-MM'),
    0, 0, 0, 0, 500, 'PENDING', '7c100000-0000-4000-8000-000000000001'
  ),
  (
    '7c300000-0000-4000-8000-000000000002',
    '7c100000-0000-4000-8000-000000000002',
    to_char(date_trunc('month', now() at time zone 'Asia/Bangkok'), 'YYYY-MM'),
    0, 0, 0, 0, 500, 'REJECTED', '7c100000-0000-4000-8000-000000000001'
  );

create temp table wage_recalculation_baseline as
select
  (select child.id from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type = 'WITHDRAWAL_DEDUCTION'
     and child.applied_month = (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months')::date) as closed_child_id,
  (select child.amount from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type = 'WITHDRAWAL_DEDUCTION'
     and child.applied_month = (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months')::date) as closed_child_amount,
  (select coalesce(sum(child.amount), 0)
   from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
     and not private.is_time_payroll_month_closed(
       child.profile_id,
       to_char(child.applied_month, 'YYYY-MM')
     )) as open_child_total,
  (select amount from public.financial_transactions where id = '7c200000-0000-4000-8000-000000000001') as parent_amount,
  (select status::text from public.financial_transactions where id = '7c200000-0000-4000-8000-000000000001') as parent_status,
  (select count(*) from public.time_tracking_audit_logs where action = 'AUTO_DEDUCTION') as auto_audit_count;

insert into public.report_batches(
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone
) values (
  '7c400000-0000-4000-8000-000000000001',
  'RPT-WAGE-RECALC',
  (now() at time zone 'Asia/Bangkok')::date,
  1,
  '7c000000-0000-4000-8000-000000000001',
  now(),
  'active',
  '7c100000-0000-4000-8000-000000000001',
  'Wage Manager',
  '0897310001'
);
insert into public.report_items(
  report_id, location_id, entity_type, entity_id, eligibility_at, active
) values (
  '7c400000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000001',
  'financial_transaction',
  '7c200000-0000-4000-8000-000000000001',
  now(),
  true
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.preview_time_tracking_wage_recalculation(uuid,numeric)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commit_time_tracking_wage_recalculation(uuid,numeric,text)', 'EXECUTE'),
  'authenticated callers can execute only the public wage preview and commit boundary'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.preview_time_tracking_wage_recalculation(uuid,numeric)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commit_time_tracking_wage_recalculation(uuid,numeric,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.plan_time_tracking_deductions(uuid,numeric,date,boolean)', 'EXECUTE'),
  'anonymous and direct planner execution remain revoked'
);
select extensions.ok(
  to_regprocedure('public.update_time_tracking_wage_internal_20260829(uuid,numeric)') is null
  and to_regprocedure('public.update_time_tracking_wage_internal_20260901(uuid,numeric)') is null
  and to_regprocedure('private.apply_time_tracking_deductions_internal_20260902(uuid,date)') is null,
  'superseded wage and deduction implementations are removed'
);

select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000003', true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.preview_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002', 600
  )$$,
  'P0001',
  'Forbidden',
  'an ordinary employee cannot preview another employee wage change'
);

select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000005', true);
select extensions.throws_ok(
  $$select public.preview_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002', 600
  )$$,
  'P0001',
  'Forbidden',
  'a branch payroll manager cannot preview an employee outside their branch'
);

select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000004', true);
select extensions.lives_ok(
  $$select public.preview_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002', 600
  )$$,
  'a global manager can preview an employee outside their own branch'
);

select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.update_time_tracking_wage(
    '7c100000-0000-4000-8000-000000000002', 600
  )$$,
  'P0001',
  'DEDUCTION_WAGE_LOCKED',
  'the legacy mutation cannot bypass preview while an open deduction exists'
);

create temp table wage_preview_period_stale as
select public.preview_time_tracking_wage_recalculation(
  '7c100000-0000-4000-8000-000000000002', 600
) as value;
reset role;
update public.time_payroll_active_periods
set start_on = date_trunc('month', now() at time zone 'Asia/Bangkok')::date
where profile_id = '7c100000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.commit_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002',
    600,
    (select value ->> 'digest' from wage_preview_period_stale)
  )$$,
  'P0001',
  'WAGE_PREVIEW_STALE',
  'a payroll-period change after preview rejects the commit'
);
select extensions.is(
  (select daily_wage from public.profiles where id = '7c100000-0000-4000-8000-000000000002'),
  500::numeric,
  'a period-stale commit writes no wage change'
);
reset role;
update public.time_payroll_active_periods
set start_on = (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months')::date
where profile_id = '7c100000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000001', true);

create temp table wage_preview_stale as
select public.preview_time_tracking_wage_recalculation(
  '7c100000-0000-4000-8000-000000000002', 600
) as value;

select extensions.ok(
  (select value ->> 'digest' from wage_preview_stale) ~ '^[0-9a-f]{64}$',
  'preview returns a canonical SHA-256 digest'
);
select extensions.is(
  (select month_row ->> 'closed'
   from wage_preview_stale, jsonb_array_elements(value -> 'months') month_row
   where month_row ->> 'month' = to_char(date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months', 'YYYY-MM')),
  'true',
  'a PENDING slip closes its month'
);
select extensions.is(
  (select count(*)
   from wage_preview_stale, jsonb_array_elements(value -> 'months') month_row
   where month_row ->> 'closed' = 'false'),
  2::bigint,
  'the planner recalculates every financially open month through the current month'
);
select extensions.is(
  (select month_row ->> 'closed'
   from wage_preview_stale, jsonb_array_elements(value -> 'months') month_row
   where month_row ->> 'month' = to_char(date_trunc('month', now() at time zone 'Asia/Bangkok'), 'YYYY-MM')),
  'false',
  'a REJECTED slip does not close its month'
);
select extensions.lives_ok(
  $$select public.preview_time_tracking_payroll_slip(
    '7c100000-0000-4000-8000-000000000002',
    to_char(date_trunc('month', now() at time zone 'Asia/Bangkok'), 'YYYY-MM')
  )$$,
  'payroll preview uses the same active-slip boundary for a REJECTED month'
);

reset role;
update public.payroll_slips
set status = 'PENDING'
where id = '7c300000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select public.commit_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002',
    600,
    (select value ->> 'digest' from wage_preview_stale)
  )$$,
  'P0001',
  'WAGE_PREVIEW_STALE',
  'a slip-state change after preview rejects the commit'
);
select extensions.is(
  (select daily_wage from public.profiles where id = '7c100000-0000-4000-8000-000000000002'),
  500::numeric,
  'a stale commit leaves the wage unchanged'
);
reset role;
select extensions.is(
  (select coalesce(sum(child.amount), 0)
   from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
     and child.applied_month > (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months')::date),
  (select open_child_total from wage_recalculation_baseline),
  'a stale commit leaves provisional deductions unchanged'
);

reset role;
update public.payroll_slips
set status = 'REJECTED'
where id = '7c300000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000001', true);
create temp table wage_preview_fresh as
select public.preview_time_tracking_wage_recalculation(
  '7c100000-0000-4000-8000-000000000002', 600
) as value;
select extensions.lives_ok(
  $$select public.commit_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002',
    600,
    (select value ->> 'digest' from wage_preview_fresh)
  )$$,
  'a fresh preview commits through the report-lock settlement boundary'
);

reset role;
select extensions.is(
  (select daily_wage from public.profiles where id = '7c100000-0000-4000-8000-000000000002'),
  600::numeric,
  'commit updates the current daily wage'
);
select extensions.is(
  (select child.id from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type = 'WITHDRAWAL_DEDUCTION'
     and child.applied_month = (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months')::date),
  (select closed_child_id from wage_recalculation_baseline),
  'the deduction in a PENDING-slip month keeps its identity'
);
select extensions.is(
  (select child.amount from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type = 'WITHDRAWAL_DEDUCTION'
     and child.applied_month = (date_trunc('month', now() at time zone 'Asia/Bangkok') - interval '2 months')::date),
  (select closed_child_amount from wage_recalculation_baseline),
  'the deduction amount in a closed month is immutable'
);
select extensions.is(
  (select coalesce(sum(child.amount), 0) from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
     and child.applied_month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date),
  trunc(public.calculate_paid_work_days(
    '7c100000-0000-4000-8000-000000000002',
    date_trunc('month', now() at time zone 'Asia/Bangkok'),
    date_trunc('month', now() at time zone 'Asia/Bangkok') + interval '1 month'
  ) * 600, 2),
  'the rejected-slip month is reallocated using the new wage'
);
select extensions.is(
  (select remaining_amount from public.financial_transactions where id = '7c200000-0000-4000-8000-000000000001'),
  (select parent.amount - coalesce(sum(child.amount), 0)
   from public.financial_transactions parent
   left join public.financial_transactions child on child.parent_debt_id = parent.id
   where parent.id = '7c200000-0000-4000-8000-000000000001'
   group by parent.amount),
  'the report-locked parent balance matches all closed and open allocations'
);
select extensions.is(
  (select amount from public.financial_transactions where id = '7c200000-0000-4000-8000-000000000001'),
  (select parent_amount from wage_recalculation_baseline),
  'wage recalculation never changes the report-locked parent amount'
);
select extensions.is(
  (select status::text from public.financial_transactions where id = '7c200000-0000-4000-8000-000000000001'),
  (select parent_status from wage_recalculation_baseline),
  'wage recalculation never changes the report-locked parent status'
);
select extensions.is(
  (select count(*) from public.time_tracking_audit_logs where action = 'AUTO_DEDUCTION'),
  (select auto_audit_count from wage_recalculation_baseline),
  'wage recalculation does not create misleading AUTO_DEDUCTION audit rows'
);
select extensions.is(
  (select count(*) from public.time_tracking_audit_logs
   where action = 'RECALCULATE_WAGE_DEDUCTIONS'
     and admin_id = '7c100000-0000-4000-8000-000000000001'
     and record_id = '7c100000-0000-4000-8000-000000000002'),
  1::bigint,
  'one summary audit records the actual wage editor'
);
select extensions.ok(
  (select jsonb_array_length(old_data -> 'allocations') > 0
      and jsonb_array_length(new_data -> 'allocations') > 0
   from public.time_tracking_audit_logs
   where action = 'RECALCULATE_WAGE_DEDUCTIONS'
     and record_id = '7c100000-0000-4000-8000-000000000002'),
  'the summary audit retains replaced and resulting allocation identities'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000001', true);
create temp table wage_preview_noop as
select public.preview_time_tracking_wage_recalculation(
  '7c100000-0000-4000-8000-000000000002', 600
) as value;
select extensions.is(
  (select value ->> 'noOp' from wage_preview_noop),
  'true',
  'preview identifies an unchanged wage as a no-op'
);
select extensions.lives_ok(
  $$select public.commit_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002',
    600,
    (select value ->> 'digest' from wage_preview_noop)
  )$$,
  'a no-op preview can be acknowledged without rebuilding data'
);
reset role;
select extensions.is(
  (select count(*) from public.time_tracking_audit_logs where action = 'RECALCULATE_WAGE_DEDUCTIONS'),
  1::bigint,
  'a no-op commit creates no audit row'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000001', true);
create temp table wage_preview_decrease as
select public.preview_time_tracking_wage_recalculation(
  '7c100000-0000-4000-8000-000000000002', 300
) as value;
select extensions.ok(
  (select (value #>> '{totals,restoredAmount}')::numeric > 0 from wage_preview_decrease),
  'decreasing the wage previews money restored to the parent transaction'
);
select extensions.lives_ok(
  $$select public.commit_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002',
    300,
    (select value ->> 'digest' from wage_preview_decrease)
  )$$,
  'a lower wage rebuilds every open-month deduction'
);
reset role;
select extensions.is(
  (select coalesce(sum(child.amount), 0) from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
     and child.applied_month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date),
  trunc(public.calculate_paid_work_days(
    '7c100000-0000-4000-8000-000000000002',
    date_trunc('month', now() at time zone 'Asia/Bangkok'),
    date_trunc('month', now() at time zone 'Asia/Bangkok') + interval '1 month'
  ) * 300, 2),
  'the current open month uses the decreased wage'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '7c100000-0000-4000-8000-000000000001', true);
create temp table wage_preview_zero as
select public.preview_time_tracking_wage_recalculation(
  '7c100000-0000-4000-8000-000000000002', 0
) as value;
select extensions.lives_ok(
  $$select public.commit_time_tracking_wage_recalculation(
    '7c100000-0000-4000-8000-000000000002',
    0,
    (select value ->> 'digest' from wage_preview_zero)
  )$$,
  'zero wage restores the open-month deduction'
);
reset role;
select extensions.is(
  (select coalesce(sum(child.amount), 0) from public.financial_transactions child
   where child.profile_id = '7c100000-0000-4000-8000-000000000002'
     and child.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
     and child.applied_month = date_trunc('month', now() at time zone 'Asia/Bangkok')::date),
  0::numeric,
  'zero wage removes every provisional deduction in the open month'
);
select extensions.is(
  (select remaining_amount from public.financial_transactions where id = '7c200000-0000-4000-8000-000000000001'),
  (select amount - (select closed_child_amount from wage_recalculation_baseline)
   from public.financial_transactions where id = '7c200000-0000-4000-8000-000000000001'),
  'zero wage restores the open amount while retaining the closed deduction'
);

select * from extensions.finish();
rollback;
