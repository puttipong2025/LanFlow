create or replace function private.lock_report_locations(p_location_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
begin
  for v_location_id in
    select distinct location_id
    from pg_catalog.unnest(coalesce(p_location_ids, array[]::uuid[])) as locations(location_id)
    where location_id is not null
    order by location_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_location_id::text, 0)
    );
  end loop;
end;
$$;

create or replace function private.report_creation_blockers(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns table(blocker_key text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with blocker_rows as (
    select 'rubber_bill_pending'::text as blocker_key, blocker_id
    from private.rubber_bill_report_blockers(p_location_id, p_cutoff_at)

    union all

    select 'income_expense_approval_pending', request.id
    from public.income_expense_approval_requests request
    where request.location_id = p_location_id
      and request.request_status = 'pending'
      and request.created_at <= p_cutoff_at

    union all

    select 'cash_transfer_delete_pending', request.id
    from public.cash_transfer_delete_requests request
    where request.request_status = 'pending'
      and request.created_at <= p_cutoff_at
      and p_location_id in (request.source_location_id, request.target_location_id)

    union all

    select 'stock_entry_delete_pending', request.id
    from public.stock_entry_approval_requests request
    where request.request_status = 'pending'
      and request.created_at <= p_cutoff_at
      and p_location_id in (request.location_id, request.target_location_id)
  )
  select blocker_rows.blocker_key, count(distinct blocker_rows.blocker_id)::bigint
  from blocker_rows
  group by blocker_rows.blocker_key
  order by case blocker_rows.blocker_key
    when 'rubber_bill_pending' then 1
    when 'income_expense_approval_pending' then 2
    when 'cash_transfer_delete_pending' then 3
    when 'stock_entry_delete_pending' then 4
  end;
$$;

create or replace function private.cash_count_start_blockers(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns table(blocker_key text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with blocker_counts as (
    select blockers.blocker_key, blockers.item_count
    from private.report_creation_blockers(p_location_id, p_cutoff_at) blockers

    union all

    select
      'cash_transfer_receipt_pending'::text,
      count(distinct transfer.id)::bigint
    from public.money_transfers transfer
    join public.money_transfer_cash_details cash
      on cash.transfer_id = transfer.id
    where transfer.target_location_id = p_location_id
      and transfer.transfer_type = 'cash'
      and transfer.transfer_method = 'cash'
      and transfer.record_status <> 'deleted'
      and cash.cash_status = 'pending_receipt'
      and cash.sent_at <= p_cutoff_at
    having count(distinct transfer.id) > 0
  )
  select blocker_counts.blocker_key, blocker_counts.item_count
  from blocker_counts
  order by case blocker_counts.blocker_key
    when 'rubber_bill_pending' then 1
    when 'income_expense_approval_pending' then 2
    when 'cash_transfer_delete_pending' then 3
    when 'stock_entry_delete_pending' then 4
    when 'cash_transfer_receipt_pending' then 5
  end;
$$;

create or replace function private.assert_report_creation_unblocked(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_blockers jsonb;
begin
  select jsonb_agg(
    jsonb_build_object('key', blockers.blocker_key, 'count', blockers.item_count)
    order by case blockers.blocker_key
      when 'rubber_bill_pending' then 1
      when 'income_expense_approval_pending' then 2
      when 'cash_transfer_delete_pending' then 3
      when 'stock_entry_delete_pending' then 4
    end
  )
  into v_blockers
  from private.report_creation_blockers(p_location_id, p_cutoff_at) blockers;

  if v_blockers is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PENDING_WORK_BLOCKED',
      detail = jsonb_build_object('blockers', v_blockers)::text;
  end if;
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
set search_path = 'public', 'private'
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
  perform private.assert_report_creation_unblocked(
    p_location_id,
    clock_timestamp()
  );

  select profile.name, profile.phone
  into v_actor_name, v_actor_phone
  from public.profiles profile
  where profile.id = p_actor_id;

  select batch.id, batch.closing_balance
  into v_previous_report_id, v_opening_balance
  from public.report_batches batch
  where batch.location_id = p_location_id
    and batch.status = 'active'
  order by batch.created_at desc, batch.id desc
  limit 1;

  v_report_date := (p_cutoff_at at time zone 'Asia/Bangkok')::date;
  v_sequence_no := private.next_document_sequence(
    'RPT', p_location_id, v_report_date
  );
  v_report_no := 'RPT-' || to_char(v_report_date, 'YYYYMMDD') || '-'
    || lpad(v_sequence_no::text, 3, '0');

  insert into public.report_batches (
    report_no, report_date, sequence_no, location_id, cutoff_at,
    previous_report_id, opening_balance, created_by_user_id,
    created_by_name, created_by_phone
  ) values (
    v_report_no, v_report_date, v_sequence_no, p_location_id, p_cutoff_at,
    v_previous_report_id, coalesce(v_opening_balance, 0), p_actor_id,
    coalesce(v_actor_name, ''), coalesce(v_actor_phone, '')
  )
  returning id into v_report_id;

  insert into public.report_items (
    report_id, location_id, entity_type, entity_id, eligibility_at
  )
  select
    v_report_id,
    p_location_id,
    reportable.entity_type,
    reportable.entity_id,
    reportable.eligibility_at
  from private.reportable_items(p_location_id, p_cutoff_at) reportable
  on conflict do nothing;

  get diagnostics v_item_count = row_count;
  if v_item_count = 0 then
    raise exception 'ไม่มีรายการที่พร้อมออกรายงาน';
  end if;

  select coalesce(sum(
    case when row.entry_type = 'income' then row.amount else -row.amount end
  ), 0)
  into v_period_balance
  from private.report_income_expense_period_rows(v_report_id) row;

  update public.report_batches
  set closing_balance = coalesce(v_opening_balance, 0) + v_period_balance
  where id = v_report_id;

  return jsonb_build_object(
    'id', v_report_id,
    'reportNo', v_report_no,
    'cutoffAt', p_cutoff_at,
    'itemCount', v_item_count
  );
end;
$$;

create or replace function private.guard_pending_work_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_no text;
begin
  if new.request_status <> 'pending' then
    return new;
  end if;

  if tg_table_name = 'income_expense_approval_requests' then
    perform private.lock_report_locations(array[new.location_id]);

    if new.source_income_expense_id is not null then
      v_report_no := private.active_report_no(
        'income_expense',
        new.source_income_expense_id
      );
    end if;
  elsif tg_table_name = 'cash_transfer_delete_requests' then
    perform private.lock_report_locations(
      array[new.source_location_id, new.target_location_id]
    );

    if new.transfer_id is not null then
      v_report_no := private.active_transfer_report_no(new.transfer_id);
    end if;
  elsif tg_table_name = 'stock_entry_approval_requests' then
    perform private.lock_report_locations(
      array[new.location_id, new.target_location_id]
    );

    v_report_no := private.active_report_no(
      'acid_stock_entry',
      new.stock_entry_id
    );

    if v_report_no is null and new.transfer_bill_no is not null then
      select private.active_report_no('acid_stock_entry', entry.id)
      into v_report_no
      from public.stock_entries entry
      where entry.transfer_bill_no = new.transfer_bill_no
        and entry.product_id = new.product_id
        and entry.id <> new.stock_entry_id
      order by entry.created_at, entry.id
      limit 1;
    end if;
  else
    raise exception 'PENDING_WORK_GUARD_TABLE_UNSUPPORTED';
  end if;

  if v_report_no is not null then
    raise exception 'REPORT_LOCKED:%', v_report_no;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_pending_income_expense_request
  on public.income_expense_approval_requests;
create trigger guard_pending_income_expense_request
before insert or update of request_status
on public.income_expense_approval_requests
for each row execute function private.guard_pending_work_request();

drop trigger if exists guard_pending_cash_transfer_delete_request
  on public.cash_transfer_delete_requests;
create trigger guard_pending_cash_transfer_delete_request
before insert or update of request_status
on public.cash_transfer_delete_requests
for each row execute function private.guard_pending_work_request();

drop trigger if exists guard_pending_stock_entry_delete_request
  on public.stock_entry_approval_requests;
create trigger guard_pending_stock_entry_delete_request
before insert or update of request_status
on public.stock_entry_approval_requests
for each row execute function private.guard_pending_work_request();

create index if not exists cash_transfer_delete_pending_source_idx
  on public.cash_transfer_delete_requests (source_location_id, created_at, id)
  where request_status = 'pending';

create index if not exists cash_transfer_delete_pending_target_idx
  on public.cash_transfer_delete_requests (target_location_id, created_at, id)
  where request_status = 'pending';

create index if not exists stock_entry_delete_pending_source_idx
  on public.stock_entry_approval_requests (location_id, created_at, id)
  where request_status = 'pending';

create index if not exists stock_entry_delete_pending_target_idx
  on public.stock_entry_approval_requests (target_location_id, created_at, id)
  where request_status = 'pending' and target_location_id is not null;

create or replace function private.can_use_cash_count(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      private.can_access_super_admin_features()
      or (
        private.current_user_role() = 'admin'
        and private.can_access_location(p_location_id)
      )
    )
$$;

create or replace function public.create_report_batch(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff_at timestamptz := clock_timestamp();
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายงานของสาขานี้';
  end if;

  perform private.lock_report_locations(array[p_location_id]);

  if exists (
    select 1
    from public.cash_count_sessions session
    where session.location_id = p_location_id
      and session.status = 'active'
      and session.expires_at > v_cutoff_at
  ) then
    raise exception 'CASH_COUNT_ACTIVE: มีการตรวจนับเงินสดของสาขานี้อยู่ กรุณารอให้ส่งผล ยกเลิก หรือหมดเวลา';
  end if;

  return private.create_report_batch_at(p_location_id, v_cutoff_at, auth.uid());
end;
$$;

create or replace function public.start_cash_count_session(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_actor record;
  v_session public.cash_count_sessions%rowtype;
  v_blockers jsonb;
begin
  if not private.can_use_cash_count(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจนับเงินสดของสาขานี้';
  end if;

  perform private.lock_report_locations(array[p_location_id]);

  update public.cash_count_sessions
  set status = 'expired', ended_at = v_now
  where location_id = p_location_id
    and status = 'active'
    and expires_at <= v_now;

  select *
  into v_session
  from public.cash_count_sessions
  where location_id = p_location_id
    and status = 'active'
  limit 1;

  if v_session.id is not null then
    raise exception 'CASH_COUNT_ACTIVE: มีผู้ตรวจนับเงินสดของสาขานี้อยู่แล้ว';
  end if;

  select jsonb_agg(
    jsonb_build_object('key', blockers.blocker_key, 'count', blockers.item_count)
    order by case blockers.blocker_key
      when 'rubber_bill_pending' then 1
      when 'income_expense_approval_pending' then 2
      when 'cash_transfer_delete_pending' then 3
      when 'stock_entry_delete_pending' then 4
      when 'cash_transfer_receipt_pending' then 5
    end
  )
  into v_blockers
  from private.cash_count_start_blockers(p_location_id, v_now) blockers;

  if v_blockers is not null then
    raise exception using
      errcode = 'P0001',
      message = 'PENDING_WORK_BLOCKED',
      detail = jsonb_build_object('blockers', v_blockers)::text;
  end if;

  if not exists (
    select 1 from private.reportable_items(p_location_id, v_now)
  ) then
    raise exception 'ไม่มีรายการที่พร้อมออกรายงาน';
  end if;

  select profile.name, profile.phone
  into v_actor
  from public.profiles profile
  where profile.id = auth.uid();

  insert into public.cash_count_sessions (
    location_id,
    cutoff_at,
    expires_at,
    started_by_user_id,
    started_by_name,
    started_by_phone,
    started_at
  ) values (
    p_location_id,
    v_now,
    v_now + interval '30 minutes',
    auth.uid(),
    coalesce(v_actor.name, ''),
    coalesce(v_actor.phone, ''),
    v_now
  )
  returning * into v_session;

  return jsonb_build_object('session', jsonb_build_object(
    'id', v_session.id,
    'locationId', v_session.location_id,
    'cutoffAt', v_session.cutoff_at,
    'expiresAt', v_session.expires_at,
    'startedAt', v_session.started_at,
    'startedByName', v_session.started_by_name,
    'isOwner', true
  ));
end;
$$;

revoke all on function private.lock_report_locations(uuid[]) from public, anon, authenticated;
revoke all on function private.report_creation_blockers(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.cash_count_start_blockers(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.assert_report_creation_unblocked(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.guard_pending_work_request() from public, anon, authenticated;
revoke all on function private.can_use_cash_count(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
