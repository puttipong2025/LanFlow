-- Command identity is independent of the business revision. No proposal history
-- is retained here: only a monotonic context and payload-free replay receipts.
create table private.rubber_command_contexts (
  location_id uuid not null references public.locations(id) on delete cascade,
  client_temp_id text not null,
  generation bigint not null default 0 check (generation >= 0),
  v2_enabled boolean not null default false,
  primary key (location_id, client_temp_id)
);
create table private.rubber_command_receipts (
  command_id uuid primary key,
  location_id uuid not null,
  client_temp_id text not null,
  owner_user_id uuid not null,
  operation text not null check (operation in ('create','update','delete')),
  fingerprint text not null,
  result jsonb not null,
  foreign key (location_id,client_temp_id) references private.rubber_command_contexts on delete cascade
);
revoke all on private.rubber_command_contexts, private.rubber_command_receipts from public, anon, authenticated;

create function public.get_rubber_bill_command_context(p_location_id uuid,p_client_temp_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_generation bigint; v_bill public.rubber_bills%rowtype; v_ocr text;
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id)
     or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')) then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการคำสั่งบิลยาง';
  end if;
  select * into v_bill from public.rubber_bills where location_id=p_location_id and client_temp_id=p_client_temp_id;
  select generation into v_generation from private.rubber_command_contexts where location_id=p_location_id and client_temp_id=p_client_temp_id;
  select proposed_payload->>'ocrUploadId' into v_ocr from public.rubber_bill_approval_requests
    where location_id=p_location_id and client_temp_id=p_client_temp_id and operation='create'
      and request_status='pending' and requested_by_user_id=auth.uid();
  return jsonb_build_object('generation',coalesce(v_generation,case when exists(select 1 from public.rubber_bill_approval_requests
    where location_id=p_location_id and client_temp_id=p_client_temp_id and request_status='pending') then 1 else 0 end),'revisionNo',coalesce(v_bill.revision_no,0),
    'recordStatus',v_bill.record_status,'serverId',v_bill.id,'ocrUploadId',v_ocr);
end $$;
revoke all on function public.get_rubber_bill_command_context(uuid,text) from public,anon;
grant execute on function public.get_rubber_bill_command_context(uuid,text) to authenticated;

alter function public.sync_rubber_bill(jsonb) rename to sync_rubber_bill_before_commands_20261028010000;
revoke all on function public.sync_rubber_bill_before_commands_20261028010000(jsonb) from public,anon,authenticated;

