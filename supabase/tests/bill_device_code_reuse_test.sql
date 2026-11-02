begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
update public.profiles set role='admin' where role='super_admin';
insert into auth.users(id,aud,role) values('bd150000-0000-4000-8000-000000000001','authenticated','authenticated');
insert into public.profiles(id,phone,name,role,is_active)
  values('bd150000-0000-4000-8000-000000000001','0899915001','Reuse test','super_admin',true);
insert into public.locations(id,name,code,is_active)
  values('bd150000-0000-4000-8000-000000000002','Reuse test','BRTU',true);
select set_config('request.jwt.claim.sub','bd150000-0000-4000-8000-000000000001',true);
insert into public.income_expense_approval_settings(id) values(true) on conflict(id) do nothing;
update public.income_expense_approval_settings set approval_min_amount=null,non_current_date_requires_approval=false;
update public.income_expense_approval_keywords set is_active=false;
do $$ begin
  if (public.preview_bill_device_reset()->>'count')::bigint > 0 then
    perform public.reset_all_bill_devices(gen_random_uuid(),public.preview_bill_device_reset()->>'snapshot','รีเซ็ตทั้งหมด','clear_registry_v1');
  end if;
end $$;
-- Other integration fixtures may remove their registrations without resetting
-- their counter. Own this initial empty-registry fixture explicitly.
update private.bill_issuer_global_counter set last_code=0;
create temp table issuers(label text primary key,value jsonb);
insert into issuers values('old',public.register_rubber_bill_issuer('bd150000-0000-4000-8000-000000000002',gen_random_uuid(),gen_random_uuid()));
select extensions.is((select value->>'code' from issuers where label='old'),'D01','first round begins at D01');
create temp table inputs(label text primary key,kind text,p jsonb,r jsonb);
insert into inputs select 'rubber-old','rubber',jsonb_build_object(
  'operation','create','formulaVersion',2,'expectedRevisionNo',0,'clientTempId','reuse-rubber-old','idempotencyKey','reuse-rubber-old',
  'locationId','bd150000-0000-4000-8000-000000000002','localBillNo','0001-'||to_char(now() at time zone 'Asia/Bangkok','YYMMDD')||'-D01',
  'billDate',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'),'billType','weighing','customerName','Reuse test',
  'deductWeight',0,'acidPackCount',0,'createdByUserId',auth.uid(),'createdByName','Reuse test','createdByPhone','0899915001',
  'clientRecordedAt',clock_timestamp(),'clientCreatedAt',clock_timestamp(),
  'billNumbering',jsonb_build_object('version',1,'issuerId',value->>'id','date',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'),'sequence',1),
  'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','1','inWeight',10,'outWeight',0,'netWeight',10,'unitPrice',1,'totalAmount',10,'sequenceNo',1))),null
  from issuers where label='old';
insert into inputs select 'income-old','income',jsonb_build_object(
  'operation','create','expectedRevisionNo',0,'clientTempId','reuse-income-old','idempotencyKey','reuse-income-old',
  'locationId','bd150000-0000-4000-8000-000000000002','recordStatus','active',
  'localBillNo','I-0001-'||to_char(now() at time zone 'Asia/Bangkok','YYMMDD')||'-D01',
  'txDate',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'),'type','income','title','Reuse income','cost',10,'billOption','รายรับ',
  'clientRecordedAt',clock_timestamp(),'clientCreatedAt',clock_timestamp(),
  'createdByUserId',auth.uid(),'createdByName','Reuse test','createdByPhone','0899915001',
  'billNumbering',jsonb_build_object('version',1,'issuerId',value->>'id','date',to_char(now() at time zone 'Asia/Bangkok','YYYY-MM-DD'),'sequence',1)),null
  from issuers where label='old';
insert into inputs select 'expense-old','income',p||jsonb_build_object(
  'clientTempId','reuse-expense-old','idempotencyKey','reuse-expense-old','type','expense','billOption','ค่าใช้จ่าย',
  'localBillNo',replace(p->>'localBillNo','I-','E-')),null from inputs where label='income-old';
