begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(22);

select extensions.has_function(
  'public', 'get_rubber_export_page_ids',
  array['uuid', 'text', 'timestamp with time zone', 'uuid', 'integer', 'text', 'text'],
  'Rubber Export exposes a searchable page RPC'
);
select extensions.has_function(
  'public', 'get_stock_balances', array['uuid'],
  'Stock exposes a complete balance RPC'
);
select extensions.has_function(
  'public', 'get_stock_movement_page',
  array['uuid', 'text', 'text', 'date', 'date', 'date', 'timestamp with time zone', 'text', 'integer'],
  'Stock exposes a searchable movement page RPC'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.get_rubber_export_page_ids(uuid,text,timestamptz,uuid,integer,text,text)', 'execute'),
  'authenticated users can execute the Rubber Export page RPC'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_stock_balances(uuid)', 'execute'),
  'authenticated users can execute the Stock balance RPC'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_stock_movement_page(uuid,text,text,date,date,date,timestamptz,text,integer)', 'execute'),
  'authenticated users can execute the Stock movement RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_rubber_export_page_ids(uuid,text,timestamptz,uuid,integer,text,text)', 'execute'),
  'anonymous users cannot execute the Rubber Export page RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_stock_balances(uuid)', 'execute'),
  'anonymous users cannot execute the Stock balance RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_stock_movement_page(uuid,text,text,date,date,date,timestamptz,text,integer)', 'execute'),
  'anonymous users cannot execute the Stock movement RPC'
);

insert into public.locations (id, name, code, is_active)
values
  ('51000000-0000-4000-8000-000000000001', 'pgTAP List A', 'LSA', true),
  ('51000000-0000-4000-8000-000000000002', 'pgTAP List B', 'LSB', true);

insert into public.profiles (id, phone, name, role, is_active, can_manage_rubber_exports)
values (
  '52000000-0000-4000-8000-000000000001', '0895200001',
  'pgTAP List Manager', 'admin', true, true
);

insert into public.user_locations (user_id, location_id, is_primary)
values (
  '52000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', true
);

insert into public.stock_products (id, name, unit, is_active)
values
  ('53000000-0000-4000-8000-000000000001', 'pgTAP สินค้ามีสต็อก', 'ถัง', true),
  ('53000000-0000-4000-8000-000000000002', 'pgTAP สินค้าศูนย์', 'แพ็ค', true),
  ('53000000-0000-4000-8000-000000000003', 'pgTAP สินค้าปิด', 'ชิ้น', false);

insert into public.stock_entries (
  server_bill_no, tx_date, product_id, product_name, quantity_delta,
  amount, location_id, tx_type, created_by_user_id, created_by_name, created_by_phone, created_at
)
select
  'STOCK-LIST-' || lpad(series::text, 4, '0'),
  date '2026-09-10' - ((series - 1) / 100)::integer,
  '53000000-0000-4000-8000-000000000001', 'pgTAP สินค้ามีสต็อก', 1,
  series, '51000000-0000-4000-8000-000000000001', 'receive',
  '52000000-0000-4000-8000-000000000001', 'pgTAP List Manager', '0895200001',
  timestamptz '2026-09-10 12:00:00+00' - make_interval(secs => series)
from generate_series(1, 1005) series;

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price,
  current_weight, weight_loss_percent, work_rate, other_operating_cost, work_total,
  expense_destination, created_by_user_id, created_by_name, created_by_phone,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count,
  sold_out_at, sold_out_by_user_id, sold_out_by_name, created_at
) values
  (
    '54000000-0000-4000-8000-000000000001', 'REX-LIST-DRAFT', '2026-09-10', 1,
    '51000000-0000-4000-8000-000000000001', 'draft',
    100, 1000, 1000, 10, null, null, null, 0, null, null,
    '52000000-0000-4000-8000-000000000001', 'ผู้สร้างค้นหา', '0895200001',
    null, null, null, null, null, null, null, null, null, null, null,
    '2026-09-10 03:00:00+00'
  ),
  (
    '54000000-0000-4000-8000-000000000002', 'REX-LIST-VERIFIED', '2026-09-10', 2,
    '51000000-0000-4000-8000-000000000001', 'verified',
    100, 1000, 1000, 10, 95, 5, 2, 0, 200, 'branch',
    '52000000-0000-4000-8000-000000000001', 'ผู้สร้างค้นหา', '0895200001',
    '52000000-0000-4000-8000-000000000001', 'ผู้ตรวจ', '0895200001', '2026-09-10 02:00:00+00',
    '2026-09-10 02:00:00+00', 1, 2, 0, null, null, null,
    '2026-09-10 02:00:00+00'
  ),
  (
    '54000000-0000-4000-8000-000000000003', 'REX-LIST-SOLD', '2026-09-10', 3,
    '51000000-0000-4000-8000-000000000001', 'verified',
    100, 1000, 1000, 10, 95, 5, 2, 0, 200, 'external',
    '52000000-0000-4000-8000-000000000001', 'ผู้สร้างขาย', '0895200001',
    '52000000-0000-4000-8000-000000000001', 'ผู้ตรวจ', '0895200001', '2026-09-10 01:00:00+00',
    '2026-09-10 01:00:00+00', 1, 2, 0,
    '2026-09-10 04:00:00+00', '52000000-0000-4000-8000-000000000001', 'ผู้ขาย',
    '2026-09-10 01:00:00+00'
  );

