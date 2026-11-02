begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations(id, name, code) values
('a1020000-0000-4000-8000-000000000001','Weight adjustment A','WAA'),
('a1020000-0000-4000-8000-000000000002','Weight adjustment B','WAB');
insert into public.profiles(id, phone, name, role, is_active, can_manage_rubber_exports) values
('a1010000-0000-4000-8000-000000000001','0891030001','Weight manager','admin',true,true),
('a1010000-0000-4000-8000-000000000002','0891030002','Ordinary admin','admin',true,false);
insert into public.user_locations(user_id, location_id, is_primary)
select id,'a1020000-0000-4000-8000-000000000001',true from public.profiles where id in
('a1010000-0000-4000-8000-000000000001','a1010000-0000-4000-8000-000000000002');
insert into public.rubber_exports (
 id,export_no,export_date,sequence_no,location_id,status,original_weight_total,paid_total,rubber_value_total,average_price,
 current_weight,weight_loss_percent,work_rate,other_operating_cost,work_total,expense_destination,
 created_by_user_id,created_by_name,created_by_phone,verified_by_user_id,verified_by_name,verified_at,
 age_cutoff_at,average_age_hours,oldest_age_hours,estimated_age_item_count,
 sold_out_at,sold_out_by_user_id,sold_out_by_name
)
select ('a1030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'REX-WEIGHT-'||n,'2026-11-02',n,
 case when n=2 then 'a1020000-0000-4000-8000-000000000002'::uuid else 'a1020000-0000-4000-8000-000000000001'::uuid end,
 case when n=7 then 'draft' else 'verified' end,100,1000,1000,10,
 case when n=7 then null else 90 end,case when n=7 then null else 10 end,case when n=7 then null else 0.3 end,0,
 case when n=7 then null else 30 end,case when n=7 then null else 'external' end,
 'a1010000-0000-4000-8000-000000000001','Weight manager','0891030001',
 case when n=7 then null else 'a1010000-0000-4000-8000-000000000001'::uuid end,
 case when n=7 then null else 'Weight manager' end,case when n=7 then null else '2026-11-02 00:00+00'::timestamptz end,
 case when n=7 then null else '2026-11-02 00:00+00'::timestamptz end,
 case when n=7 then null else 0 end,case when n=7 then null else 0 end,case when n=7 then null else 0 end,
 case when n=3 then now() else null end,case when n=3 then 'a1010000-0000-4000-8000-000000000001'::uuid else null end,
 case when n=3 then 'Weight manager' else null end
from generate_series(1,8) n;

insert into public.money_transfers(id,location_id,rubber_export_id,net_amount_to_pay,transfer_type,transfer_method,transfer_status,sync_status,record_status,created_by_user_id)
values ('a1050000-0000-4000-8000-000000000001','a1020000-0000-4000-8000-000000000001','a1030000-0000-4000-8000-000000000001',30,'rubber_export_work','bank','pending','synced','active','a1010000-0000-4000-8000-000000000001');
insert into public.money_transfer_slips(id,transfer_id,amount) values
('a1060000-0000-4000-8000-000000000001','a1050000-0000-4000-8000-000000000001',30);
insert into public.report_batches(id,report_no,report_date,sequence_no,location_id,cutoff_at,created_by_user_id,created_by_name,created_by_phone)
select ('a1040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RPT-WEIGHT-'||n,'2026-11-02',n,
'a1020000-0000-4000-8000-000000000001',now(),'a1010000-0000-4000-8000-000000000001','Weight manager','0891030001' from generate_series(1,2) n;
insert into public.report_items(report_id,location_id,entity_type,entity_id,eligibility_at) values
('a1040000-0000-4000-8000-000000000001','a1020000-0000-4000-8000-000000000001','bank_transfer_source','a1050000-0000-4000-8000-000000000001',now()),
('a1040000-0000-4000-8000-000000000002','a1020000-0000-4000-8000-000000000001','rubber_export','a1030000-0000-4000-8000-000000000005',now());
insert into public.rubber_bills(id,local_bill_no,server_bill_no,sync_status,location_id,bill_no,bill_date,customer_name,bill_type,
weight,rubber_value,average_price,deduction_total,net_total,source_rubber_export_id,source_export_no,received_at,received_age_hours,received_age_is_estimated,created_by_user_id,created_by_name,created_by_phone)
values ('a1070000-0000-4000-8000-000000000001','RB-WEIGHT','RB-WEIGHT','synced','a1020000-0000-4000-8000-000000000001','RB-WEIGHT','2026-11-02','Receipt','ยางก้อนถ้วย',90,1000,10,1000,0,
'a1030000-0000-4000-8000-000000000004','REX-WEIGHT-4',now(),0,false,'a1010000-0000-4000-8000-000000000001','Weight manager','0891030001');
insert into public.export_vehicle_weigh_bills(id,wex_no,wex_date,sequence_no,location_id,created_by_user_id,created_by_name,updated_by_user_id,updated_by_name)
values ('a1080000-0000-4000-8000-000000000001','WEX-WEIGHT','2026-11-02',1,'a1020000-0000-4000-8000-000000000001','a1010000-0000-4000-8000-000000000001','Weight manager','a1010000-0000-4000-8000-000000000001','Weight manager');
insert into public.export_vehicle_weigh_bill_reservations(wex_id,rubber_export_id,sequence_no,export_no,current_weight)
values ('a1080000-0000-4000-8000-000000000001','a1030000-0000-4000-8000-000000000006',1,'REX-WEIGHT-6',90);
set constraints all immediate;
create temporary table weight_before as select
 (select to_jsonb(e)-array['current_weight','weight_loss_percent'] from public.rubber_exports e where id='a1030000-0000-4000-8000-000000000001') rex,
 (select to_jsonb(t) from public.money_transfers t where id='a1050000-0000-4000-8000-000000000001') transfer,
 (select to_jsonb(s) from public.money_transfer_slips s where id='a1060000-0000-4000-8000-000000000001') slip,
 (select to_jsonb(r) from public.report_batches r where id='a1040000-0000-4000-8000-000000000001') report;

select extensions.ok(not has_function_privilege('anon','public.adjust_rubber_export_weight(uuid,numeric,numeric,text)','EXECUTE'),'anonymous cannot adjust weight');
select extensions.ok(not has_table_privilege('authenticated','private.rubber_export_weight_context','INSERT'),'caller cannot forge trusted context');
select set_config('request.jwt.claim.sub','a1010000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001',80,90,'ชั่งจริง')->>'currentWeight')::numeric,80::numeric,'manager adjusts weight with a report-locked work transfer');
select extensions.is((select loss_percent from public.rubber_export_weight_adjustments where export_id='a1030000-0000-4000-8000-000000000001'),20::numeric,'loss derives from unchanged original weight');
select extensions.is((select note from public.rubber_export_weight_adjustments where export_id='a1030000-0000-4000-8000-000000000001'),'ชั่งจริง','audit records the note');
select extensions.lives_ok($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001',80,90,null)$$,'retry of the same result is idempotent');
select extensions.is((select count(*)::integer from public.rubber_export_weight_adjustments where export_id='a1030000-0000-4000-8000-000000000001'),1,'retry does not duplicate audit');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001',70,90,null)$$,'%RUBBER_EXPORT_WEIGHT_CONFLICT%','stale weight cannot overwrite a newer correction');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000002',80,90,null)$$,'%ไม่มีสิทธิ์%','manager cannot adjust another branch');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000003',80,90,null)$$,'%RUBBER_EXPORT_SOLD_OUT%','sold export is locked');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000004',80,90,null)$$,'%BRANCH_RECEIPT_SOURCE_LOCKED%','received export is locked');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000005',80,90,null)$$,'%REPORT_LOCKED%','own REX report remains locked');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000006',80,90,null)$$,'%WEX_RESERVATION_LOCKED%','WEX reservation remains locked');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000007',80,90,null)$$,'%ตรวจสอบแล้ว%','draft uses its existing update route');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001',101,80,null)$$,'%น้ำหนักต้อง%','weight above original is rejected');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001',0,80,null)$$,'%น้ำหนักต้อง%','zero weight is rejected');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001','NaN',80,null)$$,'%น้ำหนักต้อง%','non-finite weight is rejected');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001',79.999,80,null)$$,'%RUBBER_EXPORT_PRECISION%','excess precision is rejected');
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001',79,80,repeat('x',301))$$,'%300%','note length is bounded');
reset role;
select extensions.is((select to_jsonb(e)-array['current_weight','weight_loss_percent'] from public.rubber_exports e where id='a1030000-0000-4000-8000-000000000001'),(select rex from weight_before),'all other REX fields are unchanged');
select extensions.is((select to_jsonb(t) from public.money_transfers t where id='a1050000-0000-4000-8000-000000000001'),(select transfer from weight_before),'entire work transfer is unchanged');
select extensions.is((select to_jsonb(s) from public.money_transfer_slips s where id='a1060000-0000-4000-8000-000000000001'),(select slip from weight_before),'entire slip is unchanged');
select extensions.is((select to_jsonb(r) from public.report_batches r where id='a1040000-0000-4000-8000-000000000001'),(select report from weight_before),'entire work transfer report is unchanged');
select extensions.is((select count(*)::integer from private.rubber_export_weight_context),0,'trusted context is closed');
select extensions.throws_like($$update public.rubber_exports set current_weight=70,weight_loss_percent=30 where id='a1030000-0000-4000-8000-000000000001'$$,'%ตรวจสอบแล้วแก้ไขไม่ได้%','direct owner update still cannot bypass the verified guard');
select set_config('request.jwt.claim.sub','a1010000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"a1010000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select extensions.throws_like($$select public.adjust_rubber_export_weight('a1030000-0000-4000-8000-000000000001',70,80,null)$$,'%ไม่มีสิทธิ์%','ordinary admin without existing manage permission cannot adjust');
select extensions.is((select count(*)::integer from public.rubber_export_weight_adjustments),0,'audit respects existing management scope');
reset role;
select * from extensions.finish();
rollback;
