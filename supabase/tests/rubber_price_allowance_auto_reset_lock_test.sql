begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(41);

select extensions.has_column(
  'public', 'rubber_approval_groups', 'price_allowance_auto_reset_locked',
  'group auto-reset lock exists'
);
select extensions.col_not_null(
  'public', 'rubber_approval_groups', 'price_allowance_auto_reset_locked',
  'group auto-reset lock is never null'
);
select extensions.is(
  (select column_default from information_schema.columns
   where table_schema = 'public'
     and table_name = 'rubber_approval_groups'
     and column_name = 'price_allowance_auto_reset_locked'),
  'false',
  'group auto-reset lock defaults to false'
);
select extensions.has_column(
  'public', 'rubber_bill_approval_settings', 'ungrouped_price_allowance_auto_reset_locked',
  'ungrouped auto-reset lock exists'
);
select extensions.col_not_null(
  'public', 'rubber_bill_approval_settings', 'ungrouped_price_allowance_auto_reset_locked',
  'ungrouped auto-reset lock is never null'
);
select extensions.is(
  (select column_default from information_schema.columns
   where table_schema = 'public'
     and table_name = 'rubber_bill_approval_settings'
     and column_name = 'ungrouped_price_allowance_auto_reset_locked'),
  'false',
  'ungrouped auto-reset lock defaults to false'
);
select extensions.has_function(
  'public', 'save_rubber_price_allowance_auto_reset_lock',
  array['text', 'uuid', 'boolean', 'boolean'],
  'guarded auto-reset lock RPC exists'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.save_rubber_price_allowance_auto_reset_lock(text,uuid,boolean,boolean)',
    'execute'
  ),
  'authenticated callers can reach the guarded lock RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.save_rubber_price_allowance_auto_reset_lock(text,uuid,boolean,boolean)',
    'execute'
  ),
  'anonymous callers cannot reach the lock RPC'
);
select extensions.ok(
  pg_get_functiondef(
    'public.save_rubber_price_allowance_auto_reset_lock(text,uuid,boolean,boolean)'::regprocedure
  ) like '%pg_advisory_xact_lock(hashtextextended(''rubber-approval-policy'', 0))%',
  'lock writes serialize on the shared policy advisory lock'
);

delete from public.rubber_approval_group_locations;
delete from public.rubber_approval_groups;

insert into public.locations(id, name, code, is_active)
values
  ('76000000-0000-4000-8000-000000000001', 'Lock Branch A', 'RLA', true),
  ('76000000-0000-4000-8000-000000000002', 'Lock Branch B', 'RLB', true),
  ('76000000-0000-4000-8000-000000000003', 'Lock Branch C', 'RLC', true),
  ('76000000-0000-4000-8000-000000000004', 'Lock Branch D', 'RLD', true);

insert into public.profiles(
  id, phone, name, role, is_active, can_access_super_admin_features
)
values (
  '77000000-0000-4000-8000-000000000001',
  '0897700001',
  'Lock System Manager',
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
    '78000000-0000-4000-8000-000000000001', 30, 50, 8, 4,
    '77000000-0000-4000-8000-000000000001', 'Lock System Manager', '0897700001',
    '2026-10-01 00:00:00+00'
  ),
  (
    '78000000-0000-4000-8000-000000000002', 30, 49, 7, 5,
    '77000000-0000-4000-8000-000000000001', 'Lock System Manager', '0897700001',
    '2026-10-01 00:00:00+00'
  );

insert into public.rubber_approval_group_locations(group_id, location_id)
values
  ('78000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001'),
  ('78000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000002'),
  ('78000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000003');

update public.rubber_bill_approval_settings
set central_price = 42,
    max_price_allowance = 100,
    ungrouped_price_allowance = 6,
    ungrouped_revision = 10,
    ungrouped_updated_by_user_id = '77000000-0000-4000-8000-000000000001',
    ungrouped_updated_by_name = 'Lock System Manager',
    ungrouped_updated_by_phone = '0897700001',
    ungrouped_updated_at = '2026-10-01 00:00:00+00',
    price_rule_revision = 100,
    price_allowance_auto_reset_enabled = true,
    ungrouped_price_allowance_auto_reset_locked = false
where id = true;

