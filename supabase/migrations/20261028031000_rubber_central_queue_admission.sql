create function private.rubber_queue_view(j private.rubber_queue_jobs) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('commandId',j.command_id,'actorUserId',j.actor_user_id,'locationId',j.location_id,
    'clientTempId',j.client_temp_id,'action',j.action,'state',j.state,'acceptedAt',j.accepted_at,
    'version',j.version,'attempts',j.attempts,'nextAttemptAt',j.next_attempt_at,'errorCode',j.error_code,
    'result',j.result,'completedAt',j.completed_at,'canRetire',private.rubber_actor_manager()
      and not exists(select 1 from auth.users where id=j.actor_user_id))
$$;
revoke all on function private.rubber_queue_view(private.rubber_queue_jobs) from public,anon,authenticated;

create function public.submit_rubber_queue(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  j private.rubber_queue_jobs; loc uuid; cmd uuid; target uuid; client text; action text;
  fp text; policy jsonb; normalized jsonb; req public.rubber_bill_approval_requests%rowtype;
  head bigint; expected_head bigint; stale boolean:=false;
begin
  if not private.is_active_user() then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(payload)<>'object' or octet_length(payload::text)>1048576 then raise exception 'INVALID_COMMAND'; end if;
  loc:=(payload->>'locationId')::uuid; cmd:=(payload->>'commandId')::uuid;
  client:=payload->>'clientTempId'; action:=coalesce(payload->>'queueAction',payload->>'operation');
  if cmd is null or loc is null or client is null or length(client) not between 1 and 512
    or payload->>'contractVersion' is distinct from '2' or payload->>'idempotencyKey' is distinct from cmd::text
    or action not in ('create','update','delete','approve','cancel')
    or not private.rubber_actor_location(loc) then raise exception 'FORBIDDEN_OR_INVALID_COMMAND'; end if;
  if action in ('approve','cancel') and not private.rubber_actor_manager() then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(loc::text,0));
  -- Canonical fingerprint ignores only transport fields. Identity/version changes are not retries.
  if action in ('create','update','delete') then
    normalized:=private.normalize_rubber_bill_calculation_payload(payload);
    fp:=private.rubber_bill_submission_fingerprint(normalized)
      || ':' || coalesce(payload->>'expectedCommandGeneration','') || ':' || coalesce(payload->>'expectedQueueVersion','0');
    if (payload->>'expectedCommandGeneration')::bigint<0 or payload->>'expectedCommandGeneration' is null
      or payload->>'operation' is distinct from action then raise exception 'INVALID_COMMAND'; end if;
  else
    target:=(payload->>'targetRequestId')::uuid;
    if target is null or client is distinct from 'request:'||target::text then raise exception 'INVALID_COMMAND'; end if;
    normalized:=payload;
    fp:=action||':'||target::text;
  end if;
  select * into j from private.rubber_queue_jobs where command_id=cmd;
  if j.command_id is not null then
    if j.actor_user_id<>auth.uid() or j.location_id<>loc or j.client_temp_id<>client
      or j.action<>action or j.fingerprint<>fp then raise exception 'COMMAND_MISMATCH'; end if;
    return private.rubber_queue_view(j);
  end if;
  if action in ('approve','cancel') then
    select * into req from public.rubber_bill_approval_requests where id=target and location_id=loc and request_status='pending';
    if req.id is null then raise exception 'REQUEST_CHANGED'; end if;
  else
    insert into private.rubber_queue_heads(location_id,client_temp_id) values(loc,client) on conflict do nothing;
    select version into head from private.rubber_queue_heads where location_id=loc and client_temp_id=client for update;
    expected_head:=coalesce((payload->>'expectedQueueVersion')::bigint,0);
    if expected_head<0 then raise exception 'INVALID_COMMAND'; end if;
    stale:=head<>expected_head;
    if not stale then
      -- A context read permits replacing this exact outstanding proposal.
      update private.rubber_queue_jobs q set state='done',payload=null,completed_at=clock_timestamp(),version=q.version+1,
        error_code='COMMAND_SUPERSEDED',result=jsonb_build_object('status','discarded','commandId',command_id,
          'operation',q.action,'clientTempId',client_temp_id,'errorCode','COMMAND_SUPERSEDED')
        where location_id=loc and client_temp_id=client and state in ('queued','retry_wait','paused','correction_required');
      update private.rubber_queue_heads set version=version+1 where location_id=loc and client_temp_id=client;
    end if;
  end if;
  select to_jsonb(p) into policy from private.resolve_rubber_bill_price_policy_without_quota(loc) p;
  if policy is null or policy->>'central_price' is null then raise exception 'POLICY_UNAVAILABLE'; end if;
  insert into private.rubber_queue_jobs(command_id,location_id,actor_user_id,client_temp_id,action,fingerprint,payload,
    target_request_id,target_fingerprint,policy,state,result,completed_at,error_code)
  values(cmd,loc,auth.uid(),client,action,fp,case when stale then null else normalized end,target,
    case when target is not null then private.rubber_bill_submission_fingerprint(req.proposed_payload) end,policy,
    case when stale then 'done' else 'queued' end,
    case when stale then jsonb_build_object('status','discarded','commandId',cmd,'operation',action,
      'clientTempId',client,'errorCode','STALE_COMMAND_CONTEXT') end,
    case when stale then clock_timestamp() end,case when stale then 'STALE_COMMAND_CONTEXT' end)
  returning * into j;
  return private.rubber_queue_view(j);
