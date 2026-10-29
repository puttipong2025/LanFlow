create function private.process_rubber_queue(p_limit integer default 20) returns integer
language plpgsql security definer set search_path='' as $$
declare
  candidate record; j private.rubber_queue_jobs; req public.rubber_bill_approval_requests%rowtype;
  bill public.rubber_bills%rowtype; r jsonb; code text; message text; processed integer:=0;
  next_state text; terminal boolean; successful boolean;
begin
  -- A transaction owns an entire attempt. Connection loss rolls back both its
  -- business writes and its receipt; no permanent running lease needs repair.
  for candidate in select command_id,location_id from private.rubber_queue_jobs
    where state in ('queued','retry_wait','paused') and next_attempt_at<=clock_timestamp()
    order by next_attempt_at,accepted_at,command_id limit greatest(1,least(coalesce(p_limit,20),100))*4
  loop
    exit when processed>=greatest(1,least(coalesce(p_limit,20),100));
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.location_id::text,0)) then continue; end if;
    select * into j from private.rubber_queue_jobs where command_id=candidate.command_id
      and state in ('queued','retry_wait','paused') and next_attempt_at<=clock_timestamp() for update skip locked;
    if j.command_id is null then continue; end if;
    processed:=processed+1; r:=null; code:=null; next_state:='retry_wait'; terminal:=false; successful:=false;
    insert into private.rubber_queue_execution values(pg_backend_pid(),txid_current(),j.command_id);
    begin
      if not private.rubber_actor_location(j.location_id)
        or (j.action in ('approve','cancel') and not private.rubber_actor_manager())
        or not exists(select 1 from public.locations where id=j.location_id and is_active) then
        code:='ACTOR_PERMISSION_PAUSED'; next_state:='paused';
      elsif exists(select 1 from public.cash_count_sessions where location_id=j.location_id and status='active')
        or coalesce((private.cash_count_lock_state(j.location_id,clock_timestamp())->>'locked')::boolean,false) then
        code:='CASH_COUNT_PAUSED'; next_state:='paused';
      else
        if j.action in ('approve','cancel') then
          select * into req from public.rubber_bill_approval_requests where id=j.target_request_id
            and location_id=j.location_id and request_status='pending' for update;
          if req.id is null or private.try_rubber_bill_submission_fingerprint(req.proposed_payload) is distinct from j.target_fingerprint then
            code:='REQUEST_CHANGED'; terminal:=true;
          elsif j.action='approve' then
            r:=public.approve_rubber_bill_approval_request(j.target_request_id);
          else
            perform public.delete_rubber_bill_approval_request(j.target_request_id);
            r:=jsonb_build_object('status','cancelled','requestId',j.target_request_id);
          end if;
        else
          select * into bill from public.rubber_bills where location_id=j.location_id and client_temp_id=j.client_temp_id;
          if bill.record_status='deleted' and j.action in ('update','delete') then
            code:='BILL_ALREADY_DELETED'; terminal:=true;
          elsif j.action in ('update','delete') and bill.id is not null and
            (bill.revision_no is distinct from (j.payload->>'expectedRevisionNo')::integer
              or private.active_report_no('rubber_bill',bill.id) is not null
              or private.rubber_bill_has_active_transfer(bill.id)) then
            code:='BILL_CHANGED_OR_LOCKED'; terminal:=true;
          else
            r:=public.sync_rubber_bill(j.payload);
          end if;
        end if;
        successful:=case when j.action='approve' then r->>'status'='approved' and r->'syncResult'->>'status'='synced'
          when j.action='cancel' then r->>'status'='cancelled'
          else (r->>'status'='synced' and r->>'id' is not null and r->>'revisionNo' is not null)
            or (r->>'status'='pending_approval' and r->>'requestId' is not null)
            or r->>'status'='discarded' end;
        if successful then terminal:=true;
        elsif not terminal then
          -- JSON failures must roll back any partial core writes too.
          raise exception using errcode='P0002',message='ROLLBACK_RUBBER_QUEUE_ATTEMPT';
        end if;
      end if;
    exception
      when others then
        message:=sqlerrm;
        if r->>'errorCode'='STALE_COMMAND_CONTEXT' then
          terminal:=true; code:='STALE_COMMAND_CONTEXT';
        elsif message like '%CASH_COUNT_%' or coalesce(r->>'errorMessage','') like '%CASH_COUNT_%' then
          next_state:='paused'; code:='CASH_COUNT_PAUSED';
        elsif j.action in ('approve','cancel') and (message='Revision mismatch' or message like 'บิลอยู่ในรายงาน%'
          or message='บิลอยู่ในรายการโอนเงินแล้ว จึงอนุมัติไม่ได้') then
          terminal:=true; code:='BILL_CHANGED_OR_LOCKED';
        elsif j.action='create' and not exists(select 1 from public.rubber_bills
          where location_id=j.location_id and client_temp_id=j.client_temp_id)
          and coalesce(r->>'errorMessage',message) ~ '^(ข้อมูลตัวเลขในบิลยางไม่ถูกต้อง|วันที่บิลไม่ถูกต้อง|ราคายางต้อง|Invalid bill|Invalid item|น้ำหนัก|ราคา)' then
          next_state:='correction_required'; code:='CORRECTION_REQUIRED';
        else code:='RETRY_REQUIRED'; end if;
    end;
    if terminal then
      if not coalesce(successful,false) then
        r:=jsonb_build_object('status','discarded','operation',j.action,'clientTempId',j.client_temp_id,'errorCode',code);
      end if;
      r:=r||jsonb_build_object('commandId',j.command_id);
    else r:=null; end if;
    update private.rubber_queue_jobs set state=case when terminal then 'done' else next_state end,
      result=r,error_code=code,attempts=attempts+1,version=version+1,
      next_attempt_at=clock_timestamp()+make_interval(secs=>case when next_state='paused' then 30
        else least(300,5*power(2,least(j.attempts,6))::integer) end),
      completed_at=case when terminal then clock_timestamp() end,
      payload=case when terminal then null else payload end
      where command_id=j.command_id;
    delete from private.rubber_queue_execution where backend_pid=pg_backend_pid() and transaction_id=txid_current();
  end loop;
  return processed;
