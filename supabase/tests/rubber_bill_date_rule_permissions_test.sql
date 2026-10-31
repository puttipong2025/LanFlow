begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

select extensions.ok(not has_function_privilege('anon', 'public.save_rubber_bill_date_approval_setting(boolean)', 'execute'), 'anonymous callers cannot execute the date rule RPC');
select extensions.ok(has_function_privilege('authenticated', 'public.save_rubber_bill_date_approval_setting(boolean)', 'execute'), 'authenticated callers reach the guarded date rule RPC');

insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values ('72000000-0000-4000-8000-000000000031', '0897100031', 'Date Rule Manager', 'admin', true, true);
create temp table date_rule_session as select gen_random_uuid() as id;
insert into auth.sessions(id,user_id,created_at,updated_at)
select s.id,p.id,clock_timestamp(),clock_timestamp()
from date_rule_session s,public.profiles p where p.role='super_admin' and p.is_active limit 1;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role='super_admin' and is_active limit 1), true);
select set_config('request.jwt.claims', (select jsonb_build_object('sub',id,'role','authenticated','session_id',(select id from date_rule_session))::text from public.profiles where role='super_admin' and is_active limit 1), true);
set local role authenticated;
select extensions.is(public.save_rubber_bill_date_approval_setting(true), true, 'exact super admin enables the date rule');
select extensions.is((select non_current_date_requires_approval from public.rubber_bill_approval_settings where id=true), true, 'enabled date rule is persisted');
select extensions.throws_ok($$select public.save_rubber_bill_date_approval_setting(null)$$, 'P0001', 'RUBBER_GROUP_INVALID: ต้องระบุกฎวันที่บิล', 'super admin still receives input validation');

reset role;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000031', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000031","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok($$select public.save_rubber_bill_date_approval_setting(false)$$, 'P0001', 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งกฎวันที่บิลยางได้', 'delegated system manager cannot change the date rule through direct RPC');
select extensions.throws_ok($$select public.save_rubber_bill_date_approval_setting(null)$$, 'P0001', 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งกฎวันที่บิลยางได้', 'authorization precedes validation');
reset role;
select extensions.is((select non_current_date_requires_approval from public.rubber_bill_approval_settings where id=true), true, 'forbidden writes leave the date rule unchanged');
update public.profiles set can_access_super_admin_features=false where id='72000000-0000-4000-8000-000000000031';
set local role authenticated;
select extensions.throws_ok($$select public.save_rubber_bill_date_approval_setting(false)$$, 'P0001', 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งกฎวันที่บิลยางได้', 'ordinary admin cannot change the date rule');
reset role;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role='super_admin' and is_active limit 1), true);
select set_config('request.jwt.claims', (select jsonb_build_object('sub',id,'role','authenticated','session_id',(select id from date_rule_session))::text from public.profiles where role='super_admin' and is_active limit 1), true);
set local role authenticated;
select extensions.is(public.save_rubber_bill_date_approval_setting(false), false, 'active super admin can disable the date rule');
reset role;
select * from extensions.finish();
rollback;
