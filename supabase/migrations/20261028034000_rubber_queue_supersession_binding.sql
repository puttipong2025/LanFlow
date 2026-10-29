do $$ declare body text; begin
  body:=pg_get_functiondef('public.submit_rubber_queue(jsonb)'::regprocedure);
  body:=replace(body,'update private.rubber_queue_jobs set state=''done'',payload=null,completed_at=clock_timestamp(),version=version+1',
    'update private.rubber_queue_jobs q set state=''done'',payload=null,completed_at=clock_timestamp(),version=q.version+1');
  body:=replace(body,'''operation'',action,''clientTempId'',client_temp_id,''errorCode'',''COMMAND_SUPERSEDED''',
    '''operation'',q.action,''clientTempId'',client_temp_id,''errorCode'',''COMMAND_SUPERSEDED''');
  execute body;
end $$;
