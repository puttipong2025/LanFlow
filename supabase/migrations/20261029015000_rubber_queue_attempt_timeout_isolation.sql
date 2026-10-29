-- PostgreSQL OTHERS excludes query_canceled. Catch it at the job boundary so a
-- timed-out oldest job receives backoff instead of rolling back every other job.
do $$ declare body text; begin
  body:=pg_get_functiondef('private.process_rubber_queue_batch(integer,uuid)'::regprocedure);
  body:=replace(body,'next_state text; terminal boolean; successful boolean;',
    'next_state text; terminal boolean; successful boolean; tick_started timestamptz:=clock_timestamp();');
  body:=replace(body,'exit when processed>=',
    'exit when clock_timestamp()-tick_started>=interval ''7 seconds'' or processed>=');
  body:=replace(body,'    exception
      when others then',
    '    exception
      when query_canceled then
        next_state:=''retry_wait''; code:=''ATTEMPT_TIMEOUT'';
        successful:=false; terminal:=false; r:=null;
      when others then');
  execute body;
end $$;
