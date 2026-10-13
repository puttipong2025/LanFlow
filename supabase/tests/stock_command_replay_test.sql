begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(33);

select extensions.has_function(
  'public',
  'sync_stock_entry',
  array['jsonb'],
  'Stock receive RPC exists'
);

select extensions.has_function(
  'public',
  'transfer_stock',
  array['jsonb'],
  'Stock transfer RPC exists'
);

insert into public.locations (id, name, code, is_active) values
  ('91000000-0000-4000-8000-000000000001', 'pgTAP Stock Replay A', 'SRA', true),
  ('91000000-0000-4000-8000-000000000002', 'pgTAP Stock Replay B', 'SRB', true);

insert into public.profiles (id, phone, name, role, is_active) values
  ('94000000-0000-4000-8000-000000000001', '0894000001', 'pgTAP Stock Actor One', 'admin', true),
  ('94000000-0000-4000-8000-000000000002', '0894000002', 'pgTAP Stock Actor Two', 'admin', true);

insert into public.user_locations (user_id, location_id, is_primary) values
  ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', true),
  ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', false),
  ('94000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', true),
  ('94000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', false);

insert into public.stock_products (id, name, unit, is_active)
values ('92000000-0000-4000-8000-000000000001', 'pgTAP Stock Replay Product', 'ชิ้น', true);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

create temp table stock_replay_results (label text primary key, result jsonb) on commit drop;

insert into stock_replay_results values (
  'receive-first',
  public.sync_stock_entry(jsonb_build_object(
    'action', 'receive',
    'entryId', '93000000-0000-4000-8000-000000000001',
    'locationId', '91000000-0000-4000-8000-000000000001',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 10,
    'amount', 125.50
  ))
);

