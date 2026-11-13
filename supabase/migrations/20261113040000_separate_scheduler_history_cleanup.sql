-- Scheduler history has its own transaction and a single latest-result row.
create table private.scheduler_history_cleanup_status (
  singleton boolean primary key default true check (singleton),
  checked_at timestamptz not null,
  retention_days integer not null,
  deleted_count integer not null check (deleted_count >= 0),
  error_code text,
  scan_after_runid bigint
);
alter table private.scheduler_history_cleanup_status enable row level security;
revoke all on private.scheduler_history_cleanup_status from public, anon, authenticated;

create function private.scheduler_history_cleanup_summary()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('checkedAt', checked_at, 'deletedCount', deleted_count,
    'errorCode', error_code)
  from private.scheduler_history_cleanup_status where singleton
$$;
revoke all on function private.scheduler_history_cleanup_summary() from public, anon, authenticated;

create function private.cleanup_scheduler_history(p_batch_size integer default 1000)
returns integer language plpgsql security definer set search_path = '' set lock_timeout = '2s'
as $$
declare
  v_cutoff_at timestamptz;
  v_days integer;
  v_deleted integer := 0;
  v_error_code text;
  v_after bigint;
  v_last bigint;
  v_previous_days integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 5000 then
    raise exception 'HISTORY_RETENTION_BATCH_INVALID';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('scheduler-history-cleanup', 0)) then
    return 0;
  end if;
  -- Compatible with the app worker's NO KEY UPDATE lock. A settings save takes
  -- FOR UPDATE and either finishes first or waits until this batch commits.
  select retention_days into v_days from public.history_retention_settings where singleton for key share skip locked;
  if not found then return 0; end if;
  v_cutoff_at := private.history_retention_cutoff_date(v_days)::timestamp at time zone 'Asia/Bangkok';
  select scan_after_runid, retention_days into v_after, v_previous_days
  from private.scheduler_history_cleanup_status where singleton;
  -- A shorter policy can make rows behind the cursor immediately eligible.
  if v_days < v_previous_days then v_after := null; end if;

  begin
    -- Bound rows examined as well as rows deleted. Wrap at the end to revisit
    -- skipped locks, rows that became terminal and newly expired history.
    with scan_window as materialized (
      select runid from cron.job_run_details
      where runid >= coalesce(v_after, '-9223372036854775808'::bigint)
        and runid is distinct from v_after
      order by runid limit p_batch_size
    ), doomed as (
      select d.runid from scan_window w cross join lateral (
        select runid from cron.job_run_details
        where runid = w.runid and status in ('succeeded', 'failed') and start_time < v_cutoff_at
        for update skip locked
      ) d
    ), deleted as (
      delete from cron.job_run_details t using doomed d where t.runid = d.runid returning 1
    )
    select (select max(runid) from scan_window), (select count(*) from deleted)
    into v_last, v_deleted;
  exception when query_canceled or others then
    v_deleted := 0;
    v_error_code := sqlstate;
    v_last := v_after;
  end;

  insert into private.scheduler_history_cleanup_status(singleton, checked_at, retention_days, deleted_count, error_code, scan_after_runid)
  values (true, clock_timestamp(), v_days, v_deleted, v_error_code, v_last)
  on conflict (singleton) do update set checked_at=excluded.checked_at,
    retention_days=excluded.retention_days, deleted_count=excluded.deleted_count,
    error_code=excluded.error_code, scan_after_runid=excluded.scan_after_runid;
  return v_deleted;
