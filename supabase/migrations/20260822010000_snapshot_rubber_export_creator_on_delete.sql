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
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ลบได้';
  end if;
  select * into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;
  if v_export.id is null then
    select * into v_audit
    from public.document_deletion_audits
    where document_kind = 'rubber_export' and source_id = p_export_id;
    if v_audit.id is not null then
      return jsonb_build_object(
        'id', p_export_id, 'exportNo', v_audit.document_no, 'status', 'deleted'
      );
    end if;
    raise exception 'ไม่พบรายการส่งออก';
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

revoke all on function public.delete_rubber_export(uuid) from public, anon;
grant execute on function public.delete_rubber_export(uuid) to authenticated;
