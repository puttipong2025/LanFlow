begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(47);

select extensions.has_column(
  'public', 'rubber_bill_approval_settings', 'price_allowance_auto_reset_enabled',
  'auto-reset setting exists'
);
select extensions.col_not_null(
  'public', 'rubber_bill_approval_settings', 'price_allowance_auto_reset_enabled',
  'auto-reset setting is never null'
);
select extensions.is(
  (select column_default from information_schema.columns
   where table_schema = 'public'
     and table_name = 'rubber_bill_approval_settings'
     and column_name = 'price_allowance_auto_reset_enabled'),
  'false',
  'auto-reset defaults to disabled'
);
select extensions.has_function(
  'public', 'save_rubber_price_allowance_auto_reset', array['boolean', 'boolean'],
  'guarded auto-reset save RPC exists'
);
select extensions.has_function(
  'private', 'reset_rubber_price_allowances', array['timestamp with time zone'],
  'private auto-reset worker exists'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.save_rubber_price_allowance_auto_reset(boolean,boolean)',
    'execute'
  ),
  'authenticated callers can reach the guarded save RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.save_rubber_price_allowance_auto_reset(boolean,boolean)',
    'execute'
  ),
  'anonymous callers cannot reach the save RPC'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.reset_rubber_price_allowances(timestamp with time zone)',
    'execute'
  ),
  'client roles cannot execute the worker'
);
select extensions.is(
  (select count(*)::integer from cron.job where jobname = 'rubber-price-allowance-auto-reset'),
  1,
  'exactly one auto-reset Cron job exists'
);
select extensions.is(
  (select schedule from cron.job where jobname = 'rubber-price-allowance-auto-reset'),
  '* * * * *',
  'auto-reset Cron runs every minute'
);
select extensions.ok(
  (select command like '%statement_timeout%reset_rubber_price_allowances%'
   from cron.job where jobname = 'rubber-price-allowance-auto-reset'),
  'Cron command bounds runtime and calls the private worker'
);
select extensions.ok(
  pg_get_functiondef('private.reset_rubber_price_allowances(timestamp with time zone)'::regprocedure)
    like '%pg_advisory_xact_lock(hashtextextended(''rubber-approval-policy'', 0))%'
  and pg_get_functiondef('public.update_rubber_approval_group_v2(uuid,uuid[],integer,numeric,bigint,jsonb)'::regprocedure)
    like '%pg_advisory_xact_lock(hashtextextended(''rubber-approval-policy'', 0))%'
  and pg_get_functiondef('public.save_rubber_price_allowance_auto_reset(boolean,boolean)'::regprocedure)
    like '%pg_advisory_xact_lock(hashtextextended(''rubber-approval-policy'', 0))%',
  'scope edits, toggle saves, and the worker serialize on the same policy lock'
);

delete from public.rubber_approval_group_locations;
delete from public.rubber_approval_groups;

insert into public.locations(id, name, code, is_active)
values
  ('73000000-0000-4000-8000-000000000001', 'Reset Branch A', 'RRA', true),
  ('73000000-0000-4000-8000-000000000002', 'Reset Branch B', 'RRB', true),
  ('73000000-0000-4000-8000-000000000003', 'Reset Branch C', 'RRC', true);

insert into public.profiles(
  id, phone, name, role, is_active, can_access_super_admin_features
)
values (
  '74000000-0000-4000-8000-000000000001',
  '0897400001',
  'Reset System Manager',
  'admin',
  true,
  true
);

insert into public.rubber_approval_groups(
  id, edit_window_minutes, configured_price, price_allowance, revision_no,
  updated_by_user_id, updated_by_name, updated_by_phone, updated_at
)
values
  (
    '75000000-0000-4000-8000-000000000001', 30, 50, 8, 4,
    '74000000-0000-4000-8000-000000000001', 'Reset System Manager', '0897400001',
    '2026-10-13 13:00:00+00'
  ),
  (
    '75000000-0000-4000-8000-000000000002', 30, 49, 7, 5,
    '74000000-0000-4000-8000-000000000001', 'Reset System Manager', '0897400001',
    '2026-10-13 13:00:01+00'
  ),
  (
    '75000000-0000-4000-8000-000000000003', 30, 42, 0, 6,
    '74000000-0000-4000-8000-000000000001', 'Reset System Manager', '0897400001',
    '2026-10-01 00:00:00+00'
  );

insert into public.rubber_approval_group_locations(group_id, location_id)
values
  ('75000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001'),
  ('75000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000002'),
  ('75000000-0000-4000-8000-000000000003', '73000000-0000-4000-8000-000000000003');

update public.rubber_bill_approval_settings
set central_price = 42,
    max_price_allowance = 100,
    ungrouped_price_allowance = 6,
    ungrouped_revision = 10,
    ungrouped_updated_by_user_id = '74000000-0000-4000-8000-000000000001',
    ungrouped_updated_by_name = 'Reset System Manager',
    ungrouped_updated_by_phone = '0897400001',
    ungrouped_updated_at = '2026-10-13 13:00:00+00',
    price_rule_revision = 100,
    price_allowance_auto_reset_enabled = false
