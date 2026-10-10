begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.locations (id, name, code, is_active) values
  ('71000000-0000-4000-8000-000000000001', 'Payment Branch', 'PAYMENT', true),
  ('71000000-0000-4000-8000-000000000002', 'Payment Branch 2', 'PAYMENT2', true),
  ('71000000-0000-4000-8000-000000000003', 'Unrelated Branch', 'UNRELATED', true);
insert into public.profiles (
  id, phone, name, role, is_active, can_manage_time_payroll,
  can_access_money_transfer, daily_wage
) values
  ('72000000-0000-4000-8000-000000000001', '0897200001', 'Payment Manager', 'admin', true, true, true, 500),
  ('72000000-0000-4000-8000-000000000002', '0897200002', 'Payment Employee', 'user', true, false, false, 500),
  ('72000000-0000-4000-8000-000000000003', '0897200003', 'Unrelated Manager', 'admin', true, true, true, 500);
insert into public.user_locations (user_id, location_id, is_primary) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', true),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', false),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', true),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', false),
  ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', true);
set constraints all immediate;

select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select extensions.ok(
  position(
    'perform pg_advisory_xact_lock' in
    pg_get_functiondef('public.decide_time_tracking_approval_with_payment(text,uuid,text,text,jsonb)'::regprocedure)
  ) < position(
    'select status::text, payment_contract_version, amount' in
    pg_get_functiondef('public.decide_time_tracking_approval_with_payment(text,uuid,text,text,jsonb)'::regprocedure)
  ),
  'payment approval locks the employee before reading mutable approval state'
);
select extensions.ok(
  position(
    'perform pg_advisory_xact_lock' in
    pg_get_functiondef('public.change_time_tracking_payment(text,uuid,jsonb,text)'::regprocedure)
  ) < position(
    'select expense_location_id into v_existing_location_id' in
    pg_get_functiondef('public.change_time_tracking_payment(text,uuid,jsonb,text)'::regprocedure)
  ),
  'payment change locks the employee before checking the mutable existing branch'
);
select extensions.ok(
  position(
    'private.lock_report_locations' in
    pg_get_functiondef('private.apply_time_payroll_payment(text,uuid,jsonb,boolean,text)'::regprocedure)
  ) > 0
  and position(
    'private.lock_report_locations' in
    pg_get_functiondef('private.apply_time_payroll_payment(text,uuid,jsonb,boolean,text)'::regprocedure)
  ) < position(
    'if p_require_unlocked then' in
    pg_get_functiondef('private.apply_time_payroll_payment(text,uuid,jsonb,boolean,text)'::regprocedure)
  ),
  'payment allocation changes share the report branch serialization lock'
);
select extensions.ok(
  position(
    'private.lock_report_locations' in
    pg_get_functiondef('public.delete_time_tracking_source_permanently(text,uuid)'::regprocedure)
  ) > 0
  and position(
    'private.lock_report_locations' in
    pg_get_functiondef('public.delete_time_tracking_source_permanently(text,uuid)'::regprocedure)
  ) < position(
    'private.delete_time_payroll_transfer_for_source' in
    pg_get_functiondef('public.delete_time_tracking_source_permanently(text,uuid)'::regprocedure)
  ),
  'time/payroll source deletion shares the report branch serialization lock'
);

reset role;
insert into public.payroll_slips (
  id, profile_id, month, gross_pay, total_deductions, net_pay,
  total_days, daily_wage, status, created_by
) values (
  '74000000-0000-4000-8000-000000000010',
  '72000000-0000-4000-8000-000000000002', '2026-08', 0, 0, 0,
  0, 500, 'PENDING', '72000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select extensions.throws_like($$
  select public.decide_time_tracking_approval_with_payment(
    'payroll_slip', '74000000-0000-4000-8000-000000000010', 'APPROVED', null,
    '{"channel":"outside_system","expenseLocationId":null,"transferAmount":null,"expectedSourceAmount":0}'::jsonb
  )
$$, 'PAYMENT_INVALID_PAYLOAD%', 'zero-net payroll approval rejects an unused payment allocation');
select extensions.is(
  (select status::text from public.payroll_slips where id = '74000000-0000-4000-8000-000000000010'),
  'PENDING',
  'invalid zero-net approval input leaves the slip pending'
);
select extensions.lives_ok($$
  select public.decide_time_tracking_approval_with_payment(
    'payroll_slip', '74000000-0000-4000-8000-000000000010', 'APPROVED', null, null
  )
$$, 'zero-net payroll approval does not require a payment allocation');

