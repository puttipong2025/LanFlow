begin;
-- Fixture-only pre-upgrade writer. Public confirmation now resolves old receipts only.
create or replace function pg_temp.seed_legacy_bonus(p_location uuid,p_id uuid,p_input jsonb,p_expected text,p_final_amount numeric default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare snap jsonb; receipt private.branch_bonus_request_receipts%rowtype; fingerprint text; actor_name text;
begin
  perform private.branch_bonus_require_manager(p_location);
  if p_id is null or p_expected is null or p_expected !~ '^[a-f0-9]{32}$' then raise exception 'BONUS_INVALID: ข้อมูลยืนยันไม่ครบ'; end if;
  fingerprint:=md5(jsonb_build_object('input',p_input,'expected',p_expected,'final',p_final_amount)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('branch-bonus-request:'||p_id::text,0));
  select * into receipt from private.branch_bonus_request_receipts where id=p_id;
  if found then
    if receipt.actor_id<>auth.uid() or receipt.location_id<>p_location or receipt.fingerprint<>fingerprint then
      raise exception 'BONUS_CONFLICT: คำขอเดิมมีข้อมูลต่างกัน';
    end if;
    if receipt.bonus_id is null then raise exception 'BONUS_CONFLICT: ผลโบนัสนี้ถูกลบแล้ว กรุณาเริ่มรายการใหม่'; end if;
    return public.get_branch_bonus(p_location,receipt.bonus_id);
  end if;
  perform private.lock_report_locations(array[p_location]);
  snap:=private.branch_bonus_calculate(p_location,p_input,clock_timestamp());
  if exists(select 1 from public.branch_bonuses where location_id=p_location
    and period_start<=(snap->>'periodEnd')::date and period_end>=(snap->>'periodStart')::date) then
    raise exception 'BONUS_CONFLICT: ช่วงวันที่ซ้อนกับผลโบนัสที่ยืนยันแล้ว';
  end if;
  if snap->>'sourceFingerprint'<>p_expected then
    raise exception 'BONUS_SOURCE_CHANGED: ข้อมูลเปลี่ยนแล้ว กรุณาคำนวณและตรวจยอดใหม่ก่อนยืนยัน';
  end if;
  if not (snap->>'canConfirm')::boolean then
    raise exception 'BONUS_INVALID: %', (select string_agg(value,'; ') from jsonb_array_elements_text(snap->'issues'));
  end if;
  if p_final_amount is not null and (p_final_amount::text in ('NaN','Infinity','-Infinity')
    or p_final_amount<0 or p_final_amount>9999999999.99 or p_final_amount<>round(p_final_amount,2)) then
    raise exception 'BONUS_INVALID: ยอดสุดท้ายไม่ถูกต้อง';
  end if;
  snap:=snap||jsonb_build_object('finalAmount',coalesce(p_final_amount,(snap->>'suggestedAmount')::numeric));
  select name into actor_name from public.profiles where id=auth.uid() and is_active;
  insert into public.branch_bonuses(id,location_id,period_start,period_end,input,request_fingerprint,snapshot,created_by_user_id,created_by_name)
  values(p_id,p_location,(snap->>'periodStart')::date,(snap->>'periodEnd')::date,p_input,fingerprint,snap,auth.uid(),actor_name);
  insert into private.branch_bonus_exports(bonus_id,export_id)
    select p_id,(v->>'id')::uuid from jsonb_array_elements(snap->'exports') v;
  insert into private.branch_bonus_observations(bonus_id,origin_bonus_id,source_key,observed_source)
    select p_id,(v->>'bonus_id')::uuid,v->>'source_key',nullif(v->'observed_source','null'::jsonb)
    from jsonb_array_elements(snap->'observedChanges') v where not (v->>'unknown')::boolean;
  insert into private.branch_bonus_sources(bonus_id,origin_bonus_id,location_id,source_key)
    select p_id,p_id,p_location,v->>'key' from jsonb_array_elements(snap->'allSources') v;
  -- Late arrivals considered through differences also become considered sources.
  insert into private.branch_bonus_sources(bonus_id,origin_bonus_id,location_id,source_key)
    select p_id,(v->>'bonus_id')::uuid,p_location,v->>'source_key' from jsonb_array_elements(snap->'observedChanges') v
    where not (v->>'unknown')::boolean on conflict(location_id,source_key) do nothing;
  insert into private.branch_bonus_request_receipts values(p_id,auth.uid(),p_location,fingerprint,p_id);
  return public.get_branch_bonus(p_location,p_id);
end $$;


create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
select extensions.no_plan();
insert into public.locations(id,name,code) values
 ('b0020000-0000-4000-8000-000000000001','Bonus A','BNA'),
 ('b0020000-0000-4000-8000-000000000002','Bonus B','BNB');
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
 ('b0010000-0000-4000-8000-000000000001','0899030101','Bonus manager','admin',true,true),
 ('b0010000-0000-4000-8000-000000000002','0899030102','Branch admin','admin',true,false);
insert into public.user_locations(user_id,location_id,is_primary)
select id,'b0020000-0000-4000-8000-000000000001',true from public.profiles where id::text like 'b0010000%';
insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,status,
 original_weight_total,paid_total,rubber_value_total,average_price,current_weight,weight_loss_percent,
 work_rate,other_operating_cost,work_total,expense_destination,created_by_user_id,created_by_name,created_by_phone,
 verified_by_user_id,verified_by_name,verified_at,age_cutoff_at,average_age_hours,oldest_age_hours,estimated_age_item_count,
 created_at,sold_out_at,sold_out_by_user_id,sold_out_by_name)
