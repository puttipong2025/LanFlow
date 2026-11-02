begin;

-- Private, transaction-bound authority; a caller-controlled GUC cannot unlock a verified REX.
create table private.rubber_export_weight_context (
  backend_pid integer not null,
  transaction_id bigint not null,
  export_id uuid not null,
  primary key (backend_pid, transaction_id, export_id)
);
alter table private.rubber_export_weight_context enable row level security;
revoke all on private.rubber_export_weight_context from public, anon, authenticated, service_role;

-- Keep the audit after a source is deleted, as with document_deletion_audits.
create table public.rubber_export_weight_adjustments (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null,
  export_no text not null,
  location_id uuid not null references public.locations(id),
  previous_weight numeric(14,2) not null,
  current_weight numeric(14,2) not null,
  previous_loss_percent numeric(8,2) not null,
  loss_percent numeric(8,2) not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  adjusted_at timestamptz not null default clock_timestamp(),
  note text check (char_length(note) <= 300)
);
create index rubber_export_weight_adjustments_export_history
  on public.rubber_export_weight_adjustments(export_id, adjusted_at desc, id desc);
alter table public.rubber_export_weight_adjustments enable row level security;
create policy rubber_export_weight_adjustments_scoped_read
  on public.rubber_export_weight_adjustments for select to authenticated
  using (private.can_manage_rubber_exports(location_id));
revoke all on public.rubber_export_weight_adjustments from public, anon, authenticated, service_role;
grant select on public.rubber_export_weight_adjustments to authenticated, service_role;

create function public.adjust_rubber_export_weight(
  p_export_id uuid, p_current_weight numeric, p_expected_current_weight numeric, p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_export public.rubber_exports%rowtype;
  v_report_no text;
  v_actor_name text;
  v_loss numeric;
begin
  select * into v_export from public.rubber_exports where id = p_export_id;
  if v_export.id is null then raise exception 'ไม่พบรายการส่งออก'; end if;
  if not private.can_manage_rubber_exports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ปรับน้ำหนักรายการส่งออกของสาขานี้';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_export.location_id::text, 0));
  select * into v_export from public.rubber_exports where id = p_export_id for update;
  if v_export.id is null then raise exception 'ไม่พบรายการส่งออก'; end if;
  if not private.can_manage_rubber_exports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ปรับน้ำหนักรายการส่งออกของสาขานี้';
  end if;
  if v_export.status <> 'verified' then raise exception 'ปรับน้ำหนักย้อนหลังได้เฉพาะรายการที่ตรวจสอบแล้ว'; end if;
  if v_export.sold_out_at is not null then raise exception 'RUBBER_EXPORT_SOLD_OUT: รายการนี้ขายแล้ว'; end if;
  v_report_no := private.active_report_no('rubber_export', p_export_id);
  if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
  if exists (select 1 from public.rubber_bills where source_rubber_export_id = p_export_id and record_status = 'active') then
    raise exception 'BRANCH_RECEIPT_SOURCE_LOCKED: มีบิลรับเข้าอ้างอิงรายการนี้แล้ว';
  end if;
  if exists (select 1 from public.export_vehicle_weigh_bill_reservations where rubber_export_id = p_export_id) then
    raise exception 'WEX_RESERVATION_LOCKED: รายการนี้ถูกจองในบิลรถส่งออก';
  end if;
  if p_current_weight is null or p_expected_current_weight is null
    or p_current_weight::text in ('NaN', 'Infinity', '-Infinity')
    or p_expected_current_weight::text in ('NaN', 'Infinity', '-Infinity')
    or p_current_weight <= 0 or p_current_weight > v_export.original_weight_total
    or p_expected_current_weight <= 0 or p_expected_current_weight > v_export.original_weight_total then
    raise exception 'น้ำหนักต้องมากกว่า 0 และไม่เกินน้ำหนักสุทธิรวมเดิม';
  end if;
  if p_current_weight <> round(p_current_weight, 2) or p_expected_current_weight <> round(p_expected_current_weight, 2) then
    raise exception 'RUBBER_EXPORT_PRECISION: น้ำหนักรองรับทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;
  if char_length(p_note) > 300 then raise exception 'หมายเหตุปรับน้ำหนักต้องไม่เกิน 300 ตัวอักษร'; end if;
  if p_current_weight = v_export.current_weight then
    return jsonb_build_object('id', p_export_id, 'currentWeight', v_export.current_weight, 'weightLossPercent', v_export.weight_loss_percent);
  end if;
  if p_expected_current_weight is distinct from v_export.current_weight then
    raise exception 'RUBBER_EXPORT_WEIGHT_CONFLICT: น้ำหนักเปลี่ยนไปแล้ว กรุณาปิดแล้วเปิดรายละเอียดใหม่';
  end if;
  select name into v_actor_name from public.profiles where id = auth.uid() and is_active;
  if v_actor_name is null then raise exception 'ไม่มีสิทธิ์ปรับน้ำหนัก บัญชีผู้ใช้ไม่พร้อมใช้งาน'; end if;
  v_loss := round((v_export.original_weight_total - p_current_weight) / v_export.original_weight_total * 100, 2);
  insert into private.rubber_export_weight_context values (pg_backend_pid(), txid_current(), p_export_id);
  update public.rubber_exports set current_weight = p_current_weight, weight_loss_percent = v_loss where id = p_export_id;
  delete from private.rubber_export_weight_context
    where backend_pid = pg_backend_pid() and transaction_id = txid_current() and export_id = p_export_id;
  insert into public.rubber_export_weight_adjustments (
    export_id, export_no, location_id, previous_weight, current_weight,
    previous_loss_percent, loss_percent, actor_user_id, actor_name, note
  ) values (
    p_export_id, v_export.export_no, v_export.location_id, v_export.current_weight, p_current_weight,
    v_export.weight_loss_percent, v_loss, auth.uid(), v_actor_name, nullif(btrim(p_note), '')
  );
  return jsonb_build_object('id', p_export_id, 'currentWeight', p_current_weight, 'weightLossPercent', v_loss);
end;
$$;
revoke all on function public.adjust_rubber_export_weight(uuid, numeric, numeric, text) from public, anon, service_role;
grant execute on function public.adjust_rubber_export_weight(uuid, numeric, numeric, text) to authenticated;

-- The original guard is retained below, with one narrow exception at its start.

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
  if old.status = 'verified' and new.status = 'verified'
    and (to_jsonb(new) - array['current_weight', 'weight_loss_percent'])
      is not distinct from (to_jsonb(old) - array['current_weight', 'weight_loss_percent'])
    and exists (select 1 from private.rubber_export_weight_context c
      where c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current() and c.export_id = old.id) then
    return new;
  end if;
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


notify pgrst, 'reload schema';
commit;
