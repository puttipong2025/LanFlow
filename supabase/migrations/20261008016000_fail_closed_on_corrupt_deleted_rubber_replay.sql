-- A malformed queued payload must not turn a deleted approval replay into a
-- retryable database error. Treat an unreadable fingerprint as an identity
-- mismatch so the queue becomes an explicit conflict and stops retrying.

create or replace function private.try_rubber_bill_submission_fingerprint(p_payload jsonb)
returns text
language plpgsql
set search_path = 'pg_catalog', 'public', 'private', 'extensions'
as $$
begin
  return private.rubber_bill_submission_fingerprint(p_payload);
exception
  when data_exception or raise_exception then
    return null;
end
$$;

alter function private.try_rubber_bill_submission_fingerprint(jsonb) owner to postgres;
revoke all on function private.try_rubber_bill_submission_fingerprint(jsonb)
  from public, anon, authenticated;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    $old$        and g.request_fingerprint = private.rubber_bill_submission_fingerprint(payload)$old$,
    $new$        and g.request_fingerprint is not null
        and g.request_fingerprint = private.try_rubber_bill_submission_fingerprint(payload)$new$
  );
  if v_updated = v_definition then
    raise exception 'RUBBER_APPROVAL_REPLAY_FINGERPRINT_BLOCKED: sync guard changed';
  end if;

  execute v_updated;
end
$migration$;
