begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(54);

select extensions.has_table('public', 'export_vehicle_weigh_bills', 'WEX parent exists');
select extensions.has_table('public', 'export_vehicle_weigh_lines', 'WEX vehicle lines exist');
select extensions.has_column(
  'public', 'export_vehicle_weigh_lines', 'carrier_id', 'WEX line carrier master FK exists'
);
select extensions.has_column(
  'public', 'export_vehicle_weigh_lines', 'carrier_name', 'WEX line carrier snapshot exists'
);
select extensions.has_table(
  'public', 'export_vehicle_weigh_bill_reservations', 'WEX REX reservations exist'
);
select extensions.has_function(
  'public', 'create_export_vehicle_weigh_bill', array['uuid', 'jsonb', 'uuid[]'],
  'atomic WEX create RPC exists'
);
select extensions.has_function(
  'public', 'update_export_vehicle_weigh_bill', array['uuid', 'integer', 'jsonb', 'uuid[]'],
  'atomic WEX update RPC exists'
);
select extensions.has_function(
  'public', 'delete_export_vehicle_weigh_bill', array['uuid', 'integer'],
  'atomic WEX delete RPC exists'
);
select extensions.has_function(
  'public', 'get_export_vehicle_weigh_bill_options', array['uuid', 'uuid'],
  'branch-scoped WEX option RPC exists'
);
select extensions.has_function(
  'public', 'get_export_vehicle_weigh_bill_detail', array['uuid'],
  'branch-scoped WEX detail RPC exists'
);
select extensions.ok(
  not has_function_privilege(
    'anon', 'public.create_export_vehicle_weigh_bill(uuid,jsonb,uuid[])', 'execute'
  ),
  'anon cannot execute WEX create'
);
select extensions.ok(
  has_function_privilege(
    'authenticated', 'public.create_export_vehicle_weigh_bill(uuid,jsonb,uuid[])', 'execute'
  ),
  'authenticated callers can reach the guarded WEX create interface'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.export_vehicle_weigh_bills', 'insert'),
  'authenticated callers cannot insert WEX parents directly'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.export_vehicle_weigh_bills', 'update'),
  'authenticated callers cannot update WEX parents directly'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.export_vehicle_weigh_bills', 'delete'),
  'authenticated callers cannot delete WEX parents directly'
);

insert into public.locations (id, name, code, is_active)
values
  ('81000000-0000-4000-8000-000000000001', 'pgTAP WEX assigned', 'PWXA', true),
  ('81000000-0000-4000-8000-000000000002', 'pgTAP WEX other', 'PWXB', true);

insert into public.profiles (
  id, phone, name, role, is_active, can_access_super_admin_features
)
values
  ('82000000-0000-4000-8000-000000000001', '0898100001', 'pgTAP WEX admin', 'admin', true, false),
  ('82000000-0000-4000-8000-000000000002', '0898100002', 'pgTAP WEX user', 'user', true, false),
  ('82000000-0000-4000-8000-000000000003', '0898100003', 'pgTAP WEX manager', 'user', true, true);

insert into public.user_locations (user_id, location_id, is_primary)
values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', true),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', true);

insert into public.transport_staffs (id, main_name, record_status, default_location_id)
values
  ('84000000-0000-4000-8000-000000000001', 'ผู้ขนส่งสาขาต้นฉบับ', 'active',
    '81000000-0000-4000-8000-000000000001'),
  ('84000000-0000-4000-8000-000000000002', 'ผู้ขนส่งส่วนกลาง', 'active', null),
  ('84000000-0000-4000-8000-000000000003', 'ผู้ขนส่งต่างสาขา', 'active',
    '81000000-0000-4000-8000-000000000002'),
  ('84000000-0000-4000-8000-000000000004', 'ผู้ขนส่งเลิกใช้', 'deleted',
    '81000000-0000-4000-8000-000000000001');

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id, status,
  original_weight_total, paid_total, rubber_value_total, average_price,
  current_weight, work_rate, other_operating_cost, work_total, expense_destination,
  created_by_user_id, created_by_name, created_by_phone, created_at,
  verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
  age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count,
  sold_out_at, sold_out_by_user_id, sold_out_by_name
)
values
  (
    '83000000-0000-4000-8000-000000000001', 'REX-WEX-001', '2026-08-24', 810001,
    '81000000-0000-4000-8000-000000000001', 'verified',
    500, 5000, 5000, 10, 300, 0, 0, 0, 'external',
    '82000000-0000-4000-8000-000000000001', 'pgTAP WEX admin', '0898100001', now(),
    '82000000-0000-4000-8000-000000000003', 'pgTAP WEX manager', '0898100003', now(),
    now(), 0, 0, 0, now(),
    '82000000-0000-4000-8000-000000000001', 'pgTAP WEX admin'
  ),
  (
    '83000000-0000-4000-8000-000000000002', 'REX-WEX-002', '2026-08-24', 810002,
    '81000000-0000-4000-8000-000000000001', 'verified',
    900, 9000, 9000, 10, 700, 0, 0, 0, 'external',
    '82000000-0000-4000-8000-000000000001', 'pgTAP WEX admin', '0898100001', now(),
    '82000000-0000-4000-8000-000000000003', 'pgTAP WEX manager', '0898100003', now(),
    now(), 0, 0, 0, now(),
    '82000000-0000-4000-8000-000000000001', 'pgTAP WEX admin'
  );

