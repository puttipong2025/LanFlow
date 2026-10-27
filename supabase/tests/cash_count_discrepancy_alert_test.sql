begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.profiles(id,phone,name,role,can_access_super_admin_features) values
 ('cc270000-0000-4000-8000-000000000001','0899927011','Difference manager','admin',true),
 ('cc270000-0000-4000-8000-000000000002','0899927012','Difference admin','admin',false);
insert into public.locations(id,name,code) values
 ('cc270000-0000-4000-8000-000000000011','Difference A','DFA27'),
 ('cc270000-0000-4000-8000-000000000012','Difference B','DFB27');
select set_config('request.jwt.claim.sub','cc270000-0000-4000-8000-000000000001',true);
create temp table grp as select (public.save_cash_count_alert_group(null,array['cc270000-0000-4000-8000-000000000011']::uuid[],1)->>'id')::uuid id;
select extensions.is((select discrepancy_threshold from public.cash_count_alert_groups where id=(select id from grp)),null::numeric,'old group defaults null');
select extensions.ok(not has_function_privilege('anon','public.save_cash_count_alert_group(uuid,uuid[],integer,boolean,integer,integer,boolean,numeric)','EXECUTE'),'new overload denies anon');
select extensions.ok(has_function_privilege('authenticated','public.save_cash_count_alert_group(uuid,uuid[],integer,boolean,integer,integer,boolean,numeric)','EXECUTE'),'new overload authenticated');
select public.save_cash_count_alert_group((select id from grp),array['cc270000-0000-4000-8000-000000000011']::uuid[],1,null,null,null,true,100);
select extensions.is((select discrepancy_threshold from public.cash_count_alert_groups where id=(select id from grp)),100::numeric,'new overload writes threshold');
select public.save_cash_count_alert_group((select id from grp),array['cc270000-0000-4000-8000-000000000011']::uuid[],1);
select public.save_cash_count_alert_group((select id from grp),array['cc270000-0000-4000-8000-000000000011']::uuid[],1,false,null,null);
select extensions.is((select discrepancy_threshold from public.cash_count_alert_groups where id=(select id from grp)),100::numeric,'3/6 legacy overloads preserve');
select extensions.throws_like($$select public.save_cash_count_alert_group((select id from grp),array['cc270000-0000-4000-8000-000000000011']::uuid[],1,null,null,null,true,-1)$$,'%cash_count_discrepancy_threshold_valid%','negative rejected');
select extensions.throws_like($$select public.save_cash_count_alert_group((select id from grp),array['cc270000-0000-4000-8000-000000000011']::uuid[],1,null,null,null,true,0.001)$$,'%cash_count_discrepancy_threshold_valid%','precision rejected before rounding');
create function pg_temp.candidate() returns jsonb language sql as $$
 select x from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') x where x->>'locationId'='cc270000-0000-4000-8000-000000000011' and x->>'kind'='count'
$$;
select extensions.is(pg_temp.candidate(),null::jsonb,'no previous count produces no fabricated discrepancy');
create temp table sess as select (public.start_cash_count_session('cc270000-0000-4000-8000-000000000011')->'session'->>'id')::uuid id;
select public.submit_cash_count_v3((select id from sess),'{"1":0,"2":0,"5":0,"10":0,"20":0,"50":0,"100":1,"500":0,"1000":0}',array[]::uuid[]);
select extensions.is(pg_temp.candidate(),null::jsonb,'equal threshold is not alerted');
update public.cash_count_alert_groups set discrepancy_threshold=99.99 where id=(select id from grp);
select extensions.is((pg_temp.candidate()->'discrepancy'->>'amount')::numeric,100::numeric,'exceed by one cent alerts');
select extensions.is((pg_temp.candidate()->>'value')::integer,0,'discrepancy alone does not fabricate overdue days');
select extensions.is((public.get_cash_count_overdue_status()->'states'->0->>'locked')::boolean,false,'difference does not lock branch');
select public.check_cash_count((select id from public.cash_counts where session_id=(select id from sess)));
select extensions.ok(pg_temp.candidate()->'discrepancy' is not null,'review does not dismiss difference');
update public.cash_counts set system_balance=200,difference_total=-100 where session_id=(select id from sess);
select extensions.is((pg_temp.candidate()->'discrepancy'->>'amount')::numeric,-100::numeric,'shortage preserves negative sign');
update public.cash_counts set system_balance=null where session_id=(select id from sess);
select extensions.is(pg_temp.candidate(),null::jsonb,'legacy missing system balance is not interpreted as discrepancy or zero');
update public.cash_counts set system_balance=0,difference_total=100,cutoff_at=now()-interval '5 days' where session_id=(select id from sess);
select extensions.ok((pg_temp.candidate()->>'value')::integer>0 and (pg_temp.candidate()->'discrepancy'->>'amount')::numeric=100,'one candidate retains both overdue and discrepancy');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.get_branch_threshold_alert_check()->'candidates') x where x->>'locationId'='cc270000-0000-4000-8000-000000000011'),1,'one branch is not counted twice');
-- A later correct count replaces the old difference, regardless of its timestamp cutoff.
update public.cash_counts set created_at=now()-interval '1 day' where session_id=(select id from sess);
update sess set id=(public.start_cash_count_session('cc270000-0000-4000-8000-000000000011')->'session'->>'id')::uuid;
select public.submit_cash_count_v3((select id from sess),'{"1":0,"2":0,"5":0,"10":0,"20":0,"50":0,"100":0,"500":0,"1000":0}',array[]::uuid[]);
update public.cash_counts set created_at=now() where location_id='cc270000-0000-4000-8000-000000000011';
select extensions.is(coalesce(pg_temp.candidate()->'discrepancy'->>'countId','none'),
 (select case when difference_total=0 then 'none' else c.id::text end from public.cash_counts c where location_id='cc270000-0000-4000-8000-000000000011' order by c.id desc limit 1),'same time uses id as deterministic tie breaker');
update public.cash_counts set created_at=now()-interval '1 day' where location_id='cc270000-0000-4000-8000-000000000011' and session_id<>(select id from sess);
select extensions.is(pg_temp.candidate(),null::jsonb,'latest correct count hides historical difference');
select public.delete_cash_count((select id from public.cash_counts where session_id=(select id from sess)));
select extensions.is((pg_temp.candidate()->'discrepancy'->>'amount')::numeric,100::numeric,'delete newest falls back to remaining active count');
update public.cash_count_alert_groups set discrepancy_threshold=0 where id=(select id from grp);
select extensions.ok(pg_temp.candidate()->'discrepancy' is not null,'zero threshold alerts nonzero');
select public.save_cash_count_alert_group((select id from grp),array['cc270000-0000-4000-8000-000000000011']::uuid[],1,null,null,null,true,null);
select extensions.is(pg_temp.candidate()->'discrepancy','null'::jsonb,'explicit null disables discrepancy while preserving overdue notice');
select set_config('request.jwt.claim.sub','cc270000-0000-4000-8000-000000000002',true);
select extensions.is(pg_temp.candidate(),null::jsonb,'unassigned admin cannot inspect branch');
select extensions.throws_like($$select public.save_cash_count_alert_group((select id from grp),array['cc270000-0000-4000-8000-000000000011']::uuid[],1,null,null,null,true,0)$$,'%FORBIDDEN%','ordinary admin cannot edit threshold');
select * from extensions.finish();
rollback;