select set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$select public.save_rubber_price_allowance_auto_reset_lock(
    'group', '78000000-0000-4000-8000-000000000001', true, false
  )$$,
  'P0001',
  'FORBIDDEN: เฉพาะ super admin เท่านั้นที่เปลี่ยนสถานะล็อกรีเซ็ตราคายางได้',
  'System Manager cannot change an auto-reset lock'
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
  $$select public.save_rubber_price_allowance_auto_reset_lock('invalid', null, true, false)$$,
  'P0001',
  'RUBBER_AUTO_RESET_LOCK_INVALID: สถานะล็อกรีเซ็ตราคายางไม่ถูกต้อง',
  'invalid lock scope is rejected'
);
select extensions.throws_ok(
  $$select public.save_rubber_price_allowance_auto_reset_lock(null, null, true, false)$$,
  'P0001',
  'RUBBER_AUTO_RESET_LOCK_INVALID: สถานะล็อกรีเซ็ตราคายางไม่ถูกต้อง',
  'null lock scope is rejected'
);
select extensions.throws_ok(
  $$select public.save_rubber_price_allowance_auto_reset_lock(
    'group', '78000000-0000-4000-8000-000000000099', true, false
  )$$,
  'P0001',
  'RUBBER_GROUP_NOT_FOUND: ไม่พบกลุ่ม',
  'missing group lock target is rejected'
);
select extensions.throws_ok(
  $$select public.save_rubber_price_allowance_auto_reset_lock(
    'group', '78000000-0000-4000-8000-000000000001', true, true
  )$$,
  'P0001',
  'RUBBER_AUTO_RESET_LOCK_STALE: สถานะล็อกถูกแก้ไขโดยผู้ใช้อื่น',
  'stale group lock state is rejected'
);

create temp table created_group_result as
select public.create_rubber_approval_group_v2(
  array['76000000-0000-4000-8000-000000000004'::uuid], 30, 5
) result;
select extensions.is(
  (select result->'group'->>'priceAllowanceAutoResetLocked' from created_group_result),
  'false',
  'new group response exposes the unlocked default'
);

create temp table group_before_lock as
select to_jsonb(g) - 'price_allowance_auto_reset_locked' snapshot
from public.rubber_approval_groups g
where id = '78000000-0000-4000-8000-000000000001';
select extensions.is(
  public.save_rubber_price_allowance_auto_reset_lock(
    'group', '78000000-0000-4000-8000-000000000001', true, false
  ),
  jsonb_build_object(
    'status', 'saved',
    'scope', 'group',
    'groupId', '78000000-0000-4000-8000-000000000001'::uuid,
    'locked', true
  ),
  'super admin locks a group with the stable response contract'
);
select extensions.is(
  (select to_jsonb(g) - 'price_allowance_auto_reset_locked'
   from public.rubber_approval_groups g
   where id = '78000000-0000-4000-8000-000000000001'),
  (select snapshot from group_before_lock),
  'locking a group changes no price revision actor or update time'
);
select extensions.is(
  (select item->>'priceAllowanceAutoResetLocked'
   from jsonb_array_elements(public.list_rubber_approval_groups()->'groups') item
   where item->>'id' = '78000000-0000-4000-8000-000000000001'),
  'true',
  'management list exposes the group lock'
);

create temp table moved_group_result as
select public.update_rubber_approval_group_v2(
  '78000000-0000-4000-8000-000000000001',
  array[
    '76000000-0000-4000-8000-000000000001'::uuid,
    '76000000-0000-4000-8000-000000000002'::uuid
  ],
  30,
  8,
  4,
  jsonb_build_object('78000000-0000-4000-8000-000000000002', 5)
) result;
select extensions.is(
  (select result->'group'->>'priceAllowanceAutoResetLocked' from moved_group_result),
  'true',
  'moving a branch preserves the target group lock in the response'
);
select extensions.is(
  (select price_allowance_auto_reset_locked::text
   from public.rubber_approval_groups
   where id = '78000000-0000-4000-8000-000000000002'),
  'false',
  'moving a branch does not copy the target lock to the source group'
);
select extensions.is(
  public.update_rubber_approval_group_v2(
    '78000000-0000-4000-8000-000000000001',
    array[
      '76000000-0000-4000-8000-000000000001'::uuid,
      '76000000-0000-4000-8000-000000000002'::uuid
    ],
    30,
    8,
    5,
    '{}'::jsonb
  )->'group'->>'priceAllowanceAutoResetLocked',
  'true',
  'group no-op update response preserves the lock field'
);

reset role;
update public.rubber_bill_approval_settings
set ungrouped_price_allowance = 6,
    ungrouped_revision = 10,
    ungrouped_updated_by_user_id = '77000000-0000-4000-8000-000000000001',
    ungrouped_updated_by_name = 'Lock System Manager',
    ungrouped_updated_by_phone = '0897700001',
    ungrouped_updated_at = '2026-10-01 00:00:00+00'
where id = true;
create temp table ungrouped_before_lock as
select to_jsonb(s) - 'ungrouped_price_allowance_auto_reset_locked' snapshot
from public.rubber_bill_approval_settings s
where id = true;
set local role authenticated;
select extensions.is(
  public.save_rubber_price_allowance_auto_reset_lock(
    'ungrouped', null, true, false
  ),
  jsonb_build_object('status', 'saved', 'scope', 'ungrouped', 'locked', true),
  'super admin locks ungrouped defaults with the stable response contract'
);
reset role;
select extensions.is(
  (select to_jsonb(s) - 'ungrouped_price_allowance_auto_reset_locked'
   from public.rubber_bill_approval_settings s where id = true),
  (select snapshot from ungrouped_before_lock),
  'locking ungrouped defaults changes no price revision actor or update time'
);
set local role authenticated;
select extensions.is(
  public.list_rubber_approval_groups()
    ->'ungroupedDefaults'->>'priceAllowanceAutoResetLocked',
  'true',
  'management list exposes the ungrouped lock'
);

