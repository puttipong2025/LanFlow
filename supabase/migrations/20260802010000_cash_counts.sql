-- Cash counts are online-only, blind counts paired transactionally with one Report Batch.

create table public.cash_count_sessions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  cutoff_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'submitted', 'cancelled', 'expired')),
  started_by_user_id uuid not null references public.profiles(id),
  started_by_name text not null,
  started_by_phone text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (expires_at = cutoff_at + interval '30 minutes'),
  check ((status = 'active' and ended_at is null) or (status <> 'active' and ended_at is not null))
);

create unique index cash_count_sessions_one_active_location
  on public.cash_count_sessions(location_id)
  where status = 'active';

create index cash_count_sessions_location_history
  on public.cash_count_sessions(location_id, started_at desc, id desc);

create table public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.cash_count_sessions(id),
  report_id uuid not null unique references public.report_batches(id),
  location_id uuid not null references public.locations(id),
  previous_cash_count_id uuid references public.cash_counts(id),
  cutoff_at timestamptz not null,
  actual_counts jsonb not null,
  actual_total numeric(14,2) not null check (actual_total >= 0),
  expected_counts jsonb not null,
  expected_total numeric(14,2) not null,
  difference_counts jsonb not null,
  difference_total numeric(14,2) not null,
  anomaly_score integer check (anomaly_score between 0 and 100),
  confidence integer check (confidence between 0 and 100),
  analysis_status text check (analysis_status in ('insufficient_data', 'normal', 'review', 'high_anomaly')),
  formula_version text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null,
  created_by_phone text not null,
  created_at timestamptz not null default now(),
  deleted_by_user_id uuid references public.profiles(id),
  deleted_by_name text,
  deleted_by_phone text,
  deleted_at timestamptz,
  check (
    (previous_cash_count_id is null and anomaly_score is null and confidence is null and analysis_status is null)
    or
    (previous_cash_count_id is not null and anomaly_score is not null and confidence is not null and analysis_status is not null)
  ),
  check (
    (status = 'active' and deleted_at is null and deleted_by_user_id is null)
    or
    (status = 'deleted' and deleted_at is not null and deleted_by_user_id is not null)
  )
);

create index cash_counts_location_history
  on public.cash_counts(location_id, created_at desc, id desc);

alter table public.cash_count_sessions enable row level security;
alter table public.cash_counts enable row level security;

create policy "cash counts manager select"
  on public.cash_counts for select to authenticated
  using (private.can_delete_reports());

revoke all on public.cash_count_sessions, public.cash_counts from anon, authenticated;
grant select on public.cash_counts to authenticated;
grant all on public.cash_count_sessions, public.cash_counts to service_role;

