-- OCR is an input method for Rubber Bills, not an independent business record.
-- The cutover is intentionally all-or-nothing and refuses to discard legacy rows.
do $$
begin
  if to_regclass('public.ocr_tickets') is not null
     and exists (select 1 from public.ocr_tickets) then
    raise exception 'OCR_CUTOVER_BLOCKED: public.ocr_tickets is not empty';
  end if;
  if exists (
    select 1 from public.money_transfer_items where source_type = 'ocr_ticket'
  ) then
    raise exception 'OCR_CUTOVER_BLOCKED: money_transfer_items contains legacy OCR rows';
  end if;
  if exists (
    select 1 from public.report_items where entity_type = 'ocr_ticket'
  ) then
    raise exception 'OCR_CUTOVER_BLOCKED: report_items contains legacy OCR rows';
  end if;
  if to_regclass('public.dashboard_money_events') is not null
     and exists (
       select 1 from public.dashboard_money_events where source_type = 'ocr_ticket'
     ) then
    raise exception 'OCR_CUTOVER_BLOCKED: dashboard_money_events contains legacy OCR rows';
  end if;
end
$$;

create table public.rubber_bill_ocr_sources (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  state text not null default 'staged'
    check (state in ('staged', 'reserved', 'attached', 'abandoned')),
  image_sha256 text not null check (
    image_sha256 = lower(image_sha256)
    and image_sha256 ~ '^[0-9a-f]{64}$'
  ),
  drive_file_id text not null check (btrim(drive_file_id) <> ''),
  image_mime_type text not null check (image_mime_type in ('image/jpeg', 'image/png')),
  image_size_bytes integer not null check (image_size_bytes > 0 and image_size_bytes <= 8388608),
  original_file_name text not null,
  bill_date date,
  in_weight numeric(12,2) check (in_weight is null or in_weight >= 0),
  out_weight numeric(12,2) check (out_weight is null or out_weight >= 0),
  deduct_weight numeric(12,2) check (deduct_weight is null or deduct_weight >= 0),
  ocr_total numeric(12,2) check (ocr_total is null or ocr_total >= 0),
  suggested_price numeric(12,2) check (suggested_price is null or suggested_price >= 0),
  reserved_client_temp_id text,
  reserved_idempotency_key text,
  reserved_at timestamptz,
  attached_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rubber_bill_ocr_sources_identity_key
    unique (id, location_id, image_sha256),
  constraint rubber_bill_ocr_sources_state_shape check (
    (state = 'staged'
      and reserved_client_temp_id is null
      and reserved_idempotency_key is null
      and reserved_at is null and attached_at is null and abandoned_at is null)
    or (state = 'reserved'
      and nullif(btrim(reserved_client_temp_id), '') is not null
      and nullif(btrim(reserved_idempotency_key), '') is not null
      and reserved_at is not null and attached_at is null and abandoned_at is null)
    or (state = 'attached'
      and nullif(btrim(reserved_client_temp_id), '') is not null
      and nullif(btrim(reserved_idempotency_key), '') is not null
      and reserved_at is not null and attached_at is not null and abandoned_at is null)
    or (state = 'abandoned'
      and nullif(btrim(reserved_client_temp_id), '') is not null
      and nullif(btrim(reserved_idempotency_key), '') is not null
      and reserved_at is not null and attached_at is null and abandoned_at is not null)
  )
);

comment on table public.rubber_bill_ocr_sources is
  'Private staged and attached provenance for Rubber Bills created from OCR.';

create unique index rubber_bill_ocr_sources_pending_hash_unique
  on public.rubber_bill_ocr_sources (location_id, image_sha256)
  where state in ('staged', 'reserved');
create index rubber_bill_ocr_sources_owner_created_idx
  on public.rubber_bill_ocr_sources (owner_user_id, created_at desc);

alter table public.rubber_bill_ocr_sources enable row level security;
revoke all on table public.rubber_bill_ocr_sources from public, anon, authenticated;
grant all on table public.rubber_bill_ocr_sources to service_role;

create or replace function private.enforce_rubber_bill_ocr_source_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id
     or new.location_id is distinct from old.location_id
     or new.image_sha256 is distinct from old.image_sha256
     or new.drive_file_id is distinct from old.drive_file_id then
    raise exception 'ห้ามแก้ไขข้อมูลอ้างอิงต้นทาง OCR ของบิลยาง';
  end if;
  if new.state is distinct from old.state
     and not (
       (old.state = 'staged' and new.state = 'reserved')
       or (old.state = 'reserved' and new.state in ('attached', 'abandoned'))
     ) then
    raise exception 'เปลี่ยนสถานะต้นทาง OCR ของบิลยางไม่ถูกต้อง: % -> %', old.state, new.state;
  end if;
  return new;
end
$$;
revoke all on function private.enforce_rubber_bill_ocr_source_update()
  from public, anon, authenticated;
