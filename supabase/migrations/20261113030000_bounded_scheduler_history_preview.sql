-- Large extension-owned scheduler tables cannot be indexed by the app role.
-- Keep exact counts for small heaps; never scan more than 64 MiB just to open a
-- settings page. NULL means unavailable, never zero or an estimated exact count.
-- This migration changes no policy, executes no cleanup and touches no business rows.
CREATE OR REPLACE FUNCTION private.history_scheduler_preview(p_cutoff_at timestamptz)
RETURNS TABLE(eligible_count bigint, oldest_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF pg_relation_size('cron.job_run_details'::regclass) > 64::bigint * 1024 * 1024 THEN
    RETURN QUERY SELECT null::bigint, null::date;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT count(*), (min(d.start_time) AT TIME ZONE 'Asia/Bangkok')::date
    FROM cron.job_run_details d
    WHERE d.status IN ('succeeded', 'failed') AND d.start_time < p_cutoff_at;
END
$function$;
REVOKE ALL ON FUNCTION private.history_scheduler_preview(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.history_retention_preview_rows(p_days integer)
 RETURNS TABLE(group_key text, eligible_count bigint, oldest_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select private.history_retention_cutoff_date(p_days) as cutoff,
      private.history_retention_cutoff_date(p_days)::timestamp at time zone 'Asia/Bangkok' as cutoff_at
  ), scheduler as materialized (
    select p.* from bounds b cross join lateral private.history_scheduler_preview(b.cutoff_at) p
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
    select 'branch_transfer_delete_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.branch_transfer_delete_requests, bounds
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
    select 'cleanup_run_history', (coalesce(completed_at, started_at) at time zone 'Asia/Bangkok')::date
    from public.history_cleanup_runs, bounds
    where status <> 'running'
      and coalesce(completed_at, started_at) < cutoff_at

    union all
    select 'sync_queue_history', (private.rubber_queue_history_finished_at(j) at time zone 'Asia/Bangkok')::date
    from private.rubber_queue_jobs j,bounds
    where j.state='done' and j.history_purged_at is null and j.completed_at < cutoff_at
      and private.rubber_queue_history_finished_at(j) < cutoff_at
  ), keys(group_key) as (values
    ('dashboard_money_events'), ('time_tracking_audit_logs'),
    ('admin_account_audit_logs'), ('income_expense_approval_requests'),
    ('cash_transfer_delete_requests'), ('branch_transfer_delete_requests'), ('rubber_bill_approval_requests'),
    ('stock_entry_approval_requests'), ('stock_product_approval_requests'),
    ('scheduler_run_history'), ('cleanup_run_history'), ('sync_queue_history')
  )
  select keys.group_key,
    case when keys.group_key = 'scheduler_run_history' then (select eligible_count from scheduler)
      else count(groups.item_date) end,
    case when keys.group_key = 'scheduler_run_history' then (select oldest_date from scheduler)
      else min(groups.item_date) end
  from keys left join groups using (group_key)
  group by keys.group_key
  order by keys.group_key
$function$;

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
    'lastCleanup', v_last_cleanup
  );
end
$function$;
