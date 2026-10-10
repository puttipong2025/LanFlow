begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations (id, name, code, is_active) values
  ('81000000-0000-4000-8000-000000000001', 'Branch Receipt Target', 'BRT', true),
  ('81000000-0000-4000-8000-000000000002', 'Branch Receipt Other', 'BRO', true);

insert into public.profiles (id, phone, name, role, is_active, can_access_money_transfer, can_access_super_admin_features) values
  ('82000000-0000-4000-8000-000000000001', '0898200001', 'Branch Transfer Creator', 'admin', true, true, false),
  ('82000000-0000-4000-8000-000000000002', '0898200002', 'Branch Transfer Receiver', 'admin', true, false, false),
  ('82000000-0000-4000-8000-000000000003', '0898200003', 'Unrelated Receiver', 'admin', true, false, false),
  ('82000000-0000-4000-8000-000000000004', '0898200004', 'System Manager', 'admin', true, true, true);

insert into public.user_locations (user_id, location_id, is_primary) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', true),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', false),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', true),
  ('82000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', true),
  ('82000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', true);

insert into public.money_transfers (
  id, client_temp_id, idempotency_key, location_id, target_location_id,
  target_location_name, net_amount_to_pay, transfer_type, transfer_status,
  created_by_user_id, created_by_name, created_by_phone, accounting_date,
  created_at, updated_at
) values (
  '83000000-0000-4000-8000-000000000090',
  'branch-receipt-legacy', 'branch-receipt-legacy',
  '81000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001',
  'Branch Receipt Target', 50,
  'branch', 'paid',
  '82000000-0000-4000-8000-000000000001',
  'Branch Transfer Creator', '0898200001', '2020-01-01',
  '2020-01-01 00:00:00+07', '2020-01-01 00:00:00+07'
);

select extensions.throws_like($$
  update public.money_transfers
  set branch_receipt_status = 'pending_receipt'
  where id = '83000000-0000-4000-8000-000000000090'
$$, '%money_transfers_branch_receipt_contract_check%', 'legacy rows cannot carry partial receipt-contract state');
update public.money_transfers
set branch_receipt_status = null
where id = '83000000-0000-4000-8000-000000000090';

select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select extensions.throws_like($$
  select public.request_branch_money_transfer_delete(
    '83000000-0000-4000-8000-000000000090', 0
  )
$$, 'MT_LEGACY_BRANCH_READ_ONLY:%', 'legacy branch transfers remain read-only through the deletion-request RPC');

reset role;
delete from public.branch_transfer_delete_requests
where transfer_id = '83000000-0000-4000-8000-000000000090';
set local role authenticated;

select extensions.throws_like($$
  select public.save_money_transfer(jsonb_build_object(
    'id', '83000000-0000-4000-8000-000000000099',
    'clientTempId', 'branch-old-client',
    'idempotencyKey', 'branch-old-client',
    'operation', 'create',
    'locationId', '81000000-0000-4000-8000-000000000001',
    'targetLocationId', '81000000-0000-4000-8000-000000000001',
    'transferType', 'branch',
    'slips', '[]'::jsonb,
    'items', '[]'::jsonb
  ))
$$, 'MT_CLIENT_REFRESH_REQUIRED:%', 'an old client cannot bypass the receipt contract');

select public.save_money_transfer(jsonb_build_object(
  'id', '83000000-0000-4000-8000-000000000001',
  'clientTempId', 'branch-receipt-1',
  'idempotencyKey', 'branch-receipt-1',
  'operation', 'create',
  'receiptContractVersion', 1,
  'locationId', '81000000-0000-4000-8000-000000000001',
  'targetLocationId', '81000000-0000-4000-8000-000000000001',
  'transferType', 'branch',
  'createdByName', 'Branch Transfer Creator',
  'createdByPhone', '0898200001',
  'slips', jsonb_build_array(jsonb_build_object(
    'id', '84000000-0000-4000-8000-000000000001',
    'amount', 123.45,
    'fee', 0,
    'transactionDate', statement_timestamp() - interval '1 minute',
    'inputMethod', 'manual',
    'sortOrder', 0
  )),
  'items', '[]'::jsonb
));