create trigger rubber_bill_ocr_sources_enforce_update
before update on public.rubber_bill_ocr_sources
for each row execute function private.enforce_rubber_bill_ocr_source_update();

alter table public.rubber_bills
  add column input_method text not null default 'manual',
  add column ocr_source_id uuid,
  add column ocr_image_sha256 text,
  add column has_ocr_source_image boolean generated always as (ocr_source_id is not null) stored;

alter table public.rubber_bills
  add constraint rubber_bills_input_method_check
    check (input_method in ('manual', 'ocr')),
  add constraint rubber_bills_ocr_shape_check check (
    (input_method = 'manual' and ocr_source_id is null and ocr_image_sha256 is null)
    or (input_method = 'ocr' and ocr_source_id is not null and ocr_image_sha256 is not null)
  ),
  add constraint rubber_bills_ocr_hash_check check (
    ocr_image_sha256 is null
    or (ocr_image_sha256 = lower(ocr_image_sha256) and ocr_image_sha256 ~ '^[0-9a-f]{64}$')
  ),
  add constraint rubber_bills_ocr_source_unique unique (ocr_source_id),
  add constraint rubber_bills_ocr_source_composite_fk
    foreign key (ocr_source_id, location_id, ocr_image_sha256)
    references public.rubber_bill_ocr_sources (id, location_id, image_sha256)
    on delete restrict;

create unique index rubber_bills_active_ocr_hash_unique
  on public.rubber_bills (location_id, ocr_image_sha256)
  where record_status = 'active' and input_method = 'ocr';

-- New provenance identifiers remain server-only. Browser reads retain every existing
-- Rubber Bill column plus the public marker and boolean image projection.
revoke select on table public.rubber_bills from authenticated;
grant select (
  id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
  sync_status, record_status, location_id, bill_no, bill_date, customer_id,
  customer_name, bill_type, deduct_weight, weight, rubber_value, average_price,
  deduction_total, net_total, acid_pack_count, locked_at, client_recorded_at,
  client_created_at, server_received_at, revision_no, deleted_at, deleted_by_name,
  deleted_by_phone, created_by_user_id, created_by_name, created_by_phone,
  created_at, updated_at, configured_price_snapshot, approval_state,
  approved_by_name, approval_revision_no, net_weight, net_rubber_value,
  payable_before_rounding, source_rubber_export_id, source_export_no, received_at,
  received_age_hours, received_age_is_estimated, evidence_completion_id,
  evidence_manual_correction_count, formula_version, input_method,
  has_ocr_source_image
) on public.rubber_bills to authenticated;

create or replace function private.reserve_rubber_bill_ocr_source(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := p_payload->>'operation';
  v_input_method text := coalesce(nullif(p_payload->>'inputMethod', ''), 'manual');
  v_upload_id uuid;
  v_location_id uuid;
  v_client_temp_id text := p_payload->>'clientTempId';
  v_idempotency_key text := p_payload->>'idempotencyKey';
  v_source public.rubber_bill_ocr_sources%rowtype;
begin
  if p_payload ?| array['ocrSourceId', 'ocrImageSha256', 'driveFileId', 'driveUrl'] then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่รับข้อมูลอ้างอิง OCR ภายในจากอุปกรณ์');
  end if;
  if v_operation <> 'create' then
    if p_payload ? 'ocrUploadId' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'รูป OCR ใช้ได้เฉพาะตอนสร้างบิลยาง');
    end if;
    return jsonb_build_object('status', 'ok');
  end if;
  if v_input_method not in ('manual', 'ocr') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'วิธีเพิ่มบิลยางไม่ถูกต้อง');
  end if;
  if v_input_method = 'manual' then
    if p_payload ? 'ocrUploadId' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'บิลยางที่เพิ่มเองห้ามใช้รูป OCR');
    end if;
    return jsonb_build_object('status', 'ok');
  end if;

  begin
    v_upload_id := (p_payload->>'ocrUploadId')::uuid;
    v_location_id := (p_payload->>'locationId')::uuid;
  exception when others then
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'ข้อมูลอ้างอิงรูป OCR ไม่ถูกต้อง');
  end;
  if v_upload_id is null
     or nullif(btrim(v_client_temp_id), '') is null
     or nullif(btrim(v_idempotency_key), '') is null then
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'ข้อมูลอ้างอิงรูป OCR ไม่ถูกต้อง');
  end if;

  select * into v_source
  from public.rubber_bill_ocr_sources s
  where s.id = v_upload_id
  for update;
  if v_source.id is null
     or v_source.owner_user_id <> auth.uid()
     or v_source.location_id <> v_location_id then
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'ข้อมูลอ้างอิงรูป OCR ไม่ตรงกับคำขอ');
  end if;
  if v_source.state = 'abandoned' then
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'รูป OCR นี้ถูกยกเลิกแล้ว');
  end if;
  if v_source.state in ('reserved', 'attached') then
    if v_source.reserved_client_temp_id is distinct from v_client_temp_id
       or v_source.reserved_idempotency_key is distinct from v_idempotency_key then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'รูป OCR นี้ถูกจองโดยคำขออื่น');
    end if;
    return jsonb_build_object('status', 'ok');
  end if;

  update public.rubber_bill_ocr_sources
  set state = 'reserved',
      reserved_client_temp_id = v_client_temp_id,
      reserved_idempotency_key = v_idempotency_key,
      reserved_at = now(),
      updated_at = now()
  where id = v_upload_id;
  return jsonb_build_object('status', 'ok');
