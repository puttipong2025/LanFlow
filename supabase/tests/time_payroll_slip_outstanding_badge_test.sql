begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations(id, name, code, is_active) values
  ('73000000-0000-4000-8000-000000000001', 'Payroll badge branch', 'PAYBADGE', true);

insert into public.profiles(
  id, phone, name, role, is_active, can_manage_time_payroll,
  can_access_super_admin_features, daily_wage
) values
  ('74000000-0000-4000-8000-000000000001', '0874000001', 'Snapshot employee', 'user', true, false, false, 500),
  ('74000000-0000-4000-8000-000000000002', '0874000002', 'Missing employee', 'user', true, false, false, 500),
  ('74000000-0000-4000-8000-000000000003', '0874000003', 'Ended employee', 'user', true, false, false, 500),
  ('74000000-0000-4000-8000-000000000004', '0874000004', 'Empty employee', 'user', true, false, false, 500),
  ('74000000-0000-4000-8000-000000000005', '0874000005', 'Unassigned employee', 'user', true, false, false, 500),
  ('74000000-0000-4000-8000-000000000006', '0874000006', 'Rejected-slip employee', 'user', true, false, false, 500),
  ('74000000-0000-4000-8000-000000000007', '0874000007', 'Cancelled-parent adjustment employee', 'user', true, false, false, 500);