select extensions.is(
  (select branch_receipt_status from public.money_transfers where id = '83000000-0000-4000-8000-000000000001'),
  'pending_receipt',
  'a new branch transfer starts pending receipt'
);
select extensions.is(
  (select accounting_date from public.money_transfers where id = '83000000-0000-4000-8000-000000000001'),
  null::date,
  'pending receipt has no accounting date'
);
select extensions.is(
  (select virtual_status from jsonb_to_recordset(
    public.get_money_transfer_list('81000000-0000-4000-8000-000000000001', 'all', '', null, null, 50)->'rows'
  ) as row(virtual_status text) limit 1),
  'branch_pending_receipt',
  'money transfer list exposes the virtual pending status'
);

select public.save_money_transfer(jsonb_build_object(
  'id', '83000000-0000-4000-8000-000000000002',
  'clientTempId', 'branch-move-1', 'idempotencyKey', 'branch-move-1',
  'operation', 'create', 'receiptContractVersion', 1,
  'locationId', '81000000-0000-4000-8000-000000000001',
  'targetLocationId', '81000000-0000-4000-8000-000000000001',
  'transferType', 'branch', 'createdByName', 'Branch Transfer Creator', 'createdByPhone', '0898200001',
  'slips', jsonb_build_array(jsonb_build_object(
    'id', '84000000-0000-4000-8000-000000000002', 'amount', 10, 'fee', 0,
    'transactionDate', statement_timestamp() - interval '1 minute', 'inputMethod', 'manual', 'sortOrder', 0
  )), 'items', '[]'::jsonb
));
select public.save_money_transfer(jsonb_build_object(
  'id', '83000000-0000-4000-8000-000000000002',
  'clientTempId', 'branch-move-1', 'idempotencyKey', 'branch-move-1',
  'operation', 'update', 'revisionNo', 0, 'receiptContractVersion', 1,
  'locationId', '81000000-0000-4000-8000-000000000002',
  'targetLocationId', '81000000-0000-4000-8000-000000000002',
  'transferType', 'branch', 'createdByName', 'Branch Transfer Creator', 'createdByPhone', '0898200001',
  'slips', jsonb_build_array(jsonb_build_object(
    'id', '84000000-0000-4000-8000-000000000002', 'amount', 10, 'fee', 0,
    'transactionDate', statement_timestamp() - interval '1 minute', 'inputMethod', 'manual', 'sortOrder', 0
  )), 'items', '[]'::jsonb
));
select extensions.is(
  (select location_id from public.money_transfers where id = '83000000-0000-4000-8000-000000000002'),
  '81000000-0000-4000-8000-000000000002'::uuid,
  'a pending target change moves ownership atomically to the new branch'
);
select extensions.is(
  (select branch_receipt_status from public.money_transfers where id = '83000000-0000-4000-8000-000000000002'),
  'pending_receipt',
  'a target change remains pending and does not synthesize receipt data'
);

select public.save_money_transfer(jsonb_build_object(
  'id', '83000000-0000-4000-8000-000000000003',
  'clientTempId', 'branch-delete-owner-1', 'idempotencyKey', 'branch-delete-owner-1',
  'operation', 'create', 'receiptContractVersion', 1,
  'locationId', '81000000-0000-4000-8000-000000000001',
  'targetLocationId', '81000000-0000-4000-8000-000000000001',
  'transferType', 'branch', 'createdByName', 'Branch Transfer Creator', 'createdByPhone', '0898200001',
  'slips', jsonb_build_array(jsonb_build_object(
    'id', '84000000-0000-4000-8000-000000000003', 'amount', 10, 'fee', 0,
    'transactionDate', statement_timestamp() - interval '1 minute', 'inputMethod', 'manual', 'sortOrder', 0
  )), 'items', '[]'::jsonb
));

reset role;
update public.money_transfers
set created_at = case id
  when '83000000-0000-4000-8000-000000000001' then '2026-10-09 09:00:00+07'::timestamptz
  when '83000000-0000-4000-8000-000000000003' then '2026-10-09 10:00:00+07'::timestamptz
