-- Source tracing found two additional seams: round-robin branch selection and
-- the actual dashboard actor must be preserved independently of the bill creator.
do $$ declare body text; begin
  body:=pg_get_functiondef('private.process_rubber_queue(integer)'::regprocedure);
  body:=replace(body,
    'for candidate in select command_id,location_id from private.rubber_queue_jobs
    where state in (''queued'',''retry_wait'',''paused'') and next_attempt_at<=clock_timestamp()
    order by next_attempt_at,accepted_at,command_id limit greatest(1,least(coalesce(p_limit,20),100))*4',
    'for candidate in select command_id,location_id from (
      select command_id,location_id,next_attempt_at,accepted_at,
        row_number() over(partition by location_id order by next_attempt_at,accepted_at,command_id) as branch_position
      from private.rubber_queue_jobs where state in (''queued'',''retry_wait'',''paused'')
        and next_attempt_at<=clock_timestamp()) due
      order by branch_position,next_attempt_at,accepted_at,command_id
      limit greatest(1,least(coalesce(p_limit,20),100))*4');
  body:=replace(body,'elsif j.action=''create'' and not exists',
    'elsif j.action in (''update'',''delete'') and coalesce(r->>''errorMessage'',message) in (
       ''Revision mismatch'',''รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน'',
       ''รายการหักสินค้าต้องเลือกสินค้าในสต็อกและระบุจำนวน'',''ไม่พบสินค้าในสต็อกสำหรับรายการหักสินค้า'',
       ''สต็อกสินค้าไม่พอสำหรับรายการหักสินค้าในบิลยาง'',''Customer not found'') then
       terminal:=true; code:=''BUSINESS_REJECTED'';
     elsif j.action=''create'' and not exists');
  body:=replace(body,'''^(ข้อมูลตัวเลขในบิลยางไม่ถูกต้อง|วันที่บิลไม่ถูกต้อง|ราคายางต้อง|Invalid bill|Invalid item|น้ำหนัก|ราคา)''',
    '''^(ข้อมูลตัวเลขในบิลยางไม่ถูกต้อง|วันที่บิลไม่ถูกต้อง|ราคายางต้อง|Invalid bill|Invalid item|น้ำหนัก|ราคา|Customer not found|deductWeight must|รายการหักสินค้า|ไม่พบสินค้าในสต็อก|สต็อกสินค้าไม่พอ)''');
  execute body;
  body:=pg_get_functiondef('private.capture_dashboard_money_source()'::regprocedure);
  body:=replace(body,'  perform private.reconcile_dashboard_money_source(
    v_source_type, v_source_id, v_actor_user_id, v_actor_name',
    '  if v_source_type=''rubber_bill'' and (private.rubber_execution_job()).command_id is not null then
    v_actor_user_id:=private.rubber_execution_actor();
    select name into v_actor_name from public.profiles where id=v_actor_user_id;
  end if;
  perform private.reconcile_dashboard_money_source(
    v_source_type, v_source_id, v_actor_user_id, v_actor_name');
  execute body;
end $$;

-- Invalid offline creates keep a correctable original; unknown failures do not
-- acquire a business terminal outcome. Corrections must be a fresh identity.
do $$ declare body text; begin
  body:=pg_get_functiondef('public.submit_rubber_queue(jsonb)'::regprocedure);
  body:=replace(body,'stale boolean:=false;','stale boolean:=false; correction boolean:=false;');
  body:=replace(body,'    normalized:=private.normalize_rubber_bill_calculation_payload(payload);
    fp:=private.rubber_bill_submission_fingerprint(normalized)',
    '    begin
      normalized:=private.normalize_rubber_bill_calculation_payload(payload);
      fp:=private.rubber_bill_submission_fingerprint(normalized);
    exception when raise_exception or invalid_text_representation or numeric_value_out_of_range then
      if action<>''create'' then raise; end if;
      correction:=true; normalized:=payload; fp:=''invalid-''||md5(payload::text);
    end;
    fp:=fp');
  body:=replace(body,'case when stale then ''done'' else ''queued'' end,',
    'case when stale then ''done'' when correction then ''correction_required'' else ''queued'' end,');
  body:=replace(body,'case when stale then ''STALE_COMMAND_CONTEXT'' end)',
    'case when stale then ''STALE_COMMAND_CONTEXT'' when correction then ''CORRECTION_REQUIRED'' end)');
  execute body;
end $$;

create function public.get_rubber_queue_draft(p_command_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j private.rubber_queue_jobs;
begin
  select * into j from private.rubber_queue_jobs where command_id=p_command_id and state='correction_required' and action='create';
  if j.command_id is null or not private.rubber_actor_location(j.location_id) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('commandId',j.command_id,'locationId',j.location_id,'clientTempId',j.client_temp_id,
    'actorUserId',j.actor_user_id,'payload',j.payload);
end $$;
revoke all on function public.get_rubber_queue_draft(uuid) from public,anon;
grant execute on function public.get_rubber_queue_draft(uuid) to authenticated;

create or replace function private.rubber_bill_report_blockers(p_location_id uuid,p_cutoff_at timestamptz)
returns table(blocker_type text,blocker_id uuid) language sql stable security definer set search_path='' as $$
  select * from private.rubber_bill_report_blockers_before_queue(p_location_id,p_cutoff_at)
  union all
  select 'central_queue',j.command_id from private.rubber_queue_jobs j
  where j.location_id=p_location_id and j.state<>'done' and j.accepted_at<=p_cutoff_at
    and not exists(select 1 from public.rubber_bill_approval_requests a
      where a.location_id=j.location_id and a.request_status='pending'
        and (a.client_temp_id=j.client_temp_id or a.id=j.target_request_id) and a.requested_at<=p_cutoff_at)
    and not exists(select 1 from private.rubber_bill_report_blockers_before_queue(p_location_id,p_cutoff_at) old
      join public.rubber_bills b on b.id=old.blocker_id where b.client_temp_id=j.client_temp_id)
$$;
revoke all on function private.rubber_bill_report_blockers(uuid,timestamptz) from public,anon,authenticated;