update inputs set r=case when kind='rubber' then public.sync_numbered_rubber_bill(p) else public.sync_numbered_income_expense(p) end;
select extensions.is(r->>'status','synced',label||' commits before reset') from inputs order by label;
select extensions.is(r->>'serverBillNo',p->>'localBillNo'||'-1',label||' gets suffix one') from inputs order by label;

-- Remove both an individually retired device and a pre-shared-device reference.
select public.retire_rubber_bill_issuer((select (value->>'id')::uuid from issuers where label='old'));
insert into private.legacy_bill_issuer_refs values('bd150000-0000-4000-8000-000000000003','bd150000-0000-4000-8000-000000000002','D99');
create temp table before_reset as select public.preview_bill_device_reset() value;
select extensions.is((select (value->>'count')::bigint from before_reset),2::bigint,'preview includes retired device and legacy reference');
create temp table before_failure as select last_code,registry_epoch,
  (select count(*) from private.bill_number_issuer_proofs) proof_count from private.bill_issuer_global_counter;
create function pg_temp.fail_reset_receipt() returns trigger language plpgsql as $$ begin
  if new.request_id='bd150000-0000-4000-8000-000000000004' then raise exception 'reset receipt fault'; end if;
  return new;
end $$;
create trigger reuse_reset_failure before insert on private.bill_device_reset_receipts
  for each row execute function pg_temp.fail_reset_receipt();
select extensions.throws_ok($$select public.reset_all_bill_devices('bd150000-0000-4000-8000-000000000004',
  (select value->>'snapshot' from before_reset),'รีเซ็ตทั้งหมด','clear_registry_v1')$$,'P0001','reset receipt fault','failure after deletes aborts the reset');
select extensions.is(public.preview_bill_device_reset(),(select value from before_reset),'failed reset restores the complete registry');
select extensions.is((select last_code from private.bill_issuer_global_counter),(select last_code from before_failure),'failed reset restores code counter');
select extensions.is((select registry_epoch from private.bill_issuer_global_counter),(select registry_epoch from before_failure),'failed reset restores epoch');
select extensions.is((select count(*) from private.bill_number_issuer_proofs),(select proof_count from before_failure),'failed reset rolls back proof insertion');
drop trigger reuse_reset_failure on private.bill_device_reset_receipts;
select public.reset_all_bill_devices(gen_random_uuid(),(select value->>'snapshot' from before_reset),'รีเซ็ตทั้งหมด','clear_registry_v1');
select extensions.is((select count(*) from private.bill_issuer_devices),0::bigint,'no active or retired device remains');
select extensions.is((select count(*) from private.rubber_bill_issuers),0::bigint,'no branch registration remains');
select extensions.is((select count(*) from private.bill_issuer_device_heads),0::bigint,'no device head remains');
select extensions.is((select count(*) from private.rubber_bill_issuer_heads),0::bigint,'no branch head remains');
select extensions.is((select count(*) from private.legacy_bill_issuer_refs),0::bigint,'no old plaintext code reference remains');
select extensions.is((select count(*) from private.rubber_bill_issuer_counters),0::bigint,'no branch code high water remains');
select extensions.is((select last_code from private.bill_issuer_global_counter),0::bigint,'global display code counter returns to zero');
select extensions.ok(not has_function_privilege('authenticated','private.resolve_bill_number_issuer(uuid,uuid,text)','execute'),'clients cannot call proof resolver');
select extensions.ok(not has_table_privilege('authenticated','private.bill_number_issuer_proofs','select'),'proofs stay private');

insert into issuers values('new',public.register_rubber_bill_issuer('bd150000-0000-4000-8000-000000000002',gen_random_uuid(),gen_random_uuid()));
select extensions.is((select value->>'code' from issuers where label='new'),'D01','new machine reuses retired D01');
select extensions.is((select (value->>'registryEpoch')::integer from issuers where label='new'),
  (select (value->>'registryEpoch')::integer+1 from issuers where label='old'),'registration advertises newer epoch');
