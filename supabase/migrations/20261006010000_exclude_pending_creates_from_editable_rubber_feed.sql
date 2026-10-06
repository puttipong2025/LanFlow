-- Pending approval creates are not editable documents and must not consume editable-feed cursors.

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
    $old$      and p_document_status in ('any', 'editable')$old$,
    $new$      and p_document_status = 'any'$new$
  );
  if v_updated = v_definition then
    raise exception 'pending-create document-status filter not found';
  end if;

  execute v_updated;
end;
$migration$;
