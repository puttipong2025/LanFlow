-- Report batches keep source IDs and resolve live details only when viewed/printed.
-- Active report items are the database-level lock for their source records.

create table public.report_batches (
  id uuid primary key default gen_random_uuid(),
  report_no text not null,
  report_date date not null,
  sequence_no integer not null check (sequence_no > 0),
  location_id uuid not null references public.locations(id),
  cutoff_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null,
  created_by_phone text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.profiles(id),
  deleted_by_name text,
  deleted_by_phone text,
  unique (location_id, report_date, sequence_no),
  unique (location_id, report_no)
);

create table public.report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.report_batches(id),
  location_id uuid not null references public.locations(id),
  entity_type text not null check (entity_type in (
    'rubber_bill',
    'ocr_ticket',
    'income_expense',
    'acid_stock_entry',
    'time_segment',
    'leave_request',
    'financial_transaction',
    'payroll_slip',
    'bank_transfer_source',
    'bank_transfer_target',
    'cash_transfer_sent',
    'cash_transfer_received'
  )),
  entity_id uuid not null,
  eligibility_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (report_id, entity_type, entity_id)
);

create unique index report_items_one_active_context
  on public.report_items(location_id, entity_type, entity_id)
  where active = true;

create index report_items_active_source
  on public.report_items(entity_type, entity_id)
  where active = true;

create index report_batches_latest_active
  on public.report_batches(location_id, created_at desc, id desc)
  where status = 'active';

create index report_batches_location_history
  on public.report_batches(location_id, created_at desc);

-- Money Transfer is online-only; a committed server row is already synced.
alter table public.money_transfers
  alter column sync_status set default 'synced';

update public.money_transfers
set sync_status = 'synced',
    server_received_at = coalesce(server_received_at, updated_at, created_at)
where sync_status <> 'synced';

