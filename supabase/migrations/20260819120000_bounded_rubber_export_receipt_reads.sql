-- Page Rubber Export lifecycle views and Branch Receipt candidates before live-age calculation.

create or replace function public.get_rubber_export_page_ids(
  p_location_id uuid,
  p_view text default 'active',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูรายการส่งออกของสาขานี้';
  end if;
  if p_view not in ('active', 'history') then raise exception 'RUBBER_EXPORT_INVALID_VIEW'; end if;
  if p_page_size < 1 or p_page_size > 100 then raise exception 'RUBBER_EXPORT_INVALID_PAGE_SIZE'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'RUBBER_EXPORT_CURSOR_INCOMPLETE'; end if;
  with candidates as (
    select e.id, e.created_at
    from public.rubber_exports e
    where e.location_id = p_location_id and e.status in ('draft', 'verified')
      and case when p_view = 'active' then
        e.sold_out_at is null and not exists (
          select 1 from public.rubber_bills b
          where b.source_rubber_export_id = e.id and b.record_status = 'active'
        )
      else e.sold_out_at is not null or exists (
        select 1 from public.rubber_bills b
        where b.source_rubber_export_id = e.id and b.record_status = 'active'
      ) end
      and (p_cursor_created_at is null or (e.created_at, e.id) < (p_cursor_created_at, p_cursor_id))
    order by e.created_at desc, e.id desc limit p_page_size + 1
  ), visible as (
    select * from candidates order by created_at desc, id desc limit p_page_size
  )
  select jsonb_build_object(
    'ids', coalesce((select jsonb_agg(id order by created_at desc, id desc) from visible), '[]'::jsonb),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextCreatedAt', (select created_at from visible order by created_at, id limit 1),
    'nextId', (select id from visible order by created_at, id limit 1)
  ) into v_result;
  return v_result;
end; $$;

create or replace function public.get_rubber_export_age_summaries_for_ids(
  p_location_id uuid, p_export_ids uuid[]
)
returns table (
  export_id uuid, calculated_at timestamptz, average_age_hours numeric,
  oldest_age_hours numeric, estimated_age_item_count integer,
  receipt_bill_id uuid, receipt_bill_no text, receipt_location_name text
)
language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูอายุยางของสาขานี้';
  end if;
  return query
  select e.id,
    case when e.status = 'draft' or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
      then v_now else e.age_cutoff_at end,
    case when e.status = 'draft' or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
      then age.average_age_hours else e.average_age_hours end,
    case when e.status = 'draft' or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
      then age.oldest_age_hours else e.oldest_age_hours end,
    case when e.status = 'draft' or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
      then age.estimated_age_item_count else e.estimated_age_item_count end,
    receipt.id, receipt.server_bill_no, receipt.location_name
  from public.rubber_exports e
  left join lateral (
    select b.id, b.server_bill_no, l.name location_name
    from public.rubber_bills b join public.locations l on l.id = b.location_id
    where b.source_rubber_export_id = e.id and b.record_status = 'active' limit 1
  ) receipt on true
  left join lateral private.rubber_export_age_summary(e.id, v_now) age
    on e.status = 'draft' or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
  where e.location_id = p_location_id and e.id = any(coalesce(p_export_ids, array[]::uuid[]));
end; $$;

create or replace function public.get_receivable_rubber_exports_page(
  p_destination_location_id uuid,
  p_search text default '',
  p_cursor_same_location boolean default null,
  p_cursor_verified_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_search text := lower(trim(coalesce(p_search, ''))); v_result jsonb;
begin
  if p_destination_location_id is null or not public.can_access_location(p_destination_location_id)
    or not exists (select 1 from public.locations l where l.id = p_destination_location_id and l.is_active = true) then
    raise exception 'ไม่มีสิทธิ์รับยางเข้าสาขานี้';
  end if;
  if p_page_size < 1 or p_page_size > 50 then raise exception 'BRANCH_RECEIPT_INVALID_PAGE_SIZE'; end if;
  if (p_cursor_verified_at is null) <> (p_cursor_id is null)
    or (p_cursor_verified_at is null) <> (p_cursor_same_location is null) then
    raise exception 'BRANCH_RECEIPT_CURSOR_INCOMPLETE';
  end if;
  with candidates as (
    select e.id, e.export_no, e.location_id, l.name location_name, e.verified_at,
      e.current_weight, round(e.paid_total + e.work_total, 2) rubber_value,
      e.location_id = p_destination_location_id is_same_location
    from public.rubber_exports e join public.locations l on l.id = e.location_id and l.is_active = true
    where e.status = 'verified' and e.sold_out_at is null and e.verified_at is not null
      and e.current_weight > 0 and e.paid_total >= 0 and e.work_total >= 0
      and exists (select 1 from public.rubber_export_items i where i.export_id = e.id)
      and not exists (select 1 from public.rubber_bills b where b.source_rubber_export_id = e.id and b.record_status = 'active')
      and (v_search = '' or position(v_search in lower(concat_ws(' ', e.export_no, l.name))) > 0)
      and (p_cursor_verified_at is null or
        (e.location_id = p_destination_location_id, e.verified_at, e.id)
          < (p_cursor_same_location, p_cursor_verified_at, p_cursor_id))
    order by is_same_location desc, e.verified_at desc, e.id desc limit p_page_size + 1
  ), visible as (
    select * from candidates order by is_same_location desc, verified_at desc, id desc limit p_page_size
  ), rows as (
    select v.*, age.average_age_hours source_average_age_hours,
      round(age.average_age_hours, 6) received_age_hours,
      age.estimated_age_item_count > 0 age_is_estimated
    from visible v cross join lateral private.rubber_export_raw_age_summary(v.id, v_now) age
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'source_rubber_export_id', id, 'source_export_no', export_no,
      'source_location_id', location_id, 'source_location_name', location_name,
      'verified_at', verified_at, 'current_weight', current_weight,
      'rubber_value', rubber_value, 'source_average_age_hours', round(source_average_age_hours, 2),
      'received_age_hours', received_age_hours, 'age_is_estimated', age_is_estimated,
      'is_same_location', is_same_location
    ) order by is_same_location desc, verified_at desc, id desc) from rows), '[]'::jsonb),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextSameLocation', (select is_same_location from visible order by is_same_location, verified_at, id limit 1),
    'nextVerifiedAt', (select verified_at from visible order by is_same_location, verified_at, id limit 1),
    'nextId', (select id from visible order by is_same_location, verified_at, id limit 1)
  ) into v_result;
  return v_result;
end; $$;

revoke all on function public.get_rubber_export_page_ids(uuid,text,timestamptz,uuid,integer),
  public.get_rubber_export_age_summaries_for_ids(uuid,uuid[]),
  public.get_receivable_rubber_exports_page(uuid,text,boolean,timestamptz,uuid,integer)
  from public, anon;
grant execute on function public.get_rubber_export_page_ids(uuid,text,timestamptz,uuid,integer),
  public.get_rubber_export_age_summaries_for_ids(uuid,uuid[]),
  public.get_receivable_rubber_exports_page(uuid,text,boolean,timestamptz,uuid,integer)
  to authenticated;
notify pgrst, 'reload schema';
