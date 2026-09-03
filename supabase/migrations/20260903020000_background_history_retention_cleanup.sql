-- Durable, bounded catch-up using the existing cleanup history table and one cron.
-- No business/tombstone/replay-guard/deletion-audit sources enter this allowlist.
alter table public.history_cleanup_runs
  add column request_id uuid unique,
  add column requested_by_user_id uuid references public.profiles(id) on delete set null,
  add column source text not null default 'automatic' check (source in ('manual', 'automatic')),
  add column settings_updated_at timestamptz,
  add column remaining_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(remaining_counts) = 'object'),
  add column counts_as_of timestamptz,
  add column batches integer not null default 0 check (batches >= 0);

-- A request can wait for another transaction; order jobs by insertion, not BEGIN.
alter table public.history_cleanup_runs alter column started_at set default clock_timestamp();

create unique index history_cleanup_one_running_idx on public.history_cleanup_runs ((true)) where status = 'running';
create index history_cleanup_runs_started_idx on public.history_cleanup_runs(started_at desc);

-- Match range filters directly to timestamps; avoid a per-row timezone cast.
-- cron.job_run_details is extension-owned: use its existing runid primary key
-- for bounded deletion rather than requiring ownership to add an index.
drop index public.admin_account_audit_logs_retention_idx;
create index admin_account_audit_logs_retention_idx on public.admin_account_audit_logs ((coalesce(completed_at, created_at)), id) where status <> 'pending';
drop index public.income_expense_approval_retention_idx;
create index income_expense_approval_retention_idx on public.income_expense_approval_requests ((coalesce(decided_at, updated_at)), id) where request_status <> 'pending';
drop index public.cash_transfer_delete_retention_idx;
create index cash_transfer_delete_retention_idx on public.cash_transfer_delete_requests ((coalesce(decided_at, updated_at)), id) where request_status <> 'pending';
drop index public.rubber_bill_approval_retention_idx;
create index rubber_bill_approval_retention_idx on public.rubber_bill_approval_requests ((coalesce(approved_at, requested_at)), id) where request_status <> 'pending';
drop index public.stock_entry_approval_retention_idx;
create index stock_entry_approval_retention_idx on public.stock_entry_approval_requests ((coalesce(decided_at, updated_at)), id) where request_status <> 'pending';
drop index public.stock_product_approval_retention_idx;
create index stock_product_approval_retention_idx on public.stock_product_approval_requests ((coalesce(decided_at, updated_at)), id) where request_status <> 'pending';

create or replace function private.history_retention_preview_rows(p_days integer)
returns table(group_key text, eligible_count bigint, oldest_date date)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select private.history_retention_cutoff_date(p_days) as cutoff,
      private.history_retention_cutoff_date(p_days)::timestamp at time zone 'Asia/Bangkok' as cutoff_at
  ), groups as (
    select 'dashboard_money_events'::text group_key, event_date item_date
    from public.dashboard_money_events, bounds where event_date < cutoff
    union all
    select 'time_tracking_audit_logs', (created_at at time zone 'Asia/Bangkok')::date
    from public.time_tracking_audit_logs, bounds
    where created_at < cutoff_at
    union all
    select 'admin_account_audit_logs', (coalesce(completed_at, created_at) at time zone 'Asia/Bangkok')::date
    from public.admin_account_audit_logs, bounds
    where status <> 'pending'
      and coalesce(completed_at, created_at) < cutoff_at
    union all
    select 'income_expense_approval_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.income_expense_approval_requests, bounds
    where request_status <> 'pending'
      and coalesce(decided_at, updated_at) < cutoff_at
    union all
    select 'cash_transfer_delete_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.cash_transfer_delete_requests, bounds
    where request_status <> 'pending'
      and coalesce(decided_at, updated_at) < cutoff_at
    union all
    select 'rubber_bill_approval_requests', (coalesce(approved_at, requested_at) at time zone 'Asia/Bangkok')::date
    from public.rubber_bill_approval_requests, bounds
    where request_status <> 'pending'
      and coalesce(approved_at, requested_at) < cutoff_at
    union all
    select 'stock_entry_approval_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.stock_entry_approval_requests, bounds
    where request_status <> 'pending'
      and coalesce(decided_at, updated_at) < cutoff_at
    union all
    select 'stock_product_approval_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.stock_product_approval_requests, bounds
    where request_status <> 'pending'
      and coalesce(decided_at, updated_at) < cutoff_at
    union all
    select 'scheduler_run_history', (start_time at time zone 'Asia/Bangkok')::date
    from cron.job_run_details, bounds
    where status in ('succeeded', 'failed') and start_time < cutoff_at
    union all
    select 'cleanup_run_history', (coalesce(completed_at, started_at) at time zone 'Asia/Bangkok')::date
    from public.history_cleanup_runs, bounds
    where status <> 'running'
      and coalesce(completed_at, started_at) < cutoff_at
  ), keys(group_key) as (values
    ('dashboard_money_events'), ('time_tracking_audit_logs'),
    ('admin_account_audit_logs'), ('income_expense_approval_requests'),
    ('cash_transfer_delete_requests'), ('rubber_bill_approval_requests'),
    ('stock_entry_approval_requests'), ('stock_product_approval_requests'),
    ('scheduler_run_history'), ('cleanup_run_history')
  )
  select keys.group_key, count(groups.item_date), min(groups.item_date)
  from keys left join groups using (group_key)
  group by keys.group_key
  order by keys.group_key
