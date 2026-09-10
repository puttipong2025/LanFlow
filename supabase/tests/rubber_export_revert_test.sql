begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(19);

select extensions.has_function(
  'public', 'revert_rubber_export_to_draft', array['uuid'],
  'Rubber Export exposes one revert RPC'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.revert_rubber_export_to_draft(uuid)', 'execute'),
  'authenticated users can execute the revert RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.revert_rubber_export_to_draft(uuid)', 'execute'),
  'anonymous users cannot execute the revert RPC'
);
select extensions.is(
  regexp_count(
    pg_get_functiondef('public.revert_rubber_export_to_draft(uuid)'::regprocedure),
    'private\.can_manage_rubber_exports'
  ),
  2,
  'revert RPC rechecks live authority after waiting for the branch lock'
);

insert into public.locations (id, name, code, is_active)
values
  ('41000000-0000-4000-8000-000000000001', 'pgTAP Rubber Revert A', 'RRA', true),
  ('41000000-0000-4000-8000-000000000002', 'pgTAP Rubber Revert B', 'RRB', true);

insert into public.profiles (id, phone, name, role, is_active, can_manage_rubber_exports)
values (
  '42000000-0000-4000-8000-000000000001', '0894200001',
  'pgTAP Rubber Revert Manager', 'admin', true, true
);

insert into public.user_locations (user_id, location_id, is_primary)
values (
  '42000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001', true
);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  '43000000-0000-4000-8000-000000000001', 'RPT-REVERT-001', '2026-09-10', 1,
  '41000000-0000-4000-8000-000000000001', '2026-09-10 01:00:00+00',
  '42000000-0000-4000-8000-000000000001', 'pgTAP Rubber Revert Manager', '0894200001'
);

insert into public.rubber_bills (
  id, local_bill_no, server_bill_no, sync_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, rubber_value, average_price, deduction_total,
  net_total, created_by_user_id, created_by_name, created_by_phone
) values (
  '44000000-0000-4000-8000-000000000001', 'RB-REVERT-001', 'RB-REVERT-001', 'synced',
  '41000000-0000-4000-8000-000000000001', 'RB-REVERT-001', '2026-09-09',
  'ลูกค้าทดสอบ', 'ยางก้อนถ้วย', 100, 1000, 10, 0, 1000,
  '42000000-0000-4000-8000-000000000001', 'pgTAP Rubber Revert Manager', '0894200001'
);

insert into public.rubber_bill_items (
  bill_id, item_type, net_weight, quantity, unit, price, total
) values (
  '44000000-0000-4000-8000-000000000001', 'weigh', 100, 100, 'kg', 10, 1000
);

insert into public.report_items (id, report_id, location_id, entity_type, entity_id, eligibility_at)
values (
  '45000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'rubber_bill', '44000000-0000-4000-8000-000000000001', '2026-09-09 01:00:00+00'
);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price,
  current_weight, weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count,
  sold_out_at, sold_out_by_user_id, sold_out_by_name
) values
  (
    '46000000-0000-4000-8000-000000000001', 'REX-REVERT-MAIN', '2026-09-10', 1,
    '41000000-0000-4000-8000-000000000001', 'verified',
    100, 1000, 1000, 10, 90, 10, 2, 10, 210, 'branch',
    '42000000-0000-4000-8000-000000000001', 'ผู้สร้างเดิม', '0894200001',
    '42000000-0000-4000-8000-000000000001', 'ผู้ตรวจเดิม', '0894200001',
    '2026-09-10 02:00:00+00', '2026-09-10 02:00:00+00', 24, 48, 0,
    null, null, null
  ),
  (
    '46000000-0000-4000-8000-000000000002', 'REX-REVERT-FOREIGN', '2026-09-10', 1,
    '41000000-0000-4000-8000-000000000002', 'verified',
    100, 1000, 1000, 10, 90, 10, 2, 10, 210, 'external',
    '42000000-0000-4000-8000-000000000001', 'ผู้สร้างเดิม', '0894200001',
    '42000000-0000-4000-8000-000000000001', 'ผู้ตรวจเดิม', '0894200001',
    '2026-09-10 02:00:00+00', '2026-09-10 02:00:00+00', 24, 48, 0,
    null, null, null
  ),
  (
    '46000000-0000-4000-8000-000000000003', 'REX-REVERT-SOLD', '2026-09-10', 2,
    '41000000-0000-4000-8000-000000000001', 'verified',
    100, 1000, 1000, 10, 90, 10, 2, 10, 210, 'external',
    '42000000-0000-4000-8000-000000000001', 'ผู้สร้างเดิม', '0894200001',
    '42000000-0000-4000-8000-000000000001', 'ผู้ตรวจเดิม', '0894200001',
    '2026-09-10 02:00:00+00', '2026-09-10 02:00:00+00', 24, 48, 0,
    '2026-09-10 03:00:00+00', '42000000-0000-4000-8000-000000000001', 'ผู้ขาย'
  ),
  (
    '46000000-0000-4000-8000-000000000004', 'REX-REVERT-RECEIPT', '2026-09-10', 3,
    '41000000-0000-4000-8000-000000000001', 'verified',
    100, 1000, 1000, 10, 90, 10, 2, 10, 210, 'external',
    '42000000-0000-4000-8000-000000000001', 'ผู้สร้างเดิม', '0894200001',
    '42000000-0000-4000-8000-000000000001', 'ผู้ตรวจเดิม', '0894200001',
    '2026-09-10 02:00:00+00', '2026-09-10 02:00:00+00', 24, 48, 0,
    null, null, null
  ),
  (
    '46000000-0000-4000-8000-000000000005', 'REX-REVERT-LOCKED', '2026-09-10', 4,
    '41000000-0000-4000-8000-000000000001', 'verified',
    100, 1000, 1000, 10, 90, 10, 2, 10, 210, 'external',
    '42000000-0000-4000-8000-000000000001', 'ผู้สร้างเดิม', '0894200001',
    '42000000-0000-4000-8000-000000000001', 'ผู้ตรวจเดิม', '0894200001',
    '2026-09-10 02:00:00+00', '2026-09-10 02:00:00+00', 24, 48, 0,
    null, null, null
  ),
  (
    '46000000-0000-4000-8000-000000000006', 'REX-REVERT-DRAFT', '2026-09-10', 5,
    '41000000-0000-4000-8000-000000000001', 'draft',
    100, 1000, 1000, 10, null, null, null, 0, null, null,
    '42000000-0000-4000-8000-000000000001', 'ผู้สร้างเดิม', '0894200001',
    null, null, null, null, null, null, null, null,
    null, null, null
  );

