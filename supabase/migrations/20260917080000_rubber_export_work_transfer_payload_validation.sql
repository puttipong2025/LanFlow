create or replace function public.save_rubber_export_work_transfer_slips(
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
  v_report_no text;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  if p_transfer_id is null or p_expected_revision is null or p_slips is null
    or jsonb_typeof(p_slips) <> 'array' then
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
  v_report_no := public.report_lock_no(v_transfer);
  if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
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

notify pgrst, 'reload schema';
