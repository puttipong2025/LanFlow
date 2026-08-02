begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(6);

insert into public.locations (id, name, code, is_active)
values
  ('11000000-0000-4000-8000-000000000001', 'pgTAP Time Payroll A', 'PTPA', true),
  ('11000000-0000-4000-8000-000000000002', 'pgTAP Time Payroll B', 'PTPB', true);

insert into public.profiles (
  id,
  phone,
  name,
  role,
  is_active,
  can_manage_time_payroll
)
values
  ('12000000-0000-4000-8000-000000000001', '0891000001', 'pgTAP delegated manager', 'admin', true, true),
  ('12000000-0000-4000-8000-000000000002', '0891000002', 'pgTAP same branch employee', 'user', true, false),
  ('12000000-0000-4000-8000-000000000003', '0891000003', 'pgTAP other branch employee', 'user', true, false),
  ('12000000-0000-4000-8000-000000000004', '0891000004', 'pgTAP no branch user', 'user', true, false);

insert into public.user_locations (user_id, location_id, is_primary)
values
  ('12000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', true),
  ('12000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', true),
  ('12000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000002', true);

set constraints all immediate;

insert into public.time_segments (id, profile_id, start_time, end_time)
values
  ('13000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', '2026-08-02 01:00:00+00', '2026-08-02 02:00:00+00'),
  ('13000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000002', '2026-08-02 01:00:00+00', '2026-08-02 02:00:00+00'),
  ('13000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000003', '2026-08-02 01:00:00+00', '2026-08-02 02:00:00+00'),
  ('13000000-0000-4000-8000-000000000004', '12000000-0000-4000-8000-000000000004', '2026-08-02 01:00:00+00', '2026-08-02 02:00:00+00');

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  (select count(*) from public.time_segments where profile_id = '12000000-0000-4000-8000-000000000001'),
  1::bigint,
  'delegated manager can read their own time segment'
);

select extensions.is(
  (select count(*) from public.time_segments where profile_id = '12000000-0000-4000-8000-000000000002'),
  1::bigint,
  'delegated manager can read an employee in the same primary branch'
);

select extensions.is(
  (select count(*) from public.time_segments where profile_id = '12000000-0000-4000-8000-000000000003'),
  0::bigint,
  'delegated manager cannot read an employee in another primary branch'
);

reset role;
update public.profiles
set can_manage_time_payroll = false
where id = '12000000-0000-4000-8000-000000000001';
set local role authenticated;

select extensions.is(
  (select count(*) from public.time_segments where profile_id = '12000000-0000-4000-8000-000000000002'),
  0::bigint,
  'revoking delegated access immediately removes employee visibility'
);

reset role;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000004', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  (select count(*) from public.time_segments where profile_id = '12000000-0000-4000-8000-000000000004'),
  1::bigint,
  'a user without a branch keeps self-service visibility'
);

select extensions.is(
  (select count(*) from public.time_segments where profile_id = '12000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a user without a branch cannot read another employee'
);

reset role;
select * from extensions.finish();

rollback;
