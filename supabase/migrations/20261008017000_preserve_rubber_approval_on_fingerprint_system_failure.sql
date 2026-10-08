-- Permanent approval-request deletion tolerates malformed business payloads,
-- but database or fingerprint infrastructure failures must still abort the
-- transaction so the pending request is not irreversibly removed.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.delete_rubber_bill_approval_request(uuid)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$  begin
    v_request_fingerprint := private.rubber_bill_submission_fingerprint(
      v_request.proposed_payload
    );
  exception when others then
    v_request_fingerprint := null;
  end;$old$,
    $new$  v_request_fingerprint := private.try_rubber_bill_submission_fingerprint(
    v_request.proposed_payload
  );$new$
  );
  if v_updated = v_definition then
    raise exception 'RUBBER_APPROVAL_DELETE_FINGERPRINT_BLOCKED: delete function changed';
  end if;

  execute v_updated;
end
$migration$;
