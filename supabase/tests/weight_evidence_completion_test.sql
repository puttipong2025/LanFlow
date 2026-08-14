\set ON_ERROR_STOP on

begin;

do $$
declare
  v_user_id uuid;
  v_location_id uuid;
  v_bill_id uuid;
  v_revision_no integer;
  v_winner uuid := gen_random_uuid();
  v_loser uuid := gen_random_uuid();
  v_result jsonb;
begin
  select p.id, b.location_id, b.id, b.revision_no
    into v_user_id, v_location_id, v_bill_id, v_revision_no
  from public.rubber_bills b
  join public.user_locations ul on ul.location_id = b.location_id
  join public.profiles p on p.id = ul.user_id and p.is_active = true
  where b.record_status = 'active'
    and b.approval_state = 'not_required'
    and not exists (
      select 1
      from public.report_items item
      join public.report_batches report on report.id = item.report_id
      where item.entity_type = 'rubber_bill'
        and item.entity_id = b.id
        and report.status = 'active'
    )
  limit 1;

  if v_bill_id is null then raise exception 'No eligible seed rubber bill for completion test'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  update public.rubber_bills set evidence_completion_id = null where id = v_bill_id;

  v_result := public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner);
  if v_result->>'state' <> 'owned' then raise exception 'first claim did not win: %', v_result; end if;

  v_result := public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner);
  if v_result->>'state' <> 'owned' then raise exception 'winner retry was not idempotent: %', v_result; end if;

  v_result := public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_loser);
  if v_result->>'state' <> 'owned_by_other' then raise exception 'second device did not lose: %', v_result; end if;

  v_result := public.release_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_loser);
  if v_result->>'state' <> 'not_owner' then raise exception 'loser released winner claim: %', v_result; end if;

  v_result := public.release_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner);
  if v_result->>'state' <> 'released' then raise exception 'winner could not release: %', v_result; end if;

  v_result := public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner);
  update public.rubber_bills set revision_no = revision_no + 1 where id = v_bill_id;
  if (select evidence_completion_id from public.rubber_bills where id = v_bill_id) is not null then
    raise exception 'revision change did not clear completion owner';
  end if;
end;
$$;

rollback;
