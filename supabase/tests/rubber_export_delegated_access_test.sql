begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(11);

insert into public.locations (id, name, code, is_active)
values
  ('31000000-0000-4000-8000-000000000001', 'pgTAP Rubber Export A', 'PREA', true),
  ('31000000-0000-4000-8000-000000000002', 'pgTAP Rubber Export B', 'PREB', true);

insert into public.profiles (
  id, phone, name, role, is_active, can_manage_rubber_exports
)
values (
  '32000000-0000-4000-8000-000000000001',
  '0893200001',
  'pgTAP delegated Rubber Export Admin',
  'admin',
  true,
  true
);

insert into public.user_locations (user_id, location_id, is_primary)
values (
  '32000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  true
);

insert into public.rubber_exports (
  id, export_no, export_date, sequence_no, location_id,
  original_weight_total, paid_total, rubber_value_total, average_price,
  created_by_user_id, created_by_name, created_by_phone
)
values
  (
    '33000000-0000-4000-8000-000000000001', 'REX-PGTAP-A', '2026-09-07', 1,
    '31000000-0000-4000-8000-000000000001', 100, 5000, 5000, 50,
    '32000000-0000-4000-8000-000000000001', 'pgTAP delegated Rubber Export Admin', '0893200001'
  ),
  (
    '33000000-0000-4000-8000-000000000002', 'REX-PGTAP-B', '2026-09-07', 1,
    '31000000-0000-4000-8000-000000000002', 100, 5000, 5000, 50,
    '32000000-0000-4000-8000-000000000001', 'pgTAP delegated Rubber Export Admin', '0893200001'
  );

insert into public.document_deletion_audits (
  id, document_kind, source_id, document_no, location_id, previous_status,
  deleted_by_user_id, deleted_by_name, deleted_at
)
values
  (
    '34000000-0000-4000-8000-000000000001', 'rubber_export',
    '35000000-0000-4000-8000-000000000001', 'REX-AUDIT-A',
    '31000000-0000-4000-8000-000000000001', 'draft',
    '32000000-0000-4000-8000-000000000001', 'pgTAP delegated Rubber Export Admin', now()
  ),
  (
    '34000000-0000-4000-8000-000000000002', 'rubber_export',
    '35000000-0000-4000-8000-000000000002', 'REX-AUDIT-B',
    '31000000-0000-4000-8000-000000000002', 'draft',
    '32000000-0000-4000-8000-000000000001', 'pgTAP delegated Rubber Export Admin', now()
  ),
  (
    '34000000-0000-4000-8000-000000000003', 'report_batch',
    '35000000-0000-4000-8000-000000000003', 'RPT-AUDIT-A',
    '31000000-0000-4000-8000-000000000001', null,
    '32000000-0000-4000-8000-000000000001', 'pgTAP delegated Rubber Export Admin', now()
  );

select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.ok(
  private.can_manage_rubber_exports('31000000-0000-4000-8000-000000000001'),
  'delegated Admin can manage Rubber Export in an assigned branch'
);

select extensions.ok(
  not private.can_manage_rubber_exports('31000000-0000-4000-8000-000000000002'),
  'delegated Admin cannot manage Rubber Export outside assigned branches'
);

select extensions.throws_ok(
  $$select public.verify_rubber_export_atomic('33000000-0000-4000-8000-000000000002', 95, 1, 0, 'external')$$,
  'P0001',
  'ไม่มีสิทธิ์ตรวจสอบรายการส่งออกของสาขานี้',
  'verify RPC enforces the export branch after loading the document'
);

select extensions.throws_ok(
  $$select public.verify_rubber_export_atomic('33000000-0000-4000-8000-000000000002', 95, 1, 0, 'invalid')$$,
  'P0001',
  'ไม่มีสิทธิ์ตรวจสอบรายการส่งออกของสาขานี้',
  'verify RPC checks branch authority before validating protected input'
);

select extensions.lives_ok(
  $$select public.delete_rubber_export('33000000-0000-4000-8000-000000000001')$$,
  'delegated Admin can delete an unlocked draft in an assigned branch'
);

select extensions.lives_ok(
  $$select public.delete_rubber_export('33000000-0000-4000-8000-000000000001')$$,
  'delete retry authorizes against the stored audit branch'
);

select extensions.is(
  (
    select count(*)
    from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and location_id = '31000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'delegated Admin can read Rubber Export deletion history in an assigned branch'
);

select extensions.is(
  (
    select count(*)
    from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and location_id = '31000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'delegated Admin cannot read Rubber Export deletion history in another branch'
);

select extensions.is(
  (
    select count(*)
    from public.document_deletion_audits
    where document_kind = 'report_batch'
  ),
  0::bigint,
  'delegated Rubber Export access does not expose other deletion audit kinds'
);

reset role;
update public.profiles
set is_active = false
where id = '32000000-0000-4000-8000-000000000001';
set local role authenticated;

select extensions.ok(
  not private.can_manage_rubber_exports('31000000-0000-4000-8000-000000000001'),
  'suspension immediately blocks delegated Rubber Export management'
);

reset role;
select extensions.is(
  (
    select can_manage_rubber_exports
    from public.profiles
    where id = '32000000-0000-4000-8000-000000000001'
  ),
  true,
  'suspension preserves the stored delegated capability'
);

select * from extensions.finish();

rollback;
