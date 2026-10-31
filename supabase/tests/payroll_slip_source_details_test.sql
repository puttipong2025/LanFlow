begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations(id, name, code, is_active)
values ('93000000-0000-4000-8000-000000000001', 'Slip source branch', 'SLIPSRC', true);

insert into public.profiles(id, phone, name, role, is_active, daily_wage)
values ('94000000-0000-4000-8000-000000000001', '0894000001', 'Slip source employee', 'user', true, 500);

insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, parent_debt_id,
  effective_date, applied_month, approved_at, created_at, description
) values
  ('95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
   'DEBT', 6000, 0, 'APPROVED', null, '2026-09-05', null, '2026-09-05 10:00+07', '2026-09-05 10:00+07', 'ค่าซ่อมรถ'),
  ('95000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001',
   'DEBT_DEDUCTION', 4000, 0, 'APPROVED', '95000000-0000-4000-8000-000000000001',
   '2026-09-01', '2026-09-01', '2026-09-30 16:00+07', '2026-09-30 16:00+07', null),
  ('95000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000001',
   'DEBT_DEDUCTION', 2000, 0, 'APPROVED', '95000000-0000-4000-8000-000000000001',
   '2026-10-01', '2026-10-01', '2026-10-10 16:00+07', '2026-10-10 16:00+07', null),
  ('95000000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000001',
   'WITHDRAWAL', 7000, 4000, 'APPROVED', null, '2026-10-10', null, '2026-10-10 10:00+07', '2026-10-10 10:00+07', 'ค่าใช้จ่ายส่วนตัว'),
  ('95000000-0000-4000-8000-000000000005', '94000000-0000-4000-8000-000000000001',
   'WITHDRAWAL_DEDUCTION', 3000, 0, 'APPROVED', '95000000-0000-4000-8000-000000000004',
   '2026-10-01', '2026-10-01', '2026-10-10 16:00+07', '2026-10-10 16:00+07', null),
  ('95000000-0000-4000-8000-000000000006', '94000000-0000-4000-8000-000000000001',
   'DEBT', 100, 100, 'PENDING', null, '2026-10-10', null, null, '2026-10-10 10:00+07', 'pending source'),
  ('95000000-0000-4000-8000-000000000007', '94000000-0000-4000-8000-000000000001',
   'DEBT', 100, 100, 'APPROVED', null, '2026-11-01', null, '2026-10-10 10:00+07', '2026-10-10 10:00+07', 'future source');

insert into public.payroll_slips(
  id, profile_id, month, gross_pay, total_deductions, net_pay,
  total_days, daily_wage, slip_data, status, created_by, created_at
) values (
  '96000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001',
  '2026-10', 5000, 5000, 0, 10, 500, '{"transactions":[]}', 'PENDING',
  '00000000-0000-4000-8000-000000000001', '2026-10-31 16:00+07'
);

select extensions.is(
  (select slip_data -> 'outstandingSources' from public.payroll_slips where id = '96000000-0000-4000-8000-000000000001'),
  '[{"id":"95000000-0000-4000-8000-000000000001","type":"DEBT","status":"APPROVED","effective_date":"2026-09-05","description":"ค่าซ่อมรถ","amount":2000,"carried_forward":true},
    {"id":"95000000-0000-4000-8000-000000000004","type":"WITHDRAWAL","status":"APPROVED","effective_date":"2026-10-10","description":"ค่าใช้จ่ายส่วนตัว","amount":7000,"carried_forward":false}]'::jsonb,
  'slip saves the carried balance, original details and current-month withdrawal once; excludes pending/future sources'
);

select extensions.is(
  (select sum((item ->> 'amount')::numeric)
   from public.payroll_slips slip,
     jsonb_array_elements(slip.slip_data -> 'outstandingSources') item
   where slip.id = '96000000-0000-4000-8000-000000000001'),
  (select (slip_data -> 'outstandingAdjustments' ->> 'beforeDeductions')::numeric
   from public.payroll_slips where id = '96000000-0000-4000-8000-000000000001'),
  'detail amounts reconcile with the existing authoritative outstanding aggregate'
);

select extensions.is(
  private.time_payroll_slip_source_snapshot('94000000-0000-4000-8000-000000000001', '2026-11', '2026-10-31 09:00+07') -> 0 ->> 'id',
  '95000000-0000-4000-8000-000000000004',
  'fully settled old debt is omitted in the following month'
);

-- A later approved adjustment and deduction must not alter an older snapshot.
insert into public.financial_transactions(
  id, profile_id, type, amount, remaining_amount, status, parent_debt_id,
  effective_date, applied_month, approved_at, created_at, adjustment_base_amount,
  expense_location_id
) values
  ('95000000-0000-4000-8000-000000000008', '94000000-0000-4000-8000-000000000001',
   'ADJUSTMENT', 8000, 0, 'APPROVED', '95000000-0000-4000-8000-000000000004',
   '2026-11-01', null, '2026-11-01 10:00+07', '2026-11-01 10:00+07', 7000,
   '93000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000009', '94000000-0000-4000-8000-000000000001',
   'WITHDRAWAL_DEDUCTION', 1000, 0, 'APPROVED', '95000000-0000-4000-8000-000000000004',
   '2026-11-01', '2026-11-01', '2026-11-01 10:00+07', '2026-11-01 10:00+07', null, null);

select extensions.is(
  (select slip_data -> 'outstandingSources' from public.payroll_slips where id = '96000000-0000-4000-8000-000000000001'),
  private.time_payroll_slip_source_snapshot('94000000-0000-4000-8000-000000000001', '2026-10', '2026-10-31 16:00+07'),
  'future adjustments and deductions do not change historical display amounts'
);

select extensions.is(
  (select item ->> 'amount'
   from jsonb_array_elements(private.time_payroll_slip_source_snapshot(
     '94000000-0000-4000-8000-000000000001', '2026-11', '2026-11-02 16:00+07')) item
   where item ->> 'id' = '95000000-0000-4000-8000-000000000004'),
  '5000.00',
  'next month uses the adjusted target minus previously paid deductions, never the original face amount'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.time_payroll_slip_source_snapshot(uuid,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.time_payroll_slip_source_snapshot(uuid,text,timestamptz)', 'EXECUTE'),
  'private snapshot helper cannot expose employee data to direct callers'
);

select * from extensions.finish();
rollback;
