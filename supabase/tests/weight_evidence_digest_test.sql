\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regprocedure('public.claim_weight_evidence_completion(uuid,uuid,integer,uuid)') is null then
    raise exception 'four-argument claim is missing';
  end if;
  if to_regprocedure('public.claim_weight_evidence_completion(uuid,uuid,integer,uuid,integer)') is not null then
    raise exception 'legacy five-argument claim still exists';
  end if;

  if not has_function_privilege('service_role', 'public.claim_telegram_evidence_dispatch()', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.complete_telegram_evidence_dispatch(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.get_weight_evidence_digest()', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.is_telegram_evidence_dispatch_enabled()', 'EXECUTE')
  then
    raise exception 'service_role evidence grants are incomplete';
  end if;

  if has_function_privilege('authenticated', 'public.claim_telegram_evidence_dispatch()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.complete_telegram_evidence_dispatch(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.get_weight_evidence_digest()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.is_telegram_evidence_dispatch_enabled()', 'EXECUTE')
  then
    raise exception 'authenticated role can execute service-only evidence RPCs';
  end if;
end;
$$;

select set_config('request.jwt.claim.role', 'service_role', true);

do $$
begin
  if exists (
    with expected as (
      select b.location_id,
        coalesce(l.name, 'ไม่ทราบสาขา')::text branch_name,
        b.id bill_id,
        coalesce(b.client_recorded_at, b.server_received_at, b.created_at) bill_recorded_at,
        count(i.id)::bigint weigh_row_count
      from public.rubber_bills b
      join public.rubber_bill_items i on i.bill_id = b.id and i.item_type = 'weigh'
      left join public.locations l on l.id = b.location_id
      where b.record_status = 'active'
        and b.source_rubber_export_id is null
        and b.bill_date = (now() at time zone 'Asia/Bangkok')::date
        and b.evidence_completion_id is null
      group by b.id, b.location_id, l.name,
        b.client_recorded_at, b.server_received_at, b.created_at
    ), actual as (
      select * from public.get_weight_evidence_digest()
    )
    (select * from expected except all select * from actual)
    union all
    (select * from actual except all select * from expected)
  ) then
    raise exception 'weight evidence digest differs from canonical customer-bill aggregate';
  end if;
end;
$$;

rollback;
