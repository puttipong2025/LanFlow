begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(57);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.guard_rubber_export_work_transfer()', 'execute'),
  'authenticated users cannot invoke the transfer guard directly'
);
select extensions.ok(
  to_regprocedure('private.reject_rubber_export_work_soft_delete()') is null,
  'redundant feature-specific soft-delete trigger function is absent'
);

select extensions.ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.save_rubber_export_work_transfer_slips(uuid,integer,jsonb)'::regprocedure))
    < position('for update' in pg_get_functiondef('public.save_rubber_export_work_transfer_slips(uuid,integer,jsonb)'::regprocedure)),
  'slip save takes branch advisory lock before transfer row lock'
);
select extensions.ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.delete_rubber_export(uuid)'::regprocedure))
    < position('for update' in pg_get_functiondef('public.delete_rubber_export(uuid)'::regprocedure)),
  'REX delete takes branch advisory lock before row lock'
);
select extensions.ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.revert_rubber_export_to_draft(uuid)'::regprocedure))
    < position('for update' in pg_get_functiondef('public.revert_rubber_export_to_draft(uuid)'::regprocedure)),
  'REX revert takes branch advisory lock before row lock'
);
select extensions.ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.create_report_batch(uuid)'::regprocedure)) > 0,
  'report creation uses the same branch serialization seam'
);

insert into public.locations (id, name, code, is_active) values
  ('51000000-0000-4000-8000-000000000001', 'pgTAP REX Work A', 'RWA', true);
insert into public.profiles (id, phone, name, role, is_active, can_manage_rubber_exports, can_access_money_transfer)
values ('52000000-0000-4000-8000-000000000001', '0895200001', 'REX Work Manager', 'admin', true, true, false);
insert into public.user_locations (user_id, location_id, is_primary)
values ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', true);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price,
  other_operating_cost, created_by_user_id, created_by_name, created_by_phone
) values
  ('53000000-0000-4000-8000-000000000001', 'REX-WORK-1', '2026-09-17', 1, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000002', 'REX-WORK-ZERO', '2026-09-17', 2, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000003', 'REX-WORK-BRANCH', '2026-09-17', 3, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000004', 'REX-WORK-REVERT', '2026-09-17', 4, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000006', 'REX-WORK-LARGE', '2026-09-17', 6, '51000000-0000-4000-8000-000000000001', 'draft', 10000000001, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000007', 'REX-WORK-HALF', '2026-09-17', 7, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000008', 'REX-WORK-LOW-FRACTION', '2026-09-17', 8, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000009', 'REX-WORK-SUB-BAHT', '2026-09-17', 9, '51000000-0000-4000-8000-000000000001', 'draft', 1, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000010', 'REX-WORK-INVALID-DRAFT', '2026-09-17', 10, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000011', 'REX-WORK-INVALID-VERIFY', '2026-09-17', 11, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'),
  ('53000000-0000-4000-8000-000000000012', 'REX-WORK-INVALID-DESTINATION', '2026-09-17', 12, '51000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0, '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001');

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price,
  current_weight, weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
) values (
  '53000000-0000-4000-8000-000000000005', 'REX-WORK-OLD', '2026-09-16', 5,
  '51000000-0000-4000-8000-000000000001', 'verified',
  100, 1000, 1000, 10, 90, 10, 2, 10, 210, 'external',
  '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001',
  '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001',
  '2026-09-16 03:00:00+00', '2026-09-16 03:00:00+00', 0, 0, 0
);