select extensions.lives_ok(
  $$select * from private.normalized_export_vehicle_weigh_lines(
    '81000000-0000-4000-8000-000000000001',
    '[{"vehicleRegistration":"GLOBAL-1","carrierId":"84000000-0000-4000-8000-000000000002","carrierName":"ignored","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600}]'
  )$$,
  'an active global carrier is valid for the selected branch'
);

select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$select public.create_export_vehicle_weigh_bill(
    '81000000-0000-4000-8000-000000000001',
    '[{"vehicleRegistration":"USER-1","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600}]',
    array[]::uuid[]
  )$$,
  'P0001',
  'WEX_FORBIDDEN: ไม่มีสิทธิ์สร้างบิลรถส่งออกของสาขานี้',
  'normal users cannot create WEX documents'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$select public.create_export_vehicle_weigh_bill(
    '81000000-0000-4000-8000-000000000002',
    '[{"vehicleRegistration":"OTHER-1","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600}]',
    array[]::uuid[]
  )$$,
  'P0001',
  'WEX_FORBIDDEN: ไม่มีสิทธิ์สร้างบิลรถส่งออกของสาขานี้',
  'assigned admins cannot create WEX documents in another branch'
);

select extensions.throws_ok(
  $$select public.create_export_vehicle_weigh_bill(
    '81000000-0000-4000-8000-000000000001',
    '[{"vehicleRegistration":"AA 1","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":300},{"vehicleRegistration":" aa   1 ","inboundAt":"2026-08-24T03:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T04:00:00Z","outboundWeight":300}]',
    array[]::uuid[]
  )$$,
  'P0001',
  'WEX_INVALID_LINES: ทะเบียนรถไม่ถูกต้องหรือซ้ำกัน',
  'vehicle registrations are unique after trim, whitespace collapse, and case folding'
);

select extensions.throws_ok(
  $$select public.create_export_vehicle_weigh_bill(
    '81000000-0000-4000-8000-000000000001',
    '[{"vehicleRegistration":"OTHER-CARRIER","carrierId":"84000000-0000-4000-8000-000000000003","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600}]',
    array[]::uuid[]
  )$$,
  'P0001',
  'WEX_CARRIER_INELIGIBLE: เลือกได้เฉพาะผู้ขนส่งที่ใช้งานอยู่และมีสิทธิ์ในสาขานี้',
  'a carrier assigned to another branch is rejected'
);

select extensions.throws_ok(
  $$select public.create_export_vehicle_weigh_bill(
    '81000000-0000-4000-8000-000000000001',
    '[{"vehicleRegistration":"DELETED-CARRIER","carrierId":"84000000-0000-4000-8000-000000000004","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600}]',
    array[]::uuid[]
  )$$,
  'P0001',
  'WEX_CARRIER_INELIGIBLE: เลือกได้เฉพาะผู้ขนส่งที่ใช้งานอยู่และมีสิทธิ์ในสาขานี้',
  'an inactive carrier is rejected'
);

create temporary table wex_shared_carrier on commit drop as
select public.create_export_vehicle_weigh_bill(
  '81000000-0000-4000-8000-000000000001',
  '[{"vehicleRegistration":"SHARED-TRUCK","carrierId":"84000000-0000-4000-8000-000000000001","carrierName":"ignored truck","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600},{"vehicleRegistration":"SHARED-TAIL","carrierId":"84000000-0000-4000-8000-000000000002","carrierName":"ignored tail","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":200,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":700}]',
  array[]::uuid[]
) as response;

