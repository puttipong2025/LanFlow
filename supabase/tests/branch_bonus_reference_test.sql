begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code) values('d0020000-0000-4000-8000-000000000001','Age bonus','AGE');
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values('d0010000-0000-4000-8000-000000000001','0899030401','Age manager','admin',true,true);
insert into public.user_locations(user_id,location_id,is_primary)
values('d0010000-0000-4000-8000-000000000001','d0020000-0000-4000-8000-000000000001',true);
insert into public.locations(id,name,code) values('d0020000-0000-4000-8000-000000000002','Reference B','REFB'),('d0020000-0000-4000-8000-000000000003','Pending C','REFC');
insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,status,
original_weight_total,paid_total,rubber_value_total,average_price,current_weight,weight_loss_percent,
work_rate,other_operating_cost,work_total,expense_destination,created_by_user_id,created_by_name,created_by_phone,
verified_by_user_id,verified_by_name,verified_at,age_cutoff_at,average_age_hours,oldest_age_hours,estimated_age_item_count,
created_at,sold_out_at,sold_out_by_user_id,sold_out_by_name)
select ('d0030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'REX-AGE-'||n,'2001-01-12',n,
case when n=1 then 'd0020000-0000-4000-8000-000000000001' else 'd0020000-0000-4000-8000-000000000002' end::uuid,'verified',weight,1000,1000,10,case when n=1 then weight*.9 else weight*.98 end,case when n=1 then 10 else 2 end,
0,0,0,'branch','d0010000-0000-4000-8000-000000000001','Age manager','0899030401',
'd0010000-0000-4000-8000-000000000001','Age manager','2001-01-14Z','2001-01-14Z',hours,hours,estimated,
'2001-01-12Z','2001-01-14Z','d0010000-0000-4000-8000-000000000001','Age manager'
from (values (1,10000,48,0),(2,30000,144,1)) t(n,weight,hours,estimated);
select set_config('request.jwt.claim.sub','d0010000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"d0010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create function pg_temp.age_input(p_ids integer[],p_weight numeric default 100,p_target jsonb default '5') returns jsonb language sql as $$
select jsonb_build_object('exportIds',(select jsonb_agg('d0030000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from unnest(p_ids) n),
'excludedKeys','[]'::jsonb,'excludedGroups','[]'::jsonb,'rate',.02,'metrics',jsonb_build_object(
'burden',jsonb_build_object('weight',0),'loss',jsonb_build_object('weight',100-p_weight,'target',10),
'counts',jsonb_build_object('weight',0),'age',jsonb_build_object('weight',p_weight,'target',p_target)));
$$;
create function pg_temp.age_preview(p_ids integer[],p_weight numeric default 100,p_target jsonb default '5') returns jsonb language sql as $$
select public.preview_branch_bonus('d0020000-0000-4000-8000-000000000001',pg_temp.age_input(p_ids,p_weight,p_target));
$$;

create temporary table ref_review as select public.review_branch_bonus('d0020000-0000-4000-8000-000000000001') r;
create temporary table ref_parts as select jsonb_agg(jsonb_build_object('key',v->>'key','input',jsonb_set(pg_temp.age_input(array[1],50),'{metrics,loss,weight}'::text[],'50'))) parts
from ref_review,jsonb_array_elements(r->'periods') v;
create function pg_temp.ref_preview(excluded jsonb default '[]') returns jsonb language sql as $$
select public.preview_branch_bonus_batch('d0020000-0000-4000-8000-000000000001',r->>'fingerprint',jsonb_build_object('periods',parts,'excludedLocationIds',excluded))->'periods'->0->'preview' from ref_review,ref_parts;
$$;
select extensions.is((pg_temp.ref_preview()->'reference'->>'ageTarget')::numeric,5::numeric,'reference age weights all branches by original weight');
select extensions.is((pg_temp.ref_preview()->'reference'->>'lossTarget')::numeric,4::numeric,'reference loss uses sum of lost/original weight');
select extensions.is((pg_temp.ref_preview()->>'weight')::numeric,10000::numeric,'other branches never enter the bonus base');
select extensions.is((pg_temp.ref_preview()->>'ageActual')::numeric,2::numeric,'actual age remains branch-local');
select extensions.is((pg_temp.ref_preview('["d0020000-0000-4000-8000-000000000002"]')->'reference'->>'ageTarget')::numeric,2::numeric,'excluding branch changes target, not actual');
select extensions.is(pg_temp.ref_preview()->>'pageFingerprint',pg_temp.ref_preview('["d0020000-0000-4000-8000-000000000002"]')->>'pageFingerprint','reference selection does not invalidate financial pages');
select extensions.isnt(pg_temp.ref_preview()->>'sourceFingerprint',pg_temp.ref_preview('["d0020000-0000-4000-8000-000000000002"]')->>'sourceFingerprint','confirmation fingerprint includes reference selection');
select extensions.is(public.get_branch_bonus_source_page('d0020000-0000-4000-8000-000000000001',pg_temp.age_input(array[1],50),'expenses',0)->>'pageFingerprint',pg_temp.ref_preview()->>'pageFingerprint','live source paging agrees with reference preview without reference scope');
select extensions.throws_ok($$select pg_temp.ref_preview('["d0020000-0000-4000-8000-000000000001"]')$$,'P0001','BONUS_INVALID: สาขาอ้างอิงซ้ำ ไม่พบสาขา หรือละเว้นสาขาตนเอง','cannot exclude own branch');
select extensions.throws_ok($$select pg_temp.ref_preview('["d0020000-0000-4000-8000-000000000099"]')$$,'P0001','BONUS_INVALID: สาขาอ้างอิงซ้ำ ไม่พบสาขา หรือละเว้นสาขาตนเอง','unknown branches rejected in direct RPC');
insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,original_weight_total,paid_total,rubber_value_total,average_price,
work_rate,other_operating_cost,work_total,expense_destination,created_by_user_id,created_by_name,created_by_phone,created_at)
values('d0030000-0000-4000-8000-000000000003','REX-REFERENCE-PENDING','2001-01-12',3,'d0020000-0000-4000-8000-000000000002',100,1000,1000,10,0,0,0,null,
'd0010000-0000-4000-8000-000000000001','Age manager','0899030401','2001-01-12Z');
select extensions.is((pg_temp.ref_preview()->'reference'->>'ageTarget')::numeric,2::numeric,'a draft excludes the whole other branch even when it has ready REX');
select extensions.ok((select (v->>'hasPending')::boolean and not (v->>'included')::boolean from jsonb_array_elements(pg_temp.ref_preview()->'reference'->'branches') v where v->>'id'='d0020000-0000-4000-8000-000000000002'),'disabled branch stays visible with boolean pending reason');
select extensions.ok(not (select v ? 'pendingCount' from jsonb_array_elements(pg_temp.ref_preview()->'reference'->'branches') v limit 1),'no pending count is returned');

select extensions.ok((select (v->>'hasPending')::boolean and not (v->>'included')::boolean from jsonb_array_elements(private.branch_bonus_reference('d0020000-0000-4000-8000-000000000001','[{"key":"0","periodStart":"2001-01-10","periodEnd":"2001-01-10"},{"key":"1","periodStart":"2001-01-12","periodEnd":"2001-01-12"}]','{}')->'branches') v where v->>'id'='d0020000-0000-4000-8000-000000000002'),'pending in any actual period disables branch for the shared scope');
select extensions.ok((select not (v->>'hasPending')::boolean and (v->>'included')::boolean from jsonb_array_elements(private.branch_bonus_reference('d0020000-0000-4000-8000-000000000001','[{"key":"0","periodStart":"2001-01-10","periodEnd":"2001-01-10"},{"key":"1","periodStart":"2001-01-24","periodEnd":"2001-01-24"}]','{}')->'branches') v where v->>'id'='d0020000-0000-4000-8000-000000000002'),'pending in the gap between periods does not disable branch');
update public.rubber_exports set status='deleted',previous_status='draft',deleted_at=clock_timestamp(),deleted_by_user_id='d0010000-0000-4000-8000-000000000001',deleted_by_name='Age manager' where id='d0030000-0000-4000-8000-000000000003';
select extensions.is((pg_temp.ref_preview()->'reference'->>'ageTarget')::numeric,5::numeric,'deleted draft does not disable branch');

delete from public.rubber_exports where id='d0030000-0000-4000-8000-000000000003';
select extensions.is((pg_temp.ref_preview()->'reference'->>'ageTarget')::numeric,5::numeric,'branch becomes eligible after pending row is removed');
create temporary table ref_before as select pg_temp.ref_preview()->>'sourceFingerprint' fp;
select public.set_rubber_export_sold_out('d0030000-0000-4000-8000-000000000002',false);
select public.adjust_rubber_export_weight('d0030000-0000-4000-8000-000000000002',28800,29400);
select public.set_rubber_export_sold_out('d0030000-0000-4000-8000-000000000002',true);
select extensions.isnt(pg_temp.ref_preview()->>'sourceFingerprint',(select fp from ref_before),'changed weight in another branch invalidates confirmation');
select extensions.is((pg_temp.ref_preview()->'reference'->>'lossTarget')::numeric,5.5::numeric,'latest external weight enters target');

select public.set_rubber_export_sold_out('d0030000-0000-4000-8000-000000000002',false);
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,sync_status,location_id,bill_no,bill_date,
customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,source_rubber_export_id,source_export_no,
received_at,received_age_hours,received_age_is_estimated,created_by_user_id,created_by_name,created_by_phone,created_at)
values('d0040000-0000-4000-8000-000000000001','REF-SELF','REF-SELF','REF-SELF','synced','d0020000-0000-4000-8000-000000000002','REF-SELF','2001-01-12',
'Synthetic self receipt','ยางก้อนถ้วย',28800,1000,10,1000,0,'d0030000-0000-4000-8000-000000000002','REX-AGE-2',
'2001-01-14Z',0,false,'d0010000-0000-4000-8000-000000000001','Age manager','0899030401','2001-01-12Z');
select extensions.is((pg_temp.ref_preview()->'reference'->>'ageTarget')::numeric,2::numeric,'same-branch return is excluded from the reference cohort');
delete from public.rubber_bills where id='d0040000-0000-4000-8000-000000000001';
select public.set_rubber_export_sold_out('d0030000-0000-4000-8000-000000000002',true);

create temporary table confirm_payload as select jsonb_build_object('excludedLocationIds','[]'::jsonb,'periods',jsonb_agg(v||jsonb_build_object('expected',pg_temp.ref_preview()->>'sourceFingerprint'))) payload
from ref_parts,jsonb_array_elements(parts) v;
create temporary table confirmed as select public.confirm_branch_bonus_batch('d0020000-0000-4000-8000-000000000001','d0090000-0000-4000-8000-000000000001',(select r->>'fingerprint' from ref_review),(select payload from confirm_payload)) result;
select extensions.is((select result->'results'->0->>'formulaVersion' from confirmed),'branch-bonus-v4','new snapshot records automatic-target version');
select extensions.is((select (result->'results'->0->'reference'->>'lossTarget')::numeric from confirmed),5.5::numeric,'saved target is frozen');
select extensions.is(public.confirm_branch_bonus_batch('d0020000-0000-4000-8000-000000000001','d0090000-0000-4000-8000-000000000001',(select r->>'fingerprint' from ref_review),(select payload from confirm_payload)),(select result from confirmed),'exact envelope request replays saved result');
select extensions.ok(not has_function_privilege('authenticated','private.branch_bonus_reference(uuid,jsonb,uuid[])','EXECUTE'),'reference helper remains private');

select extensions.is((private.branch_bonus_reference('d0020000-0000-4000-8000-000000000001',(select r->'periods' from ref_review),'{}')->'periods'->0->>'count')::integer,2,'already-used REX remain reference evidence');
select public.delete_branch_bonus('d0020000-0000-4000-8000-000000000001',(select (result->'results'->0->>'id')::uuid from confirmed));
create temporary table ref_templates as select to_jsonb(e) data from public.rubber_exports e where id in ('d0030000-0000-4000-8000-000000000001','d0030000-0000-4000-8000-000000000002');
delete from public.rubber_exports where id in ('d0030000-0000-4000-8000-000000000001','d0030000-0000-4000-8000-000000000002');
insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,data||jsonb_build_object('average_age_hours',0,'oldest_age_hours',0))).* from ref_templates;
update ref_review set r=public.review_branch_bonus('d0020000-0000-4000-8000-000000000001');
select extensions.is((pg_temp.ref_preview()->'reference'->>'ageTarget')::numeric,0::numeric,'complete zero-age reference is zero, not missing');
select extensions.ok(not (pg_temp.ref_preview()->>'canConfirm')::boolean,'zero target blocks only enabled age');
select extensions.ok((pg_temp.ref_preview()->'issues') @> '["เป้าอายุเฉลี่ยเป็น 0 วัน กรุณาปรับสัดส่วนอายุยางเป็น 0%"]'::jsonb,'zero target has an actionable reason');
update ref_parts set parts=jsonb_set(jsonb_set(parts,'{0,input,metrics,age,weight}','0'),'{0,input,metrics,loss,weight}','100');
select extensions.ok((pg_temp.ref_preview()->>'canConfirm')::boolean,'disabled age skips zero target');
update ref_parts set parts=jsonb_set(jsonb_set(parts,'{0,input,metrics,age,weight}','50'),'{0,input,metrics,loss,weight}','50');
set constraints all immediate;
alter table public.rubber_exports drop constraint rubber_exports_age_snapshot_check;
delete from public.rubber_exports where id='d0030000-0000-4000-8000-000000000002';
insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,data||jsonb_build_object('average_age_hours',null))).* from ref_templates where data->>'id'='d0030000-0000-4000-8000-000000000002';
select extensions.ok(pg_temp.ref_preview()->'reference'->'ageTarget'='null'::jsonb,'missing reference age never averages a subset');
select extensions.ok(not (pg_temp.ref_preview()->>'canConfirm')::boolean,'missing external age blocks enabled age');
update ref_parts set parts=jsonb_set(jsonb_set(parts,'{0,input,metrics,age,weight}','0'),'{0,input,metrics,loss,weight}','100');
select extensions.ok((pg_temp.ref_preview()->>'canConfirm')::boolean,'missing reference age permits age=0');
delete from public.rubber_exports where id in ('d0030000-0000-4000-8000-000000000001','d0030000-0000-4000-8000-000000000002');
insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,data||jsonb_build_object('average_age_hours',case when data->>'id'='d0030000-0000-4000-8000-000000000001' then 144 else 112.01 end,'oldest_age_hours',144))).* from ref_templates;
update ref_review set r=public.review_branch_bonus('d0020000-0000-4000-8000-000000000001');
update ref_parts set parts=jsonb_set(jsonb_set(parts,'{0,input,metrics,age,weight}','50'),'{0,input,metrics,loss,weight}','50');
select extensions.is((pg_temp.ref_preview()->'reference'->>'ageTarget')::numeric,5.0003125::numeric,'automatic target retains precision beyond two decimal places');
select extensions.is((select (v->>'adjustment')::numeric from jsonb_array_elements(pg_temp.ref_preview()->'metrics') v where v->>'key'='age'),10::numeric,'raw target prevents rounding into the +20% tier');

select * from extensions.finish();
rollback;
