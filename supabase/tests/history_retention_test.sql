begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(21);

select extensions.is(
  (select retention_days from public.history_retention_settings where singleton),
  15,
  'temporary history retention defaults to 15 Bangkok calendar days'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_history_retention_overview(integer)', 'execute'),
  'authenticated callers can reach the manager-guarded preview RPC'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.save_history_retention_settings(integer,timestamp with time zone)', 'execute'),
  'anonymous callers cannot change retention'
);

insert into public.locations(id, name, code, is_active)
values ('51000000-0000-4000-8000-000000000001', 'pgTAP Retention', 'RET1', true);
insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values
  ('52000000-0000-4000-8000-000000000001', '0895000001', 'pgTAP retention manager', 'admin', true, true),
  ('52000000-0000-4000-8000-000000000002', '0895000002', 'pgTAP ordinary admin', 'admin', true, false);
insert into public.user_locations(user_id, location_id, is_primary)
values
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', true),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', true);

insert into public.dashboard_money_events(
  id, location_id, source_type, source_id, event_key, action, kind,
  number, title, direction, amount, actor_name, occurred_at, event_date
) values (
  '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001',
  'income_expense', '54000000-0000-4000-8000-000000000001', 'old-event', 'delete',
  'expense', 'OLD-1', 'old event', 'expense', 10, 'tester', now() - interval '5 days',
  (now() at time zone 'Asia/Bangkok')::date - 5
);
insert into public.time_tracking_audit_logs(
  id, admin_id, action, target_table, record_id, new_data, comment, created_at
) values (
  '53000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001',
  'SET_PAYROLL_ACTIVE_PERIOD', 'time_payroll_active_periods',
  '52000000-0000-4000-8000-000000000002',
  jsonb_build_object('action', 'END', 'selectedEffectiveOn', ((now() at time zone 'Asia/Bangkok')::date - 5)),
  'old END boundary', now() - interval '5 days'
);
insert into public.admin_account_audit_logs(
  id, request_id, actor_user_id, target_user_id, action, status, created_at
) values (
  '53000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000002',
  'password_reset', 'pending', now() - interval '2 days'
);
insert into public.stock_product_approval_requests(
  id, request_status, request_type, request_idempotency_key, requested_payload,
  product_name, unit, create_sale_item, requested_by_user_id, requested_by_name,
  requested_by_phone, decided_by_user_id, decided_by_name, decided_by_phone,
  decided_at, created_at, updated_at
) values (
  '53000000-0000-4000-8000-000000000004', 'rejected', 'create_product', 'expired-request-key',
  '{"name":"old"}'::jsonb, 'old product', 'ชิ้น', false,
  '52000000-0000-4000-8000-000000000002', 'ordinary', '0895000002',
  '52000000-0000-4000-8000-000000000001', 'manager', '0895000001',
  now() - interval '5 days', now() - interval '5 days', now() - interval '5 days'
);
insert into public.income_expense(
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, type, number, tx_date, title, cost,
  revision_no, deleted_at, created_by_user_id, created_by_name, created_by_phone
) values (
  '54000000-0000-4000-8000-000000000001', 'deleted-ie-client', 'IE-L-1', 'IE-S-1', 'deleted-ie-key',
  'synced', 'deleted', '51000000-0000-4000-8000-000000000001', 'expense', 'IE-S-1',
  (now() at time zone 'Asia/Bangkok')::date - 20, 'deleted income expense', 100,
  2, now() - interval '20 days', '52000000-0000-4000-8000-000000000002', 'ordinary', '0895000002'
);
insert into public.rubber_bills(
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date, customer_name,
  bill_type, weight, rubber_value, average_price, deduction_total, net_total,
  revision_no, deleted_at, created_by_user_id, created_by_name, created_by_phone
) values (
  '54000000-0000-4000-8000-000000000002', 'deleted-rb-client', 'RB-L-1', 'RB-S-1', 'deleted-rb-key',
  'synced', 'deleted', '51000000-0000-4000-8000-000000000001', 'RB-S-1',
  (now() at time zone 'Asia/Bangkok')::date - 20, 'deleted customer', 'weighing',
  10, 100, 10, 0, 100, 2, now() - interval '20 days',
  '52000000-0000-4000-8000-000000000002', 'ordinary', '0895000002'
);
set constraints all immediate;

