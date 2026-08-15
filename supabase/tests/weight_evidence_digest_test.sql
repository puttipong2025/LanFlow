\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regprocedure('public.claim_weight_evidence_completion(uuid,uuid,integer,uuid)') is not null then
    raise exception 'legacy four-argument claim still exists';
  end if;
  if to_regprocedure('public.claim_weight_evidence_completion(uuid,uuid,integer,uuid,integer)') is null then
    raise exception 'five-argument claim is missing';
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
    with bill_counts as (
      select b.id, b.location_id, b.evidence_completion_id,
        b.evidence_manual_correction_count,
        count(i.id)::bigint weigh_rows
      from public.rubber_bills b
      join public.rubber_bill_items i on i.bill_id = b.id and i.item_type = 'weigh'
      where b.record_status = 'active'
        and b.source_rubber_export_id is null
        and b.bill_date = (now() at time zone 'Asia/Bangkok')::date
      group by b.id
    ), expected as (
      select c.location_id,
        coalesce(l.name, 'ไม่ทราบสาขา')::text branch_name,
        sum(c.weigh_rows)::bigint total_weigh_rows,
        sum(case when c.evidence_completion_id is not null
          then c.evidence_manual_correction_count else 0 end)::bigint manual_correction_count,
        sum(case when c.evidence_completion_id is null
          then c.weigh_rows else 0 end)::bigint incomplete_weigh_rows
      from bill_counts c
      left join public.locations l on l.id = c.location_id
      group by c.location_id, coalesce(l.name, 'ไม่ทราบสาขา')
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
