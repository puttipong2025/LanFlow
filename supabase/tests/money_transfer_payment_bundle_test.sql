begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations (id, name, code, is_active) values
  ('a1000000-0000-4000-8000-000000000001', 'Payment Bundle Branch', 'PBB', true);

insert into public.profiles (
  id, phone, name, role, is_active,
  can_access_money_transfer, can_manage_rubber_exports
) values (
  'a2000000-0000-4000-8000-000000000001', '0892000001', 'Bundle Manager', 'admin', true,
  true, true
);
insert into public.profiles (id, phone, name, role, is_active, can_access_money_transfer)
values ('a2000000-0000-4000-8000-000000000002', '0892000002', 'Bundle Viewer', 'admin', true, false);

insert into public.user_locations (user_id, location_id, is_primary) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', true),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', true);

insert into public.customers (
  id, main_name, default_location_id, created_by_user_id, created_by_name, created_by_phone,
  client_temp_id, idempotency_key
) values (
  'a3000000-0000-4000-8000-000000000001', 'Bundle Customer',
  'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
  'Bundle Manager', '0892000001', 'bundle-customer', 'bundle-customer'
);

insert into public.customers (
  id, main_name, default_location_id, created_by_user_id, created_by_name, created_by_phone,
  client_temp_id, idempotency_key
)
select ('a3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Bundle Customer ' || n,
  'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
  'Bundle Manager', '0892000001', 'bundle-customer-' || n, 'bundle-customer-' || n
from generate_series(2, 3) n;

insert into public.customer_bank_accounts (customer_id, bank_name, account_name, account_number, is_primary)
values
  ('a3000000-0000-4000-8000-000000000001', 'Bundle Bank', 'Bundle Customer', '111-1', true),
  ('a3000000-0000-4000-8000-000000000002', 'Bundle Bank', 'Bundle Customer', '222-2', true),
  ('a3000000-0000-4000-8000-000000000003', 'Bundle Bank', 'Bundle Customer', '333-3', true);

insert into public.money_transfers (
  id, client_temp_id, idempotency_key, location_id, customer_id, customer_name,
  account_number, account_name, bank_name, net_amount_to_pay, transfer_status,
  sync_status, record_status, created_by_user_id, created_by_name, created_by_phone,
  server_received_at, transfer_type, transfer_method, created_at
) values
  (
    'a4000000-0000-4000-8000-000000000001', 'bundle-child-1', 'bundle-child-1',
    'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001',
    'Bundle Customer', '111-1', 'Bundle Customer', 'Bundle Bank', 100, 'partial',
    'synced', 'active', 'a2000000-0000-4000-8000-000000000001', 'Bundle Manager', '0892000001',
    now(), 'customer', 'bank', '2026-10-01 01:00:00+00'
  ),
  (
    'a4000000-0000-4000-8000-000000000002', 'bundle-child-2', 'bundle-child-2',
    'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001',
    'Bundle Customer', '111-1', 'Bundle Customer', 'Bundle Bank', 200, 'pending',
    'synced', 'active', 'a2000000-0000-4000-8000-000000000001', 'Bundle Manager', '0892000001',
    now(), 'customer', 'bank', '2026-10-02 01:00:00+00'
  ),
  (
    'a4000000-0000-4000-8000-000000000003', 'bundle-dissolve-1', 'bundle-dissolve-1',
    'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002',
    'Bundle Customer', '222-2', 'Bundle Customer', 'Bundle Bank', 0.01, 'pending',
    'synced', 'active', 'a2000000-0000-4000-8000-000000000001', 'Bundle Manager', '0892000001',
    now(), 'customer', 'bank', '2026-10-03 01:00:00+00'
  ),
  (
    'a4000000-0000-4000-8000-000000000004', 'bundle-frozen-1', 'bundle-frozen-1',
    'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003',
    'Bundle Customer', '333-3', 'Bundle Customer', 'Bundle Bank', 10, 'pending',
    'synced', 'active', 'a2000000-0000-4000-8000-000000000001', 'Bundle Manager', '0892000001',
    now(), 'customer', 'bank', '2026-10-04 01:00:00+00'
  );

-- Each customer lifecycle uses two children; one-child bundles are no longer eligible.
insert into public.money_transfers
select (jsonb_populate_record(null::public.money_transfers, to_jsonb(transfer) || jsonb_build_object(
  'id', gen_random_uuid(), 'client_temp_id', transfer.client_temp_id || '-second',
  'idempotency_key', transfer.idempotency_key || '-second'
))).*
from public.money_transfers transfer
where transfer.account_number in ('222-2', '333-3');

insert into public.money_transfer_slips (
  id, transfer_id, amount, transaction_date, sort_order, input_method
) values (
  'a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  40, '2026-10-01 02:00:00+00', 0, 'manual'
);

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select extensions.ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.create_or_update_payment_bundle(uuid,text,uuid,text)'::regprocedure))
    < position('for update' in pg_get_functiondef('public.create_or_update_payment_bundle(uuid,text,uuid,text)'::regprocedure))
  and position('pg_advisory_xact_lock' in pg_get_functiondef('public.dissolve_payment_bundle(uuid,integer)'::regprocedure))
    < position('for update' in pg_get_functiondef('public.dissolve_payment_bundle(uuid,integer)'::regprocedure)),
  'create and dissolve serialize with Report Lock before taking row locks'
);
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select extensions.throws_like($$
  select public.get_payment_bundle_candidates(
    'a1000000-0000-4000-8000-000000000001', 'customer',
    'a3000000-0000-4000-8000-000000000001', '111-1'
  )
$$, 'MT_ACCESS_DENIED:%', 'bundle reads enforce money-transfer module access');
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