end $$;
revoke all on function public.submit_rubber_queue(jsonb) from public,anon;
grant execute on function public.submit_rubber_queue(jsonb) to authenticated;

create function public.get_rubber_queue(p_location_id uuid,p_command_id uuid default null,p_limit integer default 50,
  p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; counts jsonb;
begin
  if not private.rubber_actor_location(p_location_id) then raise exception 'FORBIDDEN'; end if;
  if p_command_id is not null then
    select private.rubber_queue_view(j) into rows from private.rubber_queue_jobs j
      where command_id=p_command_id and location_id=p_location_id;
    return rows;
  end if;
  select coalesce(jsonb_agg(private.rubber_queue_view(j) order by j.accepted_at desc,j.command_id),'[]') into rows
    from (select * from private.rubber_queue_jobs where location_id=p_location_id
      and (p_before is null or accepted_at<p_before)
      order by accepted_at desc,command_id limit greatest(1,least(coalesce(p_limit,50),100))) j;
  select jsonb_build_object('pending',count(*) filter(where state in ('queued','retry_wait','paused','correction_required')),
    'attention',count(*) filter(where state in ('paused','correction_required')),
    'oldestAcceptedAt',min(accepted_at) filter(where state<>'done')) into counts
    from private.rubber_queue_jobs where location_id=p_location_id;
  return jsonb_build_object('rows',rows,'counts',counts);
end $$;
revoke all on function public.get_rubber_queue(uuid,uuid,integer,timestamptz) from public,anon;
grant execute on function public.get_rubber_queue(uuid,uuid,integer,timestamptz) to authenticated;

create function public.manage_rubber_queue(p_command_id uuid,p_version bigint,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.rubber_queue_jobs;
begin
  select * into j from private.rubber_queue_jobs where command_id=p_command_id;
  if j.command_id is null or not private.rubber_actor_location(j.location_id) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.location_id::text,0));
  select * into j from private.rubber_queue_jobs where command_id=p_command_id for update;
  if j.version<>p_version or j.state='done' then raise exception 'QUEUE_CHANGED'; end if;
  if p_action='retry' and j.state<>'correction_required' then
    update private.rubber_queue_jobs set state='queued',next_attempt_at=clock_timestamp(),version=version+1
      where command_id=p_command_id returning * into j;
  elsif p_action='retire' and private.rubber_actor_manager()
    and not exists(select 1 from auth.users where id=j.actor_user_id) then
    update private.rubber_queue_jobs set state='done',payload=null,retired_by=auth.uid(),completed_at=clock_timestamp(),
      version=version+1,error_code='ACCOUNT_CLOSED',result=jsonb_build_object('status','discarded','commandId',command_id,
        'operation',action,'clientTempId',client_temp_id,'errorCode','ACCOUNT_CLOSED')
      where command_id=p_command_id returning * into j;
  else raise exception 'FORBIDDEN_ACTION'; end if;
  return private.rubber_queue_view(j);