$$;

create or replace function private.history_retention_has_work(p_days integer)
returns boolean language sql stable security definer set search_path = ''
as $$
  with bounds as (
    select private.history_retention_cutoff_date(p_days) as cutoff,
      private.history_retention_cutoff_date(p_days)::timestamp at time zone 'Asia/Bangkok' as cutoff_at
  )
  select
    exists (select 1 from public.dashboard_money_events, bounds where true and event_date < cutoff)
    or
    exists (select 1 from public.time_tracking_audit_logs, bounds where true and created_at < cutoff_at)
    or
    exists (select 1 from public.admin_account_audit_logs, bounds where status <> 'pending' and coalesce(completed_at, created_at) < cutoff_at)
    or
    exists (select 1 from public.income_expense_approval_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.cash_transfer_delete_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.rubber_bill_approval_requests, bounds where request_status <> 'pending' and coalesce(approved_at, requested_at) < cutoff_at)
    or
    exists (select 1 from public.stock_entry_approval_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.stock_product_approval_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from cron.job_run_details, bounds where status in ('succeeded', 'failed') and start_time < cutoff_at)
    or
    exists (select 1 from public.history_cleanup_runs, bounds where status <> 'running' and coalesce(completed_at, started_at) < cutoff_at)
    or exists (select 1 from public.admin_account_audit_logs where status = 'pending' and created_at < now() - interval '24 hours')
$$;

create or replace function private.history_cleanup_summary()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'source', r.source,
    'retentionDays', r.retention_days, 'cutoffDate', r.cutoff_date,
    'deletedCounts', r.deleted_counts, 'remainingCounts', r.remaining_counts,
    'countsAsOf', r.counts_as_of, 'batches', r.batches,
    'hasMore', r.has_more, 'errorMessage', r.error_message,
    'startedAt', r.started_at, 'completedAt', r.completed_at
  ) from public.history_cleanup_runs r order by r.started_at desc, r.id desc limit 1
$$;

create or replace function public.get_history_cleanup_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการระยะเก็บประวัติ';
  end if;
  return (select jsonb_build_object('currentDays', retention_days, 'updatedAt', updated_at,
    'cutoffDate', private.history_retention_cutoff_date(retention_days),
    'lastCleanup', private.history_cleanup_summary())
    from public.history_retention_settings where singleton);
end
$$;

create or replace function public.get_history_retention_overview(
  p_retention_days integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    ) order by p.group_key), '[]'::jsonb), coalesce(sum(p.eligible_count), 0)
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
    'lastCleanup', v_last_cleanup
  );
end
$$;

