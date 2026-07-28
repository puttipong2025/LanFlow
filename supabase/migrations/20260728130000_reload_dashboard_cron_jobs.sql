-- Force pg_cron to reload the Dashboard jobs after a public-schema replacement.
-- Existing installations can retain newly inserted cron.job rows without
-- scheduling them until the jobs are recreated.

do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in ('dashboard-read-model-claim', 'dashboard-read-model-rebuild')
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'dashboard-read-model-claim',
    '* * * * *',
    'select private.claim_dashboard_branch()'
  );

  perform cron.schedule(
    'dashboard-read-model-rebuild',
    '* * * * *',
    'select private.rebuild_dashboard_branch()'
  );
end;
$$;
