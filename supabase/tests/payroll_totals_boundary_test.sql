begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

insert into public.profiles (id, phone, name, role, is_active)
values ('29000000-0000-4000-8000-000000000001', '0899000001', 'Totals boundary user', 'user', true);

select set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"29000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select extensions.is(
  public.get_time_payroll_user_totals('29000000-0000-4000-8000-000000000001', '2026-09'),
  '{"totalDebt":0,"usedThisMonth":0}'::jsonb,
  'Active employee can read own totals'
);
select extensions.throws_ok(
  $$ select public.get_time_payroll_user_totals('29000000-0000-4000-8000-000000000002', '2026-09') $$,
  'P0001', 'FORBIDDEN: access denied', 'Employee cannot read another profile totals'
);
select extensions.throws_ok(
  $$ select public.get_time_payroll_user_totals('29000000-0000-4000-8000-000000000001', null) $$,
  'P0001', 'INVALID_MONTH', 'Null month is rejected'
);
select extensions.is(
  public.get_time_payroll_debt_totals(), '[]'::jsonb,
  'Employee cannot read manager debt totals'
);

reset role;
update public.profiles set is_active = false where id = '29000000-0000-4000-8000-000000000001';
set local role authenticated;
select extensions.throws_ok(
  $$ select public.get_time_payroll_user_totals('29000000-0000-4000-8000-000000000001', '2026-09') $$,
  'P0001', 'FORBIDDEN: access denied', 'Inactive employee cannot bypass API through totals RPC'
);

reset role;
select * from extensions.finish();
rollback;