insert into public.rubber_export_items (
  id, export_id, location_id, source_report_item_id, source_bill_id,
  bill_date, bill_no, customer_name, eligibility_at, net_weight,
  paid_amount, age_source_at, age_is_estimated, rubber_value_amount
) values (
  '47000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  '2026-09-09', 'RB-REVERT-001', 'ลูกค้าทดสอบ', '2026-09-09 01:00:00+00',
  100, 1000, '2026-09-09 01:00:00+00', false, 1000
);

insert into public.rubber_bills (
  id, local_bill_no, server_bill_no, sync_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, rubber_value, average_price, deduction_total,
  net_total, source_rubber_export_id, source_export_no, received_at,
  received_age_hours, received_age_is_estimated,
  created_by_user_id, created_by_name, created_by_phone
) values (
  '44000000-0000-4000-8000-000000000002',
  'RB-RECEIPT-001', 'RB-RECEIPT-001', 'synced',
  '41000000-0000-4000-8000-000000000001', 'RB-RECEIPT-001', '2026-09-10',
  'รับจากสาขา', 'ยางก้อนถ้วย', 100, 1000, 10, 1000, 0,
  '46000000-0000-4000-8000-000000000004', 'REX-REVERT-RECEIPT',
  '2026-09-10 04:00:00+00', 2, false,
  '42000000-0000-4000-8000-000000000001', 'pgTAP Rubber Revert Manager', '0894200001'
);

insert into public.report_items (id, report_id, location_id, entity_type, entity_id, eligibility_at)
values (
  '45000000-0000-4000-8000-000000000002',
  '43000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'rubber_export', '46000000-0000-4000-8000-000000000005', '2026-09-10 02:00:00+00'
);

set constraints all immediate;

select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated"}', true
);
set local role authenticated;

select extensions.is(
  (public.revert_rubber_export_to_draft('46000000-0000-4000-8000-000000000001')->>'status'),
  'draft', 'manager can revert an assigned verified export'
);

reset role;

select extensions.ok(
  (
    select status = 'draft' and previous_status is null
      and current_weight is null and weight_loss_percent is null and work_rate is null
      and other_operating_cost = 0 and work_total is null and expense_destination is null
      and verified_by_user_id is null and verified_by_name is null
      and verified_by_phone is null and verified_at is null
      and age_cutoff_at is null and average_age_hours is null
      and oldest_age_hours is null and estimated_age_item_count is null
    from public.rubber_exports
    where id = '46000000-0000-4000-8000-000000000001'
  ),
  'revert produces the canonical draft shape'
);

