begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.profiles(id,phone,name,role,is_active,can_access_super_admin_features) values
('cb000000-0000-4000-8000-000000000002','cache-settings-manager','Cache manager','admin',true,true),
('cb000000-0000-4000-8000-000000000003','cache-settings-inactive','Cache inactive','admin',false,false);
update public.business_cache_settings set interval_minutes=null,revision=1;
create temp table cache_test_sessions as select id as user_id, gen_random_uuid() as id from public.profiles
where role='super_admin' and is_active;
insert into auth.sessions(id,user_id,created_at,updated_at)
select id,user_id,clock_timestamp(),clock_timestamp() from cache_test_sessions;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='super_admin' and is_active),true);
select set_config('request.jwt.claims',(select jsonb_build_object('sub',user_id,'role','authenticated','session_id',id)::text
from cache_test_sessions where user_id=auth.uid()),true);
select extensions.is(public.get_business_cache_settings(),'{"intervalMinutes":null,"revision":1}'::jsonb,'starts with periodic checking off');
select extensions.is(public.save_business_cache_settings(10,1),'{"intervalMinutes":10,"revision":2}'::jsonb,'superadmin can set minimum');
select extensions.is(public.save_business_cache_settings(10,2)->>'revision','2','same setting is idempotent');
select extensions.throws_ok('select public.save_business_cache_settings(120,1)','40001','Cache settings changed','stale writer cannot overwrite');
select extensions.is(public.save_business_cache_settings(120,2)->>'intervalMinutes','120','maximum accepted');
select extensions.throws_ok('select public.save_business_cache_settings(9,3)','22023','Invalid cache settings','below minimum rejected');
select extensions.throws_ok('select public.save_business_cache_settings(121,3)','22023','Invalid cache settings','above maximum rejected');
select extensions.is(public.save_business_cache_settings(null,3)->>'revision','4','can turn periodic checks off');
select extensions.is((select updated_by from public.business_cache_settings),auth.uid(),'actor recorded');
select set_config('request.jwt.claim.sub','cb000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{}',true);
select extensions.is(public.get_business_cache_settings()->>'revision','4','manager can read shared setting');
select extensions.throws_ok('select public.save_business_cache_settings(10,4)','42501','FORBIDDEN','delegated manager cannot set it');
select set_config('request.jwt.claim.sub','cb000000-0000-4000-8000-000000000003',true);
select extensions.throws_ok('select public.save_business_cache_settings(10,4)','42501','FORBIDDEN','inactive account cannot set it');
select extensions.ok(not has_table_privilege('authenticated','public.business_cache_settings','UPDATE'),'no direct authenticated writes');
select extensions.ok(not has_table_privilege('authenticated','public.business_cache_settings','SELECT'),'reads go through guarded RPC');
select extensions.ok(not has_function_privilege('anon','public.get_business_cache_settings()','EXECUTE'),'no anonymous reads');
select extensions.ok(not has_function_privilege('anon','public.save_business_cache_settings(integer,integer)','EXECUTE'),'no anonymous writes');
select * from extensions.finish();
rollback;
