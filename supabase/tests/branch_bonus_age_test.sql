begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code) values('d0020000-0000-4000-8000-000000000001','Age bonus','AGE');
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values('d0010000-0000-4000-8000-000000000001','0899030401','Age manager','admin',true,true);
insert into public.user_locations(user_id,location_id,is_primary)
values('d0010000-0000-4000-8000-000000000001','d0020000-0000-4000-8000-000000000001',true);
insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,status,
original_weight_total,paid_total,rubber_value_total,average_price,current_weight,weight_loss_percent,
work_rate,other_operating_cost,work_total,expense_destination,created_by_user_id,created_by_name,created_by_phone,
verified_by_user_id,verified_by_name,verified_at,age_cutoff_at,average_age_hours,oldest_age_hours,estimated_age_item_count,
created_at,sold_out_at,sold_out_by_user_id,sold_out_by_name)
select ('d0030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'REX-AGE-'||n,'2020-01-12',n,
'd0020000-0000-4000-8000-000000000001','verified',weight,1000,1000,10,weight*.9,10,
0,0,0,'branch','d0010000-0000-4000-8000-000000000001','Age manager','0899030401',
'd0010000-0000-4000-8000-000000000001','Age manager','2020-01-14Z','2020-01-14Z',hours,hours,estimated,
'2020-01-12Z','2020-01-14Z','d0010000-0000-4000-8000-000000000001','Age manager'
from (values (1,10000,48,0),(2,30000,144,1),(3,100,144,0),(4,100,0,0),
(5,100,143.99,0),(6,100,126,0),(7,100,125.99,0),(8,100,114,0),(9,100,114.01,0),
(10,100,96,0),(11,100,96.01,0),(12,100,144.01,0),(13,100,126.01,0),(14,100,113.99,0),(15,100,95.99,0)) t(n,weight,hours,estimated);
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
select extensions.is(pg_temp.age_preview(array[1,2])->>'formulaVersion','branch-bonus-v3','test database runs the real age formula');
select extensions.is((pg_temp.age_preview(array[1,2])->>'ageActual')::numeric,5::numeric,'original-weight average: 10t/2d + 30t/6d = 5d');
select extensions.is((pg_temp.age_preview(array[1,2])->>'ageEstimatedExportCount')::integer,1,'estimated REX are included and disclosed');
select extensions.is((pg_temp.age_preview(array[1,2])->'exports'->1->>'averageAgeHours')::numeric,144::numeric,'snapshot preserves official hours per REX');
select extensions.is((pg_temp.age_preview(array[3])->'metrics'->0->>'relative')::numeric,20::numeric,'older than target is better');
select extensions.is((pg_temp.age_preview(array[3])->>'adjustment')::numeric,20::numeric,'exact +20% improvement gets +20 tier');
select extensions.is((pg_temp.age_preview(array[3],20)->>'adjustment')::numeric,4::numeric,'age tier is weighted separately');
select extensions.is((pg_temp.age_preview(array[3],20)->'metrics'->1->>'weightedAdjustment')::numeric,4::numeric,'server discloses weighted contribution');
select extensions.is((pg_temp.age_preview(array[4])->>'ageActual')::numeric,0::numeric,'zero hours is present data');
select extensions.is((pg_temp.age_preview(array[4])->>'adjustment')::numeric,-20::numeric,'zero actual age is scored, not missing');
select extensions.ok((pg_temp.age_preview(array[4])->>'canConfirm')::boolean,'zero actual does not block a positive target');
select extensions.is((pg_temp.age_preview(array[5])->>'adjustment')::numeric,10::numeric,'143.99 hours stays below 20 percent despite display 6.00');
select extensions.is((private.branch_bonus_calculate('d0020000-0000-4000-8000-000000000001',pg_temp.age_input(array[1,2]),'2020-01-15Z')->>'ageActual')::numeric,
(private.branch_bonus_calculate('d0020000-0000-4000-8000-000000000001',pg_temp.age_input(array[1,2]),'2030-01-15Z')->>'ageActual')::numeric,'opening later never increases official age');
select extensions.ok(not (pg_temp.age_preview(array[3],100,'0')->>'canConfirm')::boolean,'enabled age requires positive target');
select extensions.ok((pg_temp.age_preview(array[3],0,'"unfinished"')->>'canConfirm')::boolean,'disabled age never parses or divides its target');
select extensions.throws_like($$update public.rubber_exports set average_age_hours=145 where export_no='REX-AGE-3'$$,'%แก้ไขไม่ได้%','official verified snapshot remains immutable');
select extensions.is((pg_temp.age_preview(array[6])->>'adjustment')::numeric,10::numeric,'age boundary REX 6');
select extensions.is((pg_temp.age_preview(array[7])->>'adjustment')::numeric,0::numeric,'age boundary REX 7');
select extensions.is((pg_temp.age_preview(array[8])->>'adjustment')::numeric,-10::numeric,'age boundary REX 8');
select extensions.is((pg_temp.age_preview(array[9])->>'adjustment')::numeric,0::numeric,'age boundary REX 9');
select extensions.is((pg_temp.age_preview(array[10])->>'adjustment')::numeric,-20::numeric,'age boundary REX 10');
select extensions.is((pg_temp.age_preview(array[11])->>'adjustment')::numeric,-10::numeric,'age boundary REX 11');
select extensions.is((pg_temp.age_preview(array[12])->>'adjustment')::numeric,20::numeric,'age boundary REX 12');
select extensions.is((pg_temp.age_preview(array[13])->>'adjustment')::numeric,10::numeric,'age boundary REX 13');
select extensions.is((pg_temp.age_preview(array[14])->>'adjustment')::numeric,-10::numeric,'age boundary REX 14');
select extensions.is((pg_temp.age_preview(array[15])->>'adjustment')::numeric,-20::numeric,'age boundary REX 15');
-- Deliberately corrupt a synthetic row only inside this rolled-back test transaction.
-- The production constraint and trigger remain unchanged after rollback.
set constraints all immediate;
alter table public.rubber_exports drop constraint rubber_exports_age_snapshot_check;
insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,
 to_jsonb(e)||jsonb_build_object('id','d0030000-0000-4000-8000-000000000016','export_no','REX-AGE-MISSING','sequence_no',16,'average_age_hours',null))).*