end
$$;
revoke all on function private.reserve_rubber_bill_ocr_source(jsonb) from public, anon, authenticated;

alter function public.sync_rubber_bill_core_20260725010000(jsonb)
  rename to sync_rubber_bill_legacy_core_20260824010000;
revoke all on function public.sync_rubber_bill_legacy_core_20260824010000(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_rubber_bill_core_20260725010000(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_source public.rubber_bill_ocr_sources%rowtype;
  v_upload_id uuid;
  v_bill_id uuid;
  v_expected_owner uuid := auth.uid();
  v_operation text := payload->>'operation';
  v_input_method text := coalesce(nullif(payload->>'inputMethod', ''), 'manual');
begin
  if v_operation = 'create' and v_input_method = 'ocr' then
    begin
      v_upload_id := (payload->>'ocrUploadId')::uuid;
    exception when others then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'ข้อมูลอ้างอิงรูป OCR ไม่ถูกต้อง');
    end;
    select * into v_source
    from public.rubber_bill_ocr_sources s
    where s.id = v_upload_id
    for update;
    if v_source.id is null then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'ไม่พบรูป OCR ที่อ้างอิง');
    end if;

    if v_source.owner_user_id <> v_expected_owner then
      select r.requested_by_user_id into v_expected_owner
      from public.rubber_bill_approval_requests r
      where r.request_status = 'pending'
        and r.requested_by_user_id = v_source.owner_user_id
        and r.location_id = v_source.location_id
        and r.client_temp_id = v_source.reserved_client_temp_id
        and r.idempotency_key = v_source.reserved_idempotency_key
        and r.proposed_payload->>'ocrUploadId' = v_source.id::text
      order by r.requested_at desc
      limit 1;
    end if;

    if v_expected_owner is distinct from v_source.owner_user_id
       or v_source.location_id is distinct from (payload->>'locationId')::uuid
       or v_source.reserved_client_temp_id is distinct from payload->>'clientTempId'
       or v_source.reserved_idempotency_key is distinct from payload->>'idempotencyKey'
       or v_source.state not in ('reserved', 'attached') then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'ข้อมูลอ้างอิงรูป OCR ไม่ตรงกับคำขอ');
    end if;
  end if;

  payload := payload - 'ocrUploadId' - 'ocrSourceId' - 'ocrImageSha256' - 'driveFileId' - 'driveUrl';
  v_result := public.sync_rubber_bill_legacy_core_20260824010000(payload);
  if v_result->>'status' <> 'synced' then
    return v_result;
  end if;

  if v_operation = 'create' and v_input_method = 'ocr' then
    v_bill_id := (v_result->>'id')::uuid;
    if v_source.state = 'attached' then
      if not exists (
        select 1
        from public.rubber_bills b
        where b.id = v_bill_id
          and b.location_id = v_source.location_id
          and b.client_temp_id = v_source.reserved_client_temp_id
          and b.idempotency_key = v_source.reserved_idempotency_key
          and b.input_method = 'ocr'
          and b.ocr_source_id = v_source.id
          and b.ocr_image_sha256 = v_source.image_sha256
      ) then
        return jsonb_build_object(
          'status', 'conflict',
          'errorCode', 'OCR_REPLAY_ATTACHMENT_MISMATCH',
          'errorMessage', 'ข้อมูลบิลยางไม่ตรงกับรูป OCR ที่แนบไว้'
        );
      end if;
      return v_result;
    end if;

    update public.rubber_bills
    set input_method = 'ocr',
        ocr_source_id = v_source.id,
        ocr_image_sha256 = v_source.image_sha256
    where id = v_bill_id
      and location_id = v_source.location_id
      and client_temp_id = v_source.reserved_client_temp_id
      and idempotency_key = v_source.reserved_idempotency_key;
    if not found then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'ข้อมูลบิลยางไม่ตรงกับรูป OCR');
    end if;
    update public.rubber_bill_ocr_sources
    set state = 'attached', attached_at = now(), updated_at = now()
    where id = v_source.id and state = 'reserved';
    if not found then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'แนบรูป OCR กับบิลยางไม่สำเร็จ');
    end if;
  end if;
  return v_result;
exception
  when unique_violation then
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'รูป OCR นี้ถูกใช้กับบิลยางที่ยังใช้งานอยู่แล้ว');
  when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end
