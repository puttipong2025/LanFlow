begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(65);

select extensions.ok(to_regclass('public.rubber_bill_price_quota_uses') is null, 'price quota ledger is removed');
select extensions.hasnt_column('public', 'rubber_bills', 'rubber_price_quota_use_id', 'bill quota reference is removed');
select extensions.hasnt_column('public', 'rubber_bill_approval_settings', 'quota_limit_per_admin', 'quota count is removed');
select extensions.hasnt_column('public', 'rubber_bill_approval_settings', 'quota_round_id', 'quota round is removed');
select extensions.ok(to_regprocedure('public.preview_rubber_bill_submission(jsonb)') is null, 'preview RPC is removed');
select extensions.ok(to_regprocedure('public.save_rubber_admin_quota(integer,uuid)') is null, 'legacy quota RPC is removed');
select extensions.ok(to_regprocedure('public.save_rubber_admin_quota_v2(integer,numeric,uuid)') is null, 'quota bundle RPC is removed');
select extensions.has_function('public', 'save_rubber_max_price_allowance', array['numeric', 'numeric'], 'standalone maximum RPC exists');
select extensions.ok(
  has_function_privilege('authenticated', 'public.save_rubber_max_price_allowance(numeric,numeric)', 'execute'),
  'authenticated callers can reach the guarded maximum RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.save_rubber_max_price_allowance(numeric,numeric)', 'execute'),
  'anonymous callers cannot execute the maximum RPC'
);

-- Keep this contract independent from values left by browser suites.
delete from public.rubber_approval_group_locations;
delete from public.rubber_approval_groups;
update public.rubber_bill_approval_settings
set max_price_allowance = 0,
    ungrouped_price_allowance = 0
where id = true;

insert into public.locations(id, name, code, is_active)
values
  ('71000000-0000-4000-8000-000000000021', 'Price Policy Branch A', 'PPBA', true),
  ('71000000-0000-4000-8000-000000000022', 'Price Policy Branch B', 'PPBB', true);

insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values
  ('72000000-0000-4000-8000-000000000021', '0897100021', 'Price Policy Manager', 'admin', true, true),
  ('72000000-0000-4000-8000-000000000022', '0897100022', 'Price Policy Admin', 'admin', true, false);

insert into public.user_locations(user_id, location_id, is_primary)
values
  ('72000000-0000-4000-8000-000000000021', '71000000-0000-4000-8000-000000000021', true),
  ('72000000-0000-4000-8000-000000000022', '71000000-0000-4000-8000-000000000021', true),
  ('72000000-0000-4000-8000-000000000022', '71000000-0000-4000-8000-000000000022', false);

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
  public.save_rubber_max_price_allowance(10, 0)->>'status',
  'saved',
  'exact super admin saves the standalone maximum'
);
select extensions.is(
  (select max_price_allowance from public.rubber_bill_approval_settings where id = true),
  10::numeric,
  'maximum is persisted'
);
select extensions.is(
  public.save_rubber_max_price_allowance(10, 10)->>'status',
  'unchanged',
  'same-value save is an explicit no-op'
);

create temp table maximum_noop_snapshot as
select max_price_allowance_updated_by_user_id, max_price_allowance_updated_by_name,
  max_price_allowance_updated_by_phone, max_price_allowance_updated_at
from public.rubber_bill_approval_settings where id = true;

select extensions.is(
  (select jsonb_build_object(
    'id', max_price_allowance_updated_by_user_id,
    'name', max_price_allowance_updated_by_name,
    'phone', max_price_allowance_updated_by_phone,
    'at', max_price_allowance_updated_at
  ) from public.rubber_bill_approval_settings where id = true),
  (select jsonb_build_object(
    'id', max_price_allowance_updated_by_user_id,
    'name', max_price_allowance_updated_by_name,
    'phone', max_price_allowance_updated_by_phone,
    'at', max_price_allowance_updated_at
  ) from maximum_noop_snapshot),
  'same-value save preserves provenance'
);

reset role;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000021', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
set local role authenticated;

