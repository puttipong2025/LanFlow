create function public.verify_rubber_export_atomic(
  p_export_id uuid,
  p_current_weight numeric,
  p_work_rate numeric,
  p_other_operating_cost numeric,
  p_expense_destination text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ตรวจสอบได้';
  end if;
  if p_expense_destination not in ('branch', 'external') then
    raise exception 'กรุณาเลือกปลายทางค่าใช้จ่าย';
  end if;

  select *
  into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null then
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if v_export.status = 'verified' then
    if v_export.current_weight is not distinct from p_current_weight
      and v_export.work_rate is not distinct from p_work_rate
      and v_export.other_operating_cost is not distinct from p_other_operating_cost
      and v_export.expense_destination = p_expense_destination
    then
      return jsonb_build_object('id', p_export_id, 'status', 'verified');
    end if;
    raise exception 'รายการนี้ตรวจสอบแล้วด้วยข้อมูลอื่น';
  end if;
  if v_export.status <> 'draft' then
    raise exception 'ตรวจสอบได้เฉพาะรายการฉบับร่าง';
  end if;
  if p_current_weight is null
    or p_current_weight <= 0
    or p_current_weight > v_export.original_weight_total
  then
    raise exception 'น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกินน้ำหนักเดิม';
  end if;
  if p_work_rate is null or p_work_rate < 0 then
    raise exception 'ค่าทำงานต้องไม่น้อยกว่า 0';
  end if;
  if p_other_operating_cost is null or p_other_operating_cost < 0 then
    raise exception 'ค่าใช้จ่ายอื่นต้องไม่น้อยกว่า 0';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.rubber_exports
  set current_weight = p_current_weight,
      work_rate = p_work_rate,
      other_operating_cost = p_other_operating_cost,
      weight_loss_percent = round(
        (original_weight_total - p_current_weight) / original_weight_total * 100,
        2
      ),
      work_total = round(p_current_weight * p_work_rate + p_other_operating_cost, 2),
      expense_destination = p_expense_destination,
      status = 'verified',
      verified_by_user_id = auth.uid(),
      verified_by_name = coalesce(v_actor_name, ''),
      verified_by_phone = coalesce(v_actor_phone, ''),
      verified_at = v_now
  where id = p_export_id;

  return jsonb_build_object(
    'id', p_export_id,
    'status', 'verified',
    'verifiedAt', v_now
  );
end;
$$;

revoke all on function public.verify_rubber_export_atomic(uuid, numeric, numeric, numeric, text)
from public, anon;

grant execute on function public.verify_rubber_export_atomic(uuid, numeric, numeric, numeric, text)
to authenticated;