$$;
revoke all on function public.sync_rubber_bill_core_20260725010000(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation jsonb;
  v_result jsonb;
begin
  begin
    v_reservation := private.reserve_rubber_bill_ocr_source(payload);
    if v_reservation->>'status' = 'conflict' then
      return v_reservation;
    end if;
    if v_reservation->>'status' <> 'ok' then
      v_result := v_reservation;
      raise exception using errcode = 'P0002', message = 'ROLLBACK_OCR_RESERVATION';
    end if;

    v_result := private.sync_rubber_bill_approval_20260823010000(payload);
    if v_result->>'status' in ('failed', 'conflict') then
      raise exception using errcode = 'P0002', message = 'ROLLBACK_OCR_RESERVATION';
    end if;
    return v_result;
  exception when sqlstate 'P0002' then
    return v_result;
  end;
end
$$;
alter function public.sync_rubber_bill(jsonb) owner to postgres;
revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

create or replace function public.delete_rubber_bill_approval_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.rubber_bill_approval_requests%rowtype;
  v_upload_id uuid;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์ลบคำขอบิลยาง';
  end if;
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

  delete from public.rubber_bill_approval_requests where id = p_request_id;
end
$$;
alter function public.delete_rubber_bill_approval_request(uuid) owner to postgres;
revoke all on function public.delete_rubber_bill_approval_request(uuid) from public, anon;
grant execute on function public.delete_rubber_bill_approval_request(uuid) to authenticated;

-- Recreate mixed read models without the legacy standalone OCR source.
create function private.ocr_cutover_replace_function(
  p_function regprocedure,
  p_old text,
  p_new text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition text := pg_get_functiondef(p_function);
begin
  if position(p_old in v_definition) = 0 then
    raise exception 'OCR_CUTOVER_ANCHOR_MISSING: %', p_function::text;
  end if;
  execute replace(v_definition, p_old, p_new);
end
$$;
revoke all on function private.ocr_cutover_replace_function(regprocedure, text, text)
  from public, anon, authenticated;

select private.ocr_cutover_replace_function(
  'public.approve_rubber_bill_approval_request(uuid)'::regprocedure,
  $cut$  v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);
$cut$,
  $cut$  if v_request.operation = 'create'
     and v_request.proposed_payload->>'inputMethod' = 'ocr' then
    perform 1
    from public.rubber_bill_ocr_sources s
    where s.id = nullif(v_request.proposed_payload->>'ocrUploadId', '')::uuid
      and s.owner_user_id = v_request.requested_by_user_id
      and s.location_id = v_request.location_id
      and s.reserved_client_temp_id = v_request.client_temp_id
      and s.reserved_idempotency_key = v_request.idempotency_key
      and s.state = 'reserved'
    for update;
    if not found then
      raise exception 'ข้อมูลอ้างอิงรูป OCR ไม่ตรงกับคำขออนุมัติ';
    end if;
  end if;

  v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);
$cut$
);

select private.ocr_cutover_replace_function(
  'private.reportable_items(uuid,timestamptz)'::regprocedure,
  $cut$
    union all

    select 'ocr_ticket', o.id,
      coalesce(o.server_received_at, o.updated_at, o.created_at)
    from public.ocr_tickets o
    where o.location_id = p_location_id
      and o.record_status = 'active'
      and o.sync_status = 'synced'
      and o.server_received_at is not null
$cut$
);

select private.ocr_cutover_replace_function(
  'private.report_income_expense_period_rows(uuid)'::regprocedure,
  $cut$
  union all

  select
    o.date_in,
    'OCR-' || to_char(o.date_in, 'YYMMDD'),
    'expense',
    'จ่ายค่ายางจาก OCR บิลยาง ' || count(*)::text || ' ใบ',
    sum(o.total_amount),
    '30-' || o.date_in::text
  from public.report_items i
  join public.ocr_tickets o on o.id = i.entity_id
  where i.report_id = p_report_id
    and i.entity_type = 'ocr_ticket'
    and o.total_amount > 0
    and not exists (
      select 1
      from public.money_transfer_items mi
      where mi.source_type = 'ocr_ticket'
        and mi.source_id = o.id
    )
  group by o.date_in
$cut$
);

select private.ocr_cutover_replace_function(
  'private.cash_count_events(uuid,timestamptz,timestamptz)'::regprocedure,
  $cut$
  union all
  select i.eligibility_at, 'expense', o.total_amount, null::jsonb,
    jsonb_build_object('source', 'ocr_ticket', 'id', o.id, 'label', coalesce(o.ticket_id, o.file_name), 'amount', o.total_amount)
  from eligible_items i join public.ocr_tickets o on o.id = i.entity_id
  where i.entity_type = 'ocr_ticket' and o.total_amount > 0
    and not exists (select 1 from public.money_transfer_items m where m.source_type = 'ocr_ticket' and m.source_id = o.id and m.created_at <= p_to_cutoff)
$cut$
);

