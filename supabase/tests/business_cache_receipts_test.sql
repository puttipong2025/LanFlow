begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code,is_active) values
('ca000000-0000-4000-8000-000000000010','Cache fixture','CACHEFIX',true),
('ca000000-0000-4000-8000-000000000011','Other cache fixture','CACHEOTHER',true);
insert into public.profiles(id,phone,name,role,is_active) values
('ca000000-0000-4000-8000-000000000001','cache-fixture-admin','Cache fixture','admin',true),
('ca000000-0000-4000-8000-000000000002','cache-fixture-user','Cache viewer','user',true);
insert into public.user_locations(user_id,location_id,is_primary) values
('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000010',true);
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,
sync_status,record_status,location_id,bill_no,bill_date,customer_name,bill_type,weight,
rubber_value,average_price,deduction_total,net_total,revision_no,created_by_user_id,created_by_name,created_by_phone)
values('ca000000-0000-4000-8000-000000000020','cache-receipt','CACHE-L','CACHE-S','cache-receipt',
'synced','active','ca000000-0000-4000-8000-000000000010','CACHE-S',current_date,'Fixture','weighing',
10,100,10,0,100,1,'ca000000-0000-4000-8000-000000000001','Cache fixture','fixture');
select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',true);
select extensions.is(jsonb_array_length(public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010',
array['ca000000-0000-4000-8000-000000000020'::uuid])),1,'returns the exact authorized identity');
select extensions.ok(not (public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010',
array['ca000000-0000-4000-8000-000000000020'::uuid])->0 ? 'ocr_source_id'),'private OCR source ID is excluded');
select extensions.ok(public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010',
array['ca000000-0000-4000-8000-000000000020'::uuid])->0 ? 'approval_pending','approval state is decorated');
select extensions.is(public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010','{}'::uuid[]),'[]'::jsonb,'empty batch is explicit');
select extensions.is(public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010',
array['ca000000-0000-4000-8000-000000000099'::uuid]),'[]'::jsonb,'unknown identity is absent, not fabricated as deleted');
select extensions.throws_ok($q$select public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000011','{}'::uuid[])$q$,
'42501','FORBIDDEN: location access denied','another branch is forbidden');
select extensions.throws_ok($q$select public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010',
array['ca000000-0000-4000-8000-000000000020'::uuid,'ca000000-0000-4000-8000-000000000020'::uuid])$q$,
'22023','Invalid receipt identity batch','duplicate identities are rejected');
select extensions.throws_ok($q$select public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010',
array_fill('ca000000-0000-4000-8000-000000000020'::uuid,array[101]))$q$,
'22023','Invalid receipt identity batch','oversized batch is rejected');
update public.rubber_bills set record_status='deleted',revision_no=2 where id='ca000000-0000-4000-8000-000000000020';
select extensions.is(public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010',
array['ca000000-0000-4000-8000-000000000020'::uuid])->0->>'record_status','deleted','soft-deletion proof is retained');
select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000002',true);
select extensions.throws_ok($q$select public.get_rubber_bill_cache_rows('ca000000-0000-4000-8000-000000000010','{}'::uuid[])$q$,
'42501','FORBIDDEN: location access denied','basic user cannot access business cache RPC');
select extensions.ok(not has_function_privilege('anon','public.get_rubber_bill_cache_rows(uuid,uuid[])','execute'),'anonymous execution is revoked');
select extensions.ok(has_function_privilege('authenticated','public.get_rubber_bill_cache_rows(uuid,uuid[])','execute'),'authenticated role may execute with live authorization');
select * from extensions.finish();
rollback;
