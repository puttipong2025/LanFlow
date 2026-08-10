-- Hard-delete unlocked Report, Rubber Export, and Cash Count aggregates.
-- Preserve only minimal audit metadata and durable document numbering.

create table private.document_number_counters (
  document_kind text not null check (document_kind in ('RPT', 'REX')),
  location_id uuid not null references public.locations(id),
  document_date date not null,
  last_sequence_no integer not null check (last_sequence_no > 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (document_kind, location_id, document_date)
);

revoke all on table private.document_number_counters from public, anon, authenticated;
grant all on table private.document_number_counters to service_role;

insert into private.document_number_counters (
  document_kind, location_id, document_date, last_sequence_no
)
select 'RPT', location_id, report_date, max(sequence_no)
from public.report_batches
group by location_id, report_date
on conflict (document_kind, location_id, document_date)
do update set
  last_sequence_no = greatest(
    private.document_number_counters.last_sequence_no,
    excluded.last_sequence_no
  ),
  updated_at = clock_timestamp();

insert into private.document_number_counters (
  document_kind, location_id, document_date, last_sequence_no
)
select 'REX', location_id, export_date, max(sequence_no)
from public.rubber_exports
group by location_id, export_date
on conflict (document_kind, location_id, document_date)
do update set
  last_sequence_no = greatest(
    private.document_number_counters.last_sequence_no,
    excluded.last_sequence_no
  ),
  updated_at = clock_timestamp();

create or replace function private.next_document_sequence(
  p_document_kind text,
  p_location_id uuid,
  p_document_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence integer;
begin
  if p_document_kind not in ('RPT', 'REX')
     or p_location_id is null
     or p_document_date is null then
    raise exception 'Invalid document sequence request';
  end if;

  insert into private.document_number_counters (
    document_kind, location_id, document_date, last_sequence_no, updated_at
  )
  values (p_document_kind, p_location_id, p_document_date, 1, clock_timestamp())
  on conflict (document_kind, location_id, document_date)
  do update set
    last_sequence_no = private.document_number_counters.last_sequence_no + 1,
    updated_at = clock_timestamp()
  returning last_sequence_no into v_sequence;

  return v_sequence;
end;
$$;

revoke all on function private.next_document_sequence(text, uuid, date)
  from public, anon, authenticated;

create table public.document_deletion_audits (
  id uuid primary key default gen_random_uuid(),
  document_kind text not null check (
    document_kind in ('report_batch', 'rubber_export', 'cash_count')
  ),
  source_id uuid not null,
  paired_source_id uuid,
  document_no text not null,
  location_id uuid not null references public.locations(id),
  previous_status text check (previous_status in ('draft', 'verified')),
  original_actor_user_id uuid,
  original_actor_name text,
  deleted_by_user_id uuid not null,
  deleted_by_name text not null,
  deleted_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (document_kind, source_id),
  check (
    (document_kind = 'rubber_export' and previous_status is not null)
    or (document_kind <> 'rubber_export' and previous_status is null)
  ),
  check (
    (document_kind = 'cash_count' and paired_source_id is not null)
    or (document_kind <> 'cash_count' and paired_source_id is null)
  )
);

create index document_deletion_audits_location_kind_time
  on public.document_deletion_audits (
    location_id, document_kind, deleted_at desc, id desc
  );

alter table public.document_deletion_audits enable row level security;

create policy document_deletion_audits_select_scope
  on public.document_deletion_audits
  for select
  to authenticated
  using (
    private.can_manage_reports(location_id)
    and (
      document_kind <> 'cash_count'
      or private.can_delete_reports()
    )
  );

revoke all on table public.document_deletion_audits
  from public, anon, authenticated;
grant select on table public.document_deletion_audits to authenticated;
grant all on table public.document_deletion_audits to service_role;

alter table public.rubber_bills
  drop constraint if exists rubber_bills_branch_receipt_shape_check;

alter table public.rubber_bills
  add constraint rubber_bills_branch_receipt_shape_check check (
    (
      source_rubber_export_id is null
      and source_export_no is null
      and received_at is null
      and received_age_hours is null
      and received_age_is_estimated is null
    )
    or (
      nullif(btrim(source_export_no), '') is not null
      and received_at is not null
      and received_age_hours is not null
      and received_age_hours >= 0
      and received_age_is_estimated is not null
      and net_total = 0
      and rubber_value > 0
      and deduction_total = net_rubber_value
      and (
        source_rubber_export_id is not null
        or record_status = 'deleted'
      )
    )
  );

create or replace function private.guard_branch_receipt_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source_rubber_export_id is null then
    return new;
  end if;

  if old.record_status = 'active' and new.record_status = 'deleted' then
    if new.source_export_no is distinct from old.source_export_no
       or new.received_at is distinct from old.received_at
       or new.received_age_hours is distinct from old.received_age_hours
       or new.received_age_is_estimated is distinct from old.received_age_is_estimated then
      raise exception 'บิลรับยางจากสาขาแก้ไขข้อมูลต้นทางไม่ได้';
    end if;
    new.source_rubber_export_id := null;
    return new;
  end if;

  if old.record_status = 'deleted'
     and new.record_status = 'deleted'
     and new.source_rubber_export_id is null
     and new.source_export_no is not distinct from old.source_export_no
     and new.received_at is not distinct from old.received_at
     and new.received_age_hours is not distinct from old.received_age_hours
     and new.received_age_is_estimated is not distinct from old.received_age_is_estimated then
    return new;
  end if;

  if new.source_rubber_export_id is distinct from old.source_rubber_export_id
     or new.source_export_no is distinct from old.source_export_no
     or new.received_at is distinct from old.received_at
     or new.received_age_hours is distinct from old.received_age_hours
     or new.received_age_is_estimated is distinct from old.received_age_is_estimated then
    raise exception 'บิลรับยางจากสาขาแก้ไขข้อมูลต้นทางไม่ได้';
  end if;

  if old.record_status = 'active' and new.record_status = 'active' then
    raise exception 'บิลรับยางจากสาขาไม่มีปุ่มแก้ไข';
  end if;

  return new;
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
  if exists (
    select 1
    from private.rubber_bill_report_blockers(p_location_id, p_cutoff_at)
  ) then
    raise exception 'RUBBER_BILL_PENDING: ยังมีงานบิลยางที่ต้องจัดการก่อนสร้างรายงาน';
  end if;

  select p.name, p.phone into v_actor_name, v_actor_phone
  from public.profiles p where p.id = p_actor_id;

  select b.id, b.closing_balance into v_previous_report_id, v_opening_balance
  from public.report_batches b
  where b.location_id = p_location_id
    and b.status = 'active'
  order by b.created_at desc, b.id desc
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
  ) returning id into v_report_id;

  insert into public.report_items (
    report_id, location_id, entity_type, entity_id, eligibility_at
  )
  select v_report_id, p_location_id, r.entity_type, r.entity_id, r.eligibility_at
  from private.reportable_items(p_location_id, p_cutoff_at) r
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
    'cutoffAt', p_cutoff_at,
    'itemCount', v_item_count
  );
