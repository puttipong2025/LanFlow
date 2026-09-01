\set ON_ERROR_STOP on

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(1);

do $$
declare
  v_user_id constant uuid := 'e2000000-0000-4000-8000-000000000001';
  v_location_id constant uuid := 'e2000000-0000-4000-8000-000000000002';
  v_bill_id constant uuid := 'e2000000-0000-4000-8000-000000000003';
  v_row_id constant uuid := 'e2000000-0000-4000-8000-000000000004';
  v_report_id constant uuid := 'e2000000-0000-4000-8000-000000000005';
  v_revision_no integer := 1;
  v_completion_id uuid := gen_random_uuid();
  v_other_completion_id uuid := gen_random_uuid();
  v_result jsonb;
  v_key text;
begin
  insert into public.locations (id, name, code, is_active)
  values (v_location_id, 'pgTAP Weight Evidence backup', 'PGWEB', true);

  insert into public.profiles (id, phone, name, role, is_active)
  values (v_user_id, '0899200001', 'pgTAP Weight Evidence backup user', 'admin', true);

  insert into public.user_locations (user_id, location_id, assigned_by, is_primary)
  values (v_user_id, v_location_id, v_user_id, true);

  insert into public.rubber_bills (
    id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
    revision_no, sync_status, record_status, location_id, bill_no, bill_date,
    customer_name, bill_type, weight, rubber_value, average_price,
    deduction_total, net_total, client_recorded_at, client_created_at,
    server_received_at, created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_bill_id, 'PGWEB-BILL', 'PGWEB-BILL', 'PGWEB-BILL', 'PGWEB-BILL',
    v_revision_no, 'synced', 'active', v_location_id, 'PGWEB-BILL', current_date,
    'pgTAP backup customer', 'weighing', 100, 1000, 10,
    0, 1000, now(), now(), now(),
    v_user_id, 'pgTAP Weight Evidence backup user', '0899200001'
  );

  insert into public.rubber_bill_items (
    id, bill_id, item_type, description, weight_in, weight_out,
    net_weight, price, total, sequence_no
  ) values (
    v_row_id, v_bill_id, 'weigh', 'pgTAP backup row', 150, 50,
    100, 10, 1000, 1
  );

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

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

  begin
    perform public.record_weight_evidence_backup(
      v_bill_id, v_row_id, 'rubber', v_location_id, v_revision_no,
      v_completion_id, v_key || '-different', 'drive-file-b', 'https://drive.example/b'
    );
    raise exception 'invalid deterministic key was accepted';
  exception when others then
    if sqlerrm = 'invalid deterministic key was accepted' then raise; end if;
    if sqlerrm <> 'WEIGHT_EVIDENCE_INVALID_INPUT' then
      raise exception 'unexpected invalid-key error: %', sqlerrm;
    end if;
  end;

  update public.rubber_bill_item_evidence_files
  set completion_id = v_other_completion_id,
      evidence_key = concat_ws(':', v_other_completion_id, v_revision_no, v_row_id, 'rubber')
  where bill_item_id = v_row_id and role = 'rubber';

  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'rubber', v_location_id, v_revision_no,
    v_completion_id, v_key, 'drive-file-b', 'https://drive.example/b'
  );
  if v_result->>'state' <> 'conflict' then
    raise exception 'different canonical backup did not conflict: %', v_result;
  end if;

  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'displayIn', v_location_id, v_revision_no,
    v_other_completion_id,
    concat_ws(':', v_other_completion_id, v_revision_no, v_row_id, 'displayIn'),
    'drive-file-c', 'https://drive.example/c'
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
  insert into public.report_batches (
    id, report_no, report_date, sequence_no, location_id, cutoff_at,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_report_id, 'PGWEB-REPORT', current_date, 1, v_location_id, now(),
    v_user_id, 'pgTAP Weight Evidence backup user', '0899200001'
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

select extensions.pass('Weight Evidence Drive backup transactional contract passes');

select * from extensions.finish();

rollback;
