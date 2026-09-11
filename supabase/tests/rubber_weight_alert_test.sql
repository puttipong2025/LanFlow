begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(41);

select extensions.is(
  (select rubber_alert_threshold_kg from public.dashboard_refresh_settings where id = true),
  10000,
  'legacy threshold remains available for cached clients'
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
  not has_table_privilege('authenticated', 'public.rubber_weight_alert_groups', 'insert'),
  'authenticated cannot write alert groups directly'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.rubber_weight_alert_group_locations', 'insert'),
  'authenticated cannot write alert memberships directly'
);
select extensions.ok(has_function_privilege('authenticated', 'public.get_rubber_weight_alert_config()', 'execute'), 'authenticated can execute config RPC');
select extensions.ok(has_function_privilege('authenticated', 'public.get_rubber_weight_alert_check()', 'execute'), 'authenticated can execute check RPC');
select extensions.ok(has_function_privilege('authenticated', 'public.list_rubber_weight_alert_groups()', 'execute'), 'authenticated can execute guarded list RPC');
select extensions.ok(has_function_privilege('authenticated', 'public.create_rubber_weight_alert_group(uuid[],integer)', 'execute'), 'authenticated can execute guarded create RPC');
select extensions.ok(has_function_privilege('authenticated', 'public.update_rubber_weight_alert_group(uuid,uuid[],integer)', 'execute'), 'authenticated can execute guarded update RPC');
select extensions.ok(has_function_privilege('authenticated', 'public.delete_rubber_weight_alert_group(uuid)', 'execute'), 'authenticated can execute guarded delete RPC');
select extensions.ok(has_function_privilege('authenticated', 'public.save_rubber_weight_alert_interval(integer)', 'execute'), 'authenticated can execute guarded interval RPC');
select extensions.ok(not has_function_privilege('anon', 'public.get_rubber_weight_alert_check()', 'execute'), 'anon cannot execute check RPC');
select extensions.ok(not has_function_privilege('anon', 'public.list_rubber_weight_alert_groups()', 'execute'), 'anon cannot execute group list RPC');
select extensions.ok(not has_function_privilege('anon', 'public.save_rubber_weight_alert_interval(integer)', 'execute'), 'anon cannot execute interval RPC');

insert into public.locations (id, name, code, is_active)
values
  ('41000000-0000-4000-8000-000000000001', 'Alert assigned high', 'AWH', true),
  ('41000000-0000-4000-8000-000000000002', 'Alert assigned equal', 'AWE', true),
  ('41000000-0000-4000-8000-000000000003', 'Alert unassigned higher', 'AWU', true),
  ('41000000-0000-4000-8000-000000000004', 'Alert inactive member', 'AWI', false),
  ('41000000-0000-4000-8000-000000000005', 'Alert dirty', 'AWD', true),
  ('41000000-0000-4000-8000-000000000006', 'Alert malformed', 'AWM', true),
  ('41000000-0000-4000-8000-000000000007', 'Alert active ungrouped', 'AWG', true);

insert into public.profiles (id, phone, name, role, is_active, can_access_super_admin_features)
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

insert into public.rubber_weight_alert_groups (id, threshold_kg, created_at)
values
  ('43000000-0000-4000-8000-000000000001', 100, '2100-01-01 00:00:01+00'),
  ('43000000-0000-4000-8000-000000000002', 150, '2100-01-01 00:00:02+00');

insert into public.rubber_weight_alert_group_locations (group_id, location_id)
values
  ('43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001'),
  ('43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002'),
  ('43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000004'),
  ('43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000005'),
  ('43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000006'),
  ('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000003');