select ('b0030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'REX-BONUS-'||n,'2020-01-12',n,
 'b0020000-0000-4000-8000-000000000001','verified',case when n=1 then 500000 when n=100 then 100000 when n=103 then 500000000 else 100 end,
 1000,1000,10,case when n=1 then 440000 when n=7 then 90.5 when n=8 then 89.5 when n=9 then 92 when n=10 then 90.49 when n=11 then 89.51 when n=100 then 99999 when n=101 then 100 when n=103 then 450000000 else 90 end,
 case when n=1 then 12 when n=7 then 9.5 when n=8 then 10.5 when n=9 then 8 when n=10 then 9.51 when n=11 then 10.49 when n in (100,101) then 0 else 10 end,
 0,0,0,'branch','b0010000-0000-4000-8000-000000000001','Bonus manager','0899030101',
 'b0010000-0000-4000-8000-000000000001','Bonus manager','2020-01-14Z','2020-01-14Z',0,0,0,
 '2020-01-11T17:30:00Z',case when n in (3,102) then null else '2020-01-14Z'::timestamptz end,
 case when n in (3,102) then null else 'b0010000-0000-4000-8000-000000000001'::uuid end,
 case when n in (3,102) then null else 'Bonus manager' end from generate_series(1,103) n;
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,sync_status,location_id,bill_no,bill_date,
 customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,
 created_by_user_id,created_by_name,created_by_phone,created_at)
values('b0040000-0000-4000-8000-000000000001','BONUS-PURCHASE','BONUS-PURCHASE','BONUS-PURCHASE','synced',
 'b0020000-0000-4000-8000-000000000001','BONUS-PURCHASE','2020-01-12','Bonus purchase','ยางก้อนถ้วย',1000,10000,10,0,10000,
 'b0010000-0000-4000-8000-000000000001','Bonus manager','0899030101','2020-01-12Z');
insert into public.rubber_bill_items(bill_id,item_type,sequence_no,weight_in,net_weight,price,total)
values('b0040000-0000-4000-8000-000000000001','weigh',1,1000,1000,10,10000);
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,sync_status,location_id,bill_no,bill_date,
 customer_name,bill_type,weight,rubber_value,average_price,deduction_total,net_total,source_rubber_export_id,source_export_no,
 received_at,received_age_hours,received_age_is_estimated,created_by_user_id,created_by_name,created_by_phone,created_at)
values('b0040000-0000-4000-8000-000000000002','BONUS-RECEIPT','BONUS-RECEIPT','BONUS-RECEIPT','synced',
 'b0020000-0000-4000-8000-000000000002','BONUS-RECEIPT','2020-01-12','Bonus receipt','ยางก้อนถ้วย',90,1000,10,1000,0,
 'b0030000-0000-4000-8000-000000000003','REX-BONUS-3','2020-01-14Z',0,false,
 'b0010000-0000-4000-8000-000000000001','Bonus manager','0899030101','2020-01-12Z');
insert into public.income_expense(id,client_temp_id,local_bill_no,server_bill_no,sync_status,record_status,
 location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone,created_at)