create or replace function private.can_use_cash_count(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.is_active_user()
    and (
      public.can_access_super_admin_features()
      or (
        private.current_user_role() in ('user', 'admin')
        and private.can_access_location(p_location_id)
      )
    );
$$;

create or replace function private.cash_count_counts_valid(p_counts jsonb)
returns boolean
language sql
immutable
set search_path = public, private
as $$
  select jsonb_typeof(p_counts) = 'object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_counts) key)
      = array['1','10','100','1000','2','20','5','50','500']::text[]
    and not exists (
      select 1
      from jsonb_each_text(p_counts) item
      where item.value !~ '^\d+$'
        or item.value::numeric > 10000000
    );
$$;

create or replace function private.cash_count_difference_valid(p_counts jsonb)
returns boolean
language sql
immutable
set search_path = public, private
as $$
  select jsonb_typeof(p_counts) = 'object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_counts) key)
      = array['1','10','100','1000','2','20','5','50','500']::text[]
    and not exists (
      select 1 from jsonb_each_text(p_counts) item
      where item.value !~ '^-?\d+$'
    );
$$;

create or replace function private.cash_count_total(p_counts jsonb)
returns numeric
language sql
immutable
set search_path = public, private
as $$
  select coalesce(sum(item.key::numeric * item.value::numeric), 0)
  from jsonb_each_text(p_counts) item;
$$;

alter table public.cash_counts
  add constraint cash_counts_actual_shape check (private.cash_count_counts_valid(actual_counts)),
  add constraint cash_counts_expected_shape check (private.cash_count_counts_valid(expected_counts)),
  add constraint cash_counts_difference_shape check (private.cash_count_difference_valid(difference_counts)),
  add constraint cash_counts_actual_matches_counts check (actual_total = private.cash_count_total(actual_counts));

create or replace function private.cash_json_to_array(p_counts jsonb)
returns bigint[]
language sql
immutable
set search_path = public, private
as $$
  select array[
    (p_counts->>'1000')::bigint, (p_counts->>'500')::bigint,
    (p_counts->>'100')::bigint, (p_counts->>'50')::bigint,
    (p_counts->>'20')::bigint, (p_counts->>'10')::bigint,
    (p_counts->>'5')::bigint, (p_counts->>'2')::bigint,
    (p_counts->>'1')::bigint
  ];
$$;

create or replace function private.cash_array_to_json(p_counts bigint[])
returns jsonb
language sql
immutable
set search_path = public, private
as $$
  select jsonb_build_object(
    '1', p_counts[9], '2', p_counts[8], '5', p_counts[7],
    '10', p_counts[6], '20', p_counts[5], '50', p_counts[4],
    '100', p_counts[3], '500', p_counts[2], '1000', p_counts[1]
  );
$$;

create or replace function private.cash_exact_take(
  p_available bigint[],
  p_target bigint,
  p_position integer default 1
)
returns bigint[]
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_denoms constant bigint[] := array[1000,500,100,50,20,10,5,2,1];
  v_result bigint[];
  v_take bigint;
  v_max_take bigint;
  v_min_take bigint;
  v_suffix_total bigint := 0;
  v_i integer;
  v_attempts integer := 0;
begin
  if p_target < 0 or p_position > 9 then return null; end if;
  if p_position = 9 then
    if p_target <= p_available[9] then
      v_result := array_fill(0::bigint, array[9]);
      v_result[9] := p_target;
      return v_result;
    end if;
    return null;
  end if;

  for v_i in (p_position + 1)..9 loop
    v_suffix_total := v_suffix_total + p_available[v_i] * v_denoms[v_i];
  end loop;
  v_max_take := least(p_available[p_position], p_target / v_denoms[p_position]);
  v_min_take := greatest(0, ceil(greatest(0, p_target - v_suffix_total)::numeric / v_denoms[p_position])::bigint);

  if v_min_take > v_max_take then return null; end if;
  for v_take in reverse v_max_take..v_min_take loop
    v_attempts := v_attempts + 1;
    exit when v_attempts > 256;
    v_result := private.cash_exact_take(
      p_available,
      p_target - v_take * v_denoms[p_position],
      p_position + 1
    );
    if v_result is not null then
      v_result[p_position] := v_take;
      return v_result;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function private.cash_change_counts(p_amount bigint)
returns bigint[]
language plpgsql
immutable
set search_path = public, private
as $$
declare
  v_denoms constant bigint[] := array[1000,500,100,50,20,10,5,2,1];
  v_counts bigint[] := array_fill(0::bigint, array[9]);
  v_remaining bigint := p_amount;
  v_i integer;
begin
  if p_amount < 0 then return null; end if;
  for v_i in 1..9 loop
    v_counts[v_i] := v_remaining / v_denoms[v_i];
    v_remaining := v_remaining % v_denoms[v_i];
  end loop;
  return v_counts;
end;
$$;

create or replace function private.create_report_batch_at(
  p_location_id uuid,
  p_cutoff_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_name text;
  v_actor_phone text;
  v_report_date date;
  v_sequence_no integer;
  v_report_id uuid;
  v_report_no text;
  v_item_count integer;
  v_previous_report_id uuid;
  v_opening_balance numeric := 0;
  v_period_balance numeric := 0;
begin
  if exists (select 1 from private.rubber_bill_report_blockers(p_location_id, p_cutoff_at)) then
    raise exception 'RUBBER_BILL_PENDING: ยังมีงานบิลยางที่ต้องจัดการก่อนสร้างรายงาน';
  end if;

  select p.name, p.phone into v_actor_name, v_actor_phone
  from public.profiles p where p.id = p_actor_id;

  select b.id, b.closing_balance into v_previous_report_id, v_opening_balance
  from public.report_batches b
  where b.location_id = p_location_id and b.status = 'active'
  order by b.created_at desc, b.id desc limit 1;

  v_report_date := (p_cutoff_at at time zone 'Asia/Bangkok')::date;
  select coalesce(max(b.sequence_no), 0) + 1 into v_sequence_no
  from public.report_batches b
  where b.location_id = p_location_id and b.report_date = v_report_date;
  v_report_no := 'RPT-' || to_char(v_report_date, 'YYYYMMDD') || '-' || lpad(v_sequence_no::text, 3, '0');

  insert into public.report_batches (
    report_no, report_date, sequence_no, location_id, cutoff_at,
    previous_report_id, opening_balance, created_by_user_id,
    created_by_name, created_by_phone
  ) values (
    v_report_no, v_report_date, v_sequence_no, p_location_id, p_cutoff_at,
    v_previous_report_id, coalesce(v_opening_balance, 0), p_actor_id,
    coalesce(v_actor_name, ''), coalesce(v_actor_phone, '')
  ) returning id into v_report_id;

  insert into public.report_items (report_id, location_id, entity_type, entity_id, eligibility_at)
  select v_report_id, p_location_id, r.entity_type, r.entity_id, r.eligibility_at
  from private.reportable_items(p_location_id, p_cutoff_at) r
  on conflict do nothing;
  get diagnostics v_item_count = row_count;
  if v_item_count = 0 then raise exception 'ไม่มีรายการที่พร้อมออกรายงาน'; end if;

  select coalesce(sum(case when r.entry_type = 'income' then r.amount else -r.amount end), 0)
  into v_period_balance from private.report_income_expense_period_rows(v_report_id) r;
  update public.report_batches
  set closing_balance = coalesce(v_opening_balance, 0) + v_period_balance
  where id = v_report_id;

  return jsonb_build_object('id', v_report_id, 'reportNo', v_report_no,
    'cutoffAt', p_cutoff_at, 'itemCount', v_item_count);
end;
$$;

create or replace function public.create_report_batch(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_cutoff_at timestamptz := clock_timestamp();
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายงานของสาขานี้';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  if exists (
    select 1 from public.cash_count_sessions s
    where s.location_id = p_location_id and s.status = 'active' and s.expires_at > v_cutoff_at
  ) then
    raise exception 'CASH_COUNT_ACTIVE: มีการตรวจนับเงินสดของสาขานี้อยู่ กรุณารอให้ส่งผล ยกเลิก หรือหมดเวลา';
  end if;
  return private.create_report_batch_at(p_location_id, v_cutoff_at, auth.uid());
end;
$$;

create or replace function public.get_cash_count_session(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.cash_count_sessions%rowtype;
begin
  if not private.can_use_cash_count(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจนับเงินสดของสาขานี้';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  update public.cash_count_sessions
  set status = 'expired', ended_at = v_now
  where location_id = p_location_id and status = 'active' and expires_at <= v_now;

  select * into v_session from public.cash_count_sessions
  where location_id = p_location_id and status = 'active'
  order by started_at desc, id desc limit 1;
  if v_session.id is null then return jsonb_build_object('session', null); end if;
  return jsonb_build_object('session', jsonb_build_object(
    'id', v_session.id,
    'locationId', v_session.location_id,
    'cutoffAt', v_session.cutoff_at,
    'expiresAt', v_session.expires_at,
    'startedAt', v_session.started_at,
    'startedByName', v_session.started_by_name,
    'isOwner', v_session.started_by_user_id = auth.uid()
  ));
end;
$$;

create or replace function public.start_cash_count_session(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_actor record;
  v_session public.cash_count_sessions%rowtype;
begin
  if not private.can_use_cash_count(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจนับเงินสดของสาขานี้';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  update public.cash_count_sessions set status = 'expired', ended_at = v_now
  where location_id = p_location_id and status = 'active' and expires_at <= v_now;

  select * into v_session from public.cash_count_sessions
  where location_id = p_location_id and status = 'active' limit 1;
  if v_session.id is not null then
    raise exception 'CASH_COUNT_ACTIVE: มีผู้ตรวจนับเงินสดของสาขานี้อยู่แล้ว';
  end if;
  if exists (select 1 from private.rubber_bill_report_blockers(p_location_id, v_now)) then
    raise exception 'RUBBER_BILL_PENDING: ยังมีงานบิลยางที่ต้องจัดการก่อนเริ่มตรวจนับ';
  end if;
  if not exists (select 1 from private.reportable_items(p_location_id, v_now)) then
    raise exception 'ไม่มีรายการที่พร้อมออกรายงาน';
  end if;

  select p.name, p.phone into v_actor from public.profiles p where p.id = auth.uid();
  insert into public.cash_count_sessions (
    location_id, cutoff_at, expires_at, started_by_user_id, started_by_name, started_by_phone, started_at
  ) values (
    p_location_id, v_now, v_now + interval '30 minutes', auth.uid(),
    coalesce(v_actor.name, ''), coalesce(v_actor.phone, ''), v_now
  ) returning * into v_session;
  return jsonb_build_object('session', jsonb_build_object(
    'id', v_session.id, 'locationId', v_session.location_id,
    'cutoffAt', v_session.cutoff_at, 'expiresAt', v_session.expires_at,
    'startedAt', v_session.started_at, 'startedByName', v_session.started_by_name,
    'isOwner', true
  ));
end;
$$;

create or replace function public.cancel_cash_count_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.cash_count_sessions%rowtype;
begin
  select * into v_session from public.cash_count_sessions where id = p_session_id for update;
  if v_session.id is null or not private.can_use_cash_count(v_session.location_id) then
    raise exception 'ไม่พบช่วงตรวจนับหรือไม่มีสิทธิ์';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_session.location_id::text, 0));
  if v_session.status <> 'active' then raise exception 'ช่วงตรวจนับนี้สิ้นสุดแล้ว'; end if;
  if v_session.expires_at <= v_now then
    update public.cash_count_sessions set status = 'expired', ended_at = v_now where id = p_session_id;
    raise exception 'ช่วงตรวจนับหมดเวลาแล้ว กรุณาเริ่มใหม่';
  end if;
  if v_session.started_by_user_id <> auth.uid() then
    raise exception 'เฉพาะผู้เริ่มตรวจนับเท่านั้นที่ยกเลิกได้';
  end if;
  update public.cash_count_sessions set status = 'cancelled', ended_at = v_now where id = p_session_id;
  return jsonb_build_object('id', p_session_id, 'status', 'cancelled');
end;
$$;

create or replace function private.cash_count_events(
  p_location_id uuid,
  p_after_cutoff timestamptz,
  p_to_cutoff timestamptz
)
returns table (
  occurred_at timestamptz,
  event_kind text,
  amount numeric,
  counts jsonb,
  reference jsonb
)
language sql
stable
security definer
set search_path = public, private
as $$
  with eligible_items as (
    select i.entity_type, i.entity_id, i.eligibility_at
    from public.report_items i
    join public.report_batches b on b.id = i.report_id
    where b.location_id = p_location_id
      and b.status = 'active'
      and i.active = true
      and i.eligibility_at > p_after_cutoff
      and i.eligibility_at <= p_to_cutoff
  )
  select i.eligibility_at, e.type::text, e.cost, null::jsonb,
    jsonb_build_object('source', 'income_expense', 'id', e.id, 'label', e.title, 'amount', e.cost)
  from eligible_items i join public.income_expense e on e.id = i.entity_id
  where i.entity_type = 'income_expense' and e.cost > 0

  union all
  select i.eligibility_at, 'expense', b.net_total, null::jsonb,
    jsonb_build_object('source', 'rubber_bill', 'id', b.id, 'label', coalesce(b.server_bill_no, b.local_bill_no), 'amount', b.net_total)
  from eligible_items i join public.rubber_bills b on b.id = i.entity_id
  where i.entity_type = 'rubber_bill' and b.net_total > 0
    and not exists (select 1 from public.money_transfer_items m where m.source_type = 'rubber_bill' and m.source_id = b.id and m.created_at <= p_to_cutoff)

  union all
  select i.eligibility_at, 'expense', o.total_amount, null::jsonb,
    jsonb_build_object('source', 'ocr_ticket', 'id', o.id, 'label', coalesce(o.ticket_id, o.file_name), 'amount', o.total_amount)
  from eligible_items i join public.ocr_tickets o on o.id = i.entity_id
  where i.entity_type = 'ocr_ticket' and o.total_amount > 0
    and not exists (select 1 from public.money_transfer_items m where m.source_type = 'ocr_ticket' and m.source_id = o.id and m.created_at <= p_to_cutoff)

  union all
  select i.eligibility_at, 'expense', e.work_total, null::jsonb,
    jsonb_build_object('source', 'rubber_export', 'id', e.id, 'label', e.export_no, 'amount', e.work_total)
  from eligible_items i join public.rubber_exports e on e.id = i.entity_id
  where i.entity_type = 'rubber_export' and e.work_total > 0

  union all
  select i.eligibility_at, 'expense', f.amount, null::jsonb,
    jsonb_build_object('source', 'financial_transaction', 'id', f.id, 'label', coalesce(f.description, 'เบิกเงิน'), 'amount', f.amount)
  from eligible_items i join public.financial_transactions f on f.id = i.entity_id
  where i.entity_type = 'financial_transaction' and f.type = 'WITHDRAWAL' and f.amount > 0

  union all
  select i.eligibility_at, 'expense', p.net_pay, null::jsonb,
    jsonb_build_object('source', 'payroll_slip', 'id', p.id, 'label', p.month, 'amount', p.net_pay)
  from eligible_items i join public.payroll_slips p on p.id = i.entity_id
  where i.entity_type = 'payroll_slip' and p.net_pay > 0

  union all
  select i.eligibility_at, 'expense', m.branch_paid_amount, null::jsonb,
    jsonb_build_object('source', 'branch_paid', 'id', m.id, 'label', coalesce(m.customer_name, 'ลูกค้า'), 'amount', m.branch_paid_amount)
  from eligible_items i join public.money_transfers m on m.id = i.entity_id
  where i.entity_type = 'bank_transfer_source'
    and m.transfer_type = 'customer' and m.transfer_status = 'branch_and_transfer' and m.branch_paid_amount > 0

  union all
  select i.eligibility_at, 'known_out', d.sent_total,
    jsonb_build_object(
      '1', d.sent_coin_1_count, '2', d.sent_coin_2_count, '5', d.sent_coin_5_count,
      '10', d.sent_coin_10_count, '20', d.sent_banknote_20_count, '50', d.sent_banknote_50_count,
      '100', d.sent_banknote_100_count, '500', d.sent_banknote_500_count, '1000', d.sent_banknote_1000_count
    ), jsonb_build_object('source', 'cash_transfer_sent', 'id', m.id, 'label', coalesce(m.target_location_name, 'สาขาปลายทาง'), 'amount', d.sent_total)
  from eligible_items i
  join public.money_transfers m on m.id = i.entity_id
  join public.money_transfer_cash_details d on d.transfer_id = m.id
  where i.entity_type = 'cash_transfer_sent'

  union all
  select i.eligibility_at, 'known_in', d.received_total,
    jsonb_build_object(
      '1', d.received_coin_1_count, '2', d.received_coin_2_count, '5', d.received_coin_5_count,
      '10', d.received_coin_10_count, '20', d.received_banknote_20_count, '50', d.received_banknote_50_count,
      '100', d.received_banknote_100_count, '500', d.received_banknote_500_count, '1000', d.received_banknote_1000_count
    ), jsonb_build_object('source', 'cash_transfer_received', 'id', m.id, 'label', 'รับเงินสดจากสาขาต้นทาง', 'amount', d.received_total)
  from eligible_items i
  join public.money_transfers m on m.id = i.entity_id
  join public.money_transfer_cash_details d on d.transfer_id = m.id
  where i.entity_type = 'cash_transfer_received'

  union all
  select mi.created_at, 'income', mi.amount, null::jsonb,
    jsonb_build_object('source', 'late_bank_transfer_adjustment', 'id', mi.id, 'label', 'ปรับคืนเงินสดจากบิลที่เลือกโอนภายหลัง', 'amount', mi.amount)
  from public.money_transfer_items mi
  join public.money_transfers mt on mt.id = mi.transfer_id
  where mt.location_id = p_location_id
    and mt.transfer_method = 'bank'
    and mt.record_status = 'active'
    and mi.created_at > p_after_cutoff and mi.created_at <= p_to_cutoff
    and exists (
      select 1 from public.report_items prior_i
      join public.report_batches prior_b on prior_b.id = prior_i.report_id
      where prior_i.entity_type = mi.source_type and prior_i.entity_id = mi.source_id
        and prior_i.active = true and prior_b.status = 'active'
        and prior_b.location_id = p_location_id and prior_i.eligibility_at <= p_after_cutoff
    );
$$;

create or replace function public.submit_cash_count(
  p_session_id uuid,
  p_actual_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.cash_count_sessions%rowtype;
  v_previous public.cash_counts%rowtype;
  v_actor record;
  v_report jsonb;
  v_count_id uuid;
  v_actual_total numeric;
  v_expected_total numeric;
  v_expected bigint[];
  v_actual bigint[];
  v_take bigint[];
  v_event record;
  v_event_counts bigint[];
  v_target bigint;
  v_i integer;
  v_difference jsonb;
  v_difference_total numeric;
  v_positive_value numeric := 0;
  v_churn_value numeric := 0;
  v_total_component integer;
  v_denom_component integer;
  v_pattern_component integer;
  v_score integer;
  v_confidence integer := 100;
  v_status text;
  v_formula text := 'cash-v1';
  v_high_conf_history integer := 0;
  v_pattern_baseline numeric := 0;
  v_simulated_count integer := 0;
  v_unknown_count integer := 0;
  v_allocation_failures integer := 0;
  v_fractional_count integer := 0;
  v_change_count integer := 0;
  v_change_amount bigint := 0;
  v_delta bigint;
  v_available_total bigint;
  v_change bigint[];
  v_highlights jsonb := '[]'::jsonb;
  v_limitations jsonb := '[]'::jsonb;
  v_references jsonb := '[]'::jsonb;
begin
  if not private.cash_count_counts_valid(p_actual_counts) then
    raise exception 'จำนวนเงินสดต้องมีครบ 9 ชนิดและเป็นจำนวนเต็มตั้งแต่ 0';
  end if;
  select * into v_session from public.cash_count_sessions where id = p_session_id for update;
  if v_session.id is null or not private.can_use_cash_count(v_session.location_id) then
    raise exception 'ไม่พบช่วงตรวจนับหรือไม่มีสิทธิ์';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_session.location_id::text, 0));
  if v_session.status <> 'active' then raise exception 'ช่วงตรวจนับนี้สิ้นสุดแล้ว'; end if;
  if v_session.started_by_user_id <> auth.uid() then
    raise exception 'เฉพาะผู้เริ่มตรวจนับเท่านั้นที่ส่งผลได้';
  end if;
  if v_session.expires_at <= v_now then
    update public.cash_count_sessions set status = 'expired', ended_at = v_now where id = p_session_id;
    raise exception 'ช่วงตรวจนับหมดเวลาแล้ว กรุณาเริ่มใหม่';
  end if;

  select * into v_previous from public.cash_counts c
  where c.location_id = v_session.location_id and c.status = 'active'
  order by c.created_at desc, c.id desc limit 1;
  select p.name, p.phone into v_actor from public.profiles p where p.id = auth.uid();
  v_report := private.create_report_batch_at(v_session.location_id, v_session.cutoff_at, auth.uid());
  v_actual := private.cash_json_to_array(p_actual_counts);
  v_actual_total := private.cash_count_total(p_actual_counts);

  if v_previous.id is null then
    insert into public.cash_counts (
      session_id, report_id, location_id, cutoff_at,
      actual_counts, actual_total, expected_counts, expected_total,
      difference_counts, difference_total, formula_version, evidence,
      created_by_user_id, created_by_name, created_by_phone, created_at
    ) values (
      v_session.id, (v_report->>'id')::uuid, v_session.location_id, v_session.cutoff_at,
      p_actual_counts, v_actual_total, p_actual_counts, v_actual_total,
      jsonb_build_object('1',0,'2',0,'5',0,'10',0,'20',0,'50',0,'100',0,'500',0,'1000',0),
      0, 'cash-v1-baseline',
      jsonb_build_object(
        'highlights', jsonb_build_array('รอบแรกใช้จำนวนที่นับเป็นฐานสำหรับรอบถัดไป'),
        'limitations', jsonb_build_array('ยังไม่มีฐานก่อนหน้าจึงไม่คำนวณคะแนนหรือความเชื่อมั่น'),
        'references', '[]'::jsonb,
        'components', jsonb_build_object('total', null, 'denomination', null, 'pattern', null)
      ), auth.uid(), coalesce(v_actor.name,''), coalesce(v_actor.phone,''), v_now
    ) returning id into v_count_id;
  else
    v_expected := private.cash_json_to_array(v_previous.actual_counts);
    v_expected_total := v_previous.actual_total;

    for v_event in
      select * from private.cash_count_events(v_session.location_id, v_previous.cutoff_at, v_session.cutoff_at)
      order by occurred_at, (reference->>'id')
    loop
      v_references := v_references || jsonb_build_array(v_event.reference || jsonb_build_object('kind', v_event.event_kind, 'occurredAt', v_event.occurred_at));
      if v_event.event_kind = 'known_in' then
        v_event_counts := private.cash_json_to_array(v_event.counts);
        for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] + v_event_counts[v_i]; end loop;
        v_expected_total := v_expected_total + v_event.amount;
      elsif v_event.event_kind = 'known_out' then
        v_event_counts := private.cash_json_to_array(v_event.counts);
        for v_i in 1..9 loop
          if v_expected[v_i] < v_event_counts[v_i] then v_allocation_failures := v_allocation_failures + 1; end if;
          v_expected[v_i] := greatest(0, v_expected[v_i] - v_event_counts[v_i]);
        end loop;
        v_expected_total := v_expected_total - v_event.amount;
      elsif v_event.event_kind = 'expense' then
        v_target := round(v_event.amount)::bigint;
        if v_event.amount <> v_target then v_fractional_count := v_fractional_count + 1; end if;
        v_take := private.cash_exact_take(v_expected, v_target);
        v_simulated_count := v_simulated_count + 1;
        if v_take is null then
          v_available_total := 0;
          for v_i in 1..9 loop
            v_available_total := v_available_total + v_expected[v_i] * (array[1000,500,100,50,20,10,5,2,1]::bigint[])[v_i];
          end loop;
          if v_available_total >= v_target then
            for v_delta in 1..least(999, v_available_total - v_target) loop
              v_take := private.cash_exact_take(v_expected, v_target + v_delta);
              exit when v_take is not null;
            end loop;
          end if;
          if v_take is null then
            v_allocation_failures := v_allocation_failures + 1;
          else
            v_change := private.cash_change_counts(v_delta);
            for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] - v_take[v_i] + v_change[v_i]; end loop;
            v_change_count := v_change_count + 1;
            v_change_amount := v_change_amount + v_delta;
          end if;
        else
          for v_i in 1..9 loop v_expected[v_i] := v_expected[v_i] - v_take[v_i]; end loop;
        end if;
        v_expected_total := v_expected_total - v_event.amount;
      elsif v_event.event_kind = 'income' then
        v_expected_total := v_expected_total + v_event.amount;
        v_unknown_count := v_unknown_count + 1;
      end if;
    end loop;

    v_difference := jsonb_build_object(
      '1000', v_actual[1]-v_expected[1], '500', v_actual[2]-v_expected[2],
      '100', v_actual[3]-v_expected[3], '50', v_actual[4]-v_expected[4],
      '20', v_actual[5]-v_expected[5], '10', v_actual[6]-v_expected[6],
      '5', v_actual[7]-v_expected[7], '2', v_actual[8]-v_expected[8],
      '1', v_actual[9]-v_expected[9]
    );
    v_difference_total := v_actual_total - v_expected_total;
    for v_i in 1..9 loop
      v_churn_value := v_churn_value + abs(v_actual[v_i]-v_expected[v_i]) * (array[1000,500,100,50,20,10,5,2,1]::bigint[])[v_i];
      if v_actual[v_i] > v_expected[v_i] then
        v_positive_value := v_positive_value + (v_actual[v_i]-v_expected[v_i]) * (array[1000,500,100,50,20,10,5,2,1]::bigint[])[v_i];
      end if;
    end loop;
    v_total_component := least(70, round(abs(v_difference_total) / greatest(abs(v_expected_total) * 0.05, 500) * 70)::integer);
    v_denom_component := least(20, round(v_positive_value / greatest(abs(v_expected_total) * 0.10, 500) * 20)::integer);
    v_pattern_component := least(10, round(greatest(0, v_churn_value - abs(v_difference_total)) / greatest(abs(v_expected_total) * 0.20, 1000) * 10)::integer);

    select count(*), coalesce(avg((c.evidence->'components'->>'pattern')::numeric), 0)
    into v_high_conf_history, v_pattern_baseline from public.cash_counts c
    where c.location_id = v_session.location_id and c.status = 'active' and c.confidence >= 80;
    if v_high_conf_history >= 10 then
      v_pattern_component := least(10, round(greatest(0, v_pattern_component - v_pattern_baseline * 0.5))::integer);
      v_formula := 'cash-v1-adaptive';
    end if;
    v_score := least(100, v_total_component + v_denom_component + v_pattern_component);
    v_confidence := greatest(0,
      100 - least(30, v_simulated_count * 3) - least(30, v_unknown_count * 10)
      - least(36, v_change_count * 12) - least(50, v_allocation_failures * 20)
      - least(20, v_fractional_count * 5)
    );
    v_status := case
      when v_confidence < 50 then 'insufficient_data'
      when v_score < 25 then 'normal'
      when v_score < 60 then 'review'
      else 'high_anomaly'
    end;

    if v_difference_total <> 0 then
      v_highlights := v_highlights || jsonb_build_array(format('ยอดเงินจริงต่างจากยอดคาดการณ์ %s บาท', to_char(abs(v_difference_total), 'FM999G999G999G990D00')));
    end if;
    if v_positive_value > 0 and jsonb_array_length(v_highlights) < 3 then
      v_highlights := v_highlights || jsonb_build_array(format('พบเงินบางชนิดเพิ่มจากแบบจำลองรวม %s บาท', to_char(v_positive_value, 'FM999G999G999G990D00')));
    end if;
    if v_pattern_component > 0 and jsonb_array_length(v_highlights) < 3 then
      v_highlights := v_highlights || jsonb_build_array('สัดส่วนชนิดเงินเปลี่ยนจากลำดับจ่ายที่จำลองไว้');
    end if;
    if jsonb_array_length(v_highlights) = 0 then
      v_highlights := jsonb_build_array('ยอดรวมและชนิดเงินสอดคล้องกับข้อมูลที่คำนวณได้');
    end if;
    if v_simulated_count > 0 then v_limitations := v_limitations || jsonb_build_array(format('จำลองการจ่ายเงินสด %s รายการจากชนิดเงินตั้งต้น', v_simulated_count)); end if;
    if v_change_count > 0 then v_limitations := v_limitations || jsonb_build_array(format('จำลองรับเงินทอน %s ครั้ง รวม %s บาท', v_change_count, v_change_amount)); end if;
    if v_unknown_count > 0 then v_limitations := v_limitations || jsonb_build_array(format('มีเงินสดเข้า %s รายการที่ไม่ทราบชนิดเงิน', v_unknown_count)); end if;
    if v_allocation_failures > 0 then v_limitations := v_limitations || jsonb_build_array(format('จัดชนิดเงินให้ตรงยอดไม่ได้ %s จุด', v_allocation_failures)); end if;
    if v_fractional_count > 0 then v_limitations := v_limitations || jsonb_build_array(format('มี %s รายการที่ต้องปัดเป็นบาทเพื่อจำลองชนิดเงิน', v_fractional_count)); end if;
    if jsonb_array_length(v_limitations) = 0 then v_limitations := jsonb_build_array('ไม่พบข้อจำกัดสำคัญของข้อมูลรอบนี้'); end if;

    insert into public.cash_counts (
      session_id, report_id, location_id, previous_cash_count_id, cutoff_at,
      actual_counts, actual_total, expected_counts, expected_total,
      difference_counts, difference_total, anomaly_score, confidence, analysis_status,
      formula_version, evidence, created_by_user_id, created_by_name, created_by_phone, created_at
    ) values (
      v_session.id, (v_report->>'id')::uuid, v_session.location_id, v_previous.id, v_session.cutoff_at,
      p_actual_counts, v_actual_total, private.cash_array_to_json(v_expected), v_expected_total,
      v_difference, v_difference_total, v_score, v_confidence, v_status, v_formula,
      jsonb_build_object(
        'highlights', v_highlights, 'limitations', v_limitations, 'references', v_references,
        'components', jsonb_build_object('total',v_total_component,'denomination',v_denom_component,'pattern',v_pattern_component),
        'adaptiveHistoryCount', v_high_conf_history, 'adaptivePatternBaseline', v_pattern_baseline
      ), auth.uid(), coalesce(v_actor.name,''), coalesce(v_actor.phone,''), v_now
    ) returning id into v_count_id;
  end if;

  update public.cash_count_sessions set status = 'submitted', ended_at = v_now where id = v_session.id;
  return jsonb_build_object(
    'id', v_count_id, 'reportId', v_report->>'id', 'reportNo', v_report->>'reportNo',
    'cutoffAt', v_session.cutoff_at, 'submittedAt', v_now,
    'countedByName', coalesce(v_actor.name,''), 'actualCounts', p_actual_counts, 'actualTotal', v_actual_total
  );
end;
$$;

create or replace function public.delete_cash_count(p_cash_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_count public.cash_counts%rowtype;
  v_report public.report_batches%rowtype;
  v_actor record;
  v_now timestamptz := clock_timestamp();
  v_export_no text;
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบผลตรวจนับได้';
  end if;
  select * into v_count from public.cash_counts where id = p_cash_count_id for update;
  if v_count.id is null or v_count.status <> 'active' then raise exception 'ไม่พบผลตรวจนับ active'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_count.location_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || v_count.location_id::text, 0));
  select * into v_report from public.report_batches where id = v_count.report_id for update;
  if v_report.id is null or v_report.status <> 'active' then raise exception 'รายงานของผลตรวจนับไม่อยู่ในสถานะ active'; end if;
  if exists (
    select 1 from public.report_batches newer
    where newer.location_id = v_count.location_id and newer.status = 'active'
      and (newer.created_at, newer.id) > (v_report.created_at, v_report.id)
  ) then raise exception 'ลบได้เฉพาะชุดตรวจนับและรายงาน active ล่าสุดของสาขา'; end if;
  v_export_no := private.active_rubber_export_no_for_report(v_report.id);
  if v_export_no is not null then
    raise exception 'RUBBER_EXPORT_LOCKED:%', v_export_no using hint = 'ลบรายการส่งออกยางก่อนจึงจะลบชุดตรวจนับได้';
  end if;
  select p.name, p.phone into v_actor from public.profiles p where p.id = auth.uid();
  update public.cash_counts set status = 'deleted', deleted_at = v_now,
    deleted_by_user_id = auth.uid(), deleted_by_name = coalesce(v_actor.name,''), deleted_by_phone = coalesce(v_actor.phone,'')
  where id = v_count.id;
  update public.report_batches set status = 'deleted', deleted_at = v_now,
    deleted_by_user_id = auth.uid(), deleted_by_name = coalesce(v_actor.name,''), deleted_by_phone = coalesce(v_actor.phone,'')
  where id = v_report.id;
  update public.report_items set active = false where report_id = v_report.id and active = true;
  return jsonb_build_object('id', v_count.id, 'reportId', v_report.id, 'reportNo', v_report.report_no, 'status', 'deleted');