select private.ocr_cutover_replace_function(
  'public.get_dashboard_overview(uuid,timestamptz,text,integer)'::regprocedure,
  $cut$
      union all

      select
        coalesce(ot.client_recorded_at, ot.created_at),
        ot.date_in,
        'ocr-ticket:' || ot.id::text,
        'ocr-ticket:' || ot.id::text,
        'rubber_bill',
        coalesce(nullif(ot.ticket_id, ''), left(ot.id::text, 8)),
        'รับซื้อยางจากใบชั่ง — ' || coalesce(nullif(ot.customer_name, ''), 'ไม่ระบุลูกค้า'),
        'expense',
        ot.total_amount,
        ot.created_by_name,
        not exists (
          select 1
          from public.money_transfer_items i
          where i.source_type = 'ocr_ticket'
            and i.source_id = ot.id
        ),
        false
      from public.ocr_tickets ot
      where ot.location_id = p_location_id
        and ot.record_status = 'active'
        and ot.total_amount > 0
$cut$
);

select private.ocr_cutover_replace_function(
  'public.get_income_expense_feed(uuid,date,date,date,text,integer)'::regprocedure,
  $cut$
      union all

      select ot.date_in, 'ocr:' || ot.date_in::text,
        jsonb_build_object(
          'id', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'clientTempId', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'localBillNo', 'OCR-' || to_char(ot.date_in, 'YYMMDD'), 'serverBillNo', 'OCR-' || to_char(ot.date_in, 'YYMMDD'),
          'idempotencyKey', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'locationId', p_location_id, 'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'OCR-' || to_char(ot.date_in, 'YYMMDD'), 'txDate', ot.date_in,
          'title', 'จ่ายค่ายางจาก OCR บิลยาง ' || ot.ticket_count || ' ใบ', 'cost', ot.total,
          'billOption', 'ค่าใช้จ่าย', 'clientRecordedAt', ot.recorded_at, 'clientCreatedAt', ot.recorded_at,
          'serverReceivedAt', ot.updated_at, 'revisionNo', ot.revision_no,
          'createdByUserId', '', 'createdByName', 'ระบบ OCR บิลยาง', 'createdByPhone', '',
          'relationSourceType', 'ocr_ticket_daily', 'relationSourceId', ot.date_in,
          'relationSourceLocationId', p_location_id, 'relationSourceDate', ot.date_in,
          'relationLabel', 'OCR บิลยางรวมรายวัน',
          'relationLockReason', 'รายการนี้มาจาก OCR บิลยาง ต้องแก้ไขหรือลบที่โมดูล OCR บิลยางต้นทาง'
        )
      from (
        select date_in, sum(total_amount) as total, count(*) as ticket_count,
          max(coalesce(client_recorded_at, updated_at, created_at)) as recorded_at,
          max(updated_at) as updated_at, max(revision_no) as revision_no
        from public.ocr_tickets ot
        where ot.location_id = p_location_id and ot.record_status = 'active' and ot.total_amount > 0
          and ot.date_in between p_from_date and p_to_date
          and not exists (select 1 from public.money_transfer_items i where i.source_type = 'ocr_ticket' and i.source_id = ot.id)
        group by date_in
      ) ot
$cut$
);

select private.ocr_cutover_replace_function(
  'private.capture_dashboard_money_source()'::regprocedure,
  $cut$  elsif tg_table_name = 'ocr_tickets' then
    v_source_type := 'ocr_ticket';
    v_source_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
    if tg_op = 'UPDATE' and v_new->>'record_status' = 'deleted' then
      v_actor_name := v_new->>'deleted_by_name';
    else
      v_actor_user_id := coalesce(
        nullif(v_new->>'created_by_user_id', '')::uuid,
        nullif(v_old->>'created_by_user_id', '')::uuid
      );
      v_actor_name := coalesce(v_new->>'created_by_name', v_old->>'created_by_name');
    end if;
$cut$
);

select private.ocr_cutover_replace_function(
  'private.dashboard_dirty_money_transfer_dependents()'::regprocedure,
  $cut$    elsif source_ref ->> 'type' = 'ocr_ticket' then
      select t.location_id
      into location_id
      from public.ocr_tickets t
      where t.id = nullif(source_ref ->> 'id', '')::uuid;
$cut$
);