select extensions.ok(
  not exists (
    select 1
    from public.export_vehicle_weigh_lines
    where wex_id = (select (response->>'id')::uuid from wex_shared_carrier)
      and (
        carrier_id is distinct from '84000000-0000-4000-8000-000000000001'::uuid
        or carrier_name is distinct from 'ผู้ขนส่งสาขาต้นฉบับ'
      )
  ),
  'create canonicalizes every WEX line to the truck carrier snapshot'
);
select extensions.is(
  public.update_export_vehicle_weigh_bill(
    (select (response->>'id')::uuid from wex_shared_carrier), 1,
    '[{"vehicleRegistration":"SHARED-TRUCK","carrierId":null,"carrierName":"   ","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600},{"vehicleRegistration":"SHARED-TAIL","carrierId":"84000000-0000-4000-8000-000000000002","carrierName":"must be ignored","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":200,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":700}]',
    array[]::uuid[]
  )->>'revision',
  '2',
  'update accepts a blank truck carrier while ignoring the tail-trailer carrier input'
);
select extensions.ok(
  not exists (
    select 1
    from public.export_vehicle_weigh_lines
    where wex_id = (select (response->>'id')::uuid from wex_shared_carrier)
      and (carrier_id is not null or carrier_name is not null)
  ),
  'update canonicalizes every WEX line to the blank truck carrier snapshot'
);

create temporary table wex_pending on commit drop as
select public.create_export_vehicle_weigh_bill(
  '81000000-0000-4000-8000-000000000001',
  '[{"vehicleRegistration":"PENDING-1","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":1000,"outboundAt":null,"outboundWeight":0}]',
  array[]::uuid[]
) as response;

select extensions.ok(
  (select outbound_weight = 0 and outbound_at is null and net_weight = 0
    from public.export_vehicle_weigh_lines
    where wex_id = (select (response->>'id')::uuid from wex_pending)),
  'inbound-only WEX stores zero outbound weight, null outbound time, and zero net weight'
);
select extensions.ok(
  (select line->'outboundAt' = 'null'::jsonb
      and (line->>'outboundWeight')::numeric = 0
      and (line->>'netWeight')::numeric = 0
    from jsonb_array_elements(public.get_export_vehicle_weigh_bill_detail(
      (select (response->>'id')::uuid from wex_pending)
    )->'lines') line),
  'detail preserves the pending outbound state'
);
select extensions.throws_ok(
  $$select public.create_export_vehicle_weigh_bill(
    '81000000-0000-4000-8000-000000000001',
    '[{"vehicleRegistration":"COMPLETE-MIX","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600},{"vehicleRegistration":"PENDING-MIX","inboundAt":"2026-08-24T01:30:00Z","inboundWeight":100,"outboundAt":null,"outboundWeight":0}]',
    array['83000000-0000-4000-8000-000000000001'::uuid]
  )$$,
  'P0001',
  'WEX_INCOMPLETE_WEIGHING: ต้องชั่งออกรถทุกคันก่อนเลือกรายการขายยาง',
  'REX reservations are blocked until every vehicle completes outbound weighing'
);
select extensions.is(
  public.update_export_vehicle_weigh_bill(
    (select (response->>'id')::uuid from wex_pending), 1,
    '[{"vehicleRegistration":"PENDING-1","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":1000,"outboundAt":"2026-08-24T03:00:00Z","outboundWeight":1500}]',
    array[]::uuid[]
  )->>'revision',
  '2',
  'pending WEX can be completed later through the normal update RPC'
);
select extensions.is(
  (public.get_export_vehicle_weigh_bill_detail(
    (select (response->>'id')::uuid from wex_pending)
  )->>'vehicleNetWeight')::numeric,
  500::numeric,
  'completed pending WEX receives its server-computed net weight'
);

create temporary table wex_created on commit drop as
select public.create_export_vehicle_weigh_bill(
  '81000000-0000-4000-8000-000000000001',
  '[{"vehicleRegistration":"กข 1234","carrierId":"84000000-0000-4000-8000-000000000001","carrierName":"ชื่อจาก client ต้องถูกละเว้น","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":1000,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":1500}]',
  array['83000000-0000-4000-8000-000000000001'::uuid]
) as response;

