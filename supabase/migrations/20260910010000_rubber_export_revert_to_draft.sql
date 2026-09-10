create or replace function private.guard_rubber_export_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reverting boolean;
  v_receipt_no text;
begin
  v_reverting := old.status = 'verified' and new.status = 'draft';

  if old.status = 'deleted' then
    raise exception 'รายการส่งออกที่ลบแล้วแก้ไขไม่ได้';
  end if;
  if v_reverting then
    if (to_jsonb(new) - array[
      'status', 'current_weight', 'weight_loss_percent', 'work_rate',
      'other_operating_cost', 'work_total', 'expense_destination',
      'verified_by_user_id', 'verified_by_name', 'verified_by_phone', 'verified_at',
      'age_cutoff_at', 'average_age_hours', 'oldest_age_hours', 'estimated_age_item_count'
    ]) is distinct from (to_jsonb(old) - array[
      'status', 'current_weight', 'weight_loss_percent', 'work_rate',
      'other_operating_cost', 'work_total', 'expense_destination',
      'verified_by_user_id', 'verified_by_name', 'verified_by_phone', 'verified_at',
      'age_cutoff_at', 'average_age_hours', 'oldest_age_hours', 'estimated_age_item_count'
    ]) or new.current_weight is not null
       or new.weight_loss_percent is not null
       or new.work_rate is not null
       or new.other_operating_cost <> 0
       or new.work_total is not null
       or new.expense_destination is not null
       or new.verified_by_user_id is not null
       or new.verified_by_name is not null
       or new.verified_by_phone is not null
       or new.verified_at is not null
       or new.age_cutoff_at is not null
       or new.average_age_hours is not null
       or new.oldest_age_hours is not null
       or new.estimated_age_item_count is not null then
      raise exception 'การย้อนเป็นฉบับร่างต้องล้างข้อมูลตรวจสอบทั้งหมด';
    end if;
    if old.sold_out_at is not null then
      raise exception 'RUBBER_EXPORT_SOLD_OUT:%', old.export_no
        using errcode = 'P0001', hint = 'กรุณายกเลิกขายก่อนย้อนกลับเป็นฉบับร่าง';
    end if;
    select coalesce(b.server_bill_no, b.local_bill_no, b.bill_no)
    into v_receipt_no
    from public.rubber_bills b
    where b.source_rubber_export_id = old.id
      and b.record_status = 'active'
    limit 1;
    if v_receipt_no is not null then
      raise exception 'BRANCH_RECEIPT_SOURCE_LOCKED:%', old.export_no
        using hint = 'กรุณาลบบิลรับ ' || v_receipt_no || ' ก่อน';
    end if;
  elsif old.status = 'verified' and new.status <> 'deleted'
     and (to_jsonb(new) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name'])
       is distinct from
       (to_jsonb(old) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name']) then
    raise exception 'รายการส่งออกที่ตรวจสอบแล้วแก้ไขไม่ได้';
  end if;
  if (
    new.export_no, new.export_date, new.sequence_no, new.location_id,
    new.created_by_user_id, new.created_at
  ) is distinct from (
    old.export_no, old.export_date, old.sequence_no, old.location_id,
    old.created_by_user_id, old.created_at
  ) then
    raise exception 'ข้อมูลระบุตัวตนของรายการส่งออกแก้ไขไม่ได้';
  end if;
  if (old.status <> 'draft' or new.status <> 'draft') and (
    new.original_weight_total, new.paid_total, new.rubber_value_total, new.average_price
  ) is distinct from (
    old.original_weight_total, old.paid_total, old.rubber_value_total, old.average_price
  ) then
    raise exception 'snapshot สมาชิกของรายการส่งออกแก้ไขไม่ได้';
  end if;
  if not v_reverting and old.status <> 'draft' and (
    new.age_cutoff_at, new.average_age_hours, new.oldest_age_hours,
    new.estimated_age_item_count
  ) is distinct from (
    old.age_cutoff_at, old.average_age_hours, old.oldest_age_hours,
    old.estimated_age_item_count
  ) then
    raise exception 'snapshot อายุยางหลังตรวจสอบแก้ไขไม่ได้';
  end if;
  if old.status = 'draft' and new.status <> 'verified' and (
    new.age_cutoff_at is not null or new.average_age_hours is not null
    or new.oldest_age_hours is not null or new.estimated_age_item_count is not null
  ) then
    raise exception 'ฉบับร่างไม่มี snapshot อายุยางอย่างเป็นทางการ';
  end if;
  return new;
end;
$$;

create function public.revert_rubber_export_to_draft(p_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_report_no text;
  v_receipt_no text;
begin
  select * into v_export
  from public.rubber_exports
  where id = p_export_id;

  if v_export.id is null then
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if not private.can_manage_rubber_exports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจสอบรายการส่งออกของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_export.location_id::text, 0));

  select * into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null then
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if not private.can_manage_rubber_exports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจสอบรายการส่งออกของสาขานี้';
  end if;
  if v_export.status = 'draft' then
    return jsonb_build_object(
      'id', v_export.id,
      'exportNo', v_export.export_no,
      'status', 'draft'
    );
  end if;
  if v_export.status <> 'verified' then
    raise exception 'ย้อนกลับเป็นฉบับร่างได้เฉพาะรายการที่ตรวจสอบแล้ว';
  end if;
  if v_export.sold_out_at is not null then
    raise exception 'RUBBER_EXPORT_SOLD_OUT:%', v_export.export_no
      using errcode = 'P0001', hint = 'กรุณายกเลิกขายก่อนย้อนกลับเป็นฉบับร่าง';
  end if;

  select coalesce(b.server_bill_no, b.local_bill_no, b.bill_no)
  into v_receipt_no
  from public.rubber_bills b
  where b.source_rubber_export_id = p_export_id
    and b.record_status = 'active'
  limit 1;
  if v_receipt_no is not null then
    raise exception 'BRANCH_RECEIPT_SOURCE_LOCKED:%', v_export.export_no
      using hint = 'กรุณาลบบิลรับ ' || v_receipt_no || ' ก่อน';
  end if;

  v_report_no := private.active_report_no('rubber_export', p_export_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  update public.rubber_exports
  set status = 'draft',
      previous_status = null,
      current_weight = null,
      weight_loss_percent = null,
      work_rate = null,
      other_operating_cost = 0,
      work_total = null,
      expense_destination = null,
      verified_by_user_id = null,
      verified_by_name = null,
      verified_by_phone = null,
      verified_at = null,
      age_cutoff_at = null,
      average_age_hours = null,
      oldest_age_hours = null,
      estimated_age_item_count = null
  where id = p_export_id;

  return jsonb_build_object(
    'id', v_export.id,
    'exportNo', v_export.export_no,
    'status', 'draft'
  );
end;
$$;

revoke all on function public.revert_rubber_export_to_draft(uuid) from public, anon;
grant execute on function public.revert_rubber_export_to_draft(uuid) to authenticated;

notify pgrst, 'reload schema';
