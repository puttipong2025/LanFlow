\set ON_ERROR_STOP on

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(1);

do $$
begin
  if to_regprocedure('public.get_weight_evidence_digest()') is not null then
    raise exception 'legacy weight Evidence digest still exists';
  end if;
end;
$$;

do $$
declare
  v_manager_id uuid;
  v_user_id uuid;
  v_location_id uuid;
  v_bill_id uuid;
  v_row_id uuid;
  v_revision_no integer;
  v_completion_id uuid := gen_random_uuid();
  v_period_id uuid;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_result jsonb;
  v_state text;
  v_fingerprint text;
  v_count bigint;
  v_badge_count bigint;
  v_config jsonb;
begin
  select id into strict v_manager_id
  from public.profiles where is_active = true and role = 'super_admin';
  select id into v_user_id
  from public.profiles
  where is_active = true and role <> 'super_admin' and can_access_super_admin_features = false
  order by id limit 1;
  v_location_id := gen_random_uuid();
  v_bill_id := gen_random_uuid();
  v_row_id := gen_random_uuid();
  v_revision_no := 1;

  insert into public.locations (id, name, code, is_active, created_by)
  values (
    v_location_id,
    'Evidence review ' || substring(v_location_id::text, 1, 8),
    'ER' || substring(replace(v_location_id::text, '-', ''), 1, 6),
    true,
    v_manager_id
  );
  insert into public.user_locations (user_id, location_id, assigned_by, is_primary)
  values (v_manager_id, v_location_id, v_manager_id, false);
  if v_user_id is not null then
    insert into public.user_locations (user_id, location_id, assigned_by, is_primary)
    values (v_user_id, v_location_id, v_manager_id, false);
  end if;
  insert into public.rubber_bills (
    id, client_temp_id, local_bill_no, server_bill_no, idempotency_key,
    revision_no, sync_status, record_status, location_id, bill_no, bill_date,
    customer_name, bill_type, weight, rubber_value, average_price,
    deduction_total, net_total, client_recorded_at, client_created_at,
    server_received_at, created_by_user_id, created_by_name, created_by_phone
  ) values (
    v_bill_id, 'ER-TEMP', 'ER-LOCAL', 'ER-SERVER', 'ER-IDEMPOTENCY',
    v_revision_no, 'synced', 'active', v_location_id, 'ER-SERVER',
    (now() at time zone 'Asia/Bangkok')::date,
    'Evidence review fixture', 'บิลเครื่องชั่งเล็ก', 100, 1000, 10,
    0, 1000, now(), now(), now(), v_manager_id,
    (select name from public.profiles where id = v_manager_id),
    (select phone from public.profiles where id = v_manager_id)
  );
  insert into public.rubber_bill_items (
    id, bill_id, item_type, description, weight_in, weight_out,
    net_weight, price, total, sequence_no
  ) values (v_row_id, v_bill_id, 'weigh', 'Evidence review row', 150, 50, 100, 10, 1000, 1);

  perform set_config('request.jwt.claim.sub', v_manager_id::text, true);

  delete from public.rubber_bill_evidence_review_periods where location_id = v_location_id;
  delete from public.rubber_bill_evidence_reviews where bill_id = v_bill_id;
  delete from public.rubber_bill_item_evidence_files f
  using public.rubber_bill_items i
  where f.bill_item_id = i.id and i.bill_id = v_bill_id;
  update public.rubber_bills
  set evidence_completion_id = null, evidence_manual_correction_count = 0
  where id = v_bill_id;

  v_result := public.open_rubber_bill_evidence_review_period(v_location_id);
  if v_result->>'state' <> 'opened' then raise exception 'open failed: %', v_result; end if;
  v_period_id := (v_result->>'periodId')::uuid;
  select opened_at into v_opened_at
  from public.rubber_bill_evidence_review_periods where id = v_period_id;
  update public.rubber_bills set client_created_at = v_opened_at where id = v_bill_id;

  select review_status into v_state
  from public.get_rubber_bill_evidence_review_states(v_location_id)
  where bill_id = v_bill_id;
  if v_state <> 'pending' then raise exception 'open boundary was not pending: %', v_state; end if;

  select item_count, item_fingerprint into v_count, v_fingerprint
  from private.rubber_bill_evidence_pending_snapshot(v_location_id);
  v_result := public.pass_all_pending_rubber_bill_evidence_reviews(
    v_location_id, v_count, md5('different')
  );
  if v_result->>'state' <> 'stale' then raise exception 'bulk fingerprint race was accepted: %', v_result; end if;

  v_result := public.claim_weight_evidence_completion(
    v_bill_id, v_location_id, v_revision_no, v_completion_id, 0
  );
  if v_result->>'state' <> 'owned' then raise exception 'claim failed: %', v_result; end if;
  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'rubber', v_location_id, v_revision_no, v_completion_id,
    concat_ws(':', v_completion_id, v_revision_no, v_row_id, 'rubber'),
    'review-rubber', 'https://drive.example/review-rubber'
  );
  if v_result->>'state' <> 'stored' then raise exception 'rubber mapping failed: %', v_result; end if;
  v_result := public.record_weight_evidence_backup(
    v_bill_id, v_row_id, 'displayIn', v_location_id, v_revision_no, v_completion_id,
    concat_ws(':', v_completion_id, v_revision_no, v_row_id, 'displayIn'),
    'review-display', 'https://drive.example/review-display'
  );
  if v_result->>'state' <> 'stored' then raise exception 'display mapping failed: %', v_result; end if;

  if exists (
    select 1 from public.get_rubber_bill_evidence_review_states(v_location_id)
    where bill_id = v_bill_id and review_status <> 'normal'
  ) then raise exception 'complete evidence did not become normal'; end if;

  v_result := public.close_rubber_bill_evidence_review_period(v_location_id);
  if v_result->>'state' <> 'closed' then raise exception 'close failed: %', v_result; end if;
  select closed_at into v_closed_at
  from public.rubber_bill_evidence_review_periods where id = v_period_id;
  if v_closed_at = v_opened_at then
    v_closed_at := v_opened_at + interval '1 second';
    update public.rubber_bill_evidence_review_periods
    set closed_at = v_closed_at where id = v_period_id;
  end if;
  update public.rubber_bills set client_created_at = v_closed_at where id = v_bill_id;
  select review_status into v_state
  from public.get_rubber_bill_evidence_review_states(v_location_id)
  where bill_id = v_bill_id;
  if v_state <> 'outside' then raise exception 'close boundary was not outside: %', v_state; end if;

  update public.rubber_bills set client_created_at = v_opened_at where id = v_bill_id;
  delete from public.rubber_bill_item_evidence_files f
  using public.rubber_bill_items i
  where f.bill_item_id = i.id and i.bill_id = v_bill_id;
  v_result := public.open_rubber_bill_evidence_review_period(v_location_id);
  if v_result->>'state' <> 'blocked' then raise exception 'late pending bill did not block reopen: %', v_result; end if;

  update public.rubber_bill_items set price = 0 where id = v_row_id;
  select item_count into v_badge_count
  from public.get_actionable_badge_counts()
  where location_id = v_location_id and module_id = 'rubber';
  if v_badge_count <> 1 then
    raise exception 'zero-price work did not stay in rubber: %', v_badge_count;
  end if;
  select item_count into v_count
  from public.get_actionable_badge_counts()
  where location_id = v_location_id and module_id = 'rubber-evidence';
  if v_count <> 1 then
    raise exception 'pending evidence work did not move to rubber-evidence: %', v_count;
  end if;

  v_config := public.save_telegram_evidence_location_config(false, array[v_location_id]);
  if v_config->>'allLocations' <> 'false'
     or not ((v_config->'locationIds') ? v_location_id::text) then
    raise exception 'Telegram evidence branch selection failed: %', v_config;
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select pending_today into v_count
  from public.get_weight_evidence_review_digest()
  where location_id = v_location_id;
  if v_count <> 1 then raise exception 'Telegram digest pending count failed: %', v_count; end if;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.decide_rubber_bill_evidence_review(
    v_location_id, v_bill_id, v_revision_no, 'pending', 'pass'
  );
  if v_result->>'state' <> 'updated' then raise exception 'single decision failed: %', v_result; end if;
  v_result := public.open_rubber_bill_evidence_review_period(v_location_id);
  if v_result->>'state' <> 'opened' then raise exception 'resolved branch did not reopen: %', v_result; end if;

  update public.rubber_bills set revision_no = revision_no + 1 where id = v_bill_id;
  if exists (select 1 from public.rubber_bill_evidence_reviews where bill_id = v_bill_id) then
    raise exception 'revision change did not remove current review';
  end if;

  update public.rubber_bills set client_created_at = null where id = v_bill_id;
  select review_status into v_state
  from public.get_rubber_bill_evidence_review_states(v_location_id)
  where bill_id = v_bill_id;
  if v_state <> 'outside' then raise exception 'null TimestampBill was not outside: %', v_state; end if;

  if v_user_id is not null then
    perform set_config('request.jwt.claim.sub', v_user_id::text, true);
    perform count(*) from public.get_rubber_bill_evidence_review_states(v_location_id);
    begin
      perform public.close_rubber_bill_evidence_review_period(v_location_id);
      raise exception 'ordinary branch user managed review period';
    exception when others then
      if sqlerrm = 'ordinary branch user managed review period' then raise; end if;
      if position('RUBBER_EVIDENCE_REVIEW_ACCESS_DENIED' in sqlerrm) = 0 then
        raise exception 'unexpected permission error: %', sqlerrm;
      end if;
    end;
  end if;
end;
$$;

select extensions.pass('rubber bill Evidence review transactional contract passes');

select * from extensions.finish();

rollback;