create or replace function public.request_history_retention_cleanup(
  p_request_id uuid, p_expected_updated_at timestamptz, p_expected_cutoff_date date
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $$
declare
  v_settings public.history_retention_settings%rowtype;
  v_run public.history_cleanup_runs%rowtype;
  v_counts jsonb;
  v_has_work boolean;
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
  select jsonb_object_agg(group_key, eligible_count) into v_counts
    from private.history_retention_preview_rows(v_settings.retention_days);
  v_has_work := private.history_retention_has_work(v_settings.retention_days);
  insert into public.history_cleanup_runs(
    request_id, requested_by_user_id, source, retention_days, cutoff_date,
    status, settings_updated_at, remaining_counts, counts_as_of, has_more, completed_at
  ) values (
    p_request_id, auth.uid(), 'manual', v_settings.retention_days,
    private.history_retention_cutoff_date(v_settings.retention_days),
    case when v_has_work then 'running' else 'succeeded' end,
    v_settings.updated_at, v_counts, clock_timestamp(), v_has_work,
    case when v_has_work then null else clock_timestamp() end
  ) returning * into v_run;
  return jsonb_build_object('status', v_run.status, 'runId', v_run.id);
end
$$;

create or replace function private.cleanup_history_retention(p_batch_size integer default 1000)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s'
as $$
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
    -- Full counts only once per job, or when the saved policy/calendar cutoff changes.
    if v_run.settings_updated_at is distinct from v_settings.updated_at
      or v_run.cutoff_date <> v_cutoff then
      select jsonb_object_agg(group_key, eligible_count) into v_run.remaining_counts
        from private.history_retention_preview_rows(v_days);
      v_run.counts_as_of := clock_timestamp();
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
$$;

create or replace function public.save_history_retention_settings(
  p_retention_days integer,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_settings public.history_retention_settings%rowtype;
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
  select * into strict v_settings from public.history_retention_settings
  where singleton = true for update;
  if p_expected_updated_at is null or v_settings.updated_at <> p_expected_updated_at then
    raise exception 'HISTORY_RETENTION_CONFLICT: การตั้งค่าถูกเปลี่ยนแล้ว กรุณาโหลดใหม่';
  end if;
  if v_settings.retention_days = p_retention_days then
    return public.get_history_retention_overview(p_retention_days);
  end if;
  select p.name into v_actor_name from public.profiles p where p.id = v_actor;
  select coalesce(jsonb_object_agg(p.group_key, p.eligible_count), '{}'::jsonb)
    into v_counts from private.history_retention_preview_rows(p_retention_days) p;
  insert into public.history_retention_change_audits(
    actor_user_id, actor_name, old_retention_days, new_retention_days, eligible_counts
  ) values (
    v_actor, coalesce(v_actor_name, ''), v_settings.retention_days,
    p_retention_days, v_counts
  );
  update public.history_retention_settings
  set retention_days = p_retention_days, updated_by = v_actor,
      updated_by_name = coalesce(v_actor_name, ''), updated_at = clock_timestamp()
  where singleton = true;
  v_cleanup := public.request_history_retention_cleanup(
    gen_random_uuid(),
    (select updated_at from public.history_retention_settings where singleton),
    private.history_retention_cutoff_date(p_retention_days)
  );
  return public.get_history_retention_overview(p_retention_days)
    || jsonb_build_object('cleanup', v_cleanup);
end
$$;

-- One tick per minute; each invocation commits at most 1,000 rows per group.
-- Empty ticks use indexed EXISTS and do not create a cleanup history row.
select cron.schedule('lanflow-temporary-history-retention', '* * * * *',
  'set statement_timeout = ''20s''; select private.cleanup_history_retention(1000)');

revoke all on function private.history_retention_has_work(integer) from public, anon, authenticated;
revoke all on function private.history_cleanup_summary() from public, anon, authenticated;
revoke all on function public.get_history_cleanup_status() from public, anon;
revoke all on function public.request_history_retention_cleanup(uuid,timestamptz,date) from public, anon;
grant execute on function public.get_history_cleanup_status() to authenticated, service_role;
grant execute on function public.request_history_retention_cleanup(uuid,timestamptz,date) to authenticated, service_role;