select extensions.is(
  (public.save_rubber_ungrouped_defaults(
    30, 6, (select ungrouped_revision from public.rubber_bill_approval_settings where id = true)
  )->'ungroupedDefaults'->>'priceAllowance')::numeric,
  6::numeric,
  'System Manager sets the ungrouped allowance inside the maximum'
);
select extensions.ok(
  (public.create_rubber_approval_group_v2(
    array['71000000-0000-4000-8000-000000000021'::uuid], 30, 8
  )->'group'->>'id') is not null,
  'System Manager creates a group inside the maximum'
);
select extensions.throws_ok(
  $$select public.save_rubber_max_price_allowance(null, null)$$,
  'P0001',
  'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งราคายางที่กำหนดสูงสุดได้',
  'authorization runs before standalone maximum validation'
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

create temp table maximum_conflict_result as
select public.save_rubber_max_price_allowance(5, 10) result;

select extensions.is((select result->>'status' from maximum_conflict_result), 'conflict', 'too-low maximum returns conflict');
select extensions.is((select result->>'code' from maximum_conflict_result), 'RUBBER_ALLOWANCE_LIMIT_TOO_LOW', 'too-low conflict has a stable code');
select extensions.is((select jsonb_array_length(result->'conflicts') from maximum_conflict_result), 2, 'conflict lists group and ungrouped scopes');
select extensions.is(
  (select count(*)::integer from maximum_conflict_result, jsonb_array_elements(result->'conflicts') conflict where conflict->>'scope' = 'group'),
  1,
  'structured conflict includes the group'
);
select extensions.is(
  (select count(*)::integer from maximum_conflict_result, jsonb_array_elements(result->'conflicts') conflict where conflict->>'scope' = 'ungrouped'),
  1,
  'structured conflict includes ungrouped defaults'
);
select extensions.is((select max_price_allowance from public.rubber_bill_approval_settings where id = true), 10::numeric, 'rejected reduction has no setting side effect');
select extensions.is(public.save_rubber_max_price_allowance(8, 10)->>'status', 'saved', 'maximum may be reduced to the highest active allowance');

reset role;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000022', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000022","role":"authenticated"}', true);
set local role authenticated;

create function pg_temp.price_policy_payload(p_key text, p_price numeric)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'operation', 'create', 'expectedRevisionNo', 0,
    'clientTempId', p_key, 'idempotencyKey', 'create:' || p_key || ':0',
    'locationId', '71000000-0000-4000-8000-000000000022',
    'recordStatus', 'active', 'localBillNo', p_key,
    'billDate', (clock_timestamp() at time zone 'Asia/Bangkok')::date,
    'customerId', null, 'customerName', 'Price Policy Customer',
    'billType', 'บิลเครื่องชั่งเล็ก', 'deductWeight', 0,
    'weight', 10, 'netWeight', 10, 'rubberValue', 10 * p_price,
    'netRubberValue', 10 * p_price, 'averagePrice', p_price,
    'deductionTotal', 0, 'payableBeforeRounding', 10 * p_price,
    'netTotal', 10 * p_price, 'acidPackCount', 0,
    'clientRecordedAt', clock_timestamp(), 'clientCreatedAt', clock_timestamp(),
    'items', jsonb_build_array(jsonb_build_object(
      'itemType', 'weigh', 'title', 'ชั่ง1', 'description', 'ชั่ง1',
      'inWeight', 20, 'outWeight', 10, 'netWeight', 10,
      'unitPrice', p_price, 'totalAmount', 10 * p_price, 'sequenceNo', 1
    ))
  )
$$;

-- Branch B uses the ungrouped cap: central 42 + allowance 6 = 48.
create temp table direct_create_payload as
select pg_temp.price_policy_payload('price-cap-below', 47.99) payload;
select extensions.is(
  public.sync_rubber_bill((select payload from direct_create_payload))->>'status',
  'synced',
  'price below cap saves directly'
);
select extensions.is(
  public.sync_rubber_bill(
    (select payload from direct_create_payload)
    || jsonb_build_object('submissionMode', 'replay')
  )->>'status',
  'synced',
  'an exact direct-create replay remains idempotent'
);
create temp table changed_direct_create_replay_result as
select public.sync_rubber_bill(jsonb_set(
  (select payload from direct_create_payload),
  '{items,0,unitPrice}',
  to_jsonb(48::numeric),
  false
)) result;
select extensions.is(
  (select result->>'status' from changed_direct_create_replay_result),
  'conflict',
  'a changed payload cannot masquerade as a direct-create replay'
);
select extensions.is(
  (select result->>'errorMessage' from changed_direct_create_replay_result),
  'ข้อมูลบิลไม่ตรงกับรายการที่บันทึกแล้ว',
  'the changed direct replay returns a stable public explanation'
);
reset role;
create temp table changed_inner_create_replay_result as
select private.sync_rubber_bill_approval_20260823010000(jsonb_set(
  (select payload from direct_create_payload),
  '{items,0,unitPrice}',
  to_jsonb(48::numeric),
  false
)) result;
select extensions.is(
  (select result->>'status' from changed_inner_create_replay_result),
  'conflict',
  'the post-lock create replay check rejects a changed payload'
);
select extensions.is(
  (select result->>'errorMessage' from changed_inner_create_replay_result),
  'ข้อมูลบิลไม่ตรงกับรายการที่บันทึกแล้ว',
  'the post-lock create replay returns the stable conflict explanation'
);
set local role authenticated;
select extensions.is(public.sync_rubber_bill(pg_temp.price_policy_payload('price-cap-equal', 48))->>'status', 'synced', 'price equal to cap saves directly');
select extensions.is(
  public.sync_rubber_bill(pg_temp.price_policy_payload('direct-update-target', 48))->>'status',
  'synced',
  'direct-update replay target is created'
);
create temp table direct_update_payload as
select pg_temp.price_policy_payload('direct-update-target', 47)
  || jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', 1,
    'idempotencyKey', 'update:direct-update-target:1'
  ) payload;
