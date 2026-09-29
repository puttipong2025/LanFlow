-- Pending-create feed rows already expose the requester and every displayed bill value.

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
    $old$        'approval_requested_by_name', case when p_mode = 'pending_approval' then r.requested_by_name else null end,
        'approval_proposed_summary', case when p_mode = 'pending_approval' then jsonb_build_object(
          'customerName', r.proposed_payload->>'customerName',
          'billDate', r.proposed_payload->>'billDate',
          'billType', r.proposed_payload->>'billType',
          'netWeight', r.proposed_payload->'netWeight',
          'averagePrice', r.proposed_payload->'averagePrice',
          'netRubberValue', r.proposed_payload->'netRubberValue',
          'deductionTotal', r.proposed_payload->'deductionTotal',
          'netTotal', r.proposed_payload->'netTotal'
        ) else null end,
        'items',$old$,
    $new$        'items',$new$
  );
  if v_updated = v_definition then
    raise exception 'redundant pending-create approval metadata definition not found';
  end if;

  execute v_updated;
end;
$migration$;
