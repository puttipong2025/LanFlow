-- Destination receipt is terminal for cash transfers. Deletion before receipt is
-- immediate; deletion after receipt follows one global approval toggle.

alter table public.income_expense_approval_settings
  add column if not exists cash_transfer_delete_requires_approval boolean not null default true;

alter table public.money_transfer_cash_details
  drop constraint if exists money_transfer_cash_details_cash_status_check,
  drop constraint if exists money_transfer_cash_details_check,
  drop constraint if exists money_transfer_cash_details_check1,
  drop constraint if exists money_transfer_cash_details_check2;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.money_transfer_cash_details'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%cash_status%'
  loop
    execute format(
      'alter table public.money_transfer_cash_details drop constraint %I',
      constraint_name
    );
  end loop;
end;
$$;

update public.money_transfer_cash_details
set cash_status = 'received'
where cash_status in ('mismatched', 'difference_accepted');

alter table public.money_transfer_cash_details
  add constraint money_transfer_cash_details_sent_total_positive_check
    check (sent_total > 0),
  add constraint money_transfer_cash_details_cash_status_check
    check (cash_status in ('pending_receipt', 'received')),
  add constraint money_transfer_cash_details_receipt_shape_check
    check (
      (
        cash_status = 'pending_receipt'
        and num_nonnulls(
          received_coin_1_count, received_coin_2_count, received_coin_5_count,
          received_coin_10_count, received_banknote_20_count, received_banknote_50_count,
          received_banknote_100_count, received_banknote_500_count,
          received_banknote_1000_count
        ) = 0
        and received_by_user_id is null
        and received_at is null
      )
      or (
        cash_status = 'received'
        and num_nonnulls(
          received_coin_1_count, received_coin_2_count, received_coin_5_count,
          received_coin_10_count, received_banknote_20_count, received_banknote_50_count,
          received_banknote_100_count, received_banknote_500_count,
          received_banknote_1000_count
        ) = 9
        and received_by_user_id is not null
        and received_at is not null
      )
    ),
  add constraint money_transfer_cash_details_difference_shape_check
    check (
      (cash_status = 'pending_receipt' and difference_total is null)
      or (cash_status = 'received' and difference_total is not null)
    );

create table public.cash_transfer_delete_requests (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid references public.money_transfers(id) on delete set null,
  source_location_id uuid not null references public.locations(id),
  source_location_name text not null,
  target_location_id uuid not null references public.locations(id),
  target_location_name text not null,
  transfer_display_no text not null,
  sent_total numeric(12,2) not null check (sent_total > 0),
  received_total numeric(12,2) not null check (received_total >= 0),
  difference_total numeric(12,2) not null,
  note text,
  request_status text not null default 'pending'
    check (request_status in ('pending', 'approved', 'rejected')),
  requested_by_user_id uuid not null references public.profiles(id),
  requested_by_name text not null,
  requested_by_phone text not null,
  decided_by_user_id uuid references public.profiles(id),
  decided_by_name text,
  decided_by_phone text,
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (request_status = 'pending' and decided_by_user_id is null and decided_at is null)
    or (request_status in ('approved', 'rejected') and decided_by_user_id is not null and decided_at is not null)
  )
);

create unique index cash_transfer_delete_requests_one_pending
  on public.cash_transfer_delete_requests(transfer_id)
  where request_status = 'pending' and transfer_id is not null;

create index cash_transfer_delete_requests_status_created
  on public.cash_transfer_delete_requests(request_status, created_at desc);

alter table public.cash_transfer_delete_requests enable row level security;

create policy "cash transfer delete requests read"
  on public.cash_transfer_delete_requests for select to authenticated
  using (
    private.can_access_super_admin_features()
    or requested_by_user_id = auth.uid()
    or private.can_access_location(source_location_id)
  );

revoke all on public.cash_transfer_delete_requests from anon, authenticated;
grant select on public.cash_transfer_delete_requests to authenticated;
grant all on public.cash_transfer_delete_requests to service_role;

