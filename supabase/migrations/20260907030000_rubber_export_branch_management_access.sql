alter table public.profiles
  add column if not exists can_manage_rubber_exports boolean not null default false;

update public.profiles
set can_manage_rubber_exports = false,
    updated_at = now()
where role <> 'admin'
  and can_manage_rubber_exports = true;

alter table public.profiles
  drop constraint if exists profiles_admin_only_elevated_access;

alter table public.profiles
  add constraint profiles_admin_only_elevated_access check (
    role = 'admin'
    or (
      can_access_super_admin_features = false
      and can_access_money_transfer = false
      and can_manage_time_payroll = false
      and can_manage_rubber_exports = false
    )
  );

create or replace function private.can_manage_rubber_exports(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      private.can_delete_reports()
      or exists (
        select 1
        from public.profiles p
        join public.user_locations ul on ul.user_id = p.id
        where p.id = auth.uid()
          and p.role = 'admin'
          and p.can_manage_rubber_exports = true
          and ul.location_id = p_location_id
      )
    )
$$;

drop policy if exists document_deletion_audits_select_manager_only
  on public.document_deletion_audits;

create policy document_deletion_audits_select_manager_only
on public.document_deletion_audits
for select
to authenticated
using (
  (private.can_delete_reports() and private.can_manage_reports(location_id))
  or (
    document_kind = 'rubber_export'
    and private.can_manage_rubber_exports(location_id)
  )
);

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

  select p.name, p.phone into v_actor_name, v_actor_phone from public.profiles p where p.id = auth.uid();
  select * into v_age from private.rubber_export_age_summary(p_export_id, v_now);
  update public.rubber_exports
  set current_weight = p_current_weight,
      work_rate = p_work_rate,
      other_operating_cost = p_other_operating_cost,
      weight_loss_percent = round((original_weight_total - p_current_weight) / original_weight_total * 100, 2),
      work_total = round(original_weight_total * p_work_rate + p_other_operating_cost, 2),
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
  return jsonb_build_object('id', p_export_id, 'status', 'verified', 'verifiedAt', v_now);
end;
$$;

create or replace function public.delete_rubber_export(p_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_audit public.document_deletion_audits%rowtype;
  v_report_no text;
  v_receipt_no text;
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;
  if v_export.id is null then
    select * into v_audit
    from public.document_deletion_audits
    where document_kind = 'rubber_export' and source_id = p_export_id;
    if v_audit.id is not null then
      if not private.can_manage_rubber_exports(v_audit.location_id) then
        raise exception 'ไม่มีสิทธิ์ลบรายการส่งออกของสาขานี้';
      end if;
      return jsonb_build_object(
        'id', p_export_id, 'exportNo', v_audit.document_no, 'status', 'deleted'
      );
    end if;
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if not private.can_manage_rubber_exports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ลบรายการส่งออกของสาขานี้';
  end if;
  if v_export.sold_out_at is not null then
    raise exception 'RUBBER_EXPORT_SOLD_OUT:%', v_export.export_no
      using errcode = 'P0001', hint = 'กรุณายกเลิกขายก่อนลบรายการ';
  end if;
  v_report_no := private.active_report_no('rubber_export', p_export_id);
  if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
  select coalesce(b.server_bill_no, b.local_bill_no, b.bill_no)
  into v_receipt_no
  from public.rubber_bills b
  where b.source_rubber_export_id = p_export_id and b.record_status = 'active'
  limit 1;
  if v_receipt_no is not null then
    raise exception 'BRANCH_RECEIPT_SOURCE_LOCKED:%', v_export.export_no
      using hint = 'กรุณาลบบิลรับ ' || v_receipt_no || ' ก่อน';
  end if;
  select p.name into v_actor_name from public.profiles p where p.id = auth.uid();
  insert into public.document_deletion_audits (
    document_kind, source_id, document_no, location_id, previous_status,
    original_actor_user_id, original_actor_name,
    deleted_by_user_id, deleted_by_name, deleted_at
  ) values (
    'rubber_export', v_export.id, v_export.export_no, v_export.location_id,
    v_export.status, v_export.created_by_user_id, v_export.created_by_name,
    auth.uid(), coalesce(v_actor_name, ''), v_now
  );
  delete from public.rubber_export_items where export_id = v_export.id;
  delete from public.rubber_exports where id = v_export.id;
  return jsonb_build_object(
    'id', v_export.id, 'exportNo', v_export.export_no, 'status', 'deleted'
  );
end;
$$;

revoke all on function public.verify_rubber_export_atomic(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.verify_rubber_export_atomic(uuid, numeric, numeric, numeric, text) to authenticated;
revoke all on function public.delete_rubber_export(uuid) from public, anon;
grant execute on function public.delete_rubber_export(uuid) to authenticated;
revoke all on function private.can_manage_rubber_exports(uuid) from public;
grant execute on function private.can_manage_rubber_exports(uuid) to authenticated;
grant select (can_manage_rubber_exports) on table public.profiles to authenticated;

notify pgrst, 'reload schema';
