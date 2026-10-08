begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

select extensions.has_function(
  'private',
  'try_rubber_bill_submission_fingerprint',
  array['jsonb'],
  'deleted Rubber approval replay has a safe fingerprint boundary'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.try_rubber_bill_submission_fingerprint(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.try_rubber_bill_submission_fingerprint(jsonb)',
    'execute'
  ),
  'safe fingerprint helper is not client-executable'
);
select extensions.is(
  private.try_rubber_bill_submission_fingerprint(
    jsonb_build_object('operation', 'create', 'items', jsonb_build_object())
  ),
  null::text,
  'malformed create payload produces no fingerprint instead of raising'
);
select extensions.is(
  private.try_rubber_bill_submission_fingerprint(
    jsonb_build_object('operation', 'delete', 'clientTempId', 'valid-delete')
  ),
  private.rubber_bill_submission_fingerprint(
    jsonb_build_object('operation', 'delete', 'clientTempId', 'valid-delete')
  ),
  'valid payload keeps the canonical fingerprint'
);

insert into public.locations(id, name, code, is_active)
values ('7a000000-0000-4000-8000-000000000001', 'Replay Guard Branch', 'RGB1', true);

insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values (
  '7b000000-0000-4000-8000-000000000001',
  '0897001601',
  'Replay Guard User',
  'admin',
  true,
  true
);

insert into public.user_locations(user_id, location_id, is_primary)
values (
  '7b000000-0000-4000-8000-000000000001',
  '7a000000-0000-4000-8000-000000000001',
  true
);

insert into private.approval_request_replay_guards(
  workflow,
  request_key,
  terminal_status,
  completed_at,
  request_fingerprint
) values (
  'rubber_bill',
  'corrupt-deleted-rubber-replay',
  'deleted',
  clock_timestamp(),
  null
);

insert into public.rubber_bill_approval_requests(
  id,
  operation,
  request_status,
  location_id,
  client_temp_id,
  idempotency_key,
  base_revision_no,
  matched_reasons,
  proposed_payload,
  requested_by_user_id,
  requested_by_name,
  requested_by_phone
) values (
  '7c000000-0000-4000-8000-000000000001',
  'create',
  'pending',
  '7a000000-0000-4000-8000-000000000001',
  'fingerprint-system-error-bill',
  'fingerprint-system-error-request',
  0,
  array['price'],
  jsonb_build_object('operation', 'create', 'items', jsonb_build_array()),
  '7b000000-0000-4000-8000-000000000001',
  'Replay Guard User',
  '0897001601'
);

select set_config(
  'request.jwt.claim.sub',
  '7b000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"7b000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select extensions.is(
  public.sync_rubber_bill(jsonb_build_object(
    'operation', 'create',
    'locationId', '7a000000-0000-4000-8000-000000000001',
    'clientTempId', 'corrupt-replay-bill',
    'idempotencyKey', 'corrupt-deleted-rubber-replay',
    'expectedRevisionNo', 0,
    'submissionMode', 'replay',
    'items', jsonb_build_object()
  )),
  jsonb_build_object(
    'status', 'conflict',
    'errorMessage', 'รหัสคำขอถูกใช้กับรายการอื่นแล้ว'
  ),
  'corrupt deleted approval replay fails closed as conflict instead of retrying forever'
);

reset role;

create or replace function private.rubber_bill_submission_fingerprint(p_payload jsonb)
returns text
language plpgsql
set search_path = 'pg_catalog', 'public', 'private', 'extensions'
as $$
begin
  raise exception using
    errcode = '42883',
    message = 'synthetic fingerprint infrastructure failure';
end
$$;

set local role authenticated;

select extensions.throws_ok(
  $$select public.delete_rubber_bill_approval_request('7c000000-0000-4000-8000-000000000001')$$,
  '42883',
  'synthetic fingerprint infrastructure failure',
  'permanent delete does not hide a fingerprint infrastructure failure'
);
select extensions.ok(
  exists (
    select 1
    from public.rubber_bill_approval_requests
    where id = '7c000000-0000-4000-8000-000000000001'
  ),
  'fingerprint infrastructure failure preserves the pending request'
);

select * from extensions.finish();
rollback;
