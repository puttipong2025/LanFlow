begin;

select plan(32);

select has_column('public', 'rubber_export_items', 'age_source_at', 'items snapshot the source timestamp');
select has_column('public', 'rubber_export_items', 'age_is_estimated', 'items snapshot whether age is estimated');
select has_column('public', 'rubber_exports', 'age_cutoff_at', 'verified exports snapshot the cutoff');
select has_function('private', 'rubber_export_raw_age_summary', array['uuid', 'timestamp with time zone'], 'raw weighted-age helper exists');

select is(
  private.rubber_export_effective_age_start(
    date '2026-08-01',
    timestamptz '2026-08-01 03:15:00+00',
    timestamptz '2026-08-05 05:45:00+00'
  ),
  timestamptz '2026-08-01 03:15:00+00',
  'matching Bangkok dates use TimestampBill exactly'
);

select is(
  private.rubber_export_effective_age_start(
    date '2026-08-01',
    timestamptz '2026-08-02 03:15:00+00',
    timestamptz '2026-08-05 05:45:00+00'
  ),
  timestamptz '2026-08-01 05:45:00+00',
  'mismatched dates combine billDate with cutoff Bangkok time'
);

select is(
  private.rubber_export_age_hours(
    date '2026-08-01',
    timestamptz '2026-08-02 03:15:00+00',
    timestamptz '2026-08-05 05:45:00+00'
  ),
  96::numeric,
  'mismatched dates produce whole days'
);

select is(
  private.rubber_export_age_hours(
    date '2026-08-06',
    timestamptz '2026-08-06 03:15:00+00',
    timestamptz '2026-08-05 05:45:00+00'
  ),
  0::numeric,
  'age never becomes negative'
);

select function_returns(
  'public',
  'get_rubber_export_age_detail',
  array['uuid'],
  'jsonb',
  'detail RPC exists with a stable JSON contract'
);

insert into public.locations (id, name, code, is_active)
values ('41000000-0000-4000-8000-000000000001', 'pgTAP Rubber Age', 'PRAG', true);

insert into public.profiles (
  id, phone, name, role, is_active, can_access_super_admin_features
) values (
  '42000000-0000-4000-8000-000000000001', '0894000001',
  'pgTAP Rubber Age Manager', 'user', true, true
);

insert into public.profiles (
  id, phone, name, role, is_active, can_access_super_admin_features
) values (
  '42000000-0000-4000-8000-000000000002', '0894000002',
  'Renamed Rubber Export Creator', 'user', true, false
);

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  status, created_by_user_id, created_by_name, created_by_phone,
  opening_balance, closing_balance
) values (
  '43000000-0000-4000-8000-000000000001', 'RPT-AGE-001', '2026-08-01', 1,
  '41000000-0000-4000-8000-000000000001', '2026-08-01 12:00:00+07', 'active',
  '42000000-0000-4000-8000-000000000001', 'pgTAP Rubber Age Manager', '0894000001', 0, 0
);

insert into public.rubber_bills (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key, sync_status,
  location_id, bill_no, bill_date, customer_name, bill_type,
  weight, deduct_weight, rubber_value, average_price, net_total, client_created_at,
  created_by_user_id, created_by_name, created_by_phone, created_at
) values
  (
    '44000000-0000-4000-8000-000000000001', 'AGE-1', 'AGE-1', 'S-AGE-1', 'AGE-1', 'synced',
    '41000000-0000-4000-8000-000000000001', 'AGE-1', '2026-08-01', 'A', 'small',
    100, 0, 1000, 10, 1000, '2026-08-01 10:00:00+07',
    '42000000-0000-4000-8000-000000000001', 'manager', '0894000001', '2026-08-01 10:00:00+07'
  ),
  (
    '44000000-0000-4000-8000-000000000002', 'AGE-2', 'AGE-2', 'S-AGE-2', 'AGE-2', 'synced',
    '41000000-0000-4000-8000-000000000001', 'AGE-2', '2026-08-01', 'B', 'small',
    300, 0, 3000, 10, 3000, '2026-08-02 10:00:00+07',
    '42000000-0000-4000-8000-000000000001', 'manager', '0894000001', '2026-08-02 10:00:00+07'
  ),
  (
    '44000000-0000-4000-8000-000000000003', 'AGE-3', 'AGE-3', 'S-AGE-3', 'AGE-3', 'synced',
    '41000000-0000-4000-8000-000000000001', 'AGE-3', '2026-08-01', 'C', 'small',
    100, 0, 1000, 10, 1000, null,
    '42000000-0000-4000-8000-000000000001', 'manager', '0894000001', '2026-08-01 11:00:00+07'
  ),
  (
    '44000000-0000-4000-8000-000000000004', 'AGE-FUTURE', 'AGE-FUTURE', 'S-AGE-FUTURE', 'AGE-FUTURE', 'synced',
    '41000000-0000-4000-8000-000000000001', 'AGE-FUTURE', '2099-01-01', 'Future', 'small',
    100, 0, 1000, 10, 1000, '2099-01-01 10:00:00+07',
    '42000000-0000-4000-8000-000000000001', 'manager', '0894000001', '2099-01-01 10:00:00+07'
  ),
  (
    '44000000-0000-4000-8000-000000000005', 'AGE-MISSING', 'AGE-MISSING', 'S-AGE-MISSING', 'AGE-MISSING', 'synced',
    '41000000-0000-4000-8000-000000000001', 'AGE-MISSING', '2026-08-01', 'Missing', 'small',
    100, 0, 1000, 10, 1000, null,
    '42000000-0000-4000-8000-000000000001', 'manager', '0894000001', '2026-08-01 11:00:00+07'
  );

