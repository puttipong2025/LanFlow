begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(25);

select extensions.is(
  (select rubber_alert_threshold_kg from public.dashboard_refresh_settings where id = true),
  10000,
  'rubber alert threshold defaults to 10,000 kg'
);
select extensions.is(
  (select rubber_alert_interval_minutes from public.dashboard_refresh_settings where id = true),
  60,
  'rubber alert interval defaults to 60 minutes'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.dashboard_refresh_settings', 'select'),
  'authenticated cannot read Dashboard settings directly'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_rubber_weight_alert_config()', 'execute'),
  'authenticated can execute the alert config RPC'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_rubber_weight_alert_check()', 'execute'),
  'authenticated can execute the alert check RPC'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.save_rubber_weight_alert_config(integer,integer)', 'execute'),
  'authenticated can execute the guarded alert save RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_rubber_weight_alert_config()', 'execute'),
  'anon cannot execute the alert config RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_rubber_weight_alert_check()', 'execute'),
  'anon cannot execute the alert check RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.save_rubber_weight_alert_config(integer,integer)', 'execute'),
  'anon cannot execute the alert save RPC'
);

insert into public.locations (id, name, code, is_active)
values
  ('41000000-0000-4000-8000-000000000001', 'Alert assigned high', 'AWH', true),
  ('41000000-0000-4000-8000-000000000002', 'Alert assigned equal', 'AWE', true),
  ('41000000-0000-4000-8000-000000000003', 'Alert unassigned higher', 'AWU', true),
  ('41000000-0000-4000-8000-000000000004', 'Alert inactive', 'AWI', false),
  ('41000000-0000-4000-8000-000000000005', 'Alert dirty', 'AWD', true),
  ('41000000-0000-4000-8000-000000000006', 'Alert malformed', 'AWM', true);

insert into public.profiles (
  id, phone, name, role, is_active, can_access_super_admin_features
)
values
  ('42000000-0000-4000-8000-000000000001', '0894200001', 'Alert admin', 'admin', true, false),
  ('42000000-0000-4000-8000-000000000002', '0894200002', 'Alert user', 'user', true, false),
  ('42000000-0000-4000-8000-000000000003', '0894200003', 'Alert manager', 'admin', true, true),
  ('42000000-0000-4000-8000-000000000004', '0894200004', 'Alert inactive admin', 'admin', false, false);

insert into public.user_locations (user_id, location_id, is_primary)
values
  ('42000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', true),
  ('42000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', false),
  ('42000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005', false),
  ('42000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000006', false),
  ('42000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001', true),
  ('42000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000001', true);

insert into public.dashboard_branch_snapshots (
  location_id, status, source_version, snapshot_version, summary, calculated_at
)
values
  ('41000000-0000-4000-8000-000000000001', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":150}}', now()),
  ('41000000-0000-4000-8000-000000000002', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":100}}', now()),
  ('41000000-0000-4000-8000-000000000003', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":200}}', now()),
  ('41000000-0000-4000-8000-000000000004', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":300}}', now()),
  ('41000000-0000-4000-8000-000000000005', 'dirty', 1, 1, '{"rubberRemaining":{"netWeight":400}}', now()),
  ('41000000-0000-4000-8000-000000000006', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":"invalid"}}', now())
on conflict (location_id) do update
set status = excluded.status,
    source_version = excluded.source_version,
    snapshot_version = excluded.snapshot_version,
    summary = excluded.summary,
    calculated_at = excluded.calculated_at;

set constraints all immediate;

select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table alert_saved_config on commit drop as
select public.save_rubber_weight_alert_config(100, 30) as config;

select extensions.is(
  (select (config ->> 'thresholdKg')::integer from alert_saved_config),
  100,
  'a manager saves the global threshold'
);
select extensions.is(
  (select (config ->> 'intervalMinutes')::integer from alert_saved_config),
  30,
  'a manager saves the global interval atomically'
);
select extensions.throws_ok(
  $$select public.save_rubber_weight_alert_config(0, 30)$$,
  'P0001',
  'RUBBER_WEIGHT_ALERT_INVALID: ค่าการแจ้งเตือนไม่ถูกต้อง',
  'threshold below the allowed range is rejected'
);
select extensions.throws_ok(
  $$select public.save_rubber_weight_alert_config(100, 1441)$$,
  'P0001',
  'RUBBER_WEIGHT_ALERT_INVALID: ค่าการแจ้งเตือนไม่ถูกต้อง',
  'interval above the allowed range is rejected'
);

reset role;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$select public.get_rubber_weight_alert_config()$$,
  'P0001',
  'FORBIDDEN: ไม่มีสิทธิ์อ่านค่าการแจ้งเตือนน้ำหนัก',
  'a User cannot read the alert config'
);
select extensions.throws_ok(
  $$select public.get_rubber_weight_alert_check()$$,
  'P0001',
  'FORBIDDEN: ไม่มีสิทธิ์ตรวจการแจ้งเตือนน้ำหนัก',
  'a User cannot run an alert check'
);

reset role;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$select public.save_rubber_weight_alert_config(200, 60)$$,
  'P0001',
  'ไม่มีสิทธิ์จัดการ Dashboard',
  'a regular Admin cannot save global alert config'
);
select extensions.is(
  (public.get_rubber_weight_alert_config() ->> 'thresholdKg')::integer,
  100,
  'a regular Admin reads the current threshold'
);

create temporary table alert_admin_check on commit drop as
select public.get_rubber_weight_alert_check() as payload;

select extensions.is(
  jsonb_array_length((select payload -> 'candidates' from alert_admin_check)),
  1,
  'an Admin sees only assigned ready branches strictly above the threshold'
);
select extensions.is(
  (select payload #>> '{candidates,0,locationId}' from alert_admin_check),
  '41000000-0000-4000-8000-000000000001',
  'the assigned qualifying branch is returned'
);
select extensions.is(
  (select (payload #>> '{candidates,0,netWeight}')::numeric from alert_admin_check),
  150::numeric,
  'the candidate carries the Dashboard remaining net weight'
);
select extensions.results_eq(
  $$
    select key
    from jsonb_object_keys((select payload #> '{candidates,0}' from alert_admin_check)) as key
    order by key
  $$,
  $$values ('locationId'::text), ('locationName'::text), ('netWeight'::text)$$,
  'the candidate exposes only fields consumed by the alert UI'
);

reset role;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table alert_manager_check on commit drop as
select public.get_rubber_weight_alert_check() as payload;

select extensions.is(
  jsonb_array_length((select payload -> 'candidates' from alert_manager_check)),
  2,
  'a system manager sees every active ready qualifying branch'
);
select extensions.is(
  (select (payload #>> '{candidates,0,netWeight}')::numeric from alert_manager_check),
  200::numeric,
  'manager candidates are ordered by highest weight first'
);
select extensions.is(
  (select (payload #>> '{candidates,1,netWeight}')::numeric from alert_manager_check),
  150::numeric,
  'manager candidates preserve descending weight order'
);

reset role;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000004', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$select public.get_rubber_weight_alert_config()$$,
  'P0001',
  'FORBIDDEN: ไม่มีสิทธิ์อ่านค่าการแจ้งเตือนน้ำหนัก',
  'an inactive Admin cannot read the alert config'
);

reset role;
select * from extensions.finish();

rollback;
