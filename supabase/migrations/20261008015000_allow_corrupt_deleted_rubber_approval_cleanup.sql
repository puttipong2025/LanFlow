-- Managers must still be able to permanently remove a legacy or corrupted
-- pending request. Without a trustworthy fingerprint, its replay guard fails
-- closed as a conflict instead of blocking cleanup or discarding a command.

create or replace function public.delete_rubber_bill_approval_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.rubber_bill_approval_requests%rowtype;
  v_request_key text;
  v_request_fingerprint text;
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

  begin
    v_request_fingerprint := private.rubber_bill_submission_fingerprint(
      v_request.proposed_payload
    );
  exception when others then
    v_request_fingerprint := null;
  end;

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
    v_request_fingerprint
  )
  on conflict (workflow, request_key) do nothing;

  delete from public.rubber_bill_approval_requests where id = p_request_id;
end
$$;

alter function public.delete_rubber_bill_approval_request(uuid) owner to postgres;
revoke all on function public.delete_rubber_bill_approval_request(uuid) from public, anon;
grant execute on function public.delete_rubber_bill_approval_request(uuid) to authenticated;
