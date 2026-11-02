begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
update public.profiles set role='admin' where role='super_admin';
insert into public.profiles(id,phone,name,role,is_active)
  values('bd160000-0000-4000-8000-000000000001','0899916001','Reset mode','super_admin',true);
insert into public.locations(id,name,code,is_active)
  values('bd160000-0000-4000-8000-000000000002','Reset mode','BRTM',true);
select set_config('request.jwt.claim.sub','bd160000-0000-4000-8000-000000000001',true);
select public.register_rubber_bill_issuer('bd160000-0000-4000-8000-000000000002',gen_random_uuid(),gen_random_uuid());
create temp table mode_preview as select public.preview_bill_device_reset() value;
select extensions.is((select value->>'mode' from mode_preview),'clear_registry_v1','preview advertises the clear operation explicitly');
select extensions.throws_ok($$select public.reset_all_bill_devices(gen_random_uuid(),
  (select value->>'snapshot' from mode_preview),'รีเซ็ตทั้งหมด')$$,
  '22023','BILL_DEVICE_RESET_REQUIRES_CURRENT_UI','legacy three-argument callers cannot start a new clear');
select extensions.is(public.preview_bill_device_reset(),(select value from mode_preview),'legacy new-command rejection leaves registry intact');
select extensions.throws_ok($$select public.reset_all_bill_devices(gen_random_uuid(),
  (select value->>'snapshot' from mode_preview),'รีเซ็ตทั้งหมด','retire_v1')$$,
  '22023','BILL_DEVICE_RESET_REQUIRES_CURRENT_UI','the database rejects the wrong explicit operation too');
select extensions.ok(not has_function_privilege('anon','public.reset_all_bill_devices(uuid,text,text,text)','execute'),'anonymous cannot call the explicit clear RPC');
insert into private.bill_device_reset_receipts(request_id,actor_user_id,snapshot,retired_count,completed_at)
  values('bd160000-0000-4000-8000-000000000003',auth.uid(),repeat('a',64),1,clock_timestamp());
select extensions.is(public.reset_all_bill_devices('bd160000-0000-4000-8000-000000000003',repeat('a',64),'รีเซ็ตทั้งหมด','clear_registry_v1')->>'mode',
  'legacy_v1','untyped historical receipt is not relabeled as a successful clear');
select extensions.is(public.reset_all_bill_devices('bd160000-0000-4000-8000-000000000003',repeat('a',64),'รีเซ็ตทั้งหมด')->>'mode',
  'legacy_v1','legacy clients can still inspect their completed command without starting another');
select extensions.is(public.preview_bill_device_reset(),(select value from mode_preview),'legacy receipt replay changes no registration');
create temp table mode_result as select public.reset_all_bill_devices('bd160000-0000-4000-8000-000000000004',
  (select value->>'snapshot' from mode_preview),'รีเซ็ตทั้งหมด','clear_registry_v1') value;
select extensions.is((select value->>'mode' from mode_result),'clear_registry_v1','new clear receipt advertises its actual operation');
select extensions.is((select reset_mode from private.bill_device_reset_receipts where request_id='bd160000-0000-4000-8000-000000000004'),
  'clear_registry_v1','operation is persisted with the command rather than inferred at replay time');
select public.register_rubber_bill_issuer('bd160000-0000-4000-8000-000000000002',gen_random_uuid(),gen_random_uuid());
select extensions.is(public.reset_all_bill_devices('bd160000-0000-4000-8000-000000000004',
  (select value->>'snapshot' from mode_preview),'รีเซ็ตทั้งหมด','clear_registry_v1'),(select value from mode_result),'typed clear receipt replay remains exact after a replacement');
select extensions.is((public.preview_bill_device_reset()->>'count')::bigint,1::bigint,'typed replay preserves the replacement');
select extensions.ok(not has_table_privilege('authenticated','private.bill_device_reset_receipts','update'),'clients cannot change historical receipt operation');
select * from extensions.finish();
rollback;
