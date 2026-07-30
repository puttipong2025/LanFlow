alter table public.report_batches
  add column previous_report_id uuid references public.report_batches(id),
  add column opening_balance numeric not null default 0,
  add column closing_balance numeric not null default 0;

create or replace function private.report_income_expense_period_rows(p_report_id uuid)
returns table (
  tx_date date,
  number text,
  entry_type text,
  title text,
  amount numeric,
  sort_key text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    e.tx_date,
    coalesce(e.number, e.server_bill_no, e.local_bill_no),
    e.type::text,
    e.title,
    e.cost,
    '10-' || e.id::text
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
    and p.net_pay > 0;
$$;

revoke all on function private.report_income_expense_period_rows(uuid) from public, anon, authenticated;

do $$
declare
  v_location record;
  v_report record;
  v_previous_report_id uuid;
  v_running_balance numeric;
  v_period_balance numeric;
begin
  for v_location in
    select distinct b.location_id
    from public.report_batches b
    where b.status = 'active'
  loop
    v_previous_report_id := null;
    v_running_balance := 0;

    for v_report in
      select b.id
      from public.report_batches b
      where b.location_id = v_location.location_id
        and b.status = 'active'
      order by b.created_at, b.id
    loop
      select coalesce(sum(
        case when r.entry_type = 'income' then r.amount else -r.amount end
      ), 0)
      into v_period_balance
      from private.report_income_expense_period_rows(v_report.id) r;

      update public.report_batches
      set previous_report_id = v_previous_report_id,
          opening_balance = v_running_balance,
          closing_balance = v_running_balance + v_period_balance
      where id = v_report.id;

      v_previous_report_id := v_report.id;
      v_running_balance := v_running_balance + v_period_balance;
    end loop;
  end loop;
end;
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
  v_previous_report_id uuid;
  v_opening_balance numeric := 0;
  v_period_balance numeric := 0;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายงานของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));

  if exists (
    select 1
    from private.rubber_bill_report_blockers(p_location_id, v_cutoff_at)
  ) then
    raise exception 'RUBBER_BILL_PENDING: ยังมีงานบิลยางที่ต้องจัดการก่อนสร้างรายงาน';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = v_actor_id;

  select b.id, b.closing_balance
  into v_previous_report_id, v_opening_balance
  from public.report_batches b
  where b.location_id = p_location_id
    and b.status = 'active'
  order by b.created_at desc, b.id desc
  limit 1;

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
    previous_report_id,
    opening_balance,
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
    v_previous_report_id,
    coalesce(v_opening_balance, 0),
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

  select coalesce(sum(
    case when r.entry_type = 'income' then r.amount else -r.amount end
  ), 0)
  into v_period_balance
  from private.report_income_expense_period_rows(v_report_id) r;

  update public.report_batches
  set closing_balance = coalesce(v_opening_balance, 0) + v_period_balance
  where id = v_report_id;

  return jsonb_build_object(
    'id', v_report_id,
    'reportNo', v_report_no,
    'cutoffAt', v_cutoff_at,
    'itemCount', v_item_count
  );
end;
$$;

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
  v_report public.report_batches%rowtype;
begin
  select b.*
  into v_report
  from public.report_batches b
  where b.id = p_report_id;

  if v_report.id is null or not private.can_manage_reports(v_report.location_id) then
    raise exception 'ไม่มีสิทธิ์ดูรายงานนี้';
  end if;

  return query
  with rows as (
    select
      0 as row_order,
      (previous.cutoff_at at time zone 'Asia/Bangkok')::date as tx_date,
      previous.report_no as number,
      case when v_report.opening_balance >= 0 then 'income' else 'expense' end as entry_type,
      'ยอดยกมา'::text as title,
      abs(v_report.opening_balance) as amount,
      '00-opening-balance'::text as sort_key
    from public.report_batches previous
    where previous.id = v_report.previous_report_id

    union all

    select
      1,
      period.tx_date,
      period.number,
      period.entry_type,
      period.title,
      period.amount,
      period.sort_key
    from private.report_income_expense_period_rows(p_report_id) period
  )
  select
    rows.tx_date,
    rows.number,
    rows.entry_type,
    rows.title,
    rows.amount
  from rows
  order by rows.row_order, rows.tx_date, rows.sort_key;
end;
$$;

revoke all on function public.create_report_batch(uuid) from public, anon;
revoke all on function public.get_report_income_expense_rows(uuid) from public, anon;
grant execute on function public.create_report_batch(uuid) to authenticated;
grant execute on function public.get_report_income_expense_rows(uuid) to authenticated;
