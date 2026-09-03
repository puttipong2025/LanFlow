begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values ('62000000-0000-4000-8000-000000000001', '0896200001', 'retention manager', 'admin', true, true),
       ('62000000-0000-4000-8000-000000000002', '0896200002', 'ordinary admin', 'admin', true, false);
select extensions.ok(not has_function_privilege('anon', 'public.request_history_retention_cleanup(uuid,timestamptz,date)', 'execute'), 'anon cannot enqueue cleanup');
select extensions.ok(not has_function_privilege('authenticated', 'private.cleanup_history_retention(integer)', 'execute'), 'browser cannot execute worker directly');
select extensions.ok(not has_table_privilege('authenticated', 'public.history_cleanup_runs', 'insert'), 'browser cannot forge a cleanup job');
select extensions.throws_ok($$select private.cleanup_history_retention(null)$$, 'P0001', 'HISTORY_RETENTION_BATCH_INVALID', 'null cannot disable the batch limit');
select extensions.throws_ok($$select private.cleanup_history_retention(5001)$$, 'P0001', 'HISTORY_RETENTION_BATCH_INVALID', 'batch has an upper bound');
select extensions.ok(position('history_retention_preview_rows' in pg_get_functiondef('private.history_retention_has_work(integer)'::regprocedure)) = 0, 'work checks do not count all expired rows');

select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select extensions.throws_ok($$select public.request_history_retention_cleanup(gen_random_uuid(),now(),current_date)$$, 'P0001', 'FORBIDDEN: ไม่มีสิทธิ์สั่งล้างประวัติ', 'ordinary admin cannot enqueue');
select extensions.throws_ok($$select public.get_history_cleanup_status()$$, 'P0001', 'FORBIDDEN: ไม่มีสิทธิ์จัดการระยะเก็บประวัติ', 'ordinary admin cannot poll status');
reset role;

-- More than one batch, including an old but still-running Scheduler entry.
insert into cron.job_run_details(runid, jobid, status, start_time, end_time, username)
select -620000-g, 0, 'succeeded', now()-interval '20 days', now()-interval '20 days', 'postgres'
from generate_series(1,1005) g;
insert into cron.job_run_details(runid, status, start_time, username)
values (-629999, 'running', now()-interval '40 days', 'postgres');
insert into cron.job_run_details(runid,status,start_time,end_time,username)
values (-619000,'succeeded',private.history_retention_cutoff_date()::timestamp at time zone 'Asia/Bangkok',now(),'postgres');
insert into public.stock_product_approval_requests(
  id, request_status, request_type, request_idempotency_key, requested_payload, product_name,
  unit, create_sale_item, requested_by_user_id, requested_by_name, requested_by_phone, created_at, updated_at
) values (
  '62000000-0000-4000-8000-000000000010','pending','create_product','retention-pending-must-stay','{"name":"pending"}',
  'pending product','ชิ้น',false,'62000000-0000-4000-8000-000000000002','ordinary admin','0896200002',now()-interval '40 days',now()-interval '40 days'
);
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select extensions.throws_ok($$select public.request_history_retention_cleanup(null,now(),current_date)$$, 'P0001', 'HISTORY_CLEANUP_REQUEST_INVALID', 'request id is mandatory');
select extensions.throws_ok($$select public.request_history_retention_cleanup(gen_random_uuid(),now()-interval '1 day',current_date)$$, 'P0001', 'HISTORY_RETENTION_CONFLICT', 'stale policy is rejected');
select extensions.throws_ok($$select public.request_history_retention_cleanup(gen_random_uuid(),(select updated_at from public.history_retention_settings where singleton),current_date-100)$$, 'P0001', 'HISTORY_RETENTION_CONFLICT', 'stale calendar cutoff is rejected');
select public.request_history_retention_cleanup('63000000-0000-4000-8000-000000000001',
  (select updated_at from public.history_retention_settings where singleton), private.history_retention_cutoff_date());