end $$;
revoke all on function public.manage_rubber_queue(uuid,bigint,text) from public,anon;
grant execute on function public.manage_rubber_queue(uuid,bigint,text) to authenticated;

-- A new context binds replacement to the last accepted proposal, independently
-- from business generation (which advances only when the original core executes).
alter function public.get_rubber_bill_command_context(uuid,text) rename to get_rubber_bill_context_before_queue;
revoke all on function public.get_rubber_bill_context_before_queue(uuid,text) from public,anon,authenticated;
create function public.get_rubber_bill_command_context(p_location_id uuid,p_client_temp_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb; head bigint;
begin
  context:=public.get_rubber_bill_context_before_queue(p_location_id,p_client_temp_id);
  select version into head from private.rubber_queue_heads where location_id=p_location_id and client_temp_id=p_client_temp_id;
  return context||jsonb_build_object('queueVersion',coalesce(head,0));
end $$;
revoke all on function public.get_rubber_bill_command_context(uuid,text) from public,anon;
grant execute on function public.get_rubber_bill_command_context(uuid,text) to authenticated;

-- Old tabs may replay the same identity through the legacy endpoint. They may
-- observe a receipt but must never become a second executor or resurrect work.
alter function public.sync_rubber_bill(jsonb) rename to sync_rubber_bill_before_central_queue;
revoke all on function public.sync_rubber_bill_before_central_queue(jsonb) from public,anon,authenticated;
create function public.sync_rubber_bill(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.rubber_queue_jobs; ctx private.rubber_queue_jobs; fp text;
begin
  select * into j from private.rubber_queue_jobs where command_id::text=sync_rubber_bill.payload->>'idempotencyKey';
  if j.command_id is not null then
    if not private.rubber_actor_location(j.location_id) or j.actor_user_id<>private.rubber_execution_actor()
      or j.location_id::text is distinct from payload->>'locationId'
      or j.client_temp_id is distinct from payload->>'clientTempId' or j.action is distinct from payload->>'operation' then
      return jsonb_build_object('status','conflict','errorCode','COMMAND_MISMATCH','errorMessage','ข้อมูลคำสั่งไม่ตรงกัน');
    end if;
    fp:=private.try_rubber_bill_submission_fingerprint(payload);
    if fp is null or split_part(j.fingerprint,':',1)<>fp then
      return jsonb_build_object('status','conflict','errorCode','COMMAND_MISMATCH','errorMessage','ข้อมูลคำสั่งไม่ตรงกัน');
    end if;
    if j.state='done' then return j.result; end if;
    ctx:=private.rubber_execution_job();
    if ctx.command_id is distinct from j.command_id then
      return jsonb_build_object('status','failed','errorCode','CENTRAL_QUEUE_PENDING','errorMessage','รายการอยู่ในคิวซิงก์กลาง');
    end if;
  elsif payload->>'centralQueue'='true' then
    return jsonb_build_object('status','failed','errorCode','CENTRAL_ADMISSION_REQUIRED','errorMessage','กรุณาส่งผ่านคิวซิงก์กลาง');
  end if;
  return public.sync_rubber_bill_before_central_queue(payload-'centralQueue'-'expectedQueueVersion');
end $$;
revoke all on function public.sync_rubber_bill(jsonb) from public,anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;
