begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(28);

select extensions.has_column('public', 'rubber_bills', 'source_rubber_export_id', 'receipt bill stores its source export');
select extensions.has_column('public', 'rubber_bills', 'received_age_hours', 'receipt bill snapshots age at receipt');
select extensions.has_column('public', 'rubber_export_items', 'carried_age_hours', 'next export snapshots carried age');
select extensions.has_function('public', 'get_receivable_rubber_exports', array['uuid'], 'candidate RPC exists');
select extensions.has_function('public', 'receive_rubber_export', array['uuid', 'uuid'], 'atomic receive RPC exists');

select extensions.is(
  private.rubber_export_item_age_hours(
    date '2026-08-08',
    timestamptz '2026-08-08 00:00:00+00',
    168,
    timestamptz '2026-08-10 06:00:00+00'
  ),
  222::numeric,
  '4 days source age plus 3 transit days plus 2 days 6 hours equals 9 days 6 hours'
);

insert into public.locations (id, name, code, is_active) values
  ('a1000000-0000-4000-8000-000000000001', 'สาขาต้นทางทดสอบ', 'BRS', true),
  ('a1000000-0000-4000-8000-000000000002', 'สาขาปลายทางทดสอบ', 'BRD', true),
  ('a1000000-0000-4000-8000-000000000003', 'สาขานอกสิทธิ์ทดสอบ', 'BRX', true);

insert into public.profiles (
  id, phone, name, role, is_active, can_access_super_admin_features
) values (
  'a2000000-0000-4000-8000-000000000001', '0995100001',
  'ผู้ทดสอบรับยางจากสาขา', 'user', true, false
);

insert into public.user_locations (user_id, location_id, is_primary) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', true);

insert into public.user_locations (user_id, location_id, is_primary) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', false);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
) values (
  'a3000000-0000-4000-8000-000000000001', 'REX-BRANCH-001',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date, 1,
  'a1000000-0000-4000-8000-000000000001', 'verified',
  120, 3600, 30, 100, 16.67, 1, 0, 120, 'branch',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001',
  clock_timestamp() - interval '3 days', clock_timestamp() - interval '3 days',
  96, 120, 1
);

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select extensions.throws_ok(
  $$select * from public.get_receivable_rubber_exports(
    'a1000000-0000-4000-8000-000000000003'
  )$$,
  'P0001',
  'ไม่มีสิทธิ์รับยางเข้าสาขานี้',
  'a user cannot receive into a branch outside their assignment'
);

reset role;
update public.profiles
set can_access_super_admin_features = true
where id = 'a2000000-0000-4000-8000-000000000001';
set local role authenticated;