end;
$$;

create or replace function public.create_rubber_export(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
begin
  if p_location_id is null
     or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('rubber-export:' || p_location_id::text, 0)
  );
  perform private.validate_rubber_export_selection(
    p_location_id, p_selected_report_item_ids
  );

  select
    count(*)::integer,
    round(sum(c.net_weight), 2),
    round(sum(c.paid_amount), 2)
  into v_item_count, v_original_weight, v_paid_total
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids
  ) c;

  if coalesce(v_item_count, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;

  select p.name, p.phone into v_actor_name, v_actor_phone
  from public.profiles p where p.id = v_actor_id;

  v_export_date := (v_now at time zone 'Asia/Bangkok')::date;
  v_sequence_no := private.next_document_sequence(
    'REX', p_location_id, v_export_date
  );
  v_export_no := 'REX-' || to_char(v_export_date, 'YYYYMMDD') || '-'
    || lpad(v_sequence_no::text, 3, '0');

  insert into public.rubber_exports (
    export_no, export_date, sequence_no, location_id, original_weight_total,
    paid_total, average_price, created_by_user_id, created_by_name,
    created_by_phone, created_at
  ) values (
    v_export_no, v_export_date, v_sequence_no, p_location_id, v_original_weight,
    v_paid_total, round(v_paid_total / v_original_weight, 2), v_actor_id,
    coalesce(v_actor_name, ''), coalesce(v_actor_phone, ''), v_now
  ) returning id into v_export_id;

  insert into public.rubber_export_items (
    export_id, location_id, source_report_item_id, source_bill_id, bill_date,
    bill_no, customer_name, eligibility_at, net_weight, paid_amount,
    age_source_at, age_is_estimated, carried_age_hours
  )
  select
    v_export_id, p_location_id, c.report_item_id, c.bill_id, c.bill_date,
    c.bill_no, c.customer_name, c.eligibility_at, c.net_weight, c.paid_amount,
    case
      when b.source_rubber_export_id is not null then b.received_at
      else coalesce(b.client_created_at, b.created_at)
    end,
    case
      when b.source_rubber_export_id is not null
        then b.received_age_is_estimated
      else b.client_created_at is null
        or (
          coalesce(b.client_created_at, b.created_at)
            at time zone 'Asia/Bangkok'
        )::date <> c.bill_date
    end,
    case
      when b.source_rubber_export_id is not null then b.received_age_hours
      else null
    end
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids
  ) c
  join public.rubber_bills b on b.id = c.bill_id;

  get diagnostics v_item_count = row_count;
  return jsonb_build_object(
    'id', v_export_id,
    'exportNo', v_export_no,
    'itemCount', v_item_count
  );
