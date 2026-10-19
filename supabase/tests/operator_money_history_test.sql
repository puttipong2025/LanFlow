begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations(id, name, code, is_active) values
 ('a1900000-0000-4000-8000-000000000001', 'Operator A', 'OHA', true),
 ('a1900000-0000-4000-8000-000000000002', 'Operator B', 'OHB', true),
 ('a1900000-0000-4000-8000-000000000003', 'Operator C', 'OHC', true);
insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features) values
 ('b1900000-0000-4000-8000-000000000001', '0891900001', 'Admin A', 'admin', true, false),
 ('b1900000-0000-4000-8000-000000000002', '0891900002', 'Admin AB', 'admin', true, false),
 ('b1900000-0000-4000-8000-000000000003', '0891900003', 'Manager', 'admin', true, true),
 ('b1900000-0000-4000-8000-000000000004', '0891900004', 'Self service', 'user', true, false),
 ('b1900000-0000-4000-8000-000000000005', '0891900005', 'Same operator', 'admin', true, false),
 ('b1900000-0000-4000-8000-000000000006', '0891900006', 'Same operator', 'admin', true, false),
 ('b1900000-0000-4000-8000-000000000007', '0891900007', 'Hidden C operator', 'admin', true, false);
insert into public.user_locations(user_id, location_id, is_primary) values
 ('b1900000-0000-4000-8000-000000000001', 'a1900000-0000-4000-8000-000000000001', true),
 ('b1900000-0000-4000-8000-000000000002', 'a1900000-0000-4000-8000-000000000001', true),
 ('b1900000-0000-4000-8000-000000000002', 'a1900000-0000-4000-8000-000000000002', false),
 ('b1900000-0000-4000-8000-000000000004', 'a1900000-0000-4000-8000-000000000001', true);

