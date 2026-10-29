-- A locally accepted manager command may arrive after its exact request was
-- replaced/cancelled. Retire that identity durably instead of retrying forever.
do $$ declare body text; begin
  body:=pg_get_functiondef('public.submit_rubber_queue(jsonb)'::regprocedure);
  body:=replace(body,'if req.id is null then raise exception ''REQUEST_CHANGED''; end if;',
    'if req.id is null then stale:=true; end if;');
  body:=replace(body,'private.rubber_bill_submission_fingerprint(req.proposed_payload) end,',
    'private.try_rubber_bill_submission_fingerprint(req.proposed_payload) end,');
  body:=replace(body,'''errorCode'',''STALE_COMMAND_CONTEXT'') end,',
    '''errorCode'',case when target is not null then ''REQUEST_CHANGED'' else ''STALE_COMMAND_CONTEXT'' end) end,');
  body:=replace(body,'case when stale then ''STALE_COMMAND_CONTEXT'' when correction',
    'case when stale then case when target is not null then ''REQUEST_CHANGED'' else ''STALE_COMMAND_CONTEXT'' end when correction');
  execute body;
end $$;