select private.ocr_cutover_replace_function(
  'private.dashboard_money_source_entries(text,uuid)'::regprocedure,
  $cut$  elsif p_source_type = 'ocr_ticket' then
    select * into v_row
    from public.ocr_tickets
    where id = p_source_id;

    if not found or v_row.record_status <> 'active' or v_row.total_amount <= 0 then
      return v_entries;
    end if;

    return jsonb_build_array(private.dashboard_money_event_entry(
      'ocr-ticket:' || v_row.id::text,
      v_row.location_id,
      'rubber_bill',
      coalesce(nullif(v_row.ticket_id, ''), left(v_row.id::text, 8)),
      'รับซื้อยางจากใบชั่ง — '
        || coalesce(nullif(v_row.customer_name, ''), 'ไม่ระบุลูกค้า'),
      'expense',
      v_row.total_amount,
      to_jsonb(v_row) - array[
        'sync_status', 'revision_no', 'client_recorded_at', 'server_received_at',
        'created_at', 'updated_at', 'deleted_at', 'deleted_by_name', 'deleted_by_phone',
        'drive_file_id', 'drive_url'
      ],
      v_row.created_by_user_id,
      v_row.created_by_name
    ));
$cut$
);

select private.ocr_cutover_replace_function(
  'public.get_money_transfer_source_locks(uuid,text,uuid[])'::regprocedure,
  $cut$if p_source_type not in ('rubber_bill', 'ocr_ticket') then raise exception 'Unsupported source type'; end if;$cut$,
  $cut$if p_source_type <> 'rubber_bill' then raise exception 'Unsupported source type'; end if;$cut$
);

select private.ocr_cutover_replace_function(
  'public.get_money_transfer_sources(uuid,text,text,timestamptz,uuid,integer,uuid[])'::regprocedure,
  $cut$if p_source_type not in ('rubber_bill', 'ocr_ticket') then raise exception 'Unsupported source type'; end if;$cut$,
  $cut$if p_source_type <> 'rubber_bill' then raise exception 'Unsupported source type'; end if;$cut$
);
select private.ocr_cutover_replace_function(
  'public.get_money_transfer_sources(uuid,text,text,timestamptz,uuid,integer,uuid[])'::regprocedure,
  $cut$
    union all

    select
      'ocr_ticket'::text,
      o.id,
      coalesce(o.ticket_id, o.file_name),
      o.date_in::text,
      o.customer_name,
      (coalesce(o.total_amount, 0) - coalesce(o.money_deducted, 0))::numeric,
      coalesce(o.weight_remaining, o.weight_net, 0)::numeric,
      null::numeric,
      coalesce(o.total_amount, 0)::numeric,
      coalesce(o.money_deducted, 0)::numeric,
      o.license_plate,
      o.created_at,
      r.transfer_id,
      public.report_lock_no(o),
      false,
      o.sync_status::text,
      o.ticket_id is not null,
      false
    from public.ocr_tickets o
    left join private.money_transfer_source_relations(p_location_id, 'ocr_ticket') r
      on r.source_id = o.id
    where o.location_id = p_location_id and o.record_status = 'active'
$cut$
);

create or replace function public.get_money_transfer_receipt_source_details(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
  v_items jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  select t.location_id into v_location_id
  from public.money_transfers t
  where t.id = p_transfer_id and t.record_status <> 'deleted';
  if v_location_id is null then raise exception 'Money transfer not found'; end if;
  if not private.can_access_location(v_location_id) then raise exception 'Location access denied'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', i.id,
    'sourceType', 'rubber_bill',
    'sourceId', i.source_id,
    'sourceNumber', coalesce(rb.server_bill_no, rb.local_bill_no, rb.bill_no),
    'sourceDate', rb.bill_date::text,
    'customerName', coalesce(rb.customer_name, i.customer_name),
    'netWeightAfterDeduction', rb.net_weight,
    'averagePrice', rb.average_price,
    'rubberValue', rb.net_rubber_value,
    'deductedAmount', rb.deduction_total,
    'netPayableAmount', rb.net_total
  ) order by rb.created_at desc, i.source_id desc), '[]'::jsonb)
  into v_items
  from public.money_transfer_items i
  join public.rubber_bills rb on rb.id = i.rubber_bill_id
  where i.transfer_id = p_transfer_id;
  return jsonb_build_object('transferId', p_transfer_id, 'items', v_items);
end
$$;

create or replace function public.sync_money_transfer_item_source_fks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer_location_id uuid;
  v_source_location_id uuid;
begin
  select t.location_id into v_transfer_location_id
  from public.money_transfers t
  where t.id = new.transfer_id and t.record_status <> 'deleted'
  for update;
  if v_transfer_location_id is null then raise exception 'money transfer not found'; end if;
  if new.source_type <> 'rubber_bill' then
    raise exception 'unsupported money transfer source type: %', new.source_type;
  end if;
  if new.rubber_bill_id is not null and new.rubber_bill_id <> new.source_id then
    raise exception 'rubber_bill_id must match source_id';
  end if;
  new.rubber_bill_id := new.source_id;
  select rb.location_id into v_source_location_id
  from public.rubber_bills rb
  where rb.id = new.rubber_bill_id and rb.record_status <> 'deleted'
  for update;
  if v_source_location_id is null then raise exception 'money transfer source not found'; end if;
  if v_source_location_id <> v_transfer_location_id then
    raise exception 'money transfer source must belong to the transfer location';
  end if;
  return new;
