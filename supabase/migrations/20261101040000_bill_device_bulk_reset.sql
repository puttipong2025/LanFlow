-- Reset device registrations, never issued numbers or the global high-water mark.
begin;

create table private.bill_device_reset_receipts (
  request_id uuid primary key,
  actor_user_id uuid not null,
  snapshot text not null check (snapshot ~ '^[a-f0-9]{64}$'),
  retired_count bigint not null check (retired_count > 0),
  completed_at timestamptz not null
);
revoke all on private.bill_device_reset_receipts from public, anon, authenticated;

-- Every registration (including a new branch link) joins the gate before its
-- existing per-installation lock. Ordinary registrations remain concurrent.
do $migration$
declare signature regprocedure; body text; marker text; changed text;
begin
  foreach signature in array array[
    'public.register_rubber_bill_issuer(uuid,uuid,uuid,text,text)'::regprocedure,
    'public.retire_rubber_bill_issuer(uuid)'::regprocedure
  ] loop
    body := pg_get_functiondef(signature);
    marker := case when signature = 'public.retire_rubber_bill_issuer(uuid)'::regprocedure
      then '  select * into i from private.rubber_bill_issuers where id=p_id;'
      else '  perform pg_advisory_xact_lock(hashtextextended(''bill-device:''||p_installation_id::text||'':''||p_generation_id::text,0));'
      end;
    changed := replace(body, marker,
      '  perform pg_advisory_xact_lock_shared(hashtextextended(''bill-issuer-registry'',0));' || chr(10) || marker);
    if changed = body then raise exception 'Device registry lock boundary missing: %', signature; end if;
    execute changed;
    execute format('alter function %s set lock_timeout = ''3s''', signature);
  end loop;
end $migration$;

create function private.bill_device_reset_snapshot() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('count', count(*), 'snapshot',
    encode(extensions.digest(coalesce(string_agg(id::text, ',' order by id), ''), 'sha256'), 'hex'))
  from private.bill_issuer_devices where retired_at is null;
$$;
revoke all on function private.bill_device_reset_snapshot() from public, anon, authenticated;

create function public.preview_bill_device_reset() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.rubber_actor_active() or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'super_admin'
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return private.bill_device_reset_snapshot();
end $$;

create function public.reset_all_bill_devices(p_request_id uuid, p_snapshot text, p_confirmation text) returns jsonb
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
      raise exception 'BILL_DEVICE_RESET_CONFLICT' using errcode = '40001';
    end if;
    if (preview->>'count')::bigint = 0 then
      raise exception 'BILL_DEVICE_RESET_EMPTY' using errcode = '40001';
    end if;
    finished := clock_timestamp();
    with changed as (
      update private.bill_issuer_devices set retired_at = finished, retired_by = auth.uid()
        where retired_at is null returning id
    )
    update private.rubber_bill_issuers link set retired_at = finished, retired_by = auth.uid()
      from changed where link.device_id = changed.id and link.retired_at is null;
    insert into private.bill_device_reset_receipts values
      (p_request_id, auth.uid(), p_snapshot, (preview->>'count')::bigint, finished) returning * into receipt;
  end if;
  return jsonb_build_object('requestId', receipt.request_id, 'snapshot', receipt.snapshot,
    'retiredCount', receipt.retired_count, 'completedAt', receipt.completed_at);
end $$;

revoke all on function public.preview_bill_device_reset(), public.reset_all_bill_devices(uuid,text,text) from public, anon;
grant execute on function public.preview_bill_device_reset(), public.reset_all_bill_devices(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
