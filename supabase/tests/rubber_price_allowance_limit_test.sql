begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

select extensions.has_column(
  'public',
  'rubber_bill_approval_settings',
  'max_price_allowance',
  'approval settings expose one system-wide allowance ceiling'
);

insert into public.locations(id, name, code, is_active)
values
  ('71000000-0000-4000-8000-000000000011', 'Allowance Limit Branch A', 'ALBA', true),
  ('71000000-0000-4000-8000-000000000012', 'Allowance Limit Branch B', 'ALBB', true);

insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values
  ('72000000-0000-4000-8000-000000000011', '0897100011', 'Allowance Manager', 'admin', true, true),
  ('72000000-0000-4000-8000-000000000012', '0897100012', 'Allowance Admin', 'admin', true, false);

insert into public.user_locations(user_id, location_id, is_primary)
values
  ('72000000-0000-4000-8000-000000000011', '71000000-0000-4000-8000-000000000011', true),
  ('72000000-0000-4000-8000-000000000012', '71000000-0000-4000-8000-000000000012', true);

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

create temp table allowance_limit_before_save as
select quota_round_id, price_rule_revision
from public.rubber_bill_approval_settings
where id = true;

select extensions.is(
  (
    public.save_rubber_admin_quota_v2(
      3,
      10,
      (select quota_round_id from public.rubber_bill_approval_settings where id = true)
    )->'quota'->>'maxPriceAllowance'
  )::numeric,
  10::numeric,
  'super admin saves quota and allowance ceiling together'
);
select extensions.isnt(
  (select quota_round_id from public.rubber_bill_approval_settings where id = true),
  (select quota_round_id from allowance_limit_before_save),
  'successful quota bundle save advances the quota round'
);
select extensions.is(
  (select price_rule_revision from public.rubber_bill_approval_settings where id = true),
  (select price_rule_revision from allowance_limit_before_save),
  'quota bundle save does not advance the price-rule revision'
);

select extensions.is(
  (
    public.save_rubber_ungrouped_defaults(
      30,
      7,
      (select ungrouped_revision from public.rubber_bill_approval_settings where id = true)
    )->'ungroupedDefaults'->>'priceAllowance'
  )::numeric,
  7::numeric,
  'manager-capable super admin can set ungrouped allowance within the ceiling'
);

create temp table allowance_limit_before_failure as
select quota_limit_per_admin, max_price_allowance, quota_round_id,
  quota_updated_by_user_id, quota_updated_by_name, quota_updated_by_phone,
  quota_updated_at, price_rule_revision
from public.rubber_bill_approval_settings
where id = true;

select extensions.throws_ok(
  $$select public.save_rubber_admin_quota_v2(
    4,
    6,
    (select quota_round_id from public.rubber_bill_approval_settings where id = true)
  )$$,
  'P0001',
  'RUBBER_ALLOWANCE_LIMIT_TOO_LOW: ราคายางที่กำหนดสูงสุดต้องไม่น้อยกว่าค่าที่กลุ่มหรือสาขาที่ยังไม่จัดกลุ่มใช้อยู่',
  'ceiling cannot be lowered below an active ungrouped allowance'
);
select extensions.is(
  (
    select jsonb_build_object(
      'quota', quota_limit_per_admin,
      'ceiling', max_price_allowance,
      'round', quota_round_id,
      'actorId', quota_updated_by_user_id,
      'actorName', quota_updated_by_name,
      'actorPhone', quota_updated_by_phone,
      'updatedAt', quota_updated_at,
      'ruleRevision', price_rule_revision
    )
    from public.rubber_bill_approval_settings where id = true
  ),
  (
    select jsonb_build_object(
      'quota', quota_limit_per_admin,
      'ceiling', max_price_allowance,
      'round', quota_round_id,
      'actorId', quota_updated_by_user_id,
      'actorName', quota_updated_by_name,
      'actorPhone', quota_updated_by_phone,
      'updatedAt', quota_updated_at,
      'ruleRevision', price_rule_revision
    )
    from allowance_limit_before_failure
  ),
  'rejected quota bundle save has no settings side effects'
);

