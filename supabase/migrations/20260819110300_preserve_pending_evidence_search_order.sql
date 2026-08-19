-- Searching the pending view keeps its oldest-first queue order.
do $migration$
declare
  v_definition text;
  v_before text := 'v_ascending boolean := p_view = ''pending'' and v_search = '''' and p_bill_id is null;';
  v_after text := 'v_ascending boolean := p_view = ''pending'' and p_bill_id is null;';
begin
  select pg_get_functiondef(
    'public.get_rubber_bill_evidence_feed(uuid,text,text,uuid,timestamptz,uuid,integer)'::regprocedure
  ) into v_definition;
  if position(v_before in v_definition) = 0 then
    raise exception 'Expected Evidence feed ordering declaration was not found';
  end if;
  execute replace(v_definition, v_before, v_after);
end;
$migration$;

notify pgrst, 'reload schema';
