begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);
insert into public.locations(id,name,code,is_active) values('ac000000-0000-4000-8000-000000000001','OCR command fixture','OCMREG',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values('ac000000-0000-4000-8000-000000000002','0897082803','OCR command operator','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary)
values('ac000000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-000000000001',true);
update public.rubber_bill_approval_settings set non_current_date_requires_approval=true where id=true;
insert into public.rubber_bill_ocr_sources(id,owner_user_id,location_id,state,image_sha256,drive_file_id,image_mime_type,image_size_bytes,original_file_name)
values('ac000000-0000-4000-8000-000000000003','ac000000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-000000000001',
'staged',repeat('b',64),'command-fixture-file','image/jpeg',1024,'fixture.jpg');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
create function pg_temp.ocr_command(p_key text,p_generation integer) returns jsonb language sql as $$
select jsonb_build_object('operation','create','contractVersion',2,'commandId',p_key,'idempotencyKey',p_key,
'expectedCommandGeneration',p_generation,'expectedRevisionNo',0,'clientTempId','ocr-command-fixture',
'locationId','ac000000-0000-4000-8000-000000000001','localBillNo','OCR-CMD','formulaVersion',2,
'recordStatus','active','billDate',(current_date-2)::text,'customerName','OCR fixture','billType','บิลเครื่องชั่งเล็ก',
'weight',10,'netWeight',10,'rubberValue',0,'netRubberValue',0,'averagePrice',0,'deductionTotal',0,'netTotal',0,
'inputMethod','ocr','ocrUploadId','ac000000-0000-4000-8000-000000000003',
'items',jsonb_build_array(jsonb_build_object('itemType','weigh','title','OCR','inWeight',100,'outWeight',90,
'netWeight',10,'unitPrice',0,'totalAmount',0,'sequenceNo',1)))
$$;
create temp table ocr_results(label text,result jsonb);
insert into ocr_results values('first',public.sync_rubber_bill(pg_temp.ocr_command('ac000000-0000-4000-8000-000000000011',0)));
select extensions.is((select result->>'status' from ocr_results where label='first'),'pending_approval','OCR create awaits date approval');
insert into ocr_results values('replacement',public.sync_rubber_bill(pg_temp.ocr_command('ac000000-0000-4000-8000-000000000012',1)));
select extensions.is((select result->>'status' from ocr_results where label='replacement'),'pending_approval','replacement reuses the same authorized OCR source');
select extensions.is((select state from public.rubber_bill_ocr_sources where id='ac000000-0000-4000-8000-000000000003'),'reserved','same source is not abandoned');
select extensions.is((select reserved_idempotency_key from public.rubber_bill_ocr_sources where id='ac000000-0000-4000-8000-000000000003'),'ac000000-0000-4000-8000-000000000012','reservation moves to new command atomically');
select extensions.is((select count(*) from public.rubber_bill_approval_requests where client_temp_id='ocr-command-fixture'),1::bigint,'old OCR proposal payload is removed');
select extensions.is(public.sync_rubber_bill(pg_temp.ocr_command('ac000000-0000-4000-8000-000000000011',0))->>'status','discarded','old OCR command cannot reclaim source');
select extensions.is(public.sync_rubber_bill(pg_temp.ocr_command('ac000000-0000-4000-8000-000000000013',0))->>'errorCode','STALE_COMMAND_CONTEXT','delayed offline create cannot replace current OCR proposal');
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values('ac000000-0000-4000-8000-000000000004','0897082804','Other OCR operator','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary)
values('ac000000-0000-4000-8000-000000000004','ac000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000004',true);
select extensions.is(public.sync_rubber_bill(pg_temp.ocr_command('ac000000-0000-4000-8000-000000000014',2))->>'status','conflict','replacement rights do not grant access to another owner OCR source');
select extensions.is((select state from public.rubber_bill_ocr_sources where id='ac000000-0000-4000-8000-000000000003'),'reserved','unauthorized source reuse rolls back abandonment');
insert into public.rubber_bill_ocr_sources(id,owner_user_id,location_id,state,image_sha256,drive_file_id,image_mime_type,image_size_bytes,original_file_name)
values('ac000000-0000-4000-8000-000000000005','ac000000-0000-4000-8000-000000000004','ac000000-0000-4000-8000-000000000001',
'staged',repeat('c',64),'command-fixture-other-file','image/jpeg',1024,'other.jpg');
select extensions.is(public.sync_rubber_bill(pg_temp.ocr_command('ac000000-0000-4000-8000-000000000015',2)
||'{"ocrUploadId":"ac000000-0000-4000-8000-000000000005"}'::jsonb)->>'status','pending_approval','new actor can replace using their own authorized source');
select extensions.is((select state from public.rubber_bill_ocr_sources where id='ac000000-0000-4000-8000-000000000003'),'abandoned','replaced source is abandoned only after replacement succeeds');
select extensions.is((select reserved_idempotency_key from public.rubber_bill_ocr_sources where id='ac000000-0000-4000-8000-000000000005'),'ac000000-0000-4000-8000-000000000015','new source is bound to new command');
select * from extensions.finish();
rollback;
