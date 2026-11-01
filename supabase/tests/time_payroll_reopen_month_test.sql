begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.profiles(id,phone,name,role,is_active,daily_wage,can_access_super_admin_features)
values ('7ef10000-0000-4000-8000-000000000011','0897399911','Reopen regression','admin',true,100,true);
select set_config('request.jwt.claim.sub','7ef10000-0000-4000-8000-000000000011',true);
select set_config('request.jwt.claims','{"sub":"7ef10000-0000-4000-8000-000000000011","role":"authenticated"}',true);
insert into public.time_payroll_active_periods(profile_id,start_on,created_by,updated_by)
values ('7ef10000-0000-4000-8000-000000000011',
 (date_trunc('month',now() at time zone 'Asia/Bangkok')-interval '3 months')::date,
 '7ef10000-0000-4000-8000-000000000011','7ef10000-0000-4000-8000-000000000011');

-- Closed earlier month stays immutable while the immediately previous month reopens.
insert into public.payroll_slips(id,profile_id,month,gross_pay,total_deductions,net_pay,total_days,daily_wage,status,created_by)
select ('7ef30000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '7ef10000-0000-4000-8000-000000000011',
 to_char((date_trunc('month',now() at time zone 'Asia/Bangkok')-make_interval(months=>n)),'YYYY-MM'),
 0,0,0,0,100,'APPROVED','7ef10000-0000-4000-8000-000000000011'
from generate_series(2,3)n;
insert into public.financial_transactions(id,profile_id,type,amount,status,remaining_amount,effective_date,approved_by,approved_at)
values ('7ef20000-0000-4000-8000-000000000011','7ef10000-0000-4000-8000-000000000011',
 'DEBT',50,'APPROVED',50,(date_trunc('month',now() at time zone 'Asia/Bangkok')-interval '2 months')::date,
 '7ef10000-0000-4000-8000-000000000011',now());
select private.apply_time_tracking_deductions('7ef10000-0000-4000-8000-000000000011',date_trunc('month',now() at time zone 'Asia/Bangkok')::date);
select public.delete_time_tracking_source_permanently('payroll_slip','7ef30000-0000-4000-8000-000000000002');
select extensions.is((select min(applied_month) from public.financial_transactions where parent_debt_id='7ef20000-0000-4000-8000-000000000011'),
 (date_trunc('month',now() at time zone 'Asia/Bangkok')-interval '2 months')::date,
 'deleting a closed slip immediately reallocates debt to the older available wage');
select extensions.is((select count(*) from public.payroll_slips where id='7ef30000-0000-4000-8000-000000000003'),1::bigint,'earlier closed slip is preserved');

-- A pending slip also closes the month; rejecting it must reopen and rebuild.
insert into public.payroll_slips(id,profile_id,month,gross_pay,total_deductions,net_pay,total_days,daily_wage,status,created_by)
values ('7ef30000-0000-4000-8000-000000000004','7ef10000-0000-4000-8000-000000000011',
 to_char((now() at time zone 'Asia/Bangkok')-interval '2 months','YYYY-MM'),0,0,0,0,100,'PENDING','7ef10000-0000-4000-8000-000000000011');
insert into public.financial_transactions(id,profile_id,type,amount,status,remaining_amount,effective_date,approved_by,approved_at)
values ('7ef20000-0000-4000-8000-000000000012','7ef10000-0000-4000-8000-000000000011',
 'WITHDRAWAL',25,'APPROVED',25,(date_trunc('month',now() at time zone 'Asia/Bangkok')-interval '2 months')::date,
 '7ef10000-0000-4000-8000-000000000011',now());
select private.apply_time_tracking_deductions('7ef10000-0000-4000-8000-000000000011',date_trunc('month',now() at time zone 'Asia/Bangkok')::date);
select public.decide_time_tracking_approval_with_payment('payroll_slip','7ef30000-0000-4000-8000-000000000004','REJECTED',null,null);
select extensions.is((select min(applied_month) from public.financial_transactions where parent_debt_id='7ef20000-0000-4000-8000-000000000012'),
 (date_trunc('month',now() at time zone 'Asia/Bangkok')-interval '2 months')::date,
 'rejecting a pending slip also reallocates withdrawals immediately');
create temp table unchanged_children as select id from public.financial_transactions where parent_debt_id is not null and profile_id='7ef10000-0000-4000-8000-000000000011';
select public.decide_time_tracking_approval_with_payment('payroll_slip','7ef30000-0000-4000-8000-000000000004','REJECTED',null,null);
select public.delete_time_tracking_source_permanently('payroll_slip','7ef30000-0000-4000-8000-000000000004');
select extensions.is((select count(*) from unchanged_children c join public.financial_transactions f using(id)),(select count(*) from unchanged_children),'repeated rejection and deleting a rejected slip preserve allocation identities');

-- A failure after deleting the slip must roll back that deletion as well.
insert into public.payroll_slips(id,profile_id,month,gross_pay,total_deductions,net_pay,total_days,daily_wage,status,created_by)
values ('7ef30000-0000-4000-8000-000000000005','7ef10000-0000-4000-8000-000000000011',
 to_char((now() at time zone 'Asia/Bangkok')-interval '2 months','YYYY-MM'),0,0,0,0,100,'PENDING','7ef10000-0000-4000-8000-000000000011');
insert into public.financial_transactions(id,profile_id,type,amount,status,remaining_amount,effective_date,approved_by,approved_at)
values ('7ef20000-0000-4000-8000-000000000013','7ef10000-0000-4000-8000-000000000011',
 'DEBT',10,'APPROVED',10,(date_trunc('month',now() at time zone 'Asia/Bangkok')-interval '2 months')::date,
 '7ef10000-0000-4000-8000-000000000011',now());
select private.apply_time_tracking_deductions('7ef10000-0000-4000-8000-000000000011',date_trunc('month',now() at time zone 'Asia/Bangkok')::date);
create function pg_temp.fail_payroll_settlement() returns trigger language plpgsql as $$
begin
 if old.profile_id='7ef10000-0000-4000-8000-000000000011' then raise exception 'TEST_SETTLEMENT_FAILURE'; end if;
 return old;
end; $$;
create trigger test_payroll_settlement_failure before delete on public.financial_transactions
 for each row execute function pg_temp.fail_payroll_settlement();
select extensions.throws_ok($$select public.delete_time_tracking_source_permanently('payroll_slip','7ef30000-0000-4000-8000-000000000005')$$,
 'P0001','TEST_SETTLEMENT_FAILURE','settlement failure rejects the entire reopening command');
select extensions.is((select count(*) from public.payroll_slips where id='7ef30000-0000-4000-8000-000000000005'),1::bigint,'failed settlement leaves the slip closed');
select extensions.is((select remaining_amount from public.financial_transactions where id='7ef20000-0000-4000-8000-000000000013'),0::numeric,'failed settlement preserves the parent balance');

select * from extensions.finish();
rollback;
