begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.profiles(id,phone,name,role,is_active,daily_wage,can_access_super_admin_features)
values ('7ef10000-0000-4000-8000-000000000031','0897399931','Attendance revision regression','admin',true,100,true);
select set_config('request.jwt.claim.sub','7ef10000-0000-4000-8000-000000000031',true);
insert into public.time_payroll_active_periods(profile_id,start_on,created_by,updated_by)
values ('7ef10000-0000-4000-8000-000000000031',
 (date_trunc('month',now() at time zone 'Asia/Bangkok')-interval '1 month')::date,
 '7ef10000-0000-4000-8000-000000000031','7ef10000-0000-4000-8000-000000000031');
create temp table attendance_client_snapshots as select
 to_char((now() at time zone 'Asia/Bangkok')-interval '1 month','YYYY-MM') as month,
 public.get_time_payroll_attendance_month('7ef10000-0000-4000-8000-000000000031',to_char((now() at time zone 'Asia/Bangkok')-interval '1 month','YYYY-MM'))->>'revision' as revision;
select extensions.ok((select revision ~ '^[0-9a-f]{32}$' from attendance_client_snapshots),'GET returns an attendance revision');
select public.replace_time_payroll_attendance_exceptions('7ef10000-0000-4000-8000-000000000031',month,
 jsonb_build_array(jsonb_build_object('date',month||'-01','status','OFF')),revision) from attendance_client_snapshots;
select extensions.throws_ok(format('select public.replace_time_payroll_attendance_exceptions(%L,%L,%L::jsonb,%L)',
 '7ef10000-0000-4000-8000-000000000031',month,'[]',revision),'P0001','ATTENDANCE_STALE',
 'another client cannot overwrite the month from an old snapshot') from attendance_client_snapshots;
select extensions.is((select count(*) from public.time_payroll_attendance_exceptions where profile_id='7ef10000-0000-4000-8000-000000000031'),1::bigint,'the first client saved data remains intact');
select extensions.throws_ok(format('select public.replace_time_payroll_attendance_exceptions(%L,%L,%L::jsonb)',
 '7ef10000-0000-4000-8000-000000000031',month,'[]'),'P0001','ATTENDANCE_REVISION_REQUIRED',
 'old clients cannot bypass the snapshot requirement') from attendance_client_snapshots;
select extensions.ok(not has_function_privilege('authenticated','private.replace_time_payroll_attendance_exceptions(uuid,text,jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','private.time_payroll_attendance_revision(uuid,text)','EXECUTE'), 'unchecked writer and fingerprint stay private');
select extensions.ok(not has_function_privilege('authenticated','private.rebuild_open_time_payroll_deductions(uuid,uuid,text)','EXECUTE'), 'shared settlement helper stays private');
select * from extensions.finish();
rollback;