create or replace function private.can_manage_reports(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.is_active_user()
    and (
      public.can_access_super_admin_features()
      or exists (
        select 1
        from public.profiles p
        join public.user_locations ul on ul.user_id = p.id
        where p.id = auth.uid()
          and p.role = 'admin'
          and ul.location_id = p_location_id
      )
    );
$$;

create or replace function private.can_delete_reports()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.is_active_user()
    and public.can_access_super_admin_features();
$$;

create or replace function private.active_report_no(
  p_entity_type text,
  p_entity_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select b.report_no
  from public.report_items i
  join public.report_batches b on b.id = i.report_id
  where i.entity_type = p_entity_type
    and i.entity_id = p_entity_id
    and i.active = true
    and b.status = 'active'
  order by b.created_at desc, b.id desc
  limit 1;
$$;

create or replace function private.active_transfer_report_no(p_transfer_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select b.report_no
  from public.report_items i
  join public.report_batches b on b.id = i.report_id
  where i.entity_id = p_transfer_id
    and i.entity_type in (
      'bank_transfer_source',
      'bank_transfer_target',
      'cash_transfer_sent',
      'cash_transfer_received'
    )
    and i.active = true
    and b.status = 'active'
  order by b.created_at desc, b.id desc
  limit 1;
$$;

-- PostgREST computed fields used by existing source lists to explain disabled actions.
create or replace function public.report_lock_no(source_row public.rubber_bills)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_report_no('rubber_bill', source_row.id); $$;

create or replace function public.report_lock_no(source_row public.ocr_tickets)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_report_no('ocr_ticket', source_row.id); $$;

create or replace function public.report_lock_no(source_row public.income_expense)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_report_no('income_expense', source_row.id); $$;

create or replace function public.report_lock_no(source_row public.stock_entries)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_report_no('acid_stock_entry', source_row.id); $$;

create or replace function public.report_lock_no(source_row public.money_transfers)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_transfer_report_no(source_row.id); $$;

create or replace function public.report_lock_no(source_row public.time_segments)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_report_no('time_segment', source_row.id); $$;

create or replace function public.report_lock_no(source_row public.leave_requests)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_report_no('leave_request', source_row.id); $$;

create or replace function public.report_lock_no(source_row public.financial_transactions)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_report_no('financial_transaction', source_row.id); $$;

create or replace function public.report_lock_no(source_row public.payroll_slips)
returns text language sql stable security definer set search_path = public, private
as $$ select private.active_report_no('payroll_slip', source_row.id); $$;

revoke all on function public.report_lock_no(public.rubber_bills),
  public.report_lock_no(public.ocr_tickets),
  public.report_lock_no(public.income_expense),
  public.report_lock_no(public.stock_entries),
  public.report_lock_no(public.money_transfers),
  public.report_lock_no(public.time_segments),
  public.report_lock_no(public.leave_requests),
  public.report_lock_no(public.financial_transactions),
  public.report_lock_no(public.payroll_slips)
from public, anon;

grant execute on function public.report_lock_no(public.rubber_bills),
  public.report_lock_no(public.ocr_tickets),
  public.report_lock_no(public.income_expense),
  public.report_lock_no(public.stock_entries),
  public.report_lock_no(public.money_transfers),
  public.report_lock_no(public.time_segments),
  public.report_lock_no(public.leave_requests),
  public.report_lock_no(public.financial_transactions),
  public.report_lock_no(public.payroll_slips)
to authenticated, service_role;

create or replace function private.raise_report_lock(p_report_no text)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  raise exception 'REPORT_LOCKED:%', p_report_no
    using errcode = 'P0001',
          hint = 'ลบรายงาน active ล่าสุดตามลำดับเพื่อปลดล็อก';
end;
$$;

alter table public.report_batches enable row level security;
alter table public.report_items enable row level security;

create policy "report batches scoped read"
  on public.report_batches for select to authenticated
  using (private.can_manage_reports(location_id));

create policy "report items scoped read"
  on public.report_items for select to authenticated
  using (
    exists (
      select 1
      from public.report_batches b
      where b.id = report_id
        and private.can_manage_reports(b.location_id)
    )
  );

revoke all on public.report_batches, public.report_items from anon, authenticated;
grant select on public.report_batches, public.report_items to authenticated;
grant all on public.report_batches, public.report_items to service_role;

create or replace function private.reportable_items(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns table (
  entity_type text,
  entity_id uuid,
  eligibility_at timestamptz
)
language sql
stable
security definer
set search_path = public, private
as $$
  with candidates(entity_type, entity_id, eligibility_at) as (
    select 'rubber_bill'::text, b.id,
      coalesce(b.server_received_at, b.updated_at, b.created_at)
    from public.rubber_bills b
    where b.location_id = p_location_id
      and b.record_status = 'active'
      and b.sync_status = 'synced'
      and b.server_bill_no is not null

    union all

    select 'ocr_ticket', o.id,
      coalesce(o.server_received_at, o.updated_at, o.created_at)
    from public.ocr_tickets o
    where o.location_id = p_location_id
      and o.record_status = 'active'
      and o.sync_status = 'synced'
      and o.server_received_at is not null

    union all

    select 'income_expense', e.id,
      coalesce(e.server_received_at, e.updated_at, e.created_at)
    from public.income_expense e
    where e.location_id = p_location_id
      and e.record_status = 'active'
      and e.sync_status = 'synced'

    union all

    select 'acid_stock_entry', s.id, coalesce(s.updated_at, s.created_at)
    from public.stock_entries s
    where s.location_id = p_location_id
      and s.record_status = 'active'

    union all

    select 'financial_transaction', f.id,
      coalesce(f.approved_at, f.updated_at, f.created_at)
    from public.financial_transactions f
    where f.status = 'APPROVED'
      and f.cancelled_at is null
      and f.expense_location_id = p_location_id

    union all

    select 'payroll_slip', p.id,
      coalesce(p.approved_at, p.updated_at, p.created_at)
    from public.payroll_slips p
    where p.status = 'APPROVED'
      and p.cancelled_at is null
      and p.expense_location_id = p_location_id

    union all

    select 'bank_transfer_source', m.id,
      coalesce(m.server_received_at, m.updated_at, m.created_at)
    from public.money_transfers m
    where m.location_id = p_location_id
      and m.transfer_method = 'bank'
      and m.record_status = 'active'
      and m.sync_status = 'synced'
      and m.transfer_status in ('paid', 'overpaid', 'branch_and_transfer', 'advance_payment')

    union all

    select 'bank_transfer_target', m.id,
      coalesce(m.server_received_at, m.updated_at, m.created_at)
    from public.money_transfers m
    where m.target_location_id = p_location_id
      and m.location_id <> p_location_id
      and m.transfer_type = 'branch'
      and m.transfer_method = 'bank'
      and m.record_status = 'active'
      and m.sync_status = 'synced'
      and m.transfer_status in ('paid', 'overpaid', 'branch_and_transfer', 'advance_payment')

    union all

    select 'cash_transfer_sent', m.id, d.sent_at
    from public.money_transfers m
    join public.money_transfer_cash_details d on d.transfer_id = m.id
    where m.location_id = p_location_id
      and m.transfer_type = 'cash'
      and m.transfer_method = 'cash'
      and m.record_status = 'active'
      and m.sync_status = 'synced'
      and d.sent_at is not null

    union all

    select 'cash_transfer_received', m.id, d.received_at
    from public.money_transfers m
    join public.money_transfer_cash_details d on d.transfer_id = m.id
    where m.target_location_id = p_location_id
      and m.transfer_type = 'cash'
      and m.transfer_method = 'cash'
      and m.record_status = 'active'
      and m.sync_status = 'synced'
      and d.cash_status in ('received', 'mismatched', 'difference_accepted')
      and d.received_at is not null
  )
  select c.entity_type, c.entity_id, c.eligibility_at
  from candidates c
  where c.eligibility_at <= p_cutoff_at
    and not exists (
      select 1
      from public.report_items i
      where i.location_id = p_location_id
        and i.entity_type = c.entity_type
        and i.entity_id = c.entity_id
        and i.active = true
    );
$$;

create or replace function public.create_report_batch(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_phone text;
  v_cutoff_at timestamptz := clock_timestamp();
  v_report_date date;
  v_sequence_no integer;
  v_report_id uuid;
  v_report_no text;
  v_item_count integer;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายงานของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = v_actor_id;

  v_report_date := (v_cutoff_at at time zone 'Asia/Bangkok')::date;

  select coalesce(max(b.sequence_no), 0) + 1
  into v_sequence_no
  from public.report_batches b
  where b.location_id = p_location_id
    and b.report_date = v_report_date;

  v_report_no :=
    'RPT-' || to_char(v_report_date, 'YYYYMMDD') || '-' ||
    lpad(v_sequence_no::text, 3, '0');

  insert into public.report_batches (
    report_no,
    report_date,
    sequence_no,
    location_id,
    cutoff_at,
    created_by_user_id,
    created_by_name,
    created_by_phone
  )
  values (
    v_report_no,
    v_report_date,
    v_sequence_no,
    p_location_id,
    v_cutoff_at,
    v_actor_id,
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, '')
  )
  returning id into v_report_id;

  insert into public.report_items (
    report_id,
    location_id,
    entity_type,
    entity_id,
    eligibility_at
  )
  select
    v_report_id,
    p_location_id,
    r.entity_type,
    r.entity_id,
    r.eligibility_at
  from private.reportable_items(p_location_id, v_cutoff_at) r
  on conflict do nothing;

  get diagnostics v_item_count = row_count;

  if v_item_count = 0 then
    raise exception 'ไม่มีรายการที่พร้อมออกรายงาน';
  end if;

  return jsonb_build_object(
    'id', v_report_id,
    'reportNo', v_report_no,
    'cutoffAt', v_cutoff_at,
    'itemCount', v_item_count
  );
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
  v_actor_name text;
  v_actor_phone text;
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบรายงานได้';
  end if;

  select *
  into v_report
  from public.report_batches
  where id = p_report_id
  for update;

  if v_report.id is null or v_report.status <> 'active' then
    raise exception 'ไม่พบรายงาน active';
  end if;

  if exists (
    select 1
    from public.report_batches newer
    where newer.location_id = v_report.location_id
      and newer.status = 'active'
      and (newer.created_at, newer.id) > (v_report.created_at, v_report.id)
  ) then
    raise exception 'ลบได้เฉพาะรายงาน active ล่าสุดของสาขา';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.report_batches
  set status = 'deleted',
      deleted_at = clock_timestamp(),
      deleted_by_user_id = auth.uid(),
      deleted_by_name = coalesce(v_actor_name, ''),
      deleted_by_phone = coalesce(v_actor_phone, '')
  where id = p_report_id;

  update public.report_items
  set active = false
  where report_id = p_report_id
    and active = true;

  return jsonb_build_object(
    'id', p_report_id,
    'reportNo', v_report.report_no,
    'status', 'deleted'
  );
end;
$$;

revoke all on function public.create_report_batch(uuid) from public, anon;
revoke all on function public.delete_report_batch(uuid) from public, anon;
grant execute on function public.create_report_batch(uuid) to authenticated;
grant execute on function public.delete_report_batch(uuid) to authenticated;

-- Report-specific projection of the authoritative Income/Expense feed rules.
-- It deliberately returns only the five printable columns.
create or replace function public.get_report_income_expense_rows(p_report_id uuid)
returns table (
  tx_date date,
  number text,
  entry_type text,
  title text,
  amount numeric
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_location_id uuid;
begin
  select b.location_id
  into v_location_id
  from public.report_batches b
  where b.id = p_report_id;

  if v_location_id is null or not private.can_manage_reports(v_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูรายงานนี้';
  end if;

  return query
  with rows as (
    select
      e.tx_date,
      coalesce(e.number, e.server_bill_no, e.local_bill_no) as number,
      e.type::text as entry_type,
      e.title,
      e.cost as amount,
      '10-' || e.id::text as sort_key
    from public.report_items i
    join public.income_expense e on e.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'income_expense'

    union all

    select
      b.bill_date,
      'RB-' || to_char(b.bill_date, 'YYMMDD'),
      'expense',
      'จ่ายค่ายางจากบิลยาง ' || count(*)::text || ' ใบ',
      sum(b.net_total),
      '20-' || b.bill_date::text
    from public.report_items i
    join public.rubber_bills b on b.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'rubber_bill'
      and b.net_total > 0
      and not exists (
        select 1
        from public.money_transfer_items mi
        where mi.source_type = 'rubber_bill'
          and mi.source_id = b.id
      )
    group by b.bill_date

    union all

    select
      o.date_in,
      'OCR-' || to_char(o.date_in, 'YYMMDD'),
      'expense',
      'จ่ายค่ายางจาก OCR บิลยาง ' || count(*)::text || ' ใบ',
      sum(o.total_amount),
      '30-' || o.date_in::text
    from public.report_items i
    join public.ocr_tickets o on o.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'ocr_ticket'
      and o.total_amount > 0
      and not exists (
        select 1
        from public.money_transfer_items mi
        where mi.source_type = 'ocr_ticket'
          and mi.source_id = o.id
      )
    group by o.date_in

    union all

    select
      (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date,
      'TR-' || left(m.id::text, 8),
      'expense',
      'โยกเงินไป ' || coalesce(m.target_location_name, 'สาขาปลายทาง'),
      m.net_amount_to_pay,
      '40-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'bank_transfer_source'
      and m.transfer_type = 'branch'
      and m.location_id <> m.target_location_id
      and m.net_amount_to_pay > 0

    union all

    select
      (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date,
      'CT-' || left(m.id::text, 8),
      'expense',
      'สาขาจ่ายส่วนต่างให้ ' || coalesce(m.customer_name, 'ลูกค้า'),
      m.branch_paid_amount,
      '41-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'bank_transfer_source'
      and m.transfer_type = 'customer'
      and m.transfer_status = 'branch_and_transfer'
      and m.branch_paid_amount > 0

    union all

    select
      (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date,
      'TR-' || left(m.id::text, 8),
      'income',
      'รับโอนจากสาขาต้นทาง',
      m.net_amount_to_pay,
      '42-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'bank_transfer_target'
      and m.net_amount_to_pay > 0

    union all

    select
      (d.sent_at at time zone 'Asia/Bangkok')::date,
      'CASH-' || left(m.id::text, 8),
      'expense',
      'โยกเงินสดไป ' || coalesce(m.target_location_name, 'สาขาปลายทาง'),
      d.sent_total,
      '50-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    join public.money_transfer_cash_details d on d.transfer_id = m.id
    where i.report_id = p_report_id
      and i.entity_type = 'cash_transfer_sent'

    union all

    select
      (d.received_at at time zone 'Asia/Bangkok')::date,
      'CASH-' || left(m.id::text, 8),
      'income',
      'รับเงินสดจากสาขาต้นทาง',
      d.received_total,
      '51-' || m.id::text
    from public.report_items i
    join public.money_transfers m on m.id = i.entity_id
    join public.money_transfer_cash_details d on d.transfer_id = m.id
    where i.report_id = p_report_id
      and i.entity_type = 'cash_transfer_received'

    union all

    select
      (f.approved_at at time zone 'Asia/Bangkok')::date,
      'TW-' || left(f.id::text, 8),
      'expense',
      'เบิกเงิน — ' || coalesce(p.name, 'พนักงาน') ||
        coalesce(': ' || nullif(f.description, ''), ''),
      f.amount,
      '60-' || f.id::text
    from public.report_items i
    join public.financial_transactions f on f.id = i.entity_id
    join public.profiles p on p.id = f.profile_id
    where i.report_id = p_report_id
      and i.entity_type = 'financial_transaction'
      and f.type = 'WITHDRAWAL'
      and f.amount > 0

    union all

    select
      (p.approved_at at time zone 'Asia/Bangkok')::date,
      'PS-' || left(p.id::text, 8),
      'expense',
      'เงินเดือน — ' || coalesce(profile.name, 'พนักงาน') || ' — ' || p.month,
      p.net_pay,
      '61-' || p.id::text
    from public.report_items i
    join public.payroll_slips p on p.id = i.entity_id
    join public.profiles profile on profile.id = p.profile_id
    where i.report_id = p_report_id
      and i.entity_type = 'payroll_slip'
      and p.net_pay > 0
  )
  select r.tx_date, r.number, r.entry_type, r.title, r.amount
  from rows r
  order by r.tx_date, r.sort_key;
end;
$$;

revoke all on function public.get_report_income_expense_rows(uuid) from public, anon;
grant execute on function public.get_report_income_expense_rows(uuid) to authenticated;

-- Generic source lock.
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
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);

  if v_report_no is not null then
    if tg_argv[0] = 'rubber_bill'
      and tg_op = 'UPDATE'
      and (to_jsonb(new) - array['print_status', 'updated_at'])
          = (to_jsonb(old) - array['print_status', 'updated_at']) then
      return new;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger report_lock_rubber_bills
  before update or delete on public.rubber_bills
  for each row execute function private.guard_reported_entity('rubber_bill');

create trigger report_lock_ocr_tickets
  before update or delete on public.ocr_tickets
  for each row execute function private.guard_reported_entity('ocr_ticket');

create trigger report_lock_income_expense
  before update or delete on public.income_expense
  for each row execute function private.guard_reported_entity('income_expense');

create trigger report_lock_stock_entries
  before update or delete on public.stock_entries
  for each row execute function private.guard_reported_entity('acid_stock_entry');

create trigger report_lock_time_segments
  before update or delete on public.time_segments
  for each row execute function private.guard_reported_entity('time_segment');

create trigger report_lock_leave_requests
  before update or delete on public.leave_requests
  for each row execute function private.guard_reported_entity('leave_request');

create trigger report_lock_financial_transactions
  before update or delete on public.financial_transactions
  for each row execute function private.guard_reported_entity('financial_transaction');

create trigger report_lock_payroll_slips
  before update or delete on public.payroll_slips
  for each row execute function private.guard_reported_entity('payroll_slip');

create or replace function private.guard_reported_rubber_item()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_bill_id uuid := case when tg_op = 'DELETE' then old.bill_id else new.bill_id end;
  v_report_no text;
begin
  v_report_no := private.active_report_no('rubber_bill', v_bill_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger report_lock_rubber_bill_items
  before insert or update or delete on public.rubber_bill_items
  for each row execute function private.guard_reported_rubber_item();

create or replace function private.guard_reported_money_transfer()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_report_no text;
begin
  v_report_no := private.active_transfer_report_no(
    case when tg_op = 'DELETE' then old.id else new.id end
  );

  if v_report_no is not null then
    if tg_op = 'UPDATE'
      and old.transfer_method = 'cash'
      and (to_jsonb(new) - array['transfer_status', 'revision_no', 'updated_at'])
          = (to_jsonb(old) - array['transfer_status', 'revision_no', 'updated_at']) then
      return new;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger report_lock_money_transfers
  before update or delete on public.money_transfers
  for each row execute function private.guard_reported_money_transfer();

create or replace function private.guard_reported_cash_details()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_sent_report text;
  v_received_report text;
begin
  v_sent_report := private.active_report_no('cash_transfer_sent', old.transfer_id);
  v_received_report := private.active_report_no('cash_transfer_received', old.transfer_id);

  if tg_op = 'DELETE' then
    if v_sent_report is not null then perform private.raise_report_lock(v_sent_report); end if;
    if v_received_report is not null then perform private.raise_report_lock(v_received_report); end if;
    return old;
  end if;

  if v_sent_report is not null and (
    new.sent_coin_1_count,
    new.sent_coin_2_count,
    new.sent_coin_5_count,
    new.sent_coin_10_count,
    new.sent_banknote_20_count,
    new.sent_banknote_50_count,
    new.sent_banknote_100_count,
    new.sent_banknote_500_count,
    new.sent_banknote_1000_count,
    new.note,
    new.sent_at
  ) is distinct from (
    old.sent_coin_1_count,
    old.sent_coin_2_count,
    old.sent_coin_5_count,
    old.sent_coin_10_count,
    old.sent_banknote_20_count,
    old.sent_banknote_50_count,
    old.sent_banknote_100_count,
    old.sent_banknote_500_count,
    old.sent_banknote_1000_count,
    old.note,
    old.sent_at
  ) then
    perform private.raise_report_lock(v_sent_report);
  end if;

  if v_received_report is not null and (
    new.received_coin_1_count,
    new.received_coin_2_count,
    new.received_coin_5_count,
    new.received_coin_10_count,
    new.received_banknote_20_count,
    new.received_banknote_50_count,
    new.received_banknote_100_count,
    new.received_banknote_500_count,
    new.received_banknote_1000_count,
    new.received_by_user_id,
    new.received_by_name,
    new.received_by_phone,
    new.received_at
  ) is distinct from (
    old.received_coin_1_count,
    old.received_coin_2_count,
    old.received_coin_5_count,
    old.received_coin_10_count,
    old.received_banknote_20_count,
    old.received_banknote_50_count,
    old.received_banknote_100_count,
    old.received_banknote_500_count,
    old.received_banknote_1000_count,
    old.received_by_user_id,
    old.received_by_name,
    old.received_by_phone,
    old.received_at
  ) then
    perform private.raise_report_lock(v_received_report);
  end if;

  return new;
end;
$$;

create trigger report_lock_money_transfer_cash_details
  before update or delete on public.money_transfer_cash_details
  for each row execute function private.guard_reported_cash_details();

create or replace function private.guard_reported_transfer_child()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transfer_id uuid;
  v_report_no text;
begin
  v_transfer_id := case when tg_op = 'DELETE' then old.transfer_id else new.transfer_id end;
  v_report_no := private.active_transfer_report_no(v_transfer_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger report_lock_money_transfer_slips
  before insert or update or delete on public.money_transfer_slips
  for each row execute function private.guard_reported_transfer_child();

create or replace function private.guard_reported_transfer_item()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transfer_id uuid;
  v_source_type text;
  v_source_id uuid;
  v_report_no text;
begin
  v_transfer_id := case when tg_op = 'DELETE' then old.transfer_id else new.transfer_id end;
  v_source_type := case when tg_op = 'DELETE' then old.source_type else new.source_type end;
  v_source_id := case when tg_op = 'DELETE' then old.source_id else new.source_id end;

  v_report_no := private.active_transfer_report_no(v_transfer_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  v_report_no := private.active_report_no(v_source_type, v_source_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger report_lock_money_transfer_items
  before insert or update or delete on public.money_transfer_items
  for each row execute function private.guard_reported_transfer_item();