insert into public.rubber_bill_items (
  bill_id, item_type, net_weight, quantity, unit, price, total
) values
  ('44000000-0000-4000-8000-000000000001', 'weigh', 100, 100, 'kg', 10, 1000),
  ('44000000-0000-4000-8000-000000000002', 'weigh', 300, 300, 'kg', 10, 3000),
  ('44000000-0000-4000-8000-000000000003', 'weigh', 100, 100, 'kg', 10, 1000),
  ('44000000-0000-4000-8000-000000000004', 'weigh', 100, 100, 'kg', 10, 1000),
  ('44000000-0000-4000-8000-000000000005', 'weigh', 100, 100, 'kg', 10, 1000);

insert into public.report_items (
  id, report_id, location_id, entity_type, entity_id, eligibility_at
) values
  ('45000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'rubber_bill', '44000000-0000-4000-8000-000000000001', '2026-08-01 10:00:00+07'),
  ('45000000-0000-4000-8000-000000000002', '43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'rubber_bill', '44000000-0000-4000-8000-000000000002', '2026-08-01 10:01:00+07'),
  ('45000000-0000-4000-8000-000000000003', '43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'rubber_bill', '44000000-0000-4000-8000-000000000003', '2026-08-01 10:02:00+07'),
  ('45000000-0000-4000-8000-000000000004', '43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'rubber_bill', '44000000-0000-4000-8000-000000000004', '2026-08-01 10:03:00+07'),
  ('45000000-0000-4000-8000-000000000005', '43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'rubber_bill', '44000000-0000-4000-8000-000000000005', '2026-08-01 10:04:00+07');

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, original_weight_total,
  paid_total, rubber_value_total, average_price, created_by_user_id, created_by_name, created_by_phone
) values
  (
    '46000000-0000-4000-8000-000000000001', 'REX-AGE-001', '2026-08-01', 1,
    '41000000-0000-4000-8000-000000000001', 500, 5000, 5000, 10,
    '42000000-0000-4000-8000-000000000002', 'Original Rubber Export Creator', '0894000002'
  ),
  (
    '46000000-0000-4000-8000-000000000002', 'REX-AGE-002', '2026-08-01', 2,
    '41000000-0000-4000-8000-000000000001', 100, 1000, 1000, 10,
    '42000000-0000-4000-8000-000000000002', 'Original Rubber Export Creator', '0894000002'
  );

insert into public.document_deletion_audits (
  document_kind, source_id, document_no, location_id, previous_status,
  deleted_by_user_id, deleted_by_name, deleted_at
) values (
  'rubber_export', '47000000-0000-4000-8000-000000000001', 'REX-LEGACY-001',
  '41000000-0000-4000-8000-000000000001', 'draft',
  '42000000-0000-4000-8000-000000000001', 'pgTAP Rubber Age Manager',
  '2026-08-01 12:00:00+07'
);

insert into public.rubber_export_items (
  export_id, location_id, source_report_item_id, source_bill_id, bill_date,
  bill_no, customer_name, eligibility_at, net_weight, paid_amount, rubber_value_amount,
  age_source_at, age_is_estimated
) values
  ('46000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '2026-08-01', 'AGE-1', 'A', '2026-08-01 10:00:00+07', 100, 1000, 1000, '2026-08-01 10:00:00+07', false),
  ('46000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002', '2026-08-01', 'AGE-2', 'B', '2026-08-01 10:01:00+07', 300, 3000, 3000, '2026-08-02 10:00:00+07', true),
  ('46000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000003', '44000000-0000-4000-8000-000000000003', '2026-08-01', 'AGE-3', 'C', '2026-08-01 10:02:00+07', 100, 1000, 1000, '2026-08-01 11:00:00+07', true),
  ('46000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-000000000005', '44000000-0000-4000-8000-000000000005', '2026-08-01', 'AGE-MISSING', 'Missing', '2026-08-01 10:04:00+07', 100, 1000, 1000, '2026-08-01 11:00:00+07', true);

select is(
  (select average_age_hours from private.rubber_export_age_summary(
    '46000000-0000-4000-8000-000000000001', '2026-08-05 12:45:00+07'
  )),
  96.90::numeric,
  'weighted average uses raw hours and rounds only the final result'
);
select isnt(
  (select average_age_hours from private.rubber_export_raw_age_summary(
    '46000000-0000-4000-8000-000000000001', '2026-08-05 12:45:01+07'
  )),
  (select round(average_age_hours, 2) from private.rubber_export_raw_age_summary(
    '46000000-0000-4000-8000-000000000001', '2026-08-05 12:45:01+07'
  )),
  'raw weighted age retains sub-centihour precision before receipt snapshotting'
);
select is(
  (select oldest_age_hours from private.rubber_export_age_summary(
    '46000000-0000-4000-8000-000000000001', '2026-08-05 12:45:00+07'
  )),
  98.75::numeric,
  'oldest age uses the maximum raw item age'
);
select is(
  (select estimated_age_item_count from private.rubber_export_age_summary(
    '46000000-0000-4000-8000-000000000001', '2026-08-05 12:45:00+07'
  )),
  2,
  'estimated status propagates to the summary count'
);

select throws_ok(
  $$select private.validate_rubber_export_selection(
    '41000000-0000-4000-8000-000000000001',
    array['45000000-0000-4000-8000-000000000004'::uuid]
  )$$,
  'P0001',
  'RUBBER_EXPORT_FUTURE_BILL:S-AGE-FUTURE',
  'future Bangkok bill dates are blocked'
);

select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(
  public.delete_rubber_export('46000000-0000-4000-8000-000000000002')->>'status',
  'deleted',
  'a draft export can be deleted'
);
select is(
  (select count(*)::integer from public.rubber_exports
    where id = '46000000-0000-4000-8000-000000000002'),
  0,
  'deleted draft header is removed permanently'
);
select is(
  (select count(*)::integer from public.rubber_export_items
    where export_id = '46000000-0000-4000-8000-000000000002'),
  0,
  'deleted draft item snapshots are removed permanently'
);
select is(
  (select previous_status from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000002'),
  'draft',
  'deleted draft keeps its previous status in minimal audit'
);
select is(
  (select original_actor_user_id from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000002'),
  '42000000-0000-4000-8000-000000000002'::uuid,
  'deleted export audit snapshots its original creator id'
);
select is(
  (select original_actor_name from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000002'),
  'Original Rubber Export Creator',
  'deleted export audit keeps the creation-time name snapshot'
);
select ok(
  (select deleted_by_user_id <> original_actor_user_id
      and deleted_by_name = 'pgTAP Rubber Age Manager'
    from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000002'),
  'deleted export audit keeps creator and deleter as separate actors'
);
select ok(
  (select original_actor_user_id is null and original_actor_name is null
    from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and source_id = '47000000-0000-4000-8000-000000000001'),
  'legacy deletion audit without creator evidence remains unknown'
);
select throws_ok(
  $$select public.get_rubber_export_age_detail(
    '46000000-0000-4000-8000-000000000002'
  )$$,
  'P0001',
  'ไม่มีสิทธิ์ดูอายุยางของรายการนี้',
  'deleted draft no longer exposes age detail'
);
select is(
  (select document_no from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000002'),
  'REX-AGE-002',
  'deleted draft audit keeps its document number'
);

select is(
  (public.preview_rubber_export(
    '41000000-0000-4000-8000-000000000001',
    array['45000000-0000-4000-8000-000000000005'::uuid]
  )->>'estimatedAgeItemCount')::integer,
  1,
  'missing TimestampBill falls back to created_at and is marked estimated'
);
select throws_ok(
  $$select public.verify_rubber_export_atomic(
    '46000000-0000-4000-8000-000000000001', 490, 1, -1, 'branch'
  )$$,
  'P0001',
  'ค่าใช้จ่ายอื่นต้องไม่น้อยกว่า 0',
  'invalid verification fails atomically'
);
select is(
  (select status from public.rubber_exports where id = '46000000-0000-4000-8000-000000000001'),
  'draft',
  'failed verification leaves the draft unchanged'
);
select is(
  public.verify_rubber_export_atomic(
    '46000000-0000-4000-8000-000000000001', 490, 1, 0, 'branch'
  )->>'status',
  'verified',
  'valid verification succeeds'
);
select ok(
  (select age_cutoff_at = verified_at and average_age_hours is not null
    from public.rubber_exports where id = '46000000-0000-4000-8000-000000000001'),
  'verification freezes age in the same header update'
);
select is(
  (select estimated_age_item_count from public.rubber_exports
    where id = '46000000-0000-4000-8000-000000000001'),
  2,
  'verified snapshot keeps the estimated count'
);
select is(
  public.delete_rubber_export('46000000-0000-4000-8000-000000000001')->>'status',
  'deleted',
  'a verified export can be deleted without recalculating age'
);
select ok(
  not exists (
    select 1 from public.rubber_exports
    where id = '46000000-0000-4000-8000-000000000001'
  ) and exists (
    select 1 from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and source_id = '46000000-0000-4000-8000-000000000001'
      and previous_status = 'verified'
  ),
  'verified export details are removed and only minimal audit remains'
);

reset role;

select * from finish();
rollback;