end;
$$;

create or replace function public.delete_report_batch(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_report public.report_batches%rowtype;
  v_export_no text;
  v_actor record;
begin
  if not private.can_delete_reports() then raise exception 'เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบรายงานได้'; end if;
  if exists (select 1 from public.cash_counts c where c.report_id = p_report_id and c.status = 'active') then
    raise exception 'CASH_COUNT_LINKED: รายงานนี้มีผลตรวจนับเงินสด กรุณาลบจากโมดูลนับเงิน';
  end if;
  select * into v_report from public.report_batches where id = p_report_id for update;
  if v_report.id is null or v_report.status <> 'active' then raise exception 'ไม่พบรายงาน active'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || v_report.location_id::text, 0));
  if exists (
    select 1 from public.report_batches newer where newer.location_id = v_report.location_id
      and newer.status = 'active' and (newer.created_at,newer.id) > (v_report.created_at,v_report.id)
  ) then raise exception 'ลบได้เฉพาะรายงาน active ล่าสุดของสาขา'; end if;
  v_export_no := private.active_rubber_export_no_for_report(p_report_id);
  if v_export_no is not null then
    raise exception 'RUBBER_EXPORT_LOCKED:%', v_export_no using hint = 'ลบรายการส่งออกยางก่อนจึงจะลบรายงานได้';
  end if;
  select p.name,p.phone into v_actor from public.profiles p where p.id=auth.uid();
  update public.report_batches set status='deleted', deleted_at=clock_timestamp(),
    deleted_by_user_id=auth.uid(), deleted_by_name=coalesce(v_actor.name,''), deleted_by_phone=coalesce(v_actor.phone,'')
  where id=p_report_id;
  update public.report_items set active=false where report_id=p_report_id and active=true;
  return jsonb_build_object('id',p_report_id,'reportNo',v_report.report_no,'status','deleted');
