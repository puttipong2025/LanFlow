begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations(id,name,code,is_active) values
 ('61000000-0000-4000-8000-000000000001','Parity A','PARITYA',true),
 ('61000000-0000-4000-8000-000000000002','Parity B','PARITYB',true);
insert into public.profiles(id,phone,name,role,is_active,can_manage_time_payroll,can_access_super_admin_features,daily_wage) values
 ('62000000-0000-4000-8000-000000000001','0896100001','Delegated A','admin',true,true,false,500),
 ('62000000-0000-4000-8000-000000000002','0896100002','Employee A','user',true,false,false,500),
 ('62000000-0000-4000-8000-000000000003','0896100003','Employee B','user',true,false,false,500),
 ('62000000-0000-4000-8000-000000000004','0896100004','System manager','admin',true,false,true,500),
 ('62000000-0000-4000-8000-000000000006','0896100006','Delegated peer','admin',true,true,false,500),
 ('62000000-0000-4000-8000-000000000007','0896100007','Ordinary user','user',true,false,false,500);
insert into public.user_locations(user_id,location_id,is_primary)
select id, case when id='62000000-0000-4000-8000-000000000003'::uuid
 then '61000000-0000-4000-8000-000000000002'::uuid else '61000000-0000-4000-8000-000000000001'::uuid end, true
from public.profiles where id::text like '62000000-%';
set constraints all immediate;

select extensions.throws_ok(
  $$update public.profiles set can_manage_time_payroll = true where id = '62000000-0000-4000-8000-000000000007'$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_admin_only_elevated_access"',
  'a user role cannot receive delegated payroll management'
);

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select extensions.lives_ok($$select public.update_time_payroll_config('17:00')$$,'super admin can configure the shared cutoff');
select extensions.lives_ok($$select public.create_time_tracking_transaction(
 '62000000-0000-4000-8000-000000000002','WITHDRAWAL',20,(now() at time zone 'Asia/Bangkok')::date,
 'Historical B','61000000-0000-4000-8000-000000000002',null)$$,'global manager can record a payment in another branch');

select set_config('request.jwt.claim.sub','62000000-0000-4000-8000-000000000004',true);
select extensions.throws_ok($$select public.update_time_payroll_config('18:00')$$,'P0001','Forbidden','system manager cannot configure cutoff');

select set_config('request.jwt.claim.sub','62000000-0000-4000-8000-000000000001',true);
select extensions.throws_ok($$select public.update_time_payroll_config('18:00')$$,'P0001','Forbidden','delegated manager cannot configure cutoff');
select extensions.lives_ok($$select public.get_time_payroll_settings()$$,'delegated manager can read cutoff');
select extensions.lives_ok($$select public.update_time_tracking_wage('62000000-0000-4000-8000-000000000001',510.1234)$$,'manager can update own wage');
select extensions.lives_ok($$select public.update_time_tracking_wage('62000000-0000-4000-8000-000000000006',510)$$,'manager can update delegated peer wage');
select extensions.throws_ok($$select public.update_time_tracking_wage('62000000-0000-4000-8000-000000000003',510)$$,'P0001','Forbidden','other primary branch denied');
select extensions.throws_ok($$select public.update_time_tracking_wage('62000000-0000-4000-8000-000000000004',510)$$,'P0001','Forbidden','system manager target denied');
select extensions.throws_ok($$select public.update_time_tracking_wage('00000000-0000-4000-8000-000000000001',510)$$,'P0001','Forbidden','super admin target denied');
select extensions.is((select count(*) from public.get_time_payroll_payment_locations()),1::bigint,'payment choices only contain assigned active branch');
select extensions.lives_ok($$select public.create_time_tracking_transaction(
 '62000000-0000-4000-8000-000000000001','WITHDRAWAL',10,(now() at time zone 'Asia/Bangkok')::date,
 'Own branch payment','61000000-0000-4000-8000-000000000001','own approval')$$,'self withdrawal creates and approves atomically');
select extensions.is((select status::text from public.financial_transactions where description='Own branch payment'),'APPROVED','self withdrawal is approved');
select extensions.is((select approved_by from public.financial_transactions where description='Own branch payment'),'62000000-0000-4000-8000-000000000001'::uuid,'self approval records the actor');
select extensions.throws_ok($$select public.create_time_tracking_transaction(
 '62000000-0000-4000-8000-000000000002','WITHDRAWAL',10,(now() at time zone 'Asia/Bangkok')::date,
 'Denied payer','61000000-0000-4000-8000-000000000002',null)$$,'P0001','Expense location access denied','new payer outside scope denied');
select extensions.is((select count(*) from public.financial_transactions where description='Denied payer'),0::bigint,'failed payer choice leaves no source');
select extensions.is((select public.expense_location_name(ft) from public.financial_transactions ft where description='Historical B'),'Parity B','historical payer name remains readable');
select extensions.throws_ok($$select public.change_time_tracking_expense_location('transaction',
 (select id from public.financial_transactions where description='Historical B'),null,null)$$,'P0001','Existing expense location access denied','central payment cannot bypass old payer boundary');
select extensions.throws_ok($$select public.delete_time_tracking_source_permanently('transaction',
 (select id from public.financial_transactions where description='Historical B'))$$,'P0001','Existing expense location access denied','deletion cannot affect old payer outside scope');
