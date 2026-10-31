begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code) values
 ('a7310000-0000-4000-8000-000000000001','Adjustment deletion test','ADJDEL31');
insert into public.profiles(id,phone,name,role,can_access_super_admin_features,daily_wage) values
 ('a7310000-0000-4000-8000-000000000002','0899931002','Adjustment manager','admin',true,0),
 ('a7310000-0000-4000-8000-000000000003','0899931003','Adjustment employee','user',false,0);
insert into public.user_locations(user_id,location_id,is_primary) values
 ('a7310000-0000-4000-8000-000000000003','a7310000-0000-4000-8000-000000000001',true);
insert into public.financial_transactions(id,profile_id,type,amount,remaining_amount,status,effective_date,approved_at,expense_location_id)
 values('a7310000-0000-4000-8000-000000000004','a7310000-0000-4000-8000-000000000003','WITHDRAWAL',1000,1000,'APPROVED',current_date-1,now()-interval '2 days','a7310000-0000-4000-8000-000000000001');
insert into public.report_batches(id,report_no,report_date,sequence_no,location_id,cutoff_at,created_by_user_id,created_by_name,created_by_phone)
 values('a7310000-0000-4000-8000-000000000005','RPT-ADJDEL31',current_date,987651,'a7310000-0000-4000-8000-000000000001',now()-interval '1 day','a7310000-0000-4000-8000-000000000002','Adjustment manager','0899931002');
insert into public.report_items(report_id,location_id,entity_type,entity_id,eligibility_at)
 values('a7310000-0000-4000-8000-000000000005','a7310000-0000-4000-8000-000000000001','financial_transaction','a7310000-0000-4000-8000-000000000004',now()-interval '1 day');
select set_config('request.jwt.claim.sub','a7310000-0000-4000-8000-000000000002',true);
select extensions.lives_ok($$select public.request_time_tracking_withdrawal_adjustment('a7310000-0000-4000-8000-000000000004',1500,null,'outside increase')$$,'outside increase approves without a branch');
select extensions.is(private.latest_withdrawal_target('a7310000-0000-4000-8000-000000000004'),1500::numeric,'outside increase changes effective target');
select extensions.is((select count(*)::int from public.dashboard_money_events where source_type='withdrawal_adjustment' and source_id in (select id from public.financial_transactions where profile_id='a7310000-0000-4000-8000-000000000003')),0,'outside adjustment creates no branch event');
update public.financial_transactions set approved_at=now()-interval '1 hour' where profile_id='a7310000-0000-4000-8000-000000000003' and type='ADJUSTMENT';
select extensions.lives_ok($$select public.request_time_tracking_withdrawal_adjustment('a7310000-0000-4000-8000-000000000004',0,null,'outside zero')$$,'outside decrease to zero approves');
create temporary table adj_ids as select id,amount from public.financial_transactions where profile_id='a7310000-0000-4000-8000-000000000003' and type='ADJUSTMENT';
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'ADJUSTMENT_NOT_LATEST%','cannot delete an earlier adjustment') from adj_ids where amount=1500;
select extensions.lives_ok(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'delete latest zero adjustment') from adj_ids where amount=0;
select extensions.is(private.latest_withdrawal_target('a7310000-0000-4000-8000-000000000004'),1500::numeric,'deleting zero restores the previous target');
select extensions.is((select remaining_amount from public.financial_transactions where id='a7310000-0000-4000-8000-000000000004'),1500::numeric,'deleting zero seeds remaining even without open deduction rows');
select extensions.is((select public.get_withdrawal_adjustment_summaries('a7310000-0000-4000-8000-000000000003')->0->>'latestApprovedAdjustmentId'),(select id::text from adj_ids where amount=1500),'summary moves latest ID backward');
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'%not found%','repeat delete cannot remove the next adjustment') from adj_ids where amount=0;
select set_config('request.jwt.claim.sub','a7310000-0000-4000-8000-000000000003',true);
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'Forbidden','employee cannot delete an approved adjustment') from adj_ids where amount=1500;
select public.request_time_tracking_withdrawal_adjustment('a7310000-0000-4000-8000-000000000004',1200,null,'pending');
select set_config('request.jwt.claim.sub','a7310000-0000-4000-8000-000000000002',true);
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'ADJUSTMENT_PENDING_EXISTS%','pending request blocks deleting its base') from adj_ids where amount=1500;
select public.decide_time_tracking_withdrawal_adjustment(id,'REJECTED',null,null) from public.financial_transactions where parent_debt_id='a7310000-0000-4000-8000-000000000004' and type='ADJUSTMENT' and status='PENDING';
select extensions.lives_ok(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'delete last approved adjustment despite the original report') from adj_ids where amount=1500;
select extensions.is(private.latest_withdrawal_target('a7310000-0000-4000-8000-000000000004'),1000::numeric,'last deletion restores original amount');
select extensions.is(public.report_lock_no(t),'RPT-ADJDEL31','original report remains locked') from public.financial_transactions t where id='a7310000-0000-4000-8000-000000000004';
select extensions.is((public.get_withdrawal_adjustment_summaries('a7310000-0000-4000-8000-000000000003')->0->>'latestApprovedAdjustmentId'),null::text,'rejected history is not an effective latest adjustment');
-- Branch projection, report membership, snapshots, and cash fences.
select public.request_time_tracking_withdrawal_adjustment('a7310000-0000-4000-8000-000000000004',1200,'a7310000-0000-4000-8000-000000000001','branch increase');
create temporary table branch_adj as select id from public.financial_transactions where parent_debt_id='a7310000-0000-4000-8000-000000000004' and type='ADJUSTMENT' and status='APPROVED';
select extensions.is((select count(*)::int from branch_adj),1,'exactly one live approved fixture');
select extensions.is((select count(*)::int from private.dashboard_money_event_projection where source_id=(select id from branch_adj)),1,'branch-backed adjustment has a cash projection');
insert into public.report_items(report_id,location_id,entity_type,entity_id,eligibility_at)
 select 'a7310000-0000-4000-8000-000000000005','a7310000-0000-4000-8000-000000000001','financial_transaction',id,now() from branch_adj;
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'REPORT_LOCKED:RPT-ADJDEL31%','reported adjustment cannot be deleted') from branch_adj;
delete from public.report_items where entity_id=(select id from branch_adj);
-- An older slip is not a dependency of the new approval, even in the source month.
insert into public.payroll_slips(id,profile_id,month,status,created_by,created_at,slip_data)
 values('a7310000-0000-4000-8000-000000000006','a7310000-0000-4000-8000-000000000003',to_char(current_date,'YYYY-MM'),'PENDING','a7310000-0000-4000-8000-000000000002',now()-interval '1 hour','{}');
