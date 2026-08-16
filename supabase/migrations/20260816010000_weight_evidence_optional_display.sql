begin;

lock table public.rubber_bills in access exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.rubber_bills
    where evidence_completion_id is not null
  ) then
    raise exception 'WEIGHT_EVIDENCE_COMPLETION_PREFLIGHT_FAILED';
  end if;
end;
$$;

drop function if exists public.claim_weight_evidence_completion(uuid, uuid, integer, uuid, integer);

create function public.claim_weight_evidence_completion(
  p_bill_id uuid,
  p_location_id uuid,
  p_revision_no integer,
  p_completion_id uuid
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
  if p_bill_id is null
    or p_completion_id is null
    or p_revision_no is null
    or p_revision_no < 0
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
    return jsonb_build_object(
      'state', 'stale',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;

  select count(*)::integer into v_weigh_row_count
  from public.rubber_bill_items
  where bill_id = p_bill_id and item_type = 'weigh';

  if v_weigh_row_count = 0 then
    raise exception 'WEIGHT_EVIDENCE_INVALID_COUNT';
  end if;

  if v_bill.evidence_completion_id is null then
    update public.rubber_bills
    set evidence_completion_id = p_completion_id,
        updated_at = now()
    where id = p_bill_id;
    return jsonb_build_object(
      'state', 'owned',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;
  if v_bill.evidence_completion_id = p_completion_id then
    return jsonb_build_object(
      'state', 'owned',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;
  return jsonb_build_object(
    'state', 'owned_by_other',
    'currentRevisionNo', v_bill.revision_no
  );
end;
$$;

create or replace function public.release_weight_evidence_completion(
  p_bill_id uuid,
  p_location_id uuid,
  p_revision_no integer,
  p_completion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.rubber_bills%rowtype;
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null or p_completion_id is null
    or p_revision_no is null or p_revision_no < 0
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
    return jsonb_build_object(
      'state', 'stale',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;
  if v_bill.evidence_completion_id is distinct from p_completion_id then
    return jsonb_build_object(
      'state', 'not_owner',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;

  update public.rubber_bills
  set evidence_completion_id = null,
      updated_at = now()
  where id = p_bill_id;
  return jsonb_build_object(
    'state', 'released',
    'currentRevisionNo', v_bill.revision_no
  );
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
    new.evidence_completion_id := null;
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
     and (to_jsonb(new) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name'])
       = (to_jsonb(old) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name']) then
    return new;
  end if;

  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);

  if v_report_no is not null then
    if tg_argv[0] = 'rubber_bill'
      and tg_op = 'UPDATE'
      and (to_jsonb(new) - array[
        'print_status',
        'updated_at',
        'evidence_completion_id'
      ]) = (to_jsonb(old) - array[
        'print_status',
        'updated_at',
        'evidence_completion_id'
      ]) then
      return new;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

alter table public.rubber_bills
  drop constraint if exists rubber_bills_evidence_manual_correction_count_nonnegative,
  drop column evidence_manual_correction_count;

drop function if exists public.get_weight_evidence_digest();

create function public.get_weight_evidence_digest()
returns table (
  location_id uuid,
  branch_name text,
  bill_id uuid,
  bill_recorded_at timestamptz,
  weigh_row_count bigint
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
    count(i.id)::bigint
  from public.rubber_bills b
  join public.rubber_bill_items i
    on i.bill_id = b.id and i.item_type = 'weigh'
  left join public.locations l on l.id = b.location_id
  where b.record_status = 'active'
    and b.source_rubber_export_id is null
    and b.bill_date = (now() at time zone 'Asia/Bangkok')::date
    and b.evidence_completion_id is null
  group by b.id, b.location_id, l.name,
    b.client_recorded_at, b.server_received_at, b.created_at
  order by coalesce(l.name, 'ไม่ทราบสาขา'),
    coalesce(b.client_recorded_at, b.server_received_at, b.created_at),
    b.id;
end;
$$;

revoke all on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid)
  to authenticated;
revoke all on function public.release_weight_evidence_completion(uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.release_weight_evidence_completion(uuid, uuid, integer, uuid)
  to authenticated;
revoke all on function public.get_weight_evidence_digest()
  from public, anon, authenticated;
grant execute on function public.get_weight_evidence_digest()
  to service_role;

revoke all on function private.clear_weight_evidence_completion_on_bill_change()
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
