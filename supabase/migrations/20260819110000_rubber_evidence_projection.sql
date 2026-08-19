-- Rebuildable, indexed read projection for Rubber Bill evidence consumers.

create table private.rubber_bill_evidence_projection (
  bill_id uuid primary key references public.rubber_bills(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  revision_no integer not null,
  client_created_at timestamptz,
  review_period_id uuid,
  review_status text not null check (review_status in ('outside', 'normal', 'pending', 'pass', 'improve')),
  missing_rubber boolean not null,
  missing_display_in boolean not null,
  has_manual_correction boolean not null,
  is_unpriced boolean not null,
  has_any_evidence boolean not null,
  required_role_count bigint not null,
  present_required_role_count bigint not null,
  decision text check (decision is null or decision in ('pass', 'improve')),
  reviewed_by_name text,
  reviewed_at timestamptz,
  refreshed_at timestamptz not null default now()
);

create index rubber_bill_evidence_projection_queue
  on private.rubber_bill_evidence_projection(location_id, review_status, client_created_at, bill_id);
create index rubber_bill_evidence_projection_history
  on private.rubber_bill_evidence_projection(location_id, reviewed_at desc, bill_id desc)
  where review_status in ('pass', 'improve');

revoke all on private.rubber_bill_evidence_projection from public, anon, authenticated;

create or replace function private.refresh_rubber_bill_evidence_projection(p_bill_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill_ids uuid[] := array(select distinct id from unnest(coalesce(p_bill_ids, array[]::uuid[])) id where id is not null);
begin
  if cardinality(v_bill_ids) = 0 then return; end if;

  delete from private.rubber_bill_evidence_projection p
  where p.bill_id = any(v_bill_ids)
    and not exists (
      select 1 from public.rubber_bills b
      where b.id = p.bill_id and b.record_status = 'active'
    );

  insert into private.rubber_bill_evidence_projection (
    bill_id, location_id, revision_no, client_created_at, review_period_id,
    review_status, missing_rubber, missing_display_in, has_manual_correction,
    is_unpriced, has_any_evidence, required_role_count, present_required_role_count,
    decision, reviewed_by_name, reviewed_at, refreshed_at
  )
  select s.bill_id, s.location_id, s.revision_no, s.client_created_at, s.review_period_id,
    s.review_status, s.missing_rubber, s.missing_display_in, s.has_manual_correction,
    s.is_unpriced, s.has_any_evidence, s.required_role_count, s.present_required_role_count,
    s.decision, s.reviewed_by_name, s.reviewed_at, now()
  from public.rubber_bills b
  cross join lateral private.rubber_bill_evidence_review_states_for_bills(b.location_id, array[b.id]) s
  where b.id = any(v_bill_ids) and b.record_status = 'active'
  on conflict (bill_id) do update set
    location_id = excluded.location_id,
    revision_no = excluded.revision_no,
    client_created_at = excluded.client_created_at,
    review_period_id = excluded.review_period_id,
    review_status = excluded.review_status,
    missing_rubber = excluded.missing_rubber,
    missing_display_in = excluded.missing_display_in,
    has_manual_correction = excluded.has_manual_correction,
    is_unpriced = excluded.is_unpriced,
    has_any_evidence = excluded.has_any_evidence,
    required_role_count = excluded.required_role_count,
    present_required_role_count = excluded.present_required_role_count,
    decision = excluded.decision,
    reviewed_by_name = excluded.reviewed_by_name,
    reviewed_at = excluded.reviewed_at,
    refreshed_at = excluded.refreshed_at;
end;
$$;

create or replace function private.rebuild_rubber_bill_evidence_projection(p_location_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_count bigint;
begin
  delete from private.rubber_bill_evidence_projection where location_id = p_location_id;
  perform private.refresh_rubber_bill_evidence_projection(array(
    select b.id from public.rubber_bills b
    where b.location_id = p_location_id and b.record_status = 'active'
  ));
  select count(*) into v_count from private.rubber_bill_evidence_projection where location_id = p_location_id;
  return v_count;
end;
$$;

create or replace function private.rubber_bill_evidence_projection_drift(p_location_id uuid)
returns table(bill_id uuid, drift_kind text)
language sql
stable
security definer
set search_path = ''
as $$
  with canonical as (
    select * from private.rubber_bill_evidence_review_states(p_location_id)
  ), projected as (
    select * from private.rubber_bill_evidence_projection p where p.location_id = p_location_id
  )
  select coalesce(c.bill_id, p.bill_id),
    case when c.bill_id is null then 'projection_only'
      when p.bill_id is null then 'canonical_only'
      else 'mismatch' end
  from canonical c
  full join projected p using (bill_id)
  where c.bill_id is null or p.bill_id is null
    or row(c.location_id, c.revision_no, c.client_created_at, c.review_period_id,
      c.review_status, c.missing_rubber, c.missing_display_in, c.has_manual_correction,
      c.is_unpriced, c.has_any_evidence, c.required_role_count,
      c.present_required_role_count, c.decision, c.reviewed_by_name, c.reviewed_at)
      is distinct from
      row(p.location_id, p.revision_no, p.client_created_at, p.review_period_id,
      p.review_status, p.missing_rubber, p.missing_display_in, p.has_manual_correction,
      p.is_unpriced, p.has_any_evidence, p.required_role_count,
      p.present_required_role_count, p.decision, p.reviewed_by_name, p.reviewed_at);
$$;

create or replace function public.repair_rubber_bill_evidence_projection(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_before bigint; v_after bigint; v_rows bigint;
begin
  perform private.require_rubber_bill_evidence_review_manager(p_location_id);
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  select count(*) into v_before from private.rubber_bill_evidence_projection_drift(p_location_id);
  select private.rebuild_rubber_bill_evidence_projection(p_location_id) into v_rows;
  select count(*) into v_after from private.rubber_bill_evidence_projection_drift(p_location_id);
  return jsonb_build_object('driftBefore', v_before, 'driftAfter', v_after, 'rowCount', v_rows);
end;
$$;

revoke all on function private.refresh_rubber_bill_evidence_projection(uuid[]),
  private.rebuild_rubber_bill_evidence_projection(uuid),
  private.rubber_bill_evidence_projection_drift(uuid) from public, anon, authenticated;
revoke all on function public.repair_rubber_bill_evidence_projection(uuid) from public, anon;
grant execute on function public.repair_rubber_bill_evidence_projection(uuid) to authenticated;

create or replace function private.refresh_rubber_evidence_from_bills()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_rubber_bill_evidence_projection(array[coalesce(new.id, old.id)]);
  return coalesce(new, old);
end; $$;

create or replace function private.refresh_rubber_evidence_from_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_rubber_bill_evidence_projection(array[coalesce(new.bill_id, old.bill_id)]);
  return coalesce(new, old);
end; $$;

create or replace function private.refresh_rubber_evidence_from_files()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_bill_id uuid;
begin
  select i.bill_id into v_bill_id from public.rubber_bill_items i
  where i.id = coalesce(new.bill_item_id, old.bill_item_id);
  perform private.refresh_rubber_bill_evidence_projection(array[v_bill_id]);
  return coalesce(new, old);
end; $$;

create or replace function private.refresh_rubber_evidence_from_reviews()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_rubber_bill_evidence_projection(array[coalesce(new.bill_id, old.bill_id)]);
  return coalesce(new, old);
end; $$;

create or replace function private.refresh_rubber_evidence_from_periods()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_location_id uuid := coalesce(new.location_id, old.location_id);
declare v_opened_at timestamptz := least(coalesce(new.opened_at, 'infinity'), coalesce(old.opened_at, 'infinity'));
declare v_closed_at timestamptz := greatest(coalesce(new.closed_at, 'infinity'), coalesce(old.closed_at, 'infinity'));
begin
  perform private.refresh_rubber_bill_evidence_projection(array(
    select b.id from public.rubber_bills b
    where b.location_id = v_location_id and b.record_status = 'active'
      and b.client_created_at >= v_opened_at
      and b.client_created_at < v_closed_at
  ));
  return coalesce(new, old);
end; $$;

create trigger refresh_rubber_evidence_bill
after insert or update or delete on public.rubber_bills
for each row execute function private.refresh_rubber_evidence_from_bills();
create trigger refresh_rubber_evidence_item
after insert or update or delete on public.rubber_bill_items
for each row execute function private.refresh_rubber_evidence_from_items();
create trigger refresh_rubber_evidence_file
after insert or update or delete on public.rubber_bill_item_evidence_files
for each row execute function private.refresh_rubber_evidence_from_files();
create trigger refresh_rubber_evidence_review
after insert or update or delete on public.rubber_bill_evidence_reviews
for each row execute function private.refresh_rubber_evidence_from_reviews();
create trigger refresh_rubber_evidence_period
after insert or update or delete on public.rubber_bill_evidence_review_periods
for each row execute function private.refresh_rubber_evidence_from_periods();

-- Backfill before any read consumer is cut over.
select private.rebuild_rubber_bill_evidence_projection(l.id)
from public.locations l;

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
    select p.*, b.*,
      case when p_view = 'pending' then p.client_created_at
        else coalesce(p.reviewed_at, p.client_created_at) end feed_sort_at
    from private.rubber_bill_evidence_projection p
    join public.rubber_bills b on b.id = p.bill_id and b.record_status = 'active'
    where p.location_id = p_location_id
      and (
        p_bill_id is not null and p.bill_id = p_bill_id
        or p_bill_id is null and v_search <> '' and position(v_search in lower(concat_ws(' ',
          b.bill_no, b.local_bill_no, b.server_bill_no, b.customer_name, b.bill_date::text
        ))) > 0
        or p_bill_id is null and v_search = '' and p_view = 'pending' and p.review_status = 'pending'
        or p_bill_id is null and v_search = '' and p_view = 'history' and p.review_status in ('pass', 'improve')
      )
  ), scoped as (
    select c.* from candidates c
    where p_cursor_sort_at is null
      or (v_ascending and (c.feed_sort_at, c.bill_id) > (p_cursor_sort_at, p_cursor_bill_id))
      or (not v_ascending and (c.feed_sort_at, c.bill_id) < (p_cursor_sort_at, p_cursor_bill_id))
    order by case when v_ascending then feed_sort_at end asc,
      case when not v_ascending then feed_sort_at end desc,
      case when v_ascending then bill_id end asc,
      case when not v_ascending then bill_id end desc
    limit p_page_size + 1
  ), visible as (
    select * from scoped
    order by case when v_ascending then feed_sort_at end asc,
      case when not v_ascending then feed_sort_at end desc,
      case when v_ascending then bill_id end asc,
      case when not v_ascending then bill_id end desc
    limit p_page_size
  ), serialized as (
    select v.feed_sort_at, v.bill_id,
      to_jsonb(v) - 'feed_sort_at' || jsonb_build_object(
        'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sequence_no, i.id)
          from public.rubber_bill_items i where i.bill_id = v.bill_id), '[]'::jsonb),
        'evidence_state', jsonb_build_object(
          'location_id', v.location_id, 'bill_id', v.bill_id, 'revision_no', v.revision_no,
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

revoke all on function public.get_rubber_bill_evidence_feed(uuid, text, text, uuid, timestamptz, uuid, integer)
from public, anon;
grant execute on function public.get_rubber_bill_evidence_feed(uuid, text, text, uuid, timestamptz, uuid, integer)
to authenticated;

create or replace function public.get_rubber_bill_evidence_states_for_bills(p_location_id uuid, p_bill_ids uuid[])
returns table (
  location_id uuid, bill_id uuid, revision_no integer, client_created_at timestamptz,
  review_period_id uuid, review_status text, missing_rubber boolean,
  missing_display_in boolean, has_manual_correction boolean, is_unpriced boolean,
  has_any_evidence boolean, required_role_count bigint, present_required_role_count bigint,
  decision text, reviewed_by_name text, reviewed_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED';
  end if;
  return query select p.location_id, p.bill_id, p.revision_no, p.client_created_at,
    p.review_period_id, p.review_status, p.missing_rubber, p.missing_display_in,
    p.has_manual_correction, p.is_unpriced, p.has_any_evidence,
    p.required_role_count, p.present_required_role_count, p.decision,
    p.reviewed_by_name, p.reviewed_at
  from private.rubber_bill_evidence_projection p
  where p.location_id = p_location_id and p.bill_id = any(coalesce(p_bill_ids, array[]::uuid[]));
end; $$;

create or replace function public.get_rubber_bill_evidence_review_states(p_location_id uuid)
returns table (
  location_id uuid, bill_id uuid, revision_no integer, client_created_at timestamptz,
  review_period_id uuid, review_status text, missing_rubber boolean,
  missing_display_in boolean, has_manual_correction boolean, is_unpriced boolean,
  has_any_evidence boolean, required_role_count bigint, present_required_role_count bigint,
  decision text, reviewed_by_name text, reviewed_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED';
  end if;
  return query select p.location_id, p.bill_id, p.revision_no, p.client_created_at,
    p.review_period_id, p.review_status, p.missing_rubber, p.missing_display_in,
    p.has_manual_correction, p.is_unpriced, p.has_any_evidence,
    p.required_role_count, p.present_required_role_count, p.decision,
    p.reviewed_by_name, p.reviewed_at
  from private.rubber_bill_evidence_projection p where p.location_id = p_location_id;
end; $$;

create or replace function public.get_rubber_bill_evidence_review_overview(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_period public.rubber_bill_evidence_review_periods%rowtype; v_count bigint; v_fingerprint text;
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED';
  end if;
  select * into v_period from public.rubber_bill_evidence_review_periods
    where location_id = p_location_id and closed_at is null order by opened_at desc limit 1;
  select count(*), md5(coalesce(string_agg(concat(p.bill_id::text, ':', p.revision_no::text), ',' order by p.bill_id, p.revision_no), ''))
  into v_count, v_fingerprint from private.rubber_bill_evidence_projection p
  where p.location_id = p_location_id and p.review_status = 'pending';
  return jsonb_build_object('isOpen', v_period.id is not null, 'periodId', v_period.id,
    'openedAt', v_period.opened_at, 'openedByName', v_period.opened_by_name,
    'pendingCount', coalesce(v_count, 0), 'pendingFingerprint', coalesce(v_fingerprint, md5('')));
end; $$;

create or replace function public.get_weight_evidence_review_digest()
returns table(location_id uuid, branch_name text, normal_today bigint, pending_today bigint,
  pass_today bigint, improve_today bigint, pending_before_today bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  return query
  with settings as (
    select evidence_all_locations, evidence_location_ids from public.telegram_badge_settings where id = true
  ), selected_locations as (
    select l.id, l.name from public.locations l cross join settings cfg
    where l.is_active = true and (cfg.evidence_all_locations or l.id = any(cfg.evidence_location_ids))
  )
  select l.id, l.name,
    count(*) filter (where p.review_status = 'normal' and (p.client_created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date)::bigint,
    count(*) filter (where p.review_status = 'pending' and (p.client_created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date)::bigint,
    count(*) filter (where p.review_status = 'pass' and (p.client_created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date)::bigint,
    count(*) filter (where p.review_status = 'improve' and (p.client_created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date)::bigint,
    count(*) filter (where p.review_status = 'pending' and (p.client_created_at at time zone 'Asia/Bangkok')::date < (now() at time zone 'Asia/Bangkok')::date)::bigint
  from selected_locations l join private.rubber_bill_evidence_projection p on p.location_id = l.id
  where p.review_status <> 'outside'
  group by l.id, l.name
  having count(*) filter (where p.review_status = 'pending' or p.review_status = 'improve') > 0
  order by l.name, l.id;
end; $$;

notify pgrst, 'reload schema';
