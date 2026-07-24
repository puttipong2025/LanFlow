-- Rubber Export is an online-only, source-owned expense.
-- Active item rows reserve report-locked rubber bills.

alter table public.report_items
  drop constraint report_items_entity_type_check;

alter table public.report_items
  add constraint report_items_entity_type_check check (entity_type in (
    'rubber_bill',
    'rubber_export',
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
  ));

create table public.rubber_exports (
  id uuid primary key default gen_random_uuid(),
  export_no text not null,
  export_date date not null,
  sequence_no integer not null check (sequence_no > 0),
  location_id uuid not null references public.locations(id),
  cutoff_at timestamptz not null,
  cutoff_report_item_id uuid not null references public.report_items(id),
  status text not null default 'draft' check (status in ('draft', 'verified', 'deleted')),
  previous_status text check (previous_status in ('draft', 'verified')),
  original_weight_total numeric(14,2) not null check (original_weight_total > 0),
  paid_total numeric(14,2) not null check (paid_total > 0),
  average_price numeric(14,2) not null check (average_price > 0),
  current_weight numeric(14,2),
  weight_loss_percent numeric(8,2),
  work_rate numeric(14,2),
  other_operating_cost numeric(14,2) not null default 0,
  work_total numeric(14,2),
  expense_destination text check (expense_destination in ('branch', 'external')),
  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null,
  created_by_phone text not null,
  created_at timestamptz not null default now(),
  verified_by_user_id uuid references public.profiles(id),
  verified_by_name text,
  verified_by_phone text,
  verified_at timestamptz,
  deleted_by_user_id uuid references public.profiles(id),
  deleted_by_name text,
  deleted_by_phone text,
  deleted_at timestamptz,
  unique (location_id, export_date, sequence_no),
  unique (location_id, export_no),
  check (current_weight is null or (current_weight > 0 and current_weight <= original_weight_total)),
  check (weight_loss_percent is null or weight_loss_percent >= 0),
  check (work_rate is null or work_rate >= 0),
  check (other_operating_cost >= 0),
  check (work_total is null or work_total >= 0),
  check (
    (status = 'draft' and previous_status is null and verified_at is null and expense_destination is null)
    or
    (
      status = 'verified'
      and previous_status is null
      and current_weight is not null
      and work_rate is not null
      and work_total is not null
      and expense_destination is not null
      and verified_by_user_id is not null
      and verified_at is not null
    )
    or
    (status = 'deleted' and previous_status is not null and deleted_by_user_id is not null and deleted_at is not null)
  )
);