select extensions.lives_ok($$select public.change_time_tracking_expense_location('transaction',
 (select id from public.financial_transactions where description='Own branch payment'),null,null)$$,'in-scope approved payment can change to central');
select extensions.lives_ok($$select public.delete_time_tracking_source_permanently('transaction',
 (select id from public.financial_transactions where description='Own branch payment'))$$,'in-scope approved source can be deleted');

select extensions.lives_ok($$select public.set_time_payroll_active_period('62000000-0000-4000-8000-000000000001','ENABLE',
 (date_trunc('month',now() at time zone 'Asia/Bangkok') - interval '1 month')::date)$$,'delegated manager can enroll self');
select extensions.lives_ok($$select public.set_time_payroll_active_period('62000000-0000-4000-8000-000000000001','PAUSE',
 (now() at time zone 'Asia/Bangkok')::date+2)$$,'delegated manager can schedule pause');
select extensions.lives_ok($$select public.cancel_time_payroll_active_period_schedule('62000000-0000-4000-8000-000000000001')$$,'delegated manager can cancel schedule');
select extensions.throws_ok($$select public.set_time_payroll_active_period('62000000-0000-4000-8000-000000000003','ENABLE',
 (now() at time zone 'Asia/Bangkok')::date)$$,'P0001','Forbidden','period action on other branch denied');
select extensions.throws_ok($$select public.create_time_tracking_payroll_slip('62000000-0000-4000-8000-000000000001',
 to_char(now() at time zone 'Asia/Bangkok' - interval '1 month','YYYY-MM'),false,
 '61000000-0000-4000-8000-000000000001',null,1)$$,'P0001','PAYROLL_AMOUNT_CHANGED','stale amount rolls back creation');
select extensions.is((select count(*) from public.payroll_slips where profile_id='62000000-0000-4000-8000-000000000001'),0::bigint,'stale amount leaves no slip');
select extensions.lives_ok($$select public.create_time_tracking_payroll_slip('62000000-0000-4000-8000-000000000001',
 to_char(now() at time zone 'Asia/Bangkok' - interval '1 month','YYYY-MM'),false,
 '61000000-0000-4000-8000-000000000001',null,
 (public.preview_time_tracking_payroll_slip('62000000-0000-4000-8000-000000000001',to_char(now() at time zone 'Asia/Bangkok' - interval '1 month','YYYY-MM'))->>'netPay')::numeric)$$,'self payroll quote can be created and approved in one call');
select extensions.is((select status::text from public.payroll_slips where profile_id='62000000-0000-4000-8000-000000000001'),'APPROVED','self payroll is approved');
select extensions.is((select public.expense_location_name(ps) from public.payroll_slips ps where profile_id='62000000-0000-4000-8000-000000000001'),'Parity A','payroll exposes persisted payer name');

-- Employee submission stays pending; a delegated manager can decide it and see the badge.
select set_config('request.jwt.claim.sub','62000000-0000-4000-8000-000000000002',true);
select extensions.lives_ok($$select public.request_time_tracking_withdrawal(5)$$,'employee request remains available');
select extensions.is((select count(*) from public.financial_transactions where profile_id=auth.uid() and status='PENDING'),1::bigint,'employee request remains pending');
select set_config('request.jwt.claim.sub','62000000-0000-4000-8000-000000000001',true);
select extensions.is((select item_count from public.get_actionable_badge_counts() where module_id='time-tracking' and location_id='61000000-0000-4000-8000-000000000001'),1::bigint,'delegated approver sees actionable badge');
select extensions.lives_ok($$select public.decide_time_tracking_approval('transaction',
 (select id from public.financial_transactions where profile_id='62000000-0000-4000-8000-000000000002' and status='PENDING'),
 'APPROVED',null,'61000000-0000-4000-8000-000000000001')$$,'delegated approver can decide employee request');
select extensions.is((select count(*) from public.time_tracking_audit_logs),0::bigint,'central audit remains restricted');

-- A zero-day END has no period row; expose only its boundary, not central audit logs.
reset role;
insert into public.time_tracking_audit_logs(admin_id,action,target_table,record_id,new_data)
values ('62000000-0000-4000-8000-000000000004','SET_PAYROLL_ACTIVE_PERIOD','time_payroll_active_periods',
 '62000000-0000-4000-8000-000000000002',jsonb_build_object('action','END','selectedEffectiveOn',(now() at time zone 'Asia/Bangkok')::date));
set local role authenticated;
select extensions.is(public.get_time_payroll_attendance_month('62000000-0000-4000-8000-000000000002',
 to_char(now() at time zone 'Asia/Bangkok','YYYY-MM'))->>'lastEndOn',
 ((now() at time zone 'Asia/Bangkok')::date)::text,'delegated manager can offer RESUME after zero-day END');

reset role;
update public.profiles set can_manage_time_payroll=false where id='62000000-0000-4000-8000-000000000001';
set local role authenticated;
select extensions.throws_ok($$select public.update_time_tracking_wage('62000000-0000-4000-8000-000000000002',600)$$,'P0001','Forbidden','revocation immediately stops mutation');
select extensions.is((select count(*) from public.financial_transactions where profile_id='62000000-0000-4000-8000-000000000002'),0::bigint,'revocation immediately stops other employee reads');
reset role;
select * from extensions.finish();
rollback;
