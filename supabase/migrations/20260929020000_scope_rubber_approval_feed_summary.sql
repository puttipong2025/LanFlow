-- Return approval-only metadata only in the approval queue and remove unused summary fields.

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
    $old$        'approval_requested_at', req.requested_at,
        'approval_requested_by_name', req.requested_by_name,
        'approval_original_summary', case when req.id is null then null else jsonb_build_object(
          'customerName', req.original_payload->>'customerName',
          'billDate', req.original_payload->>'billDate',
          'netTotal', req.original_payload->'netTotal'
        ) end,
        'approval_proposed_summary', case when req.id is null then null else jsonb_build_object($old$,
    $new$        'approval_requested_by_name', case when p_mode = 'pending_approval' then req.requested_by_name else null end,
        'approval_proposed_summary', case when req.id is null or p_mode <> 'pending_approval' then null else jsonb_build_object($new$
  );
  if v_updated = v_definition then
    raise exception 'bill-backed approval metadata definition not found';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $old$        'approval_requested_at', r.requested_at,
        'approval_requested_by_name', r.requested_by_name,
        'approval_original_summary', null,
        'approval_proposed_summary', jsonb_build_object($old$,
    $new$        'approval_requested_by_name', case when p_mode = 'pending_approval' then r.requested_by_name else null end,
        'approval_proposed_summary', case when p_mode = 'pending_approval' then jsonb_build_object($new$
  );
  if v_updated = v_definition then
    raise exception 'pending-create approval metadata definition not found';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $old$          'netTotal', r.proposed_payload->'netTotal'
        ),
        'items',$old$,
    $new$          'netTotal', r.proposed_payload->'netTotal'
        ) else null end,
        'items',$new$
  );
  if v_updated = v_definition then
    raise exception 'pending-create approval summary terminator not found';
  end if;

  execute v_updated;
end;
$migration$;