reset role;
update public.rubber_approval_groups
set configured_price = case when id = '78000000-0000-4000-8000-000000000001' then 50 else 49 end,
    price_allowance = case when id = '78000000-0000-4000-8000-000000000001' then 8 else 7 end,
    updated_at = '2026-10-01 00:00:00+00'
where id in (
  '78000000-0000-4000-8000-000000000001',
  '78000000-0000-4000-8000-000000000002'
);
create temp table locked_worker_result as
select private.reset_rubber_price_allowances('2026-10-14 13:00:00+00') result;
select extensions.is(
  (select result->>'groupCount' from locked_worker_result),
  '1',
  'worker resets only the overdue unlocked group'
);
select extensions.is(
  (select result->>'ungroupedCount' from locked_worker_result),
  '0',
  'worker skips locked ungrouped defaults'
);
select extensions.is(
  (select price_allowance from public.rubber_approval_groups
   where id = '78000000-0000-4000-8000-000000000001'),
  8::numeric,
  'worker preserves an overdue locked group allowance'
);
select extensions.is(
  (select price_allowance from public.rubber_approval_groups
   where id = '78000000-0000-4000-8000-000000000002'),
  0::numeric,
  'worker still resets an overdue unlocked group'
);

set local role authenticated;
create temp table group_before_unlock as
select to_jsonb(g) - 'price_allowance_auto_reset_locked' snapshot
from public.rubber_approval_groups g
where id = '78000000-0000-4000-8000-000000000001';
select extensions.is(
  public.save_rubber_price_allowance_auto_reset_lock(
    'group', '78000000-0000-4000-8000-000000000001', false, true
  ),
  jsonb_build_object(
    'status', 'saved',
    'scope', 'group',
    'groupId', '78000000-0000-4000-8000-000000000001'::uuid,
    'locked', false
  ),
  'super admin unlocks a group without resetting it'
);
select extensions.is(
  (select to_jsonb(g) - 'price_allowance_auto_reset_locked'
   from public.rubber_approval_groups g
   where id = '78000000-0000-4000-8000-000000000001'),
  (select snapshot from group_before_unlock),
  'unlocking a group changes no price revision actor or update time'
);
reset role;
select extensions.is(
  private.reset_rubber_price_allowances('2026-10-14 13:00:01+00')->>'groupCount',
  '1',
  'next worker run resets an overdue newly unlocked group'
);
select extensions.is(
  (select price_allowance from public.rubber_approval_groups
   where id = '78000000-0000-4000-8000-000000000001'),
  0::numeric,
  'newly unlocked group becomes zero through the worker'
);

set local role authenticated;
select extensions.is(
  public.save_rubber_price_allowance_auto_reset_lock(
    'ungrouped', null, false, true
  )->>'status',
  'saved',
  'super admin unlocks ungrouped defaults'
);
select extensions.is(
  (select ungrouped_price_allowance from public.rubber_bill_approval_settings where id = true),
  6::numeric,
  'unlocking ungrouped defaults does not change the price immediately'
);
reset role;
select extensions.is(
  private.reset_rubber_price_allowances('2026-10-14 13:00:02+00')->>'ungroupedCount',
  '1',
  'next worker run resets overdue newly unlocked ungrouped defaults'
);
select extensions.is(
  (select ungrouped_price_allowance from public.rubber_bill_approval_settings where id = true),
  0::numeric,
  'newly unlocked ungrouped allowance becomes zero through the worker'
);

set local role authenticated;
select extensions.is(
  public.save_rubber_price_allowance_auto_reset_lock(
    'group', '78000000-0000-4000-8000-000000000001', true, false
  )->>'status',
  'saved',
  'a zero-price group can still be locked'
);
select extensions.is(
  public.update_rubber_approval_group_v2(
    '78000000-0000-4000-8000-000000000001',
    array[
      '76000000-0000-4000-8000-000000000001'::uuid,
      '76000000-0000-4000-8000-000000000002'::uuid
    ],
    30,
    4,
    (select revision_no from public.rubber_approval_groups
     where id = '78000000-0000-4000-8000-000000000001'),
    '{}'::jsonb
  )->'group'->>'priceAllowanceAutoResetLocked',
  'true',
  'an actual group price edit returns the preserved lock'
);
select extensions.is(
  (select price_allowance_auto_reset_locked::text
   from public.rubber_approval_groups
   where id = '78000000-0000-4000-8000-000000000001'),
  'true',
  'an actual group price edit keeps the stored lock'
);
do $$
begin
  perform public.save_rubber_price_allowance_auto_reset(false, true);
  perform public.save_rubber_price_allowance_auto_reset(true, false);
end
$$;
select extensions.is(
  (select price_allowance_auto_reset_locked::text
   from public.rubber_approval_groups
   where id = '78000000-0000-4000-8000-000000000001'),
  'true',
  'global auto-reset off and on does not change the group lock'
);

select * from extensions.finish();
rollback;
