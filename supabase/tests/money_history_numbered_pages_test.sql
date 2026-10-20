begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.profiles(id,phone,name,role,is_active) values
 ('b2130000-0000-4000-8000-000000000001','0892130001','Page creator','admin',true),
 ('b2130000-0000-4000-8000-000000000002','0892130002','Page user','user',true);
insert into public.locations(id,name,code,is_active) values
 ('a2130000-0000-4000-8000-000000000001','Page branch','PAGE20',true);
insert into public.user_locations(user_id,location_id,is_primary) values ('b2130000-0000-4000-8000-000000000001','a2130000-0000-4000-8000-000000000001',true);
insert into public.dashboard_money_events(location_id,source_type,source_id,event_key,action,kind,number,title,direction,amount,actor_name,creator_user_id,creator_name,event_date,occurred_at)
select 'a2130000-0000-4000-8000-000000000001','income_expense',gen_random_uuid(),'page-'||i,'create','expense','PAGE-'||i,'Page fixture','expense',10,'Page actor',
 'b2130000-0000-4000-8000-000000000001','Page creator',(now() at time zone 'Asia/Bangkok')::date,now()-i*interval '1 second'
from generate_series(1,25) i;
select set_config('request.jwt.claim.sub','b2130000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.is(jsonb_array_length(public.get_operator_money_history(p_page=>3,p_actor_key=>'b2130000-0000-4000-8000-000000000001')->'rows'),5,'creator can jump directly to final page');
select extensions.is(public.get_operator_money_history(p_page=>3,p_actor_key=>'b2130000-0000-4000-8000-000000000001')->'rows'->0->>'number','PAGE-21','creator page offset selects correct row');
select extensions.is((public.get_operator_money_history(p_page=>3,p_actor_key=>'b2130000-0000-4000-8000-000000000001')->'counts'->>'all')::int,25,'creator count remains total across pages');
select extensions.is(public.get_operator_money_history(p_page=>3,p_actor_key=>'b2130000-0000-4000-8000-000000000001')->'nextCursor','null'::jsonb,'last page has no next cursor');
select extensions.is(public.get_operator_money_history(p_page=>1,p_actor_key=>'b2130000-0000-4000-8000-000000000001'),public.get_operator_money_history(p_actor_key=>'b2130000-0000-4000-8000-000000000001'),'first creator page equals legacy RPC');
select extensions.is(jsonb_array_length(public.get_dashboard_money_history(p_page=>3,p_location_id=>'a2130000-0000-4000-8000-000000000001')->'rows'),5,'dashboard can jump directly to final page');
select extensions.is(public.get_dashboard_money_history(p_page=>3,p_location_id=>'a2130000-0000-4000-8000-000000000001')->'rows'->0->>'number','PAGE-21','dashboard page offset selects correct row');
select extensions.is(public.get_dashboard_money_history(p_page=>1,p_location_id=>'a2130000-0000-4000-8000-000000000001'),public.get_dashboard_money_history(p_location_id=>'a2130000-0000-4000-8000-000000000001'),'first dashboard page equals legacy RPC');
select extensions.is(jsonb_array_length(public.get_operator_money_history(p_page=>2147483647,p_actor_key=>'b2130000-0000-4000-8000-000000000001')->'rows'),0,'large page does not overflow offset');
select extensions.throws_ok($$select public.get_operator_money_history(p_page=>0)$$,'22023','Invalid history page','zero page rejected');
select extensions.throws_ok($$select public.get_dashboard_money_history(p_page=>0,p_location_id=>'a2130000-0000-4000-8000-000000000001')$$,'22023','Invalid history page','dashboard zero page rejected');
reset role;
select set_config('request.jwt.claim.sub','b2130000-0000-4000-8000-000000000002',true);
set local role authenticated;
select extensions.throws_ok($$select public.get_operator_money_history(p_page=>1)$$,'42501','Operator history access denied','numbered creator RPC preserves role check');
select extensions.throws_ok($$select public.get_dashboard_money_history(p_page=>1,p_location_id=>'a2130000-0000-4000-8000-000000000001')$$,'P0001','Location access denied','numbered dashboard RPC preserves branch check');
reset role;
select extensions.ok(not has_function_privilege('anon','public.get_operator_money_history(integer,text,uuid,text,date,text,timestamptz,uuid)','execute'),'anonymous cannot execute numbered creator RPC');
select extensions.ok(not has_function_privilege('anon','public.get_dashboard_money_history(integer,uuid,date,text,timestamptz,uuid,integer)','execute'),'anonymous cannot execute numbered dashboard RPC');
select * from extensions.finish();
rollback;
