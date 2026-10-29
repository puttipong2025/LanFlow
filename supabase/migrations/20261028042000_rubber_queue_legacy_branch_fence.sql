-- Admission and legacy execution share the branch fence. Once a bill uses the
-- central protocol, an unknown old command cannot overtake an admitted intent.
do $$ declare body text; begin
  body:=pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure);
  body:=replace(body,'begin
  select * into j from private.rubber_queue_jobs',
    'begin
  if not private.rubber_actor_location((payload->>''locationId'')::uuid) then
    return jsonb_build_object(''status'',''failed'',''errorMessage'',''ไม่มีสิทธิ์ทำรายการบิลยาง'');
  end if;
  perform pg_advisory_xact_lock(hashtextextended((payload->>''locationId'')::uuid::text,0));
  select * into j from private.rubber_queue_jobs');
  body:=replace(body,'elsif payload->>''centralQueue''=''true'' then',
    'elsif exists(select 1 from private.rubber_queue_heads h where h.location_id::text=payload->>''locationId''
      and h.client_temp_id=payload->>''clientTempId'' and h.version>0)
      and not exists(select 1 from private.rubber_command_receipts r where r.command_id::text=payload->>''idempotencyKey'')
      and not exists(select 1 from public.rubber_bills b where b.idempotency_key=payload->>''idempotencyKey'')
      and not exists(select 1 from public.rubber_bill_approval_requests a where a.idempotency_key=payload->>''idempotencyKey'')
      and not exists(select 1 from private.approval_request_replay_guards g where g.workflow=''rubber_bill'' and g.request_key=payload->>''idempotencyKey'') then
    return jsonb_build_object(''status'',''failed'',''errorCode'',''CENTRAL_ADMISSION_REQUIRED'',
      ''errorMessage'',''กรุณาอัปเดตแอปและส่งผ่านคิวซิงก์กลาง'');
  elsif payload->>''centralQueue''=''true'' then');
  execute body;
  body:=pg_get_functiondef('public.submit_rubber_queue(jsonb)'::regprocedure);
  body:=replace(body,'coalesce(normalized->>''localBillNo'',req.proposed_payload->>''localBillNo'',client),policy,',
    'left(coalesce(normalized->>''localBillNo'',req.proposed_payload->>''localBillNo'',client),128),policy,');
  execute body;
end $$;
update private.rubber_queue_jobs set reference=left(reference,128) where length(reference)>128;
