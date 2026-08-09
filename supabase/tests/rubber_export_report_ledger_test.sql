begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(12);

insert into public.locations (id, name, code, is_active)
values ('31000000-0000-4000-8000-000000000001', 'pgTAP Rubber Export', 'PREX', true);

insert into public.profiles (
  id, phone, name, role, is_active, can_access_super_admin_features
)
values (
  '32000000-0000-4000-8000-000000000001',
  '0893000001',
  'pgTAP Rubber Export Manager',
  'user',
  true,
  true
);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
)
values (
  '33000000-0000-4000-8000-000000000001',
  'REX-PGTAP-001',
  '2026-08-01',
  1,
  '31000000-0000-4000-8000-000000000001',
  'verified',
  100,
  1000,
  10,
  90,
  10,
  1,
  10,
  100,
  'branch',
  '32000000-0000-4000-8000-000000000001',
  'pgTAP Rubber Export Manager',
  '0893000001',
  '32000000-0000-4000-8000-000000000001',
  'pgTAP Rubber Export Manager',
  '0893000001',
  '2026-08-01 09:00:00+07',
  '2026-08-01 09:00:00+07', 0, 0, 0
);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone, created_at,
  opening_balance, closing_balance
)
values
  (
    '34000000-0000-4000-8000-000000000001', 'RPT-PGTAP-001', '2026-08-01', 1,
    '31000000-0000-4000-8000-000000000001', '2026-08-01 10:00:00+07', 'active',
    '32000000-0000-4000-8000-000000000001', 'pgTAP Rubber Export Manager', '0893000001',
    '2026-08-01 10:00:00+07', 999, 999
  ),
  (
    '34000000-0000-4000-8000-000000000002', 'RPT-PGTAP-002', '2026-08-02', 1,
    '31000000-0000-4000-8000-000000000001', '2026-08-02 10:00:00+07', 'deleted',
    '32000000-0000-4000-8000-000000000001', 'pgTAP Rubber Export Manager', '0893000001',
    '2026-08-02 10:00:00+07', 777, 888
  ),
  (
    '34000000-0000-4000-8000-000000000003', 'RPT-PGTAP-003', '2026-08-03', 1,
    '31000000-0000-4000-8000-000000000001', '2026-08-03 10:00:00+07', 'active',
    '32000000-0000-4000-8000-000000000001', 'pgTAP Rubber Export Manager', '0893000001',
    '2026-08-03 10:00:00+07', 999, 999
  );

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
)
values (
  '35000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'rubber_export',
  '33000000-0000-4000-8000-000000000001',
  '2026-08-01 09:00:00+07'
);

select extensions.is(
  (select count(*) from private.report_income_expense_period_rows('34000000-0000-4000-8000-000000000001')),
  1::bigint,
  'the canonical period helper includes one Rubber Export row'
);
select extensions.is(
  (select amount from private.report_income_expense_period_rows('34000000-0000-4000-8000-000000000001')),
  100::numeric,
  'the Rubber Export work total becomes the report expense amount'
);
select extensions.is(
  (select number from private.report_income_expense_period_rows('34000000-0000-4000-8000-000000000001')),
  'REX-PGTAP-001',
  'the report row keeps the Rubber Export number'
);

select private.rebuild_active_report_balance_chain('31000000-0000-4000-8000-000000000001');

select extensions.is(
  (select previous_report_id from public.report_batches where id = '34000000-0000-4000-8000-000000000001'),
  null::uuid,
  'the first active report has no previous report'
);
select extensions.is(
  (select opening_balance from public.report_batches where id = '34000000-0000-4000-8000-000000000001'),
  0::numeric,
  'the first active report opens at zero'
);
select extensions.is(
  (select closing_balance from public.report_batches where id = '34000000-0000-4000-8000-000000000001'),
  (-100)::numeric,
  'the first active report closes after the Rubber Export expense'
);
select extensions.is(
  (select previous_report_id from public.report_batches where id = '34000000-0000-4000-8000-000000000003'),
  '34000000-0000-4000-8000-000000000001'::uuid,
  'the next active report skips the deleted report'
);
select extensions.is(
  (select opening_balance from public.report_batches where id = '34000000-0000-4000-8000-000000000003'),
  (-100)::numeric,
  'the next active report carries the corrected closing balance'
);
select extensions.results_eq(
  $$select opening_balance, closing_balance from public.report_batches where id = '34000000-0000-4000-8000-000000000002'$$,
  $$values (777::numeric, 888::numeric)$$,
  'deleted report header snapshots are untouched'
);
select extensions.ok(
  to_regprocedure('public.verify_rubber_export(uuid,text)') is null,
  'the split verification RPC no longer exists'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.verify_rubber_export_atomic(uuid,numeric,numeric,numeric,text)',
    'execute'
  ),
  'authenticated callers can reach the atomic verification RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.verify_rubber_export_atomic(uuid,numeric,numeric,numeric,text)',
    'execute'
  ),
  'anonymous callers cannot reach the atomic verification RPC'
);

select * from extensions.finish();

rollback;
