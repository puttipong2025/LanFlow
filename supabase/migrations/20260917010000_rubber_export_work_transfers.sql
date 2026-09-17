-- A verified external REX owns one pending bank transfer. Existing verified
-- exports are intentionally not backfilled.
alter table public.money_transfers
  alter column net_amount_to_pay type numeric(14,2),
  add column rubber_export_id uuid references public.rubber_exports(id),
  add constraint money_transfers_rubber_export_id_key unique (rubber_export_id),
  add constraint money_transfers_rubber_export_source_check
    check ((transfer_type = 'rubber_export_work') = (rubber_export_id is not null));

alter table public.money_transfer_slips
  alter column amount type numeric(14,2);

alter table public.money_transfers
  drop constraint money_transfers_transfer_type_check,
  add constraint money_transfers_transfer_type_check
    check (transfer_type in ('customer', 'transport', 'branch', 'cash', 'rubber_export_work'));

create function private.guard_rubber_export_work_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports;
begin
  if tg_op = 'UPDATE' and old.transfer_type = 'rubber_export_work' then
    if new.record_status <> 'active'
      or (to_jsonb(new) - array['transfer_status', 'revision_no', 'updated_at'])
         is distinct from
         (to_jsonb(old) - array['transfer_status', 'revision_no', 'updated_at']) then
      raise exception 'REX_WORK_TRANSFER_LOCKED: ต้นทางและยอดค่าทำงานแก้ไขไม่ได้';
    end if;
    return new;
  end if;

  if new.transfer_type <> 'rubber_export_work' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'REX_WORK_TRANSFER_LOCKED: เปลี่ยนรายการทั่วไปเป็นค่าทำงานไม่ได้';
  end if;
  select * into v_export
  from public.rubber_exports
  where id = new.rubber_export_id;
  if v_export.id is null
    or v_export.status <> 'verified'
    or v_export.expense_destination <> 'external'
    or v_export.work_total <= 0
    or new.location_id <> v_export.location_id
    or new.net_amount_to_pay <> v_export.work_total
    or new.transfer_method <> 'bank'
    or new.transfer_status <> 'pending'
    or new.record_status <> 'active'
    or new.customer_id is not null
    or new.customer_name is not null
    or new.account_number is not null
    or new.account_name is not null
    or new.bank_name is not null
    or new.transport_staff_id is not null
    or new.transport_staff_name is not null
    or new.target_location_id is not null
    or new.target_location_name is not null then
    raise exception 'REX_WORK_TRANSFER_INVALID: ข้อมูลโอนไม่ตรงกับรายการส่งออกยาง';
  end if;
  return new;
end;
$$;

create trigger guard_rubber_export_work_transfer
before insert or update on public.money_transfers
for each row execute function private.guard_rubber_export_work_transfer();

create function private.reject_rubber_export_work_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.transfer_type = 'rubber_export_work'
    and new.record_status = 'deleted' then
    raise exception 'REX_WORK_TRANSFER_DELETE_WITH_SOURCE: กรุณาลบหรือย้อน REX ต้นทาง';
  end if;
  return new;
end;
$$;

create trigger reject_rubber_export_work_soft_delete
before update of record_status on public.money_transfers
for each row execute function private.reject_rubber_export_work_soft_delete();

