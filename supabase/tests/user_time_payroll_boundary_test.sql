begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(15);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.create_stock_product_with_sale_item(jsonb)',
    'execute'
  ),
  'Authenticated clients cannot execute the manager-only stock creation helper directly'
);

insert into public.locations (id, name, code, is_active)
values ('21000000-0000-4000-8000-000000000001', 'pgTAP User Boundary', 'PUB1', true);

insert into public.profiles (id, phone, name, role, is_active)
values
  ('22000000-0000-4000-8000-000000000001', '0892000001', 'pgTAP restricted user', 'user', true),
  ('22000000-0000-4000-8000-000000000002', '0892000002', 'pgTAP assigned admin', 'admin', true),
  ('22000000-0000-4000-8000-000000000003', '0892000003', 'pgTAP other user', 'user', true);

insert into public.user_locations (user_id, location_id, is_primary)
values
  ('22000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', true),
  ('22000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', true);

set constraints all immediate;

insert into public.stock_products (id, name, unit)
values ('23000000-0000-4000-8000-000000000001', 'pgTAP hidden stock product', 'ชิ้น');

insert into public.income_sale_items (id, name)
values ('24000000-0000-4000-8000-000000000001', 'pgTAP hidden sale item');

insert into public.time_segments (id, profile_id, start_time, end_time)
values
  ('25000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '2026-09-01 01:00:00+00', '2026-09-01 02:00:00+00'),
  ('25000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000003', '2026-09-01 01:00:00+00', '2026-09-01 02:00:00+00');

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  private.can_access_business_modules(),
  false,
  'User cannot access business modules'
);

select extensions.is(
  public.can_access_location('21000000-0000-4000-8000-000000000001'),
  false,
  'User cannot turn an assignment into business location access'
);

select extensions.is(
  (select count(*) from public.locations where id = '21000000-0000-4000-8000-000000000001'),
  0::bigint,
  'User cannot read branch rows'
);

select extensions.is(
  (select count(*) from public.stock_products where id = '23000000-0000-4000-8000-000000000001'),
  0::bigint,
  'User cannot read global stock products'
);

select extensions.is(
  (select count(*) from public.income_sale_items where id = '24000000-0000-4000-8000-000000000001'),
  0::bigint,
  'User cannot read global income sale items'
);

select extensions.is(
  (select count(*) from public.time_segments where profile_id = '22000000-0000-4000-8000-000000000001'),
  1::bigint,
  'User keeps own time visibility'
);

select extensions.is(
  (select count(*) from public.time_segments where profile_id = '22000000-0000-4000-8000-000000000003'),
  0::bigint,
  'User cannot read another employee time'
);

select extensions.is(
  (select count(*) from public.get_my_active_location_assignments()),
  1::bigint,
  'Auth bootstrap receives only active assignment metadata'
);

select extensions.is(
  public.create_stock_product_approval_request(jsonb_build_object(
    'requestType', 'create_product',
    'requestIdempotencyKey', 'user-boundary-request',
    'name', 'User must not create this product',
    'unit', 'ชิ้น'
  )) ->> 'status',
  'failed',
  'User cannot bypass the API through the stock approval RPC'
);

reset role;

select extensions.is(
  (select count(*) from public.stock_product_approval_requests where request_idempotency_key = 'user-boundary-request'),
  0::bigint,
  'Rejected User RPC leaves no approval request'
);

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  private.can_access_business_modules(),
  true,
  'Admin keeps business module access'
);

select extensions.is(
  public.can_access_location('21000000-0000-4000-8000-000000000001'),
  true,
  'Assigned Admin keeps branch access'
);

select extensions.is(
  (select count(*) from public.locations where id = '21000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Admin can read the assigned branch'
);

select extensions.is(
  (select count(*) from public.stock_products where id = '23000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Admin can read active stock products'
);

reset role;
select * from extensions.finish();

rollback;