select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_like($$select public.update_rubber_export('53000000-0000-4000-8000-000000000010', 90, 'NaN'::numeric, 0)$$, '%ค่าทำงานต้องเป็นตัวเลขที่มีค่าจำกัด%', 'draft update rejects a non-finite work rate');
select extensions.throws_like($$select public.update_rubber_export('53000000-0000-4000-8000-000000000010', 90, 'Infinity'::numeric, 0)$$, '%ค่าทำงานต้องเป็นตัวเลขที่มีค่าจำกัด%', 'draft update rejects an infinite work rate');
select extensions.throws_like($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000011', 90, 2, 'NaN'::numeric, 'external')$$, '%ค่าใช้จ่ายอื่นต้องเป็นตัวเลขที่มีค่าจำกัด%', 'verification rejects a non-finite other operating cost');
select extensions.throws_like($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000011', 90, 2, '-Infinity'::numeric, 'external')$$, '%ค่าใช้จ่ายอื่นต้องเป็นตัวเลขที่มีค่าจำกัด%', 'verification rejects a negative infinite other operating cost');
select extensions.throws_like($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000012', 90, 2, 0, null)$$, '%กรุณาเลือกปลายทางค่าใช้จ่าย%', 'verification rejects a null expense destination');
reset role;
select extensions.ok((select status = 'draft' and work_rate is null and work_total is null from public.rubber_exports where id = '53000000-0000-4000-8000-000000000010'), 'rejected draft update leaves source values unchanged');
select extensions.ok((select status = 'draft' and work_total is null and not exists(select 1 from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000011') from public.rubber_exports where id = '53000000-0000-4000-8000-000000000011'), 'rejected verification leaves source and transfer unchanged');
select extensions.ok((select status = 'draft' and expense_destination is null from public.rubber_exports where id = '53000000-0000-4000-8000-000000000012'), 'rejected destination leaves source unchanged');

set local role authenticated;
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000001', 90, 2, 10, 'external')$$, 'REX manager can verify without transfer-module access');
reset role;
select extensions.ok((select transfer_type = 'rubber_export_work' and transfer_status = 'pending' and net_amount_to_pay = 210 and location_id = '51000000-0000-4000-8000-000000000001' and customer_name is null and account_number is null from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 'verification atomically creates pending transfer with source branch, exact amount, and no recipient');
select extensions.ok(not exists(select 1 from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000005'), 'verified REX that predates rollout is not backfilled');

set local role authenticated;
select extensions.ok('53000000-0000-4000-8000-000000000001'::uuid = any(public.get_rubber_export_work_transfer_ids(array['53000000-0000-4000-8000-000000000001'::uuid])), 'REX reader sees linked indicator without transfer-module access');
select extensions.ok(not ('53000000-0000-4000-8000-000000000005'::uuid = any(public.get_rubber_export_work_transfer_ids(array['53000000-0000-4000-8000-000000000005'::uuid]))), 'old REX indicator remains false without a linked row');
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000006', 10000000000, 1, 0, 'external')$$, 'work amount above old numeric(12,2) limit verifies');
reset role;
select extensions.is((select net_amount_to_pay from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000006'), 10000000001.00::numeric, 'large work amount is stored without numeric overflow');
set local role authenticated;
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000007', 90, 2, 0.50, 'external')$$, 'half-baht work total verifies');
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000008', 90, 2, 0.49, 'external')$$, 'low fractional work total verifies');
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000009', 1, 0.99, 0, 'external')$$, 'sub-baht work total verifies');
reset role;
select extensions.ok((select work_total = 200.50 and (select net_amount_to_pay from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000007') = 200 from public.rubber_exports where id = '53000000-0000-4000-8000-000000000007'), 'half-baht work total stays exact while transfer drops the fraction');
select extensions.ok((select work_total = 200.49 and (select net_amount_to_pay from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000008') = 200 from public.rubber_exports where id = '53000000-0000-4000-8000-000000000008'), 'low fractional work total stays exact while transfer drops the fraction');
select extensions.ok((select work_total = 0.99 and not exists(select 1 from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000009') from public.rubber_exports where id = '53000000-0000-4000-8000-000000000009'), 'sub-baht work total does not create a zero-baht transfer');
set local role authenticated;
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000001', 90, 2, 10, 'external')$$, 'verify retry is idempotent');
reset role;
select extensions.is((select count(*)::integer from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 1, 'retry has exactly one transfer');

set local role authenticated;
select extensions.throws_like($$select public.revert_rubber_export_to_draft('53000000-0000-4000-8000-000000000001')$$, '%ไม่มีสิทธิ์โอนเงิน%', 'linked revert requires transfer permission');
select extensions.throws_like($$select public.delete_rubber_export('53000000-0000-4000-8000-000000000001')$$, '%ไม่มีสิทธิ์โอนเงิน%', 'linked delete requires transfer permission');
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000002', 90, 0, 0, 'external')$$, 'zero work verifies without transfer');
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000003', 90, 2, 10, 'branch')$$, 'branch-paid work verifies without transfer');
reset role;
select extensions.ok(not exists(select 1 from public.money_transfers where rubber_export_id in ('53000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000003')), 'zero and branch-paid work do not create transfers');

update public.profiles set can_access_money_transfer = true where id = '52000000-0000-4000-8000-000000000001';
set local role authenticated;
select extensions.lives_ok($$select public.save_rubber_export_work_transfer_slips(
  (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 0,
  '[{"id":"54000000-0000-4000-8000-000000000001","amount":100,"fee":0,"transactionDate":"2026-09-17T04:00:00Z","inputMethod":"manual","sortOrder":0}]'::jsonb
)$$, 'authorized transfer user saves first slip');
reset role;
select extensions.is((select transfer_status from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 'partial', 'partial slip total leaves transfer partially paid');

set local role authenticated;
select extensions.lives_ok($$select public.save_rubber_export_work_transfer_slips(
  (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 1,
  '[{"id":"54000000-0000-4000-8000-000000000001","amount":100,"fee":0,"transactionDate":"2026-09-17T04:00:00Z","inputMethod":"manual","sortOrder":0},{"id":"54000000-0000-4000-8000-000000000002","amount":110,"fee":0,"transactionDate":"2026-09-17T05:00:00Z","inputMethod":"manual","sortOrder":1}]'::jsonb
)$$, 'second slip completes payment');
reset role;
select extensions.ok((select transfer_status = 'paid' and revision_no = 2 from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 'paid status and revision are derived on server');
set local role authenticated;
select extensions.throws_like($$select public.save_rubber_export_work_transfer_slips(
  (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 2, null
)$$, 'MT_INVALID_PAYLOAD:%', 'null slip payload is rejected before any destructive write');
reset role;
select extensions.is((select count(*)::integer from public.money_transfer_slips where transfer_id = (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001')), 2, 'rejected null payload preserves existing slips');
set local role authenticated;
select extensions.is(
  (public.get_money_transfer_list('51000000-0000-4000-8000-000000000001', 'all', 'REX-WORK-1') #>> '{rows,0,slip_count}')::integer,
  2,
  'list projection reports the saved slip count'
);
reset role;
select extensions.ok(exists(select 1 from private.reportable_items('51000000-0000-4000-8000-000000000001', '2100-01-01 00:00:00+00') where entity_type = 'bank_transfer_source' and entity_id = (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001')), 'paid transfer enters report as evidence');
select extensions.throws_like($$update public.money_transfers set net_amount_to_pay = 1 where rubber_export_id = '53000000-0000-4000-8000-000000000001'$$, 'REX_WORK_TRANSFER_LOCKED:%', 'source amount cannot be edited');
select extensions.throws_like($$update public.money_transfers set record_status = 'deleted' where rubber_export_id = '53000000-0000-4000-8000-000000000001'$$, 'MONEY_TRANSFER_DELETE_RPC_REQUIRED', 'direct soft delete remains blocked');

set local role authenticated;
select extensions.throws_like($$select public.delete_money_transfer((select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 2)$$, 'REX_WORK_TRANSFER_%', 'ordinary delete RPC cannot delete a linked transfer');
reset role;

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  '55000000-0000-4000-8000-000000000001', 'RPT-REX-WORK-1', '2026-09-17', 1,
  '51000000-0000-4000-8000-000000000001', '2100-01-01 00:00:00+00',
  '52000000-0000-4000-8000-000000000001', 'REX Work Manager', '0895200001'
);
insert into public.report_items (id, report_id, location_id, entity_type, entity_id, eligibility_at)
values (
  '56000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'bank_transfer_source',
  (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'),
  '2026-09-17 00:00:00+00'
);
set constraints all immediate;
set local role authenticated;
select extensions.throws_like($$select public.save_rubber_export_work_transfer_slips(
  (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001'), 2,
  '[{"id":"54000000-0000-4000-8000-000000000001","amount":100,"fee":0,"transactionDate":"2026-09-17T04:00:00Z","inputMethod":"manual","sortOrder":0}]'::jsonb
)$$, 'REPORT_LOCKED:RPT-REX-WORK-1', 'transfer report blocks slip edits and names the report');
select extensions.throws_like($$select public.revert_rubber_export_to_draft('53000000-0000-4000-8000-000000000001')$$, 'REPORT_LOCKED:RPT-REX-WORK-1', 'transfer report blocks revert and names the report');
select extensions.throws_like($$select public.delete_rubber_export('53000000-0000-4000-8000-000000000001')$$, 'REPORT_LOCKED:RPT-REX-WORK-1', 'transfer report blocks delete and names the report');
reset role;
select extensions.ok(exists(select 1 from public.money_transfer_slips where id = '54000000-0000-4000-8000-000000000001'), 'report lock preserves paid slip');
delete from public.report_items where id = '56000000-0000-4000-8000-000000000001';
set local role authenticated;
select extensions.lives_ok($$select public.revert_rubber_export_to_draft('53000000-0000-4000-8000-000000000001')$$, 'authorized revert removes linked transfer');
reset role;
select extensions.ok(not exists(select 1 from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000001') and not exists(select 1 from public.money_transfer_slips where id in ('54000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000002')), 'revert hard-deletes transfer and slips');

set local role authenticated;
select extensions.lives_ok($$select public.verify_rubber_export_atomic('53000000-0000-4000-8000-000000000004', 90, 2, 10, 'external')$$, 'new external export for delete');
select extensions.lives_ok($$select public.save_rubber_export_work_transfer_slips(
  (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000004'), 0,
  '[{"id":"54000000-0000-4000-8000-000000000003","amount":220,"fee":0,"transactionDate":"2026-09-17T06:00:00Z","inputMethod":"manual","sortOrder":0}]'::jsonb
)$$, 'overpayment slip saved for delete');
reset role;
select extensions.is((select transfer_status from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000004'), 'overpaid', 'overpayment status derived from slip total');
select extensions.ok(exists(select 1 from private.reportable_items('51000000-0000-4000-8000-000000000001', '2100-01-01 00:00:00+00') where entity_type = 'bank_transfer_source' and entity_id = (select id from public.money_transfers where rubber_export_id = '53000000-0000-4000-8000-000000000004')), 'overpaid transfer also enters report as evidence');
set local role authenticated;
select extensions.lives_ok($$select public.delete_rubber_export('53000000-0000-4000-8000-000000000004')$$, 'authorized delete removes REX and paid transfer');
reset role;
select extensions.ok(not exists(select 1 from public.rubber_exports where id = '53000000-0000-4000-8000-000000000004') and not exists(select 1 from public.money_transfer_slips where id = '54000000-0000-4000-8000-000000000003'), 'delete hard-deletes source and paid slip');

select * from extensions.finish();
rollback;