select extensions.is(
  (select count(*) from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000002')
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'),
  1::bigint,
  'verified export from another active branch is selectable'
);

select extensions.is(
  public.receive_rubber_export(
    'a1000000-0000-4000-8000-000000000002',
    'a3000000-0000-4000-8000-000000000001'
  )->>'status',
  'received',
  'destination receives one export atomically'
);

select extensions.ok(
  (select
    source_export_no = 'REX-BRANCH-001'
    and weight = 100
    and rubber_value = 3600
    and deduction_total = 3600
    and net_total = 0
    and customer_name = 'รับยางจากสาขา สาขาต้นทางทดสอบ'
    and received_age_hours between 167.99 and 168.01
    and received_age_is_estimated
   from public.rubber_bills
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
     and record_status = 'active'),
  'receipt carries weight, value, compensated age and zero payable'
);

select extensions.results_eq(
  $$select item_type, total from public.rubber_bill_items
    where bill_id = (
      select id from public.rubber_bills
      where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
        and record_status = 'active'
    ) order by sequence_no$$,
  $$values ('weigh'::text, 3600::numeric), ('debt'::text, 3600::numeric)$$,
  'receipt has one weigh row and one matching debt deduction'
);

select extensions.is(
  (select count(*) from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000002')
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'),
  0::bigint,
  'received source disappears from the picker'
);

select extensions.throws_ok(
  $$select public.receive_rubber_export(
    'a1000000-0000-4000-8000-000000000002',
    'a3000000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'BRANCH_RECEIPT_ALREADY_EXISTS:REX-BRANCH-001',
  'the same source cannot be received twice while active'
);

select extensions.is(
  (select receipt_location_name from public.get_rubber_export_age_summaries(
    'a1000000-0000-4000-8000-000000000001'
  ) where export_id = 'a3000000-0000-4000-8000-000000000001'),
  'สาขาปลายทางทดสอบ',
  'source export summary exposes the destination receipt'
);

select extensions.is(
  public.get_rubber_export_age_detail('a3000000-0000-4000-8000-000000000001')
    ->'receivedBy'->>'billNo',
  (select server_bill_no from public.rubber_bills
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
     and record_status = 'active'),
  'source export detail exposes the destination bill number'
);

select extensions.throws_ok(
  $$select public.delete_rubber_export('a3000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'BRANCH_RECEIPT_SOURCE_LOCKED:REX-BRANCH-001',
  'source export deletion is blocked by the active receipt'
);

reset role;

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone,
  opening_balance, closing_balance
) values (
  'a4000000-0000-4000-8000-000000000001', 'RPT-BRANCH-001',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date, 1,
  'a1000000-0000-4000-8000-000000000002', clock_timestamp(), 'active',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001', 0, 0
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
)
select
  'a5000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'rubber_bill', id, received_at
from public.rubber_bills
where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
  and record_status = 'active';

set local role authenticated;

select extensions.is(
  (select count(*) from public.get_rubber_export_available_bills('a1000000-0000-4000-8000-000000000002')),
  1::bigint,
  'reported zero-pay receipt becomes an export candidate'
);

select extensions.is(
  (select paid_amount from public.get_rubber_export_available_bills('a1000000-0000-4000-8000-000000000002')),
  3600::numeric,
  'receipt export candidate uses carried rubber value as cost'
);

select extensions.is(
  (public.create_rubber_export(
    'a1000000-0000-4000-8000-000000000002',
    array['a5000000-0000-4000-8000-000000000001'::uuid]
  )->>'itemCount')::integer,
  1,
  'receipt can create the next rubber export draft'
);

select extensions.ok(
  (select carried_age_hours between 167.99 and 168.01
   from public.rubber_export_items
   where source_report_item_id = 'a5000000-0000-4000-8000-000000000001'),
  'next export snapshots receipt base age'
);

select extensions.ok(
  (select age_is_estimated
   from public.rubber_export_items
   where source_report_item_id = 'a5000000-0000-4000-8000-000000000001'),
  'next export preserves the receipt estimated-age flag'
);

select extensions.ok(
  (select average_age_hours >= 167.99
   from private.rubber_export_age_summary(
     (select export_id from public.rubber_export_items
      where source_report_item_id = 'a5000000-0000-4000-8000-000000000001'),
     clock_timestamp()
   )),
  'weighted age continues from the receipt base age'
);

reset role;

select extensions.is(
  (select count(*) from private.report_income_expense_period_rows('a4000000-0000-4000-8000-000000000001')),
  0::bigint,
  'receipt contributes no cash income or expense row'
);

select extensions.is(
  (select closing_balance from public.report_batches where id = 'a4000000-0000-4000-8000-000000000001'),
  0::numeric,
  'receipt leaves report money balance unchanged'
);

set local role authenticated;

select extensions.is(
  public.delete_rubber_export(
    (select export_id from public.rubber_export_items
     where source_report_item_id = 'a5000000-0000-4000-8000-000000000001')
  )->>'status',
  'deleted',
  'downstream export is removed first'
);

select extensions.is(
  public.delete_report_batch('a4000000-0000-4000-8000-000000000001')->>'status',
  'deleted',
  'report is removed after the downstream export'
);

select extensions.is(
  public.sync_rubber_bill(jsonb_build_object(
    'operation', 'delete',
    'clientTempId', (select client_temp_id from public.rubber_bills
      where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
        and record_status = 'active'),
    'locationId', 'a1000000-0000-4000-8000-000000000002',
    'expectedRevisionNo', (select revision_no from public.rubber_bills
      where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
        and record_status = 'active'),
    'idempotencyKey', 'delete-branch-receipt-test',
    'recordStatus', 'deleted',
    'deletedByName', 'ผู้ทดสอบ',
    'deletedByPhone', '0995100001'
  ))->>'status',
  'synced',
  'receipt uses the normal Rubber Bill delete workflow'
);

select extensions.is(
  (select count(*) from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000002')
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'),
  1::bigint,
  'source becomes selectable again after the receipt is deleted'
);

select * from extensions.finish();

rollback;