create function public.sync_rubber_bill(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_location uuid; v_client text := payload->>'clientTempId'; v_command uuid;
  v_generation bigint; v_expected bigint; v_fingerprint text; v_result jsonb;
  v_receipt private.rubber_command_receipts%rowtype;
  v_old public.rubber_bill_approval_requests%rowtype;
  v_payload jsonb := payload - 'contractVersion' - 'commandId' - 'expectedCommandGeneration';
  v_ocr uuid; v_transfer boolean := false; v_known boolean;
begin
  if not private.is_active_user() then
    return jsonb_build_object('status','failed','errorMessage','Unauthorized or inactive user');
  end if;
  begin
    v_location := (payload->>'locationId')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('status','failed','errorMessage','ข้อมูลสาขาไม่ถูกต้อง');
  end;
  if v_location is null or nullif(btrim(v_client),'') is null or not public.can_access_location(v_location)
     or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')) then
    return jsonb_build_object('status','failed','errorMessage','ไม่มีสิทธิ์ทำรายการบิลยาง');
  end if;
  -- Location first is also the order used by the approval/discard wrappers below.
  perform pg_advisory_xact_lock(hashtextextended(v_location::text,0));
  if payload->>'contractVersion' is distinct from '2' then
    -- Legacy traffic never gains replacement rights. Its known keys retain their
    -- existing semantics; initial offline creates remain compatible.
    v_known := exists(select 1 from public.rubber_bills where idempotency_key=payload->>'idempotencyKey')
      or exists(select 1 from public.rubber_bill_approval_requests where idempotency_key=payload->>'idempotencyKey')
      or exists(select 1 from private.approval_request_replay_guards where workflow='rubber_bill' and request_key=payload->>'idempotencyKey');
    if not v_known and exists(select 1 from private.rubber_command_contexts
      where location_id=v_location and client_temp_id=v_client and v2_enabled) then
      return jsonb_build_object('status','failed','errorCode','COMMAND_UPGRADE_REQUIRED',
        'errorMessage','กรุณาอัปเดตแอปและตรวจข้อมูลบิลก่อนเริ่มคำสั่งใหม่');
    end if;
    v_result := public.sync_rubber_bill_before_commands_20261028010000(payload);
    if not v_known and v_result->>'status' in ('synced','pending_approval') then
      insert into private.rubber_command_contexts(location_id,client_temp_id,generation) values(v_location,v_client,1)
        on conflict(location_id,client_temp_id) do update set generation=rubber_command_contexts.generation+1;
    end if;
    return v_result;
  end if;
  begin
    v_command := (payload->>'commandId')::uuid;
    v_expected := (payload->>'expectedCommandGeneration')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('status','failed','errorMessage','ข้อมูลคำสั่งบิลยางไม่ถูกต้อง','errorCode','INVALID_COMMAND');
  end;
  if v_command is null or v_expected is null or v_expected < 0
     or payload->>'idempotencyKey' is distinct from v_command::text
     or payload->>'operation' not in ('create','update','delete') then
    return jsonb_build_object('status','failed','errorMessage','ข้อมูลคำสั่งบิลยางไม่ถูกต้อง','errorCode','INVALID_COMMAND');
  end if;
  v_fingerprint := private.try_rubber_bill_submission_fingerprint(v_payload);
  if v_fingerprint is null then
    return jsonb_build_object('status','failed','errorMessage','ข้อมูลบิลยางไม่ถูกต้อง','errorCode','INVALID_PAYLOAD');
  end if;
  select * into v_receipt from private.rubber_command_receipts where command_id=v_command;
  if found then
    if v_receipt.owner_user_id <> auth.uid() or v_receipt.location_id <> v_location
       or v_receipt.client_temp_id <> v_client or v_receipt.operation <> payload->>'operation'
       or v_receipt.fingerprint <> v_fingerprint then
      return jsonb_build_object('status','conflict','errorMessage','รหัสคำสั่งไม่ตรงกับข้อมูลที่ส่ง','errorCode','COMMAND_MISMATCH');
    end if;
    return v_receipt.result;
  end if;
  insert into private.rubber_command_contexts(location_id,client_temp_id,generation)
    values(v_location,v_client,case when exists(select 1 from public.rubber_bill_approval_requests
      where location_id=v_location and client_temp_id=v_client and request_status='pending') then 1 else 0 end) on conflict do nothing;
  select generation into v_generation from private.rubber_command_contexts
    where location_id=v_location and client_temp_id=v_client for update;
  if v_generation <> v_expected then
    return jsonb_build_object('status','conflict','errorMessage','มีคำสั่งใหม่กว่าหรือบิลเปลี่ยนแล้ว กรุณาตรวจข้อมูลก่อนส่งใหม่',
      'errorCode','STALE_COMMAND_CONTEXT','commandId',v_command);
  end if;
  -- All destructive work belongs to this subtransaction. A JSON business failure
  -- must roll it back just as an SQL failure would.
  begin
    select * into v_old from public.rubber_bill_approval_requests
      where location_id=v_location and client_temp_id=v_client and request_status='pending' for update;
    if v_old.id is not null then
      if v_old.operation='create' and payload->>'operation' <> 'create' then
        return jsonb_build_object('status','failed','errorMessage','บิลยังไม่ถูกสร้าง กรุณาจัดการคำขอสร้างก่อน','errorCode','PENDING_CREATE');
      end if;
      if v_old.operation='create' and v_old.proposed_payload->>'inputMethod'='ocr' then
        v_ocr := (v_old.proposed_payload->>'ocrUploadId')::uuid;
        v_transfer := payload->>'inputMethod'='ocr' and payload->>'ocrUploadId'=v_ocr::text
          and v_old.requested_by_user_id=auth.uid();
        if v_transfer then
          update public.rubber_bill_ocr_sources set reserved_idempotency_key=v_command::text,updated_at=now()
          where id=v_ocr and state='reserved' and owner_user_id=auth.uid() and location_id=v_location
            and reserved_client_temp_id=v_client and reserved_idempotency_key=v_old.idempotency_key;
        else
          update public.rubber_bill_ocr_sources set state='abandoned',abandoned_at=now(),updated_at=now()
          where id=v_ocr and state='reserved' and owner_user_id=v_old.requested_by_user_id and location_id=v_location
            and reserved_client_temp_id=v_client and reserved_idempotency_key=v_old.idempotency_key;
        end if;
        if not found then raise exception 'ข้อมูลอ้างอิงรูป OCR ไม่ตรงกับคำขออนุมัติ'; end if;
      end if;
      insert into private.approval_request_replay_guards(workflow,request_key,terminal_status,completed_at,request_fingerprint)
      values('rubber_bill',v_old.idempotency_key,'deleted',clock_timestamp(),private.try_rubber_bill_submission_fingerprint(v_old.proposed_payload))
      on conflict(workflow,request_key) do nothing;
      update private.rubber_command_receipts set result=jsonb_build_object('status','discarded','operation',operation,
        'clientTempId',client_temp_id,'commandId',command_id,'errorCode','COMMAND_SUPERSEDED')
        where command_id::text=v_old.idempotency_key;
      delete from public.rubber_bill_approval_requests where id=v_old.id;
    end if;
    v_result := public.sync_rubber_bill_before_commands_20261028010000(v_payload);
    if v_result->>'status' not in ('synced','pending_approval') or v_result->>'status' is null then
      raise exception using errcode='P0002',message='ROLLBACK_COMMAND_REPLACEMENT';
    end if;
    v_result := v_result || jsonb_build_object('commandId',v_command);
    insert into private.rubber_command_receipts values(v_command,v_location,v_client,auth.uid(),payload->>'operation',v_fingerprint,
      jsonb_strip_nulls(jsonb_build_object('status',v_result->>'status','commandId',v_command,
        'requestId',v_result->'requestId','operation',payload->>'operation','clientTempId',v_client,
        'id',v_result->'id','serverBillNo',v_result->'serverBillNo','revisionNo',v_result->'revisionNo',
        'serverReceivedAt',v_result->'serverReceivedAt')));
    update private.rubber_command_contexts set generation=generation+1,v2_enabled=true where location_id=v_location and client_temp_id=v_client;
    return v_result;
  exception when sqlstate 'P0002' then
    return coalesce(v_result,jsonb_build_object('status','failed','errorMessage','ไม่สามารถแทนคำขอได้'));
  end;
end $$;
revoke all on function public.sync_rubber_bill(jsonb) from public,anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

alter function public.approve_rubber_bill_approval_request(uuid) rename to approve_rubber_bill_before_commands_20261028010000;
revoke all on function public.approve_rubber_bill_before_commands_20261028010000(uuid) from public,anon,authenticated;
create function public.approve_rubber_bill_approval_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request public.rubber_bill_approval_requests%rowtype; v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then raise exception 'ไม่มีสิทธิ์อนุมัติคำขอบิลยาง'; end if;
  select * into v_request from public.rubber_bill_approval_requests where id=p_request_id;
  if v_request.id is null then raise exception 'คำขอไม่มีอยู่หรือถูกแทนแล้ว'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request.location_id::text,0));
  if v_request.bill_id is not null and not exists(select 1 from public.rubber_bills
    where id=v_request.bill_id and revision_no=v_request.base_revision_no) then
    raise exception 'Revision mismatch';
  end if;
  v_result := public.approve_rubber_bill_before_commands_20261028010000(p_request_id);
  update private.rubber_command_receipts set result=(v_result->'syncResult') || jsonb_build_object('commandId',command_id)
    where command_id::text=v_request.idempotency_key;
  insert into private.rubber_command_contexts(location_id,client_temp_id,generation) values(v_request.location_id,v_request.client_temp_id,2)
    on conflict(location_id,client_temp_id) do update set generation=rubber_command_contexts.generation+1;
  return v_result;