end
$$;
revoke all on function private.cleanup_scheduler_history(integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.history_retention_has_work(p_days integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select private.history_retention_cutoff_date(p_days) as cutoff,
      private.history_retention_cutoff_date(p_days)::timestamp at time zone 'Asia/Bangkok' as cutoff_at
  )
  select
    exists (select 1 from public.dashboard_money_events, bounds where event_date < cutoff)
    or
    exists (select 1 from public.time_tracking_audit_logs, bounds where created_at < cutoff_at)
    or
    exists (select 1 from public.admin_account_audit_logs, bounds where status <> 'pending' and coalesce(completed_at, created_at) < cutoff_at)
    or
    exists (select 1 from public.income_expense_approval_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.cash_transfer_delete_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.branch_transfer_delete_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.rubber_bill_approval_requests, bounds where request_status <> 'pending' and coalesce(approved_at, requested_at) < cutoff_at)
    or
    exists (select 1 from public.stock_entry_approval_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.stock_product_approval_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.history_cleanup_runs, bounds where status <> 'running' and coalesce(completed_at, started_at) < cutoff_at)

    or exists (select 1 from private.rubber_queue_jobs j,bounds
      where j.state='done' and j.history_purged_at is null and j.completed_at < cutoff_at
        and private.rubber_queue_history_finished_at(j) < cutoff_at)
    or exists (select 1 from public.admin_account_audit_logs where status = 'pending' and created_at < now() - interval '24 hours')
$function$;

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
  select * into strict v_settings from public.history_retention_settings where singleton for no key update;
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
  select * into strict v_settings from public.history_retention_settings where singleton for no key update;
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
      select id from public.dashboard_money_events where event_date < v_cutoff
      order by event_date, id limit p_batch_size for update skip locked
    )
    delete from public.dashboard_money_events t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('dashboard_money_events', v_count);

    with doomed as (
      select id from public.time_tracking_audit_logs where created_at < v_cutoff_at
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

create or replace function public.get_history_cleanup_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการระยะเก็บประวัติ';
  end if;
  return (select jsonb_build_object('currentDays', retention_days, 'updatedAt', updated_at,
    'cutoffDate', private.history_retention_cutoff_date(retention_days),
    'lastCleanup', private.history_cleanup_summary(),
    'schedulerCleanup', private.scheduler_history_cleanup_summary())
    from public.history_retention_settings where singleton);
end
$$;

CREATE OR REPLACE FUNCTION public.get_history_retention_overview(p_retention_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings public.history_retention_settings%rowtype;
  v_requested integer;
  v_groups jsonb;
  v_total bigint;
  v_last_cleanup jsonb;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการระยะเก็บประวัติ';
  end if;
  select * into strict v_settings
  from public.history_retention_settings s where s.singleton = true;
  v_requested := coalesce(p_retention_days, v_settings.retention_days);
  if v_requested not between 1 and 365 then
    raise exception 'HISTORY_RETENTION_INVALID: จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', p.group_key,
      'eligibleCount', p.eligible_count,
      'oldestDate', p.oldest_date
    ) order by p.group_key), '[]'::jsonb), case when bool_or(p.eligible_count is null) then null else coalesce(sum(p.eligible_count), 0) end
  into v_groups, v_total
  from private.history_retention_preview_rows(v_requested) p;
  v_last_cleanup := private.history_cleanup_summary();
  return jsonb_build_object(
    'currentDays', v_settings.retention_days,
    'requestedDays', v_requested,
    'cutoffDate', private.history_retention_cutoff_date(v_requested),
    'updatedAt', v_settings.updated_at,
    'updatedByName', v_settings.updated_by_name,
    'totalEligible', v_total,
    'groups', v_groups,
    'lastCleanup', v_last_cleanup,
    'schedulerCleanup', private.scheduler_history_cleanup_summary()
  );
end
$function$;

create or replace function public.save_history_retention_settings(
  p_retention_days integer, p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_settings public.history_retention_settings%rowtype;
  v_updated_at timestamptz;
  v_overview jsonb;
  v_counts jsonb;
  v_cleanup jsonb;
begin
  if v_actor is null or not private.is_active_user()
     or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์เปลี่ยนระยะเก็บประวัติ';
  end if;
  if p_retention_days is null or p_retention_days not between 1 and 365 then
    raise exception 'HISTORY_RETENTION_INVALID: จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365';
  end if;
  select * into strict v_settings from public.history_retention_settings where singleton for update;
  if p_expected_updated_at is distinct from v_settings.updated_at then
    raise exception 'HISTORY_RETENTION_CONFLICT: การตั้งค่าถูกเปลี่ยนแล้ว กรุณาโหลดใหม่';
  end if;
  if v_settings.retention_days = p_retention_days then
    return public.get_history_retention_overview(p_retention_days);
  end if;

  select p.name into v_actor_name from public.profiles p where p.id = v_actor;
  update public.history_retention_settings
  set retention_days = p_retention_days, updated_by = v_actor,
      updated_by_name = coalesce(v_actor_name, ''), updated_at = clock_timestamp()
  where singleton returning updated_at into v_updated_at;
  v_cleanup := public.request_history_retention_cleanup(
    gen_random_uuid(), v_updated_at, private.history_retention_cutoff_date(p_retention_days)
  );
  -- Reuse the returned overview for the audit so both see the same counts.
  v_overview := public.get_history_retention_overview(p_retention_days);
  select jsonb_object_agg(g->>'key', g->'eligibleCount') into v_counts
  from jsonb_array_elements(v_overview->'groups') g;
  insert into public.history_retention_change_audits(
    actor_user_id, actor_name, old_retention_days, new_retention_days, eligible_counts
  ) values (v_actor, coalesce(v_actor_name, ''), v_settings.retention_days, p_retention_days, v_counts);
  return v_overview || jsonb_build_object('cleanup', v_cleanup);
end
$$;

-- Independent jobs ensure a scheduler failure cannot roll back app cleanup.
select cron.schedule('lanflow-scheduler-history-retention', '* * * * *',
  'set statement_timeout = ''20s''; select private.cleanup_scheduler_history(1000)');