create or replace function public.verify_rubber_export_atomic(
  p_export_id uuid, p_current_weight numeric, p_work_rate numeric,
  p_other_operating_cost numeric, p_expense_destination text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
  v_age record;
  v_work_total numeric(14,2);
begin
  select * into v_export from public.rubber_exports where id = p_export_id for update;
  if v_export.id is null then raise exception 'ไม่พบรายการส่งออก'; end if;
  if not private.can_manage_rubber_exports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจสอบรายการส่งออกของสาขานี้';
  end if;
  if p_expense_destination not in ('branch', 'external') then raise exception 'กรุณาเลือกปลายทางค่าใช้จ่าย'; end if;
  if v_export.status = 'verified' then
    if v_export.current_weight is not distinct from p_current_weight
      and v_export.work_rate is not distinct from p_work_rate
      and v_export.other_operating_cost is not distinct from p_other_operating_cost
      and v_export.expense_destination = p_expense_destination then
      return jsonb_build_object('id', p_export_id, 'status', 'verified', 'verifiedAt', v_export.verified_at);
    end if;
    raise exception 'รายการนี้ตรวจสอบแล้วด้วยข้อมูลอื่น';
  end if;
  if v_export.status <> 'draft' then raise exception 'ตรวจสอบได้เฉพาะรายการฉบับร่าง'; end if;
  if p_current_weight is null or p_current_weight <= 0 or p_current_weight > v_export.original_weight_total then
    raise exception 'น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกินน้ำหนักเดิม';
  end if;
  if p_work_rate is null or p_work_rate < 0 then raise exception 'ค่าทำงานต้องไม่น้อยกว่า 0'; end if;
  if p_other_operating_cost is null or p_other_operating_cost < 0 then raise exception 'ค่าใช้จ่ายอื่นต้องไม่น้อยกว่า 0'; end if;

  v_work_total := round(v_export.original_weight_total * p_work_rate + p_other_operating_cost, 2);
  select p.name, p.phone into v_actor_name, v_actor_phone from public.profiles p where p.id = auth.uid();
  select * into v_age from private.rubber_export_age_summary(p_export_id, v_now);
  update public.rubber_exports
  set current_weight = p_current_weight,
      work_rate = p_work_rate,
      other_operating_cost = p_other_operating_cost,
      weight_loss_percent = round((original_weight_total - p_current_weight) / original_weight_total * 100, 2),
      work_total = v_work_total,
      expense_destination = p_expense_destination,
      status = 'verified',
      verified_by_user_id = auth.uid(),
      verified_by_name = coalesce(v_actor_name, ''),
      verified_by_phone = coalesce(v_actor_phone, ''),
      verified_at = v_now,
      age_cutoff_at = v_now,
      average_age_hours = v_age.average_age_hours,
      oldest_age_hours = v_age.oldest_age_hours,
      estimated_age_item_count = v_age.estimated_age_item_count
  where id = p_export_id;

  if p_expense_destination = 'external' and v_work_total > 0 then
    insert into public.money_transfers (
      location_id, rubber_export_id, net_amount_to_pay, transfer_type,
      transfer_method, transfer_status, sync_status, record_status,
      created_by_user_id, created_by_name, created_by_phone, server_received_at
    ) values (
      v_export.location_id, p_export_id, v_work_total, 'rubber_export_work',
      'bank', 'pending', 'synced', 'active',
      auth.uid(), coalesce(v_actor_name, ''), coalesce(v_actor_phone, ''), v_now
    );
  end if;
  return jsonb_build_object('id', p_export_id, 'status', 'verified', 'verifiedAt', v_now);
end;
$$;

create function public.save_rubber_export_work_transfer_slips(
  p_transfer_id uuid, p_expected_revision integer, p_slips jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
  v_transfer public.money_transfers;
  v_slip_ids uuid[];
  v_paid numeric;
  v_fingerprint text;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  if p_transfer_id is null or p_expected_revision is null or jsonb_typeof(p_slips) <> 'array' then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลสลิปไม่ครบ';
  end if;
  select location_id into v_location_id from public.money_transfers where id = p_transfer_id;
  if v_location_id is null then raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน'; end if;
  if not private.can_access_location(v_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));
  select * into v_transfer from public.money_transfers where id = p_transfer_id for update;
  if v_transfer.id is null or v_transfer.transfer_type <> 'rubber_export_work'
    or v_transfer.record_status <> 'active' or v_transfer.location_id <> v_location_id then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนค่าทำงาน';
  end if;
  if v_transfer.revision_no <> p_expected_revision then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;
  if public.report_lock_no(v_transfer) is not null then
    raise exception 'MT_REPORT_LOCKED: รายการถูกล็อกโดยรายงาน';
  end if;
  if exists (select 1 from jsonb_array_elements(p_slips) x
    group by x->>'id' having count(*) > 1) then
    raise exception 'MT_DUPLICATE_SLIP_ID: มีรหัสสลิปซ้ำในรายการ';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    where nullif(x->>'id', '') is null
      or coalesce((x->>'amount')::numeric, 0) <= 0
      or coalesce((x->>'fee')::numeric, 0) < 0
      or nullif(x->>'transactionDate', '') is null
      or x->>'inputMethod' not in ('manual', 'ocr')
      or (x->>'inputMethod' = 'manual' and nullif(trim(x->>'referenceNumber'), '') is not null)
      or (x->>'inputMethod' = 'ocr' and nullif(trim(x->>'referenceNumber'), '') is null)
  ) then
    raise exception 'MT_INVALID_SLIP: จำนวนเงิน ค่าธรรมเนียม วันเวลา หรือที่มาของสลิปไม่ถูกต้อง';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    join public.money_transfer_slips s on s.id = (x->>'id')::uuid
    where s.transfer_id <> p_transfer_id
  ) then
    raise exception 'MT_SLIP_PARENT_CONFLICT: สลิปอยู่ในรายการโอนอื่น';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    where x->>'inputMethod' = 'ocr'
    group by private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    )
    having count(*) > 1
  ) then
    raise exception 'MT_OCR_DUPLICATE: พบสลิป OCR ซ้ำในรายการ';
  end if;
  for v_fingerprint in
    select distinct private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    )
    from jsonb_array_elements(p_slips) x
    where x->>'inputMethod' = 'ocr'
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('money-transfer-ocr:' || v_fingerprint, 0));
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    join public.money_transfer_slips s
      on s.ocr_fingerprint = private.money_transfer_ocr_fingerprint(
        x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
      )
    join public.money_transfers t on t.id = s.transfer_id and t.record_status <> 'deleted'
    where x->>'inputMethod' = 'ocr' and t.id <> p_transfer_id
  ) then
    raise exception 'MT_OCR_DUPLICATE: สลิป OCR ถูกใช้ในรายการอื่นแล้ว';
  end if;
  select coalesce(array_agg((x->>'id')::uuid), array[]::uuid[])
    into v_slip_ids from jsonb_array_elements(p_slips) x;
  delete from public.money_transfer_slips s
  where s.transfer_id = p_transfer_id and not (s.id = any(v_slip_ids));
  insert into public.money_transfer_slips (
    id, transfer_id, amount, reference_number, fee, sender_name, receiver_name,
    transaction_date, slip_image_url, sort_order, input_method, ocr_fingerprint
  )
  select (x->>'id')::uuid, p_transfer_id, (x->>'amount')::numeric,
    case when x->>'inputMethod' = 'manual' then null else nullif(x->>'referenceNumber', '') end,
    coalesce((x->>'fee')::numeric, 0), null, null,
    (x->>'transactionDate')::timestamptz, null,
    coalesce((x->>'sortOrder')::integer, 0), x->>'inputMethod',
    case when x->>'inputMethod' = 'ocr' then private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    ) end
  from jsonb_array_elements(p_slips) x
  on conflict (id) do update set
    amount = excluded.amount, reference_number = excluded.reference_number,
    fee = excluded.fee, transaction_date = excluded.transaction_date,
    sort_order = excluded.sort_order, input_method = excluded.input_method,
    ocr_fingerprint = excluded.ocr_fingerprint, sender_name = null,
    receiver_name = null, slip_image_url = null, updated_at = now()
  where money_transfer_slips.transfer_id = p_transfer_id;
  select coalesce(sum(amount), 0) into v_paid
  from public.money_transfer_slips where transfer_id = p_transfer_id;
  update public.money_transfers
  set transfer_status = case
      when v_paid = 0 then 'pending'
      when v_paid < v_transfer.net_amount_to_pay then 'partial'
      when v_paid = v_transfer.net_amount_to_pay then 'paid'
      else 'overpaid'
    end,
    revision_no = revision_no + 1, updated_at = now()
  where id = p_transfer_id;
  return public.get_money_transfer_detail(p_transfer_id);
end;
$$;

revoke all on function public.save_rubber_export_work_transfer_slips(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_rubber_export_work_transfer_slips(uuid, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';


