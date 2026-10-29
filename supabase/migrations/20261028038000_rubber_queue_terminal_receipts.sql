-- Old/offline devices observing an approval handoff must see its later final
-- receipt (including approved deletion), never a permanently stale pending one.
do $$ declare body text; begin
  body:=pg_get_functiondef('private.rubber_queue_view(private.rubber_queue_jobs)'::regprocedure);
  body:=replace(body,'''result'',j.result,',
    '''result'',case when j.state=''done'' and j.result->>''status''=''pending_approval'' then
      coalesce((select r.result from private.rubber_command_receipts r where r.command_id=j.command_id),j.result)
      else j.result end,');
  execute body;
  body:=pg_get_functiondef('private.process_rubber_queue_batch(integer,uuid)'::regprocedure);
  body:=replace(body,'if r->>''errorCode''=''STALE_COMMAND_CONTEXT'' then',
    'if r->>''errorCode''=''STALE_COMMAND_CONTEXT'' or (r->>''status''=''conflict''
      and r->>''errorMessage'' in (''Revision mismatch'',''Record already exists'')) then');
  execute body;
end $$;