select extensions.is(
  (public.get_payment_bundle_candidates(
    'a1000000-0000-4000-8000-000000000001', 'customer',
    'a3000000-0000-4000-8000-000000000001', '111-1'
  )->>'eligibleCount')::integer,
  2,
  'customer candidate preview includes every open matching transfer'
);

select public.create_or_update_payment_bundle(
  'a1000000-0000-4000-8000-000000000001', 'customer',
  'a3000000-0000-4000-8000-000000000001', '111-1'
);

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select extensions.ok(
  (public.get_payment_bundle_detail(
    (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer')
  )->>'id') is not null,
  'a branch report manager can read bundle detail without money-transfer mutation access'
);
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

reset role;
select extensions.is(
  (select count(*)::integer from public.money_transfers
   where is_payment_bundle and transfer_type = 'customer' and record_status = 'active'),
  1,
  'customer bundling creates one parent row'
);
select extensions.is(
  (select count(*)::integer from public.money_transfers
   where bundle_parent_id is not null and id in (
     'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002'
   )),
  2,
  'customer bundling links all matching children'
);
select extensions.is(
  (select net_amount_to_pay from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  260::numeric,
  'bundle due is the sum of child outstanding balances'
);

set local role authenticated;
select extensions.is(
  (public.get_money_transfer_list(
    'a1000000-0000-4000-8000-000000000001', 'all', '', null, null, 100, 'all'
  )->>'rows')::jsonb @> '[{"is_payment_bundle":true}]'::jsonb,
  true,
  'default list returns the bundle parent'
);
select extensions.is(
  jsonb_array_length(public.get_money_transfer_list(
    'a1000000-0000-4000-8000-000000000001', 'all', 'a4000000-0000-4000-8000-000000000001', null, null, 100, 'all'
  )->'rows'),
  1,
  'searching a hidden child resolves to its parent bundle'
);
select extensions.is(
  public.get_money_transfer_list(
    'a1000000-0000-4000-8000-000000000001', 'all', 'a4000000-0000-4000-8000-000000000001', null, null, 100, 'all'
  )->'rows'->0->>'matched_child_id',
  'a4000000-0000-4000-8000-000000000001',
  'child search identifies which bundled child matched'
);

reset role;
select extensions.throws_like($$
  update public.money_transfers set net_amount_to_pay = 999
  where id = 'a4000000-0000-4000-8000-000000000001'
$$, 'MT_BUNDLE_CHILD_LOCKED:%', 'bundled children cannot be edited directly');
select extensions.throws_like($$
  insert into public.money_transfer_slips (
    id, transfer_id, amount, transaction_date, sort_order, input_method
  ) values (
    'a5000000-0000-4000-8000-000000000099', 'a4000000-0000-4000-8000-000000000001',
    1, now(), 1, 'manual'
  )
$$, 'MT_BUNDLE_SLIP_LOCKED:%', 'bundled child slips become read-only');

set local role authenticated;
select public.save_payment_bundle(
  (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  0,
  jsonb_build_array(jsonb_build_object(
    'id', 'a5000000-0000-4000-8000-000000000002',
    'amount', 120,
    'fee', 0,
    'transactionDate', '2026-10-05T02:00:00.000Z',
    'inputMethod', 'manual',
    'sortOrder', 0
  )),
  false
);

select extensions.is(
  (select transfer_status from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  'partial',
  'a partial bundle payment derives partial status'
);
select extensions.ok(
  (select bundle_frozen_at is not null from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  'first bundle slip freezes membership permanently'
);
select extensions.is(
  (public.get_payment_bundle_detail(
    (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer')
  )->'children'->0->>'bundle_allocated_amount')::numeric,
  60::numeric,
  'FIFO allocation fills the oldest child outstanding first'
);
select extensions.is(
  (public.get_payment_bundle_detail(
    (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer')
  )->'children'->1->>'bundle_allocated_amount')::numeric,
  60::numeric,
  'FIFO allocation sends the remainder to the next child'
);
select extensions.throws_like($$
  select public.dissolve_payment_bundle(
    (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer'), 1
  )
$$, 'MT_BUNDLE_HAS_SLIPS:%', 'a bundle with slips cannot be dissolved');

select public.save_payment_bundle(
  (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  1,
  jsonb_build_array(
    jsonb_build_object('id', 'a5000000-0000-4000-8000-000000000003', 'amount', 60, 'fee', 0,
      'transactionDate', '2026-10-05T02:00:00.000Z', 'inputMethod', 'manual', 'sortOrder', 0),
    jsonb_build_object('id', 'a5000000-0000-4000-8000-000000000004', 'amount', 200, 'fee', 0,
      'transactionDate', '2026-10-05T02:01:00.000Z', 'inputMethod', 'manual', 'sortOrder', 1)
  ),
  false
);
select extensions.is(
  (select transfer_status from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  'paid',
  'multiple bundle slips can reach exact paid status'
);

select public.save_payment_bundle(
  (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  2,
  jsonb_build_array(jsonb_build_object(
    'id', 'a5000000-0000-4000-8000-000000000005', 'amount', 300, 'fee', 0,
    'transactionDate', '2026-10-05T02:02:00.000Z', 'inputMethod', 'manual', 'sortOrder', 0
  )),
  false
);
select extensions.is(
  (select transfer_status from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  'overpaid',
  'bundle overpayment remains at the parent level'
);

select public.save_payment_bundle(
  (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  3,
  jsonb_build_array(jsonb_build_object(
    'id', 'a5000000-0000-4000-8000-000000000002',
    'amount', 120,
    'fee', 0,
    'transactionDate', '2026-10-05T02:00:00.000Z',
    'inputMethod', 'manual',
    'sortOrder', 0
  )),
  true
);
reset role;

select extensions.is(
  (select transfer_status from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
  'branch_and_transfer',
  'customer bundle can reach branch-and-transfer terminal status'
);
select extensions.is(
  (select count(*)::integer from private.reportable_items(
    'a1000000-0000-4000-8000-000000000001'::uuid, now()
  ) row_value where row_value.entity_type in ('bank_transfer_source', 'bank_transfer_target')
    and row_value.entity_id = (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer')),
  1,
  'terminal customer bundle is reportable as one row'
);
select extensions.is(
  (select count(*)::integer from private.reportable_items(
    'a1000000-0000-4000-8000-000000000001'::uuid, now()
  ) row_value where row_value.entity_type in ('bank_transfer_source', 'bank_transfer_target')
    and row_value.entity_id in (
      'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002'
    )),
  0,
  'report projection never duplicates bundled children'
);

set local role authenticated;
select public.create_report_batch('a1000000-0000-4000-8000-000000000001');
reset role;
select extensions.ok(
  (select public.report_lock_no(bundle) is not null
   from public.money_transfers bundle where bundle.is_payment_bundle and bundle.transfer_type = 'customer'),
  'a terminal bundle receives Report Lock as one parent row'
);
set local role authenticated;
select extensions.throws_like($$
  select public.save_payment_bundle(
    (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer'),
    4, '[]'::jsonb, false
  )
$$, 'REPORT_LOCKED:%', 'Report Lock blocks editing a bundle');
select extensions.throws_like($$
  select public.dissolve_payment_bundle(
    (select id from public.money_transfers where is_payment_bundle and transfer_type = 'customer'), 4
  )
$$, 'REPORT_LOCKED:%', 'Report Lock blocks dissolving a bundle before slip checks');

select public.create_or_update_payment_bundle(
  'a1000000-0000-4000-8000-000000000001', 'customer',
  'a3000000-0000-4000-8000-000000000002', '222-2'
);
select extensions.throws_like($$
  select public.dissolve_payment_bundle(
    (select id from public.money_transfers where is_payment_bundle and account_number = '222-2'), 999
  )
$$, 'MT_REVISION_CONFLICT:%', 'dissolve rejects a stale expected revision');
select extensions.throws_like($$
  select public.dissolve_payment_bundle(
    (select id from public.money_transfers where is_payment_bundle and account_number = '222-2'), null
  )
$$, 'MT_REVISION_CONFLICT:%', 'dissolve rejects a missing expected revision');
select public.dissolve_payment_bundle(
  (select id from public.money_transfers where is_payment_bundle and account_number = '222-2'), 0
);
reset role;
select extensions.ok(
  (select bundle_parent_id is null from public.money_transfers where id = 'a4000000-0000-4000-8000-000000000003'),
  'dissolving a slip-free bundle unhides its child'
);
select extensions.ok(
  (select record_status = 'deleted' from public.money_transfers where is_payment_bundle and account_number = '222-2'),
  'dissolving marks only the bundle parent deleted'
);

set local role authenticated;
select public.create_or_update_payment_bundle(
  'a1000000-0000-4000-8000-000000000001', 'customer',
  'a3000000-0000-4000-8000-000000000003', '333-3'
);
select public.save_payment_bundle(
  (select id from public.money_transfers where is_payment_bundle and account_number = '333-3'),
  0,
  jsonb_build_array(jsonb_build_object(
    'id', 'a5000000-0000-4000-8000-000000000006', 'amount', 5, 'fee', 0,
    'transactionDate', '2026-10-05T03:00:00.000Z', 'inputMethod', 'manual', 'sortOrder', 0
  )),
  false
);
select public.save_payment_bundle(
  (select id from public.money_transfers where is_payment_bundle and account_number = '333-3'),
  1, '[]'::jsonb, false
);
select extensions.throws_like($$
  select public.dissolve_payment_bundle(
    (select id from public.money_transfers where is_payment_bundle and account_number = '333-3'), 2
  )
$$, 'MT_BUNDLE_FROZEN:%', 'removing every slip does not make a previously paid bundle dissolvable');
reset role;

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price,
  other_operating_cost, created_by_user_id, created_by_name, created_by_phone
) values
  ('a6000000-0000-4000-8000-000000000001', 'REX-BUNDLE-1', '2026-10-10', 1,
   'a1000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0,
   'a2000000-0000-4000-8000-000000000001', 'Bundle Manager', '0892000001'),
  ('a6000000-0000-4000-8000-000000000002', 'REX-BUNDLE-2', '2026-10-11', 2,
   'a1000000-0000-4000-8000-000000000001', 'draft', 100, 1000, 1000, 10, 0,
   'a2000000-0000-4000-8000-000000000001', 'Bundle Manager', '0892000001');

set local role authenticated;
select public.verify_rubber_export_atomic('a6000000-0000-4000-8000-000000000001', 90, 2, 10, 'external');
select public.verify_rubber_export_atomic('a6000000-0000-4000-8000-000000000002', 80, 2, 10, 'external');
select public.create_or_update_payment_bundle(
  'a1000000-0000-4000-8000-000000000001', 'rubber_export_work', null, null
);
reset role;

select extensions.is(
  (select count(*)::integer from public.money_transfers
   where is_payment_bundle and transfer_type = 'rubber_export_work' and record_status = 'active'),
  1,
  'REX bundling uses the same parent model without a source export id'
);
select extensions.is(
  (select count(*)::integer from public.money_transfers
   where transfer_type = 'rubber_export_work' and not is_payment_bundle and bundle_parent_id is not null
     and rubber_export_id in ('a6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000002')),
  2,
  'REX bundle links verified work-transfer children'
);
select extensions.ok(
  (select rubber_export_id is null and customer_id is null and account_number is null
   from public.money_transfers where is_payment_bundle and transfer_type = 'rubber_export_work'),
  'REX bundle parent does not invent a customer, account, or export source'
);
set local role authenticated;
select extensions.throws_like($$
  select public.revert_rubber_export_to_draft('a6000000-0000-4000-8000-000000000001')
$$, 'MT_BUNDLE_DISSOLVE_REQUIRED:%', 'a bundled REX child cannot be reverted behind the bundle');
reset role;

select * from extensions.finish();
rollback;
