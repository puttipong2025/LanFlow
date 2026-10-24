begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code) values('cc280000-0000-4000-8000-000000000001','Four accounts','CC4A24');
insert into public.profiles(id,name,phone,role,can_access_super_admin_features) values('cc280000-0000-4000-8000-000000000002','Four manager','0899928011','admin',true);
select set_config('request.jwt.claim.sub','cc280000-0000-4000-8000-000000000002',true);
create temp table cc4 as select (public.start_cash_count_session('cc280000-0000-4000-8000-000000000001')->'session'->>'id')::uuid session_id;
create temp table cc4counts as select '{"1":0,"2":0,"5":0,"10":0,"20":0,"50":0,"100":0,"500":0,"1000":1}'::jsonb counts;
insert into public.cash_count_bank_evidence(id,session_id,owner_user_id,image_sha256,amount,balance_kind,drive_file_id,drive_uploaded_at)
 select ('cc280000-0000-4000-8000-00000000001'||n)::uuid,session_id,'cc280000-0000-4000-8000-000000000002',repeat('a',64),n*100.25,'balance','fake-file-'||n,now()
 from cc4 cross join generate_series(1,5) n;
select extensions.is((select count(*)::integer from public.cash_count_bank_evidence where session_id=(select session_id from cc4)),5,'same image allowed in distinct slots');
select extensions.throws_like($$select public.submit_cash_count_v3((select session_id from cc4),(select counts from cc4counts),(select array_agg(id) from public.cash_count_bank_evidence where session_id=(select session_id from cc4)))$$,'%สูงสุด 4%','five selected accounts rejected');
select extensions.throws_like($$select public.submit_cash_count_v3((select session_id from cc4),(select counts from cc4counts),array['cc280000-0000-4000-8000-000000000011','cc280000-0000-4000-8000-000000000011']::uuid[])$$,'%สูงสุด 4%','same evidence row cannot be attached twice');
update public.cash_count_bank_evidence set drive_uploaded_at=null where id='cc280000-0000-4000-8000-000000000014';
select extensions.throws_like($$select public.submit_cash_count_v3((select session_id from cc4),(select counts from cc4counts),array['cc280000-0000-4000-8000-000000000011','cc280000-0000-4000-8000-000000000012','cc280000-0000-4000-8000-000000000013','cc280000-0000-4000-8000-000000000014']::uuid[])$$,'%หลักฐานบัญชีไม่พร้อม%','one missing upload blocks the entire count');
select extensions.is((select count(*)::integer from public.cash_counts where location_id='cc280000-0000-4000-8000-000000000001'),0,'failed submit does not create partial count');
select extensions.is((select count(*)::integer from public.cash_count_bank_evidence where session_id=(select session_id from cc4) and count_id is not null),0,'failed submit does not partially attach evidence');
update public.cash_count_bank_evidence set drive_uploaded_at=now() where id='cc280000-0000-4000-8000-000000000014';
update public.cash_count_bank_evidence set slot_id=(select slot_id from public.cash_count_bank_evidence where id='cc280000-0000-4000-8000-000000000013'),image_sha256=repeat('b',64)
 where id='cc280000-0000-4000-8000-000000000014';
select extensions.throws_like($$select public.submit_cash_count_v3((select session_id from cc4),(select counts from cc4counts),array['cc280000-0000-4000-8000-000000000013','cc280000-0000-4000-8000-000000000014']::uuid[])$$,'%หนึ่งช่องใช้ได้หนึ่งรูป%','old and retaken images from the same slot cannot both be counted');
update public.cash_count_bank_evidence set slot_id=gen_random_uuid(),image_sha256=repeat('a',64) where id='cc280000-0000-4000-8000-000000000014';
create temp table cc4result as select public.submit_cash_count_v3((select session_id from cc4),(select counts from cc4counts),array['cc280000-0000-4000-8000-000000000014','cc280000-0000-4000-8000-000000000012','cc280000-0000-4000-8000-000000000013','cc280000-0000-4000-8000-000000000011']::uuid[]) result;
select extensions.is((select (result->>'accountBalance')::numeric from cc4result),1002.50::numeric,'sum four bank balances precisely');
select extensions.is((select (result->>'countedTotal')::numeric from cc4result),2002.50::numeric,'cash plus all accounts');
select extensions.is((select jsonb_array_length(result->'bankAccounts') from cc4result),4,'receipt includes four accounts');
select extensions.is((select result#>>'{bankAccounts,0,id}' from cc4result),'cc280000-0000-4000-8000-000000000014','receipt order follows selected account order');
select extensions.is((select public.submit_cash_count_v3((select session_id from cc4),(select counts from cc4counts),array[]::uuid[])->>'id'),(select result->>'id' from cc4result),'response retry returns the existing count');
select extensions.is((select count(*)::integer from public.cash_count_bank_evidence where session_id=(select session_id from cc4) and count_id is not null),4,'exactly four attached evidence rows');
select extensions.is((select account_position from public.cash_count_bank_evidence where id='cc280000-0000-4000-8000-000000000015'),null::integer,'unselected image is not attached');
select * from extensions.finish();
rollback;