insert into inputs select replace(label,'-old','-new'),kind,p||jsonb_build_object(
  'clientTempId',replace(p->>'clientTempId','-old','-new'),'idempotencyKey',replace(p->>'idempotencyKey','-old','-new'),
  'billNumbering',(p->'billNumbering')||jsonb_build_object('issuerId',(select value->>'id' from issuers where label='new'))),null
  from inputs where label like '%-old';
update inputs set r=case when kind='rubber' then public.sync_numbered_rubber_bill(p) else public.sync_numbered_income_expense(p) end where label like '%-new';
select extensions.is(r->>'status','synced',label||' commits with reused code') from inputs where label like '%-new' order by label;
select extensions.is(r->>'serverBillNo',p->>'localBillNo'||'-2',label||' continues suffix instead of duplicating full number') from inputs where label like '%-new' order by label;

-- A machine that remained offline may submit another frozen old-code bill later.
insert into inputs select replace(label,'-old','-offline'),kind,p||jsonb_build_object(
  'clientTempId',replace(p->>'clientTempId','-old','-offline'),'idempotencyKey',replace(p->>'idempotencyKey','-old','-offline')),null
  from inputs where label like '%-old';
update inputs set r=case when kind='rubber' then public.sync_numbered_rubber_bill(p) else public.sync_numbered_income_expense(p) end where label like '%-offline';
select extensions.is(r->>'serverBillNo',p->>'localBillNo'||'-3',label||' validates deleted issuer and gets separate suffix') from inputs where label like '%-offline' order by label;
select extensions.is(case when kind='rubber' then public.sync_numbered_rubber_bill(p)->>'serverBillNo'
  else public.sync_numbered_income_expense(p)->>'serverBillNo' end,r->>'serverBillNo',label||' exact replay keeps number') from inputs order by label;

select extensions.throws_ok($$select private.assert_rubber_bill_numbering(p||jsonb_build_object('localBillNo',replace(p->>'localBillNo','D01','D02'))) from inputs where label='rubber-old'$$,
  'P0001','BILL_NUMBER_CHANGED','cannot change number on an already created rubber bill');
select extensions.throws_ok($$select private.assert_rubber_bill_numbering(p||jsonb_build_object('clientTempId','unknown-code','localBillNo',replace(p->>'localBillNo','D01','D02'))) from inputs where label='rubber-old'$$,
  'P0001','INVALID_BILL_NUMBER','deleted issuer proof rejects a forged code');
select extensions.throws_ok($$select private.assert_income_expense_numbering(p||jsonb_build_object('clientTempId','unknown-branch','locationId','bd150000-0000-4000-8000-000000000009')) from inputs where label='income-old'$$,
  'P0001','INVALID_BILL_NUMBER','deleted issuer proof rejects a different branch');
select extensions.throws_ok($$select private.assert_income_expense_numbering(p||jsonb_build_object('clientTempId','unknown-issuer',
  'billNumbering',(p->'billNumbering')||jsonb_build_object('issuerId',gen_random_uuid()))) from inputs where label='income-old'$$,
  'P0001','INVALID_BILL_NUMBER','unknown UUID never becomes a valid issuer just because a reset happened');
select extensions.lives_ok($$select private.assert_rubber_bill_numbering(p||jsonb_build_object('clientTempId','legacy-offline',
  'localBillNo',replace(p->>'localBillNo','D01','D99'),
  'billNumbering',(p->'billNumbering')||jsonb_build_object('issuerId','bd150000-0000-4000-8000-000000000003'))) from inputs where label='rubber-old'$$,
  'legacy offline work validates after plaintext legacy references were cleared');

select public.reset_all_bill_devices(gen_random_uuid(),public.preview_bill_device_reset()->>'snapshot','รีเซ็ตทั้งหมด','clear_registry_v1');
select extensions.is(case when kind='rubber' then public.sync_numbered_rubber_bill(p)->>'serverBillNo'
  else public.sync_numbered_income_expense(p)->>'serverBillNo' end,r->>'serverBillNo',label||' survives another reset') from inputs order by label;
select * from extensions.finish();
rollback;
