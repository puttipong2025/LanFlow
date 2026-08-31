begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(69);

select extensions.has_column('public', 'rubber_bills', 'source_rubber_export_id', 'receipt bill stores its source export');
select extensions.has_column('public', 'rubber_bills', 'received_age_hours', 'receipt bill snapshots age at receipt');
select extensions.has_column('public', 'rubber_export_items', 'carried_age_hours', 'next export snapshots carried age');
select extensions.has_column('public', 'rubber_exports', 'rubber_value_total', 'export snapshots total rubber value');
select extensions.has_column('public', 'rubber_export_items', 'rubber_value_amount', 'export item snapshots rubber value');
select extensions.has_function('public', 'get_receivable_rubber_exports', array['uuid'], 'candidate RPC exists');
select extensions.has_function('public', 'receive_rubber_export', array['uuid', 'uuid'], 'atomic receive RPC exists');
select extensions.has_column('public', 'rubber_exports', 'sold_out_at', 'export stores the current sold-out timestamp');
select extensions.has_column('public', 'rubber_exports', 'sold_out_by_user_id', 'export stores the current sold-out actor');
select extensions.has_column('public', 'rubber_exports', 'sold_out_by_name', 'export stores the current sold-out actor name');
select extensions.has_function('public', 'set_rubber_export_sold_out', array['uuid', 'boolean'], 'sold-out toggle RPC exists');
select extensions.has_function('public', 'replace_rubber_export_items', array['uuid', 'uuid[]'], 'draft membership replacement RPC exists');

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
  original_weight_total, paid_total, rubber_value_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
) values (
  'a3000000-0000-4000-8000-000000000001', 'REX-BRANCH-001',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date, 1,
  'a1000000-0000-4000-8000-000000000001', 'verified',
  120, 3600, 3600, 30, 100, 16.67, 1, 0, 120, 'branch',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001',
  clock_timestamp() - interval '3 days', clock_timestamp() - interval '3 days',
  96, 120, 1
);

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, deduct_weight, rubber_value,
  average_price, net_total, client_created_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  'a3100000-0000-4000-8000-000000000001', 'BRS-SOURCE-001',
  'BRS-SOURCE-001', 'BRS-SOURCE-001', 'BRS-SOURCE-001',
  'synced', 'active', 'a1000000-0000-4000-8000-000000000001',
  'BRS-SOURCE-001', ((clock_timestamp() - interval '3 days') at time zone 'Asia/Bangkok')::date,
  'ลูกค้าต้นทางทดสอบ', 'small', 120, 0, 3600, 30, 3600,
  clock_timestamp() - interval '3 days',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001'
);

