alter table public.rubber_exports
  drop constraint rubber_exports_expense_destination_check;

alter table public.rubber_exports
  add constraint rubber_exports_expense_destination_check
  check (expense_destination in ('branch', 'external', 'off_system'));

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
  v_transfer_amount numeric(14,2);
begin
  select * into v_export from public.rubber_exports where id = p_export_id for update;
  if v_export.id is null then raise exception 'ไม่พบรายการส่งออก'; end if;
  if not private.can_manage_rubber_exports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจสอบรายการส่งออกของสาขานี้';
  end if;
  if p_expense_destination is null
    or p_expense_destination not in ('branch', 'external', 'off_system')
  then
    raise exception 'กรุณาเลือกปลายทางค่าใช้จ่าย';
  end if;
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
  if p_current_weight is null then
    raise exception 'น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกินน้ำหนักเดิม';
  end if;
  if p_current_weight::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'น้ำหนักปัจจุบันต้องเป็นตัวเลขที่มีค่าจำกัด';
  end if;
  if p_current_weight <= 0 or p_current_weight > v_export.original_weight_total then
    raise exception 'น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกินน้ำหนักเดิม';
  end if;
  if p_work_rate is null then raise exception 'ค่าทำงานต้องไม่น้อยกว่า 0'; end if;
  if p_work_rate::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'ค่าทำงานต้องเป็นตัวเลขที่มีค่าจำกัด';
  end if;
  if p_work_rate < 0 then raise exception 'ค่าทำงานต้องไม่น้อยกว่า 0'; end if;
  if p_other_operating_cost is null then raise exception 'ค่าใช้จ่ายอื่นต้องไม่น้อยกว่า 0'; end if;
  if p_other_operating_cost::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'ค่าใช้จ่ายอื่นต้องเป็นตัวเลขที่มีค่าจำกัด';
  end if;
  if p_other_operating_cost < 0 then raise exception 'ค่าใช้จ่ายอื่นต้องไม่น้อยกว่า 0'; end if;

  v_work_total := round(v_export.original_weight_total * p_work_rate + p_other_operating_cost, 2);
  v_transfer_amount := floor(v_work_total);
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

  if p_expense_destination = 'external' and v_transfer_amount > 0 then
    insert into public.money_transfers (
      location_id, rubber_export_id, net_amount_to_pay, transfer_type,
      transfer_method, transfer_status, sync_status, record_status,
      created_by_user_id, created_by_name, created_by_phone, server_received_at
    ) values (
      v_export.location_id, p_export_id, v_transfer_amount, 'rubber_export_work',
      'bank', 'pending', 'synced', 'active',
      auth.uid(), coalesce(v_actor_name, ''), coalesce(v_actor_phone, ''), v_now
    );
  end if;
  return jsonb_build_object('id', p_export_id, 'status', 'verified', 'verifiedAt', v_now);
end;
$$;

notify pgrst, 'reload schema';
