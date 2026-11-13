-- Preserve exact eligibility; use the existing runid primary key to find a scheduler candidate.
-- EXISTS discards ordering and chooses a sequential heap scan on Production. The scalar
-- ordered lookup retains index traversal without relying on runid/time correlation.
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
    exists (select 1 from public.branch_transfer_delete_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.rubber_bill_approval_requests, bounds where request_status <> 'pending' and coalesce(approved_at, requested_at) < cutoff_at)
    or
    exists (select 1 from public.stock_entry_approval_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    exists (select 1 from public.stock_product_approval_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)
    or
    (select d.runid from cron.job_run_details d, bounds b
      where d.status in ('succeeded', 'failed') and d.start_time < b.cutoff_at
      order by d.runid limit 1) is not null
    or
    exists (select 1 from public.history_cleanup_runs, bounds where status <> 'running' and coalesce(completed_at, started_at) < cutoff_at)
    
    or exists (select 1 from private.rubber_queue_jobs j,bounds
      where j.state='done' and j.history_purged_at is null and j.completed_at < cutoff_at
        and private.rubber_queue_history_finished_at(j) < cutoff_at)
    or exists (select 1 from public.admin_account_audit_logs where status = 'pending' and created_at < now() - interval '24 hours')
$function$;
