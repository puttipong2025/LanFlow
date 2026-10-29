begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code,is_active) values
('af000000-0000-4000-8000-000000000001','Queue retirement','CQRET',true);
insert into auth.users(id,aud,role) values('af000000-0000-4000-8000-000000000002','authenticated','authenticated');
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
('af000000-0000-4000-8000-000000000002','0897082811','Origin operator','admin',true,false),
('af000000-0000-4000-8000-000000000003','0897082812','Retirement manager','admin',true,true),
('af000000-0000-4000-8000-000000000004','0897082813','Another operator','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary) values
('af000000-0000-4000-8000-000000000002','af000000-0000-4000-8000-000000000001',true),
('af000000-0000-4000-8000-000000000004','af000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
create function pg_temp.retirement_payload(key uuid,client text) returns jsonb language sql as $$
select jsonb_build_object('centralQueue',true,'contractVersion',2,'commandId',key,'idempotencyKey',key,'operation','create',
 'expectedCommandGeneration',0,'expectedQueueVersion',0,'expectedRevisionNo',0,
 'locationId','af000000-0000-4000-8000-000000000001','clientTempId',client,'localBillNo',client,
 'billDate',(clock_timestamp() at time zone 'Asia/Bangkok')::date,'billType','weighing','customerName','Retirement fixture',
 'inputMethod','manual','deductWeight',0,'acidPackCount',0,'items',jsonb_build_array(jsonb_build_object(
 'itemType','weigh','title','Weigh','netWeight',10,'inWeight',10,'outWeight',0,'unitPrice',0,'sequenceNo',1)))
$$;
select public.submit_rubber_queue(pg_temp.retirement_payload('af000000-0000-4000-8000-000000000011','retire-origin'));
select public.submit_rubber_queue(pg_temp.retirement_payload('af000000-0000-4000-8000-000000000012','retire-other'));
update public.profiles set is_active=false where id='af000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000003',true);
select extensions.throws_ok($$select public.manage_rubber_queue('af000000-0000-4000-8000-000000000011',1,'retire')$$,
 'P0001','FORBIDDEN_ACTION','temporary inactive status is not permanent closure');
select extensions.is(public.get_rubber_queue('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000011')->>'canRetire',
 'false','temporary inactive does not expose retirement action');
select private.process_rubber_queue(20);
select extensions.is((select state from private.rubber_queue_jobs where command_id='af000000-0000-4000-8000-000000000011'),'paused','worker preserves temporarily inactive work');
select extensions.throws_ok($$select public.manage_rubber_queue('af000000-0000-4000-8000-000000000011',1,'retry')$$,
 'P0001','QUEUE_CHANGED','management cannot overwrite a newer worker version');
delete from auth.users where id='af000000-0000-4000-8000-000000000002';
update public.profiles set is_active=true where id='af000000-0000-4000-8000-000000000002';
update private.rubber_queue_jobs set next_attempt_at=clock_timestamp() where command_id='af000000-0000-4000-8000-000000000012';
select private.process_rubber_queue(20);
select extensions.is((select state from private.rubber_queue_jobs where command_id='af000000-0000-4000-8000-000000000012'),
 'paused','deleted Auth actor cannot execute even when the retained profile is active');
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000004',true);
select extensions.throws_ok($$select public.manage_rubber_queue('af000000-0000-4000-8000-000000000011',2,'retire')$$,
 'P0001','FORBIDDEN_ACTION','read access never grants manager retirement');
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000003',true);
select extensions.is(public.manage_rubber_queue('af000000-0000-4000-8000-000000000011',2,'retire')->'result'->>'errorCode',
 'ACCOUNT_CLOSED','explicit manager confirmation retires permanently closed owner job');
select extensions.is((select retired_by::text from private.rubber_queue_jobs where command_id='af000000-0000-4000-8000-000000000011'),
 'af000000-0000-4000-8000-000000000003','retirement audit keeps actual manager');
select extensions.ok((select payload is null and completed_at is not null from private.rubber_queue_jobs where command_id='af000000-0000-4000-8000-000000000011'),'retirement clears proposal after durable receipt');
select extensions.is((select count(*) from private.rubber_bill_report_blockers('af000000-0000-4000-8000-000000000001',clock_timestamp())),1::bigint,
 'other pending blocker survives orphan retirement');
select extensions.is((select count(*) from public.rubber_bills where location_id='af000000-0000-4000-8000-000000000001'),0::bigint,'retirement creates/deletes no business bill');
select extensions.throws_ok($$select public.manage_rubber_queue('af000000-0000-4000-8000-000000000011',3,'retire')$$,
 'P0001','QUEUE_CHANGED','repeated retirement cannot overwrite terminal receipt');
select extensions.ok(not has_function_privilege('authenticated','private.process_rubber_queue_batch(integer,uuid)','execute'),'branch preflight does not expose the private kernel');
select * from extensions.finish();
rollback;
