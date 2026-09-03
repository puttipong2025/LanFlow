-- One configurable Bangkok-calendar retention policy for temporary history.
-- Business sources, deleted Rubber Bill / Income-Expense tombstones, permanent
-- document deletion evidence, and managed platform logs are intentionally excluded.

create table public.history_retention_settings (
  singleton boolean primary key default true check (singleton),
  retention_days integer not null default 15 check (retention_days between 1 and 365),
  updated_by uuid references public.profiles(id),
  updated_by_name text,
  updated_at timestamptz not null default now()
);

insert into public.history_retention_settings(singleton, retention_days)
values (true, 15)
on conflict (singleton) do nothing;

create table public.history_retention_change_audits (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id),
  actor_name text not null,
  old_retention_days integer not null check (old_retention_days between 1 and 365),
  new_retention_days integer not null check (new_retention_days between 1 and 365),
  eligible_counts jsonb not null check (jsonb_typeof(eligible_counts) = 'object'),
  changed_at timestamptz not null default now()
);

create table public.history_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  retention_days integer not null check (retention_days between 1 and 365),
  cutoff_date date not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  deleted_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(deleted_counts) = 'object'),
  has_more boolean,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table private.time_payroll_employment_boundaries (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_end_action_on date not null,
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table private.approval_request_replay_guards (
  workflow text not null,
  request_key text not null,
  terminal_status text not null,
  completed_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (workflow, request_key)
);

create index history_cleanup_runs_completed_idx
  on public.history_cleanup_runs(coalesce(completed_at, started_at));
create index history_retention_change_audits_changed_idx
  on public.history_retention_change_audits(changed_at desc);
create index time_tracking_audit_logs_retention_idx
  on public.time_tracking_audit_logs(created_at, id);
create index admin_account_audit_logs_retention_idx
  on public.admin_account_audit_logs(status, coalesce(completed_at, created_at), id);
create index income_expense_approval_retention_idx
  on public.income_expense_approval_requests(request_status, coalesce(decided_at, updated_at), id);
create index cash_transfer_delete_retention_idx
  on public.cash_transfer_delete_requests(request_status, coalesce(decided_at, updated_at), id);
create index rubber_bill_approval_retention_idx
  on public.rubber_bill_approval_requests(request_status, coalesce(approved_at, requested_at), id);
create index stock_entry_approval_retention_idx
  on public.stock_entry_approval_requests(request_status, coalesce(decided_at, updated_at), id);
create index stock_product_approval_retention_idx
  on public.stock_product_approval_requests(request_status, coalesce(decided_at, updated_at), id);

alter table public.history_retention_settings enable row level security;
alter table public.history_retention_change_audits enable row level security;
alter table public.history_cleanup_runs enable row level security;

create policy history_retention_settings_manager_read
  on public.history_retention_settings for select to authenticated
  using (private.can_access_super_admin_features());
create policy history_retention_change_audits_manager_read
  on public.history_retention_change_audits for select to authenticated
  using (private.can_access_super_admin_features());
create policy history_cleanup_runs_manager_read
  on public.history_cleanup_runs for select to authenticated
  using (private.can_access_super_admin_features());

revoke all on public.history_retention_settings from public, anon, authenticated;
revoke all on public.history_retention_change_audits from public, anon, authenticated;
revoke all on public.history_cleanup_runs from public, anon, authenticated;
revoke all on private.time_payroll_employment_boundaries from public, anon, authenticated;
revoke all on private.approval_request_replay_guards from public, anon, authenticated;
grant select on public.history_retention_settings to authenticated;
grant select on public.history_retention_change_audits to authenticated;
grant select on public.history_cleanup_runs to authenticated;
grant all on public.history_retention_settings to service_role;
grant all on public.history_retention_change_audits to service_role;
grant all on public.history_cleanup_runs to service_role;
grant all on private.time_payroll_employment_boundaries to service_role;
grant all on private.approval_request_replay_guards to service_role;

create or replace function private.history_retention_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.retention_days from public.history_retention_settings s where s.singleton = true),
    15
  )
$$;

create or replace function private.history_retention_cutoff_date(p_days integer default null)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (current_timestamp at time zone 'Asia/Bangkok')::date
    - (coalesce(p_days, private.history_retention_days()) - 1)
$$;

