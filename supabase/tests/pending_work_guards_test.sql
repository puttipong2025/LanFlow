begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(24);

select extensions.has_function('private', 'lock_report_locations', array['uuid[]'], 'pending-work writes share the report branch lock');
select extensions.has_function('private', 'report_creation_blockers', array['uuid', 'timestamp with time zone'], 'report creation has one authoritative blocker query');
select extensions.has_function('private', 'cash_count_start_blockers', array['uuid', 'timestamp with time zone'], 'cash count start composes report and cash receipt blockers');
select extensions.has_function('private', 'guard_pending_work_request', array[]::text[], 'pending approval writes are protected by one trigger guard');

select extensions.ok(
  not has_function_privilege('authenticated', 'private.report_creation_blockers(uuid,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.cash_count_start_blockers(uuid,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.assert_report_creation_unblocked(uuid,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.lock_report_locations(uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'private.guard_pending_work_request()', 'execute'),
  'private blocker and lock helpers are not client-executable'
);

insert into public.locations (id, name, code, is_active)
values
  ('61000000-0000-4000-8000-000000000001', 'Pending Work Source', 'PWS1', true),
  ('61000000-0000-4000-8000-000000000002', 'Pending Work Target', 'PWT1', true),
  ('61000000-0000-4000-8000-000000000003', 'Pending Work Cash Submit', 'PWCS', true),
  ('61000000-0000-4000-8000-000000000004', 'Pending Work Bank Receipt', 'PWBR', true);

insert into public.profiles (id, phone, name, role, is_active, can_access_super_admin_features)
values
  ('62000000-0000-4000-8000-000000000001', '0896100001', 'Pending Work Manager', 'admin', true, true),
  ('62000000-0000-4000-8000-000000000002', '0896100002', 'Pending Work User', 'user', true, false);

insert into public.user_locations (user_id, location_id, is_primary)
values
  ('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', true),
  ('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000003', false),
  ('62000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001', true);

insert into public.stock_products (id, name, unit)
values ('63000000-0000-4000-8000-000000000001', 'Pending Work Product', 'ถัง');

insert into public.stock_entries (
  id, tx_date, product_id, product_name, quantity_delta, amount, location_id,
  tx_type, created_by_user_id, created_by_name, created_by_phone, created_at, updated_at
) values
  ('64000000-0000-4000-8000-000000000001', '2026-09-28', '63000000-0000-4000-8000-000000000001', 'Pending Work Product', 2, 200, '61000000-0000-4000-8000-000000000001', 'receive', '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07'),
  ('64000000-0000-4000-8000-000000000002', '2026-09-28', '63000000-0000-4000-8000-000000000001', 'Pending Work Product', 1, 100, '61000000-0000-4000-8000-000000000001', 'receive', '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07');

insert into public.income_expense (
  id, client_temp_id, local_bill_no, sync_status, location_id, type, number,
  tx_date, title, cost, bill_option, created_by_user_id, created_by_name,
  created_by_phone, created_at, updated_at
) values
(
  '65000000-0000-4000-8000-000000000001', 'pending-work-income-source', 'PW-IE-1',
  'synced', '61000000-0000-4000-8000-000000000001', 'expense', 'PW-IE-1',
  '2026-09-28', 'Pending Work Expense', 100, 'ค่าใช้จ่าย',
  '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001',
  '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07'
),
(
  '65000000-0000-4000-8000-000000000002', 'pending-work-cash-submit-source', 'PW-IE-2',
  'synced', '61000000-0000-4000-8000-000000000003', 'expense', 'PW-IE-2',
  '2026-09-28', 'Pending after Cash Count start', 50, 'ค่าใช้จ่าย',
  '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001',
  '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07'
);

insert into public.money_transfers (
  id, client_temp_id, idempotency_key, location_id, net_amount_to_pay,
  transfer_status, transfer_type, transfer_method, target_location_id,
  target_location_name, created_by_user_id, created_by_name, created_by_phone,
  created_at, updated_at
) values
  ('66000000-0000-4000-8000-000000000001', 'pending-work-cash-1', 'pending-work-cash-1', '61000000-0000-4000-8000-000000000001', 20, 'paid', 'cash', 'cash', '61000000-0000-4000-8000-000000000002', 'Pending Work Target', '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07'),
  ('66000000-0000-4000-8000-000000000002', 'pending-work-cash-2', 'pending-work-cash-2', '61000000-0000-4000-8000-000000000001', 20, 'paid', 'cash', 'cash', '61000000-0000-4000-8000-000000000002', 'Pending Work Target', '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07'),
  ('66000000-0000-4000-8000-000000000003', 'pending-work-bank', 'pending-work-bank', '61000000-0000-4000-8000-000000000001', 20, 'paid', 'branch', 'bank', '61000000-0000-4000-8000-000000000002', 'Pending Work Target', '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07');

insert into public.money_transfer_cash_details (
  transfer_id, sent_coin_1_count, sent_coin_2_count, sent_coin_5_count,
  sent_coin_10_count, sent_banknote_20_count, sent_banknote_50_count,
  sent_banknote_100_count, sent_banknote_500_count, sent_banknote_1000_count,
  cash_status, sent_at, created_at, updated_at
) values (
  '66000000-0000-4000-8000-000000000001', 0, 0, 0, 0, 1, 0, 0, 0, 0,
  'pending_receipt', '2026-09-28 10:00:00+07', '2026-09-28 10:00:00+07', '2026-09-28 10:00:00+07'
);

insert into public.money_transfers (
  id, client_temp_id, idempotency_key, location_id, net_amount_to_pay,
  transfer_status, transfer_type, transfer_method, target_location_id,
  target_location_name, created_by_user_id, created_by_name, created_by_phone,
  accounting_date, branch_receipt_contract_version, branch_receipt_status,
  branch_received_by_user_id, branch_received_by_name, branch_received_at,
  created_at, updated_at
) values
  (
    '66000000-0000-4000-8000-000000000004', 'pending-work-bank-receipt', 'pending-work-bank-receipt',
    '61000000-0000-4000-8000-000000000004', 40, 'paid', 'branch', 'bank',
    '61000000-0000-4000-8000-000000000004', 'Pending Work Bank Receipt',
    '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001',
    null, 1, 'pending_receipt', null, null, null,
    '2026-09-28 10:00:01+07', '2026-09-28 10:00:01+07'
  ),
  (
    '66000000-0000-4000-8000-000000000005', 'pending-work-bank-delete', 'pending-work-bank-delete',
    '61000000-0000-4000-8000-000000000004', 50, 'paid', 'branch', 'bank',
    '61000000-0000-4000-8000-000000000004', 'Pending Work Bank Receipt',
    '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001',
    '2026-09-28', 1, 'received',
    '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '2026-09-28 09:30:00+07',
    '2026-09-28 09:00:00+07', '2026-09-28 09:30:00+07'
  );

insert into public.rubber_bill_approval_requests (
  id, operation, request_status, location_id, client_temp_id, idempotency_key,
  base_revision_no, matched_reasons, proposed_payload, requested_by_user_id,
  requested_by_name, requested_by_phone, requested_at
) values (
  '67000000-0000-4000-8000-000000000001', 'create', 'pending', '61000000-0000-4000-8000-000000000001',
  'pending-work-rubber', 'pending-work-rubber', 0, array['price'], '{}',
  '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07'
);

insert into public.income_expense_approval_requests (
  id, requested_operation, request_idempotency_key, requested_payload,
  source_income_expense_id, matched_reasons, location_id, tx_type, title, cost, requested_by_user_id,
  requested_by_name, requested_by_phone, created_at, updated_at
) values
  ('68000000-0000-4000-8000-000000000001', 'create', 'pending-work-income-1', '{}', null, array['amount_threshold'], '61000000-0000-4000-8000-000000000001', 'expense', 'Pending 1', 10, '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07'),
  ('68000000-0000-4000-8000-000000000002', 'create', 'pending-work-income-2', '{}', null, array['amount_threshold'], '61000000-0000-4000-8000-000000000001', 'expense', 'Pending 2', 20, '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 10:00:00+07', '2026-09-28 10:00:00+07'),
  ('68000000-0000-4000-8000-000000000003', 'create', 'pending-work-income-after', '{}', null, array['amount_threshold'], '61000000-0000-4000-8000-000000000001', 'expense', 'Pending after cutoff', 30, '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 10:00:01+07', '2026-09-28 10:00:01+07'),
  ('68000000-0000-4000-8000-000000000004', 'update', 'pending-work-income-cash-submit', '{}', '65000000-0000-4000-8000-000000000002', array['amount_threshold'], '61000000-0000-4000-8000-000000000003', 'expense', 'Pending after Cash Count start', 50, '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 10:00:01+07', '2026-09-28 10:00:01+07');

insert into public.cash_transfer_delete_requests (
  id, transfer_id, source_location_id, source_location_name, target_location_id,
  target_location_name, transfer_display_no, sent_total, received_total,
  difference_total, requested_by_user_id, requested_by_name, requested_by_phone,
  created_at, updated_at
) values (
  '69000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001', 'Pending Work Source', '61000000-0000-4000-8000-000000000002',
  'Pending Work Target', 'PW-CASH-1', 20, 0, -20, '62000000-0000-4000-8000-000000000001',
  'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07'
);

insert into public.branch_transfer_delete_requests (
  id, transfer_id, location_id, location_name, transfer_display_no, amount,
  received_at, requested_by_user_id, requested_by_name, requested_by_phone,
  created_at, updated_at
) values (
  '69000000-0000-4000-8000-000000000002', '66000000-0000-4000-8000-000000000005',
  '61000000-0000-4000-8000-000000000004', 'Pending Work Bank Receipt', 'PW-BANK-1', 50,
  '2026-09-28 09:30:00+07', '62000000-0000-4000-8000-000000000001',
  'Pending Work Manager', '0896100001', '2026-09-28 10:00:01+07', '2026-09-28 10:00:01+07'
);

insert into public.stock_entry_approval_requests (
  id, request_idempotency_key, requested_payload, stock_entry_id, tx_type,
  product_id, product_name, quantity, location_id, location_name,
  target_location_id, target_location_name, requested_by_user_id,
  requested_by_name, requested_by_phone, created_at, updated_at
) values (
  '6a000000-0000-4000-8000-000000000001', 'pending-work-stock-1', '{}',
  '64000000-0000-4000-8000-000000000001', 'receive', '63000000-0000-4000-8000-000000000001',
  'Pending Work Product', 2, '61000000-0000-4000-8000-000000000001', 'Pending Work Source',
  '61000000-0000-4000-8000-000000000002', 'Pending Work Target', '62000000-0000-4000-8000-000000000001',
  'Pending Work Manager', '0896100001', '2026-09-28 09:00:00+07', '2026-09-28 09:00:00+07'
);

select extensions.is(
  (select count(*) from private.report_creation_blockers(
    '61000000-0000-4000-8000-000000000004', '2026-09-28 10:00:00+07'
  ) where blocker_key in ('branch_transfer_receipt_pending', 'branch_transfer_delete_pending')),
  0::bigint,
  'bank branch work created after the fixed cutoff is excluded'
);
select extensions.is(
  (select jsonb_agg(jsonb_build_object('key', blocker_key, 'count', item_count))
   from private.report_creation_blockers(
     '61000000-0000-4000-8000-000000000004', '2026-09-28 10:00:01+07'
   )),
  '[{"key":"branch_transfer_receipt_pending","count":1},{"key":"branch_transfer_delete_pending","count":1}]'::jsonb,
  'bank branch work enters the next report operation at cutoff equality'
);

select extensions.is(
  (select jsonb_agg(jsonb_build_object('key', blocker_key, 'count', item_count)) from private.report_creation_blockers('61000000-0000-4000-8000-000000000001', '2026-09-28 10:00:00+07')),
  '[{"key":"rubber_bill_pending","count":1},{"key":"income_expense_approval_pending","count":2},{"key":"cash_transfer_delete_pending","count":1},{"key":"stock_entry_delete_pending","count":1}]'::jsonb,
  'report blockers return all categories, exact counts, cutoff equality, and stable order'
);
select extensions.is(
  (select count(*) from private.report_creation_blockers('61000000-0000-4000-8000-000000000001', '2026-09-28 08:59:59+07')),
  0::bigint, 'items after the fixed cutoff are excluded'
);
select extensions.is(
  (select item_count from private.report_creation_blockers('61000000-0000-4000-8000-000000000001', '2026-09-28 10:00:01+07') where blocker_key = 'income_expense_approval_pending'),
  3::bigint, 'items exactly at a later cutoff enter the next operation'
);
select extensions.is(
  (select jsonb_agg(jsonb_build_object('key', blocker_key, 'count', item_count)) from private.cash_count_start_blockers('61000000-0000-4000-8000-000000000002', '2026-09-28 10:00:00+07')),
  '[{"key":"cash_transfer_delete_pending","count":1},{"key":"stock_entry_delete_pending","count":1},{"key":"cash_transfer_receipt_pending","count":1}]'::jsonb,
  'cash count includes target-side approvals and pending cash receipt once'
);
select extensions.is(
  (select jsonb_agg(blocker_key) from private.report_creation_blockers('61000000-0000-4000-8000-000000000002', '2026-09-28 10:00:00+07')),
  '["cash_transfer_delete_pending","stock_entry_delete_pending"]'::jsonb,
  'ordinary reports exclude pending cash receipt and bank transfers'
);
select extensions.ok(
  not exists (
    select 1 from private.report_creation_blockers('61000000-0000-4000-8000-000000000001', '2026-09-28 10:00:00+07')
    where blocker_key in ('time_payroll_pending', 'rubber_evidence_pending', 'stock_product_approval_pending', 'rubber_export_draft', 'cash_transfer_receipt_pending')
  ),
  'explicitly excluded workflows do not become report blockers'
);

select extensions.is(
  (select item_count from private.report_creation_blockers('61000000-0000-4000-8000-000000000003', '2026-09-28 10:00:01+07') where blocker_key = 'income_expense_approval_pending'),
  1::bigint,
  'current-cutoff blocker query can see approval work created after Cash Count start'
);

select extensions.throws_ok(
  $$ select private.create_report_batch_at('61000000-0000-4000-8000-000000000003', '2026-09-28 10:00:00+07', '62000000-0000-4000-8000-000000000001') $$,
  'P0001', 'PENDING_WORK_BLOCKED',
  'Cash Count submit seam rechecks pending approval work created after the session cutoff'
);

select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok($$ select public.create_report_batch('61000000-0000-4000-8000-000000000001') $$, 'P0001', 'PENDING_WORK_BLOCKED', 'direct report RPC is blocked even when the UI is bypassed');
select extensions.throws_ok($$ select public.start_cash_count_session('61000000-0000-4000-8000-000000000002') $$, 'P0001', 'PENDING_WORK_BLOCKED', 'direct cash count RPC is blocked even when the UI is bypassed');
reset role;

select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok($$ select public.start_cash_count_session('61000000-0000-4000-8000-000000000001') $$, 'P0001', 'ไม่มีสิทธิ์ตรวจนับเงินสดของสาขานี้', 'ordinary users are explicitly denied cash count RPC access');
reset role;

insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  created_by_user_id, created_by_name, created_by_phone, created_at
) values (
  '6b000000-0000-4000-8000-000000000001', 'PW-RPT-1', '2026-09-28', 1,
  '61000000-0000-4000-8000-000000000001', '2026-09-28 10:00:00+07',
  '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001', '2026-09-28 10:00:00+07'
);
insert into public.report_items (report_id, location_id, entity_type, entity_id, eligibility_at)
values
  ('6b000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'income_expense', '65000000-0000-4000-8000-000000000001', '2026-09-28 09:00:00+07'),
  ('6b000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'cash_transfer_sent', '66000000-0000-4000-8000-000000000002', '2026-09-28 09:00:00+07'),
  ('6b000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'acid_stock_entry', '64000000-0000-4000-8000-000000000002', '2026-09-28 09:00:00+07');

select extensions.throws_like(
  $$insert into public.income_expense_approval_requests (requested_operation, request_idempotency_key, requested_payload, source_income_expense_id, matched_reasons, location_id, tx_type, title, cost, requested_by_user_id, requested_by_name, requested_by_phone) values ('delete', 'pending-work-income-reported', '{}', '65000000-0000-4000-8000-000000000001', array['amount_threshold'], '61000000-0000-4000-8000-000000000001', 'expense', 'Reported', 100, '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001')$$,
  'REPORT_LOCKED:PW-RPT-1', 'reported income/expense cannot gain a new pending request'
);
select extensions.throws_like(
  $$insert into public.cash_transfer_delete_requests (transfer_id, source_location_id, source_location_name, target_location_id, target_location_name, transfer_display_no, sent_total, received_total, difference_total, requested_by_user_id, requested_by_name, requested_by_phone) values ('66000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001', 'Pending Work Source', '61000000-0000-4000-8000-000000000002', 'Pending Work Target', 'PW-CASH-2', 20, 0, -20, '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001')$$,
  'REPORT_LOCKED:PW-RPT-1', 'reported cash transfer cannot gain a delete request'
);
select extensions.throws_like(
  $$insert into public.stock_entry_approval_requests (request_idempotency_key, requested_payload, stock_entry_id, tx_type, product_id, product_name, quantity, location_id, location_name, requested_by_user_id, requested_by_name, requested_by_phone) values ('pending-work-stock-reported', '{}', '64000000-0000-4000-8000-000000000002', 'receive', '63000000-0000-4000-8000-000000000001', 'Pending Work Product', 1, '61000000-0000-4000-8000-000000000001', 'Pending Work Source', '62000000-0000-4000-8000-000000000001', 'Pending Work Manager', '0896100001')$$,
  'REPORT_LOCKED:PW-RPT-1', 'reported stock entry cannot gain a delete request'
);

select extensions.ok(exists (select 1 from pg_trigger where tgname = 'guard_pending_income_expense_request' and tgenabled = 'O'), 'income/expense request trigger is enabled');
select extensions.ok(exists (select 1 from pg_trigger where tgname = 'guard_pending_cash_transfer_delete_request' and tgenabled = 'O'), 'cash delete request trigger is enabled');
select extensions.ok(exists (select 1 from pg_trigger where tgname = 'guard_pending_stock_entry_delete_request' and tgenabled = 'O'), 'stock delete request trigger is enabled');

select * from extensions.finish();
rollback;
