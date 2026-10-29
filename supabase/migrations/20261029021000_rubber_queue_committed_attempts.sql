-- Keep the existing queue, execution guards and branch/resource lock order.
-- Each top-level SELECT has its own transaction/deadline. A PL/pgSQL loop or
-- exception block alone cannot commit earlier attempts or reset statement timers.
do $migration$
declare tick text; id bigint;
begin
  tick := 'create temporary table if not exists rubber_tick_budget(started_at timestamptz not null) on commit preserve rows;'
    || 'truncate pg_temp.rubber_tick_budget;insert into pg_temp.rubber_tick_budget values(clock_timestamp());'
    || repeat(
      'begin;set local statement_timeout=''2s'';set local lock_timeout=''250ms'';'
      || 'select private.process_rubber_queue(1) where clock_timestamp() < '
      || '(select started_at from pg_temp.rubber_tick_budget)+interval ''7 seconds'';commit;',20);
  select jobid into id from cron.job where jobname='rubber-central-queue';
  if id is null then
    perform cron.schedule('rubber-central-queue','2 seconds',tick);
  else
    perform cron.alter_job(id,schedule:='2 seconds',command:=tick);
  end if;
end $migration$;