reset role;
insert into public.payroll_slips (
  id, profile_id, month, gross_pay, total_deductions, net_pay,
  total_days, daily_wage, status, created_by
) values (
  '74000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000002', '2026-07', 100, 0, 100,
  1, 100, 'PENDING', '72000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select extensions.throws_like($$
  select public.decide_time_tracking_approval_with_payment(
    'payroll_slip', '74000000-0000-4000-8000-000000000011', 'APPROVED', null, null
  )
$$, 'PAYMENT_REQUIRED%', 'positive payroll approval requires a payment allocation');
select extensions.throws_like($$
  select public.decide_time_tracking_approval_with_payment(
    'payroll_slip', '74000000-0000-4000-8000-000000000011', 'REJECTED', null,
    '{"channel":"outside_system","expenseLocationId":null,"transferAmount":null,"expectedSourceAmount":100}'::jsonb
  )
$$, 'PAYMENT_INVALID_PAYLOAD%', 'rejection rejects a payment allocation instead of ignoring it');
select extensions.is(
  (select status::text from public.payroll_slips where id = '74000000-0000-4000-8000-000000000011'),
  'PENDING',
  'rejected payment input leaves the approval state unchanged'
);

select public.delete_time_tracking_source_permanently(
  'payroll_slip', '74000000-0000-4000-8000-000000000010'
);
select public.delete_time_tracking_source_permanently(
  'payroll_slip', '74000000-0000-4000-8000-000000000011'
);

reset role;
update public.profiles set daily_wage = 0
where id = '72000000-0000-4000-8000-000000000002';
insert into public.time_payroll_active_periods (
  profile_id, start_on, end_on, created_by, updated_by
) values (
  '72000000-0000-4000-8000-000000000002', '2026-06-01', '2026-06-01',
  '72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select extensions.throws_like($$
  select public.create_time_tracking_payroll_slip_with_payment(
    '72000000-0000-4000-8000-000000000002', '2026-06', false,
    '{"channel":"outside_system","expenseLocationId":null,"transferAmount":null,"expectedSourceAmount":0}'::jsonb,
    null, 0
  )
$$, 'PAYMENT_INVALID_PAYLOAD%', 'zero-net payroll creation rejects a payment allocation instead of ignoring it');
select extensions.is(
  (select count(*) from public.payroll_slips
    where profile_id = '72000000-0000-4000-8000-000000000002' and month = '2026-06'),
  0::bigint,
  'rejected zero-net payment input leaves no payroll slip'
);
reset role;
delete from public.time_payroll_active_periods
where profile_id = '72000000-0000-4000-8000-000000000002' and start_on = '2026-06-01';
update public.profiles set daily_wage = 500
where id = '72000000-0000-4000-8000-000000000002';
set local role authenticated;

select extensions.lives_ok($$
  select public.create_time_tracking_withdrawal_with_payment(
    '72000000-0000-4000-8000-000000000002', 500, current_date, 'split payment',
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"125.50","expectedSourceAmount":500}'::jsonb,
    'payment test'
  )
$$, 'manager creates an approved withdrawal with one canonical payment allocation');

select extensions.is(
  (select payment_transfer_amount from public.financial_transactions where description = 'split payment'),
  125.50::numeric,
  'source stores only the transfer portion'
);
select extensions.is(
  (select expense_location_id from public.financial_transactions where description = 'split payment'),
  '71000000-0000-4000-8000-000000000001'::uuid,
  'source owns the branch portion location'
);
select extensions.is(
  (select net_amount_to_pay from public.money_transfers where withdrawal_transaction_id =
    (select id from public.financial_transactions where description = 'split payment')),
  125.50::numeric,
  'a source-owned money transfer is created for the transfer portion'
);
select set_config(
  'test.payment_source_id',
  (select id::text from public.financial_transactions where description = 'split payment'),
  true
);
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select extensions.throws_like($$
  select public.decide_time_tracking_approval_with_payment(
    'transaction',
    current_setting('test.payment_source_id')::uuid,
    'APPROVED', null,
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"125.50","expectedSourceAmount":500}'::jsonb
  )
$$, 'Forbidden%', 'an unrelated manager cannot replay an approved payment allocation');
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('app.time_payroll_payment_rpc', 'false', true);
select extensions.throws_like($$
  select public.change_time_tracking_expense_location(
    'transaction',
    (select id from public.financial_transactions where description = 'split payment'),
    '71000000-0000-4000-8000-000000000002',
    'legacy bypass attempt'
  )
$$, 'PAYMENT_USE_ALLOCATION_API%', 'legacy location changes cannot split a versioned source from its owned transfer');
reset role;
select extensions.is(
  (select private.time_payroll_branch_paid_amount(
    amount, payment_contract_version, payment_channel, payment_transfer_amount, expense_location_id
  ) from public.financial_transactions where description = 'split payment'),
  374.50::numeric,
  'the branch-paid difference is derived from the source total'
);
set local role authenticated;