insert into stock_replay_results values (
  'receive-replay',
  public.sync_stock_entry(jsonb_build_object(
    'action', 'receive',
    'entryId', '93000000-0000-4000-8000-000000000001',
    'locationId', '91000000-0000-4000-8000-000000000001',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 10,
    'amount', 125.50
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'receive-first'), 'synced', 'Receive succeeds');
select extensions.is((select result->>'id' from stock_replay_results where label = 'receive-first'), '93000000-0000-4000-8000-000000000001', 'Receive uses the client entry ID');
select extensions.is((select result->>'id' from stock_replay_results where label = 'receive-replay'), (select result->>'id' from stock_replay_results where label = 'receive-first'), 'Receive replay returns the original entry ID');
select extensions.is((select result->>'serverBillNo' from stock_replay_results where label = 'receive-replay'), (select result->>'serverBillNo' from stock_replay_results where label = 'receive-first'), 'Receive replay returns the original bill number');
select extensions.is((select result->>'serverReceivedAt' from stock_replay_results where label = 'receive-replay'), (select result->>'serverReceivedAt' from stock_replay_results where label = 'receive-first'), 'Receive replay returns the original server time');
select extensions.is((select count(*) from public.stock_entries where id = '93000000-0000-4000-8000-000000000001'), 1::bigint, 'Receive identity creates one entry');

insert into stock_replay_results values (
  'receive-conflict',
  public.sync_stock_entry(jsonb_build_object(
    'action', 'receive',
    'entryId', '93000000-0000-4000-8000-000000000001',
    'locationId', '91000000-0000-4000-8000-000000000001',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 11,
    'amount', 125.50
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'receive-conflict'), 'conflict', 'Changed receive payload conflicts');
select extensions.is((select count(*) from public.stock_entries where location_id = '91000000-0000-4000-8000-000000000001' and tx_type = 'receive'), 1::bigint, 'Receive conflict creates no second entry');

insert into stock_replay_results values (
  'transfer-first',
  public.transfer_stock(jsonb_build_object(
    'action', 'transfer',
    'outId', '93000000-0000-4000-8000-000000000002',
    'inId', '93000000-0000-4000-8000-000000000003',
    'fromLocationId', '91000000-0000-4000-8000-000000000001',
    'toLocationId', '91000000-0000-4000-8000-000000000002',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 2
  ))
);

insert into stock_replay_results values (
  'transfer-replay',
  public.transfer_stock(jsonb_build_object(
    'action', 'transfer',
    'outId', '93000000-0000-4000-8000-000000000002',
    'inId', '93000000-0000-4000-8000-000000000003',
    'fromLocationId', '91000000-0000-4000-8000-000000000001',
    'toLocationId', '91000000-0000-4000-8000-000000000002',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 2
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'transfer-first'), 'synced', 'Transfer succeeds');
select extensions.is((select result->>'outId' from stock_replay_results where label = 'transfer-first'), '93000000-0000-4000-8000-000000000002', 'Transfer uses the client out ID');
select extensions.is((select result->>'inId' from stock_replay_results where label = 'transfer-first'), '93000000-0000-4000-8000-000000000003', 'Transfer uses the client in ID');
select extensions.is((select result->>'outId' from stock_replay_results where label = 'transfer-replay'), (select result->>'outId' from stock_replay_results where label = 'transfer-first'), 'Transfer replay returns the original out ID');
select extensions.is((select result->>'inId' from stock_replay_results where label = 'transfer-replay'), (select result->>'inId' from stock_replay_results where label = 'transfer-first'), 'Transfer replay returns the original in ID');
select extensions.is((select result->>'serverReceivedAt' from stock_replay_results where label = 'transfer-replay'), (select result->>'serverReceivedAt' from stock_replay_results where label = 'transfer-first'), 'Transfer replay returns the original server time');
select extensions.is((select count(*) from public.stock_entries where id in ('93000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003')), 2::bigint, 'Transfer identity creates exactly one pair');

insert into stock_replay_results values (
  'transfer-conflict',
  public.transfer_stock(jsonb_build_object(
    'action', 'transfer',
    'outId', '93000000-0000-4000-8000-000000000002',
    'inId', '93000000-0000-4000-8000-000000000003',
    'fromLocationId', '91000000-0000-4000-8000-000000000001',
    'toLocationId', '91000000-0000-4000-8000-000000000002',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 3
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'transfer-conflict'), 'conflict', 'Changed transfer payload conflicts');
select extensions.is((select count(*) from public.stock_entries where transfer_bill_no = (select result->>'transferBillNo' from stock_replay_results where label = 'transfer-first')), 2::bigint, 'Transfer conflict creates no second pair');

insert into stock_replay_results values (
  'transfer-negative-conflict',
  public.transfer_stock(jsonb_build_object(
    'action', 'transfer',
    'outId', '93000000-0000-4000-8000-000000000002',
    'inId', '93000000-0000-4000-8000-000000000003',
    'fromLocationId', '91000000-0000-4000-8000-000000000001',
    'toLocationId', '91000000-0000-4000-8000-000000000002',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', -2
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'transfer-negative-conflict'), 'conflict', 'Negative transfer quantity cannot replay a positive command');

reset role;
insert into public.stock_entries (
  id, server_bill_no, tx_date, product_id, product_name, quantity_delta,
  amount, location_id, tx_type, transfer_bill_no,
  created_by_user_id, created_by_name, created_by_phone
) values (
  '93000000-0000-4000-8000-000000000004', 'AT-PARTIAL', '2026-10-13',
  '92000000-0000-4000-8000-000000000001', 'pgTAP Stock Replay Product', -1,
  0, '91000000-0000-4000-8000-000000000001', 'transfer_out', 'AT-PARTIAL',
  '94000000-0000-4000-8000-000000000001', 'pgTAP Stock Actor One', '0894000001'
);
set local role authenticated;

insert into stock_replay_results values (
  'transfer-partial',
  public.transfer_stock(jsonb_build_object(
    'action', 'transfer',
    'outId', '93000000-0000-4000-8000-000000000004',
    'inId', '93000000-0000-4000-8000-000000000005',
    'fromLocationId', '91000000-0000-4000-8000-000000000001',
    'toLocationId', '91000000-0000-4000-8000-000000000002',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 1
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'transfer-partial'), 'conflict', 'Partial transfer pair conflicts');
select extensions.is((select count(*) from public.stock_entries where id = '93000000-0000-4000-8000-000000000005'), 0::bigint, 'Partial transfer conflict does not create the missing side');

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"94000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

insert into stock_replay_results values (
  'receive-other-actor',
  public.sync_stock_entry(jsonb_build_object(
    'action', 'receive',
    'entryId', '93000000-0000-4000-8000-000000000001',
    'locationId', '91000000-0000-4000-8000-000000000001',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 10,
    'amount', 125.50
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'receive-other-actor'), 'conflict', 'Another actor cannot replay the receive identity');

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into stock_replay_results values (
  'receive-other-location',
  public.sync_stock_entry(jsonb_build_object(
    'action', 'receive',
    'entryId', '93000000-0000-4000-8000-000000000001',
    'locationId', '91000000-0000-4000-8000-000000000002',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 10,
    'amount', 125.50
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'receive-other-location'), 'conflict', 'Another location cannot replay the receive identity');

select extensions.is(
  public.sync_stock_entry('{"entryId":"not-a-uuid"}'::jsonb)->>'errorMessage',
  'บันทึกสต็อกไม่สำเร็จ',
  'Receive RPC does not expose internal SQL diagnostics'
);

select extensions.is(
  public.transfer_stock('{"outId":"not-a-uuid"}'::jsonb)->>'errorMessage',
  'ย้ายสต็อกไม่สำเร็จ',
  'Transfer RPC does not expose internal SQL diagnostics'
);

select extensions.is(
  public.sync_stock_entry(jsonb_build_object(
    'entryId', '93000000-0000-4000-8000-000000000006',
    'locationId', '91000000-0000-4000-8000-000000000001',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 1,
    'amount', -1
  ))->>'status',
  'failed',
  'Receive RPC rejects a negative amount'
);

select extensions.is(
  public.sync_stock_entry(jsonb_build_object(
    'entryId', '93000000-0000-4000-8000-000000000007',
    'locationId', '91000000-0000-4000-8000-000000000001',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 0.001,
    'amount', 0
  ))->>'status',
  'failed',
  'Receive RPC rejects quantity precision that numeric(12,2) would round'
);

select extensions.is(
  public.transfer_stock(jsonb_build_object(
    'outId', '93000000-0000-4000-8000-000000000008',
    'inId', '93000000-0000-4000-8000-000000000009',
    'fromLocationId', '91000000-0000-4000-8000-000000000001',
    'toLocationId', '91000000-0000-4000-8000-000000000002',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', '2026-10-13',
    'quantity', 0.001
  ))->>'status',
  'failed',
  'Transfer RPC rejects quantity precision that numeric(12,2) would round'
);

insert into stock_replay_results values (
  'receive-infinite-date',
  public.sync_stock_entry(jsonb_build_object(
    'entryId', '93000000-0000-4000-8000-000000000010',
    'locationId', '91000000-0000-4000-8000-000000000001',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', 'infinity',
    'quantity', 1,
    'amount', 0
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'receive-infinite-date'), 'failed', 'Receive RPC rejects an infinite date');
select extensions.is((select count(*) from public.stock_entries where id = '93000000-0000-4000-8000-000000000010'), 0::bigint, 'Infinite receive date creates no entry');

insert into stock_replay_results values (
  'transfer-infinite-date',
  public.transfer_stock(jsonb_build_object(
    'outId', '93000000-0000-4000-8000-000000000011',
    'inId', '93000000-0000-4000-8000-000000000012',
    'fromLocationId', '91000000-0000-4000-8000-000000000001',
    'toLocationId', '91000000-0000-4000-8000-000000000002',
    'productId', '92000000-0000-4000-8000-000000000001',
    'txDate', 'infinity',
    'quantity', 1
  ))
);

select extensions.is((select result->>'status' from stock_replay_results where label = 'transfer-infinite-date'), 'failed', 'Transfer RPC rejects an infinite date');
select extensions.is((select count(*) from public.stock_entries where id in ('93000000-0000-4000-8000-000000000011', '93000000-0000-4000-8000-000000000012')), 0::bigint, 'Infinite transfer date creates no entries');

select * from extensions.finish();
rollback;