insert into public.rubber_bill_items (
  bill_id, item_type, net_weight, quantity, unit, price, total
) values (
  'a3100000-0000-4000-8000-000000000001', 'weigh', 120, 120, 'kg', 30, 3600
);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone,
  opening_balance, closing_balance, created_at
) values (
  'a3200000-0000-4000-8000-000000000001', 'RPT-BRS-SOURCE-001',
  ((clock_timestamp() - interval '3 days') at time zone 'Asia/Bangkok')::date, 1,
  'a1000000-0000-4000-8000-000000000001', clock_timestamp() - interval '3 days',
  'active', 'a2000000-0000-4000-8000-000000000001',
  'ผู้ทดสอบ', '0995100001', 0, 0, clock_timestamp() - interval '2 days'
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values (
  'a3300000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'rubber_bill',
  'a3100000-0000-4000-8000-000000000001', clock_timestamp() - interval '3 days'
);

insert into public.rubber_export_items (
  export_id, location_id, source_report_item_id, source_bill_id, bill_date,
  bill_no, customer_name, eligibility_at, net_weight, paid_amount, rubber_value_amount,
  age_source_at, age_is_estimated, carried_age_hours
) select
  'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a3300000-0000-4000-8000-000000000001',
  'a3100000-0000-4000-8000-000000000001', b.bill_date,
  'BRS-SOURCE-001', 'ลูกค้าต้นทางทดสอบ', e.verified_at,
  120, 3600, 3600, e.verified_at, true, 96
from public.rubber_exports e
join public.rubber_bills b on b.id = 'a3100000-0000-4000-8000-000000000001'
where e.id = 'a3000000-0000-4000-8000-000000000001';

set constraints dashboard_money_event_rubber_exports immediate;
set constraints dashboard_money_event_rubber_exports deferred;
create temporary table money_event_count_before_sale as
select count(*)::bigint as event_count
from public.dashboard_money_events
where source_type = 'rubber_export'
  and source_id = 'a3000000-0000-4000-8000-000000000001';

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
set role = 'admin',
    can_access_super_admin_features = true
where id = 'a2000000-0000-4000-8000-000000000001';
set local role authenticated;

select extensions.ok(
  (select average_age_hours between 167.99 and 168.01
   from public.get_rubber_export_age_summaries('a1000000-0000-4000-8000-000000000001')
   where export_id = 'a3000000-0000-4000-8000-000000000001'),
  'verified unsold export exposes its live age'
);

select extensions.is(
  public.set_rubber_export_sold_out(
    'a3000000-0000-4000-8000-000000000001', true
  )->>'status',
  'sold_out',
  'verified export can be marked sold out'
);

reset role;
set constraints dashboard_money_event_rubber_exports immediate;
set constraints dashboard_money_event_rubber_exports deferred;

select extensions.is(
  (select count(*)::bigint
   from public.dashboard_money_events
   where source_type = 'rubber_export'
     and source_id = 'a3000000-0000-4000-8000-000000000001'),
  (select event_count from money_event_count_before_sale),
  'sold-out metadata does not emit a dashboard money event'
);

set local role authenticated;

select extensions.is(
  (select average_age_hours
   from public.get_rubber_export_age_summaries('a1000000-0000-4000-8000-000000000001')
   where export_id = 'a3000000-0000-4000-8000-000000000001'),
  96::numeric,
  'sold export returns its official frozen age instead of live age'
);

select extensions.ok(
  (select sold_out_at is not null
     and sold_out_by_user_id = 'a2000000-0000-4000-8000-000000000001'
     and sold_out_by_name = 'ผู้ทดสอบรับยางจากสาขา'
   from public.rubber_exports
   where id = 'a3000000-0000-4000-8000-000000000001'),
  'sold-out marker stores the current actor and timestamp'
);

select extensions.is(
  (select count(*) from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000002')
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'),
  0::bigint,
  'sold export disappears from the receipt picker'
);

select extensions.throws_ok(
  $$select public.receive_rubber_export(
    'a1000000-0000-4000-8000-000000000002',
    'a3000000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'BRANCH_RECEIPT_SOURCE_STALE:REX-BRANCH-001',
  'sold export cannot be received'
);

select extensions.throws_ok(
  $$select public.delete_rubber_export('a3000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'RUBBER_EXPORT_SOLD_OUT:REX-BRANCH-001',
  'sold export cannot be deleted'
);

select extensions.is(
  public.set_rubber_export_sold_out(
    'a3000000-0000-4000-8000-000000000001', false
  )->>'status',
  'verified',
  'sold-out marker can be cancelled'
);

select extensions.is(
  (select count(*) from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000002')
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'),
  1::bigint,
  'cancelled sale returns the export to the receipt picker'
);

select extensions.is(
  (select count(*) from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000002')
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'),
  1::bigint,
  'verified export from another active branch is selectable'
);

select extensions.is(
  (select rubber_value from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000002')
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'),
  3720::numeric,
  'receipt candidate adds work cost to rubber value rather than paid total'
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
    and rubber_value = 3720
    and deduction_total = 3720
    and net_total = 0
    and customer_name = 'รับยางจากสาขา สาขาต้นทางทดสอบ'
    and received_age_hours between 167.99 and 168.01
    and received_age_is_estimated
   from public.rubber_bills
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
     and record_status = 'active'),
  'receipt carries weight, value, compensated age and zero payable'
);

select extensions.is(
  (select average_price from public.rubber_bills
   where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
     and record_status = 'active'),
  37.2::numeric,
  'receipt average uses carried rubber value divided by current weight'
);

select extensions.results_eq(
  $$select item_type, total from public.rubber_bill_items
    where bill_id = (
      select id from public.rubber_bills
      where source_rubber_export_id = 'a3000000-0000-4000-8000-000000000001'
        and record_status = 'active'
    ) order by sequence_no$$,
  $$values ('weigh'::text, 3720::numeric), ('debt'::text, 3720::numeric)$$,
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

select extensions.throws_ok(
  $$select public.set_rubber_export_sold_out(
    'a3000000-0000-4000-8000-000000000001', true
  )$$,
  'P0001',
  'BRANCH_RECEIPT_SOURCE_LOCKED:REX-BRANCH-001',
  'received export cannot be marked sold out'
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

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, deduct_weight, rubber_value,
  average_price, net_total, client_created_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  'a6000000-0000-4000-8000-000000000001', 'SAME-BRANCH-SOURCE',
  'SAME-BRANCH-SOURCE', 'SAME-BRANCH-SOURCE', 'SAME-BRANCH-SOURCE',
  'synced', 'active', 'a1000000-0000-4000-8000-000000000002',
  'SAME-BRANCH-SOURCE', (clock_timestamp() at time zone 'Asia/Bangkok')::date,
  'ลูกค้าสาขาปัจจุบัน', 'small', 50, 0, 1500, 30, 1500,
  clock_timestamp() - interval '1 day',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001'
);

insert into public.rubber_bill_items (
  bill_id, item_type, net_weight, quantity, unit, price, total
) values (
  'a6000000-0000-4000-8000-000000000001', 'weigh', 50, 50, 'kg', 30, 1500
);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone,
  opening_balance, closing_balance, created_at
) values (
  'a6300000-0000-4000-8000-000000000001', 'RPT-SAME-BRANCH-001',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date, 2,
  'a1000000-0000-4000-8000-000000000002', clock_timestamp() - interval '1 day',
  'active', 'a2000000-0000-4000-8000-000000000001',
  'ผู้ทดสอบ', '0995100001', 0, 0, clock_timestamp() - interval '2 days'
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values (
  'a6100000-0000-4000-8000-000000000001',
  'a6300000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002', 'rubber_bill',
  'a6000000-0000-4000-8000-000000000001', clock_timestamp() - interval '1 day'
);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
) values (
  'a6200000-0000-4000-8000-000000000001', 'REX-SAME-BRANCH-001',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date, 2,
  'a1000000-0000-4000-8000-000000000002', 'verified',
  50, 1500, 1500, 30, 45, 10, 1, 0, 50, 'branch',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001',
  clock_timestamp() - interval '12 hours', clock_timestamp() - interval '12 hours',
  36, 36, 0
);

-- This manual export fixture bypasses create_rubber_export, so mirror its
-- sequence in the durable allocator before later RPC-created exports.
insert into private.document_number_counters (
  document_kind, location_id, document_date, last_sequence_no
) values (
  'REX', 'a1000000-0000-4000-8000-000000000002',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date, 2
)
on conflict (document_kind, location_id, document_date)
do update set last_sequence_no = greatest(
  private.document_number_counters.last_sequence_no,
  excluded.last_sequence_no
), updated_at = clock_timestamp();

insert into public.rubber_export_items (
  export_id, location_id, source_report_item_id, source_bill_id, bill_date,
  bill_no, customer_name, eligibility_at, net_weight, paid_amount, rubber_value_amount,
  age_source_at, age_is_estimated, carried_age_hours
) values (
  'a6200000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a6100000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date,
  'SAME-BRANCH-SOURCE', 'ลูกค้าสาขาปัจจุบัน', clock_timestamp() - interval '1 day',
  50, 1500, 1500, clock_timestamp() - interval '12 hours', false, 36
);

set local role authenticated;

select extensions.is(
  (select count(*) from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000002')
   where source_rubber_export_id = 'a6200000-0000-4000-8000-000000000001'),
  1::bigint,
  'verified export from the current branch is selectable'
);

select extensions.is(
  public.receive_rubber_export(
    'a1000000-0000-4000-8000-000000000002',
    'a6200000-0000-4000-8000-000000000001'
  )->>'status',
  'received',
  'current branch receives its own remaining rubber atomically'
);

select extensions.is(
  (select customer_name from public.rubber_bills
   where source_rubber_export_id = 'a6200000-0000-4000-8000-000000000001'
     and record_status = 'active'),
  'ยางคงเหลือภายในสาขา',
  'same-branch receipt uses the agreed synthetic customer name'
);

select extensions.is(
  (select count(*) from public.get_rubber_export_available_bills('a1000000-0000-4000-8000-000000000002')),
  1::bigint,
  'reported zero-pay receipt becomes an export candidate'
);

select extensions.is(
  (select paid_amount from public.get_rubber_export_available_bills('a1000000-0000-4000-8000-000000000002')),
  3720::numeric,
  'receipt export candidate uses carried rubber and work cost'
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

select extensions.is(
  (public.preview_rubber_export(
    'a1000000-0000-4000-8000-000000000002',
    array['a5000000-0000-4000-8000-000000000001'::uuid],
    (select export_id from public.rubber_export_items
     where source_report_item_id = 'a5000000-0000-4000-8000-000000000001')
  )->>'itemCount')::integer,
  1,
  'edit preview accepts the current draft reservation'
);

select public.update_rubber_export(
  (select export_id from public.rubber_export_items
   where source_report_item_id = 'a5000000-0000-4000-8000-000000000001'),
  90, 2, 25
);

reset role;

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, deduct_weight, rubber_value,
  average_price, net_total, client_created_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  'a7000000-0000-4000-8000-000000000001', 'EDIT-ALTERNATE',
  'EDIT-ALTERNATE', 'EDIT-ALTERNATE', 'EDIT-ALTERNATE',
  'synced', 'active', 'a1000000-0000-4000-8000-000000000002',
  'EDIT-ALTERNATE', (clock_timestamp() at time zone 'Asia/Bangkok')::date,
  'ลูกค้าสำหรับแก้รายการ', 'small', 80, 0, 2400, 30, 2400,
  clock_timestamp() - interval '6 hours',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001'
);

insert into public.rubber_bill_items (
  bill_id, item_type, net_weight, quantity, unit, price, total
) values (
  'a7000000-0000-4000-8000-000000000001', 'weigh', 80, 80, 'kg', 30, 2400
);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone,
  opening_balance, closing_balance, created_at
) values (
  'a7200000-0000-4000-8000-000000000001', 'RPT-EDIT-ALTERNATE',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date, 3,
  'a1000000-0000-4000-8000-000000000002', clock_timestamp() - interval '6 hours',
  'active', 'a2000000-0000-4000-8000-000000000001',
  'ผู้ทดสอบ', '0995100001', 0, 0, clock_timestamp() - interval '1 day'
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values (
  'a7100000-0000-4000-8000-000000000001',
  'a7200000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002', 'rubber_bill',
  'a7000000-0000-4000-8000-000000000001', clock_timestamp() - interval '6 hours'
);

set local role authenticated;

select extensions.is(
  public.replace_rubber_export_items(
    (select export_id from public.rubber_export_items
     where source_report_item_id = 'a5000000-0000-4000-8000-000000000001'),
    array['a7100000-0000-4000-8000-000000000001'::uuid]
  )->>'status',
  'draft',
  'draft membership is replaced atomically'
);

select extensions.ok(
  (select original_weight_total = 80
     and paid_total = 2400
     and current_weight is null
     and work_rate is null
     and other_operating_cost = 0
     and work_total is null
   from public.rubber_exports
   where id = (select export_id from public.rubber_export_items
     where source_report_item_id = 'a7100000-0000-4000-8000-000000000001')),
  'membership replacement recalculates totals and resets operational inputs'
);

select extensions.is(
  (select count(*) from public.get_rubber_export_available_bills('a1000000-0000-4000-8000-000000000002')
   where report_item_id = 'a5000000-0000-4000-8000-000000000001'),
  1::bigint,
  'bill removed from the draft is unlocked'
);

select extensions.is(
  public.replace_rubber_export_items(
    (select export_id from public.rubber_export_items
     where source_report_item_id = 'a7100000-0000-4000-8000-000000000001'),
    array['a5000000-0000-4000-8000-000000000001'::uuid]
  )->>'status',
  'draft',
  'draft can replace its membership again'
);

select extensions.is(
  (select count(*) from public.get_rubber_export_available_bills('a1000000-0000-4000-8000-000000000002')
   where report_item_id = 'a7100000-0000-4000-8000-000000000001'),
  1::bigint,
  'second removed bill is unlocked'
);

select extensions.throws_ok(
  $$select public.replace_rubber_export_items(
    (select export_id from public.rubber_export_items
     where source_report_item_id = 'a5000000-0000-4000-8000-000000000001'),
    array[]::uuid[]
  )$$,
  'P0001',
  'RUBBER_EXPORT_SELECTION_EMPTY: กรุณาเลือกบิลอย่างน้อย 1 ใบ',
  'replacement rejects an empty member set'
);

select extensions.is(
  (select count(*) from public.rubber_export_items
   where export_id = (select export_id from public.rubber_export_items
     where source_report_item_id = 'a5000000-0000-4000-8000-000000000001')),
  1::bigint,
  'failed replacement rolls back and preserves the previous member set'
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

reset role;

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone,
  opening_balance, closing_balance
) values (
  'a7300000-0000-4000-8000-000000000001', 'RPT-MULTI-HOP-B',
  (clock_timestamp() at time zone 'Asia/Bangkok')::date, 4,
  'a1000000-0000-4000-8000-000000000002', clock_timestamp(), 'active',
  'a2000000-0000-4000-8000-000000000001', 'ผู้ทดสอบ', '0995100001', 0, 0
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
)
select 'a7400000-0000-4000-8000-000000000001',
  'a7300000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002', 'rubber_bill', b.id, b.received_at
from public.rubber_bills b
where b.source_rubber_export_id = 'a6200000-0000-4000-8000-000000000001'
  and b.record_status = 'active';

set local role authenticated;

create temporary table multi_hop_export_result on commit drop as
select public.create_rubber_export(
  'a1000000-0000-4000-8000-000000000002',
  array['a7400000-0000-4000-8000-000000000001'::uuid]
) result;

select extensions.is(
  (select (result->>'itemCount')::integer from multi_hop_export_result),
  1,
  'multi-hop receipt creates Export B'
);

select extensions.ok(
  (select paid_total = 1550 and rubber_value_total = 1550 and average_price = 34.44
   from public.rubber_exports
   where id = (select (result->>'id')::uuid from multi_hop_export_result)),
  'Export B carries Receipt B value without re-adding Export A work'
);

reset role;
update public.profiles
set role = 'admin',
    can_access_super_admin_features = true
where id = 'a2000000-0000-4000-8000-000000000001';
set local role authenticated;

select extensions.is(
  public.verify_rubber_export_atomic(
    (select (result->>'id')::uuid from multi_hop_export_result),
    40, 2, 20, 'branch'
  )->>'status',
  'verified',
  'Export B verifies atomically before the second receipt'
);

select extensions.is(
  (select work_total from public.rubber_exports
   where id = (select (result->>'id')::uuid from multi_hop_export_result)),
  110::numeric,
  'Export B adds work once from original weight 45 kg'
);

select extensions.is(
  public.receive_rubber_export(
    'a1000000-0000-4000-8000-000000000001',
    (select (result->>'id')::uuid from multi_hop_export_result)
  )->>'status',
  'received',
  'destination C receives Export B atomically'
);

select extensions.ok(
  (select rubber_value = 1660 and deduction_total = 1660 and net_total = 0
      and average_price = 41.50
   from public.rubber_bills
   where source_rubber_export_id = (select (result->>'id')::uuid from multi_hop_export_result)
     and record_status = 'active'),
  'Receipt C equals Receipt B value plus Export B work and remains zero-payable'
);

select extensions.is(
  (select total from public.rubber_bill_items
   where bill_id = (select id from public.rubber_bills
     where source_rubber_export_id = (select (result->>'id')::uuid from multi_hop_export_result)
       and record_status = 'active') and item_type = 'weigh'),
  1660::numeric,
  'Receipt C weigh row uses the compounded carrying value'
);

select extensions.is(
  (select total from public.rubber_bill_items
   where bill_id = (select id from public.rubber_bills
     where source_rubber_export_id = (select (result->>'id')::uuid from multi_hop_export_result)
       and record_status = 'active') and item_type = 'debt'),
  1660::numeric,
  'Receipt C debt row offsets the compounded carrying value'
);

select extensions.ok(
  (select rubber_value = 1550 and deduction_total = 1550 and net_total = 0
   from public.rubber_bills
   where source_rubber_export_id = 'a6200000-0000-4000-8000-000000000001'
     and record_status = 'active'),
  'Receipt B remains unchanged after the next hop'
);

select extensions.is(
  (select count(*) from public.get_receivable_rubber_exports('a1000000-0000-4000-8000-000000000001')
   where source_rubber_export_id = (select (result->>'id')::uuid from multi_hop_export_result)),
  0::bigint,
  'Export B is no longer receivable after Receipt C exists'
);

select * from extensions.finish();

rollback;