select extensions.ok(
  (
    select export_no = 'REX-REVERT-MAIN'
      and location_id = '41000000-0000-4000-8000-000000000001'
      and created_by_name = 'ผู้สร้างเดิม'
      and original_weight_total = 100 and paid_total = 1000
      and rubber_value_total = 1000 and average_price = 10
    from public.rubber_exports
    where id = '46000000-0000-4000-8000-000000000001'
  ) and (
    select count(*) = 1
    from public.rubber_export_items
    where export_id = '46000000-0000-4000-8000-000000000001'
      and source_bill_id = '44000000-0000-4000-8000-000000000001'
  ),
  'revert preserves identity, aggregate snapshots, and member rows'
);

select extensions.ok(
  not exists (
    select 1
    from private.reportable_items(
      '41000000-0000-4000-8000-000000000001', '2100-01-01 00:00:00+00'
    )
    where entity_type = 'rubber_export'
      and entity_id = '46000000-0000-4000-8000-000000000001'
  ),
  'reverted draft is no longer a report candidate'
);

select extensions.ok(
  not exists (
    select 1 from private.dashboard_money_event_projection
    where source_type = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000001'
  ) and exists (
    select 1 from public.dashboard_money_events
    where source_type = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000001'
      and action = 'delete' and amount = 210
  ),
  'revert removes the Dashboard projection and retains lifecycle history'
);

set local role authenticated;

select extensions.is(
  (public.revert_rubber_export_to_draft('46000000-0000-4000-8000-000000000001')->>'status'),
  'draft', 'revert retry is idempotent after authorization'
);
select extensions.throws_ok(
  $$select public.revert_rubber_export_to_draft('46000000-0000-4000-8000-000000000002')$$,
  'P0001', 'ไม่มีสิทธิ์ตรวจสอบรายการส่งออกของสาขานี้',
  'manager cannot revert another branch export'
);
select extensions.throws_like(
  $$select public.revert_rubber_export_to_draft('46000000-0000-4000-8000-000000000003')$$,
  'RUBBER_EXPORT_SOLD_OUT:%', 'sold export cannot be reverted'
);
select extensions.throws_like(
  $$select public.revert_rubber_export_to_draft('46000000-0000-4000-8000-000000000004')$$,
  'BRANCH_RECEIPT_SOURCE_LOCKED:%', 'received export cannot be reverted'
);
select extensions.throws_ok(
  $$select public.revert_rubber_export_to_draft('46000000-0000-4000-8000-000000000005')$$,
  'P0001', 'REPORT_LOCKED:RPT-REVERT-001', 'reported export cannot be reverted'
);
select extensions.lives_ok(
  $$select public.verify_rubber_export_atomic(
    '46000000-0000-4000-8000-000000000001', 85, 3, 5, 'branch'
  )$$,
  'reverted draft can be verified again'
);

reset role;

select extensions.ok(
  (
    select status = 'verified' and current_weight = 85 and work_rate = 3
      and other_operating_cost = 5 and work_total = 305
      and verified_by_user_id = '42000000-0000-4000-8000-000000000001'
      and verified_at is not null and age_cutoff_at is not null
    from public.rubber_exports
    where id = '46000000-0000-4000-8000-000000000001'
  ),
  're-verification stores a fresh verifier, timestamp, values, and age snapshot'
);

select extensions.ok(
  exists (
    select 1
    from private.reportable_items(
      '41000000-0000-4000-8000-000000000001', '2100-01-01 00:00:00+00'
    )
    where entity_type = 'rubber_export'
      and entity_id = '46000000-0000-4000-8000-000000000001'
  ) and exists (
    select 1 from private.dashboard_money_event_projection
    where source_type = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000001'
  ),
  're-verification restores the report candidate and Dashboard projection'
);

select extensions.throws_like(
  $$update public.rubber_exports
    set status = 'draft', current_weight = null
    where id = '46000000-0000-4000-8000-000000000003'$$,
  '%การย้อนเป็นฉบับร่างต้องล้างข้อมูลตรวจสอบทั้งหมด%',
  'state guard rejects a partial verified-to-draft transition'
);

select extensions.throws_like(
  $$update public.rubber_exports
    set status = 'draft', previous_status = null,
        current_weight = null, weight_loss_percent = null, work_rate = null,
        other_operating_cost = 0, work_total = null, expense_destination = null,
        verified_by_user_id = null, verified_by_name = null,
        verified_by_phone = null, verified_at = null,
        age_cutoff_at = null, average_age_hours = null,
        oldest_age_hours = null, estimated_age_item_count = null
    where id = '46000000-0000-4000-8000-000000000004'$$,
  'BRANCH_RECEIPT_SOURCE_LOCKED:%',
  'state guard blocks direct canonical revert when an active receipt exists'
);

select * from extensions.finish();

rollback;
