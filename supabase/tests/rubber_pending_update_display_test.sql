begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);
insert into auth.users(id,aud,role) values('af000000-0000-4000-8000-000000000002','authenticated','authenticated');
insert into public.locations(id,name,code,is_active) values('af000000-0000-4000-8000-000000000001','Display regression','DSPREG',true);
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values('af000000-0000-4000-8000-000000000002','0897082815','Display operator','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary) values('af000000-0000-4000-8000-000000000002','af000000-0000-4000-8000-000000000001',true);
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,revision_no,created_by_user_id,created_by_name,created_by_phone)
values('af000000-0000-4000-8000-000000000003','display-regression','DISPLAY-L','DISPLAY-S','display-original','synced','active','af000000-0000-4000-8000-000000000001','DISPLAY-S',current_date,'Original','weighing',100,3800,38,0,3800,1,'af000000-0000-4000-8000-000000000002','Display operator','0897082815');
insert into public.rubber_bill_approval_requests(operation,bill_id,location_id,client_temp_id,idempotency_key,base_revision_no,matched_reasons,original_payload,proposed_payload,requested_by_user_id,requested_by_name,requested_by_phone)
values('update','af000000-0000-4000-8000-000000000003','af000000-0000-4000-8000-000000000001','display-regression','display-proposal',1,array['time'],'{}','{"customerName":"Proposed","billDate":"2026-10-30","billType":"weighing","netWeight":100,"averagePrice":39,"netRubberValue":3900,"deductionTotal":0,"netTotal":3900}','af000000-0000-4000-8000-000000000002','Display operator','0897082815');
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"af000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
create temp table display_result as select public.get_rubber_bill_operational_feed_v2('af000000-0000-4000-8000-000000000001','latest')->'rows'->0 as row;
select extensions.is((select row->'approval_proposed_summary'->>'customerName' from display_result),'Proposed','ordinary branch feed retains the pending update summary after local queue cleanup');
select extensions.is((select row->>'customer_name' from display_result),'Original','authoritative bill fields remain unchanged');
select extensions.is((select row->>'approval_pending' from display_result),'true','approval lock remains explicit');
select extensions.is((select row->>'revision_no' from display_result),'1','display does not invent an authoritative revision');
select extensions.is(jsonb_array_length(public.get_rubber_bill_operational_feed_v2('af000000-0000-4000-8000-000000000001','latest','any','proposed')->'rows'),1,'branch feed search finds the displayed proposed customer after reload');
select extensions.throws_ok($$select public.get_rubber_bill_operational_feed_v2('af000000-0000-4000-8000-000000000001','pending_approval')$$,'P0001',null,'summary access does not grant approval-mode access');
select * from extensions.finish();
rollback;
