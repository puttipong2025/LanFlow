-- Avoid duplicate projection/bill column names in the bounded Evidence feed.

create or replace function public.get_rubber_bill_evidence_feed(
  p_location_id uuid,
  p_view text default 'pending',
  p_search text default '',
  p_bill_id uuid default null,
  p_cursor_sort_at timestamptz default null,
  p_cursor_bill_id uuid default null,
  p_page_size integer default 75
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := lower(trim(coalesce(p_search, '')));
  v_ascending boolean := p_view = 'pending' and v_search = '' and p_bill_id is null;
  v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED';
  end if;
  if p_view not in ('pending', 'history') then raise exception 'RUBBER_EVIDENCE_INVALID_VIEW'; end if;
  if p_page_size < 1 or p_page_size > 75 then raise exception 'RUBBER_EVIDENCE_INVALID_PAGE_SIZE'; end if;
  if (p_cursor_sort_at is null) <> (p_cursor_bill_id is null) then raise exception 'RUBBER_EVIDENCE_CURSOR_INCOMPLETE'; end if;

  with candidates as (
    select b.*,
      p.review_period_id, p.review_status, p.missing_rubber, p.missing_display_in,
      p.has_manual_correction, p.is_unpriced, p.has_any_evidence,
      p.required_role_count, p.present_required_role_count, p.decision,
      p.reviewed_by_name, p.reviewed_at,
      b.id cursor_bill_id,
      case when p_view = 'pending' then p.client_created_at
        else coalesce(p.reviewed_at, p.client_created_at) end feed_sort_at
    from private.rubber_bill_evidence_projection p
    join public.rubber_bills b on b.id = p.bill_id and b.record_status = 'active'
    where p.location_id = p_location_id
      and (
        (p_bill_id is not null and p.bill_id = p_bill_id)
        or (p_bill_id is null and v_search <> '' and position(v_search in lower(concat_ws(' ',
          b.bill_no, b.local_bill_no, b.server_bill_no, b.customer_name, b.bill_date::text
        ))) > 0)
        or (p_bill_id is null and v_search = '' and p_view = 'pending' and p.review_status = 'pending')
        or (p_bill_id is null and v_search = '' and p_view = 'history' and p.review_status in ('pass', 'improve'))
      )
  ), scoped as (
    select c.* from candidates c
    where p_cursor_sort_at is null
      or (v_ascending and (c.feed_sort_at, c.cursor_bill_id) > (p_cursor_sort_at, p_cursor_bill_id))
      or (not v_ascending and (c.feed_sort_at, c.cursor_bill_id) < (p_cursor_sort_at, p_cursor_bill_id))
    order by case when v_ascending then feed_sort_at end asc,
      case when not v_ascending then feed_sort_at end desc,
      case when v_ascending then cursor_bill_id end asc,
      case when not v_ascending then cursor_bill_id end desc
    limit p_page_size + 1
  ), visible as (
    select * from scoped
    order by case when v_ascending then feed_sort_at end asc,
      case when not v_ascending then feed_sort_at end desc,
      case when v_ascending then cursor_bill_id end asc,
      case when not v_ascending then cursor_bill_id end desc
    limit p_page_size
  ), serialized as (
    select v.feed_sort_at, v.cursor_bill_id bill_id,
      to_jsonb(v) - 'feed_sort_at' - 'cursor_bill_id' - 'review_period_id'
        - 'review_status' - 'missing_rubber' - 'missing_display_in'
        - 'has_manual_correction' - 'is_unpriced' - 'has_any_evidence'
        - 'required_role_count' - 'present_required_role_count' - 'decision'
        - 'reviewed_by_name' - 'reviewed_at'
        || jsonb_build_object(
          'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sequence_no, i.id)
            from public.rubber_bill_items i where i.bill_id = v.cursor_bill_id), '[]'::jsonb),
          'evidence_state', jsonb_build_object(
            'location_id', v.location_id, 'bill_id', v.cursor_bill_id, 'revision_no', v.revision_no,
            'client_created_at', v.client_created_at, 'review_period_id', v.review_period_id,
            'review_status', v.review_status, 'missing_rubber', v.missing_rubber,
            'missing_display_in', v.missing_display_in, 'has_manual_correction', v.has_manual_correction,
            'is_unpriced', v.is_unpriced, 'has_any_evidence', v.has_any_evidence,
            'required_role_count', v.required_role_count,
            'present_required_role_count', v.present_required_role_count,
            'decision', v.decision, 'reviewed_by_name', v.reviewed_by_name, 'reviewed_at', v.reviewed_at
          )
        ) row_json
    from visible v
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row_json order by
      case when v_ascending then feed_sort_at end asc,
      case when not v_ascending then feed_sort_at end desc,
      case when v_ascending then bill_id end asc,
      case when not v_ascending then bill_id end desc) from serialized), '[]'::jsonb),
    'hasMore', (select count(*) > p_page_size from scoped),
    'nextSortAt', (select feed_sort_at from serialized order by
      case when v_ascending then feed_sort_at end desc,
      case when not v_ascending then feed_sort_at end asc,
      case when v_ascending then bill_id end desc,
      case when not v_ascending then bill_id end asc limit 1),
    'nextBillId', (select bill_id from serialized order by
      case when v_ascending then feed_sort_at end desc,
      case when not v_ascending then feed_sort_at end asc,
      case when v_ascending then bill_id end desc,
      case when not v_ascending then bill_id end asc limit 1)
  ) into v_result;
  return v_result;
end;
$$;

notify pgrst, 'reload schema';
