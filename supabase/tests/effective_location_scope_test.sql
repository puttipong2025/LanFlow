begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(16);

select extensions.ok(
  to_regprocedure('public.get_my_effective_active_location_scope()') is not null,
  'Effective active location scope function exists'
);

select extensions.ok(
  to_regprocedure('public.get_my_active_location_assignments()') is null,
  'Obsolete raw assignment RPC is removed after the effective scope cutover'
);

select extensions.ok(
  to_regprocedure('public.set_user_primary_location(uuid,uuid)') is null,
  'Obsolete piecemeal primary-location RPC is removed after the atomic profile cutover'
);

select extensions.ok(
  to_regprocedure('public.remove_user_location_with_primary_replacement(uuid,uuid,uuid)') is null,
  'Obsolete piecemeal location-removal RPC is removed after the atomic profile cutover'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.get_my_effective_active_location_scope()',
    'execute'
  ),
  'Authenticated clients can read their effective active location scope'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.get_my_effective_active_location_scope()',
    'execute'
  ),
  'Anonymous clients cannot read an effective active location scope'
);

insert into public.locations (id, name, code, is_active)
values
  ('63000000-0000-4000-8000-000000000001', 'Scope active primary', 'SCP1', true),
  ('63000000-0000-4000-8000-000000000002', 'Scope active unassigned', 'SCP2', true),
  ('63000000-0000-4000-8000-000000000003', 'Scope inactive', 'SCP3', false);

insert into public.profiles (
  id,
  phone,
  name,
  role,
  is_active,
  can_access_super_admin_features
)
values
  ('64000000-0000-4000-8000-000000000001', '0864000001', 'Scope system manager', 'admin', true, true),
  ('64000000-0000-4000-8000-000000000002', '0864000002', 'Scope ordinary admin', 'admin', true, false),
  ('64000000-0000-4000-8000-000000000003', '0864000003', 'Scope ordinary user', 'user', true, false),
  ('64000000-0000-4000-8000-000000000004', '0864000004', 'Scope inactive manager', 'admin', false, true);

insert into public.user_locations (user_id, location_id, is_primary)
values
  ('64000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', true),
  ('64000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000001', true),
  ('64000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000001', true),
  ('64000000-0000-4000-8000-000000000004', '63000000-0000-4000-8000-000000000001', true);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  (
    select count(*)
    from public.get_my_effective_active_location_scope()
    where location_id in (
      '63000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000003'
    )
  ),
  2::bigint,
  'Super admin receives every active fixture location'
);

select extensions.is(
  (
    select is_primary
    from public.get_my_effective_active_location_scope()
    where location_id = '63000000-0000-4000-8000-000000000002'
  ),
  false,
  'An unassigned active location is not presented as primary'
);

select extensions.is(
  (
    select count(*)
    from public.get_my_effective_active_location_scope()
    where location_id = '63000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'Inactive locations stay outside the effective scope'
);

reset role;

select extensions.is(
  (
    select count(*)
    from public.user_locations
    where user_id = '00000000-0000-4000-8000-000000000001'
      and location_id = '63000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'Effective access does not create a hidden raw assignment'
);

select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  (
    select count(*)
    from public.get_my_effective_active_location_scope()
    where location_id in (
      '63000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000003'
    )
  ),
  2::bigint,
  'Active system-manager admin receives every active fixture location'
);

select extensions.is(
  (
    select is_primary
    from public.get_my_effective_active_location_scope()
    where location_id = '63000000-0000-4000-8000-000000000001'
  ),
  true,
  'System-manager admin keeps the raw primary assignment'
);

select extensions.is(
  (
    select is_primary
    from public.get_my_effective_active_location_scope()
    where location_id = '63000000-0000-4000-8000-000000000002'
  ),
  false,
  'System-manager global scope does not invent another primary assignment'
);

reset role;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"64000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  (
    select count(*)
    from public.get_my_effective_active_location_scope()
    where location_id in (
      '63000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'Ordinary admin remains limited to assigned active locations'
);

reset role;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"64000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  (
    select count(*)
    from public.get_my_effective_active_location_scope()
    where location_id in (
      '63000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000002'
    )
  ),
  1::bigint,
  'Ordinary user remains limited to assigned active locations'
);

reset role;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"64000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  (select count(*) from public.get_my_effective_active_location_scope()),
  0::bigint,
  'Inactive profile receives no effective location scope'
);

select * from extensions.finish();

rollback;
