begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(49);

select extensions.ok(
  to_regclass('public.rubber_bill_price_quota_uses') is not null,
  'quota ledger exists'
);
select extensions.is(
  (select central_price from public.rubber_bill_approval_settings where id = true),
  42.00::numeric,
  'central price starts at 42'
);
select extensions.ok(
  not exists (select 1 from public.rubber_approval_groups where price_allowance < 0),
  'group allowance backfill never produces a negative value'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.rubber_bill_price_quota_uses', 'select'),
  'authenticated clients cannot read the internal quota ledger'
);

insert into public.locations(id, name, code, is_active)
values
  ('71000000-0000-4000-8000-000000000001', 'Quota Branch A', 'QBA', true),
  ('71000000-0000-4000-8000-000000000002', 'Quota Branch B', 'QBB', true);

insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values
  ('72000000-0000-4000-8000-000000000001', '0897100001', 'Quota Manager', 'admin', true, true),
  ('72000000-0000-4000-8000-000000000002', '0897100002', 'Quota Admin', 'admin', true, false);

insert into public.user_locations(user_id, location_id, is_primary)
values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', true),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', true),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', false);

select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select extensions.is(
  (
    public.save_rubber_central_price(
      43,
      (select central_price_revision from public.rubber_bill_approval_settings where id = true)
    )->'centralPrice'->>'value'
  )::numeric,
  43::numeric,
  'System Manager can update central price'
);
select extensions.is(
  (
    public.save_rubber_ungrouped_defaults(
      30,
      3,
      (select ungrouped_revision from public.rubber_bill_approval_settings where id = true)
    )->'ungroupedDefaults'->>'priceAllowance'
  )::numeric,
  3::numeric,
  'System Manager can update ungrouped defaults'
);
select extensions.throws_ok(
  $$select public.save_rubber_central_price(
    9999999999.99,
    (select central_price_revision from public.rubber_bill_approval_settings where id = true)
  )$$,
  'P0001',
  'RUBBER_EFFECTIVE_PRICE_CAP_INVALID: ราคากลางรวมส่วนต่างต้องไม่เกิน 9,999,999,999.99 บาท',
  'central price cannot make an existing effective cap overflow'
);
select extensions.throws_ok(
  $$select public.save_rubber_ungrouped_defaults(
    30,
    9999999999.99,
    (select ungrouped_revision from public.rubber_bill_approval_settings where id = true)
  )$$,
  'P0001',
  'RUBBER_EFFECTIVE_PRICE_CAP_INVALID: ราคากลางรวมส่วนต่างต้องไม่เกิน 9,999,999,999.99 บาท',
  'ungrouped allowance cannot make the effective cap overflow'
);
select extensions.throws_ok(
  $$select public.create_rubber_approval_group_v2(
    array['71000000-0000-4000-8000-000000000002'::uuid],
    30,
    9999999999.99
  )$$,
  'P0001',
  'RUBBER_EFFECTIVE_PRICE_CAP_INVALID: ราคากลางรวมส่วนต่างต้องไม่เกิน 9,999,999,999.99 บาท',
  'group allowance cannot make the effective cap overflow'
);
select extensions.throws_ok(
  $$select public.save_rubber_admin_quota(2, (select quota_round_id from public.rubber_bill_approval_settings where id = true))$$,
  'P0001',
  'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งโควต้าได้',
  'System Manager cannot save the quota'
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
select extensions.is(
  (
    public.save_rubber_admin_quota(
      2,
      (select quota_round_id from public.rubber_bill_approval_settings where id = true)
    )->'quota'->>'limitPerAdmin'
  )::integer,
  2,
  'exact super admin can save quota'
);
select extensions.is(
  (select quota_limit_per_admin from public.rubber_bill_approval_settings where id = true),
  2,
  'quota limit is persisted'
);
reset role;

select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select extensions.is(
  public.sync_rubber_bill(jsonb_build_object(
    'expectedRevisionNo', 0,
    'clientTempId', 'quota-invalid-operation',
    'idempotencyKey', 'quota-invalid-operation',
    'locationId', '71000000-0000-4000-8000-000000000001'
  ))->>'errorMessage',
  'Invalid operation',
  'sync rejects a missing operation at the public boundary'
);
select extensions.is(
  public.sync_rubber_bill(jsonb_build_object(
    'operation', 'create',
    'expectedRevisionNo', 0,
    'clientTempId', 'quota-null-location',
    'idempotencyKey', 'quota-null-location',
    'locationId', null
  ))->>'errorMessage',
  'Location access denied or invalid identity',
  'sync rejects a null location at the public boundary'
);
select extensions.is(
  public.preview_rubber_bill_submission(jsonb_build_object(
    'operation', 'create',
    'clientTempId', 'quota-preview-null-location',
    'idempotencyKey', 'quota-preview-null-location',
    'locationId', null,
    'items', '[]'::jsonb
  ))->>'errorMessage',
  'Location access denied or invalid identity',
  'preview rejects a null location at the public boundary'
);

select extensions.throws_ok(
  $$select public.save_rubber_ungrouped_defaults(30, -1, 1)$$,
  'P0001',
  'FORBIDDEN: ไม่มีสิทธิ์ตั้งค่ากลุ่มเริ่มต้น',
  'ungrouped settings authorize before validating input'
);
select extensions.throws_ok(
  $$select public.create_rubber_approval_group_v2(
    array['71000000-0000-4000-8000-000000000001'::uuid], 30, -1
  )$$,
  'P0001',
  'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง',
  'group creation authorizes before validating input'
);
select extensions.throws_ok(
  $$select public.update_rubber_approval_group_v2(
    '73000000-0000-4000-8000-000000000001'::uuid,
    array['71000000-0000-4000-8000-000000000001'::uuid], 30, -1, 1, '{}'::jsonb
  )$$,
  'P0001',
  'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง',
  'group update authorizes before validating input'
);

select extensions.is(
  public.preview_rubber_bill_submission(jsonb_build_object(
    'operation', 'create',
    'clientTempId', 'quota-preview-direct',
    'idempotencyKey', 'quota-preview-direct',
    'locationId', '71000000-0000-4000-8000-000000000001',
    'billDate', (clock_timestamp() at time zone 'Asia/Bangkok')::date,
    'deductWeight', 0,
    'items', jsonb_build_array(jsonb_build_object(
      'itemType', 'weigh', 'sequenceNo', 1, 'netWeight', 10, 'unitPrice', 43
    ))
  ))->>'disposition',
  'direct',
  'price equal to central is direct'
);

select extensions.is(
  public.preview_rubber_bill_submission(jsonb_build_object(
    'operation', 'create',
    'clientTempId', 'quota-preview-confirm',
    'idempotencyKey', 'quota-preview-confirm',
    'locationId', '71000000-0000-4000-8000-000000000001',
    'billDate', (clock_timestamp() at time zone 'Asia/Bangkok')::date,
    'deductWeight', 0,
    'items', jsonb_build_array(jsonb_build_object(
      'itemType', 'weigh', 'sequenceNo', 1, 'netWeight', 10, 'unitPrice', 46
    ))
  ))->>'disposition',
  'quota_confirmation_required',
  'price equal to effective cap requires quota confirmation'
);

select extensions.is(
  to_regprocedure('public.create_rubber_approval_group(uuid[],integer,numeric)'),
  null::regprocedure,
  'legacy group create RPC is removed after the v2 cutover'
);
select extensions.is(
  to_regprocedure('public.update_rubber_approval_group(uuid,uuid[],integer,numeric)'),
  null::regprocedure,
  'legacy group update RPC is removed after the v2 cutover'
);
select extensions.is(
  to_regprocedure('public.delete_rubber_approval_group(uuid)'),
  null::regprocedure,
  'legacy group delete RPC is removed after the v2 cutover'
);
select extensions.is(
  to_regprocedure('private.validate_rubber_approval_group_input(uuid[],integer,numeric)'),
  null::regprocedure,
  'legacy group validator is removed after the v2 cutover'
);
select extensions.is(
  to_regprocedure('public.save_rubber_bill_approval_settings(integer,numeric)'),
  null::regprocedure,
  'legacy two-argument settings RPC is removed after the policy cutover'
);
select extensions.is(
  to_regprocedure('public.save_rubber_bill_approval_settings(integer,numeric,boolean)'),
  null::regprocedure,
  'legacy three-argument settings RPC is removed after the policy cutover'
);
select extensions.is(
  to_regprocedure('private.sync_rubber_bill_approval_20260805020000(jsonb)'),
  null::regprocedure,
  'superseded approval dispatcher is removed after the policy cutover'
);
select extensions.is(
  to_regprocedure('public.list_rubber_bill_approval_markers(uuid)'),
  null::regprocedure,
  'superseded approval marker RPC is removed after the operational feed cutover'
);
select extensions.is(
  to_regprocedure('public.get_rubber_bill_operational_feed(uuid,text,text,text,timestamptz,uuid,integer)'),
  null::regprocedure,
  'superseded operational feed RPC is removed after the bounded v2 cutover'
);

select extensions.is(
  (public.get_effective_rubber_approval_settings('71000000-0000-4000-8000-000000000001')->>'effectivePriceCap')::numeric,
  46::numeric,
  'ungrouped branch uses central plus shared allowance'
);
select extensions.is(
  public.get_effective_rubber_approval_settings('71000000-0000-4000-8000-000000000001')->>'ruleSource',
  'ungrouped',
  'ungrouped branch is no longer price-time exempt'
);
select extensions.ok(
  (public.preview_rubber_bill_submission(jsonb_build_object(
    'operation', 'create',
    'clientTempId', 'quota-preview-confirm-fingerprint',
    'idempotencyKey', 'quota-preview-confirm-fingerprint',
    'locationId', '71000000-0000-4000-8000-000000000001',
    'billDate', (clock_timestamp() at time zone 'Asia/Bangkok')::date,
    'deductWeight', 0,
    'items', jsonb_build_array(jsonb_build_object(
      'itemType', 'weigh', 'sequenceNo', 1, 'netWeight', 10, 'unitPrice', 44
    ))
  ))->>'decisionFingerprint') is not null,
  'quota decision includes a payload-bound fingerprint'
);

create temp table quota_runtime (
  payload jsonb not null,
  decision jsonb,
  first_result jsonb,
  retry_result jsonb,
  cross_operation_result jsonb,
  update_result jsonb,
  update_replay_result jsonb,
  invalid_historical_retry_result jsonb,
  historical_retry_result jsonb,
  reused_key_result jsonb
);
insert into quota_runtime(payload)
values (jsonb_build_object(
  'operation', 'create',
  'expectedRevisionNo', 0,
  'clientTempId', 'quota-runtime-confirm',
  'idempotencyKey', 'create:quota-runtime-confirm:0',
  'locationId', '71000000-0000-4000-8000-000000000001',
  'recordStatus', 'active',
  'localBillNo', 'QRT-001',
  'billDate', (clock_timestamp() at time zone 'Asia/Bangkok')::date,
  'customerId', null,
  'customerName', 'Quota Runtime Customer',
  'billType', 'บิลเครื่องชั่งเล็ก',
  'deductWeight', 0,
  'weight', 10,
  'netWeight', 10,
  'rubberValue', 440,
  'netRubberValue', 440,
  'averagePrice', 44,
  'deductionTotal', 0,
  'payableBeforeRounding', 440,
  'netTotal', 440,
  'acidPackCount', 0,
  'clientRecordedAt', clock_timestamp(),
  'clientCreatedAt', clock_timestamp(),
  'items', jsonb_build_array(jsonb_build_object(
    'itemType', 'weigh', 'title', 'ชั่ง1', 'description', 'ชั่ง1',
    'inWeight', 20, 'outWeight', 10, 'netWeight', 10,
    'unitPrice', 44, 'totalAmount', 440, 'sequenceNo', 1
  ))
));
update quota_runtime set decision = public.preview_rubber_bill_submission(payload);
update quota_runtime set first_result = public.sync_rubber_bill(
  payload || jsonb_build_object(
    'submissionMode', 'interactive',
    'quotaConfirmation', jsonb_build_object(
      'priceRuleRevision', decision->>'priceRuleRevision',
      'quotaRoundId', decision->>'quotaRoundId',
      'decisionFingerprint', decision->>'decisionFingerprint'
    )
  )
);

select extensions.is(
  (select first_result->>'status' from quota_runtime),
  'synced',
  'confirmed interactive submission syncs directly'
);
select extensions.is(
  (select first_result->>'quotaConsumed' from quota_runtime),
  'true',
  'confirmed interactive submission reports quota consumption'
);
select extensions.is(
  (
    select public.preview_rubber_bill_submission(
      payload || jsonb_build_object(
        'operation', 'update',
        'locationId', '71000000-0000-4000-8000-000000000002',
        'idempotencyKey', 'update:quota-runtime-confirm:1'
      )
    )->>'errorMessage'
    from quota_runtime
  ),
  'Location mismatch',
  'preview rejects a bill identity from another accessible location'
);
reset role;
select extensions.is(
  (select count(*) from public.rubber_bill_price_quota_uses),
  1::bigint,
  'successful price submission consumes exactly one quota entry'
);

select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
update quota_runtime set retry_result = public.sync_rubber_bill(
  payload || jsonb_build_object('submissionMode', 'replay')
);
select extensions.is(
  (select retry_result->>'status' from quota_runtime),
  'synced',
  'idempotent replay returns the prior synced bill before a new policy decision'
);
update quota_runtime set cross_operation_result = public.sync_rubber_bill(
  payload || jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', 1,
    'submissionMode', 'replay'
  )
);
select extensions.is(
  (select cross_operation_result->>'status' from quota_runtime),
  'conflict',
  'a create idempotency key cannot be replayed as an update'
);
update quota_runtime set update_result = public.sync_rubber_bill(
  payload || jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', 1,
    'idempotencyKey', 'update:quota-runtime-confirm:1',
    'customerName', 'Quota Runtime Customer Updated',
    'submissionMode', 'replay'
  )
);
select extensions.is(
  (select update_result->>'status' from quota_runtime),
  'synced',
  'a later non-price update can replace the bill idempotency key'
);
update quota_runtime set update_replay_result = public.sync_rubber_bill(
  payload || jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', 1,
    'idempotencyKey', 'update:quota-runtime-confirm:1',
    'customerName', 'Quota Runtime Customer Updated',
    'submissionMode', 'replay'
  )
);
select extensions.is(
  (select update_replay_result->>'quotaConsumed' from quota_runtime),
  null::text,
  'a non-price update replay does not report consuming the earlier price quota'
);
update quota_runtime set invalid_historical_retry_result = public.sync_rubber_bill(
  payload || jsonb_build_object(
    'expectedRevisionNo', 999,
    'submissionMode', 'replay'
  )
);
select extensions.is(
  (select invalid_historical_retry_result->>'status' from quota_runtime),
  'conflict',
  'a historical quota key stays bound to its original base revision'
);
update quota_runtime set historical_retry_result = public.sync_rubber_bill(
  payload || jsonb_build_object('submissionMode', 'replay')
);
select extensions.is(
  (select historical_retry_result->>'status' from quota_runtime),
  'synced',
  'the original quota submission remains idempotent after a later update'
);
update quota_runtime set reused_key_result = public.sync_rubber_bill(
  payload || jsonb_build_object(
    'clientTempId', 'quota-runtime-reused-key',
    'localBillNo', 'QRT-REUSED',
    'customerName', 'Quota Reused Key Customer',
    'submissionMode', 'interactive'
  )
);
select extensions.is(
  (select reused_key_result->>'status' from quota_runtime),
  'conflict',
  'a consumed quota operation key cannot be reused for a different bill'
);
reset role;
select extensions.ok(
  (select rubber_price_quota_use_id is not null
   from public.rubber_bills where client_temp_id = 'quota-runtime-confirm'),
  'a non-price update preserves the quota reference for the priced revision'
);
select extensions.is(
  (select count(*) from public.rubber_bill_price_quota_uses),
  1::bigint,
  'idempotent replay does not consume quota twice'
);
select extensions.is(
  (select count(*) from public.rubber_bills where client_temp_id = 'quota-runtime-reused-key'),
  0::bigint,
  'a reused quota operation key cannot create another bill'
);
select extensions.is(
  (select count(*) from public.rubber_bill_price_quota_uses),
  1::bigint,
  'a reused quota operation key cannot consume or share a ledger entry'
);
select extensions.is(
  (select central_price_snapshot from public.rubber_bills where client_temp_id = 'quota-runtime-confirm'),
  43::numeric,
  'successful quota submission stores the historical central price snapshot'
);
reset role;
select extensions.is(
  (select count(*) from public.rubber_bill_price_quota_uses),
  1::bigint,
  'preview itself has no additional quota ledger side effect'
);

select * from extensions.finish();
rollback;