select extensions.is(
  public.sync_rubber_bill((select payload from direct_update_payload))->>'status',
  'synced',
  'an in-cap update saves directly'
);
reset role;
create temp table changed_inner_update_replay_result as
select private.sync_rubber_bill_approval_20260823010000(jsonb_set(
  (select payload from direct_update_payload),
  '{items,0,unitPrice}',
  to_jsonb(46::numeric),
  false
)) result;
select extensions.is(
  (select result->>'status' from changed_inner_update_replay_result),
  'conflict',
  'the post-lock update replay check rejects a changed payload'
);
select extensions.is(
  (select result->>'errorMessage' from changed_inner_update_replay_result),
  'ข้อมูลบิลไม่ตรงกับรายการที่บันทึกแล้ว',
  'the post-lock update replay returns the stable conflict explanation'
);
set local role authenticated;
select extensions.is(public.sync_rubber_bill(pg_temp.price_policy_payload('price-cap-repeat-1', 48))->>'status', 'synced', 'first repeated in-cap bill saves directly');
select extensions.is(public.sync_rubber_bill(pg_temp.price_policy_payload('price-cap-repeat-2', 48))->>'status', 'synced', 'second repeated in-cap bill is not counter-limited');
create temp table above_cap_payload as
select pg_temp.price_policy_payload('price-cap-above', 48.01) payload;
create temp table above_cap_result as
select public.sync_rubber_bill(payload) result from above_cap_payload;
select extensions.is((select result->>'status' from above_cap_result), 'pending_approval', 'price above cap creates approval');
select extensions.ok((select result->>'requestId' from above_cap_result) is not null, 'above-cap submission returns one pending request identity');
create temp table above_cap_replay_result as
select public.sync_rubber_bill(
  (select payload from above_cap_payload)
  || jsonb_build_object('submissionMode', 'replay')
) result;
select extensions.is(
  (select result->>'status' from above_cap_replay_result),
  'pending_approval',
  'pending request replay is idempotent'
);
select extensions.is(
  (select result->>'requestId' from above_cap_replay_result),
  (select result->>'requestId' from above_cap_result),
  'pending replay returns the same request identity'
);
create temp table conflicting_create_payload_result as
select public.sync_rubber_bill(jsonb_set(
  (select payload from above_cap_payload),
  '{items,0,unitPrice}',
  to_jsonb(49::numeric),
  false
)) result;
select extensions.is(
  (select result->>'status' from conflicting_create_payload_result),
  'conflict',
  'a changed create payload cannot masquerade as an exact pending replay'
);
select extensions.is(
  (select result->>'errorMessage' from conflicting_create_payload_result),
  'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่รอดำเนินการอยู่',
  'the conflicting create replay returns a stable public explanation'
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
create temp table approved_create_result as
select public.approve_rubber_bill_approval_request(
  (select (result->>'requestId')::uuid from above_cap_result)
) result;
select extensions.is(
  (select result->>'status' from approved_create_result),
  'approved',
  'the pending create can be approved before its client retry arrives'
);
reset role;
select extensions.ok(
  (select last_submission_fingerprint is not null
   from public.rubber_bills
   where id = (select (result->>'billId')::uuid from approved_create_result)),
  'approval persists the accepted payload fingerprint on the bill'
);

select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000022', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000022","role":"authenticated"}', true);
set local role authenticated;
create temp table approved_create_replay_result as
select public.sync_rubber_bill(
  (select payload from above_cap_payload)
  || jsonb_build_object('submissionMode', 'replay')
) result;
select extensions.is(
  (select result->>'status' from approved_create_replay_result),
  'synced',
  'an exact approved create replay remains idempotent'
);
create temp table changed_approved_create_replay_result as
select public.sync_rubber_bill(jsonb_set(
  (select payload from above_cap_payload),
  '{items,0,unitPrice}',
  to_jsonb(49::numeric),
  false
)) result;
select extensions.is(
  (select result->>'status' from changed_approved_create_replay_result),
  'conflict',
  'a changed payload cannot masquerade as an approved create replay'
);
select extensions.is(
  (select result->>'errorMessage' from changed_approved_create_replay_result),
  'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่อนุมัติแล้ว',
  'the changed approved replay returns a stable public explanation'
);