create table public.rubber_export_items (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.rubber_exports(id),
  location_id uuid not null references public.locations(id),
  source_report_item_id uuid not null references public.report_items(id),
  source_bill_id uuid not null references public.rubber_bills(id),
  bill_date date not null,
  bill_no text not null,
  customer_name text not null,
  eligibility_at timestamptz not null,
  net_weight numeric(14,2) not null check (net_weight > 0),
  paid_amount numeric(14,2) not null check (paid_amount > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (export_id, source_bill_id)
);

create unique index rubber_export_items_one_active_bill
  on public.rubber_export_items(location_id, source_bill_id)
  where active = true;

create index rubber_exports_location_history
  on public.rubber_exports(location_id, created_at desc, id desc);

create index rubber_exports_report_candidates
  on public.rubber_exports(location_id, verified_at, id)
  where status = 'verified' and expense_destination = 'branch' and work_total > 0;

create index rubber_export_items_source_report
  on public.rubber_export_items(source_report_item_id)
  where active = true;

alter table public.rubber_exports enable row level security;
alter table public.rubber_export_items enable row level security;

create policy "rubber exports scoped read"
  on public.rubber_exports for select to authenticated
  using (private.can_manage_reports(location_id));

create policy "rubber export items scoped read"
  on public.rubber_export_items for select to authenticated
  using (
    exists (
      select 1
      from public.rubber_exports e
      where e.id = export_id
        and private.can_manage_reports(e.location_id)
    )
  );

revoke all on public.rubber_exports, public.rubber_export_items from anon, authenticated;
grant select on public.rubber_exports, public.rubber_export_items to authenticated;
grant all on public.rubber_exports, public.rubber_export_items to service_role;

create or replace function private.rubber_export_candidates(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns table (
  report_item_id uuid,
  bill_id uuid,
  bill_date date,
  bill_no text,
  customer_name text,
  eligibility_at timestamptz,
  net_weight numeric,
  paid_amount numeric
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    i.id,
    b.id,
    b.bill_date,
    coalesce(b.server_bill_no, nullif(b.local_bill_no, ''), nullif(b.bill_no, ''), left(b.id::text, 8)),
    coalesce(b.customer_name, ''),
    i.eligibility_at,
    round(b.weight - b.deduct_weight, 2),
    round(b.net_total, 2)
  from public.report_items i
  join public.report_batches r on r.id = i.report_id
  join public.rubber_bills b on b.id = i.entity_id
  where i.location_id = p_location_id
    and i.entity_type = 'rubber_bill'
    and i.active = true
    and i.eligibility_at <= p_cutoff_at
    and r.status = 'active'
    and b.location_id = p_location_id
    and b.record_status = 'active'
    and not exists (
      select 1
      from public.rubber_export_items x
      where x.location_id = p_location_id
        and x.source_bill_id = b.id
        and x.active = true
    )
  order by i.eligibility_at, b.id;
$$;

create or replace function public.get_rubber_export_cutoff_options(p_location_id uuid)
returns table (
  report_item_id uuid,
  bill_id uuid,
  bill_date date,
  bill_no text,
  customer_name text,
  eligibility_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูบิลส่งออกของสาขานี้';
  end if;

  return query
  select
    c.report_item_id,
    c.bill_id,
    c.bill_date,
    c.bill_no,
    c.customer_name,
    c.eligibility_at
  from private.rubber_export_candidates(p_location_id, 'infinity'::timestamptz) c;
end;
$$;

create or replace function private.validate_rubber_export_candidates(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_invalid text;
begin
  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id)
  into v_invalid
  from private.rubber_export_candidates(p_location_id, p_cutoff_at) c
  where c.net_weight <= 0 or c.paid_amount <= 0;

  if v_invalid is not null then
    raise exception 'INVALID_RUBBER_BILL:%', v_invalid
      using errcode = 'P0001',
            hint = 'น้ำหนักสุทธิหลังหักและยอดจ่ายจริงต้องมากกว่า 0';
  end if;
end;
$$;

create or replace function public.preview_rubber_export(
  p_location_id uuid,
  p_cutoff_report_item_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_cutoff_at timestamptz;
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
  v_items jsonb;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;

  select c.eligibility_at
  into v_cutoff_at
  from private.rubber_export_candidates(p_location_id, 'infinity'::timestamptz) c
  where c.report_item_id = p_cutoff_report_item_id;

  if v_cutoff_at is null then
    raise exception 'บิล cutoff ไม่พร้อมใช้งานหรือถูกจองแล้ว';
  end if;

  perform private.validate_rubber_export_candidates(p_location_id, v_cutoff_at);

  select
    count(*)::integer,
    round(sum(c.net_weight), 2),
    round(sum(c.paid_amount), 2),
    jsonb_agg(jsonb_build_object(
      'reportItemId', c.report_item_id,
      'billId', c.bill_id,
      'billDate', c.bill_date,
      'billNo', c.bill_no,
      'customerName', c.customer_name,
      'eligibilityAt', c.eligibility_at,
      'netWeight', c.net_weight,
      'paidAmount', c.paid_amount
    ) order by c.eligibility_at, c.bill_id)
  into v_item_count, v_original_weight, v_paid_total, v_items
  from private.rubber_export_candidates(p_location_id, v_cutoff_at) c;

  if coalesce(v_item_count, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;

  return jsonb_build_object(
    'cutoffAt', v_cutoff_at,
    'itemCount', v_item_count,
    'originalWeightTotal', v_original_weight,
    'paidTotal', v_paid_total,
    'averagePrice', round(v_paid_total / v_original_weight, 2),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_rubber_export(
  p_location_id uuid,
  p_cutoff_report_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
  v_export_date date;
  v_sequence_no integer;
  v_export_no text;
  v_export_id uuid;
  v_cutoff_at timestamptz;
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || p_location_id::text, 0));

  select c.eligibility_at
  into v_cutoff_at
  from private.rubber_export_candidates(p_location_id, 'infinity'::timestamptz) c
  where c.report_item_id = p_cutoff_report_item_id;

  if v_cutoff_at is null then
    raise exception 'บิล cutoff ไม่พร้อมใช้งานหรือถูกจองแล้ว';
  end if;

  perform private.validate_rubber_export_candidates(p_location_id, v_cutoff_at);

  select count(*)::integer, round(sum(c.net_weight), 2), round(sum(c.paid_amount), 2)
  into v_item_count, v_original_weight, v_paid_total
  from private.rubber_export_candidates(p_location_id, v_cutoff_at) c;

  if coalesce(v_item_count, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = v_actor_id;

  v_export_date := (v_now at time zone 'Asia/Bangkok')::date;

  select coalesce(max(e.sequence_no), 0) + 1
  into v_sequence_no
  from public.rubber_exports e
  where e.location_id = p_location_id
    and e.export_date = v_export_date;

  v_export_no := 'REX-' || to_char(v_export_date, 'YYYYMMDD') || '-' ||
    lpad(v_sequence_no::text, 3, '0');

  insert into public.rubber_exports (
    export_no,
    export_date,
    sequence_no,
    location_id,
    cutoff_at,
    cutoff_report_item_id,
    original_weight_total,
    paid_total,
    average_price,
    created_by_user_id,
    created_by_name,
    created_by_phone,
    created_at
  )
  values (
    v_export_no,
    v_export_date,
    v_sequence_no,
    p_location_id,
    v_cutoff_at,
    p_cutoff_report_item_id,
    v_original_weight,
    v_paid_total,
    round(v_paid_total / v_original_weight, 2),
    v_actor_id,
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, ''),
    v_now
  )
  returning id into v_export_id;

  insert into public.rubber_export_items (
    export_id,
    location_id,
    source_report_item_id,
    source_bill_id,
    bill_date,
    bill_no,
    customer_name,
    eligibility_at,
    net_weight,
    paid_amount
  )
  select
    v_export_id,
    p_location_id,
    c.report_item_id,
    c.bill_id,
    c.bill_date,
    c.bill_no,
    c.customer_name,
    c.eligibility_at,
    c.net_weight,
    c.paid_amount
  from private.rubber_export_candidates(p_location_id, v_cutoff_at) c;

  get diagnostics v_item_count = row_count;

  return jsonb_build_object(
    'id', v_export_id,
    'exportNo', v_export_no,
    'cutoffAt', v_cutoff_at,
    'itemCount', v_item_count
  );
end;
$$;

create or replace function public.update_rubber_export(
  p_export_id uuid,
  p_current_weight numeric,
  p_work_rate numeric,
  p_other_operating_cost numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_other numeric := coalesce(p_other_operating_cost, 0);
  v_loss numeric;
  v_total numeric;
begin
  select *
  into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการส่งออกนี้';
  end if;
  if v_export.status <> 'draft' then
    raise exception 'แก้ไขได้เฉพาะรายการฉบับร่าง';
  end if;
  if p_current_weight is not null
    and (p_current_weight <= 0 or p_current_weight > v_export.original_weight_total) then
    raise exception 'น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกินน้ำหนักสุทธิหลังหักรวม';
  end if;
  if p_work_rate is not null and p_work_rate < 0 then
    raise exception 'ค่าทำงานต้องไม่ติดลบ';
  end if;
  if v_other < 0 then
    raise exception 'ค่าดำเนินการอื่นต้องไม่ติดลบ';
  end if;

  v_loss := case when p_current_weight is null then null
    else round((v_export.original_weight_total - p_current_weight) /
      v_export.original_weight_total * 100, 2)
  end;
  v_total := case when p_current_weight is null or p_work_rate is null then null
    else round(p_current_weight * p_work_rate + v_other, 2)
  end;

  update public.rubber_exports
  set current_weight = p_current_weight,
      weight_loss_percent = v_loss,
      work_rate = p_work_rate,
      other_operating_cost = v_other,
      work_total = v_total
  where id = p_export_id;

  return jsonb_build_object(
    'id', p_export_id,
    'status', 'draft',
    'weightLossPercent', v_loss,
    'workTotal', v_total
  );
end;
$$;

create or replace function public.verify_rubber_export(
  p_export_id uuid,
  p_expense_destination text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ตรวจสอบได้';
  end if;
  if p_expense_destination not in ('branch', 'external') then
    raise exception 'กรุณาเลือกปลายทางค่าใช้จ่าย';
  end if;

  select *
  into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null then
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if v_export.status = 'verified' then
    if v_export.expense_destination = p_expense_destination then
      return jsonb_build_object('id', p_export_id, 'status', 'verified');
    end if;
    raise exception 'รายการนี้ตรวจสอบแล้วด้วยปลายทางค่าใช้จ่ายอื่น';
  end if;
  if v_export.status <> 'draft' then
    raise exception 'ตรวจสอบได้เฉพาะรายการฉบับร่าง';
  end if;
  if v_export.current_weight is null or v_export.work_rate is null then
    raise exception 'กรุณากรอกน้ำหนักปัจจุบันและค่าทำงานก่อนตรวจสอบ';
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.rubber_exports
  set status = 'verified',
      expense_destination = p_expense_destination,
      weight_loss_percent = round(
        (original_weight_total - current_weight) / original_weight_total * 100,
        2
      ),
      work_total = round(current_weight * work_rate + other_operating_cost, 2),
      verified_by_user_id = auth.uid(),
      verified_by_name = coalesce(v_actor_name, ''),
      verified_by_phone = coalesce(v_actor_phone, ''),
      verified_at = v_now
  where id = p_export_id;

  return jsonb_build_object(
    'id', p_export_id,
    'status', 'verified',
    'verifiedAt', v_now
  );
end;
$$;

create or replace function public.delete_rubber_export(p_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_report_no text;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ลบได้';
  end if;

  select *
  into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null then
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if v_export.status = 'deleted' then
    return jsonb_build_object('id', p_export_id, 'status', 'deleted');
  end if;

  v_report_no := private.active_report_no('rubber_export', p_export_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  select p.name, p.phone
  into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.rubber_exports
  set status = 'deleted',
      previous_status = v_export.status,
      deleted_by_user_id = auth.uid(),
      deleted_by_name = coalesce(v_actor_name, ''),
      deleted_by_phone = coalesce(v_actor_phone, ''),
      deleted_at = v_now
  where id = p_export_id;

  update public.rubber_export_items
  set active = false
  where export_id = p_export_id
    and active = true;

  return jsonb_build_object(
    'id', p_export_id,
    'exportNo', v_export.export_no,
    'status', 'deleted'
  );
end;
$$;

create or replace function private.guard_rubber_export_state()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.status = 'deleted' then
    raise exception 'รายการส่งออกที่ลบแล้วแก้ไขไม่ได้';
  end if;
  if old.status = 'verified' and new.status <> 'deleted' then
    raise exception 'รายการส่งออกที่ตรวจสอบแล้วแก้ไขไม่ได้';
  end if;
  if (
    new.export_no,
    new.export_date,
    new.sequence_no,
    new.location_id,
    new.cutoff_at,
    new.cutoff_report_item_id,
    new.original_weight_total,
    new.paid_total,
    new.average_price,
    new.created_by_user_id,
    new.created_at
  ) is distinct from (
    old.export_no,
    old.export_date,
    old.sequence_no,
    old.location_id,
    old.cutoff_at,
    old.cutoff_report_item_id,
    old.original_weight_total,
    old.paid_total,
    old.average_price,
    old.created_by_user_id,
    old.created_at
  ) then
    raise exception 'ข้อมูล cutoff และ snapshot ของรายการส่งออกแก้ไขไม่ได้';
  end if;
  return new;
end;
$$;

create trigger guard_rubber_export_state
  before update on public.rubber_exports
  for each row execute function private.guard_rubber_export_state();

create trigger report_lock_rubber_exports
  before update or delete on public.rubber_exports
  for each row execute function private.guard_reported_entity('rubber_export');

create or replace function public.report_lock_no(source_row public.rubber_exports)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select private.active_report_no('rubber_export', source_row.id);
$$;

create or replace function private.active_rubber_export_no_for_report(p_report_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select e.export_no
  from public.rubber_export_items x
  join public.rubber_exports e on e.id = x.export_id
  join public.report_items i on i.id = x.source_report_item_id
  where i.report_id = p_report_id
    and i.active = true
    and x.active = true
    and e.status in ('draft', 'verified')
  order by e.created_at, e.id
  limit 1;
$$;

create or replace function public.rubber_export_lock_no(source_row public.report_batches)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select private.active_rubber_export_no_for_report(source_row.id);
$$;

revoke all on function public.report_lock_no(public.rubber_exports),
  public.rubber_export_lock_no(public.report_batches)
from public, anon;

grant execute on function public.report_lock_no(public.rubber_exports),
  public.rubber_export_lock_no(public.report_batches)
to authenticated, service_role;

create or replace function public.delete_report_batch(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_report public.report_batches%rowtype;
  v_export_no text;
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

  perform pg_advisory_xact_lock(
    hashtextextended('rubber-export:' || v_report.location_id::text, 0)
  );

  if exists (
    select 1
    from public.report_batches newer
    where newer.location_id = v_report.location_id
      and newer.status = 'active'
      and (newer.created_at, newer.id) > (v_report.created_at, v_report.id)
  ) then
    raise exception 'ลบได้เฉพาะรายงาน active ล่าสุดของสาขา';
  end if;

  v_export_no := private.active_rubber_export_no_for_report(p_report_id);
  if v_export_no is not null then
    raise exception 'RUBBER_EXPORT_LOCKED:%', v_export_no
      using errcode = 'P0001',
            hint = 'ลบรายการส่งออกยางก่อนจึงจะลบรายงานได้';
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

-- Extend report candidates with verified branch expenses.
do $$
declare
  v_definition text;
  v_anchor text := $anchor$
    union all

    select 'bank_transfer_source', m.id,$anchor$;
  v_export_union text := $export$
    union all

    select 'rubber_export', e.id, e.verified_at
    from public.rubber_exports e
    where e.location_id = p_location_id
      and e.status = 'verified'
      and e.expense_destination = 'branch'
      and e.work_total > 0
      and e.verified_at is not null

$export$;
begin
  select pg_get_functiondef(
    'private.reportable_items(uuid, timestamptz)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate reportable items insertion point';
  end if;

  v_definition := replace(v_definition, v_anchor, v_export_union || v_anchor);
  execute v_definition;
end;
$$;

-- Extend the authoritative Income/Expense feed without copying rows.
do $$
declare
  v_definition text;
  v_anchor text := $anchor$
      union all

      select rb.bill_date, 'rubber:' || rb.bill_date::text,$anchor$;
  v_export_union text := $export$
      union all

      select (e.verified_at at time zone 'Asia/Bangkok')::date,
        'rubber-export-expense:' || e.id::text,
        jsonb_build_object(
          'id', 'rubber-export-expense:' || e.id,
          'clientTempId', 'rubber-export-expense:' || e.id,
          'localBillNo', e.export_no,
          'serverBillNo', e.export_no,
          'idempotencyKey', 'rubber-export-expense:' || e.id,
          'locationId', e.location_id,
          'syncStatus', 'synced',
          'recordStatus', 'active',
          'type', 'expense',
          'number', e.export_no,
          'txDate', (e.verified_at at time zone 'Asia/Bangkok')::date,
          'title', 'ค่าทำงานส่งออกยาง — ' || e.export_no,
          'cost', e.work_total,
          'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', e.verified_at,
          'clientCreatedAt', e.created_at,
          'serverReceivedAt', e.verified_at,
          'revisionNo', 1,
          'createdByUserId', e.created_by_user_id,
          'createdByName', e.created_by_name,
          'createdByPhone', e.created_by_phone,
          'relationSourceType', 'rubber_export',
          'relationSourceId', e.id,
          'relationSourceLocationId', e.location_id,
          'relationLabel', 'ส่งออกยาง',
          'relationLockReason', 'รายการนี้มาจากรายการส่งออกยาง ต้องเปิดหรือจัดการที่โมดูลส่งออกยางต้นทาง'
        )
      from public.rubber_exports e
      where e.location_id = p_location_id
        and e.status = 'verified'
        and e.expense_destination = 'branch'
        and e.work_total > 0
        and (e.verified_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date
$export$;
begin
  select pg_get_functiondef(
    'public.get_income_expense_feed(uuid, date, date, date, text, integer)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate Income/Expense feed insertion point';
  end if;

  v_definition := replace(v_definition, v_anchor, v_export_union || v_anchor);
  execute v_definition;
end;
$$;

-- Include the source-owned expense in report detail rows.
do $$
declare
  v_definition text;
  v_anchor text := $anchor$
    union all

    select
      (f.approved_at at time zone 'Asia/Bangkok')::date,$anchor$;
  v_export_union text := $export$
    union all

    select
      (e.verified_at at time zone 'Asia/Bangkok')::date,
      e.export_no,
      'expense',
      'ค่าทำงานส่งออกยาง — ' || e.export_no,
      e.work_total,
      '55-' || e.id::text
    from public.report_items i
    join public.rubber_exports e on e.id = i.entity_id
    where i.report_id = p_report_id
      and i.entity_type = 'rubber_export'
      and e.work_total > 0

$export$;
begin
  select pg_get_functiondef(
    'public.get_report_income_expense_rows(uuid)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate report detail insertion point';
  end if;

  v_definition := replace(v_definition, v_anchor, v_export_union || v_anchor);
  execute v_definition;
end;
$$;

revoke all on function public.get_rubber_export_cutoff_options(uuid),
  public.preview_rubber_export(uuid, uuid),
  public.create_rubber_export(uuid, uuid),
  public.update_rubber_export(uuid, numeric, numeric, numeric),
  public.verify_rubber_export(uuid, text),
  public.delete_rubber_export(uuid)
from public, anon;

grant execute on function public.get_rubber_export_cutoff_options(uuid),
  public.preview_rubber_export(uuid, uuid),
  public.create_rubber_export(uuid, uuid),
  public.update_rubber_export(uuid, numeric, numeric, numeric),
  public.verify_rubber_export(uuid, text),
  public.delete_rubber_export(uuid)
to authenticated;
