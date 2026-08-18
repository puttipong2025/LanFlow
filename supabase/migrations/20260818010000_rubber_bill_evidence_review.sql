-- Branch-scoped rubber bill evidence review with one canonical status projection.

create table public.rubber_bill_evidence_review_periods (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  opened_at timestamptz not null default now(),
  opened_by_user_id uuid not null references public.profiles(id),
  opened_by_name text not null,
  closed_at timestamptz,
  closed_by_user_id uuid references public.profiles(id),
  closed_by_name text,
  constraint rubber_bill_evidence_review_periods_close_order
    check (closed_at is null or closed_at >= opened_at),
  constraint rubber_bill_evidence_review_periods_close_actor
    check (
      (closed_at is null and closed_by_user_id is null and closed_by_name is null)
      or (closed_at is not null and closed_by_user_id is not null and closed_by_name is not null)
    )
);

create unique index rubber_bill_evidence_review_periods_one_open_per_location
  on public.rubber_bill_evidence_review_periods(location_id)
  where closed_at is null;

create index rubber_bill_evidence_review_periods_scope_lookup
  on public.rubber_bill_evidence_review_periods(location_id, opened_at, closed_at);

create table public.rubber_bill_evidence_reviews (
  bill_id uuid primary key references public.rubber_bills(id) on delete cascade,
  revision_no integer not null check (revision_no >= 0),
  decision text not null check (decision in ('pass', 'improve')),
  reviewed_by_user_id uuid not null references public.profiles(id),
  reviewed_by_name text not null,
  reviewed_at timestamptz not null default now()
);

alter table public.rubber_bill_evidence_review_periods enable row level security;
alter table public.rubber_bill_evidence_reviews enable row level security;

create policy rubber_bill_evidence_review_periods_branch_read
  on public.rubber_bill_evidence_review_periods
  for select to authenticated
  using (private.can_access_location(location_id));

create policy rubber_bill_evidence_reviews_branch_read
  on public.rubber_bill_evidence_reviews
  for select to authenticated
  using (
    exists (
      select 1
      from public.rubber_bills b
      where b.id = bill_id
        and private.can_access_location(b.location_id)
    )
  );

revoke all on public.rubber_bill_evidence_review_periods,
  public.rubber_bill_evidence_reviews from public, anon, authenticated;
grant select on public.rubber_bill_evidence_review_periods,
  public.rubber_bill_evidence_reviews to authenticated;
grant all on public.rubber_bill_evidence_review_periods,
  public.rubber_bill_evidence_reviews to service_role;