select extensions.ok(
  exists(select 1 from private.time_payroll_employment_boundaries where profile_id = '52000000-0000-4000-8000-000000000002'),
  'an END audit writes the durable employment boundary before audit cleanup'
);

select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"52000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.get_history_retention_overview(1)$$,
  'P0001',
  'FORBIDDEN: ไม่มีสิทธิ์จัดการระยะเก็บประวัติ',
  'an ordinary Admin cannot preview global retention'
);
reset role;

select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.is(
  (public.get_history_retention_overview(1) ->> 'requestedDays')::integer,
  1,
  'a System Manager can preview a one-day retention value'
);
select extensions.ok(
  (public.get_history_retention_overview(1) ->> 'totalEligible')::bigint >= 3,
  'preview counts old temporary history before deletion'
);
select public.save_history_retention_settings(
  1,
  (select updated_at from public.history_retention_settings where singleton)
);
select extensions.is(
  (select count(*) from public.dashboard_money_events where id = '53000000-0000-4000-8000-000000000001'),
  0::bigint,
  'lowering retention hides out-of-window Dashboard history immediately'
);
reset role;

do $cleanup$
declare
  v_result jsonb;
begin
  for v_attempt in 1..20 loop
    v_result := private.cleanup_history_retention(1000);
    exit when not coalesce((v_result ->> 'hasMore')::boolean, true);
  end loop;
  if coalesce((v_result ->> 'hasMore')::boolean, true) then
    raise exception 'TEST_CLEANUP_DID_NOT_DRAIN';
  end if;
end
$cleanup$;

select extensions.is(
  (select retention_days from public.history_retention_settings where singleton),
  1,
  'the confirmed value is saved'
);
select extensions.is(
  (select count(*) from public.history_retention_change_audits where new_retention_days = 1),
  1::bigint,
  'a permanent minimal setting-change audit is written'
);
select extensions.is(
  (select count(*) from public.dashboard_money_events where id = '53000000-0000-4000-8000-000000000001'),
  0::bigint,
  'old Dashboard event history is deleted'
);
select extensions.is(
  (select count(*) from public.time_tracking_audit_logs where id = '53000000-0000-4000-8000-000000000002'),
  0::bigint,
  'old Time Payroll audit history is deleted'
);
select extensions.ok(
  exists(select 1 from private.time_payroll_employment_boundaries where profile_id = '52000000-0000-4000-8000-000000000002'),
  'the durable employment boundary survives audit deletion'
);
select extensions.is(
  (select status from public.admin_account_audit_logs where id = '53000000-0000-4000-8000-000000000003'),
  'unknown',
  'a password-reset audit pending over 24 hours becomes unknown before retention'
);
select extensions.is(
  (select count(*) from public.stock_product_approval_requests where id = '53000000-0000-4000-8000-000000000004'),
  0::bigint,
  'old terminal approval history is deleted'
);
select extensions.ok(
  exists(select 1 from private.approval_request_replay_guards where workflow = 'stock_product' and request_key = 'expired-request-key'),
  'terminal approval cleanup preserves a payload-free replay guard'
);
select extensions.is(
  (select count(*) from public.income_expense where id = '54000000-0000-4000-8000-000000000001'),
  1::bigint,
  'deleted Income Expense business tombstones are retained'
);
select extensions.is(
  (select count(*) from public.rubber_bills where id = '54000000-0000-4000-8000-000000000002'),
  1::bigint,
  'deleted Rubber Bill business tombstones are retained'
);
select extensions.is(
  (select count(*) from cron.job where jobname = 'lanflow-temporary-history-retention'),
  1::bigint,
  'one daily unified retention job is scheduled'
);
select extensions.is(
  (select schedule from cron.job where jobname = 'lanflow-temporary-history-retention'),
  '10 17 * * *',
  'daily cleanup runs at 00:10 Asia Bangkok'
);
select extensions.ok(
  to_regprocedure('private.prune_dashboard_money_events()') is null,
  'the superseded Dashboard-only cleanup function is removed'
);

select * from extensions.finish();
rollback;
