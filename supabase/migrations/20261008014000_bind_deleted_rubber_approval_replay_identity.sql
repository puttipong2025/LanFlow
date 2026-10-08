-- A deleted Rubber Bill approval replay guard is terminal only for the exact
-- command that originally created the request. Reusing its key with changed
-- identity or business data must remain a conflict instead of clearing a
-- different queued command.

alter table private.approval_request_replay_guards
  add column request_fingerprint text;

alter table private.approval_request_replay_guards
  add constraint approval_request_replay_guards_fingerprint_check check (
    request_fingerprint is null
    or request_fingerprint ~ '^[0-9a-f]{64}$'
  );

create or replace function public.delete_rubber_bill_approval_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.rubber_bill_approval_requests%rowtype;
  v_request_key text;
  v_upload_id uuid;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์ลบคำขอบิลยาง';
  end if;

  select r.idempotency_key into v_request_key
  from public.rubber_bill_approval_requests r
  where r.id = p_request_id;
  if v_request_key is null then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'rubber-bill-idempotency:' || v_request_key,
    0
  ));

  select * into v_request
  from public.rubber_bill_approval_requests r
  where r.id = p_request_id
  for update;
  if v_request.id is null or v_request.request_status <> 'pending' then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;

  if v_request.operation = 'create'
     and v_request.proposed_payload->>'inputMethod' = 'ocr' then
    begin
      v_upload_id := (v_request.proposed_payload->>'ocrUploadId')::uuid;
    exception when others then
      raise exception 'ข้อมูลอ้างอิงรูป OCR ในคำขออนุมัติไม่ถูกต้อง';
    end;
    perform 1 from public.rubber_bill_ocr_sources s
    where s.id = v_upload_id
    for update;
    update public.rubber_bill_ocr_sources
    set state = 'abandoned', abandoned_at = now(), updated_at = now()
    where id = v_upload_id
      and state = 'reserved'
      and owner_user_id = v_request.requested_by_user_id
      and location_id = v_request.location_id
      and reserved_client_temp_id = v_request.client_temp_id
      and reserved_idempotency_key = v_request.idempotency_key;
    if not found then
      raise exception 'ข้อมูลอ้างอิงรูป OCR ไม่ตรงกับคำขออนุมัติ';
    end if;
  end if;

  insert into private.approval_request_replay_guards(
    workflow,
    request_key,
    terminal_status,
    completed_at,
    request_fingerprint
  ) values (
    'rubber_bill',
    v_request.idempotency_key,
    'deleted',
    clock_timestamp(),
    private.rubber_bill_submission_fingerprint(v_request.proposed_payload)
  )
  on conflict (workflow, request_key) do nothing;

  delete from public.rubber_bill_approval_requests where id = p_request_id;
end
$$;

alter function public.delete_rubber_bill_approval_request(uuid) owner to postgres;
revoke all on function public.delete_rubber_bill_approval_request(uuid) from public, anon;
grant execute on function public.delete_rubber_bill_approval_request(uuid) to authenticated;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    $old$  if payload->>'submissionMode' = 'replay'
     and exists (
       select 1
       from private.approval_request_replay_guards g
       where g.workflow = 'rubber_bill'
         and g.request_key = payload->>'idempotencyKey'
         and g.terminal_status = 'deleted'
     ) then
    return jsonb_build_object(
      'status', 'discarded',
      'operation', v_operation,
      'clientTempId', payload->>'clientTempId'
    );
  end if;$old$,
    $new$  if payload->>'submissionMode' = 'replay'
     and exists (
       select 1
       from private.approval_request_replay_guards g
       where g.workflow = 'rubber_bill'
         and g.request_key = payload->>'idempotencyKey'
         and g.terminal_status = 'deleted'
     ) then
    if exists (
      select 1
      from private.approval_request_replay_guards g
      where g.workflow = 'rubber_bill'
        and g.request_key = payload->>'idempotencyKey'
        and g.terminal_status = 'deleted'
        and g.request_fingerprint = private.rubber_bill_submission_fingerprint(payload)
    ) then
      return jsonb_build_object(
        'status', 'discarded',
        'operation', v_operation,
        'clientTempId', payload->>'clientTempId'
      );
    end if;
    return jsonb_build_object(
      'status', 'conflict',
      'errorMessage', 'รหัสคำขอถูกใช้กับรายการอื่นแล้ว'
    );
  end if;$new$
  );
  if v_updated = v_definition then
    raise exception 'RUBBER_APPROVAL_REPLAY_IDENTITY_BLOCKED: sync guard changed';
  end if;

  execute v_updated;
end
$migration$;