-- Identical timestamps stress the id tie-breaker. actor 5: yesterday A=12, B=1;
-- today C=1 (forbidden for ordinary A/AB admins).
insert into public.dashboard_money_events(
 id, location_id, source_type, source_id, event_key, action, kind, number, title,
 direction, amount, actor_user_id, actor_name, occurred_at, event_date
)
select ('c1900000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
 'a1900000-0000-4000-8000-000000000001', 'income_expense', gen_random_uuid(),
 'operator-' || n, 'create', 'expense', 'OP-' || n, 'Operator fixture', 'expense', 10,
 'b1900000-0000-4000-8000-000000000005', 'Same operator',
 ((current_timestamp at time zone 'Asia/Bangkok')::date - 1 + time '23:59') at time zone 'Asia/Bangkok',
 (current_timestamp at time zone 'Asia/Bangkok')::date - 1
from generate_series(1,11) n;
insert into public.dashboard_money_events(
 id, location_id, source_type, source_id, event_key, action, kind, number, title,
 direction, amount, actor_user_id, actor_name, occurred_at, event_date
)
select ('c1900000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
 ('a1900000-0000-4000-8000-' || lpad(loc::text, 12, '0'))::uuid,
 source_type, gen_random_uuid(), 'operator-' || n, action, 'expense', 'OP-' || n,
 'Operator fixture', 'expense', 25,
 case when actor = 0 then null else ('b1900000-0000-4000-8000-' || lpad(actor::text,12,'0'))::uuid end,
 case when actor = 0 then 'Deleted snapshot ' || n else 'Same operator' end,
 ((current_timestamp at time zone 'Asia/Bangkok')::date - days + time '23:59') at time zone 'Asia/Bangkok',
 (current_timestamp at time zone 'Asia/Bangkok')::date - days
from (values
 (12, 1, 'rubber_bill', 'update', 5, 1),
 (13, 2, 'money_transfer', 'delete', 5, 1),
 (14, 3, 'income_expense', 'create', 5, 0),
 (15, 1, 'withdrawal_adjustment', 'create', 6, 2),
 (16, 1, 'payroll_slip', 'create', 0, 1),
 (17, 1, 'cash_transfer', 'delete', 0, 1),
 (18, 3, 'income_expense', 'create', 7, 0),
 (19, 1, 'income_expense', 'create', 5, 999)
) as f(n,loc,source_type,action,actor,days);

create function pg_temp.history(actor text default 'b1900000-0000-4000-8000-000000000005',
 loc uuid default null, route text default null, day date default null, action text default 'all',
 at_time timestamptz default null, event_id uuid default null) returns jsonb language sql as $$
 select public.get_operator_money_history(actor,loc,route,day,action,at_time,event_id)
$$;

select set_config('request.jwt.claim.sub', 'b1900000-0000-4000-8000-000000000001', true);
set local role authenticated;
select extensions.is((pg_temp.history()->'counts'->>'all')::int,12,'A admin sees only A events');
select extensions.is(jsonb_array_length(pg_temp.history()->'rows'),10,'ten rows per page');
select extensions.is(pg_temp.history()->>'selectedDate', ((now() at time zone 'Asia/Bangkok')::date-1)::text,'default latest date excludes forbidden newer C event');
select extensions.is(jsonb_array_length(pg_temp.history()->'actors'),3,'same-name actors remain separate plus unknown');
select extensions.is(jsonb_array_length(pg_temp.history()->'locations'),1,'location options do not leak B or C');
select extensions.ok(not (pg_temp.history()::text like '%Hidden C operator%'),'actor options do not leak forbidden actors');
select extensions.is((pg_temp.history(action=>'create')->'counts'->>'all')::int,12,'action counts ignore selected action');
select extensions.is((pg_temp.history(action=>'create')->'counts'->>'update')::int,1,'update count remains available while selecting create');
select extensions.is(jsonb_array_length(pg_temp.history(route=>'rubber-bills')->'rows'),1,'route filter applies to rows');
select extensions.is((pg_temp.history(route=>'rubber-bills')->'counts'->>'all')::int,1,'action counts respect route');
select extensions.is((select (v->>'count')::int from jsonb_array_elements(pg_temp.history(route=>'rubber-bills')->'routes') v where v->>'key'='income-expense'),11,'route facet ignores own selected route');
select extensions.is((pg_temp.history('B1900000-0000-4000-8000-000000000005')->'counts'->>'all')::int,12,'UUID case does not change actor selection');
select extensions.is(jsonb_array_length(pg_temp.history('unknown')->'rows'),2,'unknown actor snapshots remain visible');
select extensions.ok(pg_temp.history('unknown')::text like '%Deleted snapshot 16%','unknown actor preserves per-event snapshot names');
select extensions.is(pg_temp.history('b1900000-0000-4000-8000-000000000006')->>'selectedDate',((now() at time zone 'Asia/Bangkok')::date-2)::text,'latest date is specific to selected actor');
select extensions.is(pg_temp.history('b1900000-0000-4000-8000-000000000006')->'rows'->0->>'route','time-tracking','withdrawal adjustment maps to time/payroll');
select extensions.is(jsonb_array_length(pg_temp.history(null)->'rows'),0,'initial request returns options without auto-selecting actor');
select extensions.throws_ok($$select pg_temp.history(loc=>'a1900000-0000-4000-8000-000000000002')$$,'42501','Location access denied','direct RPC rejects inaccessible branch');
select extensions.throws_ok($$select pg_temp.history(action=>'bad')$$,'22023','Invalid action','invalid action is rejected');
select extensions.throws_ok($$select pg_temp.history(route=>'bad')$$,'22023','Invalid route','invalid route is rejected');
select extensions.throws_ok($$select pg_temp.history(day=>current_date-999)$$,'22023','Date outside retention window','retention enforced before delayed cleanup');

-- Read next page using the exact cursor (timestamp ties).
select extensions.is(jsonb_array_length(pg_temp.history(
 at_time=>(pg_temp.history()->'nextCursor'->>'at')::timestamptz,
 event_id=>(pg_temp.history()->'nextCursor'->>'id')::uuid)->'rows'),2,'cursor visits remaining two rows');
select extensions.is((pg_temp.history(
 at_time=>(pg_temp.history()->'nextCursor'->>'at')::timestamptz,
 event_id=>(pg_temp.history()->'nextCursor'->>'id')::uuid)->'counts'->>'all')::int,12,'counts independent of cursor');
select extensions.is((select count(*)::int from jsonb_array_elements(pg_temp.history()->'rows') a,
 jsonb_array_elements(pg_temp.history(at_time=>(pg_temp.history()->'nextCursor'->>'at')::timestamptz,
 event_id=>(pg_temp.history()->'nextCursor'->>'id')::uuid)->'rows') b where a->>'id'=b->>'id'),0,'pages do not overlap at identical timestamps');

reset role;
select set_config('request.jwt.claim.sub', 'b1900000-0000-4000-8000-000000000002', true);
set local role authenticated;
select extensions.is((pg_temp.history()->'counts'->>'all')::int,13,'AB admin sees both branches');
select extensions.is(jsonb_array_length(pg_temp.history()->'locations'),2,'AB admin gets two branch options');
select extensions.is((pg_temp.history(loc=>'a1900000-0000-4000-8000-000000000002')->'counts'->>'delete')::int,1,'branch filter applies');
select extensions.is((select (v->>'count')::int from jsonb_array_elements(pg_temp.history(loc=>'a1900000-0000-4000-8000-000000000002')->'locations') v where v->>'key'='a1900000-0000-4000-8000-000000000001'),12,'branch facet ignores own filter');

reset role;
select set_config('request.jwt.claim.sub', 'b1900000-0000-4000-8000-000000000003', true);
set local role authenticated;
select extensions.is(pg_temp.history()->>'selectedDate',(now() at time zone 'Asia/Bangkok')::date::text,'system manager sees latest unassigned C event');
select extensions.is((pg_temp.history(day=>(now() at time zone 'Asia/Bangkok')::date-1)->'counts'->>'all')::int,13,'system manager sees historical A+B without assignment');

reset role;
select set_config('request.jwt.claim.sub', 'b1900000-0000-4000-8000-000000000004', true);
set local role authenticated;
select extensions.throws_ok($$select pg_temp.history()$$,'42501','Operator history access denied','self-service user cannot call RPC directly');
reset role;
select extensions.ok(not has_function_privilege('anon','public.get_operator_money_history(text,uuid,text,date,text,timestamp with time zone,uuid)','EXECUTE'),'anonymous has no execute grant');
select extensions.ok(not exists(select 1 from pg_indexes where tablename='dashboard_money_events' and indexname like '%operator%'),'no speculative extra index');

-- One transfer creates two event sides. Keep both; do not collapse source IDs.
insert into public.dashboard_money_events(
 location_id,source_type,source_id,event_key,action,kind,number,title,direction,amount,
 actor_user_id,actor_name,occurred_at,event_date
) select ('a1900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'cash_transfer','d1900000-0000-4000-8000-000000000001','side-'||n,'create',
 case when n=1 then 'transfer_out' else 'transfer_in' end,'PAIR-1','Transfer pair',
 case when n=1 then 'expense' else 'income' end,42.25,
 'b1900000-0000-4000-8000-000000000006','Same operator',now(),(now() at time zone 'Asia/Bangkok')::date
 from generate_series(1,2) n;
select set_config('request.jwt.claim.sub','b1900000-0000-4000-8000-000000000002',true);
set local role authenticated;
select extensions.is((pg_temp.history('b1900000-0000-4000-8000-000000000006')->'counts'->>'all')::int,2,'AB viewer counts both sides of one transfer');
select extensions.is(jsonb_array_length(pg_temp.history('b1900000-0000-4000-8000-000000000006')->'rows'),2,'same source ID does not collapse event rows');
select extensions.is((pg_temp.history('b1900000-0000-4000-8000-000000000006')->'rows'->0->>'amount')::numeric,42.25::numeric,'RPC preserves amount precision');
select extensions.is(pg_temp.history('b1900000-0000-4000-8000-000000000006')->'rows'->0->>'route','money-transfer','cash transfer maps to money-transfer page');
select extensions.is((pg_temp.history('b1900000-0000-4000-8000-000000000099')->'counts'->>'all')::int,0,'unknown UUID returns no invented history');
select extensions.is(pg_temp.history('b1900000-0000-4000-8000-000000000099')->>'selectedDate',(now() at time zone 'Asia/Bangkok')::date::text,'no-event actor falls back to Bangkok today');
select extensions.is((pg_temp.history(day=>(now() at time zone 'Asia/Bangkok')::date)->'counts'->>'all')::int,0,'explicit empty day remains selected');
reset role;
select set_config('request.jwt.claim.sub','b1900000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.is((pg_temp.history('b1900000-0000-4000-8000-000000000006')->'counts'->>'all')::int,1,'A-only viewer sees only one side of transfer');
reset role;

select * from extensions.finish();
rollback;
