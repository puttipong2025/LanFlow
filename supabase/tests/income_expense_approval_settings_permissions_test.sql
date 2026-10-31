begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
 ('73000000-0000-4000-8000-000000000002','0897300002','Settings Manager','admin',true,true),
 ('73000000-0000-4000-8000-000000000003','0897300003','Settings Admin','admin',true,false);
create temp table settings_super as select id,gen_random_uuid() as session_id from public.profiles where role='super_admin' and is_active limit 1;
insert into auth.sessions(id,user_id,created_at,updated_at) select session_id,id,clock_timestamp(),clock_timestamp() from settings_super;
-- Fresh seed truncation can remove the singleton via its profiles foreign key.
insert into public.income_expense_approval_settings(id) values(true) on conflict(id) do nothing;
update public.income_expense_approval_settings set approval_min_amount=500, applies_to='both', non_current_date_requires_approval=false, cash_transfer_delete_requires_approval=true where id;
insert into public.income_expense_approval_keywords(id,keyword,is_active) values
 ('73000000-0000-4000-8000-000000000011','permission active',true),
 ('73000000-0000-4000-8000-000000000012','permission disabled',false);

select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"73000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((select count(*)::int from public.income_expense_approval_settings),1,'manager reads settings');
select extensions.is((select count(*)::int from public.income_expense_approval_keywords where id in ('73000000-0000-4000-8000-000000000011','73000000-0000-4000-8000-000000000012')),2,'manager reads active and disabled keywords');
with changed as (update public.income_expense_approval_settings set approval_min_amount=999 where id returning id) select extensions.is((select count(*)::int from changed),0,'manager cannot update amount');
with changed as (update public.income_expense_approval_settings set non_current_date_requires_approval=true where id returning id) select extensions.is((select count(*)::int from changed),0,'manager cannot update date');
with changed as (update public.income_expense_approval_settings set cash_transfer_delete_requires_approval=false where id returning id) select extensions.is((select count(*)::int from changed),0,'manager cannot update cash deletion rule');
with changed as (update public.income_expense_approval_keywords set is_active=false where id='73000000-0000-4000-8000-000000000011' returning id) select extensions.is((select count(*)::int from changed),0,'manager cannot disable keyword');
select extensions.throws_ok($$insert into public.income_expense_approval_keywords(keyword) values('manager denied')$$,'42501',null,'manager cannot insert keyword');
select extensions.throws_ok($$insert into public.income_expense_approval_settings(id) values(true) on conflict(id) do update set approval_min_amount=999$$,'42501',null,'manager cannot use old upsert path');
select extensions.ok(public.can_access_super_admin_features(),'manager capability remains available for request decisions');
reset role;

select set_config('request.jwt.claim.sub',(select id::text from settings_super),true);
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated','session_id',session_id)::text from settings_super),true);
set local role authenticated;
with changed as (update public.income_expense_approval_settings set approval_min_amount=600 where id and applies_to='both' and approval_min_amount=500 returning id) select extensions.is((select count(*)::int from changed),1,'super saves matching amount snapshot');
select extensions.is((select non_current_date_requires_approval from public.income_expense_approval_settings where id),false,'amount save preserves date');
with changed as (update public.income_expense_approval_settings set approval_min_amount=700 where id and approval_min_amount=500 returning id) select extensions.is((select count(*)::int from changed),0,'stale same-section update changes no row');
with changed as (update public.income_expense_approval_settings set non_current_date_requires_approval=true where id and non_current_date_requires_approval=false returning id) select extensions.is((select count(*)::int from changed),1,'independent date save still succeeds');
select extensions.is((select approval_min_amount::int from public.income_expense_approval_settings where id),600,'date save preserves new amount');
with changed as (update public.income_expense_approval_settings set cash_transfer_delete_requires_approval=false where id and cash_transfer_delete_requires_approval=true returning id) select extensions.is((select count(*)::int from changed),1,'super changes cash delete rule');
update public.income_expense_approval_settings set approval_min_amount=null where id;
with changed as (update public.income_expense_approval_settings set approval_min_amount=0 where id and approval_min_amount is null returning id) select extensions.is((select count(*)::int from changed),1,'null expected amount is matched explicitly');
insert into public.income_expense_approval_keywords(id,keyword) values('73000000-0000-4000-8000-000000000013','super created');
select extensions.is((select count(*)::int from public.income_expense_approval_keywords where id='73000000-0000-4000-8000-000000000013'),1,'super inserts keyword');
with changed as (update public.income_expense_approval_keywords set is_active=false where id='73000000-0000-4000-8000-000000000013' and is_active returning id) select extensions.is((select count(*)::int from changed),1,'super disables keyword');
select extensions.ok((select deleted_at is not null from public.income_expense_approval_keywords where id='73000000-0000-4000-8000-000000000013'),'disable time is recorded by database');
with changed as (update public.income_expense_approval_keywords set is_active=false where id='73000000-0000-4000-8000-000000000013' and is_active returning id) select extensions.is((select count(*)::int from changed),0,'repeat disable does not acknowledge a new change');
reset role;

select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"73000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select extensions.is((select count(*)::int from public.income_expense_approval_keywords where id='73000000-0000-4000-8000-000000000012'),0,'ordinary admin cannot read disabled keyword');
with changed as (update public.income_expense_approval_settings set approval_min_amount=999 where id returning id) select extensions.is((select count(*)::int from changed),0,'ordinary admin cannot write settings');
select extensions.throws_ok($$insert into public.income_expense_approval_keywords(keyword) values('admin denied')$$,'42501',null,'ordinary admin cannot create keyword');
reset role;

update public.profiles set is_active=false where id=(select id from settings_super);
select set_config('request.jwt.claim.sub',(select id::text from settings_super),true);
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated','session_id',session_id)::text from settings_super),true);
set local role authenticated;
with changed as (update public.income_expense_approval_settings set approval_min_amount=999 where id returning id) select extensions.is((select count(*)::int from changed),0,'inactive super cannot write settings');
select extensions.throws_ok($$insert into public.income_expense_approval_keywords(keyword) values('inactive denied')$$,'42501',null,'inactive super cannot create keyword');
reset role;
set local role anon;
select extensions.throws_ok($$select * from public.income_expense_approval_settings$$,'42501',null,'anonymous cannot read settings');
reset role;
select * from extensions.finish();
rollback;