select extensions.throws_like($$
  select public.create_time_tracking_withdrawal_with_payment(
    '72000000-0000-4000-8000-000000000002', 500, current_date, 'invalid split',
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"500.01","expectedSourceAmount":500}'::jsonb,
    null
  )
$$, 'PAYMENT_INVALID_SPLIT%', 'transfer amount cannot exceed the withdrawal amount');
select extensions.is(
  (select count(*) from public.financial_transactions where description = 'invalid split'),
  0::bigint,
  'an invalid split rolls the source creation back atomically'
);

select extensions.lives_ok($$
  select public.create_time_tracking_withdrawal_with_payment(
    '72000000-0000-4000-8000-000000000002', 300, current_date, 'outside payment',
    '{"channel":"outside_system","expenseLocationId":null,"transferAmount":null,"expectedSourceAmount":300}'::jsonb,
    null
  )
$$, 'outside-system payment is accepted without a branch');
select extensions.is(
  (select expense_location_id from public.financial_transactions where description = 'outside payment'),
  null::uuid,
  'outside-system payment has no branch expense'
);
select extensions.is(
  (select count(*) from public.money_transfers where withdrawal_transaction_id =
    (select id from public.financial_transactions where description = 'outside payment')),
  0::bigint,
  'outside-system payment creates no money transfer'
);

select extensions.lives_ok($$
  select public.create_time_tracking_withdrawal_with_payment(
    '72000000-0000-4000-8000-000000000002', 200, current_date, 'branch only payment',
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"0","expectedSourceAmount":200}'::jsonb,
    null
  )
$$, 'zero transfer means the selected branch pays the full source amount');
select extensions.is(
  (select count(*) from public.money_transfers where withdrawal_transaction_id =
    (select id from public.financial_transactions where description = 'branch only payment')),
  0::bigint,
  'branch-only allocation does not create a zero-value transfer'
);
reset role;
select extensions.is(
  (select private.time_payroll_branch_paid_amount(
    amount, payment_contract_version, payment_channel, payment_transfer_amount, expense_location_id
  ) from public.financial_transactions where description = 'branch only payment'),
  200::numeric,
  'branch-only allocation projects the full amount to รับ-จ่าย'
);
set local role authenticated;

select extensions.lives_ok($$
  select public.create_time_tracking_withdrawal_with_payment(
    '72000000-0000-4000-8000-000000000002', 250, current_date, 'transfer only payment',
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"250","expectedSourceAmount":250}'::jsonb,
    null
  )
$$, 'full transfer creates only the source-owned bank destination');
select extensions.is(
  (select net_amount_to_pay from public.money_transfers where withdrawal_transaction_id =
    (select id from public.financial_transactions where description = 'transfer only payment')),
  250::numeric,
  'full transfer preserves the entire source amount on the bank transfer'
);
select extensions.is(
  (
    select count(*)
    from jsonb_array_elements(public.get_income_expense_operational_feed(
      '71000000-0000-4000-8000-000000000001', 'latest', '', null
    ) -> 'rows') row
    where row ->> 'relationSourceType' = 'time_tracking_withdrawal'
      and row ->> 'relationSourceId' = (
        select id::text from public.financial_transactions where description = 'transfer only payment'
      )
  ),
  0::bigint,
  'full transfer creates no zero-value branch projection'
);
reset role;
select extensions.throws_like($$
  select private.validate_time_payroll_payment(
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"1.001","expectedSourceAmount":500}'::jsonb,
    500
  )
$$, 'PAYMENT_INVALID_SPLIT%', 'database rejects transfer precision beyond two decimal places');
select extensions.throws_like($$
  select private.validate_time_payroll_payment(
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"100","expectedSourceAmount":499}'::jsonb,
    500
  )
$$, 'PAYMENT_AMOUNT_CHANGED%', 'database rejects a stale expected source amount');
select extensions.throws_like($$
  select private.validate_time_payroll_payment(
    '{"channel":"outside_system","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":null,"expectedSourceAmount":500}'::jsonb,
    500
  )
$$, 'PAYMENT_INVALID_OUTSIDE_SYSTEM%', 'database rejects hidden branch data on outside-system payment');

insert into public.time_tracking_audit_logs (
  id, admin_id, action, target_table, record_id, comment
) values (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '72000000-0000-4000-8000-000000000001',
  'AUDIT_SENTINEL',
  'financial_transactions',
  (select id from public.financial_transactions where description = 'split payment'),
  'sentinel comment'
);
set local role authenticated;

