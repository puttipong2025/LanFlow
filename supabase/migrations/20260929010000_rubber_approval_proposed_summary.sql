-- Keep the bounded approval feed minimal while exposing the proposed values approvers need.

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
    $old$        'approval_proposed_summary', case when req.id is null then null else jsonb_build_object(
          'customerName', req.proposed_payload->>'customerName',
          'billDate', req.proposed_payload->>'billDate',
          'netTotal', req.proposed_payload->'netTotal'
        ) end$old$,
    $new$        'approval_proposed_summary', case when req.id is null then null else jsonb_build_object(
          'customerName', req.proposed_payload->>'customerName',
          'billDate', req.proposed_payload->>'billDate',
          'billType', req.proposed_payload->>'billType',
          'netWeight', req.proposed_payload->'netWeight',
          'averagePrice', req.proposed_payload->'averagePrice',
          'netRubberValue', req.proposed_payload->'netRubberValue',
          'deductionTotal', req.proposed_payload->'deductionTotal',
          'netTotal', req.proposed_payload->'netTotal'
        ) end$new$
  );
  if v_updated = v_definition then
    raise exception 'pending bill approval summary definition not found';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $old$        'approval_proposed_summary', jsonb_build_object(
          'customerName', r.proposed_payload->>'customerName',
          'billDate', r.proposed_payload->>'billDate',
          'netTotal', r.proposed_payload->'netTotal'
        ),$old$,
    $new$        'approval_proposed_summary', jsonb_build_object(
          'customerName', r.proposed_payload->>'customerName',
          'billDate', r.proposed_payload->>'billDate',
          'billType', r.proposed_payload->>'billType',
          'netWeight', r.proposed_payload->'netWeight',
          'averagePrice', r.proposed_payload->'averagePrice',
          'netRubberValue', r.proposed_payload->'netRubberValue',
          'deductionTotal', r.proposed_payload->'deductionTotal',
          'netTotal', r.proposed_payload->'netTotal'
        ),$new$
  );
  if v_updated = v_definition then
    raise exception 'pending create approval summary definition not found';
  end if;

  execute v_updated;
end;
$migration$;