end
$$;

-- Keep the mature Money Transfer transaction and remove only the retired source branch.
select private.ocr_cutover_replace_function(
  'public.save_money_transfer(jsonb)'::regprocedure,
  $cut$
  perform o.id
  from public.ocr_tickets o
  where o.id = any(coalesce((select array_agg((x->>'sourceId')::uuid)
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    where x->>'sourceType' = 'ocr_ticket'), array[]::uuid[]))
  order by o.id for update;
$cut$
);
select private.ocr_cutover_replace_function(
  'public.save_money_transfer(jsonb)'::regprocedure,
  $cut$where x->>'sourceType' not in ('rubber_bill', 'ocr_ticket')$cut$,
  $cut$where x->>'sourceType' <> 'rubber_bill'$cut$
);
select private.ocr_cutover_replace_function(
  'public.save_money_transfer(jsonb)'::regprocedure,
  $cut$  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    left join public.ocr_tickets o on o.id = (x->>'sourceId')::uuid
    where x->>'sourceType' = 'ocr_ticket' and (
      o.id is null or o.location_id <> v_location_id or o.record_status <> 'active'
      or o.sync_status::text <> 'synced' or o.ticket_id is null
      or coalesce(o.total_amount, 0) - coalesce(o.money_deducted, 0) <= 0
      or nullif(trim(coalesce(o.customer_name, '')), '') is null
      or (
        public.report_lock_no(o) is not null
        and not exists (
          select 1
          from public.money_transfer_items current_item
          where current_item.transfer_id = v_id
            and current_item.source_type = 'ocr_ticket'
            and current_item.source_id = o.id
        )
      )
    )
  ) then raise exception 'MT_OCR_SOURCE_BLOCKED: ใบชั่งยังไม่พร้อมโอนหรือถูกล็อก'; end if;

$cut$
);
select private.ocr_cutover_replace_function(
  'public.save_money_transfer(jsonb)'::regprocedure,
  $cut$  insert into public.money_transfer_items (
    id, transfer_id, source_type, source_id, rubber_bill_id, ocr_ticket_id, customer_name, amount
  ) select
    (x->>'id')::uuid, v_id, x->>'sourceType', (x->>'sourceId')::uuid,
    case when x->>'sourceType' = 'rubber_bill' then (x->>'sourceId')::uuid end,
    case when x->>'sourceType' = 'ocr_ticket' then (x->>'sourceId')::uuid end,
    case when x->>'sourceType' = 'rubber_bill' then b.customer_name else o.customer_name end,
    case when x->>'sourceType' = 'rubber_bill' then b.net_total
      else coalesce(o.total_amount, 0) - coalesce(o.money_deducted, 0) end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
  left join public.rubber_bills b on x->>'sourceType' = 'rubber_bill' and b.id = (x->>'sourceId')::uuid
  left join public.ocr_tickets o on x->>'sourceType' = 'ocr_ticket' and o.id = (x->>'sourceId')::uuid
  where not exists (
    select 1
    from public.money_transfer_items existing
    where existing.id = (x->>'id')::uuid
      and existing.transfer_id = v_id
      and existing.source_type is not distinct from x->>'sourceType'
      and existing.source_id is not distinct from (x->>'sourceId')::uuid
      and existing.customer_name is not distinct from
        case when x->>'sourceType' = 'rubber_bill' then b.customer_name else o.customer_name end
      and existing.amount is not distinct from
        case when x->>'sourceType' = 'rubber_bill' then b.net_total
          else coalesce(o.total_amount, 0) - coalesce(o.money_deducted, 0) end
  )
  on conflict (id) do update set
    source_type = excluded.source_type, source_id = excluded.source_id,
    rubber_bill_id = excluded.rubber_bill_id, ocr_ticket_id = excluded.ocr_ticket_id,
    customer_name = excluded.customer_name, amount = excluded.amount
  where money_transfer_items.source_type is distinct from excluded.source_type
    or money_transfer_items.source_id is distinct from excluded.source_id
    or money_transfer_items.rubber_bill_id is distinct from excluded.rubber_bill_id
    or money_transfer_items.ocr_ticket_id is distinct from excluded.ocr_ticket_id
    or money_transfer_items.customer_name is distinct from excluded.customer_name
    or money_transfer_items.amount is distinct from excluded.amount;
$cut$,
  $cut$  insert into public.money_transfer_items (
    id, transfer_id, source_type, source_id, rubber_bill_id, customer_name, amount
  ) select
    (x->>'id')::uuid, v_id, 'rubber_bill', (x->>'sourceId')::uuid,
    (x->>'sourceId')::uuid, b.customer_name, b.net_total
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
  join public.rubber_bills b on b.id = (x->>'sourceId')::uuid
  where not exists (
    select 1
    from public.money_transfer_items existing
    where existing.id = (x->>'id')::uuid
      and existing.transfer_id = v_id
      and existing.source_type = 'rubber_bill'
      and existing.source_id = (x->>'sourceId')::uuid
      and existing.customer_name is not distinct from b.customer_name
      and existing.amount is not distinct from b.net_total
  )
  on conflict (id) do update set
    source_type = excluded.source_type, source_id = excluded.source_id,
    rubber_bill_id = excluded.rubber_bill_id,
    customer_name = excluded.customer_name, amount = excluded.amount
  where money_transfer_items.source_type is distinct from excluded.source_type
    or money_transfer_items.source_id is distinct from excluded.source_id
    or money_transfer_items.rubber_bill_id is distinct from excluded.rubber_bill_id
    or money_transfer_items.customer_name is distinct from excluded.customer_name
    or money_transfer_items.amount is distinct from excluded.amount;
$cut$
);

