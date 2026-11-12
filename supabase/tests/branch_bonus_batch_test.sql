begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code) values('c0020000-0000-4000-8000-000000000001','Batch bonus','BBT');
insert into public.locations(id,name,code) values('c0020000-0000-4000-8000-000000000002','Batch destination','BBD');
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
 values('c0010000-0000-4000-8000-000000000001','0899030201','Batch manager','admin',true,true);
insert into public.user_locations(user_id,location_id,is_primary) values('c0010000-0000-4000-8000-000000000001','c0020000-0000-4000-8000-000000000001',true);
insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,status,
 original_weight_total,paid_total,rubber_value_total,average_price,current_weight,weight_loss_percent,
 work_rate,other_operating_cost,work_total,expense_destination,created_by_user_id,created_by_name,created_by_phone,
 verified_by_user_id,verified_by_name,verified_at,age_cutoff_at,average_age_hours,oldest_age_hours,estimated_age_item_count,
 created_at,sold_out_at,sold_out_by_user_id,sold_out_by_name)
select ('c0030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'REX-BATCH-'||n,'2020-01-12',n,
 'c0020000-0000-4000-8000-000000000001','verified',case when n=2 then 100000 else 100 end,1000,1000,10,
 case when n=2 then 99999 when n=5 then 100 else 90 end,case when n in(2,5) then 0 else 10 end,
 case when n=4 then .1 else 0 end,0,case when n=4 then 10 else 0 end,'branch','c0010000-0000-4000-8000-000000000001','Batch manager','0899030201',
 'c0010000-0000-4000-8000-000000000001','Batch manager','2020-01-12Z','2020-01-12Z',0,0,0,
 case n when 1 then '2020-01-11T17:30Z' when 2 then '2020-01-25Z' when 3 then '2020-01-16Z' when 4 then '2020-01-30Z' else '2020-01-26Z' end::timestamptz,
 case when n in(2,5) then null else '2020-01-12Z'::timestamptz end,
 case when n in(2,5) then null else 'c0010000-0000-4000-8000-000000000001'::uuid end,
 case when n in(2,5) then null else 'Batch manager' end from generate_series(1,5) n;
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,sync_status,location_id,bill_no,bill_date,
 customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,source_rubber_export_id,source_export_no,
 received_at,received_age_hours,received_age_is_estimated,created_by_user_id,created_by_name,created_by_phone,created_at)
values('c0040000-0000-4000-8000-000000000001','BATCH-SELF','BATCH-SELF','BATCH-SELF','synced',
 'c0020000-0000-4000-8000-000000000001','BATCH-SELF','2020-01-30','Self receipt','ยางก้อนถ้วย',90,1000,10,1000,0,
 'c0030000-0000-4000-8000-000000000004','REX-BATCH-4','2020-01-30Z',0,false,
 'c0010000-0000-4000-8000-000000000001','Batch manager','0899030201','2020-01-30Z');
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,sync_status,location_id,bill_no,bill_date,
 customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,source_rubber_export_id,source_export_no,
 received_at,received_age_hours,received_age_is_estimated,created_by_user_id,created_by_name,created_by_phone,created_at)
values('c0040000-0000-4000-8000-000000000002','BATCH-CROSS','BATCH-CROSS','BATCH-CROSS','synced',
 'c0020000-0000-4000-8000-000000000002','BATCH-CROSS','2020-01-25','Cross receipt','ยางก้อนถ้วย',99999,1000,10,1000,0,
 'c0030000-0000-4000-8000-000000000002','REX-BATCH-2','2020-01-25Z',0,false,
 'c0010000-0000-4000-8000-000000000001','Batch manager','0899030201','2020-01-25Z');
create temporary table batch_input as select jsonb_build_object('exportIds','[]'::jsonb,'excludedKeys','[]'::jsonb,'excludedGroups','[]'::jsonb,'rate',.02,
 'metrics','{"burden":{"weight":0,"target":null},"loss":{"weight":100,"target":10},"counts":{"weight":0,"target":null},"age":{"weight":0,"target":null}}'::jsonb) input;
