-- Stop reading the original approval payload after its unused feed summary was removed.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'r.requested_by_name, r.original_payload, r.proposed_payload',
    'r.requested_by_name, r.proposed_payload'
  );
  if v_updated = v_definition then
    raise exception 'unused original approval payload selection not found';
  end if;

  execute v_updated;
end;
$migration$;