where id = true;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.profiles where role = 'super_admin' and is_active = true limit 1),
  true
);
select set_config(
  'request.jwt.claims',
  (select jsonb_build_object('sub', id, 'role', 'authenticated')::text
   from public.profiles where role = 'super_admin' and is_active = true limit 1),
  true
);
set local role authenticated;

select extensions.is(
  public.list_rubber_approval_groups()->>'priceAllowanceAutoResetEnabled',
  'false',
  'management response exposes the disabled setting'
);

reset role;
create temp table disabled_result as
select private.reset_rubber_price_allowances('2026-10-14 13:00:00+00') result;
select extensions.is(
  (select (result->>'groupCount')::integer from disabled_result),
  0,
  'disabled worker resets no groups'
);
select extensions.is(
  (select price_allowance from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000001'),
  8::numeric,
  'disabled worker preserves overdue allowance'
);

select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"74000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$select public.save_rubber_price_allowance_auto_reset(true, false)$$,
  'P0001',
  'FORBIDDEN: เฉพาะ super admin เท่านั้นที่เปิดหรือปิดการรีเซ็ตราคายางอัตโนมัติได้',
  'System Manager cannot change the auto-reset setting'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.profiles where role = 'super_admin' and is_active = true limit 1),
  true
);
select set_config(
  'request.jwt.claims',
  (select jsonb_build_object('sub', id, 'role', 'authenticated')::text
   from public.profiles where role = 'super_admin' and is_active = true limit 1),
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$select public.save_rubber_price_allowance_auto_reset(true, true)$$,
  'P0001',
  'RUBBER_AUTO_RESET_STALE: สถานะการรีเซ็ตอัตโนมัติถูกแก้ไขโดยผู้ใช้อื่น',
  'stale expected toggle is rejected'
);
select extensions.is(
  public.save_rubber_price_allowance_auto_reset(true, false)->>'status',
  'saved',
  'exact super admin enables auto-reset'
);
select extensions.is(
  (select price_allowance_auto_reset_enabled::text
   from public.rubber_bill_approval_settings where id = true),
  'true',
  'enabled value is persisted'
);
select extensions.is(
  public.save_rubber_price_allowance_auto_reset(true, true)->>'status',
  'unchanged',
  'same-value toggle save is a no-op'
);