insert into public.user_locations(user_id, location_id, is_primary)
select id, '73000000-0000-4000-8000-000000000001', true
from public.profiles
where id in (
  '74000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000004',
  '74000000-0000-4000-8000-000000000007'
);
set constraints all immediate;

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, parent_debt_id,
  effective_date, applied_month, adjustment_base_amount, expense_location_id,
  approved_by, approved_at, created_at
) values
  ('75000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'WITHDRAWAL', 1000, 300, 'APPROVED', null, '2026-01-01', null, null, '73000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '2026-01-01 10:00+07', '2026-01-01 09:00+07'),
  ('75000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000001', 'ADJUSTMENT', 800, 0, 'APPROVED', '75000000-0000-4000-8000-000000000001', '2026-02-01', null, 1000, '73000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '2026-02-01 10:00+07', '2026-02-01 09:00+07'),
  ('75000000-0000-4000-8000-000000000003', '74000000-0000-4000-8000-000000000001', 'ADJUSTMENT', 1200, 0, 'APPROVED', '75000000-0000-4000-8000-000000000001', '2026-03-01', null, 800, '73000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '2026-03-01 10:00+07', '2026-03-01 09:00+07'),
  ('75000000-0000-4000-8000-000000000004', '74000000-0000-4000-8000-000000000001', 'WITHDRAWAL_DEDUCTION', 300, 0, 'APPROVED', '75000000-0000-4000-8000-000000000001', '2026-01-01', '2026-01-01', null, null, '00000000-0000-4000-8000-000000000001', '2026-01-31 16:00+07', '2026-01-31 16:00+07'),
  ('75000000-0000-4000-8000-000000000005', '74000000-0000-4000-8000-000000000001', 'WITHDRAWAL_DEDUCTION', 200, 0, 'APPROVED', '75000000-0000-4000-8000-000000000001', '2026-02-01', '2026-02-01', null, null, '00000000-0000-4000-8000-000000000001', '2026-02-28 16:00+07', '2026-02-28 16:00+07'),
  ('75000000-0000-4000-8000-000000000006', '74000000-0000-4000-8000-000000000001', 'WITHDRAWAL_DEDUCTION', 100, 0, 'APPROVED', '75000000-0000-4000-8000-000000000001', '2026-03-01', '2026-03-01', null, null, '00000000-0000-4000-8000-000000000001', '2026-03-31 16:00+07', '2026-03-31 16:00+07');

select extensions.is(
  private.time_payroll_slip_outstanding_snapshot(
    '74000000-0000-4000-8000-000000000001', '2026-02',
    '2026-02-28 23:00+07', 200
  ),
  '{"beforeDeductions":500,"deductedThisSlip":200,"remainingAfterDeductions":300}'::jsonb,
  'historical snapshot uses the latest adjustment and deductions available when the slip was created'
);

insert into public.payroll_slips(
  id, profile_id, month, gross_pay, total_deductions, net_pay, total_days,
  daily_wage, slip_data, status, created_by, created_at
) values (
  '76000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001',
  '2026-02', 5000, 200, 4800, 10, 500, '{"transactions":[]}', 'PENDING',
  '00000000-0000-4000-8000-000000000001', '2026-02-28 23:00+07'
);

select extensions.is(
  (select slip_data -> 'outstandingAdjustments' from public.payroll_slips where id = '76000000-0000-4000-8000-000000000001'),
  '{"beforeDeductions":500,"deductedThisSlip":200,"remainingAfterDeductions":300}'::jsonb,
  'payroll insert stores the immutable outstanding aggregate in slip_data'
);

insert into public.time_payroll_active_periods(profile_id, start_on, end_on, created_by, updated_by) values
  ('74000000-0000-4000-8000-000000000002', '2026-01-01', null, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('74000000-0000-4000-8000-000000000003', '2026-03-01', '2026-03-15', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('74000000-0000-4000-8000-000000000004', '2026-01-01', '2026-01-01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('74000000-0000-4000-8000-000000000005', '2026-01-01', null, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');

insert into public.time_payroll_attendance_exceptions(profile_id, work_date, status, created_by, updated_by)
values ('74000000-0000-4000-8000-000000000004', '2026-01-01', 'OFF', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');

update public.time_payroll_active_periods
set end_on = '2026-03-14',
    scheduled_action = 'END',
    scheduled_effective_on = '2026-03-15',
    scheduled_activation_on = '2026-03-15'
where profile_id = '74000000-0000-4000-8000-000000000003';

insert into private.time_payroll_employment_boundaries(profile_id, last_end_action_on, recorded_at)
values ('74000000-0000-4000-8000-000000000003', '2026-03-15', '2026-03-15 16:00+07');

select extensions.is(
  (select count(*) from private.time_payroll_missing_slip_months('2026-01-31 15:59:59+07') where profile_id = '74000000-0000-4000-8000-000000000002'),
  0::bigint,
  'the current month is not missing before the last-day work cutoff'
);

select extensions.is(
  (select missing_months from private.time_payroll_missing_slip_months('2026-01-31 16:00:00+07') where profile_id = '74000000-0000-4000-8000-000000000002'),
  array['2026-01']::text[],
  'the current month becomes missing at the exact last-day work cutoff'
);

insert into public.payroll_slips(
  profile_id, month, gross_pay, total_deductions, net_pay, total_days,
  daily_wage, slip_data, status, created_by, created_at
) values (
  '74000000-0000-4000-8000-000000000002', '2026-01', 15500, 0, 15500, 31,
  500, '{"transactions":[]}', 'PENDING', '00000000-0000-4000-8000-000000000001', '2026-01-31 16:00+07'
);

select extensions.is(
  (select count(*) from private.time_payroll_missing_slip_months('2026-01-31 16:00:00+07') where profile_id = '74000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a pending slip closes the month for the missing-work badge'
);

update public.payroll_slips set status = 'REJECTED'
where profile_id = '74000000-0000-4000-8000-000000000002' and month = '2026-01';

select extensions.is(
  (select missing_months from private.time_payroll_missing_slip_months('2026-01-31 16:00:00+07') where profile_id = '74000000-0000-4000-8000-000000000002'),
  array['2026-01']::text[],
  'a rejected slip leaves the month missing'
);

update public.payroll_slips
set status = 'PENDING',
    cancelled_at = '2026-01-31 16:01+07',
    cancelled_by = '00000000-0000-4000-8000-000000000001'
where profile_id = '74000000-0000-4000-8000-000000000002' and month = '2026-01';

select extensions.is(
  (select missing_months from private.time_payroll_missing_slip_months('2026-01-31 16:02:00+07') where profile_id = '74000000-0000-4000-8000-000000000002'),
  array['2026-01']::text[],
  'a cancelled pending slip leaves the month missing'
);

select extensions.is(
  private.is_time_payroll_month_closed('74000000-0000-4000-8000-000000000002', '2026-01'),
  false,
  'a cancelled pending slip does not close the month for preview and recalculation paths'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

select extensions.throws_ok(
  $$select public.decide_time_tracking_approval(
    'payroll_slip',
    (select id from public.payroll_slips where profile_id = '74000000-0000-4000-8000-000000000002' and month = '2026-01'),
    'APPROVED', null, null
  )$$,
  'P0001',
  'Approval has already been decided',
  'a manager cannot decide a payroll slip that was already cancelled'
);

select extensions.throws_ok(
  $$select public.decide_time_tracking_approval_internal_20260829(
    'payroll_slip',
    (select id from public.payroll_slips where profile_id = '74000000-0000-4000-8000-000000000002' and month = '2026-01'),
    'APPROVED', null, null
  )$$,
  'P0001',
  'Approval has already been decided',
  'the locked payroll-slip decision path rejects a concurrently cancelled source'
);

select extensions.is(
  (select count(*) from private.time_payroll_missing_slip_months('2026-03-14 23:59:59+07') where profile_id = '74000000-0000-4000-8000-000000000003'),
  0::bigint,
  'a final employment month waits until the scheduled END becomes effective'
);

select extensions.is(
  (select missing_months from private.time_payroll_missing_slip_months('2026-03-15 00:00:01+07') where profile_id = '74000000-0000-4000-8000-000000000003'),
  array['2026-03']::text[],
  'a final employment month becomes missing when the scheduled END is effective'
);

select extensions.is(
  (select count(*) from private.time_payroll_missing_slip_months('2026-01-31 16:00:00+07') where profile_id = '74000000-0000-4000-8000-000000000004'),
  0::bigint,
  'a month containing only OFF attendance is not missing'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, effective_date,
  created_at, cancelled_at, cancelled_by
) values (
  '75000000-0000-4000-8000-000000000013', '74000000-0000-4000-8000-000000000005',
  'DEBT', 50, 0, 'PENDING', '2026-06-01', '2026-06-01 09:00+07',
  '2026-06-01 10:00+07', '00000000-0000-4000-8000-000000000001'
);

select extensions.throws_ok(
  $$select public.decide_time_tracking_approval(
    'transaction', '75000000-0000-4000-8000-000000000013', 'APPROVED', null, null
  )$$,
  'P0001',
  'Approval has already been decided',
  'a manager cannot decide a transaction that was already cancelled'
);

select extensions.throws_ok(
  $$select public.decide_time_tracking_approval_internal_20260829(
    'transaction', '75000000-0000-4000-8000-000000000013', 'APPROVED', null, null
  )$$,
  'P0001',
  'Approval has already been decided',
  'the locked transaction decision path rejects a concurrently cancelled source'
);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, effective_date,
  approved_by, approved_at, created_at, cancelled_at, cancelled_by
) values (
  '75000000-0000-4000-8000-000000000009', '74000000-0000-4000-8000-000000000005',
  'DEBT', 777, 777, 'APPROVED', '2026-01-01',
  '00000000-0000-4000-8000-000000000001', '2026-01-01 09:30+07', '2026-01-01 09:00+07',
  '2026-01-02 10:00+07', '00000000-0000-4000-8000-000000000001'
);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, parent_debt_id,
  effective_date, applied_month, approved_by, approved_at, created_at
) values (
  '75000000-0000-4000-8000-000000000010', '74000000-0000-4000-8000-000000000005',
  'DEBT_DEDUCTION', 100, 0, 'APPROVED', '75000000-0000-4000-8000-000000000009',
  '2026-01-01', '2026-01-01', '00000000-0000-4000-8000-000000000001',
  '2026-01-01 09:45+07', '2026-01-01 09:45+07'
);

select extensions.is(
  (
    select (item ->> 'debtAmount')::numeric
    from jsonb_array_elements(public.get_time_payroll_manager_overview()) item
    where item ->> 'profileId' = '74000000-0000-4000-8000-000000000005'
  ),
  0::numeric,
  'manager overview excludes cancelled approved debt from the route total'
);

select extensions.is(
  (public.get_time_payroll_user_totals(
    '74000000-0000-4000-8000-000000000005', '2026-01'
  ) ->> 'totalDebt')::numeric,
  0::numeric,
  'employee totals exclude cancelled approved debt'
);

select extensions.is(
  (
    select (item ->> 'amount')::numeric
    from jsonb_array_elements(public.get_time_payroll_debt_totals()) item
    where item ->> 'profileId' = '74000000-0000-4000-8000-000000000005'
  ),
  null::numeric,
  'compatibility debt totals omit employees whose only debt was cancelled'
);

select extensions.is(
  (public.preview_time_tracking_payroll_slip(
    '74000000-0000-4000-8000-000000000005', '2026-01'
  ) ->> 'netPay')::numeric,
  15500::numeric,
  'payroll preview excludes cancelled approved debt'
);

select extensions.is(
  (select item_count from private.time_payroll_missing_slip_badge_counts('2026-01-31 16:00:00+07') where location_id = '73000000-0000-4000-8000-000000000001'),
  1::bigint,
  'branch badge counts missing months only for employees with an active primary branch'
);

update public.time_payroll_active_periods
set end_on = '2026-01-31'
where profile_id = '74000000-0000-4000-8000-000000000002';
insert into private.time_payroll_employment_boundaries(profile_id, last_end_action_on, recorded_at)
values ('74000000-0000-4000-8000-000000000002', '2026-01-31', '2026-01-31 16:00+07');
update public.profiles
set is_active = false
where id = '74000000-0000-4000-8000-000000000003';

select extensions.is(
  (select item_count from public.get_actionable_badge_counts() where location_id = '73000000-0000-4000-8000-000000000001' and module_id = 'time-tracking'),
  1::bigint,
  'a cancelled pending slip is counted only as its missing month, not as a second pending item'
);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, parent_debt_id,
  effective_date, adjustment_base_amount, expense_location_id, created_at
) values (
  '75000000-0000-4000-8000-000000000007', '74000000-0000-4000-8000-000000000001',
  'ADJUSTMENT', 1300, 0, 'PENDING', '75000000-0000-4000-8000-000000000001',
  '2026-04-01', 1200, '73000000-0000-4000-8000-000000000001', '2026-04-01 09:00+07'
);

select extensions.is(
  (select item_count from public.get_actionable_badge_counts() where location_id = '73000000-0000-4000-8000-000000000001' and module_id = 'time-tracking'),
  2::bigint,
  'a pending withdrawal adjustment contributes one actionable Time/Payroll item'
);

update public.financial_transactions
set cancelled_at = '2026-04-01 10:00+07',
    cancelled_by = '00000000-0000-4000-8000-000000000001'
where id = '75000000-0000-4000-8000-000000000007';

select extensions.is(
  (
    select item ->> 'pendingAdjustmentId'
    from jsonb_array_elements(public.get_withdrawal_adjustment_summaries(
      '74000000-0000-4000-8000-000000000001'
    )) item
    where item ->> 'withdrawalId' = '75000000-0000-4000-8000-000000000001'
  ),
  null::text,
  'a cancelled pending adjustment does not block a replacement request'
);

select extensions.lives_ok(
  $$insert into public.payroll_slips(
    id, profile_id, month, gross_pay, total_deductions, net_pay, total_days,
    daily_wage, slip_data, status, created_by, created_at
  ) values (
    '76000000-0000-4000-8000-000000000002',
    '74000000-0000-4000-8000-000000000001', '2026-04', 0, 0, 0, 0,
    500, '{"transactions":[]}', 'PENDING',
    '00000000-0000-4000-8000-000000000001', '2026-04-30 16:00+07'
  )$$,
  'a cancelled pending adjustment does not block payroll snapshot creation'
);

insert into public.report_batches(
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  '77000000-0000-4000-8000-000000000001', 'RPT-PAYBADGE-1', '2026-04-01', 987653,
  '73000000-0000-4000-8000-000000000001', '2026-04-01 16:00+07',
  '00000000-0000-4000-8000-000000000001', 'Payroll badge test', '0000000000'
);

insert into public.report_items(report_id, location_id, entity_type, entity_id, eligibility_at)
values (
  '77000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  'financial_transaction',
  '75000000-0000-4000-8000-000000000001',
  '2026-04-01 12:00+07'
);

select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok(
  $$select public.request_time_tracking_withdrawal_adjustment(
    '75000000-0000-4000-8000-000000000001', 1100, null, 'replacement after cancellation'
  )$$,
  'a cancelled pending adjustment allows its owner to submit a replacement request'
);

select extensions.throws_ok(
  $$select public.withdraw_time_tracking_withdrawal_adjustment(
    '75000000-0000-4000-8000-000000000007'
  )$$,
  'P0001',
  'ADJUSTMENT_ALREADY_DECIDED',
  'an employee cannot withdraw an adjustment that was already cancelled'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

select extensions.throws_ok(
  $$select public.decide_time_tracking_withdrawal_adjustment(
    '75000000-0000-4000-8000-000000000007', 'REJECTED', null, 'cancelled fixture'
  )$$,
  'P0001',
  'ADJUSTMENT_ALREADY_DECIDED',
  'a manager cannot decide an adjustment that was already cancelled'
);

update public.payroll_slips
set cancelled_at = '2026-02-28 23:30+07',
    cancelled_by = '00000000-0000-4000-8000-000000000001'
where id = '76000000-0000-4000-8000-000000000001';

select extensions.is(
  private.withdrawal_closed_floor('75000000-0000-4000-8000-000000000001'),
  0::numeric,
  'a cancelled payroll slip no longer contributes to the closed withdrawal floor'
);

select set_config('app.time_tracking_expense_rpc', 'true', true);
update public.financial_transactions
set cancelled_at = '2026-04-02 09:00+07',
    cancelled_by = '00000000-0000-4000-8000-000000000001'
where id = '75000000-0000-4000-8000-000000000003';
select set_config('app.time_tracking_expense_rpc', 'false', true);

select extensions.is(
  private.latest_withdrawal_target('75000000-0000-4000-8000-000000000001'),
  800::numeric,
  'a cancelled approved adjustment no longer defines the live withdrawal target'
);

select extensions.is(
  (
    select count(*)
    from unnest(array[
      'private.latest_withdrawal_target(uuid)'::regprocedure,
      'private.withdrawal_closed_floor(uuid)'::regprocedure,
      'private.rebuild_open_deductions_for_adjustment(uuid,uuid,uuid)'::regprocedure,
      'private.prepare_payroll_slip_adjustment_snapshot()'::regprocedure,
      'private.prevent_approved_adjustment_delete()'::regprocedure
    ]) function_oid
    where not has_function_privilege('anon', function_oid, 'execute')
      and not has_function_privilege('authenticated', function_oid, 'execute')
  ),
  5::bigint,
  'authenticated clients cannot execute internal withdrawal adjustment helpers'
);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, parent_debt_id,
  effective_date, applied_month, approved_by, approved_at, created_at,
  cancelled_at, cancelled_by
) values
  (
    '75000000-0000-4000-8000-000000000011', '74000000-0000-4000-8000-000000000001',
    'DEBT', 100, 50, 'APPROVED', null, '2026-05-01', null,
    '00000000-0000-4000-8000-000000000001', '2026-05-01 09:00+07', '2026-05-01 09:00+07',
    '2026-05-02 09:00+07', '00000000-0000-4000-8000-000000000001'
  ),
  (
    '75000000-0000-4000-8000-000000000012', '74000000-0000-4000-8000-000000000001',
    'DEBT_DEDUCTION', 25, 0, 'APPROVED', '75000000-0000-4000-8000-000000000011',
    '2026-05-01', '2026-05-01', '00000000-0000-4000-8000-000000000001',
    '2026-05-01 10:00+07', '2026-05-01 10:00+07', null, null
  );

select extensions.lives_ok(
  $$select private.rebuild_open_deductions_for_adjustment(
    '74000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    (
      select id
      from public.financial_transactions
      where profile_id = '74000000-0000-4000-8000-000000000001'
        and type = 'ADJUSTMENT'
        and status = 'PENDING'
        and cancelled_at is null
      order by created_at desc, id desc
      limit 1
    )
  )$$,
  'adjustment rebuild completes while cancelled debt history exists'
);

select extensions.is(
  (select count(*) from public.financial_transactions where id = '75000000-0000-4000-8000-000000000012'),
  1::bigint,
  'adjustment rebuild preserves deductions belonging to a cancelled debt'
);

select extensions.is(
  (select remaining_amount from public.financial_transactions where id = '75000000-0000-4000-8000-000000000011'),
  50::numeric,
  'adjustment rebuild does not mutate the balance of a cancelled debt'
);

select extensions.is(
  (select missing_months from private.time_payroll_missing_slip_months('2026-01-31 16:00:00+07') where profile_id = '74000000-0000-4000-8000-000000000005'),
  array['2026-01']::text[],
  'an unassigned employee still has a row-level missing month'
);

select extensions.is(
  (public.create_time_tracking_payroll_slip_internal_20260901(
    '74000000-0000-4000-8000-000000000005', '2026-01', false
  ) ->> 'net_pay')::numeric,
  15500::numeric,
  'payroll creation does not allocate a deduction from cancelled approved debt'
);

select extensions.is(
  (
    select count(*)
    from public.payroll_slips slip
    cross join lateral jsonb_array_elements(slip.slip_data -> 'transactions') transaction
    where slip.profile_id = '74000000-0000-4000-8000-000000000005'
      and slip.month = '2026-01'
      and transaction ->> 'id' = '75000000-0000-4000-8000-000000000010'
  ),
  0::bigint,
  'new slip snapshots omit deductions whose parent debt was cancelled'
);

insert into public.time_payroll_active_periods(
  profile_id, start_on, end_on, created_by, updated_by
) values (
  '74000000-0000-4000-8000-000000000006', '2026-01-01', '2026-02-28',
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'
);

insert into public.payroll_slips(
  profile_id, month, gross_pay, total_deductions, net_pay, total_days,
  daily_wage, slip_data, status, created_by, created_at
) values (
  '74000000-0000-4000-8000-000000000006', '2026-01', 15500, 0, 15500, 31,
  500, '{"transactions":[]}', 'REJECTED', '00000000-0000-4000-8000-000000000001',
  '2026-01-31 16:00+07'
);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, effective_date,
  created_at, cancelled_at, cancelled_by
) values (
  '75000000-0000-4000-8000-000000000008', '74000000-0000-4000-8000-000000000006',
  'DEBT', 100, 100, 'PENDING', '2026-01-01', '2026-01-01 09:00+07',
  '2026-01-01 10:00+07', '00000000-0000-4000-8000-000000000001'
);

select extensions.lives_ok(
  $$select public.create_time_tracking_payroll_slip(
    '74000000-0000-4000-8000-000000000006', '2026-01', false
  )$$,
  'a rejected slip does not block creating its missing month again'
);

delete from public.payroll_slips
where profile_id = '74000000-0000-4000-8000-000000000006'
  and month = '2026-01'
  and status in ('PENDING', 'APPROVED');

update public.payroll_slips
set status = 'PENDING',
    cancelled_at = '2026-01-31 16:01+07',
    cancelled_by = '00000000-0000-4000-8000-000000000001'
where profile_id = '74000000-0000-4000-8000-000000000006'
  and month = '2026-01'
  and status = 'REJECTED';

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, effective_date, created_at
) values (
  '75000000-0000-4000-8000-000000000014', '74000000-0000-4000-8000-000000000006',
  'DEBT', 100, 0, 'PENDING', '2026-01-15', '2026-01-15 09:00+07'
);

select extensions.lives_ok(
  $$select public.decide_time_tracking_approval(
    'transaction', '75000000-0000-4000-8000-000000000014', 'APPROVED', null, null
  )$$,
  'a cancelled slip does not block deciding a transaction in its reopened month'
);

select extensions.lives_ok(
  $$select public.create_time_tracking_payroll_slip(
    '74000000-0000-4000-8000-000000000006', '2026-01', false
  )$$,
  'a cancelled slip does not block creating its missing month again'
);

delete from public.payroll_slips
where profile_id = '74000000-0000-4000-8000-000000000006'
  and month = '2026-01'
  and cancelled_at is null;

select extensions.throws_ok(
  $$select public.create_time_tracking_payroll_slip(
    '74000000-0000-4000-8000-000000000006', '2026-02', false
  )$$,
  'P0001',
  'OLDER_WORK_MONTH:2026-01',
  'a rejected slip cannot let payroll creation skip the oldest missing work month'
);

insert into public.time_payroll_active_periods(
  profile_id, start_on, end_on, created_by, updated_by
) values (
  '74000000-0000-4000-8000-000000000007', '2026-06-01', '2026-06-30',
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'
);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, effective_date,
  expense_location_id, approved_by, approved_at, created_at, cancelled_at, cancelled_by
) values (
  '75000000-0000-4000-8000-000000000015', '74000000-0000-4000-8000-000000000007',
  'WITHDRAWAL', 500, 500, 'APPROVED', '2026-06-01',
  '73000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
  '2026-06-01 09:00+07', '2026-06-01 08:00+07', '2026-06-02 09:00+07',
  '00000000-0000-4000-8000-000000000001'
);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, parent_debt_id,
  effective_date, adjustment_base_amount, expense_location_id, created_at
) values (
  '75000000-0000-4000-8000-000000000016', '74000000-0000-4000-8000-000000000007',
  'ADJUSTMENT', 600, 0, 'PENDING', '75000000-0000-4000-8000-000000000015',
  '2026-06-01', 500, '73000000-0000-4000-8000-000000000001', '2026-06-01 10:00+07'
);

select extensions.is(
  (
    select missing_months
    from private.time_payroll_missing_slip_months('2026-06-30 16:00:00+07')
    where profile_id = '74000000-0000-4000-8000-000000000007'
  ),
  array['2026-06']::text[],
  'a pending adjustment under a cancelled withdrawal does not hide a missing payroll month'
);

select extensions.lives_ok(
  $$insert into public.payroll_slips(
    profile_id, month, gross_pay, total_deductions, net_pay, total_days,
    daily_wage, slip_data, status, created_by, created_at
  ) values (
    '74000000-0000-4000-8000-000000000007', '2026-06', 15000, 0, 15000, 30,
    500, '{"transactions":[]}', 'PENDING', '00000000-0000-4000-8000-000000000001',
    '2026-06-30 16:00+07'
  )$$,
  'a pending adjustment under a cancelled withdrawal does not block payroll creation'
);

select * from extensions.finish();
rollback;