select ('b0050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'BN-IE-'||n,'BN-IE-'||n,'BN-IE-'||n,
 'synced','active','b0020000-0000-4000-8000-000000000001','expense',n::text,'2020-01-12','Bonus expense '||n,
 case when n=1 then 390 else .01 end,'ค่าใช้จ่าย','b0010000-0000-4000-8000-000000000001','Bonus manager','0899030101','2020-01-12Z'
from generate_series(1,1001) n;
insert into public.cash_count_sessions(id,location_id,cutoff_at,expires_at,status,started_by_user_id,started_by_name,started_by_phone,ended_at)
select ('b0080000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b0020000-0000-4000-8000-000000000001',
 '2020-01-11T16:59Z','2020-01-11T17:29Z','submitted','b0010000-0000-4000-8000-000000000001','Bonus manager','0899030101','2020-01-11T17:01Z'
from generate_series(1,12) n;
insert into public.cash_counts(id,session_id,location_id,cutoff_at,actual_counts,actual_total,difference_total,formula_version,
 status,created_by_user_id,created_by_name,created_by_phone,count_no,system_balance,account_balance,counted_total,created_at)
select ('b0060000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('b0080000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b0020000-0000-4000-8000-000000000001',
 '2020-01-11T16:59Z','{"1":0,"2":0,"5":0,"10":0,"20":0,"50":0,"100":0,"500":0,"1000":0}',0,0,'test','active','b0010000-0000-4000-8000-000000000001','Bonus manager','0899030101',
 'CNT-BONUS-'||n,0,0,0,'2020-01-11T17:01Z' from generate_series(1,12) n;
set constraints all immediate;
create temporary table bonus_input as select jsonb_build_object(
 'exportIds',jsonb_build_array('b0030000-0000-4000-8000-000000000001'),'excludedKeys','[]'::jsonb,'excludedGroups','[]'::jsonb,
 'rate',.02,'metrics',jsonb_build_object('burden',jsonb_build_object('weight',50,'target',5),
 'loss',jsonb_build_object('weight',40,'target',10),'counts',jsonb_build_object('weight',10,'target',10))) input;
grant select,update on bonus_input to authenticated;
select set_config('request.jwt.claim.sub','b0010000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b0010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select extensions.ok(not has_table_privilege('authenticated','private.branch_bonus_exports','DELETE'),'cannot forge history unlock');
set local role authenticated;
select extensions.lives_ok($$select public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001',2147483647)$$,'maximum PostgreSQL pagination offset does not overflow');
select extensions.throws_like($$select public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001',null)$$,'%BONUS_INVALID%','null direct-RPC offset is rejected');
select extensions.ok(not has_function_privilege('anon','public.preview_branch_bonus(uuid,jsonb)','EXECUTE'),'anonymous cannot preview');
select extensions.ok(not has_table_privilege('authenticated','public.branch_bonuses','INSERT'),'cannot directly insert bonuses');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'suggestedAmount')::numeric,10400::numeric,'known weighted example is 10400');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'expenseTotal')::numeric,400::numeric,'aggregate reads all 1001 expense sources');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'countTotal')::integer,12,'count uses successful submission Thai day, not cutoff day');
select extensions.is(public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'periodStart','2020-01-12','REX creation date converts to Bangkok, not verified date');
select extensions.is(jsonb_array_length(public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->'expenses'),50,'expense details have first page only');
select extensions.is(jsonb_array_length(public.get_branch_bonus_source_page('b0020000-0000-4000-8000-000000000001',(select input from bonus_input),'expenses',1000)->'rows'),1,'final source page is available');
select extensions.is(jsonb_array_length(public.get_branch_bonus_candidates('b0020000-0000-4000-8000-000000000001')->'rows'),50,'candidate first page has 50');
select extensions.ok((public.get_branch_bonus_candidates('b0020000-0000-4000-8000-000000000001')->>'hasMore')::boolean,'history candidates include more pages');
select extensions.is(jsonb_array_length(public.get_branch_bonus_candidates('b0020000-0000-4000-8000-000000000001','2020-01-11T17:30Z','b0030000-0000-4000-8000-000000000003')->'rows'),2,'cursor ordering includes two remaining historical REX, not active REX 102');
select extensions.throws_like($$select public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{exportIds}','["b0030000-0000-4000-8000-000000000102"]'))$$,'%BONUS_SOURCE_CHANGED%','active REX cannot be selected by direct RPC');
select extensions.throws_like($$select public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{exportIds}','["b0030000-0000-4000-8000-000000000101"]'))$$,'%BONUS_SOURCE_CHANGED%','zero loss is unready');
select extensions.throws_like($$select public.preview_branch_bonus('b0020000-0000-4000-8000-000000000002',(select input from bonus_input))$$,'%BONUS_SOURCE_CHANGED%','REX must belong to chosen branch');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{metrics}','{"burden":{"weight":0,"target":0},"loss":{"weight":100,"target":12},"counts":{"weight":0,"target":null}}'))->>'suggestedAmount')::numeric,10000::numeric,'zero-weight sides skip target division');
select extensions.is(jsonb_array_length(public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{metrics}','{"burden":{"weight":0},"loss":{"weight":100,"target":12},"counts":{"weight":0}}'))->'metrics'),1,'disabled metrics are absent from results');
select extensions.ok(not (public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{metrics,loss,weight}','39'))->>'canConfirm')::boolean,'sum must be exactly 100');
select extensions.throws_like($$select public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{metrics,loss}','{}'))$$,'%BONUS_INVALID%','missing metric weight cannot bypass validation with SQL null');
select extensions.throws_like($$select public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input-'rate' from bonus_input))$$,'%BONUS_INVALID%','missing rate is rejected in DB');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{metrics,counts,target}','1.5'))->'metrics'->2->>'target')::integer,1,'count target is one inclusive day, ignoring a client-supplied fractional target');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'periodDays')::integer,1,'one selected Bangkok calendar day counts as one assessment day');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->'selectedSourceCounts'->>'expenses')::integer,1001,'selected expense count includes all pages');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{excludedKeys}','["expense:b0050000-0000-4000-8000-000000000001"]'))->'selectedSourceCounts'->>'expenses')::integer,1000,'excluding one expense decreases the selected count');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{excludedGroups}','["expense"]'))->'selectedSourceCounts'->>'expenses')::integer,0,'excluding an expense category removes its whole selected count');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{excludedGroups}','["expense"]'))->'sourceCounts'->>'expenses')::integer,1001,'total count remains available for paging excluded evidence');
select extensions.is(jsonb_array_length(public.get_branch_bonus_source_page('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{excludedGroups}','["expense"]'),'expenses',1000)->'rows'),1,'excluded evidence still has the final source page');
reset role;
savepoint count_day_span;
insert into public.rubber_exports select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
 'id','b0030000-0000-4000-8000-000000000200','export_no','REX-BONUS-COUNT-DAYS','sequence_no',200,'export_date','2020-01-14',
 'created_at','2020-01-13T17:30Z','verified_at','2020-01-15Z','age_cutoff_at','2020-01-15Z','sold_out_at','2020-01-15Z'))).*
 from public.rubber_exports e where id='b0030000-0000-4000-8000-000000000002';
