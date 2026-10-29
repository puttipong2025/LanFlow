-- A stuck dependency cannot occupy the scheduler indefinitely. Statement timeout
-- rolls the entire tick back, retaining every previously admitted command.
select cron.alter_job(jobid, command := 'set statement_timeout=''8s''; set lock_timeout=''2s''; select private.process_rubber_queue(20)')
from cron.job where jobname='rubber-central-queue';
do $$ declare body text; begin
  body:=pg_get_functiondef('public.wake_rubber_queue(uuid)'::regprocedure);
  body:=replace(body,'  perform private.process_rubber_queue_batch(5,p_location_id);',
    '  perform set_config(''lock_timeout'',''250ms'',true);
  perform private.process_rubber_queue_batch(5,p_location_id);');
  execute body;
end $$;
