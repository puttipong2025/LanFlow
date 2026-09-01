\set ON_ERROR_STOP on

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(1);

do $$
declare
  v_user_id constant uuid := 'e1000000-0000-4000-8000-000000000001';
  v_location_id constant uuid := 'e1000000-0000-4000-8000-000000000002';
  v_bill_id constant uuid := 'e1000000-0000-4000-8000-000000000003';
  v_row_id constant uuid := 'e1000000-0000-4000-8000-000000000004';
  v_export_id constant uuid := 'e1000000-0000-4000-8000-000000000005';
  v_branch_bill_id constant uuid := 'e1000000-0000-4000-8000-000000000006';
  v_branch_row_id constant uuid := 'e1000000-0000-4000-8000-000000000007';
  v_revision_no integer := 1;
  v_winner uuid := gen_random_uuid();
  v_loser uuid := gen_random_uuid();
  v_result jsonb;
begin
  insert into public.locations (id, name, code, is_active)
  values (v_location_id, 'pgTAP Weight Evidence completion', 'PGWEC', true);

  insert into public.profiles (id, phone, name, role, is_active)
  values (v_user_id, '0899100001', 'pgTAP Weight Evidence completion user', 'admin', true);

  insert into public.user_locations (user_id, location_id, assigned_by, is_primary)
  values (v_user_id, v_location_id, v_user_id, true);

  insert into public.rubber_exports (
    id, export_no, export_date, sequence_no, location_id, status,
    original_weight_total, paid_total, rubber_value_total, average_price,
    current_weight, weight_loss_percent, work_rate, other_operating_cost,
    work_total, expense_destination,
    created_by_user_id, created_by_name, created_by_phone,
    verified_by_user_id, verified_by_name, verified_by_phone, verified_at,
    age_cutoff_at, average_age_hours, oldest_age_hours, estimated_age_item_count
  ) values (
    v_export_id, 'PGWEC-EXPORT', current_date, 1, v_location_id, 'verified',
    50, 500, 500, 10, 50, 0, 0, 0, 0, 'branch',
    v_user_id, 'pgTAP Weight Evidence completion user', '0899100001',
    v_user_id, 'pgTAP Weight Evidence completion user', '0899100001', now(),
    now(), 0, 0, 0
  );

  insert into public.rubber_bills (
    id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
    revision_no, sync_status, record_status, location_id, bill_no, bill_date,
    customer_name, bill_type, weight, rubber_value, average_price,
    deduction_total, net_total, client_recorded_at, client_created_at,
    server_received_at, created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_bill_id, 'PGWEC-BILL', 'PGWEC-BILL', 'PGWEC-BILL', 'PGWEC-BILL',
    v_revision_no, 'synced', 'active', v_location_id, 'PGWEC-BILL', current_date,
    'pgTAP completion customer', 'weighing', 100, 1000, 10,
    0, 1000, now(), now(), now(),
    v_user_id, 'pgTAP Weight Evidence completion user', '0899100001'
  );

  insert into public.rubber_bill_items (
    id, bill_id, item_type, description, weight_in, weight_out,
    net_weight, price, total, sequence_no
  ) values (
    v_row_id, v_bill_id, 'weigh', 'pgTAP completion row', 150, 50,
    100, 10, 1000, 1
  );

  insert into public.rubber_bills (
    id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
    revision_no, sync_status, record_status, location_id, bill_no, bill_date,
    customer_name, bill_type, weight, rubber_value, average_price,
    deduction_total, net_total, source_rubber_export_id, source_export_no,
    received_at, received_age_hours, received_age_is_estimated,
    created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_branch_bill_id, 'PGWEC-BRANCH', 'PGWEC-BRANCH', 'PGWEC-BRANCH', 'PGWEC-BRANCH',
    1, 'synced', 'active', v_location_id, 'PGWEC-BRANCH', current_date,
    'pgTAP branch receipt', 'branch_receipt', 50, 500, 10,
    500, 0, v_export_id, 'PGWEC-EXPORT', now(), 0, false,
    v_user_id, 'pgTAP Weight Evidence completion user', '0899100001'
  );

  insert into public.rubber_bill_items (
    id, bill_id, item_type, description, net_weight, price, total, sequence_no
  ) values (
    v_branch_row_id, v_branch_bill_id, 'weigh', 'pgTAP branch receipt row',
    50, 10, 500, 1
  );

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  v_result := public.claim_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_winner
  );
  if v_result->>'state' <> 'owned' then raise exception 'first claim did not win: %', v_result; end if;

  v_result := public.claim_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_winner
  );
  if v_result->>'state' <> 'owned' then raise exception 'winner retry was not idempotent: %', v_result; end if;

  v_result := public.claim_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_loser
  );
  if v_result->>'state' <> 'owned_by_other' then raise exception 'second device did not lose: %', v_result; end if;

  v_result := public.release_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_loser
  );
  if v_result->>'state' <> 'not_owner' then raise exception 'loser released winner claim: %', v_result; end if;

  v_result := public.release_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_winner
  );
  if v_result->>'state' <> 'released' then raise exception 'winner could not release: %', v_result; end if;

  v_result := public.claim_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_winner
  );
  update public.rubber_bills set revision_no = revision_no + 1 where id = v_bill_id;
  if (select evidence_completion_id from public.rubber_bills where id = v_bill_id) is not null then
    raise exception 'revision change did not clear completion owner';
  end if;

  v_result := public.claim_weight_evidence_completion(
    v_branch_bill_id, v_location_id, 1, v_winner
  );
  if v_result->>'state' <> 'inactive' then
    raise exception 'branch receipt was claimable: %', v_result;
  end if;

  select revision_no into v_revision_no
  from public.rubber_bills
  where id = v_bill_id;

  delete from public.rubber_bill_items where id = v_row_id;
  begin
    perform public.claim_weight_evidence_completion(
      v_bill_id, v_location_id, v_revision_no, v_winner
    );
    raise exception 'zero-row bill unexpectedly passed';
  exception when others then
    if sqlerrm = 'zero-row bill unexpectedly passed' then raise; end if;
    if sqlerrm <> 'WEIGHT_EVIDENCE_INVALID_COUNT' then
      raise exception 'unexpected zero-row error: %', sqlerrm;
    end if;
  end;
end;
$$;

select extensions.pass('Weight Evidence completion transactional contract passes');

select * from extensions.finish();

rollback;
