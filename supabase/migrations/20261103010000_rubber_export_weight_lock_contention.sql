begin;

create or replace function public.adjust_rubber_export_weight(
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
  -- Legacy sale/receipt paths can hold the row before requesting the branch lock.
  -- Do not wait on that row while holding the branch lock: the two waits form a cycle.
  begin
    select * into v_export from public.rubber_exports where id = p_export_id for update nowait;
  exception when lock_not_available then
    raise exception 'RUBBER_EXPORT_WEIGHT_CONFLICT: รายการกำลังถูกใช้งาน กรุณาลองปรับน้ำหนักอีกครั้ง';
  end;
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

notify pgrst, 'reload schema';
commit;
