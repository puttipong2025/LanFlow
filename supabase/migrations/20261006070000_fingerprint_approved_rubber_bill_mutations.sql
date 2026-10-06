-- Keep replay verification after approved-request history is eventually pruned.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.approve_rubber_bill_approval_request(uuid)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$      approval_revision_no = revision_no,
      central_price_snapshot =$old$,
    $new$      approval_revision_no = revision_no,
      last_submission_fingerprint = private.rubber_bill_submission_fingerprint(v_request.proposed_payload),
      central_price_snapshot =$new$
  );
  if v_updated = v_definition then
    raise exception 'approved mutation fingerprint write point not found';
  end if;

  execute v_updated;
end;
$migration$;