-- Count a missing required evidence role without exposing Drive metadata.
create or replace function private.rubber_bill_evidence_review_states(p_location_id uuid)
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
language sql
stable
security definer
set search_path = ''
as $$
  with bill_rows as (
    select
      b.id bill_id,
      b.location_id,
      b.revision_no,
      b.client_created_at,
      b.bill_type,
      b.source_rubber_export_id,
      b.evidence_manual_correction_count,
      count(distinct i.id) filter (where i.item_type = 'weigh')::bigint weigh_row_count,
      bool_or(coalesce(i.price, 0) <= 0) filter (where i.item_type = 'weigh') is_unpriced,
      count(f.bill_item_id) filter (
        where i.item_type = 'weigh' and f.role in ('rubber', 'displayIn')
      )::bigint present_required_role_count,
      count(f.bill_item_id) filter (
        where i.item_type = 'weigh' and f.role = 'rubber'
      )::bigint present_rubber_count,
      count(f.bill_item_id) filter (
        where i.item_type = 'weigh' and f.role = 'displayIn'
      )::bigint present_display_in_count,
      bool_or(f.bill_item_id is not null) has_any_evidence
    from public.rubber_bills b
    left join public.rubber_bill_items i on i.bill_id = b.id
    left join public.rubber_bill_item_evidence_files f
      on f.bill_item_id = i.id
     and f.revision_no = b.revision_no
    where b.location_id = p_location_id
      and b.record_status = 'active'
    group by b.id
  ), scoped as (
    select
      b.*,
      p.id review_period_id,
      r.decision,
      r.reviewed_by_name,
      r.reviewed_at,
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
    s.location_id,
    s.bill_id,
    s.revision_no,
    s.client_created_at,
    case
      when s.bill_type in ('weighing', 'บิลเครื่องชั่งเล็ก')
       and s.source_rubber_export_id is null
       and s.weigh_row_count > 0
      then s.review_period_id
      else null
    end,
    case
      when s.bill_type not in ('weighing', 'บิลเครื่องชั่งเล็ก')
        or s.source_rubber_export_id is not null
        or s.weigh_row_count = 0
        or s.client_created_at is null
        or s.review_period_id is null then 'outside'
      when s.decision is not null then s.decision
      when s.present_required_role_count < s.required_role_count
        or s.evidence_manual_correction_count > 0 then 'pending'
      else 'normal'
    end,
    s.weigh_row_count > s.present_rubber_count,
    s.weigh_row_count > s.present_display_in_count,
    s.evidence_manual_correction_count > 0,
    coalesce(s.is_unpriced, false),
    coalesce(s.has_any_evidence, false),
    s.required_role_count,
    s.present_required_role_count,
    s.decision,
    s.reviewed_by_name,
    s.reviewed_at
  from scoped s
$$;

create or replace function private.rubber_bill_evidence_pending_snapshot(p_location_id uuid)
returns table(item_count bigint, item_fingerprint text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::bigint,
    md5(coalesce(string_agg(
      concat(s.bill_id::text, ':', s.revision_no::text),
      ',' order by s.bill_id, s.revision_no
    ), ''))
  from private.rubber_bill_evidence_review_states(p_location_id) s
  where s.review_status = 'pending'
$$;

create or replace function private.require_rubber_bill_evidence_review_manager(p_location_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
    or not private.can_access_location(p_location_id)
  then
    raise exception 'RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED';
  end if;
end;
$$;

create or replace function public.get_rubber_bill_evidence_review_states(p_location_id uuid)
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
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED';
  end if;
  return query select * from private.rubber_bill_evidence_review_states(p_location_id);
end;
$$;

create or replace function public.get_rubber_bill_evidence_review_overview(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period public.rubber_bill_evidence_review_periods%rowtype;
  v_count bigint;
  v_fingerprint text;
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED';
  end if;
  select * into v_period
  from public.rubber_bill_evidence_review_periods p
  where p.location_id = p_location_id and p.closed_at is null;
  select item_count, item_fingerprint into v_count, v_fingerprint
  from private.rubber_bill_evidence_pending_snapshot(p_location_id);
  return jsonb_build_object(
    'isOpen', v_period.id is not null,
    'periodId', v_period.id,
    'openedAt', v_period.opened_at,
    'openedByName', v_period.opened_by_name,
    'pendingCount', v_count,
    'pendingFingerprint', v_fingerprint
  );
end;
$$;

create or replace function public.open_rubber_bill_evidence_review_period(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_period_id uuid;
  v_count bigint;
  v_fingerprint text;
begin
  perform private.require_rubber_bill_evidence_review_manager(p_location_id);
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  if exists (
    select 1 from public.rubber_bill_evidence_review_periods
    where location_id = p_location_id and closed_at is null
  ) then
    return jsonb_build_object('state', 'already_open');
  end if;
  select item_count, item_fingerprint into v_count, v_fingerprint
  from private.rubber_bill_evidence_pending_snapshot(p_location_id);
  if v_count > 0 then
    return jsonb_build_object(
      'state', 'blocked', 'pendingCount', v_count, 'pendingFingerprint', v_fingerprint
    );
  end if;
  select * into strict v_actor from public.profiles where id = auth.uid() and is_active = true;
  insert into public.rubber_bill_evidence_review_periods (
    location_id, opened_by_user_id, opened_by_name
  ) values (p_location_id, auth.uid(), v_actor.name)
  returning id into v_period_id;
  return jsonb_build_object('state', 'opened', 'periodId', v_period_id);
end;
$$;

create or replace function public.close_rubber_bill_evidence_review_period(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_period_id uuid;
  v_count bigint;
  v_fingerprint text;
begin
  perform private.require_rubber_bill_evidence_review_manager(p_location_id);
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  select id into v_period_id
  from public.rubber_bill_evidence_review_periods
  where location_id = p_location_id and closed_at is null
  for update;
  if v_period_id is null then return jsonb_build_object('state', 'already_closed'); end if;
  select item_count, item_fingerprint into v_count, v_fingerprint
  from private.rubber_bill_evidence_pending_snapshot(p_location_id);
  if v_count > 0 then
    return jsonb_build_object(
      'state', 'blocked', 'pendingCount', v_count, 'pendingFingerprint', v_fingerprint
    );
  end if;
  select * into strict v_actor from public.profiles where id = auth.uid() and is_active = true;
  update public.rubber_bill_evidence_review_periods
  set closed_at = now(), closed_by_user_id = auth.uid(), closed_by_name = v_actor.name
  where id = v_period_id;
  return jsonb_build_object('state', 'closed', 'periodId', v_period_id);
end;
$$;

create or replace function public.decide_rubber_bill_evidence_review(
  p_location_id uuid,
  p_bill_id uuid,
  p_revision_no integer,
  p_expected_status text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_bill public.rubber_bills%rowtype;
  v_state record;
begin
  perform private.require_rubber_bill_evidence_review_manager(p_location_id);
  if p_expected_status not in ('pending', 'pass', 'improve')
    or p_decision not in ('pass', 'improve') then
    raise exception 'RUBBER_EVIDENCE_REVIEW_INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  select * into v_bill from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id for update;
  if not found or v_bill.revision_no <> p_revision_no then
    return jsonb_build_object('state', 'stale');
  end if;
  select * into v_state
  from private.rubber_bill_evidence_review_states(p_location_id) s
  where s.bill_id = p_bill_id;
  if not found or v_state.review_status <> p_expected_status then
    return jsonb_build_object('state', 'stale', 'currentStatus', v_state.review_status);
  end if;
  select * into strict v_actor from public.profiles where id = auth.uid() and is_active = true;
  insert into public.rubber_bill_evidence_reviews (
    bill_id, revision_no, decision, reviewed_by_user_id, reviewed_by_name, reviewed_at
  ) values (
    p_bill_id, p_revision_no, p_decision, auth.uid(), v_actor.name, now()
  )
  on conflict (bill_id) do update
  set revision_no = excluded.revision_no,
      decision = excluded.decision,
      reviewed_by_user_id = excluded.reviewed_by_user_id,
      reviewed_by_name = excluded.reviewed_by_name,
      reviewed_at = excluded.reviewed_at;
  return jsonb_build_object('state', 'updated', 'status', p_decision);
end;
$$;

create or replace function public.pass_all_pending_rubber_bill_evidence_reviews(
  p_location_id uuid,
  p_expected_pending_count bigint,
  p_expected_pending_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_count bigint;
  v_fingerprint text;
  v_updated bigint;
begin
  perform private.require_rubber_bill_evidence_review_manager(p_location_id);
  if p_expected_pending_count < 0 or p_expected_pending_fingerprint is null then
    raise exception 'RUBBER_EVIDENCE_REVIEW_INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  select item_count, item_fingerprint into v_count, v_fingerprint
  from private.rubber_bill_evidence_pending_snapshot(p_location_id);
  if v_count <> p_expected_pending_count or v_fingerprint <> p_expected_pending_fingerprint then
    return jsonb_build_object(
      'state', 'stale', 'pendingCount', v_count, 'pendingFingerprint', v_fingerprint
    );
  end if;
  select * into strict v_actor from public.profiles where id = auth.uid() and is_active = true;
  insert into public.rubber_bill_evidence_reviews (
    bill_id, revision_no, decision, reviewed_by_user_id, reviewed_by_name, reviewed_at
  )
  select s.bill_id, s.revision_no, 'pass', auth.uid(), v_actor.name, now()
  from private.rubber_bill_evidence_review_states(p_location_id) s
  where s.review_status = 'pending'
  on conflict (bill_id) do update
  set revision_no = excluded.revision_no,
      decision = excluded.decision,
      reviewed_by_user_id = excluded.reviewed_by_user_id,
      reviewed_by_name = excluded.reviewed_by_name,
      reviewed_at = excluded.reviewed_at;
  get diagnostics v_updated = row_count;
  return jsonb_build_object('state', 'updated', 'updatedCount', v_updated, 'skippedCount', 0);
end;
$$;

create or replace function private.clear_weight_evidence_completion_on_bill_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revision_no is distinct from old.revision_no
     or new.record_status is distinct from old.record_status then
    delete from public.rubber_bill_item_evidence_files f
    using public.rubber_bill_items i
    where f.bill_item_id = i.id and i.bill_id = old.id;
    delete from public.rubber_bill_evidence_reviews where bill_id = old.id;
    new.evidence_completion_id := null;
    new.evidence_manual_correction_count := 0;
  end if;
  return new;
end;
$$;

-- Serialize Android completion claims with review-period and review-decision writes.
create or replace function public.claim_weight_evidence_completion(
  p_bill_id uuid,
  p_location_id uuid,
  p_revision_no integer,
  p_completion_id uuid,
  p_manual_correction_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.rubber_bills%rowtype;
  v_weigh_row_count integer;
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null or p_completion_id is null
    or p_revision_no is null or p_revision_no < 0
    or p_manual_correction_count is null or p_manual_correction_count < 0 then
    raise exception 'WEIGHT_EVIDENCE_INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  select * into v_bill from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id for update;
  if not found or v_bill.record_status <> 'active' or v_bill.source_rubber_export_id is not null then
    return jsonb_build_object('state', 'inactive');
  end if;
  if v_bill.revision_no <> p_revision_no then
    return jsonb_build_object('state', 'stale', 'currentRevisionNo', v_bill.revision_no);
  end if;
  select count(*)::integer into v_weigh_row_count
  from public.rubber_bill_items where bill_id = p_bill_id and item_type = 'weigh';
  if v_weigh_row_count = 0 or p_manual_correction_count > v_weigh_row_count * 2 then
    raise exception 'WEIGHT_EVIDENCE_INVALID_COUNT';
  end if;
  if v_bill.evidence_completion_id is null then
    update public.rubber_bills
    set evidence_completion_id = p_completion_id,
        evidence_manual_correction_count = p_manual_correction_count,
        updated_at = now()
    where id = p_bill_id;
    return jsonb_build_object('state', 'owned', 'currentRevisionNo', v_bill.revision_no);
  end if;
  if v_bill.evidence_completion_id = p_completion_id then
    return jsonb_build_object('state', 'owned', 'currentRevisionNo', v_bill.revision_no);
  end if;
  return jsonb_build_object('state', 'owned_by_other', 'currentRevisionNo', v_bill.revision_no);
end;
$$;

create or replace function public.record_weight_evidence_backup(
  p_bill_id uuid,
  p_row_id uuid,
  p_role text,
  p_location_id uuid,
  p_revision_no integer,
  p_completion_id uuid,
  p_evidence_key text,
  p_drive_file_id text,
  p_web_view_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.rubber_bills%rowtype;
  v_existing public.rubber_bill_item_evidence_files%rowtype;
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null or p_row_id is null or p_completion_id is null
    or p_revision_no is null or p_revision_no < 0
    or p_role not in ('rubber', 'displayIn', 'displayOut')
    or nullif(btrim(p_evidence_key), '') is null
    or p_evidence_key <> concat_ws(':', p_completion_id::text, p_revision_no::text, p_row_id::text, p_role)
    or nullif(btrim(p_drive_file_id), '') is null
    or nullif(btrim(p_web_view_url), '') is null then
    raise exception 'WEIGHT_EVIDENCE_INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  select * into v_bill from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id for update;
  if not found or v_bill.record_status <> 'active' or v_bill.source_rubber_export_id is not null then
    return jsonb_build_object('state', 'inactive');
  end if;
  if v_bill.revision_no <> p_revision_no then return jsonb_build_object('state', 'stale'); end if;
  if v_bill.evidence_completion_id is distinct from p_completion_id then
    return jsonb_build_object('state', 'not_owner');
  end if;
  if not exists (
    select 1 from public.rubber_bill_items
    where id = p_row_id and bill_id = p_bill_id and item_type = 'weigh'
  ) then return jsonb_build_object('state', 'invalid_row'); end if;
  select * into v_existing from public.rubber_bill_item_evidence_files
  where bill_item_id = p_row_id and role = p_role;
  if found then
    if v_existing.evidence_key = p_evidence_key then
      return jsonb_build_object('state', 'stored', 'fileId', v_existing.drive_file_id, 'webViewUrl', v_existing.web_view_url);
    end if;
    return jsonb_build_object('state', 'conflict');
  end if;
  begin
    insert into public.rubber_bill_item_evidence_files (
      bill_item_id, role, completion_id, revision_no, evidence_key, drive_file_id, web_view_url
    ) values (
      p_row_id, p_role, p_completion_id, p_revision_no, p_evidence_key, p_drive_file_id, p_web_view_url
    );
  exception when unique_violation then
    select * into v_existing from public.rubber_bill_item_evidence_files
    where evidence_key = p_evidence_key or (bill_item_id = p_row_id and role = p_role)
    limit 1;
    if v_existing.evidence_key = p_evidence_key then
      return jsonb_build_object('state', 'stored', 'fileId', v_existing.drive_file_id, 'webViewUrl', v_existing.web_view_url);
    end if;
    return jsonb_build_object('state', 'conflict');
  end;
  return jsonb_build_object('state', 'stored', 'fileId', p_drive_file_id, 'webViewUrl', p_web_view_url);
end;
$$;

revoke all on function private.rubber_bill_evidence_review_states(uuid),
  private.rubber_bill_evidence_pending_snapshot(uuid),
  private.require_rubber_bill_evidence_review_manager(uuid) from public, anon, authenticated;
revoke all on function public.get_rubber_bill_evidence_review_states(uuid),
  public.get_rubber_bill_evidence_review_overview(uuid),
  public.open_rubber_bill_evidence_review_period(uuid),
  public.close_rubber_bill_evidence_review_period(uuid),
  public.decide_rubber_bill_evidence_review(uuid, uuid, integer, text, text),
  public.pass_all_pending_rubber_bill_evidence_reviews(uuid, bigint, text) from public, anon;
grant execute on function public.get_rubber_bill_evidence_review_states(uuid),
  public.get_rubber_bill_evidence_review_overview(uuid),
  public.open_rubber_bill_evidence_review_period(uuid),
  public.close_rubber_bill_evidence_review_period(uuid),
  public.decide_rubber_bill_evidence_review(uuid, uuid, integer, text, text),
  public.pass_all_pending_rubber_bill_evidence_reviews(uuid, bigint, text) to authenticated;

-- Evidence branch selection reuses the existing Telegram switch and interval.
alter table public.telegram_badge_settings
  add column evidence_all_locations boolean not null default true,
  add column evidence_location_ids uuid[] not null default array[]::uuid[];

create or replace function public.get_telegram_evidence_location_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.telegram_badge_settings%rowtype;
  v_locations jsonb;
begin
  perform private.telegram_badge_require_manager();
  select * into strict v_settings from public.telegram_badge_settings where id = true;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'name', l.name
    ) order by l.name, l.id
  ), '[]'::jsonb)
  into v_locations
  from public.locations l
  where l.is_active = true;
  return jsonb_build_object(
    'allLocations', v_settings.evidence_all_locations,
    'locationIds', to_jsonb(v_settings.evidence_location_ids),
    'locations', v_locations
  );
end;
$$;

create or replace function public.save_telegram_evidence_location_config(
  p_all_locations boolean,
  p_location_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  perform private.telegram_badge_require_manager();
  if p_all_locations is null or p_location_ids is null then
    raise exception 'TELEGRAM_EVIDENCE_LOCATION_INVALID_INPUT';
  end if;
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_ids
  from (select distinct unnest(p_location_ids) id) selected;
  if not p_all_locations and cardinality(v_ids) = 0 then
    raise exception 'กรุณาเลือกอย่างน้อยหนึ่งสาขา';
  end if;
  if exists (
    select 1 from unnest(v_ids) id
    where not exists (select 1 from public.locations l where l.id = id and l.is_active = true)
  ) then
    raise exception 'สาขาที่เลือกไม่ถูกต้องหรือปิดใช้งานแล้ว';
  end if;
  update public.telegram_badge_settings
  set evidence_all_locations = p_all_locations,
      evidence_location_ids = case when p_all_locations then array[]::uuid[] else v_ids end,
      updated_by_user_id = auth.uid(),
      updated_at = now()
  where id = true;
  return public.get_telegram_evidence_location_config();
end;
$$;

create or replace function public.save_telegram_badge_config_with_evidence_locations(
  payload jsonb,
  p_all_locations boolean,
  p_location_ids uuid[]
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_config jsonb;
  v_locations jsonb;
begin
  v_config := public.save_telegram_badge_config(payload);
  v_locations := public.save_telegram_evidence_location_config(
    p_all_locations,
    p_location_ids
  );
  return v_config || jsonb_build_object(
    'evidenceAllLocations', v_locations->'allLocations',
    'evidenceLocationIds', v_locations->'locationIds',
    'evidenceLocations', v_locations->'locations'
  );
end;
$$;

revoke all on function public.get_telegram_evidence_location_config(),
  public.save_telegram_evidence_location_config(boolean, uuid[]),
  public.save_telegram_badge_config_with_evidence_locations(jsonb, boolean, uuid[])
  from public, anon;
grant execute on function public.get_telegram_evidence_location_config(),
  public.save_telegram_evidence_location_config(boolean, uuid[]),
  public.save_telegram_badge_config_with_evidence_locations(jsonb, boolean, uuid[])
  to authenticated;

create or replace function public.get_weight_evidence_review_digest()
returns table (
  location_id uuid,
  branch_name text,
  normal_today bigint,
  pending_today bigint,
  pass_today bigint,
  improve_today bigint,
  pending_before_today bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  return query
  with settings as (
    select evidence_all_locations, evidence_location_ids
    from public.telegram_badge_settings where id = true
  ), selected_locations as (
    select l.id, l.name
    from public.locations l cross join settings cfg
    where l.is_active = true
      and (cfg.evidence_all_locations or l.id = any(cfg.evidence_location_ids))
  ), states as (
    select l.id, l.name, s.review_status, s.client_created_at
    from selected_locations l
    cross join lateral private.rubber_bill_evidence_review_states(l.id) s
    where s.review_status <> 'outside'
  ), counts as (
    select
      s.id,
      s.name,
      count(*) filter (
        where s.review_status = 'normal'
          and (s.client_created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date
      )::bigint normal_today,
      count(*) filter (
        where s.review_status = 'pending'
          and (s.client_created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date
      )::bigint pending_today,
      count(*) filter (
        where s.review_status = 'pass'
          and (s.client_created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date
      )::bigint pass_today,
      count(*) filter (
        where s.review_status = 'improve'
          and (s.client_created_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date
      )::bigint improve_today,
      count(*) filter (
        where s.review_status = 'pending'
          and (s.client_created_at at time zone 'Asia/Bangkok')::date < (now() at time zone 'Asia/Bangkok')::date
      )::bigint pending_before_today
    from states s
    group by s.id, s.name
  )
  select c.id, c.name, c.normal_today, c.pending_today, c.pass_today,
    c.improve_today, c.pending_before_today
  from counts c
  where c.pending_today > 0 or c.improve_today > 0 or c.pending_before_today > 0
  order by c.name, c.id;
end;
$$;

revoke all on function public.get_weight_evidence_review_digest() from public, anon, authenticated;
grant execute on function public.get_weight_evidence_review_digest() to service_role;

-- Rubber module Badge counts zero-price and pending-evidence bills once per bill.
create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_can_manage_system boolean;
  v_can_use_money_transfer boolean;
  v_can_manage_time_payroll boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select
    p.role,
    p.role = 'super_admin' or p.can_access_super_admin_features = true,
    p.role = 'super_admin' or p.can_access_super_admin_features = true or p.can_access_money_transfer = true,
    p.role = 'super_admin' or p.can_access_super_admin_features = true or p.can_manage_time_payroll = true
  into v_role, v_can_manage_system, v_can_use_money_transfer, v_can_manage_time_payroll
  from public.profiles p
  where p.id = v_user_id and p.is_active = true;
  if v_role is null then raise exception 'Inactive profile'; end if;

  return query
  with accessible_locations as (
    select ul.location_id
    from public.user_locations ul
    join public.locations l on l.id = ul.location_id and l.is_active = true
    where ul.user_id = v_user_id
  ),
  scoped_time_requests as (
    select ft.id, ft.profile_id from public.financial_transactions ft where ft.status = 'PENDING'
    union all
    select ps.id, ps.profile_id from public.payroll_slips ps where ps.status = 'PENDING'
  ),
  rubber_bill_work as (
    select al.location_id, b.blocker_id bill_id
    from accessible_locations al
    cross join lateral private.rubber_bill_report_blockers(al.location_id, now()) b
    where b.blocker_type = 'zero_price'
    union
    select al.location_id, s.bill_id
    from accessible_locations al
    cross join lateral private.rubber_bill_evidence_review_states(al.location_id) s
    where s.review_status = 'pending'
  ),
  counts as (
    select w.location_id, 'rubber'::text module_id, count(*)::bigint item_count
    from rubber_bill_work w group by w.location_id

    union all
    select al.location_id, 'rubber', count(*)::bigint
    from accessible_locations al
    cross join lateral private.rubber_bill_report_blockers(al.location_id, now()) b
    where v_can_manage_system and b.blocker_type <> 'zero_price'
    group by al.location_id

    union all
    select t.target_location_id, 'cash', count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    join accessible_locations al on al.location_id = t.target_location_id
    where d.cash_status = 'pending_receipt' and t.record_status <> 'deleted'
    group by t.target_location_id

    union all
    select r.location_id, 'cash', count(*)::bigint
    from public.income_expense_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select r.source_location_id, 'cash', count(*)::bigint
    from public.cash_transfer_delete_requests r
    join accessible_locations al on al.location_id = r.source_location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.source_location_id

    union all
    select t.location_id, 'money-transfer', count(*)::bigint
    from public.money_transfers t
    join accessible_locations al on al.location_id = t.location_id
    where v_can_use_money_transfer
      and t.transfer_method = 'bank'
      and t.transfer_status in ('pending', 'partial', 'advance_payment')
      and t.record_status <> 'deleted'
    group by t.location_id

    union all
    select r.location_id, 'acid-stock', count(*)::bigint
    from public.stock_entry_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select al.location_id, 'acid-stock', count(r.id)::bigint
    from accessible_locations al cross join public.stock_product_approval_requests r
    where v_can_manage_system and r.request_status = 'pending'
    group by al.location_id

    union all
    select al.location_id, 'time-tracking', count(requests.id)::bigint
    from accessible_locations al cross join scoped_time_requests requests
    where v_can_manage_system
    group by al.location_id

    union all
    select target_primary.location_id, 'time-tracking', count(requests.id)::bigint
    from scoped_time_requests requests
    join public.user_locations target_primary
      on target_primary.user_id = requests.profile_id and target_primary.is_primary = true
    join accessible_locations al on al.location_id = target_primary.location_id
    where not v_can_manage_system
      and v_can_manage_time_payroll
      and private.can_manage_time_payroll_profile(requests.profile_id)
    group by target_primary.location_id

    union all
    select e.location_id, 'rubber-export', count(*)::bigint
    from public.rubber_exports e
    join accessible_locations al on al.location_id = e.location_id
    where (v_can_manage_system or v_role = 'admin') and e.status = 'draft'
    group by e.location_id
  )
  select c.location_id, c.module_id, sum(c.item_count)::bigint
  from counts c
  where c.item_count > 0
  group by c.location_id, c.module_id
  order by c.location_id, c.module_id;
end;
$$;

notify pgrst, 'reload schema';