select extensions.is((public.get_history_cleanup_status()->'lastCleanup'->>'status'), 'running', 'request persists before any deletion');
select extensions.is((public.get_history_cleanup_status()->'lastCleanup'->>'batches')::int, 0, 'request does not run a batch in HTTP transaction');
select public.request_history_retention_cleanup('63000000-0000-4000-8000-000000000001',
  (select updated_at from public.history_retention_settings where singleton), private.history_retention_cutoff_date());
select public.request_history_retention_cleanup('63000000-0000-4000-8000-000000000002',
  (select updated_at from public.history_retention_settings where singleton), private.history_retention_cutoff_date());
reset role;
select extensions.is((select count(*) from public.history_cleanup_runs where status='running'), 1::bigint, 'same or concurrent-style requests share one active job');
select extensions.is((select count(*) from cron.job_run_details where runid between -621005 and -620001), 1005::bigint, 'enqueue has no deletion side effect');
select private.cleanup_history_retention(1000);
select extensions.is((select count(*) from cron.job_run_details where runid between -621005 and -620001), 5::bigint, 'first batch is bounded');
select extensions.is((select status from public.history_cleanup_runs where request_id='63000000-0000-4000-8000-000000000001'), 'running', 'job remains active between batches');
select extensions.is((select batches from public.history_cleanup_runs where status='running'), 1, 'committed batches are counted');
select extensions.ok(current_setting('app.history_retention_cleanup',true) is distinct from 'on', 'cleanup bypass flag does not leak to caller');

-- Increase policy between batches: the five remaining rows become protected.
set local role authenticated;
select public.save_history_retention_settings(30, (select updated_at from public.history_retention_settings where singleton));
reset role;
select private.cleanup_history_retention(1000);
select extensions.is((select count(*) from cron.job_run_details where runid between -621005 and -620001), 5::bigint, 'next batch honors the newly increased retention');
select extensions.is((select status from public.history_cleanup_runs where request_id='63000000-0000-4000-8000-000000000001'), 'succeeded', 'changed policy completes the existing job without deleting protected rows');
select extensions.is((select (deleted_counts->>'scheduler_run_history')::int from public.history_cleanup_runs where request_id='63000000-0000-4000-8000-000000000001'), 1000, 'prior committed deletion totals are preserved');
select extensions.is((select count(*) from cron.job_run_details where runid=-629999), 1::bigint, 'running scheduler history is never deleted');
select extensions.is((private.cleanup_history_retention(1000)->>'reason'), 'no_work', 'idle tick creates no cleanup job');

-- Decrease again, and force a failure inside the transactional batch.
set local role authenticated;
select public.save_history_retention_settings(15, (select updated_at from public.history_retention_settings where singleton));
reset role;
create function pg_temp.fail_cleanup() returns trigger language plpgsql as $$begin raise exception 'injected cleanup failure'; end$$;
create trigger retention_test_failure before update on public.history_cleanup_runs
for each row when (new.status <> 'failed' and new.batches > old.batches) execute function pg_temp.fail_cleanup();
select extensions.is(private.cleanup_history_retention(1000)->>'status', 'failed', 'failed batch is recorded');
select extensions.is((select count(*) from cron.job_run_details where runid between -621005 and -620001), 5::bigint, 'failed batch rolls back all deletions');
select extensions.ok(exists(select 1 from public.history_cleanup_runs where status='failed' and error_message like '%P0001%'), 'failure exposes a safe diagnostic code');
drop trigger retention_test_failure on public.history_cleanup_runs;
select private.cleanup_history_retention(1000);
select extensions.is((select count(*) from cron.job_run_details where runid between -621005 and -620001), 0::bigint, 'automatic worker retries expired work after the failure is removed');
select extensions.is((select count(*) from cron.job_run_details where runid=-629999), 1::bigint, 'retry still preserves running history');
select extensions.is((select count(*) from cron.job_run_details where runid=-619000), 1::bigint, 'exact Bangkok midnight cutoff is kept');
select extensions.is((select request_status from public.stock_product_approval_requests where id='62000000-0000-4000-8000-000000000010'), 'pending', 'old pending approvals are neither deleted nor timed out');
select extensions.is((select schedule from cron.job where jobname='lanflow-temporary-history-retention'), '* * * * *', 'one-minute schedule exceeds the observed daily arrival rate');
select * from extensions.finish();
rollback;
