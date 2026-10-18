begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
delete from public.rubber_weight_alert_group_locations;
delete from public.rubber_weight_alert_groups;

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


insert into public.cash_alert_groups (id, threshold_amount) values ('44000000-0000-4000-8000-000000000001', -10.12);
insert into public.cash_alert_group_locations(group_id, location_id)
select '44000000-0000-4000-8000-000000000001', id from public.locations where id::text like '41000000-%' and code <> 'AWG';
update public.dashboard_branch_snapshots set summary = summary || '{"netCashFlow":-10.13}'::jsonb where location_id::text like '41000000-%';
update public.dashboard_branch_snapshots set summary = summary || '{"netCashFlow":-10.12}'::jsonb where location_id='41000000-0000-4000-8000-000000000002';
update public.dashboard_branch_snapshots set summary = summary || '{"netCashFlow":null}'::jsonb where location_id='41000000-0000-4000-8000-000000000006';
set constraints all immediate;
set constraints all deferred;
select extensions.ok(not has_function_privilege('anon','public.get_branch_threshold_alert_check()','execute'), 'anonymous denied');
select extensions.ok(not has_table_privilege('authenticated','public.cash_alert_groups','insert'), 'direct insert denied');
select set_config('request.jwt.claim.sub','42000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.is((public.get_branch_threshold_alert_check()->>'configuredCount')::integer,8,'admin scope only four assigned branches in two independent groups');
select extensions.is((public.get_branch_threshold_alert_check()->>'checkedCount')::integer,4,'dirty and malformed metrics excluded');
select extensions.is(jsonb_array_length(public.get_branch_threshold_alert_check()->'candidates'),2,'one money and one weight candidate; equality excluded');
select extensions.is(jsonb_array_length(public.get_branch_threshold_alert_check()->'unavailable'),4,'unavailable preserved by type');
select extensions.throws_ok($$select public.list_cash_alert_groups()$$,'P0001','FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มแจ้งเตือนเงิน','admin cannot manage');
select set_config('request.jwt.claim.sub','42000000-0000-4000-8000-000000000002',true);
select extensions.throws_ok($$select public.get_branch_threshold_alert_check()$$,'P0001','FORBIDDEN: ไม่มีสิทธิ์ตรวจการแจ้งเตือน','user cannot read');
select set_config('request.jwt.claim.sub','42000000-0000-4000-8000-000000000004',true);
select extensions.throws_ok($$select public.get_branch_threshold_alert_check()$$,'P0001','FORBIDDEN: ไม่มีสิทธิ์ตรวจการแจ้งเตือน','inactive cannot read');
select set_config('request.jwt.claim.sub','42000000-0000-4000-8000-000000000003',true);
select extensions.ok(jsonb_array_length(public.list_cash_alert_groups()->'groups') >= 1,'manager lists groups');
select extensions.ok(exists(select 1 from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') c where c->>'locationId'='41000000-0000-4000-8000-000000000003'),'manager sees unassigned active branch');
select extensions.ok(not exists(select 1 from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') c where c->>'locationId' in ('41000000-0000-4000-8000-000000000004','41000000-0000-4000-8000-000000000007')),'inactive and ungrouped excluded');
select extensions.throws_ok($$select public.create_cash_alert_group(array['41000000-0000-4000-8000-000000000007']::uuid[],0.001)$$,'P0001',null,'fractional cents rejected at RPC');
select extensions.throws_ok($$select public.create_cash_alert_group(array['41000000-0000-4000-8000-000000000007']::uuid[],10000000000)$$,'P0001',null,'out of range rejected');
select extensions.throws_ok($$select public.create_cash_alert_group(array[]::uuid[],0)$$,'P0001',null,'empty rejected');
select extensions.throws_ok($$select public.create_cash_alert_group(array['41000000-0000-4000-8000-000000000001']::uuid[],0)$$,'P0001',null,'branch conflict rejected');
create temporary table test_cash_group as select public.create_cash_alert_group(array['41000000-0000-4000-8000-000000000007']::uuid[],0) as data;
select extensions.is((select (data->>'thresholdAmount')::numeric from test_cash_group),0::numeric,'zero accepted');
select extensions.ok((public.update_cash_alert_group('44000000-0000-4000-8000-000000000001',array['41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000005','41000000-0000-4000-8000-000000000006']::uuid[],-10.12)->'locationIds') ? '41000000-0000-4000-8000-000000000004','editing retains inactive old member');
select extensions.throws_ok($$select public.create_cash_alert_group(array['41000000-0000-4000-8000-000000000004']::uuid[],0)$$,'P0001',null,'cannot add inactive branch');

select extensions.is((public.update_cash_alert_group((select (data->>'id')::uuid from test_cash_group),array['41000000-0000-4000-8000-000000000007']::uuid[],12.34)->>'thresholdAmount')::numeric,12.34::numeric,'positive cents accepted');
select extensions.ok((public.delete_cash_alert_group((select (data->>'id')::uuid from test_cash_group))->>'success')::boolean,'delete releases members');
reset role;
update public.dashboard_branch_snapshots set summary = summary || '{"netCashFlow":-100}'::jsonb where location_id='41000000-0000-4000-8000-000000000003';
update public.dashboard_branch_snapshots set summary = summary || '{"rubberRemaining":{"netWeight":1000}}'::jsonb where location_id='41000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','42000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select extensions.is((select c->>'locationId' from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') c where c->>'kind'='cash' and c->>'groupId'='44000000-0000-4000-8000-000000000001' limit 1),'41000000-0000-4000-8000-000000000003','lowest cash is first in group');
select extensions.is((select c->>'locationId' from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') c where c->>'kind'='weight' and c->>'groupId'='43000000-0000-4000-8000-000000000001' limit 1),'41000000-0000-4000-8000-000000000002','highest weight remains first in group');
reset role;
delete from public.dashboard_branch_snapshots where location_id='41000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','42000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.ok(exists(select 1 from jsonb_array_elements(public.get_branch_threshold_alert_check()->'unavailable') c where c->>'reason'='missing_snapshot'),'missing snapshot reported');
reset role;
select extensions.throws_ok($$insert into public.cash_alert_groups(threshold_amount) values(0.001)$$,'23514',null,'table rejects fractional cents');
select * from extensions.finish();
rollback;
