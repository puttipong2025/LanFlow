begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(14);

insert into public.locations (id, name, code, is_active)
values ('23000000-0000-4000-8000-000000000001', 'pgTAP Dashboard metrics', 'PDM', true);

insert into public.profiles (id, phone, name, role, is_active)
values ('24000000-0000-4000-8000-000000000001', '0892400001', 'pgTAP metrics user', 'admin', true);

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, rubber_value, average_price,
  deduction_total, net_total, client_recorded_at, client_created_at,
  server_received_at, created_by_user_id, created_by_name, created_by_phone
) values
  (
    '25000000-0000-4000-8000-000000000001', 'PDM-B1', 'PDM-B1', 'PDM-B1', 'PDM-B1',
    'synced', 'active', '23000000-0000-4000-8000-000000000001', 'PDM-B1',
    (current_timestamp at time zone 'Asia/Bangkok')::date,
    'priced remaining', 'weighing', 100, 1000, 10, 100, 900,
    current_timestamp, current_timestamp, current_timestamp,
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  ),
  (
    '25000000-0000-4000-8000-000000000002', 'PDM-B2', 'PDM-B2', 'PDM-B2', 'PDM-B2',
    'synced', 'active', '23000000-0000-4000-8000-000000000001', 'PDM-B2',
    (current_timestamp at time zone 'Asia/Bangkok')::date,
    'verified export', 'weighing', 50, 1000, 20, 0, 1000,
    current_timestamp, current_timestamp, current_timestamp,
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  ),
  (
    '25000000-0000-4000-8000-000000000003', 'PDM-B3', 'PDM-B3', 'PDM-B3', 'PDM-B3',
    'synced', 'active', '23000000-0000-4000-8000-000000000001', 'PDM-B3',
    (current_timestamp at time zone 'Asia/Bangkok')::date,
    'unpriced', 'weighing', 30, 0, 0, 0, 0,
    current_timestamp, current_timestamp, current_timestamp,
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  ),
  (
    '25000000-0000-4000-8000-000000000004', 'PDM-B4', 'PDM-B4', 'PDM-B4', 'PDM-B4',
    'synced', 'active', '23000000-0000-4000-8000-000000000001', 'PDM-B4',
    (current_timestamp at time zone 'Asia/Bangkok')::date - 1,
    'draft export', 'weighing', 20, 300, 15, 0, 300,
    current_timestamp - interval '1 day', current_timestamp - interval '1 day',
    current_timestamp - interval '1 day',
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  ),
  (
    '25000000-0000-4000-8000-000000000005', 'PDM-B5', 'PDM-B5', 'PDM-B5', 'PDM-B5',
    'synced', 'active', '23000000-0000-4000-8000-000000000001', 'PDM-B5',
    (current_timestamp at time zone 'Asia/Bangkok')::date,
    'pending approval', 'weighing', 10, 100, 10, 0, 100,
    current_timestamp, current_timestamp, current_timestamp,
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  );

insert into public.rubber_bill_items (
  bill_id, item_type, description, net_weight, price, total, sequence_no
) values
  ('25000000-0000-4000-8000-000000000001', 'weigh', 'priced remaining', 100, 10, 1000, 1),
  ('25000000-0000-4000-8000-000000000002', 'weigh', 'verified export', 50, 20, 1000, 1),
  ('25000000-0000-4000-8000-000000000003', 'weigh', 'unpriced', 30, 0, 0, 1),
  ('25000000-0000-4000-8000-000000000004', 'weigh', 'draft export', 20, 15, 300, 1),
  ('25000000-0000-4000-8000-000000000005', 'weigh', 'pending approval', 10, 10, 100, 1);