select extensions.is(
  public.sync_rubber_bill(pg_temp.price_policy_payload('pending-operation-target', 48))->>'status',
  'synced',
  'operation-conflict target is created directly'
);
create temp table pending_update_payload as
select pg_temp.price_policy_payload('pending-operation-target', 48.01)
  || jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', 1,
    'idempotencyKey', 'update:pending-operation-target:1'
  ) payload;
create temp table pending_update_result as
select public.sync_rubber_bill(payload) result from pending_update_payload;
select extensions.is(
  (select result->>'status' from pending_update_result),
  'pending_approval',
  'above-cap update creates one pending request'
);
create temp table pending_update_replay_result as
select public.sync_rubber_bill(
  (select payload from pending_update_payload)
  || jsonb_build_object('submissionMode', 'replay')
) result;
select extensions.is(
  (select result->>'status' from pending_update_replay_result),
  'pending_approval',
  'an exact pending update replay stays idempotent'
);
select extensions.is(
  (select result->>'requestId' from pending_update_replay_result),
  (select result->>'requestId' from pending_update_result),
  'an exact pending update replay keeps the request identity'
);
create temp table conflicting_update_payload_result as
select public.sync_rubber_bill(jsonb_set(
  (select payload from pending_update_payload),
  '{items,0,unitPrice}',
  to_jsonb(49::numeric),
  false
)) result;
select extensions.is(
  (select result->>'status' from conflicting_update_payload_result),
  'conflict',
  'a changed update payload cannot masquerade as an exact pending replay'
);
select extensions.is(
  (select result->>'errorMessage' from conflicting_update_payload_result),
  'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่รอดำเนินการอยู่',
  'the conflicting update replay returns a stable public explanation'
);
create temp table conflicting_delete_result as
select public.sync_rubber_bill(
  pg_temp.price_policy_payload('pending-operation-target', 48)
  || jsonb_build_object(
    'operation', 'delete',
    'expectedRevisionNo', 1,
    'idempotencyKey', 'delete:pending-operation-target:1'
  )
) result;
select extensions.is(
  (select result->>'status' from conflicting_delete_result),
  'conflict',
  'a delete cannot masquerade as an existing pending update'
);
select extensions.is(
  (select result->>'errorMessage' from conflicting_delete_result),
  'บิลนี้มีคำขออนุมัติอื่นที่รอดำเนินการอยู่',
  'the conflicting mutation returns a stable public explanation'
);

select extensions.is(
  public.sync_rubber_bill(pg_temp.price_policy_payload('pending-key-collision-target', 48))->>'status',
  'synced',
  'idempotency-collision target is created directly'
);
create temp table pending_key_collision_result as
select public.sync_rubber_bill(
  pg_temp.price_policy_payload('pending-key-collision-target', 48.01)
  || jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', 1,
    'idempotencyKey', 'update:pending-operation-target:1'
  )
) result;
select extensions.is(
  (select result->>'status' from pending_key_collision_result),
  'conflict',
  'a pending request idempotency key cannot be reused for another bill'
);
select extensions.is(
  (select result->>'errorMessage' from pending_key_collision_result),
  'รหัสคำขอถูกใช้กับรายการอื่นแล้ว',
  'the cross-bill idempotency collision returns a stable public explanation'
);

select extensions.is(
  public.sync_rubber_bill(pg_temp.price_policy_payload('bill-key-collision-target', 48))->>'status',
  'synced',
  'bill-key collision target is created directly'
);
create temp table bill_key_collision_result as
select public.sync_rubber_bill(
  pg_temp.price_policy_payload('bill-key-collision-target', 48.01)
  || jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', 1,
    'idempotencyKey', 'create:price-cap-below:0'
  )
) result;
select extensions.is(
  (select result->>'status' from bill_key_collision_result),
  'conflict',
  'a bill idempotency key cannot be reused by another approval request'
);
select extensions.is(
  (select result->>'errorMessage' from bill_key_collision_result),
  'รหัสคำขอถูกใช้กับรายการอื่นแล้ว',
  'the bill-to-approval key collision returns a stable public explanation'
);

select extensions.is(
  public.sync_rubber_bill(pg_temp.price_policy_payload('approval-key-collision-target', 48))->>'status',
  'synced',
  'approval-key collision target is created directly'
);
create temp table approval_key_collision_result as
select public.sync_rubber_bill(
  pg_temp.price_policy_payload('approval-key-collision-target', 47)
  || jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', 1,
    'idempotencyKey', 'update:pending-operation-target:1'
  )
) result;
select extensions.is(
  (select result->>'status' from approval_key_collision_result),
  'conflict',
  'an approval idempotency key cannot be reused by another direct bill mutation'
);
select extensions.is(
  (select result->>'errorMessage' from approval_key_collision_result),
  'รหัสคำขอถูกใช้กับรายการอื่นแล้ว',
  'the approval-to-bill key collision returns a stable public explanation'
);

select * from extensions.finish();
rollback;