select extensions.throws_ok(
  $$select public.create_rubber_approval_group_v2(
    array['71000000-0000-4000-8000-000000000011'::uuid], 30, 10.01
  )$$,
  'P0001',
  'RUBBER_ALLOWANCE_LIMIT_EXCEEDED: ราคายางที่กำหนดเกินค่าสูงสุด กรุณาเพิ่มเพดานส่วนต่างราคายางก่อน',
  'group creation cannot exceed the allowance ceiling'
);

select extensions.throws_ok(
  $$select public.save_rubber_ungrouped_defaults(
    30,
    10.01,
    (select ungrouped_revision from public.rubber_bill_approval_settings where id = true)
  )$$,
  'P0001',
  'RUBBER_ALLOWANCE_LIMIT_EXCEEDED: ราคายางที่กำหนดเกินค่าสูงสุด กรุณาเพิ่มเพดานส่วนต่างราคายางก่อน',
  'ungrouped allowance cannot exceed the allowance ceiling'
);

select extensions.throws_ok(
  $$select public.save_rubber_central_price(
    9999999999.99,
    (select central_price_revision from public.rubber_bill_approval_settings where id = true)
  )$$,
  'P0001',
  'RUBBER_EFFECTIVE_PRICE_CAP_INVALID: ราคากลางรวมส่วนต่างต้องไม่เกิน 9,999,999,999.99 บาท',
  'central price validates against the system ceiling'
);

create temp table allowance_limit_before_same_save as
select quota_round_id, price_rule_revision
from public.rubber_bill_approval_settings
where id = true;

select extensions.is(
  (
    public.save_rubber_admin_quota_v2(
      3,
      10,
      (select quota_round_id from public.rubber_bill_approval_settings where id = true)
    )->'quota'->>'limitPerAdmin'
  )::integer,
  3,
  'same-value quota bundle save still succeeds'
);
select extensions.isnt(
  (select quota_round_id from public.rubber_bill_approval_settings where id = true),
  (select quota_round_id from allowance_limit_before_same_save),
  'same-value quota bundle save still advances the round'
);
select extensions.is(
  (select price_rule_revision from public.rubber_bill_approval_settings where id = true),
  (select price_rule_revision from allowance_limit_before_same_save),
  'same-value quota bundle save keeps the price-rule revision'
);

create temp table allowance_limit_before_legacy_save as
select quota_round_id, max_price_allowance
from public.rubber_bill_approval_settings
where id = true;

select extensions.is(
  (
    public.save_rubber_admin_quota(
      4,
      (select quota_round_id from public.rubber_bill_approval_settings where id = true)
    )->'quota'->>'limitPerAdmin'
  )::integer,
  4,
  'legacy quota RPC remains available during the compatibility window'
);
select extensions.is(
  (select max_price_allowance from public.rubber_bill_approval_settings where id = true),
  (select max_price_allowance from allowance_limit_before_legacy_save),
  'legacy quota RPC preserves the allowance ceiling'
);
select extensions.isnt(
  (select quota_round_id from public.rubber_bill_approval_settings where id = true),
  (select quota_round_id from allowance_limit_before_legacy_save),
  'legacy quota RPC still advances the quota round'
);

reset role;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;

select extensions.throws_ok(
  $$select public.save_rubber_admin_quota_v2(
    3,
    10,
    (select quota_round_id from public.rubber_bill_approval_settings where id = true)
  )$$,
  'P0001',
  'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งโควต้าและเพดานส่วนต่างราคาได้',
  'System Manager cannot save the quota bundle'
);

select extensions.throws_ok(
  $$select public.save_rubber_admin_quota_v2(
    3,
    null,
    (select quota_round_id from public.rubber_bill_approval_settings where id = true)
  )$$,
  'P0001',
  'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งโควต้าและเพดานส่วนต่างราคาได้',
  'authorization runs before quota bundle input validation'
);

reset role;

select extensions.ok(
  has_function_privilege('authenticated', 'public.save_rubber_admin_quota_v2(integer,numeric,uuid)', 'execute'),
  'authenticated callers can reach the guarded quota bundle RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.save_rubber_admin_quota_v2(integer,numeric,uuid)', 'execute'),
  'anonymous callers cannot execute the quota bundle RPC'
);

select * from extensions.finish();
rollback;
