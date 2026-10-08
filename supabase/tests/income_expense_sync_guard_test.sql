begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

select extensions.ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.sync_income_expense(jsonb)'::regprocedure
      and p.prosecdef
      and exists (
        select 1 from unnest(p.proconfig) setting where setting = 'search_path=""'
      )
  ),
  'Income/Expense sync is SECURITY DEFINER with an empty search_path'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.sync_income_expense(jsonb)', 'execute'),
  'authenticated clients can execute Income/Expense sync'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.sync_income_expense(jsonb)', 'execute'),
  'anonymous clients cannot execute Income/Expense sync'
);

insert into public.locations (id, name, code, is_active)
values ('71000000-0000-4000-8000-000000000071', 'Income Guard Branch', 'IEG1', true);

insert into public.profiles (id, phone, name, role, is_active, can_access_super_admin_features)
values ('71000000-0000-4000-8000-000000000072', '0897100072', 'Income Guard User', 'admin', true, false);

insert into public.user_locations (user_id, location_id, is_primary)
values ('71000000-0000-4000-8000-000000000072', '71000000-0000-4000-8000-000000000071', true);

insert into public.income_expense_approval_settings (id, applies_to, approval_min_amount)
values (true, 'both', 1)
on conflict (id) do update
set applies_to = excluded.applies_to,
    approval_min_amount = excluded.approval_min_amount;

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000072', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000072","role":"authenticated"}', true);
set local role authenticated;

select extensions.is(
  public.sync_income_expense(jsonb_build_object(
    'operation', 'create',
    'expectedRevisionNo', 0,
    'clientTempId', 'income-guard-reserved',
    'idempotencyKey', 'create:income-guard-reserved:0',
    'locationId', '71000000-0000-4000-8000-000000000071',
    'recordStatus', 'active',
    'localBillNo', 'LOCAL-IEG-1',
    'txDate', current_date,
    'type', 'income',
    'title', 'รับโอนจากสาขาทดสอบ',
    'cost', 100,
    'billOption', 'รายรับ',
    'clientRecordedAt', '2026-10-07T00:30:00Z',
    'clientCreatedAt', '2026-10-07T00:30:00Z'
  )) ->> 'status',
  'conflict',
  'reserved branch-transfer titles are rejected before the approval threshold'
);

select extensions.is(
  (
    select count(*)
    from public.income_expense_approval_requests
    where request_idempotency_key = 'create:income-guard-reserved:0'
  ),
  0::bigint,
  'rejected reserved titles do not create approval work'
);

select extensions.is(
  public.sync_income_expense(jsonb_build_object(
    'operation', 'create',
    'expectedRevisionNo', 0,
    'clientTempId', 'income-guard-ordinary',
    'idempotencyKey', 'create:income-guard-ordinary:0',
    'locationId', '71000000-0000-4000-8000-000000000071',
    'recordStatus', 'active',
    'localBillNo', 'LOCAL-IEG-2',
    'txDate', current_date,
    'type', 'expense',
    'title', 'ค่าวัสดุสำนักงาน',
    'cost', 100,
    'billOption', 'ค่าใช้จ่าย',
    'clientRecordedAt', '2026-10-07T00:30:00Z',
    'clientCreatedAt', '2026-10-07T00:30:00Z'
  )) ->> 'status',
  'pending_approval',
  'ordinary Income/Expense writes still reach the approval threshold'
);

select extensions.matches(
  (
    select submission_fingerprint
    from public.income_expense_approval_requests
    where request_idempotency_key = 'create:income-guard-ordinary:0'
  ),
  '^[0-9a-f]{64}$',
  'a pending approval stores the original client submission fingerprint'
);

select extensions.is(
  public.sync_income_expense(jsonb_build_object(
    'operation', 'create',
    'expectedRevisionNo', 0,
    'clientTempId', 'income-guard-ordinary',
    'idempotencyKey', 'create:income-guard-ordinary:0',
    'locationId', '71000000-0000-4000-8000-000000000071',
    'recordStatus', 'active',
    'localBillNo', 'LOCAL-IEG-2',
    'txDate', current_date,
    'type', 'expense',
    'title', 'changed pending approval payload',
    'cost', 100,
    'billOption', 'ค่าใช้จ่าย',
    'clientRecordedAt', '2026-10-07T00:30:00Z',
    'clientCreatedAt', '2026-10-07T00:30:00Z'
  )) ->> 'status',
  'conflict',
  'a pending approval replay rejects changed payload under the same idempotency key'
);

reset role;
update public.income_expense_approval_settings
set approval_min_amount = null,
    non_current_date_requires_approval = false
where id = true;
set local role authenticated;

create temporary table income_expense_guard_payload(payload jsonb) on commit drop;
insert into income_expense_guard_payload(payload)
values (jsonb_build_object(
  'operation', 'create',
  'expectedRevisionNo', 0,
  'clientTempId', 'income-guard-replay',
  'idempotencyKey', 'create:income-guard-replay:0',
  'locationId', '71000000-0000-4000-8000-000000000071',
  'recordStatus', 'active',
  'localBillNo', 'LOCAL-IEG-3',
  'txDate', current_date,
  'type', 'expense',
  'title', 'ค่าวัสดุทดสอบ replay',
  'cost', 75,
  'billOption', 'ค่าใช้จ่าย',
  'clientRecordedAt', '2026-10-07T01:00:00Z',
  'clientCreatedAt', '2026-10-07T01:00:00Z'
));

select extensions.is(
  public.sync_income_expense(payload) ->> 'status',
  'synced',
  'first direct submission is synced'
)
from income_expense_guard_payload;

select extensions.matches(
  (
    select last_submission_fingerprint
    from public.income_expense
    where client_temp_id = 'income-guard-replay'
  ),
  '^[0-9a-f]{64}$',
  'a successful direct submission records its fingerprint'
);

select extensions.is(
  public.sync_income_expense(payload) ->> 'status',
  'synced',
  'an exact replay remains idempotently successful'
)
from income_expense_guard_payload;

select extensions.is(
  public.sync_income_expense(
    jsonb_set(payload, '{title}', '"changed replay payload"'::jsonb)
  ) ->> 'status',
  'conflict',
  'the same idempotency key with changed payload is rejected'
)
from income_expense_guard_payload;

select extensions.is(
  (
    select title
    from public.income_expense
    where client_temp_id = 'income-guard-replay'
  ),
  'ค่าวัสดุทดสอบ replay',
  'a changed replay cannot mutate the saved row'
);

reset role;
select * from extensions.finish();
rollback;