end;
$$;

create or replace function public.delete_rubber_export(p_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_audit public.document_deletion_audits%rowtype;
  v_report_no text;
  v_receipt_no text;
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ลบได้';
  end if;

  select * into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;

  if v_export.id is null then
    select * into v_audit
    from public.document_deletion_audits
    where document_kind = 'rubber_export'
      and source_id = p_export_id;
    if v_audit.id is not null then
      return jsonb_build_object(
        'id', p_export_id,
        'exportNo', v_audit.document_no,
        'status', 'deleted'
      );
    end if;
    raise exception 'ไม่พบรายการส่งออก';
  end if;

  v_report_no := private.active_report_no('rubber_export', p_export_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;

  select coalesce(b.server_bill_no, b.local_bill_no, b.bill_no)
  into v_receipt_no
  from public.rubber_bills b
  where b.source_rubber_export_id = p_export_id
    and b.record_status = 'active'
  limit 1;

  if v_receipt_no is not null then
    raise exception 'BRANCH_RECEIPT_SOURCE_LOCKED:%', v_export.export_no
      using hint = 'กรุณาลบบิลรับ ' || v_receipt_no || ' ก่อน';
  end if;

  select p.name into v_actor_name
  from public.profiles p
  where p.id = auth.uid();

  insert into public.document_deletion_audits (
    document_kind, source_id, document_no, location_id, previous_status,
    deleted_by_user_id, deleted_by_name, deleted_at
  ) values (
    'rubber_export', v_export.id, v_export.export_no, v_export.location_id,
    v_export.status, auth.uid(), coalesce(v_actor_name, ''), v_now
  );

  delete from public.rubber_export_items
  where export_id = v_export.id;

  delete from public.rubber_exports
  where id = v_export.id;

  return jsonb_build_object(
    'id', v_export.id,
    'exportNo', v_export.export_no,
    'status', 'deleted'
  );
end;
$$;

create or replace function public.delete_report_batch(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.report_batches%rowtype;
  v_audit public.document_deletion_audits%rowtype;
  v_export_no text;
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบรายงานได้';
  end if;

  select * into v_report
  from public.report_batches
  where id = p_report_id
  for update;

  if v_report.id is null then
    select * into v_audit
    from public.document_deletion_audits
    where document_kind = 'report_batch'
      and source_id = p_report_id;
    if v_audit.id is not null then
      return jsonb_build_object(
        'id', p_report_id,
        'reportNo', v_audit.document_no,
        'status', 'deleted'
      );
    end if;
    raise exception 'ไม่พบรายงาน active';
  end if;

  if v_report.status <> 'active' then
    raise exception 'ไม่พบรายงาน active';
  end if;

  if exists (
    select 1 from public.cash_counts c
    where c.report_id = p_report_id
  ) then
    raise exception 'CASH_COUNT_LINKED: รายงานนี้มีผลตรวจนับเงินสด กรุณาลบจากโมดูลนับเงิน';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_report.location_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('rubber-export:' || v_report.location_id::text, 0)
  );

  if exists (
    select 1 from public.report_batches newer
    where newer.location_id = v_report.location_id
      and newer.status = 'active'
      and (newer.created_at, newer.id) > (v_report.created_at, v_report.id)
  ) then
    raise exception 'ลบได้เฉพาะรายงาน active ล่าสุดของสาขา';
  end if;

  v_export_no := private.active_rubber_export_no_for_report(p_report_id);
  if v_export_no is not null then
    raise exception 'RUBBER_EXPORT_LOCKED:%', v_export_no
      using hint = 'ลบรายการส่งออกยางก่อนจึงจะลบรายงานได้';
  end if;

  select p.name into v_actor_name
  from public.profiles p
  where p.id = auth.uid();

  insert into public.document_deletion_audits (
    document_kind, source_id, document_no, location_id,
    deleted_by_user_id, deleted_by_name, deleted_at
  ) values (
    'report_batch', v_report.id, v_report.report_no, v_report.location_id,
    auth.uid(), coalesce(v_actor_name, ''), v_now
  );

  delete from public.report_items
  where report_id = v_report.id;

  delete from public.report_batches
  where id = v_report.id;

  return jsonb_build_object(
    'id', v_report.id,
    'reportNo', v_report.report_no,
    'status', 'deleted'
  );
end;
$$;

create or replace function public.delete_cash_count(p_cash_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.cash_counts%rowtype;
  v_report public.report_batches%rowtype;
  v_audit public.document_deletion_audits%rowtype;
  v_actor_name text;
  v_export_no text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบผลตรวจนับได้';
  end if;

  select * into v_count
  from public.cash_counts
  where id = p_cash_count_id
  for update;

  if v_count.id is null then
    select * into v_audit
    from public.document_deletion_audits
    where document_kind = 'cash_count'
      and source_id = p_cash_count_id;
    if v_audit.id is not null then
      return jsonb_build_object(
        'id', p_cash_count_id,
        'reportId', v_audit.paired_source_id,
        'reportNo', v_audit.document_no,
        'status', 'deleted'
      );
    end if;
    raise exception 'ไม่พบผลตรวจนับ active';
  end if;

  if v_count.status <> 'active' then
    raise exception 'ไม่พบผลตรวจนับ active';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_count.location_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('rubber-export:' || v_count.location_id::text, 0)
  );

  select * into v_report
  from public.report_batches
  where id = v_count.report_id
  for update;

  if v_report.id is null or v_report.status <> 'active' then
    raise exception 'รายงานของผลตรวจนับไม่อยู่ในสถานะ active';
  end if;

  if exists (
    select 1 from public.report_batches newer
    where newer.location_id = v_count.location_id
      and newer.status = 'active'
      and (newer.created_at, newer.id) > (v_report.created_at, v_report.id)
  ) then
    raise exception 'ลบได้เฉพาะชุดตรวจนับและรายงาน active ล่าสุดของสาขา';
  end if;

  v_export_no := private.active_rubber_export_no_for_report(v_report.id);
  if v_export_no is not null then
    raise exception 'RUBBER_EXPORT_LOCKED:%', v_export_no
      using hint = 'ลบรายการส่งออกยางก่อนจึงจะลบชุดตรวจนับได้';
  end if;

  select p.name into v_actor_name
  from public.profiles p
  where p.id = auth.uid();

  insert into public.document_deletion_audits (
    document_kind, source_id, paired_source_id, document_no, location_id,
    original_actor_user_id, original_actor_name,
    deleted_by_user_id, deleted_by_name, deleted_at
  ) values (
    'cash_count', v_count.id, v_report.id, v_report.report_no,
    v_count.location_id, v_count.created_by_user_id, v_count.created_by_name,
    auth.uid(), coalesce(v_actor_name, ''), v_now
  );

  delete from public.cash_counts
  where id = v_count.id;

  delete from public.report_items
  where report_id = v_report.id;

  delete from public.report_batches
  where id = v_report.id;

  delete from public.cash_count_sessions
  where id = v_count.session_id
    and status = 'submitted';

  return jsonb_build_object(
    'id', v_count.id,
    'reportId', v_report.id,
    'reportNo', v_report.report_no,
    'status', 'deleted'
  );
end;
$$;

-- Convert legacy tombstones to minimal audits before the irreversible purge.
insert into public.document_deletion_audits (
  document_kind, source_id, document_no, location_id, previous_status,
  deleted_by_user_id, deleted_by_name, deleted_at
)
select
  'rubber_export', e.id, e.export_no, e.location_id, e.previous_status,
  e.deleted_by_user_id, coalesce(e.deleted_by_name, ''), e.deleted_at
from public.rubber_exports e
where e.status = 'deleted'
on conflict (document_kind, source_id) do nothing;

insert into public.document_deletion_audits (
  document_kind, source_id, paired_source_id, document_no, location_id,
  original_actor_user_id, original_actor_name,
  deleted_by_user_id, deleted_by_name, deleted_at
)
select
  'cash_count', c.id, r.id, r.report_no, c.location_id,
  c.created_by_user_id, c.created_by_name,
  coalesce(c.deleted_by_user_id, r.deleted_by_user_id),
  coalesce(c.deleted_by_name, r.deleted_by_name, ''),
  coalesce(c.deleted_at, r.deleted_at)
from public.cash_counts c
join public.report_batches r on r.id = c.report_id
where c.status = 'deleted'
  and r.status = 'deleted'
on conflict (document_kind, source_id) do nothing;

insert into public.document_deletion_audits (
  document_kind, source_id, document_no, location_id,
  deleted_by_user_id, deleted_by_name, deleted_at
)
select
  'report_batch', r.id, r.report_no, r.location_id,
  r.deleted_by_user_id, coalesce(r.deleted_by_name, ''), r.deleted_at
from public.report_batches r
where r.status = 'deleted'
  and not exists (
    select 1 from public.cash_counts c where c.report_id = r.id
  )
on conflict (document_kind, source_id) do nothing;

do $$
begin
  if exists (
    select 1
    from public.rubber_bills b
    join public.rubber_exports e on e.id = b.source_rubber_export_id
    where b.record_status = 'active'
      and e.status = 'deleted'
  ) then
    raise exception 'LEGACY_PURGE_BLOCKED: active branch receipt references a deleted Rubber Export';
  end if;

  if exists (
    select 1
    from public.rubber_export_items i
    join public.rubber_exports e on e.id = i.export_id
    join public.report_items ri on ri.id = i.source_report_item_id
    join public.report_batches r on r.id = ri.report_id
    where e.status <> 'deleted'
      and r.status = 'deleted'
  ) then
    raise exception 'LEGACY_PURGE_BLOCKED: active Rubber Export references a deleted report';
  end if;

  if exists (
    select 1
    from public.cash_counts c
    join public.report_batches r on r.id = c.report_id
    where (c.status = 'deleted') is distinct from (r.status = 'deleted')
  ) then
    raise exception 'LEGACY_PURGE_BLOCKED: Cash Count and paired report statuses differ';
  end if;

  if exists (
    select 1
    from public.cash_counts c
    join public.cash_count_sessions s on s.id = c.session_id
    where c.status = 'deleted'
      and s.status <> 'submitted'
  ) then
    raise exception 'LEGACY_PURGE_BLOCKED: deleted Cash Count session is not submitted';
  end if;

  if exists (
    select 1
    from public.cash_counts active_count
    join public.cash_counts deleted_count
      on deleted_count.id = active_count.previous_cash_count_id
    where active_count.status = 'active'
      and deleted_count.status = 'deleted'
  ) then
    raise exception 'LEGACY_PURGE_BLOCKED: active Cash Count references a deleted predecessor';
  end if;

  if exists (
    select 1
    from public.report_batches active_report
    join public.report_batches deleted_report
      on deleted_report.id = active_report.previous_report_id
    where active_report.status = 'active'
      and deleted_report.status = 'deleted'
  ) then
    raise exception 'LEGACY_PURGE_BLOCKED: active report references a deleted predecessor';
  end if;
end;
$$;

update public.rubber_bills b
set source_rubber_export_id = null
where b.record_status = 'deleted'
  and b.source_rubber_export_id is not null
  and exists (
    select 1
    from public.rubber_exports e
    where e.id = b.source_rubber_export_id
      and e.status = 'deleted'
  );

create temporary table legacy_deleted_cash_count_sessions
on commit drop
as
select c.session_id
from public.cash_counts c
where c.status = 'deleted';

delete from public.rubber_export_items i
using public.rubber_exports e
where e.id = i.export_id
  and e.status = 'deleted';

delete from public.rubber_exports
where status = 'deleted';

delete from public.cash_counts
where status = 'deleted';

delete from public.report_items i
using public.report_batches r
where r.id = i.report_id
  and r.status = 'deleted';

delete from public.report_batches
where status = 'deleted';

delete from public.cash_count_sessions s
using legacy_deleted_cash_count_sessions legacy
where s.id = legacy.session_id
  and s.status = 'submitted'
  and not exists (
    select 1 from public.cash_counts c where c.session_id = s.id
  );

revoke all on function public.delete_rubber_export(uuid) from public, anon;
revoke all on function public.delete_report_batch(uuid) from public, anon;
revoke all on function public.delete_cash_count(uuid) from public, anon;
grant execute on function public.delete_rubber_export(uuid) to authenticated;
grant execute on function public.delete_report_batch(uuid) to authenticated;
grant execute on function public.delete_cash_count(uuid) to authenticated;

comment on table public.document_deletion_audits is
  'Permanent minimal audit for hard-deleted RPT, REX, and Cash Count aggregates; never stores business details.';
comment on table private.document_number_counters is
  'Durable per-location/date RPT and REX sequence state that survives source deletion.';
