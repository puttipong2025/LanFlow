begin;
select extensions.no_plan();
insert into public.locations(id,name,code,is_active) values
 ('ad110000-0000-4000-8000-000000000001','Global issuer A','GIA',true),
 ('ad110000-0000-4000-8000-000000000002','Global issuer B','GIB',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
 values('ad110000-0000-4000-8000-000000000003','0899998111','Global issuer operator','admin',true,true);
insert into public.user_locations(user_id,location_id,is_primary) values
 ('ad110000-0000-4000-8000-000000000003','ad110000-0000-4000-8000-000000000001',true),
 ('ad110000-0000-4000-8000-000000000003','ad110000-0000-4000-8000-000000000002',false);
select set_config('request.jwt.claim.sub','ad110000-0000-4000-8000-000000000003',true);
create temp table global_before as select last_code from private.bill_issuer_global_counter where id=true;
create temp table registered(label text primary key,value jsonb);
insert into registered values('a',public.register_rubber_bill_issuer('ad110000-0000-4000-8000-000000000001',
 'ad110000-0000-4000-8000-000000000010','ad110000-0000-4000-8000-000000000011'));
insert into registered values('b',public.register_rubber_bill_issuer('ad110000-0000-4000-8000-000000000002',
 'ad110000-0000-4000-8000-000000000010','ad110000-0000-4000-8000-000000000011'));
select extensions.is((select count(distinct value->>'code') from registered),1::bigint,'same installation has one code across branches');
select extensions.is((select count(distinct value->>'deviceId') from registered),1::bigint,'same browser has one central device identity');
select extensions.is((select count(distinct value->>'id') from registered),2::bigint,'branch usage links retain separate authorization identities');
select extensions.ok((select min(substring(value->>'code' from 2)::bigint) from registered)>(select last_code from global_before),'new codes exceed retained high water');
select extensions.is(public.register_rubber_bill_issuer('ad110000-0000-4000-8000-000000000001',
 'ad110000-0000-4000-8000-000000000010','ad110000-0000-4000-8000-000000000011')->>'id',
 (select value->>'id' from registered where label='a'),'exact registration retry stays stable');
select extensions.is((select last_code from private.bill_issuer_global_counter),(select last_code+1 from global_before),'branch switch and retry do not consume another code');
select extensions.is((public.list_rubber_bill_issuers(p_search=>(select value->>'code' from registered where label='a'))->>'total')::bigint,1::bigint,'Admin lists one device rather than one row per branch');
select public.retire_rubber_bill_issuer((select (value->>'id')::uuid from registered where label='a'));
insert into registered values('replacement',public.register_rubber_bill_issuer('ad110000-0000-4000-8000-000000000001',
 'ad110000-0000-4000-8000-000000000010','ad110000-0000-4000-8000-000000000011'));
select extensions.is((select count(distinct value->>'code') from registered),2::bigint,'retired device code is never recycled');
select extensions.is((select count(*) from private.rubber_bill_issuers where device_id=(select (value->>'deviceId')::uuid from registered where label='a') and retired_at is not null),2::bigint,'retirement applies to every branch using the same device');
select extensions.throws_ok($$insert into private.bill_issuer_devices(code,installation_id,generation_id)
 select value->>'code',gen_random_uuid(),gen_random_uuid() from registered where label='replacement'$$,
 '23505',null,'database rejects duplicate codes for different devices');

-- Historical duplicates remain readable; each browser moves to the global namespace online.
insert into private.rubber_bill_issuers(id,location_id,code,installation_id,generation_id,browser,platform,global_code) values
 ('ad110000-0000-4000-8000-000000000020','ad110000-0000-4000-8000-000000000001','D00','ad110000-0000-4000-8000-000000000021','ad110000-0000-4000-8000-000000000022','','',false),
 ('ad110000-0000-4000-8000-000000000023','ad110000-0000-4000-8000-000000000002','D00','ad110000-0000-4000-8000-000000000021','ad110000-0000-4000-8000-000000000022','','',false);
insert into private.rubber_bill_issuer_heads values
 ('ad110000-0000-4000-8000-000000000001','ad110000-0000-4000-8000-000000000021','ad110000-0000-4000-8000-000000000022','ad110000-0000-4000-8000-000000000020'),
 ('ad110000-0000-4000-8000-000000000002','ad110000-0000-4000-8000-000000000021','ad110000-0000-4000-8000-000000000022','ad110000-0000-4000-8000-000000000023');
insert into registered values('old-a',public.register_rubber_bill_issuer('ad110000-0000-4000-8000-000000000001',
 'ad110000-0000-4000-8000-000000000021','ad110000-0000-4000-8000-000000000022'));
insert into registered values('old-b',public.register_rubber_bill_issuer('ad110000-0000-4000-8000-000000000002',
 'ad110000-0000-4000-8000-000000000021','ad110000-0000-4000-8000-000000000022'));
select extensions.is((select count(distinct value->>'code') from registered),3::bigint,'historical registrations of the same browser share the replacement device code');
select extensions.is((select count(*) from private.rubber_bill_issuers where code='D00' and location_id in
 ('ad110000-0000-4000-8000-000000000001','ad110000-0000-4000-8000-000000000002') and retired_at is not null),2::bigint,'old registrations are retained and retired');
select extensions.lives_ok($$select private.assert_rubber_bill_numbering(jsonb_build_object('operation','create','clientTempId','global-old-rubber',
 'locationId','ad110000-0000-4000-8000-000000000001','localBillNo','0001-261101-D00','billType','weighing',
 'billNumbering',jsonb_build_object('version',1,'issuerId','ad110000-0000-4000-8000-000000000020','date','2026-11-01','sequence',1)))$$,
 'old offline rubber proposals remain valid');
select extensions.lives_ok($$select private.assert_income_expense_numbering(jsonb_build_object('operation','create','clientTempId','global-old-income',
 'locationId','ad110000-0000-4000-8000-000000000001','localBillNo','I-0001-261101-D00','type','income','billOption','รายรับ','txDate','2026-11-01',
 'billNumbering',jsonb_build_object('version',1,'issuerId','ad110000-0000-4000-8000-000000000020','date','2026-11-01','sequence',1)))$$,
 'old offline income proposals remain valid under the same retained registry');
select extensions.ok(not has_table_privilege('authenticated','private.bill_issuer_global_counter','update'),'clients cannot reset global high water');
select extensions.ok(not has_table_privilege('anon','private.bill_issuer_global_counter','select'),'anonymous cannot read global high water');
select * from extensions.finish();
rollback;
