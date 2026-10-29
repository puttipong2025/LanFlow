-- One-job transactions must not repeatedly inspect only four locked branches.
-- Keep the existing fair order, processed-job cap, seven-second scan budget,
-- statement deadlines and every execution/resource guard.
do $migration$
declare
  body text;
  candidate_limit constant text := 'limit greatest(1,least(coalesce(p_limit,20),100))*4';
begin
  body := pg_get_functiondef('private.process_rubber_queue_batch(integer,uuid)'::regprocedure);
  if strpos(body, 'tick_started') = 0 or strpos(body, 'interval ''7 seconds''') = 0 then
    raise exception 'Rubber queue scan budget prerequisite missing';
  end if;
  if (length(body)-length(replace(body,candidate_limit,'')))/length(candidate_limit) <> 1 then
    raise exception 'Rubber queue candidate query differs from expected prerequisite';
  end if;
  body := replace(body,candidate_limit,'');
  execute body;
end $migration$;