select extensions.is((select count(*)::int from private.withdrawal_adjustment_blocking_slip((select id from branch_adj))),0,'slip before approval is not a dependency');
update public.payroll_slips set created_at=now()+interval '1 second' where id='a7310000-0000-4000-8000-000000000006';
select extensions.is((select count(*)::int from private.withdrawal_adjustment_blocking_slip((select id from branch_adj))),1,'outstanding-only pending slip after approval blocks');
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'MONTH_CLOSED:%:PAYROLL_SLIP:PENDING:a7310000-0000-4000-8000-000000000006','deletion explains blocking slip ID and month') from branch_adj;
select set_config('app.time_tracking_expense_rpc','true',true);
update public.payroll_slips set status='APPROVED',approved_at=now() where id='a7310000-0000-4000-8000-000000000006';
select extensions.is((select status from private.withdrawal_adjustment_blocking_slip((select id from branch_adj))),'APPROVED','approved snapshot also blocks');
update public.payroll_slips set status='REJECTED' where id='a7310000-0000-4000-8000-000000000006';
select extensions.is((select count(*)::int from private.withdrawal_adjustment_blocking_slip((select id from branch_adj))),0,'rejected slip no longer blocks');
-- Force a failure after deletion to prove cash history and target rollback together.
create function pg_temp.fail_adjustment_rebuild() returns trigger language plpgsql as $$
begin if new.id='a7310000-0000-4000-8000-000000000004' then raise exception 'TEST_REBUILD_FAILURE'; end if; return new; end $$;
create trigger z_test_rebuild_failure before update on public.financial_transactions for each row execute function pg_temp.fail_adjustment_rebuild();
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'TEST_REBUILD_FAILURE','failure after deleting the adjustment rolls back the entire mutation') from branch_adj;
select extensions.is((select count(*)::int from public.financial_transactions where id=(select id from branch_adj)),1,'rollback restores adjustment row');
select extensions.is((select count(*)::int from private.dashboard_money_event_projection where source_id=(select id from branch_adj)),1,'rollback restores branch projection');
drop trigger z_test_rebuild_failure on public.financial_transactions;
select public.start_cash_count_session('a7310000-0000-4000-8000-000000000001');
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'CASH_COUNT_ACTIVE%','cash session blocks branch adjustment deletion') from branch_adj;
select extensions.is((select count(*)::int from public.financial_transactions where id=(select id from branch_adj)),1,'cash-blocked delete leaves latest unchanged');
select public.cancel_cash_count_session(id) from public.cash_count_sessions where location_id='a7310000-0000-4000-8000-000000000001' and status='active';
select extensions.lives_ok(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'branch adjustment deletes after reopening the slip and cash fence') from branch_adj;
select extensions.is((select count(*)::int from private.dashboard_money_event_projection where source_id=(select id from branch_adj)),0,'branch projection removed with adjustment');
select extensions.is((select count(*)::int from public.dashboard_money_events where source_id=(select id from branch_adj) and action='delete'),1,'one branch delete event is retained');
-- Outside-system still respects movement fences on the original branch during rebuild.
select public.request_time_tracking_withdrawal_adjustment('a7310000-0000-4000-8000-000000000004',0,null,'outside zero snapshot');
create temporary table zero_adj as select id from public.financial_transactions where parent_debt_id='a7310000-0000-4000-8000-000000000004' and type='ADJUSTMENT' and status='APPROVED';
insert into public.payroll_slips(profile_id,month,status,created_by,created_at,slip_data)
 values('a7310000-0000-4000-8000-000000000003',to_char(current_date,'YYYY-MM'),'PENDING','a7310000-0000-4000-8000-000000000002',now()+interval '2 seconds',jsonb_build_object('transactions',jsonb_build_array(jsonb_build_object('id','a7310000-0000-4000-8000-000000000004','type','WITHDRAWAL','amount',1000))));
