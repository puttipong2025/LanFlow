-- Rubber Export work cost is based on the source bills' total net weight.
-- Current weight remains the authority for water-loss calculations only.

create or replace function public.update_rubber_export(
  p_export_id uuid,
  p_current_weight numeric,
  p_work_rate numeric,
  p_other_operating_cost numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_other numeric := coalesce(p_other_operating_cost, 0);
  v_loss numeric;
  v_total numeric;
begin
  select *
  into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null
    or not private.can_manage_reports(v_export.location_id)
  then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการส่งออกนี้';
  end if;
  if v_export.status <> 'draft' then
    raise exception 'แก้ไขได้เฉพาะรายการฉบับร่าง';
  end if;
  if p_current_weight is not null
    and (p_current_weight <= 0 or p_current_weight > v_export.original_weight_total)
  then
    raise exception 'น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกินน้ำหนักสุทธิหลังหักรวม';
  end if;
  if p_work_rate is not null and p_work_rate < 0 then
    raise exception 'ค่าทำงานต้องไม่ติดลบ';
  end if;
  if v_other < 0 then
    raise exception 'ค่าดำเนินการอื่นต้องไม่ติดลบ';
  end if;

  v_loss := case when p_current_weight is null then null
    else round(
      (v_export.original_weight_total - p_current_weight)
        / v_export.original_weight_total * 100,
      2
    )
  end;
  v_total := case when p_work_rate is null then null
    else round(v_export.original_weight_total * p_work_rate + v_other, 2)
  end;

  update public.rubber_exports
  set current_weight = p_current_weight,
      weight_loss_percent = v_loss,
      work_rate = p_work_rate,
      other_operating_cost = v_other,
      work_total = v_total
  where id = p_export_id;

  return jsonb_build_object(
    'id', p_export_id,
    'status', 'draft',
    'weightLossPercent', v_loss,
    'workTotal', v_total
  );
end;
$$;

create or replace function public.verify_rubber_export_atomic(
  p_export_id uuid,
  p_current_weight numeric,
  p_work_rate numeric,
  p_other_operating_cost numeric,
  p_expense_destination text
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

  select profile.name, profile.phone
  into v_actor_name, v_actor_phone
  from public.profiles profile
  where profile.id = auth.uid();

  update public.rubber_exports
  set current_weight = p_current_weight,
      work_rate = p_work_rate,
      other_operating_cost = p_other_operating_cost,
      weight_loss_percent = round(
        (original_weight_total - p_current_weight) / original_weight_total * 100,
        2
      ),
      work_total = round(
        original_weight_total * p_work_rate + p_other_operating_cost,
        2
      ),
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

-- Drafts are still editable and have not entered financial reports. Recalculate
-- them immediately; verified/deleted rows retain their immutable audit snapshot.
update public.rubber_exports
set work_total = case
  when work_rate is null then null
  else round(original_weight_total * work_rate + other_operating_cost, 2)
end
where status = 'draft'
  and work_total is distinct from case
    when work_rate is null then null
    else round(original_weight_total * work_rate + other_operating_cost, 2)
  end;

revoke all on function public.update_rubber_export(uuid, numeric, numeric, numeric)
from public, anon;
grant execute on function public.update_rubber_export(uuid, numeric, numeric, numeric)
to authenticated;

revoke all on function public.verify_rubber_export_atomic(
  uuid, numeric, numeric, numeric, text
) from public, anon;
grant execute on function public.verify_rubber_export_atomic(
  uuid, numeric, numeric, numeric, text
) to authenticated;