create or replace function public.receive_cash_branch_transfer(
  p_transfer_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  transfer_row public.money_transfers%rowtype;
  counts integer[];
  actor_id uuid := auth.uid();
  actor_name text;
  actor_phone text;
  total numeric;
  sent numeric;
begin
  select * into transfer_row
  from public.money_transfers
  where id = p_transfer_id
  for update;

  if transfer_row.id is null or transfer_row.transfer_method <> 'cash' then
    raise exception 'ไม่พบรายการเงินสด';
  end if;
  if not private.can_access_location(transfer_row.target_location_id) then
    raise exception 'ไม่มีสิทธิ์ตรวจรับสาขานี้';
  end if;

  counts := private.cash_transfer_counts(payload, 'received');
  select name, phone into actor_name, actor_phone
  from public.profiles
  where id = actor_id;

  update public.money_transfer_cash_details
  set received_coin_1_count = counts[1],
      received_coin_2_count = counts[2],
      received_coin_5_count = counts[3],
      received_coin_10_count = counts[4],
      received_banknote_20_count = counts[5],
      received_banknote_50_count = counts[6],
      received_banknote_100_count = counts[7],
      received_banknote_500_count = counts[8],
      received_banknote_1000_count = counts[9],
      received_by_user_id = actor_id,
      received_by_name = coalesce(actor_name, ''),
      received_by_phone = coalesce(actor_phone, ''),
      received_at = now(),
      updated_at = now(),
      cash_status = 'received'
  where transfer_id = p_transfer_id
    and cash_status = 'pending_receipt'
  returning received_total, sent_total into total, sent;

  if not found then
    raise exception 'รายการนี้ถูกตรวจรับแล้ว';
  end if;

  update public.money_transfers
  set transfer_status = 'paid',
      revision_no = revision_no + 1,
      updated_at = now()
  where id = p_transfer_id;

  return jsonb_build_object(
    'id', p_transfer_id,
    'status', 'synced',
    'difference', total - sent
  );
end;
$$;

revoke all on function public.accept_cash_branch_difference(uuid, text)
  from public, anon, authenticated;
drop function public.accept_cash_branch_difference(uuid, text);

create or replace function public.delete_cash_branch_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  transfer_row public.money_transfers%rowtype;
  cash_row public.money_transfer_cash_details%rowtype;
  actor_id uuid := auth.uid();
  actor_name text;
  actor_phone text;
  source_name text;
  target_name text;
  requires_approval boolean;
  existing_request_id uuid;
  request_id uuid;
  report_no text;
begin
  if not private.is_active_user() then
    raise exception 'ไม่มีสิทธิ์ลบรายการเงินสด';
  end if;

  select * into transfer_row
  from public.money_transfers
  where id = p_transfer_id
  for update;

  if transfer_row.id is null
    or transfer_row.transfer_type <> 'cash'
    or transfer_row.transfer_method <> 'cash'
  then
    raise exception 'ไม่พบรายการเงินสด';
  end if;

  if not private.can_manage_location(transfer_row.location_id) then
    raise exception 'เฉพาะผู้ดูแลสาขาต้นทางหรือผู้จัดการระบบเท่านั้นที่ลบรายการเงินสดได้';
  end if;

  select * into cash_row
  from public.money_transfer_cash_details
  where transfer_id = p_transfer_id
  for update;

  if cash_row.transfer_id is null then
    raise exception 'ไม่พบรายละเอียดเงินสด';
  end if;

  report_no := private.active_transfer_report_no(p_transfer_id);
  if report_no is not null then
    perform private.raise_report_lock(report_no);
  end if;

  select id into existing_request_id
  from public.cash_transfer_delete_requests
  where transfer_id = p_transfer_id
    and request_status = 'pending'
  for update;

  if existing_request_id is not null then
    return jsonb_build_object(
      'id', p_transfer_id,
      'status', 'pending_approval',
      'requestId', existing_request_id
    );
  end if;

  select coalesce(cash_transfer_delete_requires_approval, true)
  into requires_approval
  from public.income_expense_approval_settings
  where id = true;

  if cash_row.cash_status = 'pending_receipt'
    or not coalesce(requires_approval, true)
  then
    delete from public.money_transfers where id = p_transfer_id;
    return jsonb_build_object('id', p_transfer_id, 'status', 'deleted');
  end if;

  select name, phone into actor_name, actor_phone
  from public.profiles
  where id = actor_id;
  select name into source_name
  from public.locations
  where id = transfer_row.location_id;
  select name into target_name
  from public.locations
  where id = transfer_row.target_location_id;

  insert into public.cash_transfer_delete_requests (
    transfer_id,
    source_location_id,
    source_location_name,
    target_location_id,
    target_location_name,
    transfer_display_no,
    sent_total,
    received_total,
    difference_total,
    note,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  )
  values (
    p_transfer_id,
    transfer_row.location_id,
    coalesce(source_name, 'ไม่ทราบสาขา'),
    transfer_row.target_location_id,
    coalesce(target_name, transfer_row.target_location_name, 'ไม่ทราบสาขา'),
    'CASH-' || left(p_transfer_id::text, 8),
    cash_row.sent_total,
    cash_row.received_total,
    cash_row.difference_total,
    cash_row.note,
    actor_id,
    coalesce(actor_name, ''),
    coalesce(actor_phone, '')
  )
  returning id into request_id;

  return jsonb_build_object(
    'id', p_transfer_id,
    'status', 'pending_approval',
    'requestId', request_id
  );
end;
$$;

create or replace function public.decide_cash_transfer_delete_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  request_row public.cash_transfer_delete_requests%rowtype;
  decider_id uuid := auth.uid();
  decider_name text;
  decider_phone text;
  report_no text;
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
  then
    raise exception 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'คำตัดสินไม่ถูกต้อง';
  end if;

  select * into request_row
  from public.cash_transfer_delete_requests
  where id = p_request_id;

  if request_row.id is null then
    raise exception 'ไม่พบคำขอลบรายการโยกเงิน';
  end if;
  if request_row.request_status <> 'pending' then
    raise exception 'คำขอนี้ถูกดำเนินการแล้ว';
  end if;

  if request_row.transfer_id is not null then
    perform 1
    from public.money_transfers
    where id = request_row.transfer_id
      and transfer_type = 'cash'
      and transfer_method = 'cash'
    for update;
    if not found and p_decision = 'approved' then
      select * into request_row
      from public.cash_transfer_delete_requests
      where id = p_request_id
      for update;
      if request_row.request_status <> 'pending' then
        raise exception 'คำขอนี้ถูกดำเนินการแล้ว';
      end if;
      raise exception 'ไม่พบรายการเงินสดต้นทาง';
    end if;
  end if;

  select * into request_row
  from public.cash_transfer_delete_requests
  where id = p_request_id
  for update;

  if request_row.request_status <> 'pending' then
    raise exception 'คำขอนี้ถูกดำเนินการแล้ว';
  end if;

  select name, phone into decider_name, decider_phone
  from public.profiles
  where id = decider_id;

  if p_decision = 'approved' then
    if request_row.transfer_id is null then
      raise exception 'ไม่พบรายการเงินสดต้นทาง';
    end if;

    report_no := private.active_transfer_report_no(request_row.transfer_id);
    if report_no is not null then
      perform private.raise_report_lock(report_no);
    end if;

    delete from public.money_transfers
    where id = request_row.transfer_id;
  end if;

  update public.cash_transfer_delete_requests
  set request_status = p_decision,
      decided_by_user_id = decider_id,
      decided_by_name = coalesce(decider_name, ''),
      decided_by_phone = coalesce(decider_phone, ''),
      decided_at = now(),
      decision_comment = nullif(btrim(p_comment), ''),
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'status', p_decision,
    'requestId', p_request_id
  );
