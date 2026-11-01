-- Reuse the existing settlement implementation; only its cause varies.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('private.rebuild_open_deductions_after_attendance(uuid,uuid)'::regprocedure) into definition;
  definition := replace(definition,
    'private.rebuild_open_deductions_after_attendance(p_profile_id uuid, p_actor uuid)',
    'private.rebuild_open_time_payroll_deductions(p_profile_id uuid, p_actor uuid, p_cause text)');
  if strpos(definition, 'p_cause text') = 0 then raise exception 'PAYROLL_REBUILD_SIGNATURE_CHANGED'; end if;
  definition := replace(definition, '''RECALCULATE_ATTENDANCE_DEDUCTIONS''',
    'case when p_cause = ''reopen'' then ''RECALCULATE_REOPENED_MONTH_DEDUCTIONS'' else ''RECALCULATE_ATTENDANCE_DEDUCTIONS'' end');
  definition := replace(definition, '''หักหนี้อัตโนมัติหลังแก้วันทำงาน''',
    'case when p_cause = ''reopen'' then ''จัดยอดหักหนี้ใหม่หลังเปิดเดือน'' else ''หักหนี้อัตโนมัติหลังแก้วันทำงาน'' end');
  definition := replace(definition, '''หักยอดเบิกเงินอัตโนมัติหลังแก้วันทำงาน''',
    'case when p_cause = ''reopen'' then ''จัดยอดหักเบิกใหม่หลังเปิดเดือน'' else ''หักยอดเบิกเงินอัตโนมัติหลังแก้วันทำงาน'' end');
  definition := replace(definition, '''แก้วันทำงานและคำนวณยอดหักหนี้/เงินเบิกของเดือนเปิดใหม่''',
    'case when p_cause = ''reopen'' then ''เปิดเดือนและจัดยอดหักหนี้/เงินเบิกใหม่'' else ''แก้วันทำงานและคำนวณยอดหักหนี้/เงินเบิกของเดือนเปิดใหม่'' end');
  execute definition;
end
$migration$;
revoke all on function private.rebuild_open_time_payroll_deductions(uuid,uuid,text) from public,anon,authenticated;

create or replace function private.rebuild_open_deductions_after_attendance(p_profile_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return private.rebuild_open_time_payroll_deductions(p_profile_id,p_actor,'attendance');
end;
$$;

-- These RPCs already serialize settlement by employee. Do not invert attendance
-- and settlement locks: reopening changes no attendance rows.
do $migration$
declare definition text; anchor text;
begin
  select pg_get_functiondef('public.delete_time_tracking_source_permanently(text,uuid)'::regprocedure) into definition;
  anchor := 'delete from public.payroll_slips where id = v_slip.id;';
  if strpos(definition,anchor) = 0 then raise exception 'PAYROLL_DELETE_BASE_CHANGED'; end if;
  execute replace(definition,anchor,anchor || $code$
    if v_slip.status in ('PENDING','APPROVED') and v_slip.cancelled_at is null then
      perform private.rebuild_open_time_payroll_deductions(v_slip.profile_id,v_actor_id,'reopen');
    end if;$code$);

  select pg_get_functiondef('public.decide_time_tracking_approval_internal_20260829(text,uuid,text,text,uuid)'::regprocedure) into definition;
  anchor := $code$where id = v_slip.id;
    end if;$code$;
  if strpos(definition,anchor) = 0 then raise exception 'PAYROLL_DECISION_BASE_CHANGED'; end if;
  execute replace(definition,anchor,$code$where id = v_slip.id;
      perform private.rebuild_open_time_payroll_deductions(v_slip.profile_id,v_actor_id,'reopen');
    end if;$code$);
end
$migration$;

-- Fingerprint the edited month's inputs, not the clock or other months' days.
create function private.time_payroll_attendance_revision(p_profile_id uuid,p_month text)
returns text language sql stable security definer set search_path = '' as $$
  select md5(jsonb_build_object(
    'periods',coalesce((select jsonb_agg(jsonb_build_array(ap.id,ap.start_on,ap.end_on,ap.updated_at) order by ap.id)
      from public.time_payroll_active_periods ap where ap.profile_id=p_profile_id
      and ap.start_on < ((p_month||'-01')::date+interval '1 month')
      and (ap.end_on is null or ap.end_on >= (p_month||'-01')::date)),'[]'::jsonb),
    'exceptions',coalesce((select jsonb_agg(jsonb_build_array(x.work_date,x.status,x.updated_at) order by x.work_date)
      from public.time_payroll_attendance_exceptions x where x.profile_id=p_profile_id
      and x.work_date >= (p_month||'-01')::date
      and x.work_date < ((p_month||'-01')::date+interval '1 month')),'[]'::jsonb)
  )::text);
$$;
revoke all on function private.time_payroll_attendance_revision(uuid,text) from public,anon,authenticated;

do $migration$
declare definition text; anchor text := '''month'', p_month,';
begin
  select pg_get_functiondef('public.get_time_payroll_attendance_month(uuid,text)'::regprocedure) into definition;
  if strpos(definition,anchor)=0 then raise exception 'ATTENDANCE_READ_BASE_CHANGED'; end if;
  execute replace(definition,anchor,anchor || E'\n    ''revision'', private.time_payroll_attendance_revision(p_profile_id,p_month),');
end
$migration$;

-- All authenticated writers must supply the snapshot they actually edited.
alter function public.replace_time_payroll_attendance_exceptions(uuid,text,jsonb) set schema private;
revoke all on function private.replace_time_payroll_attendance_exceptions(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.replace_time_payroll_attendance_exceptions(
  p_profile_id uuid,p_month text,p_selections jsonb,p_expected_revision text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_MONTH'; end if;
  if p_expected_revision is null then raise exception 'ATTENDANCE_REVISION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:'||p_profile_id::text,0));
  if p_expected_revision is distinct from private.time_payroll_attendance_revision(p_profile_id,p_month) then
    raise exception 'ATTENDANCE_STALE';
  end if;
  return private.replace_time_payroll_attendance_exceptions(p_profile_id,p_month,p_selections);
end;
$$;
revoke all on function public.replace_time_payroll_attendance_exceptions(uuid,text,jsonb,text) from public,anon;
grant execute on function public.replace_time_payroll_attendance_exceptions(uuid,text,jsonb,text) to authenticated;
notify pgrst,'reload schema';