select extensions.ok(
  (select response->>'wexNo' like 'WEX-%' from wex_created),
  'WEX number is server generated'
);
select extensions.is(
  (select count(*)::integer from public.export_vehicle_weigh_lines
    where wex_id = (select (response->>'id')::uuid from wex_created)),
  1,
  'create stores one complete positive vehicle line'
);
select extensions.ok(
  (select carrier_id = '84000000-0000-4000-8000-000000000001'::uuid
      and carrier_name = 'ผู้ขนส่งสาขาต้นฉบับ'
    from public.export_vehicle_weigh_lines
    where wex_id = (select (response->>'id')::uuid from wex_created)),
  'selected carrier snapshots the canonical master name and ignores the client name'
);
select extensions.ok(
  (select line->>'carrierId' = '84000000-0000-4000-8000-000000000001'
      and line->>'carrierName' = 'ผู้ขนส่งสาขาต้นฉบับ'
    from jsonb_array_elements(public.get_export_vehicle_weigh_bill_detail(
      (select (response->>'id')::uuid from wex_created)
    )->'lines') line),
  'detail returns the nullable carrier master and snapshot fields'
);
select extensions.is(
  (public.get_export_vehicle_weigh_bill_detail(
    (select (response->>'id')::uuid from wex_created)
  )->>'vehicleNetWeight')::numeric,
  500::numeric,
  'detail uses server-computed vehicle net weight'
);
select extensions.is(
  (select current_weight from public.export_vehicle_weigh_bill_reservations
    where wex_id = (select (response->>'id')::uuid from wex_created)),
  300::numeric,
  'reservation snapshots the current REX weight'
);
select extensions.ok(
  (select reserved_by_current_wex
    from public.get_export_vehicle_weigh_bill_options(
      '81000000-0000-4000-8000-000000000001',
      (select (response->>'id')::uuid from wex_created)
    )
    where rubber_export_id = '83000000-0000-4000-8000-000000000001'),
  'edit options include the current WEX reservation'
);
select extensions.lives_ok(
  $$select public.get_export_vehicle_weigh_bill_detail(
    (select (response->>'id')::uuid from wex_created)
  ) from public.locations where id = '81000000-0000-4000-8000-000000000002'$$,
  'assigned admin detail remains callable for its own WEX'
);

select extensions.throws_ok(
  $$select public.create_export_vehicle_weigh_bill(
    '81000000-0000-4000-8000-000000000001',
    '[{"vehicleRegistration":"RESERVE-2","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":100,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":600}]',
    array['83000000-0000-4000-8000-000000000001'::uuid]
  )$$,
  'P0001',
  'WEX_REX_RESERVED: มีรายการขายยางถูกจองในบิลรถส่งออกอื่นแล้ว',
  'one active reservation prevents a second WEX from claiming the same REX'
);
select extensions.throws_ok(
  $$select public.set_rubber_export_sold_out(
    '83000000-0000-4000-8000-000000000001', false
  )$$,
  'P0001',
  'WEX_RESERVATION_LOCKED: รายการขายยางถูกจองโดยบิลรถส่งออก:REX-WEX-001',
  'sale cancellation is blocked while the REX is reserved'
);
select extensions.throws_ok(
  $$select public.update_export_vehicle_weigh_bill(
    (select (response->>'id')::uuid from wex_created), 99,
    '[{"vehicleRegistration":"กข 1234","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":1000,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":1500}]',
    array[]::uuid[]
  )$$,
  'P0001',
  'WEX_STALE_REVISION: บิลรถส่งออกถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่',
  'stale updates cannot replace reservations'
);
select extensions.throws_ok(
  $$select public.update_export_vehicle_weigh_bill(
    (select (response->>'id')::uuid from wex_created), 1,
    '[{"vehicleRegistration":"กข 1234","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":1000,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":1500}]',
    array['83000000-0000-4000-8000-000000000002'::uuid]
  )$$,
  'P0001',
  'WEX_OVERWEIGHT: น้ำหนักรายการขายยางรวมเกินน้ำหนักสุทธิรถ',
  'server rejects reserved REX weight above vehicle net weight'
);
select extensions.is(
  public.update_export_vehicle_weigh_bill(
    (select (response->>'id')::uuid from wex_created), 1,
    '[{"vehicleRegistration":"กข 1234","carrierName":"  ผู้ขนส่ง   กรอกเอง  ","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":1000,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":1500}]',
    array[]::uuid[]
  )->>'revision',
  '2',
  'valid update atomically releases the reservation and advances revision'
);
select extensions.ok(
  (select carrier_id is null and carrier_name = 'ผู้ขนส่ง กรอกเอง'
    from public.export_vehicle_weigh_lines
    where wex_id = (select (response->>'id')::uuid from wex_created)),
  'manual carrier names are normalized and stored without a master FK'
);
select extensions.is(
  public.set_rubber_export_sold_out(
    '83000000-0000-4000-8000-000000000001', false
  )->>'status',
  'verified',
  'sale cancellation succeeds after reservation release'
);
select extensions.is(
  public.set_rubber_export_sold_out(
    '83000000-0000-4000-8000-000000000001', true
  )->>'status',
  'sold_out',
  'the released REX can be marked sold out again'
);
select extensions.is(
  public.update_export_vehicle_weigh_bill(
    (select (response->>'id')::uuid from wex_created), 2,
    '[{"vehicleRegistration":"กข 1234","carrierId":null,"carrierName":"   ","inboundAt":"2026-08-24T01:00:00Z","inboundWeight":1000,"outboundAt":"2026-08-24T02:00:00Z","outboundWeight":1500}]',
    array['83000000-0000-4000-8000-000000000001'::uuid]
  )->>'revision',
  '3',
  'released REX can be reserved again by the same WEX'
);
select extensions.ok(
  (select carrier_id is null and carrier_name is null
    from public.export_vehicle_weigh_lines
    where wex_id = (select (response->>'id')::uuid from wex_created)),
  'blank carrier input is stored as an unspecified nullable carrier'
);

