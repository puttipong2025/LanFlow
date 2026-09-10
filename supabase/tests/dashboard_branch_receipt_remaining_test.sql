begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

insert into public.locations (id, name, code, is_active)
values
  ('31000000-0000-4000-8000-000000000001', 'pgTAP Dashboard receipt A', 'DRA', true),
  ('31000000-0000-4000-8000-000000000002', 'pgTAP Dashboard receipt B', 'DRB', true);

insert into public.profiles (
  id, phone, name, role, is_active, can_manage_rubber_exports
) values (
  '32000000-0000-4000-8000-000000000001', '0893200001',
  'pgTAP Dashboard receipt manager', 'admin', true, true
);

insert into public.user_locations (user_id, location_id, is_primary)
values (
  '32000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001', true
);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price,
  current_weight, weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
) values
  (
    '33000000-0000-4000-8000-000000000001', 'DASH-RECEIPT-SAME', current_date, 1,
    '31000000-0000-4000-8000-000000000001', 'verified',
    40, 800, 800, 20, 40, 0, 0, 0, 0, 'branch',
    '32000000-0000-4000-8000-000000000001', 'receipt manager', '0893200001',
    '32000000-0000-4000-8000-000000000001', 'receipt manager', '0893200001',
    current_timestamp, current_timestamp, 0, 0, 0
  ),
  (
    '33000000-0000-4000-8000-000000000002', 'DASH-RECEIPT-CROSS', current_date, 1,
    '31000000-0000-4000-8000-000000000002', 'verified',
    25, 600, 600, 24, 25, 0, 0, 0, 0, 'branch',
    '32000000-0000-4000-8000-000000000001', 'receipt manager', '0893200001',
    '32000000-0000-4000-8000-000000000001', 'receipt manager', '0893200001',
    current_timestamp, current_timestamp, 0, 0, 0
  );

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, rubber_value, average_price,
  deduction_total, net_total, source_rubber_export_id, source_export_no,
  received_at, received_age_hours, received_age_is_estimated,
  created_by_user_id, created_by_name, created_by_phone
) values
  (
    '34000000-0000-4000-8000-000000000001', 'DASH-RECEIPT-B1', 'DASH-RECEIPT-B1',
    'DASH-RECEIPT-B1', 'DASH-RECEIPT-B1', 'synced', 'active',
    '31000000-0000-4000-8000-000000000001', 'DASH-RECEIPT-B1', current_date,
    'same branch receipt', 'branch_receipt', 40, 800, 20, 800, 0,
    '33000000-0000-4000-8000-000000000001', 'DASH-RECEIPT-SAME',
    current_timestamp, 0, false,
    '32000000-0000-4000-8000-000000000001', 'receipt manager', '0893200001'
  ),
  (
    '34000000-0000-4000-8000-000000000002', 'DASH-RECEIPT-B2', 'DASH-RECEIPT-B2',
    'DASH-RECEIPT-B2', 'DASH-RECEIPT-B2', 'synced', 'active',
    '31000000-0000-4000-8000-000000000001', 'DASH-RECEIPT-B2', current_date,
    'cross branch receipt', 'branch_receipt', 25, 600, 24, 600, 0,
    '33000000-0000-4000-8000-000000000002', 'DASH-RECEIPT-CROSS',
    current_timestamp, 0, false,
    '32000000-0000-4000-8000-000000000001', 'receipt manager', '0893200001'
  );

insert into public.rubber_bill_items (
  bill_id, item_type, description, net_weight, price, total, sequence_no
) values
  ('34000000-0000-4000-8000-000000000001', 'weigh', 'same receipt', 40, 20, 800, 1),
  ('34000000-0000-4000-8000-000000000002', 'weigh', 'cross receipt', 25, 24, 600, 1);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone
) values (
  '35000000-0000-4000-8000-000000000001', 'DASH-RECEIPT-R1', current_date, 1,
  '31000000-0000-4000-8000-000000000001', current_timestamp,
  'active', '32000000-0000-4000-8000-000000000001', 'receipt manager', '0893200001'
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values (
  '36000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001', 'rubber_bill',
  '34000000-0000-4000-8000-000000000001', current_timestamp
);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price,
  current_weight, weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone
) values (
  '33000000-0000-4000-8000-000000000003', 'DASH-RECEIPT-DOWNSTREAM', current_date, 2,
  '31000000-0000-4000-8000-000000000001', 'draft',
  40, 0, 800, 20, null, null, null, 0, null, null,
  '32000000-0000-4000-8000-000000000001', 'receipt manager', '0893200001'
);

insert into public.rubber_export_items (
  export_id, location_id, source_report_item_id, source_bill_id, bill_date,
  bill_no, customer_name, eligibility_at, net_weight, paid_amount,
  rubber_value_amount, age_source_at, age_is_estimated
) values (
  '33000000-0000-4000-8000-000000000003',
  '31000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000001', current_date,
  'DASH-RECEIPT-B1', 'same branch receipt', current_timestamp,
  40, 0, 800, current_timestamp, false
);

set constraints all immediate;

create temporary table dashboard_receipts_initial on commit drop as
select private.calculate_dashboard_summary(
  '31000000-0000-4000-8000-000000000001'
) as summary;