-- Simulate an already committed old result, before the new inventory policy.
insert into public.branch_bonuses(id,location_id,period_start,period_end,input,request_fingerprint,snapshot,created_by_user_id,created_by_name)
select 'c0070000-0000-4000-8000-000000000001','c0020000-0000-4000-8000-000000000001','2020-01-14','2020-01-20',input,repeat('a',32),
 jsonb_build_object('allSources','[]'::jsonb,'observedChanges','[]'::jsonb,'exports','[]'::jsonb,'metrics','[]'::jsonb,
 'periodStart','2020-01-14','periodEnd','2020-01-20','finalAmount',10), 'c0010000-0000-4000-8000-000000000001','Batch manager' from batch_input;
insert into public.income_expense(id,client_temp_id,local_bill_no,server_bill_no,sync_status,record_status,location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,created_at)
values('c0050000-0000-4000-8000-000000000001','BATCH-LATE','BATCH-LATE','BATCH-LATE','synced','active','c0020000-0000-4000-8000-000000000001','expense','1','2020-01-16','Late old expense',300,'ค่าใช้จ่าย','c0010000-0000-4000-8000-000000000001','Batch manager','0899030201','2020-01-16Z');
select set_config('request.jwt.claim.sub','c0010000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"c0010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
create temporary table batch_review as select public.review_branch_bonus('c0020000-0000-4000-8000-000000000001') review;
select extensions.is((select (review->>'requiredCount')::integer from batch_review),3,'includes active REX in mandatory inventory');
select extensions.is((select (review->>'blockedCount')::integer from batch_review),1,'one row with two failed conditions counts once');
select extensions.is((select jsonb_array_length(v->'issues') from batch_review,jsonb_array_elements(review->'rows') v where v->>'exportNo'='REX-BATCH-5'),2,'all failed reasons are returned');
select extensions.is((select count(*) from batch_review,jsonb_array_elements(review->'rows') v where v->>'kind'='self'),1::bigint,'same-branch receipt is excluded');
select extensions.is((select count(*) from batch_review,jsonb_array_elements(review->'rows') v where v->>'kind'='leftover'),1::bigint,'unlinked REX inside old period is separated');
select extensions.is((select jsonb_array_length(review->'periods') from batch_review),2,'automatically splits before and after old period');
select extensions.is((select (review->'periods'->0->>'periodDays')::integer from batch_review),1,'Thai start date is inclusive');
select extensions.is((select review->'periods'->1->>'periodEnd' from batch_review),'2020-01-26','self-return does not extend period');
select extensions.is((select jsonb_array_length(v->'issues') from batch_review,jsonb_array_elements(review->'rows') v where v->>'exportNo'='REX-BATCH-2'),0,'tiny positive loss passes before rounding');
select extensions.is((select v->>'kind' from batch_review,jsonb_array_elements(review->'rows') v where v->>'exportNo'='REX-BATCH-2'),'required','cross-branch receipt remains mandatory');
select extensions.throws_like($$select public.confirm_branch_bonus('c0020000-0000-4000-8000-000000000001','c0090000-0000-4000-8000-000000000001',(select input from batch_input),repeat('a',32))$$,'%BONUS_SOURCE_CHANGED%','old direct RPC cannot create a partial result');
select public.adjust_rubber_export_weight('c0030000-0000-4000-8000-000000000005',90,100);
select public.set_rubber_export_sold_out('c0030000-0000-4000-8000-000000000005',true);
update batch_review set review=public.review_branch_bonus('c0020000-0000-4000-8000-000000000001');
create temporary table batch_parts as select jsonb_agg(jsonb_build_object('key',p->>'key','input',jsonb_set(i.input,'{exportIds}',p->'exportIds')) order by p->>'key') parts from batch_review,batch_input i,jsonb_array_elements(review->'periods') p;
select extensions.throws_like($$select public.preview_branch_bonus_batch('c0020000-0000-4000-8000-000000000001',repeat('f',32),(select parts from batch_parts))$$,'%BONUS_SOURCE_CHANGED%','inventory changes require re-review');
select extensions.throws_like($$select public.preview_branch_bonus_batch('c0020000-0000-4000-8000-000000000001',(select review->>'fingerprint' from batch_review),jsonb_set((select parts from batch_parts),'{0,input,metrics,loss,weight}','99.5'))$$,'%BONUS_INVALID%','fractional weights rejected by direct RPC');
select extensions.throws_like($$select public.preview_branch_bonus_batch('c0020000-0000-4000-8000-000000000001',(select review->>'fingerprint' from batch_review),jsonb_set((select parts from batch_parts),'{1,input,exportIds}','[]'))$$,'%BONUS_SOURCE_CHANGED%','cannot omit mandatory REX');
create temporary table batch_preview as select public.preview_branch_bonus_batch('c0020000-0000-4000-8000-000000000001',(select review->>'fingerprint' from batch_review),(select parts from batch_parts)) preview;
select extensions.is((select jsonb_array_length(preview->'periods') from batch_preview),2,'previews both periods with global old differences');
select extensions.is((select (p->'preview'->>'expenseTotal')::numeric from batch_preview,jsonb_array_elements(preview->'periods') p where p->>'key'='0'),10::numeric,'self-return work cost remains an actual period expense');
update batch_parts set parts=(select jsonb_agg(p||jsonb_build_object('expected',(select q->'preview'->>'sourceFingerprint' from batch_preview,jsonb_array_elements(preview->'periods') q where q->>'key'=p->>'key')) order by p->>'key') from jsonb_array_elements(parts) p);
create function pg_temp.fail_second_bonus() returns trigger language plpgsql as $$begin if new.period_start='2020-01-25' then raise exception 'TEST_SECOND_FAILED'; end if;return new;end$$;
create trigger test_second_bonus before insert on public.branch_bonuses for each row execute function pg_temp.fail_second_bonus();
select extensions.throws_like($$select public.confirm_branch_bonus_batch('c0020000-0000-4000-8000-000000000001','c0090000-0000-4000-8000-000000000001',(select review->>'fingerprint' from batch_review),(select parts from batch_parts))$$,'%TEST_SECOND_FAILED%','failure after first write rolls back whole batch');
select extensions.is((select count(*) from public.branch_bonuses where location_id='c0020000-0000-4000-8000-000000000001'),1::bigint,'only pre-existing result remains');
select extensions.is((select count(*) from private.branch_bonus_exports where export_id::text like 'c0030000%'),0::bigint,'failed batch leaves no REX locks');
select extensions.is((select count(*) from private.branch_bonus_batches where location_id='c0020000-0000-4000-8000-000000000001'),0::bigint,'failed batch leaves no successful receipt');
drop trigger test_second_bonus on public.branch_bonuses;
create temporary table batch_result as select public.confirm_branch_bonus_batch('c0020000-0000-4000-8000-000000000001','c0090000-0000-4000-8000-000000000001',(select review->>'fingerprint' from batch_review),(select parts from batch_parts)) result;
select extensions.is((select jsonb_array_length(result->'results') from batch_result),2,'atomic confirmation succeeds despite old differences');
select extensions.is((select count(*) from private.branch_bonus_observations where origin_bonus_id='c0070000-0000-4000-8000-000000000001'),1::bigint,'shared old difference acknowledged once');
select extensions.is((public.review_branch_bonus('c0020000-0000-4000-8000-000000000001')->>'requiredCount')::integer,0,'used REX are hidden from new inventory');
select extensions.is(jsonb_array_length(public.confirm_branch_bonus_batch('c0020000-0000-4000-8000-000000000001','c0090000-0000-4000-8000-000000000001',(select review->>'fingerprint' from batch_review),(select parts from batch_parts))->'results'),2,'same request replays without recalculating changed inventory');
select public.delete_branch_bonus('c0020000-0000-4000-8000-000000000001',(select (result->'results'->0->>'id')::uuid from batch_result));
select extensions.is(jsonb_array_length(public.get_branch_bonus_batch('c0020000-0000-4000-8000-000000000001','c0090000-0000-4000-8000-000000000001')->'deletedIds'),1,'deleted child is reported without resurrection');
select extensions.ok(not has_function_privilege('anon','public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb)','EXECUTE'),'anonymous cannot confirm batch');
insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
 'id',gen_random_uuid(),'export_no','REX-GAP-'||n,'sequence_no',100+n,'location_id','c0020000-0000-4000-8000-000000000002',
 'created_at',case when n=1 then '2020-05-18T00:00Z' else '2020-10-05T00:00Z' end,
 'verified_at','2020-10-06T00:00Z','sold_out_at','2020-10-06T00:00Z','age_cutoff_at','2020-10-06T00:00Z'))).*
 from public.rubber_exports e cross join generate_series(1,2) n where e.id='c0030000-0000-4000-8000-000000000001';
select extensions.is((public.review_branch_bonus('c0020000-0000-4000-8000-000000000002')->'periods'->0->>'periodDays')::integer,141,'discontinuous REX dates include all 141 intervening days');
select * from extensions.finish();
rollback;
