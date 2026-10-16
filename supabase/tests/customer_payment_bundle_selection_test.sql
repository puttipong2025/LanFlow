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


update public.money_transfers set account_number = 'old-second'
where id = 'a4000000-0000-4000-8000-000000000002';
insert into public.customer_bank_accounts (customer_id, bank_name, account_name, account_number, is_primary)
values ('a3000000-0000-4000-8000-000000000001', 'Other Bank', 'Other Account', 'alternate', false);

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select extensions.ok(to_regprocedure('public.merge_pending_money_transfers(uuid)') is null,
  'the destructive merge RPC is retired');

select extensions.is(
  jsonb_array_length(public.get_payment_bundle_customer_options('a1000000-0000-4000-8000-000000000001')),
  1, 'customer choices exclude singletons and never combine distinct customer identities');
select extensions.is(
  (public.get_payment_bundle_candidates('a1000000-0000-4000-8000-000000000001', 'customer',
    'a3000000-0000-4000-8000-000000000001', null)->>'eligibleCount')::integer,
  2, 'preview includes the same customer across different original accounts');
select extensions.throws_like($$
  select public.create_or_update_payment_bundle('a1000000-0000-4000-8000-000000000001',
    'customer', 'a3000000-0000-4000-8000-000000000002', '222-2')
$$, 'MT_BUNDLE_MIN_CHILDREN:%', 'one customer row cannot create a bundle');
select extensions.is(
  (select count(*)::integer from public.money_transfers where is_payment_bundle), 0,
  'rejected singleton leaves no parent or hidden child');
select extensions.throws_like($$
  select public.create_or_update_payment_bundle('a1000000-0000-4000-8000-000000000001',
    'customer', 'a3000000-0000-4000-8000-000000000001', '222-2')
$$, 'MT_BUNDLE_INVALID_ACCOUNT:%', 'another customer account cannot be used as the destination');

select public.create_or_update_payment_bundle('a1000000-0000-4000-8000-000000000001',
  'customer', 'a3000000-0000-4000-8000-000000000001', null);
select extensions.is(
  (select account_number from public.money_transfers where is_payment_bundle), '111-1',
  'the parent defaults to the registered primary account');
select extensions.is(
  (select count(distinct account_number)::integer from public.money_transfers where bundle_parent_id is not null), 2,
  'bundling preserves both original child account snapshots');

select public.create_or_update_payment_bundle('a1000000-0000-4000-8000-000000000001',
  'customer', 'a3000000-0000-4000-8000-000000000001', 'alternate');
select extensions.is(
  (select count(*)::integer from public.money_transfers where is_payment_bundle), 1,
  'changing the destination before payment reuses the existing customer bundle');
select extensions.is(
  (select account_number from public.money_transfers where is_payment_bundle), 'alternate',
  'a different registered account can be chosen like a normal transfer');

select set_config('test.bundle_revision', (select revision_no::text from public.money_transfers where is_payment_bundle), true);
select public.create_or_update_payment_bundle('a1000000-0000-4000-8000-000000000001',
  'customer', 'a3000000-0000-4000-8000-000000000001', 'alternate');
select extensions.is(
  (select revision_no from public.money_transfers where is_payment_bundle),
  current_setting('test.bundle_revision')::integer,
  'an unchanged destination retry does not create a revision conflict');
reset role;
update public.customer_bank_accounts set account_name = 'Updated Recipient'
where customer_id = 'a3000000-0000-4000-8000-000000000001' and account_number = 'alternate';
set local role authenticated;
select public.create_or_update_payment_bundle('a1000000-0000-4000-8000-000000000001',
  'customer', 'a3000000-0000-4000-8000-000000000001', 'alternate');
select extensions.is(
  (select account_name from public.money_transfers where is_payment_bundle), 'Updated Recipient',
  'reusing an unpaid bundle refreshes the destination account snapshot');
select extensions.is(
  (select revision_no from public.money_transfers where is_payment_bundle),
  current_setting('test.bundle_revision')::integer + 1,
  'a recipient-name change advances the bundle revision even when the account number is unchanged');
select extensions.throws_like($$
  select public.save_payment_bundle(
    (select id from public.money_transfers where is_payment_bundle),
    current_setting('test.bundle_revision')::integer, '[]'::jsonb, false)
$$, 'MT_REVISION_CONFLICT:%', 'a stale destination snapshot cannot be saved');

select set_config('test.bundle_revision', (select revision_no::text from public.money_transfers where is_payment_bundle), true);
reset role;
update public.customer_bank_accounts set bank_name = 'Updated Bank'
where customer_id = 'a3000000-0000-4000-8000-000000000001' and account_number = 'alternate';
set local role authenticated;
select public.create_or_update_payment_bundle('a1000000-0000-4000-8000-000000000001',
  'customer', 'a3000000-0000-4000-8000-000000000001', 'alternate');
select extensions.is(
  (select revision_no from public.money_transfers where is_payment_bundle),
  current_setting('test.bundle_revision')::integer + 1,
  'a bank-name-only change also advances the destination revision');

select public.dissolve_payment_bundle(
  (select id from public.money_transfers where is_payment_bundle),
  (select revision_no from public.money_transfers where is_payment_bundle));
reset role;
delete from public.customer_bank_accounts where customer_id = 'a3000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.create_or_update_payment_bundle('a1000000-0000-4000-8000-000000000001',
  'customer', 'a3000000-0000-4000-8000-000000000001', null);
select extensions.ok(
  (select account_number is null from public.money_transfers where is_payment_bundle and record_status = 'active'),
  'a customer with no registered account is allowed without requiring a primary account');
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select extensions.throws_like($$
  select public.get_payment_bundle_customer_options('a1000000-0000-4000-8000-000000000001')
$$, 'MT_ACCESS_DENIED:%', 'eligible customer discovery enforces module access');
select * from extensions.finish();
rollback;