end
where id in (
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000003'
);
set local role authenticated;
select extensions.is(
  (public.get_pending_branch_money_transfers(
    '81000000-0000-4000-8000-000000000001', 1
  )->'rows'->0->>'id'),
  '83000000-0000-4000-8000-000000000001',
  'the bounded receipt queue exposes the oldest pending transfer first'
);

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_like($$
  select public.delete_money_transfer('83000000-0000-4000-8000-000000000001', 0)
$$, 'MONEY_TRANSFER_DELETE_FORBIDDEN', 'the generic delete RPC rejects users without money-transfer access before exposing branch state');

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_like($$
  select public.delete_money_transfer('83000000-0000-4000-8000-000000000003', 0)
$$, 'MT_DELETE_CREATOR_ONLY:%', 'a non-creator cannot bypass creator-only deletion through the generic RPC');

reset role;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.lives_ok($$
  select public.request_branch_money_transfer_delete('83000000-0000-4000-8000-000000000003', 0)
  where exists (
    select 1 from public.money_transfers
    where id = '83000000-0000-4000-8000-000000000003'
      and record_status <> 'deleted'
  )
$$, 'the creator can delete a pending transfer before receipt');

reset role;
select extensions.is(
  ((private.calculate_dashboard_summary('81000000-0000-4000-8000-000000000001')->'cashToday'->>'income')::numeric),
  0::numeric,
  'pending branch money is absent from the dashboard'
);
select extensions.is(
  (
    select count(*)
    from jsonb_array_elements(
      public.get_dashboard_overview(
        '81000000-0000-4000-8000-000000000001', null, null, 50
      )->'rows'
    ) as row_data
    where row_data->>'id' = 'branch-transfer-in:83000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'pending branch money is absent from the legacy dashboard overview route'
);
select extensions.ok(
  not private.money_transfer_is_financially_effective(
    (select transfer from public.money_transfers transfer where id = '83000000-0000-4000-8000-000000000001')
  ),
  'the canonical predicate excludes pending branch money'
);
select extensions.is(
  (select item_count from private.report_creation_blockers(
    '81000000-0000-4000-8000-000000000001', statement_timestamp()
  ) where blocker_key = 'branch_transfer_receipt_pending'),
  1::bigint,
  'a pending receipt blocks normal report creation'
);

select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select extensions.is(
  (select count(*) from public.get_actionable_badge_counts()
    where location_id = '81000000-0000-4000-8000-000000000001'
      and module_id = 'cash'),
  0::bigint,
  'an unrelated branch user cannot see the target branch pending-receipt badge'
);
select extensions.throws_like($$
  select public.receive_branch_money_transfer('83000000-0000-4000-8000-000000000001', 0)
$$, 'MT_LOCATION_DENIED:%', 'a user outside the target branch cannot confirm');
reset role;

select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select extensions.is(
  (public.get_pending_branch_money_transfers('81000000-0000-4000-8000-000000000001')->>'total')::integer,
  1,
  'an Income/Expense-only target user sees the pending queue'
);
select extensions.throws_like($$
  select public.receive_branch_money_transfer('83000000-0000-4000-8000-000000000001', 99)
$$, 'MT_REVISION_CONFLICT:%', 'confirmation rejects a stale revision');
select public.receive_branch_money_transfer('83000000-0000-4000-8000-000000000001', 0);

select extensions.is(
  (select branch_receipt_status from public.money_transfers where id = '83000000-0000-4000-8000-000000000001'),
  'received',
  'target user confirms the transfer'
);
select extensions.is(
  (select branch_received_by_user_id from public.money_transfers where id = '83000000-0000-4000-8000-000000000001'),
  '82000000-0000-4000-8000-000000000002'::uuid,
  'confirmation stores the receiver identity'
);
select extensions.is(
  (select accounting_date from public.money_transfers where id = '83000000-0000-4000-8000-000000000001'),
  (statement_timestamp() at time zone 'Asia/Bangkok')::date,
  'confirmation assigns the Bangkok accounting date on the server'
);
select extensions.is(
  (public.receive_branch_money_transfer('83000000-0000-4000-8000-000000000001', 0)->>'idempotentReplay')::boolean,
  true,
  'a repeated confirmation is idempotent even with the old revision'
);
reset role;

select extensions.ok(
  private.money_transfer_is_financially_effective(
    (select transfer from public.money_transfers transfer where id = '83000000-0000-4000-8000-000000000001')
  ),
  'the canonical predicate includes received branch money'
);
select extensions.is(
  ((private.calculate_dashboard_summary('81000000-0000-4000-8000-000000000001')->'cashToday'->>'income')::numeric),
  123.45::numeric,
  'received branch money appears on the dashboard once'
);
select extensions.is(
  (select count(*) from private.report_creation_blockers(
    '81000000-0000-4000-8000-000000000001', statement_timestamp()
  ) where blocker_key = 'branch_transfer_receipt_pending'),
  0::bigint,
  'confirmation clears the report blocker'
);

update public.money_transfers
set created_by_user_id = null
where id = '83000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.throws_like($$
  select public.request_branch_money_transfer_delete('83000000-0000-4000-8000-000000000001', 1)
$$, 'MT_DELETE_CREATOR_ONLY:%', 'a missing creator identity fails closed instead of authorizing deletion');
reset role;
update public.money_transfers
set created_by_user_id = '82000000-0000-4000-8000-000000000001'
where id = '83000000-0000-4000-8000-000000000001';
set local role authenticated;
select extensions.throws_like($$
  select public.request_branch_money_transfer_delete('83000000-0000-4000-8000-000000000001', null)
$$, 'MT_INVALID_PAYLOAD:%', 'a deletion request cannot bypass revision control with a null revision');
select extensions.throws_like($$
  select public.delete_money_transfer('83000000-0000-4000-8000-000000000001', 1)
$$, 'MT_BRANCH_DELETE_REQUEST_REQUIRED:%', 'received branch money cannot bypass deletion approval');
select extensions.is(
  (public.request_branch_money_transfer_delete('83000000-0000-4000-8000-000000000001', 1)->>'status'),
  'pending_approval',
  'the creator can submit a received-transfer deletion request'
);
reset role;