create temporary table rex_sold_snapshot on commit drop as
select sold_out_at, sold_out_by_user_id, sold_out_by_name
from public.rubber_exports
where id = '83000000-0000-4000-8000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table wex_deleted on commit drop as
select public.delete_export_vehicle_weigh_bill(
  (select (response->>'id')::uuid from wex_created), 3
) as response;

select extensions.is(
  (select response->>'status' from wex_deleted),
  'deleted',
  'system manager permanently deletes the WEX aggregate'
);
select extensions.ok(
  (select paired_source_id is null
      and previous_status is null
      and original_actor_user_id is null
      and original_actor_name is null
      and deleted_by_user_id = '82000000-0000-4000-8000-000000000003'::uuid
    from public.document_deletion_audits
    where document_kind = 'export_vehicle_weigh_bill'
      and source_id = (select (response->>'id')::uuid from wex_created)),
  'WEX deletion retains only the permitted minimal audit identity fields'
);
select extensions.ok(
  not exists (
    select 1 from public.export_vehicle_weigh_bills
    where id = (select (response->>'id')::uuid from wex_created)
  ) and not exists (
    select 1 from public.export_vehicle_weigh_lines
    where wex_id = (select (response->>'id')::uuid from wex_created)
  ) and not exists (
    select 1 from public.export_vehicle_weigh_bill_reservations
    where wex_id = (select (response->>'id')::uuid from wex_created)
  ),
  'delete removes reservations, lines, and parent without orphans'
);
select extensions.ok(
  (select r.sold_out_at is not distinct from s.sold_out_at
      and r.sold_out_by_user_id is not distinct from s.sold_out_by_user_id
      and r.sold_out_by_name is not distinct from s.sold_out_by_name
    from public.rubber_exports r cross join rex_sold_snapshot s
    where r.id = '83000000-0000-4000-8000-000000000001'),
  'WEX deletion does not change REX sold-out fields'
);
select extensions.is(
  public.delete_export_vehicle_weigh_bill(
    (select (response->>'id')::uuid from wex_created), 3
  )->>'status',
  'deleted',
  'delete retry returns the same receipt from minimal audit'
);
select extensions.throws_ok(
  $$select public.get_export_vehicle_weigh_bill_detail(
    (select (response->>'id')::uuid from wex_created)
  )$$,
  'P0001',
  'WEX_NOT_FOUND: ไม่พบบิลรถส่งออก',
  'detail returns not found after permanent delete'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$select public.delete_export_vehicle_weigh_bill(
    (select (response->>'id')::uuid from wex_created), 3
  )$$,
  'P0001',
  'WEX_FORBIDDEN: เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบบิลรถส่งออกได้',
  'assigned admin cannot delete or use the audit retry path'
);

reset role;
select * from extensions.finish();

rollback;
