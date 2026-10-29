alter table private.rubber_queue_jobs add column reference text not null default '';
update private.rubber_queue_jobs set reference=coalesce(payload->>'localBillNo',client_temp_id);
do $$ declare body text; begin
  body:=pg_get_functiondef('public.submit_rubber_queue(jsonb)'::regprocedure);
  body:=replace(body,'target_request_id,target_fingerprint,policy,state,result,completed_at,error_code)',
    'target_request_id,target_fingerprint,reference,policy,state,result,completed_at,error_code)');
  body:=replace(body,'private.rubber_bill_submission_fingerprint(req.proposed_payload) end,policy,',
    'private.rubber_bill_submission_fingerprint(req.proposed_payload) end,
      coalesce(normalized->>''localBillNo'',req.proposed_payload->>''localBillNo'',client),policy,');
  execute body;
  body:=pg_get_functiondef('private.rubber_queue_view(private.rubber_queue_jobs)'::regprocedure);
  body:=replace(body,'''clientTempId'',j.client_temp_id', '''reference'',j.reference,''clientTempId'',j.client_temp_id');
  execute body;

  -- One kernel for cron and an optional bounded branch preflight. Preflight is
  -- its own RPC transaction, before create_report_batch obtains report locks.
  body:=pg_get_functiondef('private.process_rubber_queue(integer)'::regprocedure);
  body:=replace(body,'private.process_rubber_queue(p_limit integer DEFAULT 20)',
    'private.process_rubber_queue_batch(p_limit integer, p_location_id uuid)');
  body:=replace(body,'where state in (''queued'',''retry_wait'',''paused'')
        and next_attempt_at<=clock_timestamp()',
    'where state in (''queued'',''retry_wait'',''paused'')
        and (p_location_id is null or location_id=p_location_id) and next_attempt_at<=clock_timestamp()');
  body:=replace(body,'where location_id=j.location_id and status=''active'')',
    'where location_id=j.location_id and status=''active'' and expires_at>clock_timestamp())');
  body:=replace(body,'if bill.record_status=''deleted'' and j.action in (''update'',''delete'') then',
    'if j.payload->>''expectedServerId'' is not null and bill.id::text is distinct from j.payload->>''expectedServerId'' then
      code:=''BILL_CHANGED_OR_LOCKED''; terminal:=true;
    elsif bill.record_status=''deleted'' and j.action in (''update'',''delete'') then');
  execute body;
end $$;
revoke all on function private.process_rubber_queue_batch(integer,uuid) from public,anon,authenticated;
create or replace function private.process_rubber_queue(p_limit integer default 20) returns integer
language sql security definer set search_path='' as $$ select private.process_rubber_queue_batch(p_limit,null) $$;
revoke all on function private.process_rubber_queue(integer) from public,anon,authenticated;
create function public.wake_rubber_queue(p_location_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.rubber_actor_location(p_location_id) then raise exception 'FORBIDDEN'; end if;
  perform private.process_rubber_queue_batch(5,p_location_id);
end $$;
revoke all on function public.wake_rubber_queue(uuid) from public,anon;
grant execute on function public.wake_rubber_queue(uuid) to authenticated;