reset role;
create temp table first_reset_result as
select private.reset_rubber_price_allowances('2026-10-14 13:00:00+00') result;
select extensions.is(
  (select (result->>'groupCount')::integer from first_reset_result),
  1,
  'worker resets the group exactly at 24 elapsed hours'
);
select extensions.is(
  (select (result->>'ungroupedCount')::integer from first_reset_result),
  1,
  'worker resets ungrouped defaults even with no ungrouped branches'
);
select extensions.is(
  (select price_allowance from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000001'),
  0::numeric,
  'overdue group allowance becomes zero'
);
select extensions.is(
  (select configured_price from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000001'),
  42::numeric,
  'denormalized configured price stays equal to central plus zero allowance'
);
select extensions.is(
  (select revision_no from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000001'),
  5::bigint,
  'group revision increments once'
);
select extensions.is(
  (select jsonb_build_object(
    'id', updated_by_user_id,
    'name', updated_by_name,
    'phone', updated_by_phone
  ) from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000001'),
  jsonb_build_object('id', null, 'name', 'ระบบ', 'phone', null),
  'group reset records the system actor and clears user identity'
);
select extensions.is(
  (select updated_at from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000001'),
  '2026-10-14 13:00:00+00'::timestamptz,
  'group reset uses the captured worker time'
);
select extensions.is(
  (select price_allowance from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000002'),
  7::numeric,
  'group newer than 24 hours is preserved'
);
select extensions.is(
  (select revision_no from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000003'),
  6::bigint,
  'zero allowance group is not rewritten'
);
select extensions.is(
  (select jsonb_build_object(
    'allowance', ungrouped_price_allowance,
    'revision', ungrouped_revision,
    'id', ungrouped_updated_by_user_id,
    'name', ungrouped_updated_by_name,
    'phone', ungrouped_updated_by_phone,
    'at', ungrouped_updated_at
  ) from public.rubber_bill_approval_settings where id = true),
  jsonb_build_object(
    'allowance', 0,
    'revision', 11,
    'id', null,
    'name', 'ระบบ',
    'phone', null,
    'at', '2026-10-14 13:00:00+00'::timestamptz
  ),
  'ungrouped reset updates allowance revision actor and time together'
);
select extensions.is(
  (select price_rule_revision from public.rubber_bill_approval_settings where id = true),
  101::bigint,
  'one worker invocation increments the global price revision once'
);

create temp table repeated_result as
select private.reset_rubber_price_allowances('2026-10-14 13:00:00+00') result;
select extensions.is(
  (select (result->>'groupCount')::integer from repeated_result),
  0,
  'repeated worker is idempotent for groups'
);
select extensions.is(
  (select (result->>'ungroupedCount')::integer from repeated_result),
  0,
  'repeated worker is idempotent for ungrouped defaults'
);
select extensions.is(
  (select price_rule_revision from public.rubber_bill_approval_settings where id = true),
  101::bigint,
  'no-op worker preserves the global price revision'
);

create temp table boundary_result as
select private.reset_rubber_price_allowances('2026-10-14 13:00:01+00') result;
select extensions.is(
  (select (result->>'groupCount')::integer from boundary_result),
  1,
  'second group resets when its own 24-hour boundary arrives'
);
select extensions.is(
  (select jsonb_build_object('allowance', price_allowance, 'at', updated_at)
   from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000002'),
  jsonb_build_object('allowance', 0, 'at', '2026-10-14 13:00:01+00'::timestamptz),
  'boundary reset records zero and the fixed worker time'
);

set local role authenticated;
select extensions.is(
  public.save_rubber_price_allowance_auto_reset(false, true)->>'status',
  'saved',
  'super admin disables auto-reset'
);
reset role;
update public.rubber_approval_groups
set configured_price = 51,
    price_allowance = 9,
    revision_no = 20,
    updated_at = '2026-10-01 00:00:00+00'
where id = '75000000-0000-4000-8000-000000000002';
select extensions.is(
  private.reset_rubber_price_allowances('2026-10-14 13:00:02+00')->>'groupCount',
  '0',
  'disabled setting wins when it is committed before the worker lock'
);
select extensions.is(
  (select price_allowance from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000002'),
  9::numeric,
  'disabled race ordering preserves the overdue group'
);

select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"74000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.is(
  public.update_rubber_approval_group_v2(
    '75000000-0000-4000-8000-000000000002',
    array['73000000-0000-4000-8000-000000000002'::uuid],
    31,
    8,
    20,
    '{}'::jsonb
  )->'group'->>'priceAllowance',
  '8.00',
  'a real group edit writes the new allowance and restarts its scope clock'
);
reset role;
create temp table edited_scope_clock as
select updated_at from public.rubber_approval_groups
where id = '75000000-0000-4000-8000-000000000002';
update public.rubber_bill_approval_settings
set price_allowance_auto_reset_enabled = true
where id = true;
select extensions.is(
  private.reset_rubber_price_allowances(
    (select updated_at + interval '23 hours 59 minutes 59 seconds' from edited_scope_clock)
  )->>'groupCount',
  '0',
  'a real scope edit is preserved immediately before its new 24-hour boundary'
);
select extensions.is(
  private.reset_rubber_price_allowances(
    (select updated_at + interval '24 hours' from edited_scope_clock)
  )->>'groupCount',
  '1',
  'the edited scope resets exactly at its new 24-hour boundary'
);
select extensions.is(
  (select jsonb_build_object(
    'allowance', price_allowance,
    'at', updated_at,
    'name', updated_by_name
  ) from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000002'),
  (select jsonb_build_object(
    'allowance', 0,
    'at', updated_at + interval '24 hours',
    'name', 'ระบบ'
  ) from edited_scope_clock),
  'the edited scope records zero, the exact boundary time, and the system actor'
);

update public.rubber_approval_groups
set configured_price = 51,
    price_allowance = 9,
    revision_no = 20,
    updated_at = '2026-10-01 00:00:00+00'
where id = '75000000-0000-4000-8000-000000000002';
update public.rubber_bill_approval_settings
set price_allowance_auto_reset_enabled = true
where id = true;
create function pg_temp.fail_rubber_reset_revision()
returns trigger
language plpgsql
as $$
begin
  raise exception 'TEST_RESET_ROLLBACK';
end
$$;
create trigger fail_rubber_reset_revision
before update of price_rule_revision on public.rubber_bill_approval_settings
for each row execute function pg_temp.fail_rubber_reset_revision();

select extensions.throws_ok(
  $$select private.reset_rubber_price_allowances('2026-10-14 13:00:02+00')$$,
  'P0001',
  'TEST_RESET_ROLLBACK',
  'worker failure rolls the reset transaction back'
);
select extensions.is(
  (select jsonb_build_object('allowance', price_allowance, 'revision', revision_no)
   from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000002'),
  jsonb_build_object('allowance', 9, 'revision', 20),
  'failed worker leaves no partial group reset'
);

drop trigger fail_rubber_reset_revision on public.rubber_bill_approval_settings;
select extensions.is(
  private.reset_rubber_price_allowances('2026-10-14 13:00:02+00')->>'groupCount',
  '1',
  'retry after rollback resets the overdue group once'
);
select extensions.is(
  (select jsonb_build_object(
    'allowance', price_allowance,
    'configuredPrice', configured_price,
    'revision', revision_no,
    'name', updated_by_name
  ) from public.rubber_approval_groups
   where id = '75000000-0000-4000-8000-000000000002'),
  jsonb_build_object(
    'allowance', 0,
    'configuredPrice', 42,
    'revision', 21,
    'name', 'ระบบ'
  ),
  'successful retry restores every group invariant'
);

select * from extensions.finish();
rollback;