end;
$$;

revoke all on function public.receive_cash_branch_transfer(uuid, jsonb)
  from public, anon;
revoke all on function public.delete_cash_branch_transfer(uuid)
  from public, anon;
revoke all on function public.decide_cash_transfer_delete_request(uuid, text, text)
  from public, anon;
grant execute on function public.receive_cash_branch_transfer(uuid, jsonb)
  to authenticated;
grant execute on function public.delete_cash_branch_transfer(uuid)
  to authenticated;
grant execute on function public.decide_cash_transfer_delete_request(uuid, text, text)
  to authenticated;

delete from public.telegram_badge_catalog
where badge_key = 'cash_transfer_mismatched';

alter table public.telegram_badge_settings
  alter column enabled_badge_keys set default array[
    'rubber_bill_approval_pending',
    'income_expense_approval_pending',
    'cash_transfer_pending_receipt',
    'stock_approval_pending',
    'money_transfer_pending',
    'money_transfer_partial',
    'money_transfer_advance',
    'time_tracking_approval_pending',
    'rubber_export_draft'
  ]::text[];

update public.telegram_badge_settings
set enabled_badge_keys = array_remove(enabled_badge_keys, 'cash_transfer_mismatched'),
    updated_at = now()
where id = true;

drop index if exists public.cash_transfer_pending_digest;
create index cash_transfer_pending_digest
  on public.money_transfer_cash_details(transfer_id)
  where cash_status = 'pending_receipt';
