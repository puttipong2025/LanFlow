-- Device-local weight evidence uses one nullable cross-device completion owner.
-- Images, OCR values, bindings, and partial progress remain device-local.

alter table public.rubber_bills
  add column if not exists evidence_completion_id uuid;

comment on column public.rubber_bills.evidence_completion_id is
  'Opaque owner UUID for first-completer-wins device-local weight evidence; no image or OCR data.';

create or replace function private.clear_weight_evidence_completion_on_bill_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.revision_no is distinct from old.revision_no
     or new.record_status is distinct from old.record_status then
    new.evidence_completion_id := null;
  end if;
  return new;
end;
$$;

revoke all on function private.clear_weight_evidence_completion_on_bill_change() from public, anon, authenticated;

drop trigger if exists clear_weight_evidence_completion_on_bill_change on public.rubber_bills;
create trigger clear_weight_evidence_completion_on_bill_change
  before update of revision_no, record_status on public.rubber_bills
  for each row execute function private.clear_weight_evidence_completion_on_bill_change();

-- Preserve report immutability while permitting this isolated ownership field.
create or replace function private.guard_reported_entity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_report_no text;
begin
  -- Keep the operational-lifecycle exception introduced by 20260811010000.
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
      and (to_jsonb(new) - array['print_status', 'updated_at', 'evidence_completion_id'])
          = (to_jsonb(old) - array['print_status', 'updated_at', 'evidence_completion_id']) then
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
  p_completion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_bill public.rubber_bills%rowtype;
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null or p_completion_id is null or p_revision_no < 0 then
    raise exception 'WEIGHT_EVIDENCE_INVALID_INPUT';
  end if;

  select * into v_bill
  from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id
  for update;

  if not found then return jsonb_build_object('state', 'inactive'); end if;
  if v_bill.record_status <> 'active' then return jsonb_build_object('state', 'inactive', 'currentRevisionNo', v_bill.revision_no); end if;
  if v_bill.revision_no <> p_revision_no then return jsonb_build_object('state', 'stale', 'currentRevisionNo', v_bill.revision_no); end if;

  if v_bill.evidence_completion_id is null then
    update public.rubber_bills
    set evidence_completion_id = p_completion_id,
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

create or replace function public.release_weight_evidence_completion(
  p_bill_id uuid,
  p_location_id uuid,
  p_revision_no integer,
  p_completion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_bill public.rubber_bills%rowtype;
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null or p_completion_id is null or p_revision_no < 0 then
    raise exception 'WEIGHT_EVIDENCE_INVALID_INPUT';
  end if;

  select * into v_bill
  from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id
  for update;

  if not found then return jsonb_build_object('state', 'inactive'); end if;
  if v_bill.record_status <> 'active' then return jsonb_build_object('state', 'inactive', 'currentRevisionNo', v_bill.revision_no); end if;
  if v_bill.revision_no <> p_revision_no then return jsonb_build_object('state', 'stale', 'currentRevisionNo', v_bill.revision_no); end if;
  if v_bill.evidence_completion_id is distinct from p_completion_id then
    return jsonb_build_object('state', 'not_owner', 'currentRevisionNo', v_bill.revision_no);
  end if;

  update public.rubber_bills
  set evidence_completion_id = null,
      updated_at = now()
  where id = p_bill_id;
  return jsonb_build_object('state', 'released', 'currentRevisionNo', v_bill.revision_no);
end;
$$;

revoke all on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid) from public, anon;
revoke all on function public.release_weight_evidence_completion(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid) to authenticated;
grant execute on function public.release_weight_evidence_completion(uuid, uuid, integer, uuid) to authenticated;
