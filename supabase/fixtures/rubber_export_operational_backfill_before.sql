-- Fixture applied after 20260810020000 and before the operational lifecycle migration.
insert into public.locations (id, name, code, is_active) values
  ('b1000000-0000-4000-8000-000000000001', 'Backfill source', 'BFS', true),
  ('b1000000-0000-4000-8000-000000000002', 'Backfill destination', 'BFD', true);

insert into public.profiles (
  id, phone, name, role, is_active, can_access_super_admin_features
) values (
  'b2000000-0000-4000-8000-000000000001', '0995200001',
  'Backfill operator', 'user', true, true
);

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, deduct_weight, rubber_value,
  average_price, net_total, client_created_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  'b3000000-0000-4000-8000-000000000001', 'BACKFILL-SOURCE',
  'BACKFILL-SOURCE', 'BACKFILL-SOURCE', 'BACKFILL-SOURCE',
  'synced', 'active', 'b1000000-0000-4000-8000-000000000001',
  'BACKFILL-SOURCE', '2026-08-08', 'Backfill source customer', 'small',
  100, 0, 3600, 36, 3600, '2026-08-08 00:00:00+00',
  'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001'
);

insert into public.rubber_bill_items (
  bill_id, item_type, net_weight, quantity, unit, price, total
) values (
  'b3000000-0000-4000-8000-000000000001', 'weigh', 100, 100, 'kg', 36, 3600
);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone,
  opening_balance, closing_balance
) values (
  'b4000000-0000-4000-8000-000000000001', 'RPT-BACKFILL-SOURCE',
  '2026-08-08', 1, 'b1000000-0000-4000-8000-000000000001',
  '2026-08-08 00:00:00+00', 'active',
  'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001', 0, 0
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values (
  'b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001', 'rubber_bill',
  'b3000000-0000-4000-8000-000000000001', '2026-08-08 00:00:00+00'
);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
) values (
  'b6000000-0000-4000-8000-000000000001', 'REX-BACKFILL-SOURCE',
  '2026-08-08', 1, 'b1000000-0000-4000-8000-000000000001', 'verified',
  100, 3600, 36, 100, 0, 1, 0, 100, 'branch',
  'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
  'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
  '2026-08-08 00:00:00+00', '2026-08-08 00:00:00+00', 96, 96, 1
);

insert into public.rubber_export_items (
  export_id, location_id, source_report_item_id, source_bill_id, bill_date,
  bill_no, customer_name, eligibility_at, net_weight, paid_amount,
  age_source_at, age_is_estimated, carried_age_hours
) values (
  'b6000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001', '2026-08-08',
  'BACKFILL-SOURCE', 'Backfill source customer', '2026-08-08 00:00:00+00',
  100, 3600, '2026-08-08 00:00:00+00', true, 96
);

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date,
  customer_name, bill_type, weight, deduct_weight, rubber_value,
  average_price, deduction_total, net_total, client_created_at,
  created_by_user_id, created_by_name, created_by_phone,
  source_rubber_export_id, source_export_no, received_at,
  received_age_hours, received_age_is_estimated,
  deleted_by_name, deleted_by_phone, deleted_at
) values
  (
    'b7000000-0000-4000-8000-000000000001', 'BACKFILL-ACTIVE-RECEIPT',
    'BACKFILL-ACTIVE-RECEIPT', 'BACKFILL-ACTIVE-RECEIPT', 'BACKFILL-ACTIVE-RECEIPT',
    'synced', 'active', 'b1000000-0000-4000-8000-000000000002',
    'BACKFILL-ACTIVE-RECEIPT', '2026-08-10', 'รับยางจากสาขา Backfill source',
    'บิลเครื่องชั่งเล็ก', 100, 0, 3600, 36, 3600, 0, '2026-08-10 06:00:00+00',
    'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
    'b6000000-0000-4000-8000-000000000001', 'REX-BACKFILL-SOURCE',
    '2026-08-10 06:00:00+00', 1, false, null, null, null
  ),
  (
    'b7000000-0000-4000-8000-000000000002', 'BACKFILL-DELETED-RECEIPT',
    'BACKFILL-DELETED-RECEIPT', 'BACKFILL-DELETED-RECEIPT', 'BACKFILL-DELETED-RECEIPT',
    'synced', 'deleted', 'b1000000-0000-4000-8000-000000000002',
    'BACKFILL-DELETED-RECEIPT', '2026-08-10', 'รับยางจากสาขา Backfill source',
    'บิลเครื่องชั่งเล็ก', 100, 0, 3600, 36, 3600, 0, '2026-08-10 05:00:00+00',
    'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
    'b6000000-0000-4000-8000-000000000001', 'REX-BACKFILL-SOURCE',
    '2026-08-10 05:00:00+00', 11, false, 'Backfill operator', '0995200001',
    '2026-08-10 07:00:00+00'
  );