end $$;
revoke all on function private.process_rubber_queue(integer) from public,anon,authenticated;

-- The legacy wrapper read the date switch directly. Resolve it through the
-- trusted admission policy during worker execution, including overnight delay.
do $$ declare body text; begin
  body:=pg_get_functiondef('public.sync_rubber_bill_before_commands_20261028010000(jsonb)'::regprocedure);
  body:=replace(body,'from public.rubber_bill_approval_settings where id = true',
    'from private.resolve_rubber_bill_price_policy_without_quota(v_location_id)');
  execute body;
end $$;

alter function private.rubber_bill_report_blockers(uuid,timestamptz) rename to rubber_bill_report_blockers_before_queue;
create function private.rubber_bill_report_blockers(p_location_id uuid,p_cutoff_at timestamptz)
returns table(blocker_type text,blocker_id uuid) language sql stable security definer set search_path='' as $$
  select * from private.rubber_bill_report_blockers_before_queue(p_location_id,p_cutoff_at)
  union all
  select 'central_queue',j.command_id from private.rubber_queue_jobs j
  where j.location_id=p_location_id and j.state<>'done' and j.accepted_at<=p_cutoff_at
    and not exists(select 1 from public.rubber_bill_approval_requests a
      where a.location_id=j.location_id and a.request_status='pending'
        and (a.client_temp_id=j.client_temp_id or a.id=j.target_request_id) and a.requested_at<=p_cutoff_at)
$$;
revoke all on function private.rubber_bill_report_blockers(uuid,timestamptz),
  private.rubber_bill_report_blockers_before_queue(uuid,timestamptz) from public,anon,authenticated;

-- pg_cron invokes the private worker as the migration owner, not a browser user.
select cron.schedule('rubber-central-queue','10 seconds','select private.process_rubber_queue(20)');