end $$;
revoke all on function public.approve_rubber_bill_approval_request(uuid) from public,anon;
grant execute on function public.approve_rubber_bill_approval_request(uuid) to authenticated;

alter function public.delete_rubber_bill_approval_request(uuid) rename to delete_rubber_bill_before_commands_20261028010000;
revoke all on function public.delete_rubber_bill_before_commands_20261028010000(uuid) from public,anon,authenticated;
create function public.delete_rubber_bill_approval_request(p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_request public.rubber_bill_approval_requests%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then raise exception 'ไม่มีสิทธิ์ลบคำขอบิลยาง'; end if;
  select * into v_request from public.rubber_bill_approval_requests where id=p_request_id;
  if v_request.id is null then raise exception 'ไม่พบคำขอที่รออนุมัติ'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request.location_id::text,0));
  perform public.delete_rubber_bill_before_commands_20261028010000(p_request_id);
  insert into private.rubber_command_contexts(location_id,client_temp_id,generation)
    values(v_request.location_id,v_request.client_temp_id,2) on conflict(location_id,client_temp_id) do update set generation=rubber_command_contexts.generation+1;
  update private.rubber_command_receipts set result=jsonb_build_object('status','discarded','operation',operation,
    'clientTempId',client_temp_id,'commandId',command_id,'errorCode','COMMAND_RETIRED') where command_id::text=v_request.idempotency_key;
end $$;
revoke all on function public.delete_rubber_bill_approval_request(uuid) from public,anon;
grant execute on function public.delete_rubber_bill_approval_request(uuid) to authenticated;