select (public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{exportIds}','["b0030000-0000-4000-8000-000000000001","b0030000-0000-4000-8000-000000000200"]'))->'metrics'->2->>'target')::integer as three_day_target \gset
rollback to count_day_span;
select extensions.is(:'three_day_target'::integer,3,'Jan12 through Jan14 is three target records, including both endpoints');
select extensions.is((private.branch_bonus_present('{"periodStart":"2020-01-12","periodEnd":"2020-01-12","formulaVersion":"branch-bonus-v1","metrics":[{"key":"counts","target":10,"weight":100}],"allSources":[]}'::jsonb)->'metrics'->0->>'target')::integer,10,'presenting an old saved snapshot retains its original manual target');
set local role authenticated;
select extensions.ok(not (public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set(jsonb_set((select input from bonus_input),'{exportIds}','["b0030000-0000-4000-8000-000000000103"]'),'{rate}','1000'))->>'canConfirm')::boolean,'oversized suggested bonus cannot exceed supported money precision');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set(jsonb_set((select input from bonus_input),'{exportIds}','["b0030000-0000-4000-8000-000000000100"]'),'{metrics}','{"burden":{"weight":0},"loss":{"weight":100,"target":0.001},"counts":{"weight":0}}'))->>'lossActual')::numeric,.001::numeric,'raw positive loss remains eligible although stored/displayed percent rounds to zero');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{excludedGroups}','["expense"]'))->>'expenseTotal')::numeric,0::numeric,'whole source category can be excluded');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{excludedKeys}','["expense:b0050000-0000-4000-8000-000000000001"]'))->>'expenseTotal')::numeric,10::numeric,'individual source can be excluded independently');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set(jsonb_set((select input from bonus_input),'{exportIds}',jsonb_build_array('b0030000-0000-4000-8000-'||lpad(n::text,12,'0'))),'{metrics}','{"burden":{"weight":0},"loss":{"weight":100,"target":10},"counts":{"weight":0}}'))->>'adjustment')::numeric,expected::numeric,'tier boundary REX '||n)
from (values (1,-20),(7,10),(8,-10),(9,20),(10,0),(11,0)) cases(n,expected);
select extensions.throws_like($$select public.confirm_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001',(select input from bonus_input),repeat('0',32))$$,'%BONUS_SOURCE_CHANGED%','stale preview cannot confirm');
select extensions.lives_ok($$select public.set_rubber_export_sold_out('b0030000-0000-4000-8000-000000000002',false)$$,'preview does not lock unselected REX');
select extensions.lives_ok($$select pg_temp.seed_legacy_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001',(select input from bonus_input),public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'sourceFingerprint')$$,'pre-upgrade fixture preserves the known result');
select extensions.is((public.get_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001')->>'finalAmount')::numeric,10400::numeric,'snapshot contains agreed result');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'expenseTotal')::numeric,400::numeric,'overlapping periods still show full period data for simulation only');
select extensions.lives_ok($$select public.confirm_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001',(select input from bonus_input),public.get_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001')->>'sourceFingerprint')$$,'retry returns original result before overlap checks');
select extensions.throws_like($$select public.confirm_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001',(select input from bonus_input),public.get_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001')->>'sourceFingerprint',0)$$,'%BONUS_CONFLICT%','same request ID with changed amount conflicts');
select extensions.throws_like($$select public.set_rubber_export_sold_out('b0030000-0000-4000-8000-000000000001',false)$$,'%BONUS_HISTORY_LOCKED%','confirmed selected REX cannot leave history');
select extensions.throws_like($$select public.confirm_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000002',(select input from bonus_input),public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'sourceFingerprint')$$,'%BONUS_SOURCE_CHANGED%','new writes through the old endpoint require the mandatory review');
select extensions.is(jsonb_array_length(public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows'),0,'unchanged source has no difference');
reset role;
select extensions.is((select count(*) from public.income_expense where location_id='b0020000-0000-4000-8000-000000000001'),1001::bigint,'confirm did not create an expense');
select extensions.throws_like($$delete from public.rubber_exports where id='b0030000-0000-4000-8000-000000000001'$$,'%BONUS_HISTORY_LOCKED%','direct deletion of a selected sold-only REX is guarded');
select extensions.throws_like($$truncate public.rubber_exports cascade$$,'%BONUS_HISTORY_LOCKED%','bulk erasure cannot bypass selected REX history guard');
select extensions.is((select count(*) from public.branch_bonuses where location_id='b0020000-0000-4000-8000-000000000001'),1::bigint,'replay does not duplicate snapshot');
savepoint moved_source_purge;
update public.income_expense set tx_date='2020-01-20' where id='b0050000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','',true);select set_config('request.jwt.claims','{}',true);
delete from public.income_expense where id='b0050000-0000-4000-8000-000000000001';
select unknown as moved_purge_unknown from private.branch_bonus_changes('b0020000-0000-4000-8000-000000000001') where source_key='expense:b0050000-0000-4000-8000-000000000001' \gset
rollback to moved_source_purge;
select extensions.ok(:'moved_purge_unknown'::boolean,'date-moved source purged outside its original interval is unknown, not zero');
savepoint original_day_purge;
select set_config('request.jwt.claim.sub','',true);select set_config('request.jwt.claims','{}',true);
delete from public.income_expense where id='b0050000-0000-4000-8000-000000000001';
select unknown as original_purge_unknown from private.branch_bonus_changes('b0020000-0000-4000-8000-000000000001') where source_key='expense:b0050000-0000-4000-8000-000000000001' \gset
rollback to original_day_purge;
select extensions.ok(:'original_purge_unknown'::boolean,'original-day purge remains unknown as a date-move control');
savepoint authenticated_correction;
delete from public.income_expense where id='b0050000-0000-4000-8000-000000000001';
select unknown as corrected_source_unknown from private.branch_bonus_changes('b0020000-0000-4000-8000-000000000001') where source_key='expense:b0050000-0000-4000-8000-000000000001' \gset
rollback to authenticated_correction;
select extensions.ok(not :'corrected_source_unknown'::boolean,'authenticated business correction without a coverage gap remains known');
savepoint purchase_line_purge;
select set_config('request.jwt.claim.sub','',true);select set_config('request.jwt.claims','{}',true);
delete from public.rubber_bill_items where bill_id='b0040000-0000-4000-8000-000000000001';
select exists(select 1 from private.branch_bonus_source_gaps where kind='purchase' and location_id='b0020000-0000-4000-8000-000000000001') as purchase_gap_recorded \gset
select unknown as purchase_purge_unknown from private.branch_bonus_changes('b0020000-0000-4000-8000-000000000001') where source_key='purchase:b0040000-0000-4000-8000-000000000001' \gset
rollback to purchase_line_purge;
select extensions.ok(:'purchase_gap_recorded'::boolean,'physical weigh-line loss records purchase coverage before eligibility disappears');
select extensions.ok(:'purchase_purge_unknown'::boolean,'purchase disappearing after line purge is unknown, not a zero-valued correction');
update public.income_expense set cost=391 where id='b0050000-0000-4000-8000-000000000001';
select extensions.is((public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows'->0->>'new_amount')::numeric,391::numeric,'post-confirm change is informational, not a rewritten snapshot');
insert into public.rubber_exports
select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
 'id','b0030000-0000-4000-8000-000000000201','export_no','REX-BONUS-NEXT','sequence_no',201,'export_date','2020-01-20',
 'created_at','2020-01-20T01:00:00Z','verified_at','2020-01-21T01:00:00Z','age_cutoff_at','2020-01-21T01:00:00Z','sold_out_at','2020-01-21T01:00:00Z'))).*
from public.rubber_exports e where id='b0030000-0000-4000-8000-000000000004';
create temp table bonus_ack_input as select jsonb_set(jsonb_set(input,'{exportIds}','["b0030000-0000-4000-8000-000000000201"]'),
 '{metrics}','{"burden":{"weight":0},"loss":{"weight":100,"target":10},"counts":{"weight":0}}') input from bonus_input;
insert into public.income_expense select (jsonb_populate_record(null::public.income_expense,to_jsonb(e)||jsonb_build_object(
 'id','b0050000-0000-4000-8000-000000009001','client_temp_id','BN-LATE','local_bill_no','BN-LATE','server_bill_no','BN-LATE',
 'number','201','title','Late bonus expense','cost',5,'created_at',clock_timestamp()))).*
from public.income_expense e where id='b0050000-0000-4000-8000-000000000002';
select pg_temp.seed_legacy_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000201',
 (select input from bonus_ack_input),public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_ack_input))->>'sourceFingerprint',1);
