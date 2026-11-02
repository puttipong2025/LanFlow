begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
-- The application permits one Super Admin; this fixture is rolled back in full.
update public.profiles set role='admin' where role='super_admin';
insert into auth.users(id,aud,role) values('bd140000-0000-4000-8000-000000000003','authenticated','authenticated');
insert into public.locations(id,name,code,is_active) values
 ('bd140000-0000-4000-8000-000000000001','Reset test A','BRTA',true),
 ('bd140000-0000-4000-8000-000000000002','Reset test B','BRTB',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
 ('bd140000-0000-4000-8000-000000000003','0899914001','Reset super','super_admin',true,false),
 ('bd140000-0000-4000-8000-000000000004','0899914002','Reset manager','admin',true,true),
 ('bd140000-0000-4000-8000-000000000005','0899914003','Reset other super','admin',true,false),
 ('bd140000-0000-4000-8000-000000000006','0899914004','Reset user','user',true,false);
select extensions.ok(not has_function_privilege('anon','public.preview_bill_device_reset()','execute'),'anonymous cannot preview');
select extensions.ok(not has_function_privilege('anon','public.reset_all_bill_devices(uuid,text,text)','execute'),'anonymous cannot reset');
select extensions.ok(not has_table_privilege('authenticated','private.bill_device_reset_receipts','insert'),'clients cannot forge reset receipts');
select set_config('request.jwt.claim.sub','bd140000-0000-4000-8000-000000000004',true);
select extensions.throws_ok($$select public.preview_bill_device_reset()$$,'42501','FORBIDDEN','system manager is not Super Admin');
select extensions.throws_ok($$select public.reset_all_bill_devices(gen_random_uuid(),repeat('a',64),'รีเซ็ตทั้งหมด','clear_registry_v1')$$,'42501','FORBIDDEN','manager cannot reset');
select set_config('request.jwt.claim.sub','bd140000-0000-4000-8000-000000000006',true);
select extensions.throws_ok($$select public.preview_bill_device_reset()$$,'42501','FORBIDDEN','ordinary user cannot preview');
select set_config('request.jwt.claim.sub','bd140000-0000-4000-8000-000000000003',true);
update public.profiles set is_active=false where id=auth.uid();
select extensions.throws_ok($$select public.preview_bill_device_reset()$$,'42501','FORBIDDEN','inactive Super Admin cannot preview');
select extensions.throws_ok($$select public.reset_all_bill_devices(gen_random_uuid(),repeat('a',64),'รีเซ็ตทั้งหมด','clear_registry_v1')$$,'42501','FORBIDDEN','inactive Super Admin cannot reset');
update public.profiles set is_active=true where id=auth.uid();
create temp table baseline as select public.preview_bill_device_reset() value;
create temp table registered(label text primary key,value jsonb);
insert into registered values ('a',public.register_rubber_bill_issuer('bd140000-0000-4000-8000-000000000001',
 'bd140000-0000-4000-8000-000000000010','bd140000-0000-4000-8000-000000000011'));
insert into registered values ('b',public.register_rubber_bill_issuer('bd140000-0000-4000-8000-000000000002',
 'bd140000-0000-4000-8000-000000000010','bd140000-0000-4000-8000-000000000011'));
insert into registered values ('orphan',public.register_rubber_bill_issuer('bd140000-0000-4000-8000-000000000001',
 'bd140000-0000-4000-8000-000000000012','bd140000-0000-4000-8000-000000000013'));
delete from private.rubber_bill_issuer_heads where issuer_id=(select (value->>'id')::uuid from registered where label='orphan');
delete from private.rubber_bill_issuers where id=(select (value->>'id')::uuid from registered where label='orphan');
select extensions.is((public.preview_bill_device_reset()->>'count')::bigint,(select (value->>'count')::bigint+2 from baseline),'one device across branches and orphan both count once');
create temp table preview as select public.preview_bill_device_reset() value;
update private.rubber_bill_issuers set browser='changed',last_seen_at=clock_timestamp() where id=(select (value->>'id')::uuid from registered where label='a');
select extensions.is(public.preview_bill_device_reset(),(select value from preview),'heartbeat and browser metadata do not change snapshot');
select extensions.throws_ok($$select public.reset_all_bill_devices(gen_random_uuid(),(select value->>'snapshot' from preview),'wrong','clear_registry_v1')$$,'22023','BILL_DEVICE_RESET_INVALID','typed confirmation is enforced by database');
select extensions.throws_ok($$select public.reset_all_bill_devices(null,(select value->>'snapshot' from preview),'รีเซ็ตทั้งหมด','clear_registry_v1')$$,'22023','BILL_DEVICE_RESET_INVALID','request ID is mandatory');
insert into registered values ('new',public.register_rubber_bill_issuer('bd140000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid()));
select extensions.throws_ok($$select public.reset_all_bill_devices('bd140000-0000-4000-8000-000000000020',(select value->>'snapshot' from preview),'รีเซ็ตทั้งหมด','clear_registry_v1')$$,'PT409','BILL_DEVICE_RESET_CONFLICT','new registration invalidates preview');
select extensions.is((select count(*) from private.bill_device_reset_receipts where request_id='bd140000-0000-4000-8000-000000000020'),0::bigint,'conflict writes no receipt');
select extensions.is((public.preview_bill_device_reset()->>'count')::bigint,(select (value->>'count')::bigint+3 from baseline),'conflict does not retire any device');
update preview set value=public.preview_bill_device_reset();
select public.retire_rubber_bill_issuer((select (value->>'id')::uuid from registered where label='new'));
insert into registered values ('replacement',public.register_rubber_bill_issuer('bd140000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid()));
select extensions.is((public.preview_bill_device_reset()->>'count')::bigint,(select (value->>'count')::bigint+1 from preview),'retired registrations stay in the reset preview');
select extensions.throws_ok($$select public.reset_all_bill_devices(gen_random_uuid(),(select value->>'snapshot' from preview),'รีเซ็ตทั้งหมด','clear_registry_v1')$$,'PT409','BILL_DEVICE_RESET_CONFLICT','same count but different identities requires reconfirmation');
update preview set value=public.preview_bill_device_reset();
create temp table highwater as select last_code,registry_epoch from private.bill_issuer_global_counter;
create temp table completed as select public.reset_all_bill_devices('bd140000-0000-4000-8000-000000000021',(select value->>'snapshot' from preview),'รีเซ็ตทั้งหมด','clear_registry_v1') value;
select extensions.is((select (value->>'retiredCount')::bigint from completed),(select (value->>'count')::bigint from preview),'receipt confirms entire preview');
select extensions.is((public.preview_bill_device_reset()->>'count')::bigint,0::bigint,'all device registrations cleared');
select extensions.is((select count(*) from private.rubber_bill_issuers),0::bigint,'every branch usage link deleted');
select extensions.is((select last_code from private.bill_issuer_global_counter),0::bigint,'reset restarts global code allocation');
select extensions.is((select registry_epoch from private.bill_issuer_global_counter),(select registry_epoch+1 from highwater),'reset advances registry epoch');
select extensions.is((select count(*) from private.bill_issuer_devices),0::bigint,'active, retired and orphan devices all deleted');
select extensions.is((select count(*) from private.legacy_bill_issuer_refs),0::bigint,'legacy plaintext references cleared too');
select extensions.ok(not has_table_privilege('authenticated','private.bill_number_issuer_proofs','insert'),'clients cannot forge number validation proofs');
select extensions.lives_ok($$select private.assert_rubber_bill_numbering(jsonb_build_object('operation','create','billType','weighing','clientTempId','reset-old-rubber',
 'locationId','bd140000-0000-4000-8000-000000000001','billDate','2026-11-01','localBillNo','0001-261101-'||(select value->>'code' from registered where label='a'),
 'billNumbering',jsonb_build_object('version',1,'issuerId',(select value->>'id' from registered where label='a'),'date','2026-11-01','sequence',1)))$$,'old offline rubber metadata remains accepted');
select extensions.lives_ok($$select private.assert_income_expense_numbering(jsonb_build_object('operation','create','clientTempId','reset-old-income',
 'locationId','bd140000-0000-4000-8000-000000000001','txDate','2026-11-01','type','income','billOption','รายรับ',
 'localBillNo','I-0001-261101-'||(select value->>'code' from registered where label='a'),
 'billNumbering',jsonb_build_object('version',1,'issuerId',(select value->>'id' from registered where label='a'),'date','2026-11-01','sequence',1)))$$,'old offline income metadata remains accepted');
create temp table old_business(label text primary key,payload jsonb,result jsonb);
insert into old_business select 'rubber',jsonb_build_object(
 'operation','create','formulaVersion',2,'expectedRevisionNo',0,'clientTempId','reset-old-business-rubber','idempotencyKey','reset-old-business-rubber',
 'locationId','bd140000-0000-4000-8000-000000000001','localBillNo','0002-'||to_char(now() at time zone 'Asia/Bangkok','YYMMDD')||'-'||(value->>'code'),
 'billDate',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'),'billType','weighing','customerName','Reset old outbox','deductWeight',0,'acidPackCount',0,
 'createdByUserId',auth.uid(),'createdByName','Reset super','createdByPhone','0899914001','clientRecordedAt',clock_timestamp(),'clientCreatedAt',clock_timestamp(),
 'billNumbering',jsonb_build_object('version',1,'issuerId',value->>'id','date',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'),'sequence',2),
 'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','1','inWeight',10,'outWeight',0,'netWeight',10,'unitPrice',1,'totalAmount',10,'sequenceNo',1))),null
 from registered where label='a';
update old_business set result=public.sync_numbered_rubber_bill(payload) where label='rubber';
select extensions.is((select result->>'status' from old_business where label='rubber'),'synced','real old rubber outbox commits after bulk reset');
select extensions.is((select result->>'serverBillNo' from old_business where label='rubber'),(select payload->>'localBillNo'||'-1' from old_business where label='rubber'),'real old rubber base retains first suffix');
select extensions.is((select public.sync_numbered_rubber_bill(payload)->>'serverBillNo' from old_business where label='rubber'),(select result->>'serverBillNo' from old_business where label='rubber'),'real old rubber replay keeps final number');
select extensions.is((select count(*) from public.rubber_bills where client_temp_id='reset-old-business-rubber'),1::bigint,'real old rubber replay creates one business row');
select extensions.throws_ok($$select public.reset_all_bill_devices(gen_random_uuid(),public.preview_bill_device_reset()->>'snapshot','รีเซ็ตทั้งหมด','clear_registry_v1')$$,'PT409','BILL_DEVICE_RESET_EMPTY','empty registry cannot create a reset');
insert into registered values ('after',public.register_rubber_bill_issuer('bd140000-0000-4000-8000-000000000001',
 'bd140000-0000-4000-8000-000000000010','bd140000-0000-4000-8000-000000000011'));
select extensions.is((select value->>'code' from registered where label='after'),'D01','first replacement reuses D01');
select extensions.is(public.reset_all_bill_devices('bd140000-0000-4000-8000-000000000021',(select value->>'snapshot' from preview),'รีเซ็ตทั้งหมด','clear_registry_v1'),(select value from completed),'retry returns exact original result before checking changed snapshot');
select extensions.is((public.preview_bill_device_reset()->>'count')::bigint,1::bigint,'retry preserves newly registered replacement');
select extensions.throws_ok($$select public.reset_all_bill_devices('bd140000-0000-4000-8000-000000000021',repeat('a',64),'รีเซ็ตทั้งหมด','clear_registry_v1')$$,'22023','BILL_DEVICE_RESET_REQUEST_MISMATCH','request cannot change snapshot');
update public.profiles set role='admin' where id='bd140000-0000-4000-8000-000000000003';
update public.profiles set role='super_admin' where id='bd140000-0000-4000-8000-000000000005';
select set_config('request.jwt.claim.sub','bd140000-0000-4000-8000-000000000005',true);
select extensions.throws_ok($$select public.reset_all_bill_devices('bd140000-0000-4000-8000-000000000021',(select value->>'snapshot' from preview),'รีเซ็ตทั้งหมด','clear_registry_v1')$$,'22023','BILL_DEVICE_RESET_REQUEST_MISMATCH','request cannot change actor');
select set_config('request.jwt.claim.sub','',true);
select extensions.throws_ok($$select public.preview_bill_device_reset()$$,'42501','FORBIDDEN','signed-out actor cannot preview');
select * from extensions.finish();
rollback;
