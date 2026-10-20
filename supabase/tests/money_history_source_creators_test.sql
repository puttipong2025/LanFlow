begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
insert into public.locations(id,name,code,is_active) values
 ('a2000000-0000-4000-8000-000000000001','Creator branch','CR20',true),
 ('a2000000-0000-4000-8000-000000000002','Creator target','CR20B',true);
insert into public.profiles(id,phone,name,role,is_active) values
 ('b2000000-0000-4000-8000-000000000001','0892000001','Original creator','admin',true),
 ('b2000000-0000-4000-8000-000000000002','0892000002','Approver only','admin',true),
 ('b2000000-0000-4000-8000-000000000003','0892000003','Employee paid','user',true);
insert into public.user_locations(user_id,location_id,is_primary) values
 ('b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',true),
 ('b2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
insert into public.income_expense(
 id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,
 location_id,type,number,tx_date,title,cost,bill_option,created_by_user_id,created_by_name,created_by_phone
) values(
 'c2000000-0000-4000-8000-000000000001','CR20-IE','CR20-IE','CR20-IE','CR20-IE','synced','active',
 'a2000000-0000-4000-8000-000000000001','expense','CR20-IE',current_date,'Creator IE',10,'ค่าใช้จ่าย',
 'b2000000-0000-4000-8000-000000000001','Original creator','0892000001'
);
set constraints all immediate;
set constraints all deferred;
insert into public.rubber_bills(
 id,client_temp_id,local_bill_no,server_bill_no,idempotency_key,sync_status,record_status,
 location_id,bill_no,bill_date,customer_name,bill_type,weight,rubber_value,average_price,
 deduction_total,net_total,created_by_user_id,created_by_name,created_by_phone
) values (
 'c2000000-0000-4000-8000-000000000002','CR20-RB','CR20-RB','CR20-RB','CR20-RB','synced','active',
 'a2000000-0000-4000-8000-000000000001','CR20-RB',current_date,'Creator customer','weighing',10,100,10,
 0,100,'b2000000-0000-4000-8000-000000000001','Original creator','0892000001'
);
insert into public.financial_transactions(id,profile_id,type,amount,effective_date) values
 ('c2000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000003','WITHDRAWAL',20,current_date);
select extensions.is((select history_creator_user_id from public.financial_transactions where id='c2000000-0000-4000-8000-000000000003'),
 'b2000000-0000-4000-8000-000000000001'::uuid,'withdrawal captures actual creator rather than employee paid');
insert into public.financial_transactions(id,profile_id,type,amount,adjustment_base_amount,parent_debt_id,effective_date) values
 ('c2000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000003','ADJUSTMENT',25,20,'c2000000-0000-4000-8000-000000000003',current_date);
insert into public.payroll_slips(id,profile_id,month,gross_pay,total_deductions,net_pay,total_days,daily_wage,slip_data,created_by)
values ('c2000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000003',to_char(current_date,'YYYY-MM'),100,0,100,1,100,'{}','b2000000-0000-4000-8000-000000000001');
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000002',true);
update public.income_expense set cost=11 where id='c2000000-0000-4000-8000-000000000001';
set constraints all immediate;
select extensions.is((select actor_user_id from public.dashboard_money_events where source_id='c2000000-0000-4000-8000-000000000001' and action='update'),
 'b2000000-0000-4000-8000-000000000002'::uuid,'actual actor remains approver/editor in audit fields');
select extensions.is((select creator_user_id from public.dashboard_money_events where source_id='c2000000-0000-4000-8000-000000000001' and action='update'),
 'b2000000-0000-4000-8000-000000000001'::uuid,'update event retains original source creator');
select extensions.is(private.money_history_source_creator('rubber_bill','c2000000-0000-4000-8000-000000000002')->>'creatorName','Original creator','rubber bill uses original payer/creator');
select extensions.is(private.money_history_source_creator('payroll_slip','c2000000-0000-4000-8000-000000000005')->>'creatorName','Original creator','payroll uses created_by, not employee or approver');
select extensions.is(private.money_history_source_creator('withdrawal_adjustment','c2000000-0000-4000-8000-000000000004')->>'creatorName','Original creator','adjustment uses creator');
insert into public.money_transfers(id,client_temp_id,idempotency_key,location_id,target_location_id,
 target_location_name,net_amount_to_pay,transfer_type,transfer_method,transfer_status,record_status,
 created_by_user_id,created_by_name,created_by_phone) values (
 'c2000000-0000-4000-8000-000000000006','CR20-MT','CR20-MT','a2000000-0000-4000-8000-000000000001',
 'a2000000-0000-4000-8000-000000000002','Creator target',10,'branch','bank','paid','active',
 'b2000000-0000-4000-8000-000000000001','Original creator','0892000001');
select extensions.is(private.money_history_source_creator('money_transfer','c2000000-0000-4000-8000-000000000006')->>'creatorName','Original creator','bank transfer uses source creator rather than current actor');
select extensions.is(private.money_history_source_creator('cash_transfer','c2000000-0000-4000-8000-000000000006')->>'creatorName','Original creator','cash-transfer attribution resolves parent creator rather than receiver');
insert into public.rubber_exports(id,export_no,export_date,sequence_no,location_id,status,
 original_weight_total,paid_total,rubber_value_total,average_price,current_weight,weight_loss_percent,
 work_rate,other_operating_cost,work_total,expense_destination,created_by_user_id,created_by_name,created_by_phone,
 verified_by_user_id,verified_by_name,verified_by_phone,verified_at,age_cutoff_at,average_age_hours,oldest_age_hours,estimated_age_item_count)
values ('c2000000-0000-4000-8000-000000000007','CR20-REX',current_date,1,'a2000000-0000-4000-8000-000000000001','verified',
 10,100,100,10,10,0,0,0,0,'branch','b2000000-0000-4000-8000-000000000001','Original creator','0892000001',
 'b2000000-0000-4000-8000-000000000002','Approver only','0892000002',now(),now(),0,0,0);
select extensions.is(private.money_history_source_creator('rubber_export','c2000000-0000-4000-8000-000000000007')->>'creatorName','Original creator','rubber export uses creator, never verifier');
update public.financial_transactions set history_creator_user_id='b2000000-0000-4000-8000-000000000002',history_creator_name='Approver only'
where id='c2000000-0000-4000-8000-000000000003';
select extensions.is(private.money_history_source_creator('withdrawal','c2000000-0000-4000-8000-000000000003')->>'creatorName','Original creator','later editor cannot replace creator snapshot');

set local role authenticated;
select extensions.ok((select bool_and(row->>'actorName'='Original creator') from jsonb_array_elements(public.get_dashboard_money_history('a2000000-0000-4000-8000-000000000001')->'rows') row),'overview displays source creators for all actions');
select extensions.ok(jsonb_array_length(public.get_operator_money_history('b2000000-0000-4000-8000-000000000001')->'rows')>=2,'creator filter includes events performed by a different approver');
select extensions.is((public.get_operator_money_history('b2000000-0000-4000-8000-000000000002')->'counts'->>'all')::int,0,'approver is not offered events they did not create');
select extensions.ok(not exists(select 1 from jsonb_array_elements(public.get_operator_money_history()->'actors') item where item->>'key'='b2000000-0000-4000-8000-000000000002'),'creator options exclude approver-only account');
reset role;

-- Deletion keeps creator through projection snapshot, after source row has disappeared.
delete from public.income_expense where id='c2000000-0000-4000-8000-000000000001';
set constraints all immediate;
select extensions.is((select creator_name from public.dashboard_money_events where source_id='c2000000-0000-4000-8000-000000000001' and action='delete'),'Original creator','hard-delete event preserves source creator');
select extensions.is(private.money_history_source_creator('income_expense','c2000000-0000-4000-8000-000000000001')->>'creatorName','Original creator','creator remains known after projection reconciliation');
select extensions.is(private.money_history_source_creator('income_expense','c2000000-0000-4000-8000-000000000099')->>'creatorName','ไม่ทราบผู้สร้างรายการ','missing legacy source never falls back to current actor');
select extensions.is((select count(*)::int from public.dashboard_money_events where source_id='c2000000-0000-4000-8000-000000000001'),3,'creator snapshot does not fabricate extra business events');
insert into public.profiles(id,phone,name,role,is_active) values
 ('b2000000-0000-4000-8000-000000000004','0892000004','Deleted creator snapshot','admin',true);
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000004',true);
insert into public.financial_transactions(id,profile_id,type,amount,effective_date) values
 ('c2000000-0000-4000-8000-000000000008','b2000000-0000-4000-8000-000000000003','WITHDRAWAL',10,current_date);
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000002',true);
delete from public.profiles where id='b2000000-0000-4000-8000-000000000004';
select extensions.is(private.money_history_source_creator('withdrawal','c2000000-0000-4000-8000-000000000008')->>'creatorUserId',null::text,'deleted creator account is not reused as a foreign key');
select extensions.is(private.money_history_source_creator('withdrawal','c2000000-0000-4000-8000-000000000008')->>'creatorName','Deleted creator snapshot','creator name survives account removal without replacing it with approver');
select extensions.is((select history_creator_name from public.payroll_slips where id='c2000000-0000-4000-8000-000000000005'),'Original creator','payroll stores creator name for native page');
update public.profiles set name='Renamed creator' where id='b2000000-0000-4000-8000-000000000001';
update public.payroll_slips set history_creator_name='Approver only' where id='c2000000-0000-4000-8000-000000000005';
select extensions.is((select history_creator_name from public.payroll_slips where id='c2000000-0000-4000-8000-000000000005'),'Original creator','payroll creator snapshot survives profile rename and later editor');
select extensions.is(private.money_history_source_creator('payroll_slip','c2000000-0000-4000-8000-000000000005')->>'creatorName','Original creator','overview and native payroll use same creator snapshot');
select * from extensions.finish();
rollback;