create or replace function private.history_terminal_row_visible(
  p_status text,
  p_completed_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_status = 'pending'
    or (p_completed_at at time zone 'Asia/Bangkok')::date
      >= private.history_retention_cutoff_date()
$$;

create or replace function private.capture_time_payroll_employment_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end_on date;
begin
  if new.target_table = 'time_payroll_active_periods'
     and new.action = 'SET_PAYROLL_ACTIVE_PERIOD'
     and new.new_data @> '{"action":"END"}'::jsonb
     and new.new_data ->> 'selectedEffectiveOn' ~ '^\d{4}-\d{2}-\d{2}$'
  then
    v_end_on := (new.new_data ->> 'selectedEffectiveOn')::date;
    insert into private.time_payroll_employment_boundaries(
      profile_id, last_end_action_on, recorded_at, updated_at
    ) values (new.record_id, v_end_on, new.created_at, now())
    on conflict (profile_id) do update
    set last_end_action_on = excluded.last_end_action_on,
        recorded_at = excluded.recorded_at,
        updated_at = now()
    where excluded.recorded_at >= private.time_payroll_employment_boundaries.recorded_at;
  end if;
  return new;
end
$$;

insert into private.time_payroll_employment_boundaries(
  profile_id, last_end_action_on, recorded_at
)
select distinct on (al.record_id)
  al.record_id,
  (al.new_data ->> 'selectedEffectiveOn')::date,
  al.created_at
from public.time_tracking_audit_logs al
where al.target_table = 'time_payroll_active_periods'
  and al.action = 'SET_PAYROLL_ACTIVE_PERIOD'
  and al.new_data @> '{"action":"END"}'::jsonb
  and al.new_data ->> 'selectedEffectiveOn' ~ '^\d{4}-\d{2}-\d{2}$'
order by al.record_id, al.created_at desc
on conflict (profile_id) do update
set last_end_action_on = excluded.last_end_action_on,
    recorded_at = excluded.recorded_at,
    updated_at = now()
where excluded.recorded_at >= private.time_payroll_employment_boundaries.recorded_at;

drop trigger if exists capture_time_payroll_employment_boundary
  on public.time_tracking_audit_logs;
create trigger capture_time_payroll_employment_boundary
  after insert on public.time_tracking_audit_logs
  for each row execute function private.capture_time_payroll_employment_boundary();

-- Replace the one legacy source-of-truth read without copying the large active-period
-- function. The asserted source fragment is fixed by the preceding migration.
do $migration$
declare
  v_definition text;
  v_old text := $old$select (al.new_data ->> 'selectedEffectiveOn')::date
          into v_last_end_action_on
        from public.time_tracking_audit_logs al
        where al.target_table = 'time_payroll_active_periods'
          and al.record_id = p_profile_id
          and al.action = 'SET_PAYROLL_ACTIVE_PERIOD'
          and al.new_data @> '{"action":"END"}'::jsonb
          and al.new_data ->> 'selectedEffectiveOn' ~ '^\d{4}-\d{2}-\d{2}$'
        order by al.created_at desc
        limit 1;$old$;
  v_new text := $new$select b.last_end_action_on
          into v_last_end_action_on
        from private.time_payroll_employment_boundaries b
        where b.profile_id = p_profile_id;$new$;
begin
  select pg_get_functiondef(
    'public.set_time_payroll_active_period(uuid,text,date)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'HISTORY_RETENTION_MIGRATION_BLOCKED: payroll audit dependency changed';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

create or replace function private.archive_terminal_approval_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_workflow text;
  v_request_key text;
  v_completed_at timestamptz;
begin
  if v_old ->> 'request_status' = 'pending' then return old; end if;
  v_workflow := case tg_table_name
    when 'income_expense_approval_requests' then 'income_expense'
    when 'rubber_bill_approval_requests' then 'rubber_bill'
    when 'stock_entry_approval_requests' then 'stock_entry'
    when 'stock_product_approval_requests' then 'stock_product'
  end;
  v_request_key := coalesce(
    nullif(v_old ->> 'request_idempotency_key', ''),
    nullif(v_old ->> 'idempotency_key', '')
  );
  v_completed_at := coalesce(
    nullif(v_old ->> 'decided_at', '')::timestamptz,
    nullif(v_old ->> 'approved_at', '')::timestamptz,
    nullif(v_old ->> 'updated_at', '')::timestamptz,
    nullif(v_old ->> 'requested_at', '')::timestamptz,
    nullif(v_old ->> 'created_at', '')::timestamptz,
    now()
  );
  if v_workflow is not null and v_request_key is not null then
    insert into private.approval_request_replay_guards(
      workflow, request_key, terminal_status, completed_at
    ) values (
      v_workflow, v_request_key, v_old ->> 'request_status', v_completed_at
    )
    on conflict (workflow, request_key) do nothing;
  end if;
  return old;
end
$$;

create or replace function private.reject_expired_approval_request_replay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_workflow text;
  v_request_key text;
begin
  v_workflow := case tg_table_name
    when 'income_expense_approval_requests' then 'income_expense'
    when 'rubber_bill_approval_requests' then 'rubber_bill'
    when 'stock_entry_approval_requests' then 'stock_entry'
    when 'stock_product_approval_requests' then 'stock_product'
  end;
  v_request_key := coalesce(
    nullif(v_new ->> 'request_idempotency_key', ''),
    nullif(v_new ->> 'idempotency_key', '')
  );
  if v_workflow is not null and v_request_key is not null and exists (
    select 1 from private.approval_request_replay_guards g
    where g.workflow = v_workflow and g.request_key = v_request_key
  ) then
    raise exception 'APPROVAL_REQUEST_EXPIRED_REPLAY: คำขอนี้สิ้นสุดและพ้นช่วงประวัติแล้ว';
  end if;
  return new;
end
$$;

do $triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'income_expense_approval_requests',
    'rubber_bill_approval_requests',
    'stock_entry_approval_requests',
    'stock_product_approval_requests'
  ] loop
    execute format('drop trigger if exists archive_terminal_approval_request on public.%I', v_table);
    execute format(
      'create trigger archive_terminal_approval_request before delete on public.%I for each row execute function private.archive_terminal_approval_request()',
      v_table
    );
    execute format('drop trigger if exists reject_expired_approval_request_replay on public.%I', v_table);
    execute format(
      'create trigger reject_expired_approval_request_replay before insert on public.%I for each row execute function private.reject_expired_approval_request_replay()',
      v_table
    );
  end loop;
end
$triggers$;

create or replace function private.guard_approved_rubber_bill_request_history()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.request_status = 'approved'
     and coalesce(current_setting('app.history_retention_cleanup', true), '') <> 'on'
  then
    raise exception 'ประวัติคำขอที่อนุมัติแล้วแก้ไขหรือลบไม่ได้';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace function private.history_retention_preview_rows(p_days integer)
returns table(group_key text, eligible_count bigint, oldest_date date)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select private.history_retention_cutoff_date(p_days) as cutoff
  ), groups as (
    select 'dashboard_money_events'::text group_key, event_date item_date
    from public.dashboard_money_events, bounds where event_date < cutoff
    union all
    select 'time_tracking_audit_logs', (created_at at time zone 'Asia/Bangkok')::date
    from public.time_tracking_audit_logs, bounds
    where (created_at at time zone 'Asia/Bangkok')::date < cutoff
    union all
    select 'admin_account_audit_logs', (coalesce(completed_at, created_at) at time zone 'Asia/Bangkok')::date
    from public.admin_account_audit_logs, bounds
    where status <> 'pending'
      and (coalesce(completed_at, created_at) at time zone 'Asia/Bangkok')::date < cutoff
    union all
    select 'income_expense_approval_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.income_expense_approval_requests, bounds
    where request_status <> 'pending'
      and (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date < cutoff
    union all
    select 'cash_transfer_delete_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.cash_transfer_delete_requests, bounds
    where request_status <> 'pending'
      and (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date < cutoff
    union all
    select 'rubber_bill_approval_requests', (coalesce(approved_at, requested_at) at time zone 'Asia/Bangkok')::date
    from public.rubber_bill_approval_requests, bounds
    where request_status <> 'pending'
      and (coalesce(approved_at, requested_at) at time zone 'Asia/Bangkok')::date < cutoff
    union all
    select 'stock_entry_approval_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.stock_entry_approval_requests, bounds
    where request_status <> 'pending'
      and (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date < cutoff
    union all
    select 'stock_product_approval_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.stock_product_approval_requests, bounds
    where request_status <> 'pending'
      and (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date < cutoff
    union all
    select 'scheduler_run_history', (start_time at time zone 'Asia/Bangkok')::date
    from cron.job_run_details, bounds
    where (start_time at time zone 'Asia/Bangkok')::date < cutoff
    union all
    select 'cleanup_run_history', (coalesce(completed_at, started_at) at time zone 'Asia/Bangkok')::date
    from public.history_cleanup_runs, bounds
    where status <> 'running'
      and (coalesce(completed_at, started_at) at time zone 'Asia/Bangkok')::date < cutoff
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
  select jsonb_build_object(
    'status', r.status, 'retentionDays', r.retention_days,
    'cutoffDate', r.cutoff_date, 'deletedCounts', r.deleted_counts,
    'hasMore', r.has_more, 'errorMessage', r.error_message,
    'startedAt', r.started_at, 'completedAt', r.completed_at
  ) into v_last_cleanup
  from public.history_cleanup_runs r order by r.started_at desc limit 1;
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

create or replace function private.cleanup_history_retention(p_batch_size integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := private.history_retention_days();
  v_cutoff date := private.history_retention_cutoff_date();
  v_run_id uuid;
  v_count bigint;
  v_counts jsonb := '{}'::jsonb;
  v_has_more boolean;
  v_error text;
begin
  if p_batch_size not between 1 and 5000 then
    raise exception 'HISTORY_RETENTION_BATCH_INVALID';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('history-retention-cleanup', 0)) then
    return jsonb_build_object('status', 'skipped', 'reason', 'already_running');
  end if;
  insert into public.history_cleanup_runs(retention_days, cutoff_date, status)
  values (v_days, v_cutoff, 'running') returning id into v_run_id;
  begin
    update public.admin_account_audit_logs
    set status = 'unknown', error_code = 'PENDING_TIMEOUT', completed_at = now()
    where id in (
      select id from public.admin_account_audit_logs
      where status = 'pending' and created_at < now() - interval '24 hours'
      order by created_at, id limit p_batch_size
    );

    with doomed as (select id from public.dashboard_money_events where event_date < v_cutoff order by event_date, id limit p_batch_size)
    delete from public.dashboard_money_events t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('dashboard_money_events', v_count);

    with doomed as (select id from public.time_tracking_audit_logs where (created_at at time zone 'Asia/Bangkok')::date < v_cutoff order by created_at, id limit p_batch_size)
    delete from public.time_tracking_audit_logs t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('time_tracking_audit_logs', v_count);

    with doomed as (select id from public.admin_account_audit_logs where status <> 'pending' and (coalesce(completed_at, created_at) at time zone 'Asia/Bangkok')::date < v_cutoff order by coalesce(completed_at, created_at), id limit p_batch_size)
    delete from public.admin_account_audit_logs t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('admin_account_audit_logs', v_count);

    perform set_config('app.history_retention_cleanup', 'on', true);
    with doomed as (select id from public.income_expense_approval_requests where request_status <> 'pending' and (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date < v_cutoff order by coalesce(decided_at, updated_at), id limit p_batch_size)
    delete from public.income_expense_approval_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('income_expense_approval_requests', v_count);

    with doomed as (select id from public.cash_transfer_delete_requests where request_status <> 'pending' and (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date < v_cutoff order by coalesce(decided_at, updated_at), id limit p_batch_size)
    delete from public.cash_transfer_delete_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('cash_transfer_delete_requests', v_count);

    with doomed as (select id from public.rubber_bill_approval_requests where request_status <> 'pending' and (coalesce(approved_at, requested_at) at time zone 'Asia/Bangkok')::date < v_cutoff order by coalesce(approved_at, requested_at), id limit p_batch_size)
    delete from public.rubber_bill_approval_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('rubber_bill_approval_requests', v_count);

    with doomed as (select id from public.stock_entry_approval_requests where request_status <> 'pending' and (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date < v_cutoff order by coalesce(decided_at, updated_at), id limit p_batch_size)
    delete from public.stock_entry_approval_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('stock_entry_approval_requests', v_count);

    with doomed as (select id from public.stock_product_approval_requests where request_status <> 'pending' and (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date < v_cutoff order by coalesce(decided_at, updated_at), id limit p_batch_size)
    delete from public.stock_product_approval_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('stock_product_approval_requests', v_count);

    with doomed as (select runid from cron.job_run_details where (start_time at time zone 'Asia/Bangkok')::date < v_cutoff order by start_time, runid limit p_batch_size)
    delete from cron.job_run_details t using doomed d where t.runid = d.runid;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('scheduler_run_history', v_count);

    with doomed as (select id from public.history_cleanup_runs where id <> v_run_id and status <> 'running' and (coalesce(completed_at, started_at) at time zone 'Asia/Bangkok')::date < v_cutoff order by coalesce(completed_at, started_at), id limit p_batch_size)
    delete from public.history_cleanup_runs t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count; v_counts := v_counts || jsonb_build_object('cleanup_run_history', v_count);

    select exists(select 1 from private.history_retention_preview_rows(v_days) p where p.eligible_count > 0)
      into v_has_more;
    update public.history_cleanup_runs
    set status = 'succeeded', deleted_counts = v_counts,
        has_more = v_has_more, completed_at = now()
    where id = v_run_id;
    return jsonb_build_object('status', 'succeeded', 'runId', v_run_id,
      'deletedCounts', v_counts, 'hasMore', v_has_more);
  exception when others then
    v_error := left(sqlerrm, 500);
    update public.history_cleanup_runs
    set status = 'failed', error_message = v_error, has_more = true, completed_at = now()
    where id = v_run_id;
    return jsonb_build_object('status', 'failed', 'runId', v_run_id, 'errorMessage', v_error);
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
  if p_retention_days not between 1 and 365 then
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
  v_cleanup := private.cleanup_history_retention(1000);
  return public.get_history_retention_overview(p_retention_days)
    || jsonb_build_object('cleanup', v_cleanup);
end
$$;

-- Visibility follows the setting immediately even while bounded deletion catches up.
drop policy if exists dashboard_money_events_select_scope on public.dashboard_money_events;
create policy dashboard_money_events_select_scope
  on public.dashboard_money_events for select to authenticated
  using (can_access_location(location_id) and event_date >= private.history_retention_cutoff_date());

drop policy if exists time_tracking_audit_logs_read_global_manager on public.time_tracking_audit_logs;
create policy time_tracking_audit_logs_read_global_manager
  on public.time_tracking_audit_logs for select to authenticated
  using (private.is_global_time_payroll_manager()
    and (created_at at time zone 'Asia/Bangkok')::date >= private.history_retention_cutoff_date());

drop policy if exists income_expense_approval_requests_read on public.income_expense_approval_requests;
create policy income_expense_approval_requests_read
  on public.income_expense_approval_requests for select to authenticated
  using (private.can_access_business_modules()
    and (can_access_super_admin_features() or requested_by_user_id = auth.uid() or can_access_location(location_id))
    and private.history_terminal_row_visible(request_status, coalesce(decided_at, updated_at)));

drop policy if exists "cash transfer delete requests read" on public.cash_transfer_delete_requests;
create policy "cash transfer delete requests read"
  on public.cash_transfer_delete_requests for select to authenticated
  using (private.can_access_business_modules()
    and (private.can_access_super_admin_features() or requested_by_user_id = auth.uid() or private.can_access_location(source_location_id))
    and private.history_terminal_row_visible(request_status, coalesce(decided_at, updated_at)));

drop policy if exists "system managers read rubber bill approval requests" on public.rubber_bill_approval_requests;
create policy "system managers read rubber bill approval requests"
  on public.rubber_bill_approval_requests for select to authenticated
  using (private.is_active_user() and can_access_super_admin_features()
    and private.history_terminal_row_visible(request_status, coalesce(approved_at, requested_at)));

drop policy if exists stock_entry_approval_requests_read on public.stock_entry_approval_requests;
create policy stock_entry_approval_requests_read
  on public.stock_entry_approval_requests for select to authenticated
  using (private.can_access_business_modules()
    and (can_access_super_admin_features() or requested_by_user_id = auth.uid()
      or can_access_location(location_id)
      or (target_location_id is not null and can_access_location(target_location_id)))
    and private.history_terminal_row_visible(request_status, coalesce(decided_at, updated_at)));

drop policy if exists stock_product_approval_requests_read on public.stock_product_approval_requests;
create policy stock_product_approval_requests_read
  on public.stock_product_approval_requests for select to authenticated
  using (private.can_access_business_modules()
    and (can_access_super_admin_features() or requested_by_user_id = auth.uid())
    and private.history_terminal_row_visible(request_status, coalesce(decided_at, updated_at)));

create or replace function public.get_dashboard_money_history(
  p_location_id uuid,
  p_event_date date default null,
  p_action text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  retention_days integer := private.history_retention_days();
  today_bangkok date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  from_date date := private.history_retention_cutoff_date(retention_days);
  selected_date date;
  normalized_action text := nullif(p_action, 'all');
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if normalized_action is not null and normalized_action not in ('create', 'update', 'delete') then
    raise exception 'Invalid money history action';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'Invalid money history cursor';
  end if;
  if p_event_date is not null and (p_event_date < from_date or p_event_date > today_bangkok) then
    raise exception 'Money history date is outside retention window';
  end if;
  selected_date := p_event_date;
  if selected_date is null then
    select max(event_date) into selected_date from public.dashboard_money_events
    where location_id = p_location_id and event_date between from_date and today_bangkok;
    selected_date := coalesce(selected_date, today_bangkok);
  end if;
  return (
    with filtered as (
      select event.* from public.dashboard_money_events event
      where event.location_id = p_location_id and event.event_date = selected_date
        and (normalized_action is null or event.action = normalized_action)
        and (p_cursor_at is null or (event.occurred_at, event.id) < (p_cursor_at, p_cursor_id))
      order by event.occurred_at desc, event.id desc limit page_size + 1
    ), visible as (
      select * from filtered order by occurred_at desc, id desc limit page_size
    ), counts as (
      select count(*) total,
        count(*) filter (where action = 'create') created,
        count(*) filter (where action = 'update') updated,
        count(*) filter (where action = 'delete') deleted,
        max(occurred_at) latest_at
      from public.dashboard_money_events
      where location_id = p_location_id and event_date = selected_date
    )
    select jsonb_build_object(
      'selectedDate', selected_date, 'availableFrom', from_date,
      'availableTo', today_bangkok, 'retentionDays', retention_days,
      'counts', jsonb_build_object('all', counts.total, 'create', counts.created,
        'update', counts.updated, 'delete', counts.deleted),
      'latestAt', counts.latest_at,
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'sourceType', source_type, 'action', action, 'kind', kind,
        'number', number, 'title', title, 'direction', direction,
        'amount', round(amount, 2), 'actorName', actor_name, 'occurredAt', occurred_at
      ) order by occurred_at desc, id desc) from visible), '[]'::jsonb),
      'nextCursor', case when (select count(*) from filtered) > page_size then (
        select jsonb_build_object('at', occurred_at, 'id', id)
        from visible order by occurred_at desc, id desc offset page_size - 1 limit 1
      ) else null end
    ) from counts
  );
end
$$;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job
    where jobname in ('lanflow-dashboard-money-history-retention', 'lanflow-temporary-history-retention')
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'lanflow-temporary-history-retention',
    '10 17 * * *',
    'select private.cleanup_history_retention(1000)'
  );
end
$$;

drop function if exists private.prune_dashboard_money_events();

revoke all on function private.history_retention_days() from public;
revoke all on function private.history_retention_cutoff_date(integer) from public;
revoke all on function private.history_terminal_row_visible(text, timestamptz) from public;
revoke all on function private.capture_time_payroll_employment_boundary() from public;
revoke all on function private.archive_terminal_approval_request() from public;
revoke all on function private.reject_expired_approval_request_replay() from public;
revoke all on function private.history_retention_preview_rows(integer) from public;
revoke all on function private.cleanup_history_retention(integer) from public;
revoke all on function public.get_history_retention_overview(integer) from public, anon;
revoke all on function public.save_history_retention_settings(integer, timestamptz) from public, anon;
grant execute on function private.history_retention_days() to authenticated, service_role;
grant execute on function private.history_retention_cutoff_date(integer) to authenticated, service_role;
grant execute on function private.history_terminal_row_visible(text, timestamptz) to authenticated, service_role;
grant execute on function private.cleanup_history_retention(integer) to service_role;
grant execute on function public.get_history_retention_overview(integer) to authenticated, service_role;
grant execute on function public.save_history_retention_settings(integer, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
