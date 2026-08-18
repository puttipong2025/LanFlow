create or replace function private.rubber_bill_current_work_items(p_location_id uuid)
returns table(
  location_id uuid,
  work_kind text,
  work_identity text,
  bill_id uuid,
  sort_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.location_id,
    'unpriced'::text,
    'bill:' || b.id::text,
    b.id,
    coalesce(b.client_created_at, b.created_at)
  from public.rubber_bills b
  where b.location_id = p_location_id
    and b.record_status = 'active'
    and exists (
      select 1
      from public.rubber_bill_items i
      where i.bill_id = b.id
        and i.item_type = 'weigh'
        and coalesce(i.price, 0) <= 0
    )

  union all

  select
    r.location_id,
    'pending_approval'::text,
    case
      when r.bill_id is not null then 'bill:' || r.bill_id::text
      else 'approval:' || r.id::text
    end,
    r.bill_id,
    r.requested_at
  from public.rubber_bill_approval_requests r
  where r.location_id = p_location_id
    and r.request_status = 'pending';
$$;

revoke all on function private.rubber_bill_current_work_items(uuid)
from public, anon, authenticated;

create or replace function public.get_rubber_bill_work_counts(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_manage boolean;
  v_unpriced bigint;
  v_pending bigint;
begin
  if not private.is_active_user() then
    raise exception 'Unauthorized or inactive user';
  end if;
  if p_location_id is null or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;

  select p.role = 'super_admin' or p.can_access_super_admin_features = true
  into v_can_manage
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;

  select
    count(distinct w.work_identity) filter (where w.work_kind = 'unpriced'),
    count(distinct w.work_identity) filter (where w.work_kind = 'pending_approval')
  into v_unpriced, v_pending
  from private.rubber_bill_current_work_items(p_location_id) w;

  return jsonb_build_object(
    'unpriced', coalesce(v_unpriced, 0),
    'pendingApproval', case when v_can_manage then coalesce(v_pending, 0) else 0 end
  );
end;
$$;

revoke all on function public.get_rubber_bill_work_counts(uuid) from public, anon;
grant execute on function public.get_rubber_bill_work_counts(uuid) to authenticated;

create or replace function public.get_rubber_bill_operational_feed(
  p_location_id uuid,
  p_mode text default 'latest',
  p_document_status text default 'any',
  p_search text default '',
  p_cursor_sort_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_manage boolean;
  v_ascending boolean := p_mode in ('unpriced', 'pending_approval');
  v_search text := lower(trim(coalesce(p_search, '')));
  v_result jsonb;
begin
  if not private.is_active_user() then
    raise exception 'Unauthorized or inactive user';
  end if;
  if p_location_id is null or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if p_mode not in ('latest', 'unpriced', 'pending_approval') then
    raise exception 'Unsupported Rubber Bill mode';
  end if;
  if p_document_status not in ('any', 'editable', 'report_locked', 'in_transfer') then
    raise exception 'Unsupported Rubber Bill document status';
  end if;
  if p_page_size < 1 or p_page_size > 150 then
    raise exception 'Rubber Bill page size must be between 1 and 150';
  end if;
  if (p_cursor_sort_at is null) <> (p_cursor_id is null) then
    raise exception 'Rubber Bill cursor is incomplete';
  end if;

  select p.role = 'super_admin' or p.can_access_super_admin_features = true
  into v_can_manage
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;
  if p_mode = 'pending_approval' and not coalesce(v_can_manage, false) then
    raise exception 'Rubber Bill approval access denied';
  end if;

  with candidates as (
    select
      b.*,
      public.report_lock_no(b) as report_lock_no,
      case
        when p_mode = 'pending_approval' then coalesce((
          select min(w.sort_at)
          from private.rubber_bill_current_work_items(p_location_id) w
          where w.work_kind = 'pending_approval' and w.bill_id = b.id
        ), coalesce(b.client_created_at, b.created_at))
        else coalesce(b.client_created_at, b.created_at)
      end as feed_sort_at,
      (
        select i.transfer_id
        from public.money_transfer_items i
        join public.money_transfers t on t.id = i.transfer_id
        where i.source_type = 'rubber_bill'
          and i.source_id = b.id
          and t.record_status <> 'deleted'
        limit 1
      ) as transfer_lock_id,
      private.rubber_bill_has_pending_approval(b.id) as approval_pending
    from public.rubber_bills b
    where b.location_id = p_location_id
      and b.record_status = 'active'
      and (
        p_mode = 'latest'
        or exists (
          select 1
          from private.rubber_bill_current_work_items(p_location_id) w
          where w.bill_id = b.id and w.work_kind = p_mode
        )
      )
      and (
        p_document_status = 'any'
        or (p_document_status = 'report_locked' and public.report_lock_no(b) is not null)
        or (p_document_status = 'in_transfer' and exists (
          select 1
          from public.money_transfer_items i
          join public.money_transfers t on t.id = i.transfer_id
          where i.source_type = 'rubber_bill'
            and i.source_id = b.id
            and t.record_status <> 'deleted'
        ))
        or (p_document_status = 'editable'
          and public.report_lock_no(b) is null
          and not private.rubber_bill_has_pending_approval(b.id)
          and not exists (
            select 1
            from public.money_transfer_items i
            join public.money_transfers t on t.id = i.transfer_id
            where i.source_type = 'rubber_bill'
              and i.source_id = b.id
              and t.record_status <> 'deleted'
          ))
      )
      and (
        v_search = ''
        or position(v_search in lower(concat_ws(' ',
          b.bill_no,
          b.local_bill_no,
          b.server_bill_no,
          b.bill_date::text,
          b.customer_name,
          b.bill_type,
          b.created_by_name,
          b.created_by_phone
        ))) > 0
      )
  ), scoped as (
    select c.*
    from candidates c
    where p_cursor_sort_at is null
      or (v_ascending and (c.feed_sort_at, c.id) > (p_cursor_sort_at, p_cursor_id))
      or (not v_ascending and (c.feed_sort_at, c.id) < (p_cursor_sort_at, p_cursor_id))
    order by
      case when v_ascending then c.feed_sort_at end asc,
      case when not v_ascending then c.feed_sort_at end desc,
      case when v_ascending then c.id end asc,
      case when not v_ascending then c.id end desc
    limit p_page_size + 1
  ), visible as (
    select s.*
    from scoped s
    order by
      case when v_ascending then s.feed_sort_at end asc,
      case when not v_ascending then s.feed_sort_at end desc,
      case when v_ascending then s.id end asc,
      case when not v_ascending then s.id end desc
    limit p_page_size
  ), serialized as (
    select
      v.feed_sort_at,
      v.id,
      to_jsonb(v)
        - 'feed_sort_at'
        || jsonb_build_object(
          'items', coalesce((
            select jsonb_agg(to_jsonb(i) order by i.sequence_no, i.id)
            from public.rubber_bill_items i
            where i.bill_id = v.id
          ), '[]'::jsonb),
          'operational_sort_at', v.feed_sort_at,
          'transfer_lock_id', v.transfer_lock_id,
          'approval_pending', v.approval_pending
        ) as row_json
    from visible v
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(x.row_json order by
        case when v_ascending then x.feed_sort_at end asc,
        case when not v_ascending then x.feed_sort_at end desc,
        case when v_ascending then x.id end asc,
        case when not v_ascending then x.id end desc)
      from serialized x
    ), '[]'::jsonb),
    'hasMore', (select count(*) > p_page_size from scoped),
    'nextSortAt', (select x.feed_sort_at from serialized x order by
      case when v_ascending then x.feed_sort_at end desc,
      case when not v_ascending then x.feed_sort_at end asc,
      case when v_ascending then x.id end desc,
      case when not v_ascending then x.id end asc limit 1),
    'nextId', (select x.id from serialized x order by
      case when v_ascending then x.feed_sort_at end desc,
      case when not v_ascending then x.feed_sort_at end asc,
      case when v_ascending then x.id end desc,
      case when not v_ascending then x.id end asc limit 1)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_rubber_bill_operational_feed(uuid, text, text, text, timestamptz, uuid, integer)
from public, anon;
grant execute on function public.get_rubber_bill_operational_feed(uuid, text, text, text, timestamptz, uuid, integer)
to authenticated;

create or replace function public.get_rubber_bill_evidence_states_for_bills(
  p_location_id uuid,
  p_bill_ids uuid[]
)
returns table (
  location_id uuid,
  bill_id uuid,
  revision_no integer,
  client_created_at timestamptz,
  review_period_id uuid,
  review_status text,
  missing_rubber boolean,
  missing_display_in boolean,
  has_manual_correction boolean,
  is_unpriced boolean,
  has_any_evidence boolean,
  required_role_count bigint,
  present_required_role_count bigint,
  decision text,
  reviewed_by_name text,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() then
    raise exception 'Unauthorized or inactive user';
  end if;
  if p_location_id is null or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  return query
  select s.*
  from private.rubber_bill_evidence_review_states(p_location_id) s
  where s.bill_id = any(coalesce(p_bill_ids, array[]::uuid[]));
end;
$$;

revoke all on function public.get_rubber_bill_evidence_states_for_bills(uuid, uuid[])
from public, anon;
grant execute on function public.get_rubber_bill_evidence_states_for_bills(uuid, uuid[])
to authenticated;

notify pgrst, 'reload schema';