select private.ocr_cutover_replace_function(
  'public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure,
  $cut$to_jsonb(b) || jsonb_build_object($cut$,
  $cut$(to_jsonb(b) - 'ocr_source_id' - 'ocr_image_sha256') || jsonb_build_object($cut$
);
select private.ocr_cutover_replace_function(
  'public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure,
  $cut$        'bill_type', coalesce(r.proposed_payload->>'billType', 'บิลเครื่องชั่งเล็ก'),
$cut$,
  $cut$        'bill_type', coalesce(r.proposed_payload->>'billType', 'บิลเครื่องชั่งเล็ก'),
        'input_method', coalesce(r.proposed_payload->>'inputMethod', 'manual'),
        'has_ocr_source_image', r.proposed_payload->>'inputMethod' = 'ocr',
$cut$
);

-- Retire legacy constraints, triggers and row shape explicitly. No CASCADE is used.
drop trigger if exists dashboard_dirty_ocr_tickets on public.ocr_tickets;
drop trigger if exists dashboard_money_event_ocr_tickets on public.ocr_tickets;
drop trigger if exists ocr_tickets_transfer_relation_delete_lock on public.ocr_tickets;
drop trigger if exists ocr_tickets_transfer_relation_update_lock on public.ocr_tickets;
drop trigger if exists report_lock_ocr_tickets on public.ocr_tickets;
drop trigger if exists money_transfer_items_sync_source_fks on public.money_transfer_items;

drop function if exists public.prevent_locked_ocr_ticket_change();
drop function if exists public.report_lock_no(public.ocr_tickets);

alter table public.money_transfer_items
  drop constraint if exists money_transfer_items_ocr_ticket_fk,
  drop constraint if exists money_transfer_items_source_fk_shape_check,
  drop constraint if exists money_transfer_items_source_type_check,
  drop column ocr_ticket_id;
alter table public.money_transfer_items
  add constraint money_transfer_items_source_type_check
    check (source_type = 'rubber_bill'),
  add constraint money_transfer_items_source_fk_shape_check
    check (
      source_type = 'rubber_bill'
      and rubber_bill_id is not null
      and rubber_bill_id = source_id
    );
create trigger money_transfer_items_sync_source_fks
before insert or update of source_type, source_id, rubber_bill_id
on public.money_transfer_items
for each row execute function public.sync_money_transfer_item_source_fks();

alter table public.report_items
  drop constraint if exists report_items_entity_type_check;
alter table public.report_items
  add constraint report_items_entity_type_check check (
    entity_type in (
      'rubber_bill', 'rubber_export', 'income_expense', 'acid_stock_entry',
      'time_segment', 'leave_request', 'financial_transaction', 'payroll_slip',
      'bank_transfer_source', 'bank_transfer_target',
      'cash_transfer_sent', 'cash_transfer_received'
    )
  );

alter table public.dashboard_money_events
  drop constraint if exists dashboard_money_events_source_type_check;
alter table public.dashboard_money_events
  add constraint dashboard_money_events_source_type_check check (
    source_type in (
      'income_expense', 'money_transfer', 'cash_transfer', 'withdrawal',
      'payroll_slip', 'rubber_bill', 'rubber_export'
    )
  );

do $$
declare
  v_remaining text;
begin
  select string_agg(
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    ', ' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  ) into v_remaining
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prokind in ('f', 'p')
    and pg_get_functiondef(p.oid) like '%public.ocr_tickets%';
  if v_remaining is not null then
    raise exception 'OCR_CUTOVER_DEPENDENCY_REMAINS: %', v_remaining;
  end if;
end
$$;

drop table public.ocr_tickets;
drop function private.ocr_cutover_replace_function(regprocedure, text, text);

comment on column public.rubber_bills.input_method is
  'How the Rubber Bill draft was initiated: manual or OCR.';
comment on column public.rubber_bills.has_ocr_source_image is
  'Safe browser projection; private OCR provenance is never returned.';

notify pgrst, 'reload schema';