select extensions.is(
  (select item_count from private.report_creation_blockers(
    '81000000-0000-4000-8000-000000000001', statement_timestamp()
  ) where blocker_key = 'branch_transfer_delete_pending'),
  1::bigint,
  'a pending branch deletion blocks reports and cash count'
);

select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select public.decide_branch_transfer_delete_request(
  (select id from public.branch_transfer_delete_requests where request_status = 'pending'),
  'approved',
  null
);
reset role;
select extensions.is(
  (select record_status::text from public.money_transfers where id = '83000000-0000-4000-8000-000000000001'),
  'deleted',
  'manager approval uses the atomic money-transfer deletion path'
);

insert into public.money_transfers (
  id, client_temp_id, idempotency_key, location_id, target_location_id,
  target_location_name, net_amount_to_pay, transfer_type, transfer_status,
  created_by_user_id, created_by_name, created_by_phone, accounting_date,
  branch_receipt_contract_version, branch_receipt_status,
  branch_received_by_user_id, branch_received_by_name, branch_received_at
) values (
  '83000000-0000-4000-8000-000000000091',
  'branch-large-delete', 'branch-large-delete',
  '81000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'Branch Receipt Target', 10000000000.00,
  'branch', 'paid',
  '82000000-0000-4000-8000-000000000001',
  'Branch Transfer Creator', '0898200001', current_date,
  1, 'received',
  '82000000-0000-4000-8000-000000000002',
  'Branch Transfer Receiver', statement_timestamp()
);
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select extensions.lives_ok($$
  select public.request_branch_money_transfer_delete(
    '83000000-0000-4000-8000-000000000091', 0
  )
$$, 'a valid numeric(14,2) branch amount can enter the deletion approval flow');
reset role;

select extensions.throws_like($$
  insert into public.money_transfer_slips (
    id, transfer_id, amount, fee, transaction_date, sort_order, input_method
  ) values (
    '84000000-0000-4000-8000-000000000099',
    '83000000-0000-4000-8000-000000000001',
    1, 0, statement_timestamp() + interval '1 minute', 1, 'manual'
  )
$$, 'MT_SLIP_FUTURE_DATE:%', 'every slip write rejects a future timestamp');

select * from extensions.finish();
rollback;