from public.rubber_exports e where export_no='REX-AGE-3';
select extensions.ok(pg_temp.age_preview(array[3,16])->'ageActual'='null'::jsonb,'partial age data is unavailable, never a subset average');
select extensions.ok(not (pg_temp.age_preview(array[3,16])->>'canConfirm')::boolean,'missing age blocks an enabled metric');
select extensions.ok((pg_temp.age_preview(array[3,16],0)->>'canConfirm')::boolean,'missing age allows a disabled metric');
create temporary table age_review as select public.review_branch_bonus('d0020000-0000-4000-8000-000000000001') r;
select extensions.is((select (r->>'blockedCount')::integer from age_review),0,'missing age does not trap the user before settings');
create temporary table age_parts as select jsonb_agg(jsonb_build_object('key',p->>'key','input',jsonb_set(pg_temp.age_input(array[3]),'{exportIds}',p->'exportIds'))) parts from age_review,jsonb_array_elements(r->'periods') p;
select extensions.ok(not (public.preview_branch_bonus_batch('d0020000-0000-4000-8000-000000000001',(select r->>'fingerprint' from age_review),(select parts from age_parts))->'periods'->0->'preview'->>'canConfirm')::boolean,'batch preview applies conditional missing-data block');
update age_parts set parts=jsonb_set(jsonb_set(parts,'{0,input,metrics,age,weight}','0'),'{0,input,metrics,loss,weight}','100');
select extensions.ok((public.preview_branch_bonus_batch('d0020000-0000-4000-8000-000000000001',(select r->>'fingerprint' from age_review),(select parts from age_parts))->'periods'->0->'preview'->>'canConfirm')::boolean,'batch age=0 can proceed with complete mandatory inventory');
select extensions.throws_like($$select public.preview_branch_bonus_batch('d0020000-0000-4000-8000-000000000001',(select r->>'fingerprint' from age_review),jsonb_set((select parts from age_parts),'{0,input,metrics,age,weight}','0.5'))$$,'%BONUS_INVALID%','direct RPC rejects fractional age weight');
update age_parts set parts=(select jsonb_agg(p||jsonb_build_object('expected',public.preview_branch_bonus_batch('d0020000-0000-4000-8000-000000000001',(select r->>'fingerprint' from age_review),parts)->'periods'->0->'preview'->>'sourceFingerprint')) from jsonb_array_elements(parts) p);
create temporary table age_result as select public.confirm_branch_bonus_batch('d0020000-0000-4000-8000-000000000001','d0090000-0000-4000-8000-000000000001',(select r->>'fingerprint' from age_review),(select parts from age_parts)) result;
select extensions.is((select result->'results'->0->>'formulaVersion' from age_result),'branch-bonus-v3','confirmed snapshot retains formula version');
select extensions.is(public.confirm_branch_bonus_batch('d0020000-0000-4000-8000-000000000001','d0090000-0000-4000-8000-000000000001',(select r->>'fingerprint' from age_review),(select parts from age_parts)),(select result from age_result),'new identical request replays exact saved result');
select extensions.is((select count(*) from private.branch_bonus_batches where location_id='d0020000-0000-4000-8000-000000000001'),1::bigint,'replay creates no duplicate batch');
select * from extensions.finish();
rollback;
