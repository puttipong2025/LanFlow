-- Applied only after the new API no longer reads prediction/report columns.
-- Money-transfer denomination handling and the canonical ledger formula remain intact.
create or replace function public.create_report_batch(p_location_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายงานของสาขานี้'; end if;
  perform private.lock_report_locations(array[p_location_id]);
  return private.create_report_batch_at(p_location_id,clock_timestamp(),auth.uid());
end $$;

create or replace function public.cancel_cash_count_session(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.cash_count_sessions%rowtype;
begin
  select * into s from public.cash_count_sessions where id=p_session_id;
  if s.id is null or not private.can_use_cash_count(s.location_id) or s.started_by_user_id<>auth.uid() then
    raise exception 'ไม่มีสิทธิ์ยกเลิกรอบนับ'; end if;
  perform private.lock_report_locations(array[s.location_id]);
  select * into s from public.cash_count_sessions where id=p_session_id for update;
  if s.status='submitted' then raise exception 'ส่งผลแล้ว ยกเลิกไม่ได้'; end if;
  update public.cash_count_sessions set status=case when expires_at<=clock_timestamp() then 'expired' else 'cancelled' end,
    ended_at=clock_timestamp() where id=s.id and status='active';
  return jsonb_build_object('id',s.id,'status','cancelled');
end $$;

drop function public.has_cash_count(public.report_batches);
drop function public.cash_count_link_id(public.report_batches);
drop function public.cash_count_checker_name(public.report_batches);
drop function public.cash_count_submitted_at(public.report_batches);
alter table public.cash_counts
  drop column report_id, drop column previous_cash_count_id,
  drop column expected_counts, drop column expected_total, drop column difference_counts,
  drop column anomaly_score, drop column confidence, drop column analysis_status,
  drop column evidence;
drop function private.cash_count_events(uuid,timestamptz,timestamptz);
drop function private.cash_count_events_before_time_payroll_payment(uuid,timestamptz,timestamptz);
drop function private.cash_count_events_before_withdrawal_adjustments(uuid,timestamptz,timestamptz);
drop function private.cash_take_with_change(bigint[],bigint,bigint);
drop function private.cash_exact_take_bounded(bigint[],bigint,integer,integer);
drop function private.cash_exact_take(bigint[],bigint,integer);
drop function private.cash_change_counts(bigint);
drop function private.cash_array_to_json(bigint[]);
drop function private.cash_json_to_array(jsonb);
drop function private.cash_count_difference_valid(jsonb);

create or replace function private.cash_count_counts_valid(p_counts jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(p_counts)='object' and
    (select array_agg(key order by key) from jsonb_object_keys(p_counts) key)
      =array['1','10','100','1000','2','20','5','50','500']::text[]
    and not exists(select 1 from jsonb_each(p_counts) e where jsonb_typeof(value)<>'number'
      or value::text !~ '^\d+$' or value::text::numeric>10000000),false)
$$;


CREATE OR REPLACE FUNCTION public.delete_report_batch(p_report_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_report public.report_batches%rowtype;
  v_audit public.document_deletion_audits%rowtype;
  v_export_no text;
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบรายงานได้';
  end if;

  select * into v_report
  from public.report_batches
  where id = p_report_id
  for update;

  if v_report.id is null then
    select * into v_audit
    from public.document_deletion_audits
    where document_kind = 'report_batch'
      and source_id = p_report_id;
    if v_audit.id is not null then
      return jsonb_build_object(
        'id', p_report_id,
        'reportNo', v_audit.document_no,
        'status', 'deleted'
      );
    end if;
    raise exception 'ไม่พบรายงาน active';
  end if;

  if v_report.status <> 'active' then
    raise exception 'ไม่พบรายงาน active';
  end if;



  perform pg_advisory_xact_lock(
    hashtextextended(v_report.location_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('rubber-export:' || v_report.location_id::text, 0)
  );

  if exists (
    select 1 from public.report_batches newer
    where newer.location_id = v_report.location_id
      and newer.status = 'active'
      and (newer.created_at, newer.id) > (v_report.created_at, v_report.id)
  ) then
    raise exception 'ลบได้เฉพาะรายงาน active ล่าสุดของสาขา';
  end if;

  v_export_no := private.active_rubber_export_no_for_report(p_report_id);
  if v_export_no is not null then
    raise exception 'RUBBER_EXPORT_LOCKED:%', v_export_no
      using hint = 'ลบรายการส่งออกยางก่อนจึงจะลบรายงานได้';
  end if;

  select p.name into v_actor_name
  from public.profiles p
  where p.id = auth.uid();

  insert into public.document_deletion_audits (
    document_kind, source_id, document_no, location_id,
    deleted_by_user_id, deleted_by_name, deleted_at
  ) values (
    'report_batch', v_report.id, v_report.report_no, v_report.location_id,
    auth.uid(), coalesce(v_actor_name, ''), v_now
  );

  delete from public.report_items
  where report_id = v_report.id;

  delete from public.report_batches
  where id = v_report.id;

  return jsonb_build_object(
    'id', v_report.id,
    'reportNo', v_report.report_no,
    'status', 'deleted'
  );
end;
$function$

