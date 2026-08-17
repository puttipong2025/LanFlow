begin;

alter table public.rubber_bills
  add column if not exists evidence_manual_correction_count integer not null default 0;

alter table public.rubber_bills
  drop constraint if exists rubber_bills_evidence_manual_correction_count_nonnegative;
alter table public.rubber_bills
  add constraint rubber_bills_evidence_manual_correction_count_nonnegative
  check (evidence_manual_correction_count >= 0);

create table public.rubber_bill_item_evidence_files (
  bill_item_id uuid not null references public.rubber_bill_items(id) on delete cascade,
  role text not null check (role in ('rubber', 'displayIn', 'displayOut')),
  completion_id uuid not null,
  revision_no integer not null check (revision_no >= 0),
  evidence_key text not null unique check (btrim(evidence_key) <> ''),
  drive_file_id text not null check (btrim(drive_file_id) <> ''),
  web_view_url text not null check (btrim(web_view_url) <> ''),
  created_at timestamptz not null default now(),
  constraint rubber_bill_item_evidence_files_deterministic_key check (
    evidence_key = concat_ws(
      ':', completion_id::text, revision_no::text, bill_item_id::text, role
    )
  ),
  primary key (bill_item_id, role)
);

alter table public.rubber_bill_item_evidence_files enable row level security;

create policy rubber_bill_item_evidence_files_parent_scope
  on public.rubber_bill_item_evidence_files
  for select to authenticated
  using (
    exists (
      select 1
      from public.rubber_bill_items i
      join public.rubber_bills b on b.id = i.bill_id
      where i.id = bill_item_id
        and public.can_access_location(b.location_id)
    )
  );

revoke all on public.rubber_bill_item_evidence_files from anon, authenticated;
grant select on public.rubber_bill_item_evidence_files to authenticated;

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
    where f.bill_item_id = i.id
      and i.bill_id = old.id;
    new.evidence_completion_id := null;
    new.evidence_manual_correction_count := 0;
  end if;
  return new;
end;
$$;

create or replace function private.guard_reported_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_report_no text;
begin
  if tg_table_name = 'rubber_exports' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'sold_out_at' - 'sold_out_by_user_id' - 'sold_out_by_name')
       = (to_jsonb(old) - 'sold_out_at' - 'sold_out_by_user_id' - 'sold_out_by_name') then
    return new;
  end if;

  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);

  if v_report_no is not null then
    if tg_table_name = 'rubber_bills'
      and tg_op = 'UPDATE'
      and (to_jsonb(new)
        - 'print_status'
        - 'updated_at'
        - 'evidence_completion_id'
        - 'evidence_manual_correction_count'
        - 'net_rubber_value'
        - 'net_weight'
        - 'payable_before_rounding')
        = (to_jsonb(old)
        - 'print_status'
        - 'updated_at'
        - 'evidence_completion_id'
        - 'evidence_manual_correction_count'
        - 'net_rubber_value'
        - 'net_weight'
        - 'payable_before_rounding') then
      return new;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

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
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null or p_completion_id is null
    or p_revision_no is null or p_revision_no < 0
    or p_manual_correction_count is null or p_manual_correction_count < 0
  then
    raise exception 'WEIGHT_EVIDENCE_INVALID_INPUT';
  end if;

  select * into v_bill
  from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id
  for update;

  if not found
    or v_bill.record_status <> 'active'
    or v_bill.source_rubber_export_id is not null
  then
    return jsonb_build_object('state', 'inactive');
  end if;
  if v_bill.revision_no <> p_revision_no then
    return jsonb_build_object('state', 'stale', 'currentRevisionNo', v_bill.revision_no);
  end if;

  select count(*)::integer into v_weigh_row_count
  from public.rubber_bill_items
  where bill_id = p_bill_id and item_type = 'weigh';

  if v_weigh_row_count = 0
    or p_manual_correction_count > v_weigh_row_count * 2
  then
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

