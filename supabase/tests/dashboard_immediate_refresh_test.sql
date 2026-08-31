begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(17);

select extensions.ok(
  has_function_privilege('authenticated', 'public.queue_dashboard_refresh(uuid)', 'execute'),
  'authenticated can execute queue_dashboard_refresh'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.queue_dashboard_refresh(uuid)', 'execute'),
  'anon cannot execute queue_dashboard_refresh'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.claim_dashboard_refresh_now(uuid,bigint)', 'execute'),
  'authenticated can execute claim_dashboard_refresh_now'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.claim_dashboard_refresh_now(uuid,bigint)', 'execute'),
  'anon cannot execute claim_dashboard_refresh_now'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.rebuild_dashboard_refresh_now(uuid,bigint)', 'execute'),
  'authenticated can execute rebuild_dashboard_refresh_now'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.rebuild_dashboard_refresh_now(uuid,bigint)', 'execute'),
  'anon cannot execute rebuild_dashboard_refresh_now'
);

insert into public.locations (id, name, code, is_active)
values
  ('21000000-0000-4000-8000-000000000001', 'pgTAP Dashboard assigned', 'PDA', true),
  ('21000000-0000-4000-8000-000000000002', 'pgTAP Dashboard unassigned', 'PDU', true),
  ('21000000-0000-4000-8000-000000000003', 'pgTAP Dashboard inactive', 'PDI', false);

insert into public.profiles (
  id,
  phone,
  name,
  role,
  is_active,
  can_access_super_admin_features
)
values
  ('22000000-0000-4000-8000-000000000001', '0892000001', 'pgTAP assigned admin', 'admin', true, false),
  ('22000000-0000-4000-8000-000000000002', '0892000002', 'pgTAP user', 'user', true, false),
  ('22000000-0000-4000-8000-000000000003', '0892000003', 'pgTAP system manager', 'admin', true, true);

insert into public.user_locations (user_id, location_id, is_primary)
values
  ('22000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', true),
  ('22000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', true);

set constraints all immediate;

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$select public.queue_dashboard_refresh('21000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'ไม่มีสิทธิ์คำนวณ Dashboard สำหรับสาขานี้',
  'a normal user cannot request a Dashboard refresh'
);

reset role;
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$select public.queue_dashboard_refresh('21000000-0000-4000-8000-000000000002')$$,
  'P0001',
  'ไม่มีสิทธิ์คำนวณ Dashboard สำหรับสาขานี้',
  'an Admin cannot request a refresh for an unassigned branch'
);

select extensions.throws_ok(
  $$select public.queue_dashboard_refresh('21000000-0000-4000-8000-000000000003')$$,
  'P0001',
  'ไม่มีสิทธิ์คำนวณ Dashboard สำหรับสาขานี้',
  'an Admin cannot request a refresh for an inactive branch'
);

create temporary table dashboard_first_response on commit drop as
select public.queue_dashboard_refresh('21000000-0000-4000-8000-000000000001') as response;

select extensions.is(
  (select response ->> 'status' from dashboard_first_response),
  'queued',
  'an assigned Admin queues the active branch'
);

select extensions.is(
  (select (response ->> 'requestedVersion')::bigint from dashboard_first_response),
  (select (response ->> 'sourceVersion')::bigint from dashboard_first_response),
  'the requested version covers data committed before the request'
);

create temporary table dashboard_duplicate_response on commit drop as
select public.queue_dashboard_refresh('21000000-0000-4000-8000-000000000001') as response;

select extensions.is(
  (select (response ->> 'requestedVersion')::bigint from dashboard_duplicate_response),
  (select (response ->> 'requestedVersion')::bigint from dashboard_first_response),
  'a duplicate request does not create a newer queued job'
);

create temporary table dashboard_claim_response on commit drop as
select public.claim_dashboard_refresh_now(
  '21000000-0000-4000-8000-000000000001',
  (select (response ->> 'requestedVersion')::bigint from dashboard_first_response)
) as response;

select extensions.is(
  (select response ->> 'status' from dashboard_claim_response),
  'running',
  'the branch-targeted worker claims queued work immediately'
);

select extensions.is(
  (select (response ->> 'claimedVersion')::bigint from dashboard_claim_response),
  (select (response ->> 'requestedVersion')::bigint from dashboard_first_response),
  'the worker claims at least the requested source version'
);

create temporary table dashboard_rebuild_response on commit drop as
select public.rebuild_dashboard_refresh_now(
  '21000000-0000-4000-8000-000000000001',
  (select (response ->> 'claimedVersion')::bigint from dashboard_claim_response)
) as response;

select extensions.ok(
  (select (response ->> 'snapshotVersion')::bigint from dashboard_rebuild_response)
    >= (select (response ->> 'requestedVersion')::bigint from dashboard_first_response),
  'the rebuilt snapshot reaches the requested source version'
);

select extensions.ok(
  (select response -> 'summary' is not null from dashboard_rebuild_response),
  'a successful rebuild returns the calculated summary'
);

reset role;
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.lives_ok(
  $$select public.queue_dashboard_refresh('21000000-0000-4000-8000-000000000002')$$,
  'a system manager can request any active branch'
);

reset role;
select * from extensions.finish();

rollback;
