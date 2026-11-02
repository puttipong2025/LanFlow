-- Clear registrations and recycle display codes without recycling final bill numbers.
begin;

alter table private.bill_issuer_global_counter
  add column registry_epoch integer not null default 0 check (registry_epoch >= 0);

-- Only a digest of issuer UUID + branch + code survives a reset. No plaintext
-- code or device metadata is retained here; frozen offline bills still validate.
create table private.bill_number_issuer_proofs (
  digest text primary key check (digest ~ '^[a-f0-9]{64}$')
);
revoke all on private.bill_number_issuer_proofs from public, anon, authenticated;

create function private.resolve_bill_number_issuer(p_id uuid, p_location uuid, p_base text)
returns table(id uuid, location_id uuid, code text)
language sql set search_path = '' as $$
  select refs.id, refs.location_id, refs.code from (
    select i.id, i.location_id, i.code from private.rubber_bill_issuers i
    union all select l.id, l.location_id, l.code from private.legacy_bill_issuer_refs l
  ) refs where refs.id = p_id
  union all
  select p_id, p_location, substring(p_base from 'D[0-9]{2,18}$')
  where exists (select 1 from private.bill_number_issuer_proofs proof where proof.digest =
    encode(extensions.digest(p_id::text || ':' || p_location::text || ':' ||
      substring(p_base from 'D[0-9]{2,18}$'), 'sha256'), 'hex'))
  limit 1;
$$;
revoke all on function private.resolve_bill_number_issuer(uuid,uuid,text) from public, anon, authenticated;

-- Preserve all existing shape, date, branch, immutable-number and replay guards.
do $migration$
declare signature regprocedure; body text; changed text; marker text;
begin
  foreach signature in array array[
    'private.assert_rubber_bill_numbering(jsonb)'::regprocedure,
    'private.assert_income_expense_numbering(jsonb)'::regprocedure
  ] loop
    body := pg_get_functiondef(signature);
    marker := 'select id,location_id,code into i from (' || chr(10) ||
      'select id,location_id,code from private.rubber_bill_issuers union all ' || chr(10) ||
      'select id,location_id,code from private.legacy_bill_issuer_refs) refs where id=(m->>''issuerId'')::uuid;';
    changed := replace(body, marker,
      'select * into i from private.resolve_bill_number_issuer((m->>''issuerId'')::uuid,' ||
      '(payload->>''locationId'')::uuid,payload->>''localBillNo'');');
    if changed = body then raise exception 'Issuer proof boundary missing: %', signature; end if;
    body := changed;
    changed := replace(body, '  if jsonb_typeof(m)',
      '  perform pg_advisory_xact_lock_shared(hashtextextended(''bill-issuer-registry'',0));' || chr(10) ||
      '  if jsonb_typeof(m)');
    if changed = body then raise exception 'Number validation gate missing: %', signature; end if;
    execute changed;
  end loop;

  body := pg_get_functiondef('public.register_rubber_bill_issuer(uuid,uuid,uuid,text,text)'::regprocedure);
  changed := replace(body, '''deviceId'',d.id,''version'',1',
    '''deviceId'',d.id,''version'',1,''registryEpoch'',(select registry_epoch from private.bill_issuer_global_counter where id=true)');
  if changed = body then raise exception 'Registry epoch response boundary missing'; end if;
  execute changed;
end $migration$;

-- Preview includes retired registrations and pre-shared-device references too.
-- An epoch prevents the same empty/identical set from describing different resets.
create or replace function private.bill_device_reset_snapshot() returns jsonb
language sql stable set search_path = '' as $$
  with identities as (
    select 'device:' || id::text identity from private.bill_issuer_devices
    union all select 'issuer:' || id::text from private.rubber_bill_issuers where device_id is null
    union all select 'legacy:' || id::text from private.legacy_bill_issuer_refs
  )
  select jsonb_build_object('count', count(*), 'snapshot', encode(extensions.digest(
    (select registry_epoch::text from private.bill_issuer_global_counter where id=true) || ':' ||
    coalesce(string_agg(identity, ',' order by identity), ''), 'sha256'), 'hex')) from identities;
$$;

create or replace function public.reset_all_bill_devices(p_request_id uuid, p_snapshot text, p_confirmation text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare receipt private.bill_device_reset_receipts; preview jsonb; finished timestamptz;
begin
  if not private.rubber_actor_active() or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'super_admin'
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_request_id is null or p_snapshot is null or p_snapshot !~ '^[a-f0-9]{64}$'
    or p_confirmation is distinct from 'รีเซ็ตทั้งหมด' then
    raise exception 'BILL_DEVICE_RESET_INVALID' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bill-device-reset:' || p_request_id::text, 0));
  select * into receipt from private.bill_device_reset_receipts where request_id = p_request_id;
  if found then
    if receipt.actor_user_id is distinct from auth.uid() or receipt.snapshot is distinct from p_snapshot then
      raise exception 'BILL_DEVICE_RESET_REQUEST_MISMATCH' using errcode = '22023';
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('bill-issuer-registry', 0));
    preview := private.bill_device_reset_snapshot();
    if preview->>'snapshot' is distinct from p_snapshot then
      raise exception 'BILL_DEVICE_RESET_CONFLICT' using errcode = 'PT409';
    end if;
    if (preview->>'count')::bigint = 0 then
      raise exception 'BILL_DEVICE_RESET_EMPTY' using errcode = 'PT409';
    end if;
    finished := clock_timestamp();
    insert into private.bill_number_issuer_proofs(digest)
      select encode(extensions.digest(id::text || ':' || location_id::text || ':' || code, 'sha256'), 'hex')
      from (select id, location_id, code from private.rubber_bill_issuers
        union all select id, location_id, code from private.legacy_bill_issuer_refs) refs
      on conflict do nothing;
    delete from private.rubber_bill_issuer_heads;
    delete from private.rubber_bill_issuers;
    delete from private.bill_issuer_device_heads;
    delete from private.bill_issuer_devices;
    delete from private.legacy_bill_issuer_refs;
    delete from private.rubber_bill_issuer_counters;
    update private.bill_issuer_global_counter set last_code = 0, registry_epoch = registry_epoch + 1 where id=true;
    insert into private.bill_device_reset_receipts values
      (p_request_id, auth.uid(), p_snapshot, (preview->>'count')::bigint, finished) returning * into receipt;
  end if;
  -- Keep the existing receipt field for safe replay across the upgrade.
  return jsonb_build_object('requestId', receipt.request_id, 'snapshot', receipt.snapshot,
    'retiredCount', receipt.retired_count, 'completedAt', receipt.completed_at);
end $$;

notify pgrst, 'reload schema';
commit;