end;
$$;

create or replace function public.has_cash_count(source_row public.report_batches)
returns boolean language sql stable security definer set search_path = public, private
as $$
  select exists (select 1 from public.cash_counts c where c.report_id=source_row.id)
    and private.can_manage_reports(source_row.location_id);
$$;

create or replace function public.cash_count_checker_name(source_row public.report_batches)
returns text language sql stable security definer set search_path = public, private
as $$
  select case when private.can_manage_reports(source_row.location_id) then
    (select c.created_by_name from public.cash_counts c where c.report_id=source_row.id) end;
$$;

create or replace function public.cash_count_submitted_at(source_row public.report_batches)
returns timestamptz language sql stable security definer set search_path = public, private
as $$
  select case when private.can_manage_reports(source_row.location_id) then
    (select c.created_at from public.cash_counts c where c.report_id=source_row.id) end;
$$;

create or replace function public.cash_count_link_id(source_row public.report_batches)
returns uuid language sql stable security definer set search_path = public, private
as $$
  select case when private.can_delete_reports() then
    (select c.id from public.cash_counts c where c.report_id=source_row.id and c.status='active') end;
$$;

revoke all on function private.can_use_cash_count(uuid), private.cash_count_counts_valid(jsonb),
  private.cash_count_difference_valid(jsonb), private.cash_count_total(jsonb), private.cash_json_to_array(jsonb),
  private.cash_array_to_json(bigint[]), private.cash_exact_take(bigint[],bigint,integer), private.cash_change_counts(bigint),
  private.create_report_batch_at(uuid,timestamptz,uuid), private.cash_count_events(uuid,timestamptz,timestamptz)
from public, anon, authenticated;

revoke all on function public.get_cash_count_session(uuid), public.start_cash_count_session(uuid),
  public.cancel_cash_count_session(uuid), public.submit_cash_count(uuid,jsonb), public.delete_cash_count(uuid),
  public.has_cash_count(public.report_batches), public.cash_count_checker_name(public.report_batches),
  public.cash_count_submitted_at(public.report_batches), public.cash_count_link_id(public.report_batches)
from public, anon;

grant execute on function public.get_cash_count_session(uuid), public.start_cash_count_session(uuid),
  public.cancel_cash_count_session(uuid), public.submit_cash_count(uuid,jsonb), public.delete_cash_count(uuid),
  public.has_cash_count(public.report_batches), public.cash_count_checker_name(public.report_batches),
  public.cash_count_submitted_at(public.report_batches), public.cash_count_link_id(public.report_batches)
to authenticated, service_role;