insert into public.dashboard_branch_snapshots (location_id, status, source_version, snapshot_version, summary, calculated_at)
values
  ('41000000-0000-4000-8000-000000000001', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":150}}', now()),
  ('41000000-0000-4000-8000-000000000002', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":100}}', now()),
  ('41000000-0000-4000-8000-000000000003', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":200}}', now()),
  ('41000000-0000-4000-8000-000000000004', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":300}}', now()),
  ('41000000-0000-4000-8000-000000000005', 'dirty', 1, 1, '{"rubberRemaining":{"netWeight":400}}', now()),
  ('41000000-0000-4000-8000-000000000006', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":"invalid"}}', now()),
  ('41000000-0000-4000-8000-000000000007', 'ready', 1, 1, '{"rubberRemaining":{"netWeight":500}}', now())
on conflict (location_id) do update
set status = excluded.status, source_version = excluded.source_version,
    snapshot_version = excluded.snapshot_version, summary = excluded.summary,
    calculated_at = excluded.calculated_at;

set constraints all immediate;
set constraints all deferred;

select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"42000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;

select extensions.is((public.save_rubber_weight_alert_interval(30) ->> 'intervalMinutes')::integer, 30, 'manager saves the central interval');
select extensions.throws_ok(
  $$select public.save_rubber_weight_alert_interval(1441)$$,
  'P0001',
  'RUBBER_WEIGHT_ALERT_INVALID: รอบตรวจต้องอยู่ระหว่าง 1–1,440 นาที',
  'interval above the allowed range is rejected'
);
select extensions.ok(jsonb_array_length(public.list_rubber_weight_alert_groups() -> 'groups') >= 2, 'manager lists alert groups');

create temporary table created_alert_group on commit drop as
select public.create_rubber_weight_alert_group(
  array['41000000-0000-4000-8000-000000000007']::uuid[], 250
) payload;
select extensions.is((select payload ->> 'thresholdKg' from created_alert_group), '250', 'manager creates a group with its threshold');
select extensions.ok(
  not (public.list_rubber_weight_alert_groups() -> 'availableLocationIds') ? '41000000-0000-4000-8000-000000000007',
  'a grouped branch leaves the ungrouped list'
);
select extensions.is(
  (select count(*)::integer from public.rubber_weight_alert_groups where id = '43000000-0000-4000-8000-000000000001'),
  1,
  'manager RLS can read alert groups'
);
select extensions.is(
  (public.delete_rubber_weight_alert_group((select (payload ->> 'id')::uuid from created_alert_group)) ->> 'success')::boolean,
  true,
  'manager deletes a group and releases its branch'
);

reset role;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"42000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok($$select public.get_rubber_weight_alert_config()$$, 'P0001', 'FORBIDDEN: ไม่มีสิทธิ์อ่านค่าการแจ้งเตือนน้ำหนัก', 'User cannot read alert config');
select extensions.throws_ok($$select public.get_rubber_weight_alert_check()$$, 'P0001', 'FORBIDDEN: ไม่มีสิทธิ์ตรวจการแจ้งเตือนน้ำหนัก', 'User cannot run alert check');

reset role;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok($$select public.list_rubber_weight_alert_groups()$$, 'P0001', 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนน้ำหนัก', 'regular Admin cannot list groups');
select extensions.throws_ok(
  $$select public.create_rubber_weight_alert_group(array['41000000-0000-4000-8000-000000000007']::uuid[], 100)$$,
  'P0001', 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนน้ำหนัก', 'regular Admin cannot create groups'
);
select extensions.throws_ok($$select public.save_rubber_weight_alert_interval(60)$$, 'P0001', 'ไม่มีสิทธิ์จัดการ Dashboard', 'regular Admin cannot save interval');
select extensions.is((public.get_rubber_weight_alert_config() ->> 'thresholdKg')::integer, 10000, 'regular Admin still reads compatible legacy config');

create temporary table alert_admin_check on commit drop as select public.get_rubber_weight_alert_check() payload;
select extensions.is(jsonb_array_length((select payload -> 'candidates' from alert_admin_check)), 1, 'Admin sees only assigned ready branch strictly above its group threshold');
select extensions.is((select payload #>> '{candidates,0,locationId}' from alert_admin_check), '41000000-0000-4000-8000-000000000001', 'assigned qualifying branch is returned');
select extensions.is((select (payload #>> '{candidates,0,thresholdKg}')::integer from alert_admin_check), 100, 'candidate carries its group threshold');
select extensions.is((select payload #>> '{candidates,0,groupId}' from alert_admin_check), '43000000-0000-4000-8000-000000000001', 'candidate carries its alert group');
select extensions.ok((select (payload #>> '{candidates,0,groupOrder}')::integer > 0 from alert_admin_check), 'candidate carries a global positive group order');
select extensions.results_eq(
  $$select key from jsonb_object_keys((select payload #> '{candidates,0}' from alert_admin_check)) key order by key$$,
  $$values ('groupId'::text), ('groupOrder'::text), ('locationId'::text), ('locationName'::text), ('netWeight'::text), ('thresholdKg'::text)$$,
  'candidate exposes group metadata and branch values'
);

reset role;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"42000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
create temporary table alert_manager_check on commit drop as select public.get_rubber_weight_alert_check() payload;
select extensions.is(jsonb_array_length((select payload -> 'candidates' from alert_manager_check)), 2, 'manager sees qualifying branches from both groups only');
select extensions.is((select payload #>> '{candidates,0,locationId}' from alert_manager_check), '41000000-0000-4000-8000-000000000001', 'group order is applied before weight order across groups');
select extensions.is((select payload #>> '{candidates,1,locationId}' from alert_manager_check), '41000000-0000-4000-8000-000000000003', 'second qualifying group follows global order');
select extensions.ok(
  (select (payload #>> '{candidates,0,groupOrder}')::integer < (payload #>> '{candidates,1,groupOrder}')::integer from alert_manager_check),
  'group numbers are globally ordered'
);

select public.update_rubber_weight_alert_group(
  '43000000-0000-4000-8000-000000000001',
  array['41000000-0000-4000-8000-000000000001']::uuid[],
  125
);
select extensions.ok(
  exists (
    select 1 from public.rubber_weight_alert_group_locations
    where group_id = '43000000-0000-4000-8000-000000000001'
      and location_id = '41000000-0000-4000-8000-000000000004'
  ),
  'updating a group retains its inactive member'
);
select extensions.throws_ok(
  $$select public.update_rubber_weight_alert_group('43000000-0000-4000-8000-000000000002', array['41000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000004']::uuid[], 150)$$,
  'P0001',
  'RUBBER_LOCATION_NOT_FOUND: ไม่พบสาขาที่เปิดใช้งาน',
  'an inactive branch cannot be newly added to another group'
);

reset role;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"42000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok($$select public.get_rubber_weight_alert_config()$$, 'P0001', 'FORBIDDEN: ไม่มีสิทธิ์อ่านค่าการแจ้งเตือนน้ำหนัก', 'inactive Admin cannot read alert config');

reset role;
select * from extensions.finish();
rollback;
