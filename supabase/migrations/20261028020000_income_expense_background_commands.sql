-- Durable minimal command receipts outlive disposable approval history.
create table private.income_expense_background_commands (
  command_id uuid primary key,
  actor_user_id uuid not null,
  location_id uuid not null,
  server_id uuid not null,
  client_temp_id text not null,
  operation text not null check (operation in ('update','delete')),
  fingerprint text not null,
  result jsonb not null
);
revoke all on private.income_expense_background_commands from public, anon, authenticated;

create function public.income_expense_background_context(p_server_id uuid, p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.income_expense%rowtype;
begin
  if not coalesce(private.is_active_user(),false) or not public.can_access_location(p_location_id) then
    return jsonb_build_object('status','forbidden');
  end if;
  select * into v from public.income_expense where id=p_server_id and location_id=p_location_id;
  if not found then return jsonb_build_object('status','missing'); end if;
  return jsonb_build_object('status','ok','serverId',v.id,'locationId',v.location_id,
    'clientTempId',v.client_temp_id,'revisionNo',v.revision_no,'recordStatus',v.record_status,
    'billOption',v.bill_option,'approvalPending',exists(select 1 from public.income_expense_approval_requests
      where source_income_expense_id=v.id and request_status='pending'));
end $$;

create function public.sync_income_expense_background(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (payload->>'commandId')::uuid;
  v_actor uuid := (payload->>'actorUserId')::uuid;
  v_location uuid := (payload->>'locationId')::uuid;
  v_server uuid := (payload->>'expectedServerId')::uuid;
  v_op text := payload->>'operation';
  v_fingerprint text := private.income_expense_submission_fingerprint(payload);
  v_saved private.income_expense_background_commands%rowtype;
  v_row public.income_expense%rowtype;
  v_result jsonb;
  v_outcome text;
  v_status text;
  v_identity jsonb;
begin
  if v_actor is distinct from auth.uid() or not coalesce(private.is_active_user(),false)
    or not public.can_access_location(v_location) then
    return jsonb_build_object('status','failed','errorMessage','Location access denied');
  end if;
  if payload->>'contractVersion' is distinct from '2' or payload->>'background' is distinct from 'true'
    or v_op not in ('update','delete') or payload->>'billOption' not in ('รายรับ','ค่าใช้จ่าย') then
    return jsonb_build_object('status','failed','errorMessage','Invalid operation');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('income-background:'||v_id::text,0));
  select * into v_saved from private.income_expense_background_commands where command_id=v_id;
  if found then
    if v_saved.actor_user_id<>v_actor or v_saved.fingerprint<>v_fingerprint then
      return jsonb_build_object('status','failed','errorMessage','ข้อมูลคำขอไม่ตรงกับคำขอเดิม');
    end if;
    -- Never recreate an approval on replay, even after rejection/history cleanup.
    v_result := v_saved.result;
    if v_result->>'outcome'='pending_approval' then
      select request_status into v_status from public.income_expense_approval_requests
        where id=(v_result->>'requestId')::uuid;
      if v_status='rejected' then
        v_result := v_result || jsonb_build_object('outcome','rejected');
      elsif v_status='approved' then
        v_result := v_result || jsonb_build_object('outcome','synced');
      end if;
    end if;
    return v_result;
  end if;
  -- Same source lock as the preserved dispatcher; also serializes cross-tab submits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('income_expense:'||(payload->>'clientTempId')));
  select * into v_row from public.income_expense where id=v_server and location_id=v_location for update;
  if not found or v_row.client_temp_id is distinct from payload->>'clientTempId'
    or v_row.bill_option not in ('รายรับ','ค่าใช้จ่าย') or v_row.bill_option is distinct from payload->>'billOption' then
    return jsonb_build_object('status','failed','errorMessage','ไม่พบรายการรับ-จ่าย');
  end if;
  v_identity := jsonb_build_object('commandId',v_id,'actorUserId',v_actor,'serverId',v_server,
    'locationId',v_location,'clientTempId',v_row.client_temp_id,'operation',v_op);
  if v_row.record_status='deleted' then v_outcome := 'deleted';
  elsif v_row.revision_no is distinct from (payload->>'expectedRevisionNo')::integer then
    v_outcome := 'revision_conflict';
  elsif exists(select 1 from public.income_expense_approval_requests where source_income_expense_id=v_server and request_status='pending') then
    return jsonb_build_object('status','failed','errorMessage','รายการนี้กำลังรออนุมัติการเปลี่ยนแปลง');
  else
    v_result := public.sync_income_expense(payload);
    if v_result->>'status' not in ('synced','pending_approval') then return v_result; end if;
    v_outcome := v_result->>'status';
  end if;
  v_result := coalesce(v_result,'{}'::jsonb) || v_identity || jsonb_build_object('outcome',v_outcome);
  insert into private.income_expense_background_commands values
    (v_id,v_actor,v_location,v_server,v_row.client_temp_id,v_op,v_fingerprint,v_result);
  return v_result;
end $$;

revoke all on function public.income_expense_background_context(uuid,uuid) from public, anon;
revoke all on function public.sync_income_expense_background(jsonb) from public, anon;
grant execute on function public.income_expense_background_context(uuid,uuid) to authenticated;
grant execute on function public.sync_income_expense_background(jsonb) to authenticated;

