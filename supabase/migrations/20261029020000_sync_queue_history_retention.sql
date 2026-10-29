-- Compact history in place: command identity and result remain replay guards.
alter table private.rubber_queue_jobs add column history_purged_at timestamptz;
alter table private.rubber_command_receipts add column resolved_at timestamptz;

create function private.stamp_rubber_command_resolution() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.result->>'status' is distinct from 'pending_approval' then
    if TG_OP = 'INSERT' then new.resolved_at := clock_timestamp();
    elsif old.result->>'status' = 'pending_approval' then new.resolved_at := clock_timestamp();
    else new.resolved_at := coalesce(old.resolved_at,new.resolved_at); end if;
  else new.resolved_at := null; end if;
  return new;
end $$;
revoke all on function private.stamp_rubber_command_resolution() from public,anon,authenticated;
create trigger stamp_rubber_command_resolution before insert or update on private.rubber_command_receipts
for each row execute function private.stamp_rubber_command_resolution();
-- Unknown historical resolution times start a fresh window, never expire early.
update private.rubber_command_receipts set resolved_at=clock_timestamp()
where result->>'status' is distinct from 'pending_approval';

create function private.rubber_queue_history_finished_at(j private.rubber_queue_jobs)
returns timestamptz language sql stable security definer set search_path='' as $$
  select case when j.state <> 'done' or j.history_purged_at is not null then null
    when j.result->>'status' = 'pending_approval' then (
      select greatest(j.completed_at,r.resolved_at) from private.rubber_command_receipts r
      where r.command_id=j.command_id and r.resolved_at is not null
        and r.result->>'status' is distinct from 'pending_approval')
    else j.completed_at end
$$;
revoke all on function private.rubber_queue_history_finished_at(private.rubber_queue_jobs) from public,anon,authenticated;
create index rubber_queue_history_retention on private.rubber_queue_jobs(completed_at,command_id)
where state='done' and history_purged_at is null;

create function private.compact_rubber_queue_history(p_days integer,p_batch_size integer)
returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
  if p_batch_size is null or p_batch_size not between 1 and 5000 then raise exception 'HISTORY_RETENTION_BATCH_INVALID'; end if;
  with candidates as (
    select j.command_id from private.rubber_queue_jobs j
    where j.state='done' and j.history_purged_at is null
      and j.completed_at < private.history_retention_cutoff_date(p_days)::timestamp at time zone 'Asia/Bangkok'
      and private.rubber_queue_history_finished_at(j) < private.history_retention_cutoff_date(p_days)::timestamp at time zone 'Asia/Bangkok'
    order by j.completed_at,j.command_id limit p_batch_size for update of j skip locked
  )
  update private.rubber_queue_jobs j set payload=null,policy='{}',reference='',target_fingerprint=null,
    retired_by=null,attempts=0,history_purged_at=clock_timestamp(),version=j.version+1,
    result=case when j.result->>'status'='pending_approval' then
      (select r.result from private.rubber_command_receipts r where r.command_id=j.command_id) else j.result end
  from candidates c where j.command_id=c.command_id;
  get diagnostics n=row_count;
  return n;
end $$;
revoke all on function private.compact_rubber_queue_history(integer,integer) from public,anon,authenticated;

-- Extend the existing preview, cheap work check and bounded worker together.
do $patch$
declare body text; before_body text;
begin
  body:=pg_get_functiondef('private.history_retention_preview_rows(integer)'::regprocedure);
  before_body:=body;
  body:=replace(body, '), keys(group_key)', $sql$
    union all
    select 'sync_queue_history', (private.rubber_queue_history_finished_at(j) at time zone 'Asia/Bangkok')::date
    from private.rubber_queue_jobs j,bounds
    where j.state='done' and j.history_purged_at is null and j.completed_at < cutoff_at
      and private.rubber_queue_history_finished_at(j) < cutoff_at
  ), keys(group_key)$sql$);
  body:=replace(body, '(''scheduler_run_history''), (''cleanup_run_history'')',
    '(''scheduler_run_history''), (''cleanup_run_history''), (''sync_queue_history'')');
  if body=before_body or strpos(body,'(''sync_queue_history'')')=0 then raise exception 'RETENTION_PREVIEW_PATCH_FAILED'; end if;
  execute body;

  body:=pg_get_functiondef('private.history_retention_has_work(integer)'::regprocedure);
  before_body:=body;
  body:=replace(body, 'or exists (select 1 from public.admin_account_audit_logs where status', $sql$
    or exists (select 1 from private.rubber_queue_jobs j,bounds
      where j.state='done' and j.history_purged_at is null and j.completed_at < cutoff_at
        and private.rubber_queue_history_finished_at(j) < cutoff_at)
    or exists (select 1 from public.admin_account_audit_logs where status$sql$);
  if body=before_body then raise exception 'RETENTION_WORK_PATCH_FAILED'; end if;
  execute body;

  body:=pg_get_functiondef('private.cleanup_history_retention(integer)'::regprocedure);
  before_body:=body;
  body:=replace(body, 'v_has_more := private.history_retention_has_work(v_days);',
    'v_count := private.compact_rubber_queue_history(v_days,p_batch_size);
    v_counts := v_counts || jsonb_build_object(''sync_queue_history'',v_count);
    v_has_more := private.history_retention_has_work(v_days);');
  if body=before_body then raise exception 'RETENTION_WORKER_PATCH_FAILED'; end if;
  execute body;

  -- Expired history disappears immediately after a setting change, before compaction.
  body:=pg_get_functiondef('public.list_rubber_queue(uuid,boolean,timestamptz,uuid,integer,text)'::regprocedure);
  before_body:=body;
  body:=replace(body, 'then state=''done'' else', 'then state=''done'' and history_purged_at is null
    and (private.rubber_queue_history_finished_at(rubber_queue_jobs) is null
      or private.rubber_queue_history_finished_at(rubber_queue_jobs) >= private.history_retention_cutoff_date()::timestamp at time zone ''Asia/Bangkok'') else');
  body:=replace(body, 'and error_code is not null', 'and history_purged_at is null
    and (private.rubber_queue_history_finished_at(rubber_queue_jobs) is null
      or private.rubber_queue_history_finished_at(rubber_queue_jobs) >= private.history_retention_cutoff_date()::timestamp at time zone ''Asia/Bangkok'')
    and error_code is not null');
  if body=before_body then raise exception 'RETENTION_LIST_PATCH_FAILED'; end if;
  execute body;
end $patch$;