create or replace function public.claim_weight_evidence_completion(
  p_bill_id uuid,
  p_location_id uuid,
  p_revision_no integer,
  p_completion_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.claim_weight_evidence_completion(
    p_bill_id,
    p_location_id,
    p_revision_no,
    p_completion_id,
    0
  );
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
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null or p_row_id is null or p_completion_id is null
    or p_revision_no is null or p_revision_no < 0
    or p_role not in ('rubber', 'displayIn', 'displayOut')
    or nullif(btrim(p_evidence_key), '') is null
    or p_evidence_key <> concat_ws(
      ':', p_completion_id::text, p_revision_no::text, p_row_id::text, p_role
    )
    or nullif(btrim(p_drive_file_id), '') is null
    or nullif(btrim(p_web_view_url), '') is null
  then
    raise exception 'WEIGHT_EVIDENCE_INVALID_INPUT';
  end if;

  select * into v_bill
  from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id
  for update;

  if not found
    or v_bill.record_status <> 'active'
    or v_bill.source_rubber_export_id is not null
  then
    return jsonb_build_object('state', 'inactive');
  end if;
  if v_bill.revision_no <> p_revision_no then
    return jsonb_build_object('state', 'stale');
  end if;
  if v_bill.evidence_completion_id is distinct from p_completion_id then
    return jsonb_build_object('state', 'not_owner');
  end if;
  if not exists (
    select 1 from public.rubber_bill_items
    where id = p_row_id and bill_id = p_bill_id and item_type = 'weigh'
  ) then
    return jsonb_build_object('state', 'invalid_row');
  end if;

  select * into v_existing
  from public.rubber_bill_item_evidence_files
  where bill_item_id = p_row_id and role = p_role;

  if found then
    if v_existing.evidence_key = p_evidence_key then
      return jsonb_build_object(
        'state', 'stored',
        'fileId', v_existing.drive_file_id,
        'webViewUrl', v_existing.web_view_url
      );
    end if;
    return jsonb_build_object('state', 'conflict');
  end if;

  begin
    insert into public.rubber_bill_item_evidence_files (
      bill_item_id, role, completion_id, revision_no,
      evidence_key, drive_file_id, web_view_url
    ) values (
      p_row_id, p_role, p_completion_id, p_revision_no,
      p_evidence_key, p_drive_file_id, p_web_view_url
    );
  exception when unique_violation then
    select * into v_existing
    from public.rubber_bill_item_evidence_files
    where evidence_key = p_evidence_key
       or (bill_item_id = p_row_id and role = p_role)
    limit 1;
    if v_existing.evidence_key = p_evidence_key then
      return jsonb_build_object(
        'state', 'stored',
        'fileId', v_existing.drive_file_id,
        'webViewUrl', v_existing.web_view_url
      );
    end if;
    return jsonb_build_object('state', 'conflict');
  end;

  return jsonb_build_object(
    'state', 'stored',
    'fileId', p_drive_file_id,
    'webViewUrl', p_web_view_url
  );
end;
$$;

drop function if exists public.get_weight_evidence_digest();
create function public.get_weight_evidence_digest()
returns table (
  location_id uuid,
  branch_name text,
  bill_id uuid,
  bill_recorded_at timestamptz,
  weigh_row_count bigint,
  manual_correction_count bigint,
  digest_kind text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  return query
  select b.location_id,
    coalesce(l.name, 'ไม่ทราบสาขา')::text,
    b.id,
    coalesce(b.client_recorded_at, b.server_received_at, b.created_at),
    count(i.id)::bigint,
    b.evidence_manual_correction_count::bigint,
    case when b.evidence_completion_id is null then 'incomplete' else 'corrected' end::text
  from public.rubber_bills b
  join public.rubber_bill_items i
    on i.bill_id = b.id and i.item_type = 'weigh'
  left join public.locations l on l.id = b.location_id
  where b.record_status = 'active'
    and b.source_rubber_export_id is null
    and b.bill_date = (now() at time zone 'Asia/Bangkok')::date
    and (
      b.evidence_completion_id is null
      or b.evidence_manual_correction_count > 0
    )
  group by b.id, b.location_id, l.name,
    b.client_recorded_at, b.server_received_at, b.created_at
  order by coalesce(l.name, 'ไม่ทราบสาขา'),
    coalesce(b.client_recorded_at, b.server_received_at, b.created_at),
    b.id;
end;
$$;

revoke all on function private.clear_weight_evidence_completion_on_bill_change()
  from public, anon, authenticated;
revoke all on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid)
  from public, anon;
revoke all on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid, integer)
  from public, anon;
grant execute on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid)
  to authenticated;
grant execute on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid, integer)
  to authenticated;
revoke all on function public.record_weight_evidence_backup(uuid, uuid, text, uuid, integer, uuid, text, text, text)
  from public, anon;
grant execute on function public.record_weight_evidence_backup(uuid, uuid, text, uuid, integer, uuid, text, text, text)
  to authenticated;
revoke all on function public.get_weight_evidence_digest()
  from public, anon, authenticated;
grant execute on function public.get_weight_evidence_digest()
  to service_role;

notify pgrst, 'reload schema';

commit;