select extensions.lives_ok($$
  select public.change_time_tracking_payment(
    'transaction',
    (select id from public.financial_transactions where description = 'split payment'),
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"100","expectedSourceAmount":500}'::jsonb,
    'reduce transfer'
  )
$$, 'an unlocked source can change its payment allocation');
reset role;
select extensions.is(
  (
    select comment from public.time_tracking_audit_logs
    where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  ),
  'sentinel comment'::text,
  'payment change does not overwrite another audit row from the same transaction'
);
select extensions.is(
  (
    select count(*) from public.time_tracking_audit_logs
    where record_id = (select id from public.financial_transactions where description = 'split payment')
      and action = 'CHANGE_TRANSACTION_PAYMENT'
      and comment = 'reduce transfer'
  ),
  1::bigint,
  'payment change writes its comment to its own audit row'
);
set local role authenticated;
select extensions.is(
  (select net_amount_to_pay from public.money_transfers where withdrawal_transaction_id =
    (select id from public.financial_transactions where description = 'split payment')),
  100::numeric,
  'changing the allocation updates the same source-owned transfer'
);
select set_config('app.time_payroll_payment_rpc', 'false', true);
select extensions.throws_like($$
  select public.delete_money_transfer(
    (select id from public.money_transfers where withdrawal_transaction_id =
      (select id from public.financial_transactions where description = 'split payment')),
    (select revision_no from public.money_transfers where withdrawal_transaction_id =
      (select id from public.financial_transactions where description = 'split payment'))
  )
$$, 'TIME_PAYROLL_TRANSFER_LOCKED%', 'a source-owned transfer cannot be deleted through the ordinary transfer route');
select extensions.is(
  (select record_status::text from public.money_transfers where withdrawal_transaction_id =
    (select id from public.financial_transactions where description = 'split payment')),
  'active',
  'a rejected ordinary delete leaves the source-owned transfer active'
);
select extensions.is(
  (
    select (row ->> 'cost')::numeric
    from jsonb_array_elements(public.get_income_expense_operational_feed(
      '71000000-0000-4000-8000-000000000001', 'latest', '', null
    ) -> 'rows') row
    where row ->> 'relationSourceType' = 'time_tracking_withdrawal'
      and row ->> 'relationSourceId' = (
        select id::text from public.financial_transactions where description = 'split payment'
      )
  ),
  400::numeric,
  'รับ-จ่าย contains only the branch-paid difference after a split'
);

reset role;
insert into public.payroll_slips (
  id, profile_id, month, gross_pay, total_deductions, net_pay,
  total_days, daily_wage, status, created_by, approved_by, approved_at
) values (
  '74000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002', '2026-09', 1000, 200, 800,
  2, 500, 'APPROVED',
  '72000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001', now()
);
select extensions.is(
  (select payment_contract_version from public.payroll_slips where id = '74000000-0000-4000-8000-000000000001'),
  null::smallint,
  'legacy approved payroll remains unbackfilled before an explicit payment change'
);
select extensions.is(
  (select count(*) from public.money_transfers where payroll_slip_id = '74000000-0000-4000-8000-000000000001'),
  0::bigint,
  'legacy payroll has no automatic transfer before it is upgraded'
);
set local role authenticated;
select extensions.lives_ok($$
  select public.change_time_tracking_payment(
    'payroll_slip', '74000000-0000-4000-8000-000000000001',
    '{"channel":"branch_and_transfer","expenseLocationId":"71000000-0000-4000-8000-000000000001","transferAmount":"300","expectedSourceAmount":800}'::jsonb,
    'payroll split'
  )
$$, 'the same allocation boundary supports an approved payroll slip');
select extensions.is(
  (select net_amount_to_pay from public.money_transfers where payroll_slip_id = '74000000-0000-4000-8000-000000000001'),
  300::numeric,
  'payroll creates a source-owned transfer for its transfer portion'
);
select extensions.is(
  (
    select (row ->> 'cost')::numeric
    from jsonb_array_elements(public.get_income_expense_operational_feed(
      '71000000-0000-4000-8000-000000000001', 'latest', '', null
    ) -> 'rows') row
    where row ->> 'relationSourceType' = 'payroll_slip'
      and row ->> 'relationSourceId' = '74000000-0000-4000-8000-000000000001'
  ),
  500::numeric,
  'รับ-จ่าย contains only the payroll branch-paid difference'
);
select extensions.throws_like($$
  select public.save_source_owned_money_transfer_slips(
    (select id from public.money_transfers where payroll_slip_id = '74000000-0000-4000-8000-000000000001'),
    0,
    '[{"id":"75000000-0000-4000-8000-000000000099","amount":"abc","fee":0,"transactionDate":"2026-10-09T09:00:00+07:00","inputMethod":"manual","referenceNumber":null,"sortOrder":0}]'::jsonb
  )
$$, 'MT_INVALID_SLIP:%', 'malformed source-owned slip values return the stable public validation error');
select extensions.lives_ok($$
  select public.save_source_owned_money_transfer_slips(
    (select id from public.money_transfers where payroll_slip_id = '74000000-0000-4000-8000-000000000001'),
    0,
    '[{"id":"75000000-0000-4000-8000-000000000001","amount":300,"fee":0,"transactionDate":"2026-10-09T09:00:00+07:00","inputMethod":"manual","referenceNumber":null,"sortOrder":0}]'::jsonb
  )
$$, 'time/payroll transfer saves slips through the same source-owned seam as REX work');
select extensions.is(
  (select transfer_status::text from public.money_transfers where payroll_slip_id = '74000000-0000-4000-8000-000000000001'),
  'paid',
  'source-owned slip save derives the paid status'
);
select extensions.throws_like($$
  select public.change_time_tracking_payment(
    'payroll_slip', '74000000-0000-4000-8000-000000000001',
    '{"channel":"outside_system","expenseLocationId":null,"transferAmount":null,"expectedSourceAmount":800}'::jsonb,
    null
  )
$$, 'PAYMENT_TRANSFER_HAS_SLIPS%', 'a payment allocation cannot be rewritten after transfer slips exist');
select extensions.lives_ok($$
  select public.delete_time_tracking_source_permanently(
    'payroll_slip', '74000000-0000-4000-8000-000000000001'
  )
$$, 'deleting the source removes its owned transfer and slips atomically');
select extensions.is(
  (select count(*) from public.money_transfers where payroll_slip_id = '74000000-0000-4000-8000-000000000001'),
  0::bigint,
  'no orphan time/payroll transfer remains after source deletion'
);

