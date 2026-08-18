create or replace function private.rubber_bill_evidence_review_states_for_bills(
  p_location_id uuid,
  p_bill_ids uuid[]
)
returns table (
  location_id uuid, bill_id uuid, revision_no integer, client_created_at timestamptz,
  review_period_id uuid, review_status text, missing_rubber boolean,
  missing_display_in boolean, has_manual_correction boolean, is_unpriced boolean,
  has_any_evidence boolean, required_role_count bigint, present_required_role_count bigint,
  decision text, reviewed_by_name text, reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with bill_rows as (
    select
      b.id bill_id, b.location_id, b.revision_no, b.client_created_at, b.bill_type,
      b.source_rubber_export_id, b.evidence_manual_correction_count,
      count(distinct i.id) filter (where i.item_type = 'weigh')::bigint weigh_row_count,
      bool_or(coalesce(i.price, 0) <= 0) filter (where i.item_type = 'weigh') is_unpriced,
      count(f.bill_item_id) filter (where i.item_type = 'weigh' and f.role in ('rubber', 'displayIn'))::bigint present_required_role_count,
      count(f.bill_item_id) filter (where i.item_type = 'weigh' and f.role = 'rubber')::bigint present_rubber_count,
      count(f.bill_item_id) filter (where i.item_type = 'weigh' and f.role = 'displayIn')::bigint present_display_in_count,
      bool_or(f.bill_item_id is not null) has_any_evidence
    from public.rubber_bills b
    left join public.rubber_bill_items i on i.bill_id = b.id
    left join public.rubber_bill_item_evidence_files f
      on f.bill_item_id = i.id and f.revision_no = b.revision_no
    where b.location_id = p_location_id
      and b.record_status = 'active'
      and b.id = any(coalesce(p_bill_ids, array[]::uuid[]))
    group by b.id
  ), scoped as (
    select b.*, p.id review_period_id, r.decision, r.reviewed_by_name, r.reviewed_at,
      (b.weigh_row_count * 2)::bigint required_role_count
    from bill_rows b
    left join lateral (
      select period.id
      from public.rubber_bill_evidence_review_periods period
      where period.location_id = b.location_id
        and b.client_created_at is not null
        and b.client_created_at >= period.opened_at
        and (period.closed_at is null or b.client_created_at < period.closed_at)
      order by period.opened_at desc
      limit 1
    ) p on true
    left join public.rubber_bill_evidence_reviews r
      on r.bill_id = b.bill_id and r.revision_no = b.revision_no
  )
  select
    s.location_id, s.bill_id, s.revision_no, s.client_created_at,
    case when s.bill_type in ('weighing', 'บิลเครื่องชั่งเล็ก')
      and s.source_rubber_export_id is null and s.weigh_row_count > 0 then s.review_period_id end,
    case
      when s.bill_type not in ('weighing', 'บิลเครื่องชั่งเล็ก')
        or s.source_rubber_export_id is not null or s.weigh_row_count = 0
        or s.client_created_at is null or s.review_period_id is null then 'outside'
      when s.decision is not null then s.decision
      when s.present_required_role_count < s.required_role_count
        or s.evidence_manual_correction_count > 0 then 'pending'
      else 'normal'
    end,
    s.weigh_row_count > s.present_rubber_count,
    s.weigh_row_count > s.present_display_in_count,
    s.evidence_manual_correction_count > 0,
    coalesce(s.is_unpriced, false), coalesce(s.has_any_evidence, false),
    s.required_role_count, s.present_required_role_count,
    s.decision, s.reviewed_by_name, s.reviewed_at
  from scoped s;
$$;

revoke all on function private.rubber_bill_evidence_review_states_for_bills(uuid, uuid[])
from public, anon, authenticated;

create or replace function public.get_rubber_bill_evidence_states_for_bills(
  p_location_id uuid,
  p_bill_ids uuid[]
)
returns table (
  location_id uuid, bill_id uuid, revision_no integer, client_created_at timestamptz,
  review_period_id uuid, review_status text, missing_rubber boolean,
  missing_display_in boolean, has_manual_correction boolean, is_unpriced boolean,
  has_any_evidence boolean, required_role_count bigint, present_required_role_count bigint,
  decision text, reviewed_by_name text, reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED';
  end if;
  return query select *
  from private.rubber_bill_evidence_review_states_for_bills(p_location_id, p_bill_ids);
end;
$$;

revoke all on function public.get_rubber_bill_evidence_states_for_bills(uuid, uuid[]) from public, anon;
grant execute on function public.get_rubber_bill_evidence_states_for_bills(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
