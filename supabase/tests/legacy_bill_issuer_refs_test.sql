begin;
select extensions.no_plan();
insert into auth.users(id,aud,role) values('ad230000-0000-4000-8000-000000000001','authenticated','authenticated');
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
 values('ad230000-0000-4000-8000-000000000001','0899998230','Legacy reference operator','admin',true,true);
insert into public.locations(id,name,code,is_active) values('ad230000-0000-4000-8000-000000000002','Legacy reference fixture','LRF',true);
insert into public.user_locations(user_id,location_id,is_primary)
 values('ad230000-0000-4000-8000-000000000001','ad230000-0000-4000-8000-000000000002',true);
insert into private.legacy_bill_issuer_refs values('ad230000-0000-4000-8000-000000000003','ad230000-0000-4000-8000-000000000002','D00');
select set_config('request.jwt.claim.sub','ad230000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ad230000-0000-4000-8000-000000000001","role":"authenticated"}',true);
update public.income_expense_approval_settings set approval_min_amount=null,non_current_date_requires_approval=false;
update public.income_expense_approval_keywords set is_active=false;
create temp table legacy_results(label text primary key,result jsonb);
insert into legacy_results values('rubber',public.sync_numbered_rubber_bill(jsonb_build_object(
 'operation','create','formulaVersion',2,'expectedRevisionNo',0,'clientTempId','archived-rubber','idempotencyKey','archived-rubber',
 'locationId','ad230000-0000-4000-8000-000000000002','localBillNo','0001-261101-D00','billDate','2026-11-01',
 'billType','weighing','customerName','Legacy reference fixture','deductWeight',0,'acidPackCount',0,
 'createdByUserId','ad230000-0000-4000-8000-000000000001','createdByName','Legacy reference operator','createdByPhone','0899998230',
 'clientRecordedAt',clock_timestamp(),'clientCreatedAt',clock_timestamp(),
 'billNumbering',jsonb_build_object('version',1,'issuerId','ad230000-0000-4000-8000-000000000003','date','2026-11-01','sequence',1),
 'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','1','inWeight',10,'outWeight',0,'netWeight',10,'unitPrice',1,'totalAmount',10,'sequenceNo',1)))));
insert into legacy_results values('income',public.sync_numbered_income_expense(jsonb_build_object(
 'operation','create','expectedRevisionNo',0,'clientTempId','archived-income','idempotencyKey','create:archived-income:0',
 'locationId','ad230000-0000-4000-8000-000000000002','localBillNo','I-0001-261101-D00','txDate','2026-11-01',
 'type','income','title','Legacy reference fixture','cost',10,'billOption','รายรับ','recordStatus','active',
 'createdByUserId','ad230000-0000-4000-8000-000000000001','createdByName','Legacy reference operator','createdByPhone','0899998230',
 'clientRecordedAt',clock_timestamp(),'clientCreatedAt',clock_timestamp(),
 'billNumbering',jsonb_build_object('version',1,'issuerId','ad230000-0000-4000-8000-000000000003','date','2026-11-01','sequence',1))));
select extensions.is((select count(*) from private.rubber_bill_issuers where id='ad230000-0000-4000-8000-000000000003'),0::bigint,'old reference is absent from the device registration table');
select extensions.is((select result->>'status' from legacy_results where label='rubber'),'synced','old rubber outbox can commit after its registration is deleted');
select extensions.is((select result->>'serverBillNo' from legacy_results where label='rubber'),'0001-261101-D00-1','old rubber base remains frozen');
select extensions.is((select result->>'status' from legacy_results where label='income'),'synced','old income outbox can commit after its registration is deleted');
select extensions.is((select result->>'serverBillNo' from legacy_results where label='income'),'I-0001-261101-D00-1','old income base remains frozen');
select extensions.throws_ok($$select private.assert_rubber_bill_numbering(jsonb_build_object('operation','create','clientTempId','archived-wrong-branch',
 'locationId','ad230000-0000-4000-8000-000000000004','localBillNo','0001-261101-D00','billType','weighing',
 'billNumbering',jsonb_build_object('version',1,'issuerId','ad230000-0000-4000-8000-000000000003','date','2026-11-01','sequence',1)))$$,
 'P0001','INVALID_BILL_NUMBER','archived references cannot authorize another branch');
select extensions.ok(not has_table_privilege('authenticated','private.legacy_bill_issuer_refs','insert'),'ordinary clients cannot forge old references');
select * from extensions.finish();
rollback;