select extensions.is(jsonb_array_length(public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows'),0,'next confirmed assessment considers the known difference once');
select extensions.is((public.get_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000201')->>'changeCount')::integer,2,'saved result retains changed source and late-arrival evidence');
select extensions.is((public.get_branch_bonus_source_page('b0020000-0000-4000-8000-000000000001',null,'changes',0,'b0070000-0000-4000-8000-000000000201')->'rows'->0->>'new_amount')::numeric,391::numeric,'saved difference detail is independent of the evolving live baseline');
update public.income_expense set cost=392,tx_date='2020-01-20' where id='b0050000-0000-4000-8000-000000000001';
select extensions.is((public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows'->0->>'old_amount')::numeric,391::numeric,'later change compares with last considered 391, not original 390');
select extensions.is((public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows'->0->>'new_amount')::numeric,392::numeric,'date-moved old source is found by identity outside its original period');
select extensions.is(jsonb_array_length(public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows'),1,'moved source has one origin, not a duplicate late arrival in a later bonus');
select public.delete_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000201');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_ack_input))->>'expenseTotal')::numeric,0::numeric,'previously considered source is not counted in full again after its date moves');
select extensions.is((public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows'->0->>'old_amount')::numeric,390::numeric,'deleting the considering bonus restores prior baseline');
select extensions.ok(exists(select 1 from jsonb_array_elements(public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows') v
  where v->>'source_key'='expense:b0050000-0000-4000-8000-000000009001' and v->>'old_amount' is null and (v->>'new_amount')::numeric=5),'deleting the considering bonus makes its late arrival pending again');
delete from public.income_expense where id='b0050000-0000-4000-8000-000000009001';
update public.income_expense set cost=390,tx_date='2020-01-12' where id='b0050000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
delete from public.income_expense where id='b0050000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','b0010000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b0010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((public.get_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001')->>'finalAmount')::numeric,10400::numeric,'source purge does not erase saved result');
select extensions.ok(not (public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'complete')::boolean,'unaudited loss records incomplete coverage');
select extensions.ok((public.get_branch_bonus_changes('b0020000-0000-4000-8000-000000000001')->'rows'->0->>'unknown')::boolean,'purged difference is unknown, not automatic zero adjustment');
select extensions.lives_ok($$select public.delete_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001')$$,'delete bonus releases memberships');
select extensions.lives_ok($$select public.set_rubber_export_sold_out('b0030000-0000-4000-8000-000000000001',false)$$,'selected REX can leave history after deletion');
select extensions.throws_like($$select public.confirm_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001',(select input from bonus_input),repeat('a',32))$$,'%BONUS_CONFLICT%','deleted confirmation identity cannot resurrect old bonus');
update bonus_input set input=jsonb_set(jsonb_set(jsonb_set(input,'{exportIds}','["b0030000-0000-4000-8000-000000000003"]'),'{metrics}','{"burden":{"weight":0},"loss":{"weight":100,"target":10},"counts":{"weight":0}}'),'{excludedGroups}','["expense"]');
select extensions.lives_ok($$select pg_temp.seed_legacy_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000003',(select input from bonus_input),public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'sourceFingerprint',0)$$,'pre-upgrade zero manual snapshot remains supported');
reset role;
update public.income_expense set tx_date='2020-01-20' where id='b0050000-0000-4000-8000-000000000002';
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_ack_input))->>'expenseTotal')::numeric,0::numeric,'excluded old cost is still considered and cannot re-enter in full on a new date');
update public.income_expense set tx_date='2020-01-12' where id='b0050000-0000-4000-8000-000000000002';
select extensions.throws_like($$delete from public.rubber_bills where id='b0040000-0000-4000-8000-000000000002'$$,'%BONUS_HISTORY_LOCKED%','deleting cross-branch receipt cannot release a confirmed REX');
select extensions.throws_like($$truncate public.rubber_bills cascade$$,'%BONUS_HISTORY_LOCKED%','bulk receipt erasure cannot move selected REX out of history');
select extensions.throws_like($$delete from public.rubber_exports where id='b0030000-0000-4000-8000-000000000003'$$,'%foreign key%','existing receipt source FK remains enforced');
select public.delete_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000003');
update bonus_input set input=jsonb_set(input,'{excludedGroups}','[]');
select extensions.lives_ok($$delete from public.rubber_bills where id='b0040000-0000-4000-8000-000000000002'$$,'deleting bonus releases receipt exit path');
-- Late business-date entries are included, even when recorded after the period.
update public.income_expense set created_at=clock_timestamp() where id='b0050000-0000-4000-8000-000000000002';
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',jsonb_set((select input from bonus_input),'{exportIds}','["b0030000-0000-4000-8000-000000000004"]'))->>'expenseTotal')::numeric,10::numeric,'backdated expense is filtered by business date, not receive timestamp');
set local role authenticated;
select set_config('request.jwt.claim.sub','b0010000-0000-4000-8000-000000000002',true);
select extensions.throws_like($$select public.get_branch_bonus_candidates('b0020000-0000-4000-8000-000000000001')$$,'%BONUS_FORBIDDEN%','ordinary branch admin cannot read candidates');
select extensions.throws_like($$select public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))$$,'%BONUS_FORBIDDEN%','ordinary branch admin cannot preview');
select extensions.throws_like($$select public.delete_branch_bonus('b0020000-0000-4000-8000-000000000001','b0070000-0000-4000-8000-000000000001')$$,'%BONUS_FORBIDDEN%','ordinary branch admin cannot delete');
reset role;
select set_config('request.jwt.claim.sub','b0010000-0000-4000-8000-000000000001',true);
-- Independent cost-source fixtures: split payment principals must never be re-added.
insert into public.financial_transactions(id,profile_id,type,amount,status,effective_date,expense_location_id,approved_at,
 payment_contract_version,payment_channel,payment_transfer_amount,created_at)
values('b0090000-0000-4000-8000-000000000001','b0010000-0000-4000-8000-000000000001','WITHDRAWAL',1000,'APPROVED','2020-01-12',
 'b0020000-0000-4000-8000-000000000001','2020-01-12Z',1,'branch_and_transfer',700,'2020-01-12Z');
insert into public.payroll_slips(id,profile_id,month,gross_pay,total_deductions,net_pay,total_days,daily_wage,status,created_by,
 expense_location_id,approved_at,payment_contract_version,payment_channel,payment_transfer_amount,created_at)
values('b0100000-0000-4000-8000-000000000001','b0010000-0000-4000-8000-000000000001','2020-01',2000,0,2000,4,500,'APPROVED',
 'b0010000-0000-4000-8000-000000000001','b0020000-0000-4000-8000-000000000001','2020-01-12Z',1,'branch_and_transfer',1800,'2020-01-12Z');
insert into public.money_transfers(id,location_id,transfer_type,net_amount_to_pay,transfer_status,record_status,
 withdrawal_transaction_id,time_payroll_source_kind,time_payroll_employee_name,time_payroll_source_label,time_payroll_source_date)
values('b0110000-0000-4000-8000-000000000001','b0020000-0000-4000-8000-000000000001','time_payroll',700,'pending','active',
 'b0090000-0000-4000-8000-000000000001','withdrawal','Bonus manager','เงินเบิก 12/01/2020','2020-01-12');
select extensions.is((select sum(amount) from private.branch_bonus_source_rows where location_id='b0020000-0000-4000-8000-000000000001' and kind='withdrawal'),1000::numeric,'split withdrawal cost is full 1000, not branch-only 300 or doubled 1700');
select extensions.is((select sum(amount) from private.branch_bonus_source_rows where location_id='b0020000-0000-4000-8000-000000000001' and kind='payroll'),2000::numeric,'approved payroll cost is full 2000 while transfer remains unpaid');
insert into public.rubber_exports
select (jsonb_populate_record(null::public.rubber_exports,to_jsonb(e)||jsonb_build_object(
 'id','b0130000-0000-4000-8000-000000000001','export_no','REX-BONUS-WORK','sequence_no',1001,
 'work_rate',.01,'other_operating_cost',122.75,'work_total',123.75,'expense_destination','external','verified_at','2020-01-12T01:00:00Z'))).*
from public.rubber_exports e where id='b0030000-0000-4000-8000-000000000004';
insert into public.money_transfers(id,location_id,transfer_type,rubber_export_id,net_amount_to_pay,transfer_status,record_status,created_at)
values('b0110000-0000-4000-8000-000000000002','b0020000-0000-4000-8000-000000000001','rubber_export_work',
 'b0130000-0000-4000-8000-000000000001',123,'pending','active','2020-01-12Z');
select extensions.is((select amount from private.branch_bonus_source_rows where key='work:b0130000-0000-4000-8000-000000000001'),123.75::numeric,'external-paid work uses 123.75 source cost rather than rounded payment 123');
insert into public.money_transfers(id,location_id,transfer_type,transport_cost,net_amount_to_pay,transfer_status,record_status,created_at)
values('b0110000-0000-4000-8000-000000000003','b0020000-0000-4000-8000-000000000001','transport',60,60,'pending','active','2020-01-12Z');
select extensions.is((select amount from private.branch_bonus_source_rows where key='transport:b0110000-0000-4000-8000-000000000003'),60::numeric,'transport cost is attributed to work branch before payment');
insert into public.customers(id,main_name,created_by_name,created_by_phone)
values('b0140000-0000-4000-8000-000000000001','Bonus fee customer','Bonus manager','0899030101');
insert into public.money_transfers(id,location_id,transfer_type,customer_id,customer_name,net_amount_to_pay,transfer_status,sync_status,record_status,created_at)
select ('b0110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b0020000-0000-4000-8000-000000000001',
 'customer','b0140000-0000-4000-8000-000000000001','Bonus fee customer',100,'pending','synced','active','2020-01-12Z' from generate_series(5,6) n;
select public.create_or_update_payment_bundle('b0020000-0000-4000-8000-000000000001','customer','b0140000-0000-4000-8000-000000000001');
select public.save_payment_bundle((select id from public.money_transfers where is_payment_bundle and customer_id='b0140000-0000-4000-8000-000000000001'),0,
 '[{"id":"b0120000-0000-4000-8000-000000000001","amount":200,"fee":8,"transactionDate":"2020-01-12T00:00:00.000Z","inputMethod":"manual","sortOrder":0}]',false);
select extensions.is((select sum(amount) from private.branch_bonus_source_rows where kind='fee' and location_id='b0020000-0000-4000-8000-000000000001'),8::numeric,'bundle parent slip fee appears exactly once for two children');
-- 51 successful counts are aggregated independently of the 50-row detail page.
insert into public.cash_count_sessions(id,location_id,cutoff_at,expires_at,status,started_by_user_id,started_by_name,started_by_phone,ended_at)
select ('b0080000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b0020000-0000-4000-8000-000000000001',
 '2020-01-11T16:59Z','2020-01-11T17:29Z','submitted','b0010000-0000-4000-8000-000000000001','Bonus manager','0899030101','2020-01-11T17:01Z' from generate_series(13,51) n;
insert into public.cash_counts
select (jsonb_populate_record(null::public.cash_counts,to_jsonb(c)||jsonb_build_object(
 'id','b0060000-0000-4000-8000-'||lpad(n::text,12,'0'),'session_id','b0080000-0000-4000-8000-'||lpad(n::text,12,'0'),'count_no','CNT-BONUS-'||n))).*
from public.cash_counts c cross join generate_series(13,51) n where c.id='b0060000-0000-4000-8000-000000000001';
update bonus_input set input=jsonb_set(jsonb_set(input,'{exportIds}','["b0030000-0000-4000-8000-000000000004"]'),'{metrics}','{"burden":{"weight":0},"loss":{"weight":0},"counts":{"weight":100,"target":50}}');
select extensions.is((public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'countActual')::integer,51,'all 51 counts contribute even though an unrelated cost source was purged');
select extensions.is(jsonb_array_length(public.get_branch_bonus_source_page('b0020000-0000-4000-8000-000000000001',(select input from bonus_input),'counts',50)->'rows'),1,'count detail page 2 has the 51st record');
update public.rubber_bills set record_status='deleted' where id='b0040000-0000-4000-8000-000000000001';
update bonus_input set input=jsonb_set(input,'{metrics}','{"burden":{"weight":100,"target":5},"loss":{"weight":0},"counts":{"weight":0}}');
select extensions.is(public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->'burdenActual','null'::jsonb,'zero purchase denominator is unavailable, never zero percent');
select extensions.ok(not (public.preview_branch_bonus('b0020000-0000-4000-8000-000000000001',(select input from bonus_input))->>'canConfirm')::boolean,'active burden cannot confirm with zero purchases');
reset role;
insert into public.locations(id,name,code) values('b0020000-0000-4000-8000-000000000003','Bonus coverage cleanup','BNG');
select private.mark_branch_bonus_source_gap('b0020000-0000-4000-8000-000000000003','2020-01-12','expense');
delete from public.locations where id='b0020000-0000-4000-8000-000000000003';
select extensions.is((select count(*) from private.branch_bonus_source_gaps where location_id='b0020000-0000-4000-8000-000000000003'),0::bigint,'coverage markers do not block deletion of an otherwise deletable branch');
select * from extensions.finish();
rollback;