set constraints all immediate;

select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}', true
);
set local role authenticated;

select extensions.is(
  (select count(*)::integer
   from jsonb_array_elements(public.get_stock_balances('51000000-0000-4000-8000-000000000001')) item
   where item->>'productId' = '53000000-0000-4000-8000-000000000002'
     and (item->>'balance')::numeric = 0),
  1,
  'Stock balances include an active product with zero balance'
);
select extensions.is(
  (select (item->>'balance')::numeric
   from jsonb_array_elements(public.get_stock_balances('51000000-0000-4000-8000-000000000001')) item
   where item->>'productId' = '53000000-0000-4000-8000-000000000001'),
  1005::numeric,
  'Stock balance is complete beyond the PostgREST 1,000-row limit'
);
select extensions.is(
  jsonb_array_length(public.get_stock_movement_page(
    '51000000-0000-4000-8000-000000000001', '', 'all', null, null, null, null, null, 10
  )->'rows'),
  10,
  'Stock movement page respects page size'
);
select extensions.throws_ok(
  $$select public.get_stock_movement_page(
    '51000000-0000-4000-8000-000000000001', '', 'all', null, null, null, null, null, null
  )$$,
  'P0001', 'STOCK_INVALID_PAGE_SIZE',
  'Stock movement page rejects a null page size instead of running unbounded'
);
select extensions.ok(
  (public.get_stock_movement_page(
    '51000000-0000-4000-8000-000000000001', '', 'all', null, null, null, null, null, 10
  )->>'hasMore')::boolean,
  'Stock movement page reports more rows'
);
select extensions.is(
  jsonb_array_length(public.get_stock_movement_page(
    '51000000-0000-4000-8000-000000000001', 'STOCK-LIST-1005', 'receive', null, null, null, null, null, 50
  )->'rows'),
  1,
  'Stock movement search and type filter are applied before paging'
);
select extensions.is(
  jsonb_array_length(public.get_stock_movement_page(
    '51000000-0000-4000-8000-000000000001', '', 'all', '2026-09-10', '2026-09-10', null, null, null, 100
  )->'rows'),
  100,
  'Stock date range is inclusive'
);
select extensions.throws_ok(
  $$select public.get_stock_balances('51000000-0000-4000-8000-000000000002')$$,
  'P0001', 'ไม่มีสิทธิ์ดูสต็อกของสาขานี้',
  'Stock balance cannot cross branch scope'
);
select extensions.is(
  public.get_rubber_export_page_ids(
    '51000000-0000-4000-8000-000000000001', 'active', null, null, 50, '', 'draft'
  )->'ids',
  '["54000000-0000-4000-8000-000000000001"]'::jsonb,
  'Rubber Export active draft filter is applied before paging'
);
select extensions.throws_ok(
  $$select public.get_rubber_export_page_ids(
    '51000000-0000-4000-8000-000000000001', 'active', null, null, null, '', 'all'
  )$$,
  'P0001', 'RUBBER_EXPORT_INVALID_PAGE_SIZE',
  'Rubber Export rejects a null page size instead of running unbounded'
);
select extensions.is(
  jsonb_array_length(public.get_rubber_export_page_ids(
    '51000000-0000-4000-8000-000000000001', 'active', null, null, 50, 'ผู้สร้างค้นหา', 'all'
  )->'ids'),
  2,
  'Rubber Export search matches creator name'
);
select extensions.is(
  public.get_rubber_export_page_ids(
    '51000000-0000-4000-8000-000000000001', 'history', null, null, 50, '', 'sold'
  )->'ids',
  '["54000000-0000-4000-8000-000000000003"]'::jsonb,
  'Rubber Export sold history filter is applied before paging'
);
select extensions.throws_ok(
  $$select public.get_rubber_export_page_ids(
    '51000000-0000-4000-8000-000000000001', 'active', null, null, 50, '', 'sold'
  )$$,
  'P0001', 'RUBBER_EXPORT_INVALID_SUBFILTER',
  'Rubber Export rejects a filter outside the selected view'
);

reset role;

select * from extensions.finish();

rollback;