insert into public.rubber_bill_items (
  bill_id, item_type, description, net_weight, quantity, unit, price, total, sequence_no
) values
  ('b7000000-0000-4000-8000-000000000001', 'weigh', 'active receipt', 100, 100, 'kg', 36, 3600, 1),
  ('b7000000-0000-4000-8000-000000000001', 'debt', 'active receipt deduction', null, null, null, null, 3600, 2),
  ('b7000000-0000-4000-8000-000000000002', 'weigh', 'deleted receipt', 100, 100, 'kg', 36, 3600, 1),
  ('b7000000-0000-4000-8000-000000000002', 'debt', 'deleted receipt deduction', null, null, null, null, 3600, 2);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone,
  opening_balance, closing_balance
) values (
  'b4000000-0000-4000-8000-000000000002', 'RPT-BACKFILL-RECEIPT',
  '2026-08-10', 1, 'b1000000-0000-4000-8000-000000000002',
  '2026-08-10 06:00:00+00', 'active',
  'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001', 0, 0
);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values (
  'b5000000-0000-4000-8000-000000000002',
  'b4000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000002', 'rubber_bill',
  'b7000000-0000-4000-8000-000000000001', '2026-08-10 06:00:00+00'
);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status, previous_status,
  original_weight_total, paid_total, average_price, current_weight,
  weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count,
  deleted_by_user_id, deleted_by_name, deleted_by_phone, deleted_at
) values
  (
    'b8000000-0000-4000-8000-000000000001', 'REX-BACKFILL-DRAFT',
    '2026-08-10', 1, 'b1000000-0000-4000-8000-000000000002', 'draft', null,
    100, 3600, 36, null, null, null, 0, null, null,
    'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
    null, null, null, null, null, null, null, null, null, null, null, null
  ),
  (
    'b8000000-0000-4000-8000-000000000002', 'REX-BACKFILL-VERIFIED',
    '2026-08-10', 2, 'b1000000-0000-4000-8000-000000000002', 'verified', null,
    100, 3600, 36, 100, 0, 1, 0, 100, 'branch',
    'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
    'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
    '2026-08-10 07:00:00+00', '2026-08-10 07:00:00+00', 7, 7, 0,
    null, null, null, null
  ),
  (
    'b8000000-0000-4000-8000-000000000003', 'REX-BACKFILL-DELETED',
    '2026-08-10', 3, 'b1000000-0000-4000-8000-000000000002', 'deleted', 'verified',
    100, 3600, 36, 100, 0, 1, 0, 100, 'branch',
    'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
    'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
    '2026-08-10 07:00:00+00', '2026-08-10 07:00:00+00', 7, 7, 0,
    'b2000000-0000-4000-8000-000000000001', 'Backfill operator', '0995200001',
    '2026-08-10 08:00:00+00'
  );

insert into public.rubber_export_items (
  id, export_id, location_id, source_report_item_id, source_bill_id, bill_date,
  bill_no, customer_name, eligibility_at, net_weight, paid_amount, active,
  age_source_at, age_is_estimated, carried_age_hours
) values
  (
    'b9000000-0000-4000-8000-000000000001',
    'b8000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    'b5000000-0000-4000-8000-000000000002',
    'b7000000-0000-4000-8000-000000000001', '2026-08-10',
    'BACKFILL-ACTIVE-RECEIPT', 'รับยางจากสาขา Backfill source',
    '2026-08-10 06:00:00+00', 100, 3600, true,
    '2000-01-01 00:00:00+00', false, 1
  ),
  (
    'b9000000-0000-4000-8000-000000000002',
    'b8000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002',
    'b5000000-0000-4000-8000-000000000002',
    'b7000000-0000-4000-8000-000000000001', '2026-08-10',
    'BACKFILL-ACTIVE-RECEIPT', 'รับยางจากสาขา Backfill source',
    '2026-08-10 06:00:00+00', 100, 3600, false,
    '2000-01-01 00:00:00+00', false, 7
  ),
  (
    'b9000000-0000-4000-8000-000000000003',
    'b8000000-0000-4000-8000-000000000003',
    'b1000000-0000-4000-8000-000000000002',
    'b5000000-0000-4000-8000-000000000002',
    'b7000000-0000-4000-8000-000000000001', '2026-08-10',
    'BACKFILL-ACTIVE-RECEIPT', 'รับยางจากสาขา Backfill source',
    '2026-08-10 06:00:00+00', 100, 3600, false,
    '2000-01-01 00:00:00+00', false, 9
  );
