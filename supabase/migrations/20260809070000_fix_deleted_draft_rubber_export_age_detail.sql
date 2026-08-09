create or replace function public.get_rubber_export_age_detail(p_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_cutoff timestamptz;
  v_average_age_hours numeric;
  v_oldest_age_hours numeric;
  v_estimated_age_item_count integer;
  v_items jsonb;
begin
  select * into v_export from public.rubber_exports where id = p_export_id;
  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ดูอายุยางของรายการนี้';
  end if;

  v_cutoff := case
    when v_export.status = 'draft' then clock_timestamp()
    when v_export.status = 'verified' or v_export.previous_status = 'verified' then v_export.age_cutoff_at
    else null
  end;

  if v_cutoff is not null then
    select s.average_age_hours, s.oldest_age_hours, s.estimated_age_item_count
    into v_average_age_hours, v_oldest_age_hours, v_estimated_age_item_count
    from private.rubber_export_age_summary(p_export_id, v_cutoff) s;
  end if;

  select jsonb_agg(jsonb_build_object(
    'itemId', i.id,
    'ageHours', case when v_cutoff is null then null else round(private.rubber_export_age_hours(
      i.bill_date, i.age_source_at, v_cutoff
    ), 2) end,
    'ageIsEstimated', i.age_is_estimated
  ) order by i.eligibility_at, i.source_bill_id)
  into v_items from public.rubber_export_items i where i.export_id = p_export_id;

  return jsonb_build_object(
    'calculatedAt', v_cutoff,
    'averageAgeHours', v_average_age_hours,
    'oldestAgeHours', v_oldest_age_hours,
    'estimatedAgeItemCount', v_estimated_age_item_count,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_rubber_export_age_detail(uuid) from public, anon;
grant execute on function public.get_rubber_export_age_detail(uuid) to authenticated, service_role;