select extensions.is((select (summary #>> '{rubberRemaining,billCount}')::integer from dashboard_receipts_initial), 2, 'draft downstream export keeps both receipts remaining');
select extensions.is((select (summary #>> '{rubberRemaining,netWeight}')::numeric from dashboard_receipts_initial), 65::numeric, 'remaining total includes same-branch and cross-branch weight');
select extensions.is((select (summary #>> '{rubberRemaining,rubberValue}')::numeric from dashboard_receipts_initial), 1400::numeric, 'remaining total includes carried receipt values');
select extensions.is((select (summary #>> '{rubberRemaining,averagePrice}')::numeric from dashboard_receipts_initial), 21.54::numeric, 'remaining average is weighted from combined carried value and weight');
select extensions.is((select (summary #>> '{rubberRemaining,deductionTotal}')::numeric from dashboard_receipts_initial), 0::numeric, 'synthetic receipt deductions do not become purchase deductions');
select extensions.is((select (summary #>> '{purchaseToday,billCount}')::integer from dashboard_receipts_initial), 0, 'receipts do not become customer purchases today');
select extensions.is((select (summary #>> '{purchase7Days,netWeight}')::numeric from dashboard_receipts_initial), 0::numeric, 'receipts do not enter seven-day purchase weight');
select extensions.is((select (summary #>> '{purchase7Days,paidTotal}')::numeric from dashboard_receipts_initial), 0::numeric, 'receipts do not enter seven-day purchase cost');
select extensions.is((select (summary #>> '{payablePurchaseAccumulated}')::numeric from dashboard_receipts_initial), 0::numeric, 'receipts do not become customer payables');
select extensions.is((select summary #>> '{operatingBurdenPercent}' from dashboard_receipts_initial), null, 'receipts do not create an operating-burden denominator');
select extensions.is((select (summary #>> '{cashToday,income}')::numeric from dashboard_receipts_initial), 0::numeric, 'receipts do not create cash income');
select extensions.is((select (summary #>> '{cashToday,expense}')::numeric from dashboard_receipts_initial), 0::numeric, 'receipts do not create cash expense');
select extensions.is((select (summary #>> '{netCashFlow}')::numeric from dashboard_receipts_initial), 0::numeric, 'receipts do not change accumulated cash flow');
select extensions.is((select (summary #>> '{rubberRemaining,branchReceipts,crossBranch,billCount}')::integer from dashboard_receipts_initial), 1, 'cross-branch breakdown counts one receipt');
select extensions.is((select (summary #>> '{rubberRemaining,branchReceipts,crossBranch,netWeight}')::numeric from dashboard_receipts_initial), 25::numeric, 'cross-branch breakdown exposes weight');
select extensions.is((select (summary #>> '{rubberRemaining,branchReceipts,crossBranch,rubberValue}')::numeric from dashboard_receipts_initial), 600::numeric, 'cross-branch breakdown exposes value');
select extensions.is((select (summary #>> '{rubberRemaining,branchReceipts,sameBranch,billCount}')::integer from dashboard_receipts_initial), 1, 'same-branch breakdown counts one receipt');
select extensions.is((select (summary #>> '{rubberRemaining,branchReceipts,sameBranch,netWeight}')::numeric from dashboard_receipts_initial), 40::numeric, 'same-branch breakdown exposes weight');
select extensions.is((select (summary #>> '{rubberRemaining,branchReceipts,sameBranch,rubberValue}')::numeric from dashboard_receipts_initial), 800::numeric, 'same-branch breakdown exposes value');

select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}', true
);
set local role authenticated;
select public.verify_rubber_export_atomic(
  '33000000-0000-4000-8000-000000000003', 38, 0, 0, 'branch'
);
reset role;

create temporary table dashboard_receipts_verified on commit drop as
select private.calculate_dashboard_summary(
  '31000000-0000-4000-8000-000000000001'
) as summary;

select extensions.is((select (summary #>> '{rubberRemaining,billCount}')::integer from dashboard_receipts_verified), 1, 'verified downstream export removes its receipt from remaining count');
select extensions.is((select (summary #>> '{rubberRemaining,netWeight}')::numeric from dashboard_receipts_verified), 25::numeric, 'verified downstream export removes its receipt weight');
select extensions.is((select (summary #>> '{rubberRemaining,branchReceipts,sameBranch,billCount}')::integer from dashboard_receipts_verified), 0, 'verified downstream export clears same-branch breakdown');

set local role authenticated;
select public.revert_rubber_export_to_draft('33000000-0000-4000-8000-000000000003');
reset role;

create temporary table dashboard_receipts_reverted on commit drop as
select private.calculate_dashboard_summary(
  '31000000-0000-4000-8000-000000000001'
) as summary;

select extensions.is((select (summary #>> '{rubberRemaining,billCount}')::integer from dashboard_receipts_reverted), 2, 'reverting downstream export restores its receipt count');
select extensions.is((select (summary #>> '{rubberRemaining,netWeight}')::numeric from dashboard_receipts_reverted), 65::numeric, 'reverting downstream export restores its receipt weight');

set local role authenticated;
select public.verify_rubber_export_atomic(
  '33000000-0000-4000-8000-000000000003', 38, 0, 0, 'branch'
);
reset role;

create temporary table dashboard_receipts_reverified on commit drop as
select private.calculate_dashboard_summary(
  '31000000-0000-4000-8000-000000000001'
) as summary;

select extensions.is((select (summary #>> '{rubberRemaining,netWeight}')::numeric from dashboard_receipts_reverified), 25::numeric, 'reverification removes the receipt weight again');
select extensions.is((select (summary #>> '{rubberRemaining,branchReceipts,sameBranch,billCount}')::integer from dashboard_receipts_reverified), 0, 'reverification removes the receipt from its breakdown again');

select * from extensions.finish();

rollback;
