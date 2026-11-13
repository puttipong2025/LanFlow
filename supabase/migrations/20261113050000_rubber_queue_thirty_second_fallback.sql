-- The searchable list RPC replaced this migration-time copy in 20261028039000.
drop function public.list_rubber_queue_before_search(uuid,boolean,timestamptz,uuid,integer);

-- Keep each attempt in its own transaction and stop calling the worker when it
-- finds no claimable due work. The remaining statements only check the tick row.
do $migration$
declare tick text; job_id bigint;
begin
  tick := 'create temporary table rubber_tick_budget(started_at timestamptz not null, keep_working boolean not null);'
    || 'insert into pg_temp.rubber_tick_budget values(clock_timestamp(),true);'
    || repeat(
      'begin;set local statement_timeout=''2s'';set local lock_timeout=''250ms'';'
      || 'update pg_temp.rubber_tick_budget set keep_working=private.process_rubber_queue(1)>0 '
      || 'where keep_working and clock_timestamp() < started_at+interval ''7 seconds'';commit;',20)
    || 'drop table pg_temp.rubber_tick_budget;';
  select jobid into strict job_id from cron.job where jobname='rubber-central-queue';
  perform cron.alter_job(job_id,schedule:='30 seconds',command:=tick);
end $migration$;
