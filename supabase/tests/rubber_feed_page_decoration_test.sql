begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into auth.users(id,aud,role) values('af200000-0000-4000-8000-000000000001','authenticated','authenticated');
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features)
values('af200000-0000-4000-8000-000000000001','feed-page-probe','Feed page probe','admin',true,true);
insert into public.locations(id,name,code,is_active)
values('af200000-0000-4000-8000-000000000010','Feed page decoration probe','FEEDPAGEPROBE',true);
insert into public.rubber_bills(id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,
  sync_status,record_status,location_id,bill_no,bill_date,customer_name,bill_type,weight,
  rubber_value,average_price,deduction_total,net_total,revision_no,created_at,client_created_at,
  created_by_user_id,created_by_name,created_by_phone)
select gen_random_uuid(),'feed-page-'||n,'page-'||n,'page-'||n,'feed-page-'||n,
  'synced','active','af200000-0000-4000-8000-000000000010','page-'||n,current_date,
  'Feed page probe','weighing',100,100,1,0,100,1,
  '2026-01-01'::timestamptz+make_interval(secs=>n),'2026-01-01'::timestamptz+make_interval(secs=>n),
  'af200000-0000-4000-8000-000000000001','Feed page probe','fixture'
from generate_series(1,220) n;
select set_config('request.jwt.claim.sub','af200000-0000-4000-8000-000000000001',true);

create temporary sequence feed_decoration_calls;
-- Count real decoration work and preserve the report-lock answer. The resolver
-- still uses the real authoritative report linkage; instrumentation rolls back.
create or replace function public.report_lock_no(source_row public.rubber_bills) returns text
language plpgsql stable security definer set search_path='' as $$
begin
  perform nextval('pg_temp.feed_decoration_calls');
  return private.active_report_no('rubber_bill',source_row.id);
end $$;
create temporary table page_results(label text primary key,payload jsonb);
alter sequence pg_temp.feed_decoration_calls restart with 1;
insert into page_results values('first',public.get_rubber_bill_operational_feed_v2(
  'af200000-0000-4000-8000-000000000010','latest','any','',null,null,10));
select extensions.is(jsonb_array_length((select payload->'rows' from page_results where label='first')),10,'first page has exactly ten rows');
select extensions.is((select last_value from pg_temp.feed_decoration_calls),10::bigint,'only visible rows evaluate report decoration, not every branch bill');
select extensions.is((select payload->>'hasMore' from page_results where label='first'),'true','one extra identity proves hasMore');
select extensions.is((select payload->'rows'->0->>'server_bill_no' from page_results where label='first'),'page-220','latest starts with newest bill');
insert into page_results select 'second',public.get_rubber_bill_operational_feed_v2(
  'af200000-0000-4000-8000-000000000010','latest','any','',
  (payload->>'nextSortAt')::timestamptz,payload->>'nextWorkIdentity',10)
from page_results where label='first';
select extensions.is((select payload->'rows'->0->>'server_bill_no' from page_results where label='second'),'page-210','cursor excludes the previous page');
select extensions.is((select count(distinct r->>'id') from page_results,jsonb_array_elements(payload->'rows')r),20::bigint,'adjacent pages have no duplicate bill');
insert into page_results values('search',public.get_rubber_bill_operational_feed_v2(
  'af200000-0000-4000-8000-000000000010','latest','any','page-1',null,null,150));
select extensions.is(jsonb_array_length((select payload->'rows' from page_results where label='search')),111,'search is applied before paging');
insert into page_results values('empty',public.get_rubber_bill_operational_feed_v2(
  'af200000-0000-4000-8000-000000000010','latest','report_locked','',null,null,10));
select extensions.is(jsonb_array_length((select payload->'rows' from page_results where label='empty')),0,'report filter applies before selecting the page');
select extensions.is((select payload->>'hasMore' from page_results where label='empty'),'false','empty filtered page has no next page');
select * from extensions.finish();
rollback;