select extensions.is((select count(*)::int from private.withdrawal_adjustment_blocking_slip((select id from zero_adj))),1,'zero target omitted from printable rows still blocks through outstanding snapshot');
select extensions.is((select slip_data->'transactions' from public.payroll_slips where profile_id='a7310000-0000-4000-8000-000000000003' and status='PENDING'),'[]'::jsonb,'zero source is absent from printable rows');
update public.payroll_slips set status='REJECTED' where profile_id='a7310000-0000-4000-8000-000000000003' and status='PENDING';
select public.start_cash_count_session('a7310000-0000-4000-8000-000000000001');
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'CASH_COUNT_ACTIVE%','outside delete still respects the original branch cash fence') from zero_adj;
select public.cancel_cash_count_session(id) from public.cash_count_sessions where location_id='a7310000-0000-4000-8000-000000000001' and status='active';
select extensions.lives_ok(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'outside deletion succeeds after the branch fence opens') from zero_adj;

-- Pending employee request may be approved outside-system; settlement identity remains source history.
select set_config('request.jwt.claim.sub','a7310000-0000-4000-8000-000000000003',true);
select public.request_time_tracking_withdrawal_adjustment('a7310000-0000-4000-8000-000000000004',1100,null,'approve outside');
select set_config('request.jwt.claim.sub','a7310000-0000-4000-8000-000000000002',true);
select extensions.lives_ok(format('select public.decide_time_tracking_withdrawal_adjustment(%L,''APPROVED'',null,null)',id),'manager approves an employee request outside-system') from public.financial_transactions where parent_debt_id='a7310000-0000-4000-8000-000000000004' and type='ADJUSTMENT' and status='PENDING';
update public.financial_transactions set approved_at=now()-interval '1 hour' where parent_debt_id='a7310000-0000-4000-8000-000000000004' and type='ADJUSTMENT' and status='APPROVED';
select public.request_time_tracking_withdrawal_adjustment('a7310000-0000-4000-8000-000000000004',1200,'a7310000-0000-4000-8000-000000000001','branch scope test');
create temporary table scope_adj as select id from public.financial_transactions where parent_debt_id='a7310000-0000-4000-8000-000000000004' and type='ADJUSTMENT' and status='APPROVED' and amount=1200;
insert into public.locations(id,name,code) values('a7310000-0000-4000-8000-000000000008','Delegated adjustment scope','ADJDEL32');
insert into public.profiles(id,phone,name,role,can_manage_time_payroll) values('a7310000-0000-4000-8000-000000000007','0899931007','Delegated adjustment manager','admin',true);
update public.user_locations set location_id='a7310000-0000-4000-8000-000000000008' where user_id='a7310000-0000-4000-8000-000000000003';
insert into public.user_locations(user_id,location_id,is_primary) values('a7310000-0000-4000-8000-000000000007','a7310000-0000-4000-8000-000000000008',true);
select set_config('request.jwt.claim.sub','a7310000-0000-4000-8000-000000000007',true);
select extensions.ok(private.can_manage_time_payroll_profile('a7310000-0000-4000-8000-000000000003'),'delegated manager can manage the employee primary branch');
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'Existing expense location access denied','employee access does not grant deletion of another paying branch') from scope_adj;
select set_config('request.jwt.claim.sub','a7310000-0000-4000-8000-000000000002',true);
select public.save_cash_count_alert_group(null,array['a7310000-0000-4000-8000-000000000001']::uuid[],1,true,1,2);
update public.cash_count_alert_members set joined_at=now()-interval '6 days' where location_id='a7310000-0000-4000-8000-000000000001';
select extensions.throws_like(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'CASH_COUNT_OVERDUE_LOCKED%','overdue branch guard blocks deletion without bypass') from scope_adj;
select extensions.is((select count(*)::int from public.financial_transactions where id=(select id from scope_adj)),1,'overdue failure preserves latest adjustment');
select public.unlock_cash_count_overdue('a7310000-0000-4000-8000-000000000001');
select extensions.lives_ok(format('select public.delete_time_tracking_source_permanently(''transaction'',%L)',id),'existing temporary unlock permits deletion') from scope_adj;
select extensions.ok(not has_function_privilege('authenticated','private.delete_withdrawal_adjustment(uuid)','execute'),'authenticated cannot bypass public delete boundary');
select extensions.ok(not has_function_privilege('authenticated','private.rebuild_open_withdrawal_deductions(uuid,uuid,uuid,uuid)','execute'),'authenticated cannot call source-based internal rebuild');

select * from extensions.finish();
rollback;