insert into public.rubber_bill_approval_requests (
  id, operation, request_status, bill_id, location_id, client_temp_id,
  idempotency_key, base_revision_no, matched_reasons, edit_window_minutes_snapshot, original_payload,
  proposed_payload, requested_by_user_id, requested_by_name, requested_by_phone
) values (
  '26000000-0000-4000-8000-000000000001', 'update', 'pending',
  '25000000-0000-4000-8000-000000000005', '23000000-0000-4000-8000-000000000001',
  'PDM-B5', 'PDM-APPROVAL-B5', 0, array['price'], 30, '{}'::jsonb, '{}'::jsonb,
  '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone
) values
  (
    '27000000-0000-4000-8000-000000000001', 'PDM-R1',
    (current_timestamp at time zone 'Asia/Bangkok')::date, 1,
    '23000000-0000-4000-8000-000000000001', current_timestamp,
    'active', '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  ),
  (
    '27000000-0000-4000-8000-000000000002', 'PDM-R2',
    (current_timestamp at time zone 'Asia/Bangkok')::date, 2,
    '23000000-0000-4000-8000-000000000001', current_timestamp,
    'active', '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  );

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values
  (
    '28000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001', 'rubber_bill',
    '25000000-0000-4000-8000-000000000002', current_timestamp
  ),
  (
    '28000000-0000-4000-8000-000000000002',
    '27000000-0000-4000-8000-000000000002',
    '23000000-0000-4000-8000-000000000001', 'rubber_bill',
    '25000000-0000-4000-8000-000000000004', current_timestamp
  );

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
) values
  (
    '29000000-0000-4000-8000-000000000001', 'PDM-E1',
    (current_timestamp at time zone 'Asia/Bangkok')::date, 1,
    '23000000-0000-4000-8000-000000000001', 'verified',
    50, 1000, 20, 45, 10, 0, 0, 0, 'branch',
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001',
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001',
    current_timestamp, current_timestamp, 0, 0, 0
  ),
  (
    '29000000-0000-4000-8000-000000000002', 'PDM-E2',
    (current_timestamp at time zone 'Asia/Bangkok')::date, 2,
    '23000000-0000-4000-8000-000000000001', 'draft',
    20, 300, 15, null, null, null, 0, null, null,
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001',
    null, null, null, null, null, null, null, null
  );

insert into public.rubber_export_items (
  export_id, location_id, source_report_item_id, source_bill_id, bill_date,
  bill_no, customer_name, eligibility_at, net_weight, paid_amount,
  age_source_at, age_is_estimated
) values
  (
    '29000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001',
    '28000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000002',
    (current_timestamp at time zone 'Asia/Bangkok')::date,
    'PDM-B2', 'verified export', current_timestamp, 50, 1000, current_timestamp, false
  ),
  (
    '29000000-0000-4000-8000-000000000002', '23000000-0000-4000-8000-000000000001',
    '28000000-0000-4000-8000-000000000002', '25000000-0000-4000-8000-000000000004',
    (current_timestamp at time zone 'Asia/Bangkok')::date - 1,
    'PDM-B4', 'draft export', current_timestamp, 20, 300,
    current_timestamp - interval '1 day', false
  );

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, rubber_value, average_price,
  deduction_total, net_total, source_rubber_export_id, source_export_no,
  received_at, received_age_hours, received_age_is_estimated,
  created_by_user_id, created_by_name, created_by_phone
) values (
  '25000000-0000-4000-8000-000000000006', 'PDM-B6', 'PDM-B6', 'PDM-B6', 'PDM-B6',
  'synced', 'active', '23000000-0000-4000-8000-000000000001', 'PDM-B6',
  (current_timestamp at time zone 'Asia/Bangkok')::date,
  'branch receipt', 'branch_receipt', 40, 800, 20, 800, 0,
  '29000000-0000-4000-8000-000000000001', 'PDM-E1', current_timestamp, 0, false,
  '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
);

insert into public.rubber_bill_items (
  bill_id, item_type, description, net_weight, price, total, sequence_no
) values (
  '25000000-0000-4000-8000-000000000006', 'weigh', 'branch receipt', 40, 20, 800, 1
);

insert into public.income_expense (
  client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, type, number, tx_date,
  title, cost, bill_option, created_by_user_id, created_by_name, created_by_phone
) values
  (
    'PDM-I1', 'PDM-I1', 'PDM-I1', 'PDM-I1', 'synced', 'active',
    '23000000-0000-4000-8000-000000000001', 'income', 'PDM-I1',
    (current_timestamp at time zone 'Asia/Bangkok')::date,
    'income today', 500, 'รายรับ',
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  ),
  (
    'PDM-X1', 'PDM-X1', 'PDM-X1', 'PDM-X1', 'synced', 'active',
    '23000000-0000-4000-8000-000000000001', 'expense', 'PDM-X1',
    (current_timestamp at time zone 'Asia/Bangkok')::date,
    'expense today', 100, 'ค่าใช้จ่าย',
    '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
  );

