-- Full impact counts remain available through the explicit manager preview RPC.
-- Acceptance and automatic deletion must make progress without that unbounded scan.
-- No worker is invoked by this migration; business rows, policies and grants stay intact.

CREATE OR REPLACE FUNCTION public.request_history_retention_cleanup(p_request_id uuid, p_expected_updated_at timestamp with time zone, p_expected_cutoff_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_settings public.history_retention_settings%rowtype;
  v_run public.history_cleanup_runs%rowtype;
begin
  if auth.uid() is null or not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์สั่งล้างประวัติ';
  end if;
  if p_request_id is null then raise exception 'HISTORY_CLEANUP_REQUEST_INVALID'; end if;
  -- A setting update and a batch both lock this row before reading the policy.
  select * into strict v_settings from public.history_retention_settings where singleton for update;
  select * into v_run from public.history_cleanup_runs where request_id = p_request_id;
  if found then return jsonb_build_object('status', v_run.status, 'runId', v_run.id); end if;
  if p_expected_updated_at is distinct from v_settings.updated_at
    or p_expected_cutoff_date is distinct from private.history_retention_cutoff_date(v_settings.retention_days) then
    raise exception 'HISTORY_RETENTION_CONFLICT';
  end if;
  select * into v_run from public.history_cleanup_runs where status = 'running';
  if found then return jsonb_build_object('status', v_run.status, 'runId', v_run.id); end if;
  -- The worker decides whether work exists. Accept without rescanning the preview.
  insert into public.history_cleanup_runs(
    request_id, requested_by_user_id, source, retention_days, cutoff_date,
    status, settings_updated_at, remaining_counts, counts_as_of, has_more, completed_at
  ) values (
    p_request_id, auth.uid(), 'manual', v_settings.retention_days,
    private.history_retention_cutoff_date(v_settings.retention_days),
    'running', v_settings.updated_at, '{}'::jsonb, null, true, null
  ) returning * into v_run;
  return jsonb_build_object('status', v_run.status, 'runId', v_run.id);
end
$function$;

CREATE OR REPLACE FUNCTION private.cleanup_history_retention(p_batch_size integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = ''
 SET lock_timeout TO '2s'
AS $function$
declare
  v_settings public.history_retention_settings%rowtype;
  v_run public.history_cleanup_runs%rowtype;
  v_days integer;
  v_cutoff date;
  v_cutoff_at timestamptz;
  v_count bigint;
  v_counts jsonb := '{}'::jsonb;
  v_remaining jsonb;
  v_totals jsonb;
  v_has_more boolean;
  v_error text;
  v_previous_cleanup_flag text := current_setting('app.history_retention_cleanup', true);
begin
  if p_batch_size is null or p_batch_size not between 1 and 5000 then
    raise exception 'HISTORY_RETENTION_BATCH_INVALID';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('history-retention-cleanup', 0)) then
    return jsonb_build_object('status', 'skipped', 'reason', 'already_running');
  end if;
  select * into strict v_settings from public.history_retention_settings where singleton for update;
  v_days := v_settings.retention_days;
  v_cutoff := private.history_retention_cutoff_date(v_days);
  v_cutoff_at := v_cutoff::timestamp at time zone 'Asia/Bangkok';
  select * into v_run from public.history_cleanup_runs where status = 'running' for update;
  if not found then
    if not private.history_retention_has_work(v_days) then
      return jsonb_build_object('status', 'skipped', 'reason', 'no_work', 'hasMore', false);
    end if;
    insert into public.history_cleanup_runs(retention_days, cutoff_date, status)
    values (v_days, v_cutoff, 'running') returning * into v_run;
  end if;
  begin
    -- Keep existing snapshots only while their policy/calendar still matches.
    if v_run.settings_updated_at is distinct from v_settings.updated_at
      or v_run.cutoff_date <> v_cutoff then
      -- Counts are presentation metadata, never a prerequisite for deletion.
      -- A changed policy invalidates the old snapshot without scanning all history.
      v_run.remaining_counts := '{}'::jsonb;
      v_run.counts_as_of := null;
    end if;

    update public.admin_account_audit_logs
    set status = 'unknown', error_code = 'PENDING_TIMEOUT', completed_at = now()
    where id in (
      select id from public.admin_account_audit_logs
      where status = 'pending' and created_at < now() - interval '24 hours'
      order by created_at, id limit p_batch_size for update skip locked
    );
    perform set_config('app.history_retention_cleanup', 'on', true);

    with doomed as (
      select id from public.dashboard_money_events where true
        and event_date < v_cutoff
      order by event_date, id limit p_batch_size for update skip locked
    )
    delete from public.dashboard_money_events t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('dashboard_money_events', v_count);

    with doomed as (
      select id from public.time_tracking_audit_logs where true
        and created_at < v_cutoff_at
      order by created_at, id limit p_batch_size for update skip locked
    )
    delete from public.time_tracking_audit_logs t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('time_tracking_audit_logs', v_count);

    with doomed as (
      select id from public.admin_account_audit_logs where status <> 'pending'
        and coalesce(completed_at, created_at) < v_cutoff_at
      order by coalesce(completed_at, created_at), id limit p_batch_size for update skip locked
    )
    delete from public.admin_account_audit_logs t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('admin_account_audit_logs', v_count);

    with doomed as (
      select id from public.income_expense_approval_requests where request_status <> 'pending'
        and coalesce(decided_at, updated_at) < v_cutoff_at
      order by coalesce(decided_at, updated_at), id limit p_batch_size for update skip locked
    )
    delete from public.income_expense_approval_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('income_expense_approval_requests', v_count);

    with doomed as (
      select id from public.cash_transfer_delete_requests where request_status <> 'pending'
        and coalesce(decided_at, updated_at) < v_cutoff_at
      order by coalesce(decided_at, updated_at), id limit p_batch_size for update skip locked
    )
    delete from public.cash_transfer_delete_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('cash_transfer_delete_requests', v_count);

    with doomed as (
      select id from public.branch_transfer_delete_requests where request_status <> 'pending'
        and coalesce(decided_at, updated_at) < v_cutoff_at
      order by coalesce(decided_at, updated_at), id limit p_batch_size for update skip locked
    )
    delete from public.branch_transfer_delete_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('branch_transfer_delete_requests', v_count);

    with doomed as (
      select id from public.rubber_bill_approval_requests where request_status <> 'pending'
        and coalesce(approved_at, requested_at) < v_cutoff_at
      order by coalesce(approved_at, requested_at), id limit p_batch_size for update skip locked
    )
    delete from public.rubber_bill_approval_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('rubber_bill_approval_requests', v_count);

    with doomed as (
      select id from public.stock_entry_approval_requests where request_status <> 'pending'
        and coalesce(decided_at, updated_at) < v_cutoff_at
      order by coalesce(decided_at, updated_at), id limit p_batch_size for update skip locked
    )
    delete from public.stock_entry_approval_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('stock_entry_approval_requests', v_count);

    with doomed as (
      select id from public.stock_product_approval_requests where request_status <> 'pending'
        and coalesce(decided_at, updated_at) < v_cutoff_at
      order by coalesce(decided_at, updated_at), id limit p_batch_size for update skip locked
    )
    delete from public.stock_product_approval_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('stock_product_approval_requests', v_count);

    with doomed as (
      select runid from cron.job_run_details where status in ('succeeded', 'failed')
        and start_time < v_cutoff_at
      order by runid limit p_batch_size for update skip locked
    )
    delete from cron.job_run_details t using doomed d where t.runid = d.runid;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('scheduler_run_history', v_count);

    with doomed as (
      select id from public.history_cleanup_runs where status <> 'running'
        and coalesce(completed_at, started_at) < v_cutoff_at
      order by coalesce(completed_at, started_at), id limit p_batch_size for update skip locked
    )
    delete from public.history_cleanup_runs t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('cleanup_run_history', v_count);

    perform set_config('app.history_retention_cleanup', coalesce(v_previous_cleanup_flag, ''), true);
    v_count := private.compact_rubber_queue_history(v_days,p_batch_size);
    v_counts := v_counts || jsonb_build_object('sync_queue_history',v_count);
    v_has_more := private.history_retention_has_work(v_days);
    select jsonb_object_agg(c.key, coalesce((v_run.deleted_counts ->> c.key)::bigint, 0) + c.value::bigint),
      jsonb_object_agg(c.key, case when v_has_more
        then greatest(0, coalesce((v_run.remaining_counts ->> c.key)::bigint, 0) - c.value::bigint)
        else 0 end)
    into v_totals, v_remaining from jsonb_each_text(v_counts) c;
    update public.history_cleanup_runs
    set status = case when v_has_more then 'running' else 'succeeded' end,
        retention_days = v_days, cutoff_date = v_cutoff, settings_updated_at = v_settings.updated_at,
        deleted_counts = v_totals, remaining_counts = v_remaining, counts_as_of = v_run.counts_as_of,
        batches = batches + 1, has_more = v_has_more, error_message = null,
        completed_at = case when v_has_more then null else clock_timestamp() end
    where id = v_run.id;
    return jsonb_build_object('status', 'succeeded', 'runId', v_run.id, 'deletedCounts', v_counts, 'hasMore', v_has_more);
  exception when query_canceled or others then
    -- The failed batch rolls back; earlier committed batches and their counts survive.
    v_error := 'การล้างรอบนี้ไม่สำเร็จ (SQLSTATE ' || sqlstate || ')';
    update public.history_cleanup_runs
    set status = 'failed', error_message = v_error, has_more = true, completed_at = clock_timestamp()
    where id = v_run.id;
    return jsonb_build_object('status', 'failed', 'runId', v_run.id, 'hasMore', true, 'errorMessage', v_error);
  end;
end
$function$;
