begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.history_retention_settings(singleton, retention_days) values (true,15)
on conflict (singleton) do update set retention_days=excluded.retention_days;
delete from private.scheduler_history_cleanup_status;
insert into cron.job_run_details(runid,status,start_time,end_time,username)
values (-651001,'succeeded',now()-interval '400 days',now()-interval '400 days','postgres');
insert into public.history_cleanup_runs(retention_days,cutoff_date,status,completed_at)
values (15,current_date-400,'succeeded',now()-interval '400 days');

create function pg_temp.fail_scheduler_delete(p_runid bigint) returns int language plpgsql as $$
begin
  if p_runid = -651001 then raise query_canceled; end if;
  return 1;
end $$;
-- Inject cancellation at the real DELETE inside the scheduler worker. The
-- extension table is managed by Supabase and the test role cannot add triggers.
create temporary table scheduler_worker_definition as
select pg_get_functiondef('private.cleanup_scheduler_history(integer)'::regprocedure) as body;
do $$
declare original text; patched text;
begin
  select body into original from scheduler_worker_definition;
  patched := replace(original, 't.runid = d.runid returning 1',
    't.runid = d.runid returning pg_temp.fail_scheduler_delete(t.runid)');
  if patched = original then raise exception 'Scheduler DELETE test injection did not match'; end if;
  execute patched;
end $$;

select extensions.is(private.cleanup_history_retention(1000)->>'status','succeeded',
  'app cleanup can commit even when scheduler history deletion would time out');
select extensions.ok(not exists(select 1 from public.history_cleanup_runs where completed_at=now()-interval '400 days'),
  'app history deletion is committed independently');
select extensions.ok(exists(select 1 from cron.job_run_details where runid=-651001),
  'app cleanup leaves scheduler history to its own worker');
select extensions.is(private.cleanup_scheduler_history(1),0,'failed scheduler batch reports no committed deletion');
select extensions.is(private.scheduler_history_cleanup_summary()->>'errorCode','57014','scheduler timeout has its own status');
do $$begin execute (select body from scheduler_worker_definition); end $$;
select extensions.is(private.cleanup_scheduler_history(1),1,'scheduler retries with a bounded batch');
select extensions.ok(not exists(select 1 from cron.job_run_details where runid=-651001),'scheduler removes the expired terminal row');
select extensions.is((private.scheduler_history_cleanup_summary()->>'deletedCount')::int,1,'scheduler reports the actual deletion count');
select extensions.is(private.scheduler_history_cleanup_summary()->>'errorCode',null,'successful retry clears previous failure');
select extensions.ok(not has_function_privilege('authenticated','private.cleanup_scheduler_history(integer)','execute'),
  'browser roles cannot invoke scheduler cleanup');
select extensions.ok(not has_table_privilege('authenticated','private.scheduler_history_cleanup_status','select'),
  'the status row is available through the manager RPC only');
select extensions.is((select schedule from cron.job where jobname='lanflow-scheduler-history-retention' and active),
  '* * * * *','scheduler cleanup runs as an independent scheduled job');
select * from extensions.finish();
rollback;
