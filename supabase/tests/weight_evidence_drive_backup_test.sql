\set ON_ERROR_STOP on

begin;

do $$
declare
  v_user_id uuid;
  v_location_id uuid;
  v_bill_id uuid;
  v_row_id uuid;
  v_revision_no integer;
  v_completion_id uuid := gen_random_uuid();
  v_other_completion_id uuid := gen_random_uuid();
  v_result jsonb;
  v_key text;
  v_report_id uuid := gen_random_uuid();
  v_report_sequence integer;
begin
  select p.id, b.location_id, b.id, i.id, b.revision_no
    into v_user_id, v_location_id, v_bill_id, v_row_id, v_revision_no
  from public.rubber_bills b
  join public.rubber_bill_items i on i.bill_id = b.id and i.item_type = 'weigh'
  join public.user_locations ul on ul.location_id = b.location_id
  join public.profiles p on p.id = ul.user_id and p.is_active = true
  where b.record_status = 'active'
    and b.source_rubber_export_id is null
    and b.approval_state = 'not_required'
    and not exists (
      select 1
      from public.report_items item
      join public.report_batches report on report.id = item.report_id
      where item.entity_type = 'rubber_bill'
        and item.entity_id = b.id
        and report.status = 'active'
    )
  order by b.id, i.sequence_no
  limit 1;

  if v_bill_id is null then raise exception 'No eligible seed bill for evidence backup test'; end if;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  delete from public.rubber_bill_item_evidence_files where bill_item_id = v_row_id;
  update public.rubber_bills
  set evidence_completion_id = null,
      evidence_manual_correction_count = 0
  where id = v_bill_id;

  v_result := public.claim_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_completion_id, 1
  );
  if v_result->>'state' <> 'owned' then raise exception 'five-argument claim failed: %', v_result; end if;
  if (select evidence_manual_correction_count from public.rubber_bills where id = v_bill_id) <> 1 then
    raise exception 'manual correction count was not stored';
  end if;

  v_key := concat_ws(':', v_completion_id, v_revision_no, v_row_id, 'rubber');
  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'rubber', v_location_id, v_revision_no,
    v_completion_id, v_key, 'drive-file-a', 'https://drive.example/a'
  );
  if v_result->>'state' <> 'stored' then raise exception 'first backup failed: %', v_result; end if;

  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'rubber', v_location_id, v_revision_no,
    v_completion_id, v_key, 'drive-file-a', 'https://drive.example/a'
  );
  if v_result->>'state' <> 'stored' then raise exception 'backup retry was not idempotent: %', v_result; end if;

  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'rubber', v_location_id, v_revision_no,
    v_completion_id, v_key || '-different', 'drive-file-b', 'https://drive.example/b'
  );
  if v_result->>'state' <> 'conflict' then raise exception 'different backup did not conflict: %', v_result; end if;

  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'displayIn', v_location_id, v_revision_no,
    v_other_completion_id, v_key || '-other', 'drive-file-c', 'https://drive.example/c'
  );
  if v_result->>'state' <> 'not_owner' then raise exception 'non-owner backup was accepted: %', v_result; end if;

  update public.rubber_bills set revision_no = revision_no + 1 where id = v_bill_id;
  if (select evidence_completion_id from public.rubber_bills where id = v_bill_id) is not null then
    raise exception 'revision change did not clear owner';
  end if;
  if (select evidence_manual_correction_count from public.rubber_bills where id = v_bill_id) <> 0 then
    raise exception 'revision change did not clear correction count';
  end if;
  if exists (select 1 from public.rubber_bill_item_evidence_files where bill_item_id = v_row_id) then
    raise exception 'revision change did not clear current evidence links';
  end if;

  select revision_no into v_revision_no from public.rubber_bills where id = v_bill_id;
  select coalesce(max(sequence_no), 0) + 1 into v_report_sequence
  from public.report_batches
  where location_id = v_location_id and report_date = current_date;
  insert into public.report_batches (
    id, report_no, report_date, sequence_no, location_id, cutoff_at,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_report_id,
    'TEST-EVIDENCE-' || substring(gen_random_uuid()::text, 1, 8),
    current_date,
    v_report_sequence,
    v_location_id,
    now(),
    v_user_id,
    (select name from public.profiles where id = v_user_id),
    (select phone from public.profiles where id = v_user_id)
  );
  insert into public.report_items (
    report_id, location_id, entity_type, entity_id, eligibility_at
  ) values (v_report_id, v_location_id, 'rubber_bill', v_bill_id, now());

  v_result := public.claim_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_completion_id, 1
  );
  if v_result->>'state' <> 'owned' then
    raise exception 'report-locked bill rejected evidence claim: %', v_result;
  end if;
  v_key := concat_ws(':', v_completion_id, v_revision_no, v_row_id, 'rubber');
  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'rubber', v_location_id, v_revision_no,
    v_completion_id, v_key, 'drive-file-report', 'https://drive.example/report'
  );
  if v_result->>'state' <> 'stored' then
    raise exception 'report-locked bill rejected separate evidence link: %', v_result;
  end if;

  begin
    update public.rubber_bills set customer_name = customer_name || ' blocked' where id = v_bill_id;
    raise exception 'report lock allowed business-field edit';
  exception when others then
    if sqlerrm = 'report lock allowed business-field edit' then raise; end if;
    if position('REPORT_LOCKED' in sqlerrm) = 0 then
      raise exception 'unexpected report-lock error: %', sqlerrm;
    end if;
  end;
end;
$$;

rollback;
