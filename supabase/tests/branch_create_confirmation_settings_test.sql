begin;
select extensions.plan(11);

select extensions.ok(
  to_regclass('public.branch_create_guard_settings') is not null,
  'branch create guard setting table exists'
);
select extensions.is(
  (select confirmation_minutes from public.branch_create_guard_settings where singleton),
  15,
  'default confirmation duration is 15 minutes'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_branch_create_confirmation_minutes()', 'execute'),
  'active authenticated accounts can call the read RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_branch_create_confirmation_minutes()', 'execute'),
  'anonymous accounts cannot call the read RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.save_branch_create_confirmation_minutes(integer)', 'execute'),
  'anonymous accounts cannot call the save RPC'
);

insert into public.locations(id, name, code, is_active)
values ('61000000-0000-4000-8000-000000000001', 'pgTAP Branch Guard', 'BG01', true);
insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values
  ('62000000-0000-4000-8000-000000000001', '0896000001', 'pgTAP guard manager', 'admin', true, true),
  ('62000000-0000-4000-8000-000000000002', '0896000002', 'pgTAP guard admin', 'admin', true, false),
  ('62000000-0000-4000-8000-000000000003', '0896000003', 'pgTAP guard inactive', 'admin', false, true);

select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select extensions.is(public.get_branch_create_confirmation_minutes(), 15, 'an active Admin can read');
select extensions.throws_ok(
  $$select public.save_branch_create_confirmation_minutes(30)$$,
  'P0001', 'FORBIDDEN: ไม่มีสิทธิ์เปลี่ยนระยะยืนยันสาขา',
  'an ordinary Admin cannot save'
);
reset role;

select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.get_branch_create_confirmation_minutes()$$,
  'P0001', 'FORBIDDEN: ไม่มีสิทธิ์อ่านระยะยืนยันสาขา',
  'an inactive account cannot read'
);
reset role;

select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.is(public.save_branch_create_confirmation_minutes(30), 30, 'a System Manager can save');
select extensions.throws_ok(
  $$select public.save_branch_create_confirmation_minutes(121)$$,
  'P0001', 'BRANCH_CONFIRMATION_INVALID: ระยะยืนยันสาขาต้องอยู่ระหว่าง 1 ถึง 120 นาที',
  'the save RPC rejects out-of-range values'
);
reset role;

select extensions.is(
  (select confirmation_minutes from public.branch_create_guard_settings where singleton),
  30,
  'the confirmed value is saved'
);

select * from extensions.finish();
rollback;
