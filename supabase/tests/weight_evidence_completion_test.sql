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
  v_row_count integer;
  v_branch_bill_id uuid;
  v_branch_location_id uuid;
  v_branch_revision_no integer;
begin
  select p.id, b.location_id, b.id, b.revision_no
    into v_user_id, v_location_id, v_bill_id, v_revision_no
  from public.rubber_bills b
  join public.user_locations ul on ul.location_id = b.location_id
  join public.profiles p on p.id = ul.user_id and p.is_active = true
  where b.record_status = 'active'
    and b.source_rubber_export_id is null
    and b.approval_state = 'not_required'
    and exists (
      select 1 from public.rubber_bill_items i
      where i.bill_id = b.id and i.item_type = 'weigh'
    )
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

  update public.rubber_bills
  set evidence_completion_id = null,
      evidence_manual_correction_count = 0
  where id = v_bill_id;

  select count(*)::integer into v_row_count
  from public.rubber_bill_items
  where bill_id = v_bill_id and item_type = 'weigh';

  v_result := public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner, 1);
  if v_result->>'state' <> 'owned' then raise exception 'first claim did not win: %', v_result; end if;
  if (select evidence_manual_correction_count from public.rubber_bills where id = v_bill_id) <> 1 then
    raise exception 'first claim did not persist the count';
  end if;

  v_result := public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner, 0);
  if v_result->>'state' <> 'owned' then raise exception 'winner retry was not idempotent: %', v_result; end if;
  if (select evidence_manual_correction_count from public.rubber_bills where id = v_bill_id) <> 1 then
    raise exception 'winner retry overwrote the first count';
  end if;

  v_result := public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_loser, 0);
  if v_result->>'state' <> 'owned_by_other' then raise exception 'second device did not lose: %', v_result; end if;

  v_result := public.release_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_loser);
  if v_result->>'state' <> 'not_owner' then raise exception 'loser released winner claim: %', v_result; end if;

  v_result := public.release_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner);
  if v_result->>'state' <> 'released' then raise exception 'winner could not release: %', v_result; end if;
  if (select evidence_manual_correction_count from public.rubber_bills where id = v_bill_id) <> 0 then
    raise exception 'release did not clear the count';
  end if;

  begin
    perform public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner, -1);
    raise exception 'negative count unexpectedly passed';
  exception when others then
    if sqlerrm = 'negative count unexpectedly passed' then raise; end if;
  end;

  begin
    perform public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner, v_row_count + 1);
    raise exception 'oversized count unexpectedly passed';
  exception when others then
    if sqlerrm = 'oversized count unexpectedly passed' then raise; end if;
  end;

  v_result := public.claim_weight_evidence_completion(v_bill_id, v_location_id, v_revision_no, v_winner, 0);
  update public.rubber_bills set revision_no = revision_no + 1 where id = v_bill_id;
  if (select evidence_completion_id from public.rubber_bills where id = v_bill_id) is not null then
    raise exception 'revision change did not clear completion owner';
  end if;
  if (select evidence_manual_correction_count from public.rubber_bills where id = v_bill_id) <> 0 then
    raise exception 'revision change did not clear completion count';
  end if;

  select b.id, b.location_id, b.revision_no
    into v_branch_bill_id, v_branch_location_id, v_branch_revision_no
  from public.rubber_bills b
  where b.record_status = 'active'
    and b.source_rubber_export_id is not null
  limit 1;
  if v_branch_bill_id is not null then
    v_result := public.claim_weight_evidence_completion(
      v_branch_bill_id,
      v_branch_location_id,
      v_branch_revision_no,
      v_winner,
      0
    );
    if v_result->>'state' <> 'inactive' then
      raise exception 'branch receipt was claimable: %', v_result;
    end if;
  end if;

  select revision_no into v_revision_no
  from public.rubber_bills
  where id = v_bill_id;
  delete from public.rubber_bill_items
  where bill_id = v_bill_id and item_type = 'weigh';
  begin
    perform public.claim_weight_evidence_completion(
      v_bill_id,
      v_location_id,
      v_revision_no,
      v_winner,
      0
    );
    raise exception 'zero-row bill unexpectedly passed';
  exception when others then
    if sqlerrm = 'zero-row bill unexpectedly passed' then raise; end if;
  end;
end;
$$;

rollback;