insert into public.ocr_tickets (
  client_temp_id, idempotency_key, location_id, file_name, date_in,
  weight_in, weight_out, weight_net, total_amount, sync_status,
  record_status, created_by_user_id, created_by_name, created_by_phone
) values (
  'PDM-OCR-1', 'PDM-OCR-1', '23000000-0000-4000-8000-000000000001',
  'PDM-OCR-1.jpg', (current_timestamp at time zone 'Asia/Bangkok')::date,
  100, 90, 10, 777, 'synced', 'active',
  '24000000-0000-4000-8000-000000000001', 'pgTAP metrics user', '0892400001'
);

create temporary table dashboard_metrics_summary on commit drop as
select private.calculate_dashboard_summary(
  '23000000-0000-4000-8000-000000000001'
) as summary;

select extensions.is(
  (select (summary #>> '{purchaseToday,billCount}')::integer from dashboard_metrics_summary),
  4,
  'today counts customer purchase activity including a bill exported today'
);
select extensions.is(
  (select (summary #>> '{purchaseToday,netWeight}')::numeric from dashboard_metrics_summary),
  190::numeric,
  'today weight excludes branch-receipt bills'
);
select extensions.is(
  (select (summary #>> '{purchaseToday,averagePrice}')::numeric from dashboard_metrics_summary),
  13.13::numeric,
  'today weighted average excludes unpriced weight'
);
select extensions.is(
  (select (summary #>> '{purchaseToday,rubberValue}')::numeric from dashboard_metrics_summary),
  2100::numeric,
  'today rubber value includes only priced customer bills'
);
select extensions.is(
  (select (summary #>> '{purchaseToday,deductionTotal}')::numeric from dashboard_metrics_summary),
  100::numeric,
  'today deduction total is exposed'
);
select extensions.is(
  (select (summary #>> '{purchaseToday,unpricedBillCount}')::integer from dashboard_metrics_summary),
  1,
  'today reports unpriced bills'
);
select extensions.is(
  (select (summary #>> '{purchaseToday,pendingApprovalCount}')::integer from dashboard_metrics_summary),
  1,
  'today reports pending approvals'
);
select extensions.is(
  (select (summary #>> '{rubberRemaining,billCount}')::integer from dashboard_metrics_summary),
  4,
  'remaining accumulated bills exclude verified exports but retain draft exports'
);
select extensions.is(
  (select (summary #>> '{rubberRemaining,netWeight}')::numeric from dashboard_metrics_summary),
  160::numeric,
  'remaining accumulated weight excludes verified exports and branch receipts'
);
select extensions.is(
  (select (summary #>> '{rubberRemaining,averagePrice}')::numeric from dashboard_metrics_summary),
  10.77::numeric,
  'remaining weighted average excludes unpriced weight'
);
select extensions.is(
  (select (summary #>> '{cashToday,income}')::numeric from dashboard_metrics_summary),
  500::numeric,
  'today cash income uses the Bangkok business date'
);
select extensions.is(
  (select (summary #>> '{cashToday,net}')::numeric from dashboard_metrics_summary),
  (-1500)::numeric,
  'today cash net includes actual payable purchases and direct expenses but excludes OCR'
);

update public.rubber_bills
set record_status = 'deleted',
    deleted_at = current_timestamp,
    deleted_by_name = 'pgTAP metrics user',
    deleted_by_phone = '0892400001'
where id = '25000000-0000-4000-8000-000000000006';

update public.rubber_exports
set status = 'deleted',
    previous_status = 'verified',
    deleted_by_user_id = '24000000-0000-4000-8000-000000000001',
    deleted_by_name = 'pgTAP metrics user',
    deleted_by_phone = '0892400001',
    deleted_at = current_timestamp
where id = '29000000-0000-4000-8000-000000000001';

create temporary table dashboard_metrics_after_deleted_export on commit drop as
select private.calculate_dashboard_summary(
  '23000000-0000-4000-8000-000000000001'
) as summary;

select extensions.is(
  (select (summary #>> '{rubberRemaining,billCount}')::integer
   from dashboard_metrics_after_deleted_export),
  5,
  'deleting a verified export adds its source bill back to accumulated count'
);
select extensions.is(
  (select (summary #>> '{rubberRemaining,netWeight}')::numeric
   from dashboard_metrics_after_deleted_export),
  210::numeric,
  'deleting a verified export adds its source weight back to accumulated weight'
);

select * from extensions.finish();

rollback;