reset role;
insert into public.report_batches (
  id, report_no, report_date, sequence_no, location_id, cutoff_at,
  created_by_user_id, created_by_name, created_by_phone
) values (
  '73000000-0000-4000-8000-000000000001', 'RPT-PAYMENT-1', current_date, 720001,
  '71000000-0000-4000-8000-000000000001', now(),
  '72000000-0000-4000-8000-000000000001', 'Payment Manager', '0897200001'
);
insert into public.report_items (report_id, location_id, entity_type, entity_id, eligibility_at)
select '73000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001',
  'financial_transaction', id, now()
from public.financial_transactions where description = 'split payment';
set local role authenticated;

select extensions.throws_like($$
  select public.change_time_tracking_payment(
    'transaction',
    (select id from public.financial_transactions where description = 'split payment'),
    '{"channel":"outside_system","expenseLocationId":null,"transferAmount":null,"expectedSourceAmount":500}'::jsonb,
    null
  )
$$, 'REPORT_LOCKED:RPT-PAYMENT-1%', 'a report-locked source cannot change payment allocation');

select extensions.ok(
  not has_function_privilege('authenticated', 'private.apply_time_payroll_payment(text,uuid,jsonb,boolean,text)', 'execute'),
  'authenticated users cannot bypass the public payment boundary'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.money_transfers', 'insert')
    and not has_table_privilege('authenticated', 'public.money_transfers', 'update')
    and not has_table_privilege('authenticated', 'public.money_transfers', 'delete'),
  'browser clients cannot mutate source-owned transfers directly'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.money_transfer_slips', 'insert')
    and not has_table_privilege('authenticated', 'public.money_transfer_slips', 'update')
    and not has_table_privilege('authenticated', 'public.money_transfer_slips', 'delete'),
  'browser clients cannot mutate source-owned slips directly'
);
select extensions.throws_like($$
  select public.save_money_transfer(jsonb_build_object(
    'id', gen_random_uuid(),
    'locationId', '71000000-0000-4000-8000-000000000001',
    'operation', 'create',
    'transferType', 'time_payroll',
    'slips', '[]'::jsonb,
    'items', '[]'::jsonb
  ))
$$, 'MT_UNSUPPORTED_WORKFLOW:%', 'the ordinary money-transfer RPC cannot create a time/payroll transfer');
select extensions.ok(
  has_function_privilege('authenticated', 'public.save_source_owned_money_transfer_slips(uuid,integer,jsonb)', 'execute'),
  'money-transfer users reach the shared source-owned slip save seam'
);

reset role;
select * from extensions.finish();
rollback;
