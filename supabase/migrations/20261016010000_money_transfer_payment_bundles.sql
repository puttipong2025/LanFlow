-- Non-destructive payment bundles reuse money_transfers as the bundle parent.
-- Children retain their sources and slips; bundle allocations are derived FIFO.

alter table public.money_transfers
  add column is_payment_bundle boolean not null default false,
  add column bundle_parent_id uuid,
  add column bundle_frozen_at timestamptz,
  add constraint money_transfers_bundle_parent_id_fkey
    foreign key (bundle_parent_id) references public.money_transfers(id) on delete restrict,
  add constraint money_transfers_bundle_shape_check check (
    not is_payment_bundle or (
      bundle_parent_id is null
      and transfer_type in ('customer', 'rubber_export_work')
      and transfer_method = 'bank'
    )
  ),
  add constraint money_transfers_bundle_child_shape_check check (
    bundle_parent_id is null or not is_payment_bundle
  ),
  add constraint money_transfers_bundle_not_self_check check (
    bundle_parent_id is null or bundle_parent_id <> id
  ),
  add constraint money_transfers_bundle_frozen_shape_check check (
    bundle_frozen_at is null or is_payment_bundle
  );

create index money_transfers_bundle_parent_idx
  on public.money_transfers(bundle_parent_id, created_at, id)
  where bundle_parent_id is not null;

create index money_transfers_open_customer_bundle_idx
  on public.money_transfers(location_id, customer_id, account_number, created_at, id)
  where is_payment_bundle and transfer_type = 'customer' and record_status = 'active';

create index money_transfers_open_rex_bundle_idx
  on public.money_transfers(location_id, created_at, id)
  where is_payment_bundle and transfer_type = 'rubber_export_work' and record_status = 'active';

alter table public.money_transfers
  drop constraint money_transfers_rubber_export_source_check,
  add constraint money_transfers_rubber_export_source_check check (
    (
      transfer_type = 'rubber_export_work'
      and (
        (is_payment_bundle and rubber_export_id is null)
        or (not is_payment_bundle and rubber_export_id is not null)
      )
    ) or (
      transfer_type <> 'rubber_export_work'
      and rubber_export_id is null
    )
  );

create or replace function private.payment_bundle_mutation_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.current_setting('app.payment_bundle_mutation', true), '') = 'on';
$$;

create or replace function private.guard_payment_bundle_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.money_transfers;
  v_report_no text;
begin
  if tg_op = 'DELETE' then
    if (old.is_payment_bundle or old.bundle_parent_id is not null)
      and not private.payment_bundle_mutation_enabled() then
      v_report_no := private.active_transfer_report_no(coalesce(old.bundle_parent_id, old.id));
      if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
      raise exception 'MT_BUNDLE_DISSOLVE_REQUIRED: กรุณายุบชุดจ่ายรวมก่อนลบรายการ';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and new.is_payment_bundle
    and not private.payment_bundle_mutation_enabled() then
    raise exception 'MT_BUNDLE_RPC_REQUIRED: ต้องสร้างชุดจ่ายรวมผ่านคำสั่งของระบบ';
  end if;

  if tg_op = 'UPDATE'
    and (old.is_payment_bundle or old.bundle_parent_id is not null
      or new.is_payment_bundle or new.bundle_parent_id is not null)
    and to_jsonb(new) is distinct from to_jsonb(old)
    and not private.payment_bundle_mutation_enabled() then
    v_report_no := private.active_transfer_report_no(coalesce(old.bundle_parent_id, old.id));
    if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
    raise exception 'MT_BUNDLE_CHILD_LOCKED: รายการอยู่ในชุดจ่ายรวม กรุณาจัดการผ่านชุด';
  end if;

  if new.is_payment_bundle then
    if new.bundle_parent_id is not null
      or new.transfer_type not in ('customer', 'rubber_export_work')
      or new.transfer_method <> 'bank'
      or new.record_status not in ('active', 'deleted')
      or new.sync_status <> 'synced' then
      raise exception 'MT_BUNDLE_INVALID_PARENT: รูปแบบชุดจ่ายรวมไม่ถูกต้อง';
    end if;
    if new.transfer_type = 'customer' and (
      new.customer_id is null
      or nullif(btrim(new.account_number), '') is null
    ) then
      raise exception 'MT_BUNDLE_DESTINATION_REQUIRED: กรุณาเลือกลูกค้าและบัญชี';
    end if;
    if new.transfer_type = 'rubber_export_work' and (
      new.customer_id is not null or new.customer_name is not null
      or new.account_number is not null or new.account_name is not null
      or new.bank_name is not null or new.rubber_export_id is not null
    ) then
      raise exception 'MT_BUNDLE_INVALID_PARENT: ชุดค่าทำงานต้องสะท้อนรายการลูกโดยไม่มีผู้รับหรือบัญชีใหม่';
    end if;
  end if;

  if new.bundle_parent_id is not null then
    if new.is_payment_bundle then
      raise exception 'MT_BUNDLE_NESTED: ห้ามซ้อนชุดจ่ายรวม';
    end if;
    select * into v_parent
    from public.money_transfers parent
    where parent.id = new.bundle_parent_id
    for key share;
    if v_parent.id is null or not v_parent.is_payment_bundle
      or v_parent.record_status <> 'active'
      or v_parent.bundle_parent_id is not null
      or v_parent.location_id <> new.location_id
      or v_parent.transfer_type <> new.transfer_type then
      raise exception 'MT_BUNDLE_PARENT_MISMATCH: ชุดจ่ายรวมไม่ตรงกับรายการลูก';
    end if;
    if new.transfer_type = 'customer' and (
      v_parent.customer_id is distinct from new.customer_id
      or btrim(v_parent.account_number) is distinct from btrim(new.account_number)
    ) then
      raise exception 'MT_BUNDLE_DESTINATION_MISMATCH: ลูกค้าหรือบัญชีไม่ตรงกับชุด';
    end if;
    if new.transfer_type not in ('customer', 'rubber_export_work')
      or new.transfer_method <> 'bank'
      or new.record_status <> 'active'
      or new.sync_status <> 'synced'
      or new.transfer_status not in ('pending', 'partial') then
      raise exception 'MT_BUNDLE_CHILD_INELIGIBLE: รายการลูกไม่อยู่ในสถานะที่รวมได้';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_payment_bundle_transfer on public.money_transfers;
create trigger guard_payment_bundle_transfer
before insert or update or delete on public.money_transfers
for each row execute function private.guard_payment_bundle_transfer();

create or replace function private.guard_payment_bundle_slip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer_id uuid := case when tg_op = 'DELETE' then old.transfer_id else new.transfer_id end;
  v_transfer public.money_transfers;
begin
  select * into v_transfer from public.money_transfers where id = v_transfer_id;
  if v_transfer.id is not null
    and (v_transfer.is_payment_bundle or v_transfer.bundle_parent_id is not null)
    and not private.payment_bundle_mutation_enabled() then
    raise exception 'MT_BUNDLE_SLIP_LOCKED: กรุณาจัดการสลิปผ่านชุดจ่ายรวม';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_payment_bundle_slip on public.money_transfer_slips;
create trigger guard_payment_bundle_slip
before insert or update or delete on public.money_transfer_slips
for each row execute function private.guard_payment_bundle_slip();

create or replace function private.guard_rubber_export_work_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports;
begin
  if tg_op = 'UPDATE' and old.transfer_type = 'rubber_export_work' and not old.is_payment_bundle then
    if new.record_status <> 'active'
      or (to_jsonb(new) - array['transfer_status', 'revision_no', 'updated_at', 'bundle_parent_id'])
         is distinct from
         (to_jsonb(old) - array['transfer_status', 'revision_no', 'updated_at', 'bundle_parent_id']) then
      raise exception 'REX_WORK_TRANSFER_LOCKED: ต้นทางและยอดค่าทำงานแก้ไขไม่ได้';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_payment_bundle then
    if not private.payment_bundle_mutation_enabled() then
      raise exception 'MT_BUNDLE_RPC_REQUIRED: ต้องแก้ชุดจ่ายรวมผ่านคำสั่งของระบบ';
    end if;
    return new;
  end if;
  if new.transfer_type <> 'rubber_export_work' then return new; end if;
  if tg_op = 'UPDATE' then
    raise exception 'REX_WORK_TRANSFER_LOCKED: เปลี่ยนรายการทั่วไปเป็นค่าทำงานไม่ได้';
  end if;
  if new.is_payment_bundle then
    if new.rubber_export_id is not null
      or new.transfer_method <> 'bank'
      or new.transfer_status <> 'pending'
      or new.record_status <> 'active'
      or new.customer_id is not null or new.customer_name is not null
      or new.account_number is not null or new.account_name is not null or new.bank_name is not null
      or new.transport_staff_id is not null or new.transport_staff_name is not null
      or new.target_location_id is not null or new.target_location_name is not null then
      raise exception 'MT_BUNDLE_INVALID_PARENT: รูปแบบชุดค่าทำงานไม่ถูกต้อง';
    end if;
    return new;
  end if;
  select * into v_export from public.rubber_exports where id = new.rubber_export_id;
  if v_export.id is null
    or v_export.status <> 'verified'
    or v_export.expense_destination <> 'external'
    or v_export.work_total <= 0
    or new.location_id <> v_export.location_id
    or new.net_amount_to_pay <> floor(v_export.work_total)
    or new.transfer_method <> 'bank'
    or new.transfer_status <> 'pending'
    or new.record_status <> 'active'
    or new.customer_id is not null or new.customer_name is not null
    or new.account_number is not null or new.account_name is not null or new.bank_name is not null
    or new.transport_staff_id is not null or new.transport_staff_name is not null
    or new.target_location_id is not null or new.target_location_name is not null then
    raise exception 'REX_WORK_TRANSFER_INVALID: ข้อมูลโอนไม่ตรงกับรายการส่งออกยาง';
  end if;
  return new;
end;
$$;

create or replace function private.payment_bundle_summary(p_bundle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bundle public.money_transfers;
  v_original numeric := 0;
  v_child_paid numeric := 0;
  v_due numeric := 0;
  v_bundle_paid numeric := 0;
  v_allocated numeric := 0;
  v_overpayment numeric := 0;
  v_remaining numeric := 0;
  v_status text := 'pending';
  v_child_count integer := 0;
  v_allocations jsonb := '[]'::jsonb;
begin
  select * into v_bundle from public.money_transfers
  where id = p_bundle_id and is_payment_bundle and record_status = 'active';
  if v_bundle.id is null then return null; end if;

  with children as (
    select child.id, child.created_at, child.net_amount_to_pay,
      coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = child.id), 0) child_paid
    from public.money_transfers child
    where child.bundle_parent_id = p_bundle_id and child.record_status = 'active'
  )
  select count(*)::integer, coalesce(sum(net_amount_to_pay), 0),
    coalesce(sum(child_paid), 0),
    coalesce(sum(greatest(net_amount_to_pay - child_paid, 0)), 0)
  into v_child_count, v_original, v_child_paid, v_due
  from children;

  select coalesce(sum(amount), 0) into v_bundle_paid
  from public.money_transfer_slips where transfer_id = p_bundle_id;
  v_allocated := least(v_bundle_paid, v_due);
  v_overpayment := greatest(v_bundle_paid - v_due, 0);
  v_remaining := greatest(v_due - v_bundle_paid - coalesce(v_bundle.branch_paid_amount, 0), 0);
  v_status := case
    when v_bundle_paid <= 0 then 'pending'
    when v_bundle_paid < v_due and v_bundle.transfer_type = 'customer'
      and coalesce(v_bundle.branch_paid_amount, 0) >= v_due - v_bundle_paid then 'branch_and_transfer'
    when v_bundle_paid < v_due then 'partial'
    when v_bundle_paid = v_due then 'paid'
    else 'overpaid'
  end;

  with children as (
    select child.id, child.created_at,
      greatest(child.net_amount_to_pay - coalesce((
        select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = child.id
      ), 0), 0) outstanding
    from public.money_transfers child
    where child.bundle_parent_id = p_bundle_id and child.record_status = 'active'
  ), ordered as (
    select *, coalesce(sum(outstanding) over (
      order by created_at, id rows between unbounded preceding and 1 preceding
    ), 0) prior_due
    from children
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'childId', id,
    'outstanding', outstanding,
    'allocated', least(outstanding, greatest(v_bundle_paid - prior_due, 0)),
    'remaining', outstanding - least(outstanding, greatest(v_bundle_paid - prior_due, 0))
  ) order by created_at, id), '[]'::jsonb)
  into v_allocations from ordered;

  return jsonb_build_object(
    'childCount', v_child_count,
    'originalTotal', v_original,
    'childPaidTotal', v_child_paid,
    'amountDue', v_due,
    'bundlePaidTotal', v_bundle_paid,
    'allocatedTotal', v_allocated,
    'branchPaidAmount', coalesce(v_bundle.branch_paid_amount, 0),
    'remaining', v_remaining,
    'overpayment', v_overpayment,
    'status', v_status,
    'allocations', v_allocations
  );
end;
$$;

create or replace function public.get_payment_bundle_candidates(
  p_location_id uuid,
  p_bundle_type text,
  p_customer_id uuid default null,
  p_account_number text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module()
    or not private.can_access_location(p_location_id) then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงินของสาขานี้';
  end if;
  if p_bundle_type not in ('customer', 'rubber_export_work') then
    raise exception 'MT_BUNDLE_INVALID_TYPE: ประเภทชุดไม่ถูกต้อง';
  end if;
  if p_bundle_type = 'customer' and (p_customer_id is null or nullif(btrim(p_account_number), '') is null) then
    raise exception 'MT_BUNDLE_DESTINATION_REQUIRED: กรุณาเลือกลูกค้าและบัญชี';
  end if;
  if p_page_size < 1 or p_page_size > 100 then raise exception 'MT_INVALID_PAGE_SIZE'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'MT_INVALID_CURSOR'; end if;

  with target as (
    select transfer.*,
      coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = transfer.id), 0) paid_amount,
      public.report_lock_no(transfer) report_lock_no,
      export.export_no rubber_export_no
    from public.money_transfers transfer
    left join public.rubber_exports export on export.id = transfer.rubber_export_id
    where transfer.location_id = p_location_id
      and transfer.transfer_type = p_bundle_type
      and not transfer.is_payment_bundle
      and transfer.record_status = 'active'
      and transfer.sync_status = 'synced'
      and transfer.transfer_method = 'bank'
      and (
        p_bundle_type = 'rubber_export_work'
        or (transfer.customer_id = p_customer_id and btrim(transfer.account_number) = btrim(p_account_number))
      )
  ), eligible as (
    select * from target
    where transfer_status in ('pending', 'partial')
      and bundle_parent_id is null
      and report_lock_no is null
      and net_amount_to_pay - paid_amount > 0
      and (p_cursor_created_at is null or (created_at, id) > (p_cursor_created_at, p_cursor_id))
    order by created_at, id
    limit p_page_size + 1
  ), visible as (
    select * from eligible order by created_at, id limit p_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(row_value) || jsonb_build_object(
      'outstanding_amount', row_value.net_amount_to_pay - row_value.paid_amount
    ) order by row_value.created_at, row_value.id) from visible row_value), '[]'::jsonb),
    'eligibleCount', (select count(*) from target where transfer_status in ('pending', 'partial')
      and bundle_parent_id is null and report_lock_no is null and net_amount_to_pay - paid_amount > 0),
    'eligibleAmount', (select coalesce(sum(net_amount_to_pay - paid_amount), 0) from target
      where transfer_status in ('pending', 'partial') and bundle_parent_id is null
        and report_lock_no is null and net_amount_to_pay - paid_amount > 0),
    'alreadyBundledCount', (select count(*) from target where bundle_parent_id is not null),
    'reportLockedCount', (select count(*) from target where report_lock_no is not null),
    'ineligibleStatusCount', (select count(*) from target where transfer_status not in ('pending', 'partial')),
    'hasMore', (select count(*) > p_page_size from eligible),
    'nextCreatedAt', (select created_at from visible order by created_at desc, id desc limit 1),
    'nextId', (select id from visible order by created_at desc, id desc limit 1)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_payment_bundle_detail(
  p_bundle_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bundle public.money_transfers;
  v_summary jsonb;
  v_result jsonb;
begin
  if not private.is_active_user() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  select * into v_bundle from public.money_transfers
  where id = p_bundle_id and is_payment_bundle and record_status = 'active';
  if v_bundle.id is null then raise exception 'MT_BUNDLE_NOT_FOUND: ไม่พบชุดจ่ายรวม'; end if;
  if not private.can_access_location(v_bundle.location_id)
    or not (private.can_access_money_transfer_module() or private.can_manage_reports(v_bundle.location_id)) then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา';
  end if;
  if p_page_size < 1 or p_page_size > 100 then raise exception 'MT_INVALID_PAGE_SIZE'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'MT_INVALID_CURSOR'; end if;
  v_summary := private.payment_bundle_summary(p_bundle_id);

  with child_base as (
    select child.*, export.export_no rubber_export_no,
      coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = child.id), 0) paid_amount,
      coalesce((select count(*) from public.money_transfer_items item where item.transfer_id = child.id), 0) source_count
    from public.money_transfers child
    left join public.rubber_exports export on export.id = child.rubber_export_id
    where child.bundle_parent_id = p_bundle_id and child.record_status = 'active'
  ), ordered as (
    select *, greatest(net_amount_to_pay - paid_amount, 0) outstanding_amount,
      coalesce(sum(greatest(net_amount_to_pay - paid_amount, 0)) over (
        order by created_at, id rows between unbounded preceding and 1 preceding
      ), 0) prior_due
    from child_base
  ), candidates as (
    select * from ordered
    where p_cursor_created_at is null or (created_at, id) > (p_cursor_created_at, p_cursor_id)
    order by created_at, id limit p_page_size + 1
  ), visible as (
    select * from candidates order by created_at, id limit p_page_size
  )
  select to_jsonb(v_bundle)
    || jsonb_build_object(
      'report_lock_no', public.report_lock_no(v_bundle),
      'bundle_summary', v_summary,
      'money_transfer_slips', coalesce((select jsonb_agg(to_jsonb(slip) order by slip.sort_order, slip.id)
        from public.money_transfer_slips slip where slip.transfer_id = p_bundle_id), '[]'::jsonb),
      'children', coalesce((select jsonb_agg(to_jsonb(child) || jsonb_build_object(
        'bundle_allocated_amount', least(child.outstanding_amount,
          greatest((v_summary->>'bundlePaidTotal')::numeric - child.prior_due, 0)),
        'bundle_remaining_amount', child.outstanding_amount - least(child.outstanding_amount,
          greatest((v_summary->>'bundlePaidTotal')::numeric - child.prior_due, 0)),
        'money_transfer_slips', coalesce((select jsonb_agg(to_jsonb(slip) order by slip.sort_order, slip.id)
          from public.money_transfer_slips slip where slip.transfer_id = child.id), '[]'::jsonb)
      ) order by child.created_at, child.id) from visible child), '[]'::jsonb),
      'has_more_children', (select count(*) > p_page_size from candidates),
      'next_child_created_at', (select created_at from visible order by created_at desc, id desc limit 1),
      'next_child_id', (select id from visible order by created_at desc, id desc limit 1)
    ) into v_result;
  return v_result;
end;
$$;

create or replace function public.create_or_update_payment_bundle(
  p_location_id uuid,
  p_bundle_type text,
  p_customer_id uuid default null,
  p_account_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle public.money_transfers;
  v_actor public.profiles;
  v_child public.money_transfers;
  v_due numeric := 0;
  v_linked integer := 0;
  v_new boolean := false;
  v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module()
    or not private.can_access_location(p_location_id) then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงินของสาขานี้';
  end if;
  if p_bundle_type not in ('customer', 'rubber_export_work') then
    raise exception 'MT_BUNDLE_INVALID_TYPE: ประเภทชุดไม่ถูกต้อง';
  end if;
  if p_bundle_type = 'customer' and (p_customer_id is null or nullif(btrim(p_account_number), '') is null) then
    raise exception 'MT_BUNDLE_DESTINATION_REQUIRED: กรุณาเลือกลูกค้าและบัญชี';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'payment-bundle:' || p_location_id::text || ':' || p_bundle_type || ':'
      || coalesce(p_customer_id::text, '') || ':' || coalesce(btrim(p_account_number), ''), 0
  ));
  select * into v_actor from public.profiles where id = auth.uid() and is_active;

  select * into v_bundle
  from public.money_transfers bundle
  where bundle.location_id = p_location_id
    and bundle.is_payment_bundle
    and bundle.transfer_type = p_bundle_type
    and bundle.record_status = 'active'
    and bundle.bundle_frozen_at is null
    and private.active_transfer_report_no(bundle.id) is null
    and not exists(select 1 from public.money_transfer_slips slip where slip.transfer_id = bundle.id)
    and (
      p_bundle_type = 'rubber_export_work'
      or (bundle.customer_id = p_customer_id and btrim(bundle.account_number) = btrim(p_account_number))
    )
  order by bundle.created_at, bundle.id
  limit 1 for update;

  if v_bundle.id is null then
    select child.* into v_child
    from public.money_transfers child
    where child.location_id = p_location_id
      and child.transfer_type = p_bundle_type
      and not child.is_payment_bundle and child.bundle_parent_id is null
      and child.record_status = 'active' and child.sync_status = 'synced'
      and child.transfer_method = 'bank' and child.transfer_status in ('pending', 'partial')
      and private.active_transfer_report_no(child.id) is null
      and child.net_amount_to_pay > coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = child.id), 0)
      and (p_bundle_type = 'rubber_export_work'
        or (child.customer_id = p_customer_id and btrim(child.account_number) = btrim(p_account_number)))
    order by child.created_at, child.id limit 1 for update;
    if v_child.id is null then raise exception 'MT_BUNDLE_NO_ELIGIBLE_CHILDREN: ไม่มีรายการที่รวมได้'; end if;
    perform set_config('app.payment_bundle_mutation', 'on', true);
    insert into public.money_transfers (
      client_temp_id, idempotency_key, location_id,
      customer_id, customer_name, account_number, account_name, bank_name,
      net_amount_to_pay, transfer_status, sync_status, record_status,
      created_by_user_id, created_by_name, created_by_phone,
      server_received_at, transfer_type, transfer_method, is_payment_bundle
    ) values (
      gen_random_uuid()::text, 'payment-bundle:' || gen_random_uuid()::text, p_location_id,
      case when p_bundle_type = 'customer' then v_child.customer_id end,
      case when p_bundle_type = 'customer' then v_child.customer_name end,
      case when p_bundle_type = 'customer' then v_child.account_number end,
      case when p_bundle_type = 'customer' then v_child.account_name end,
      case when p_bundle_type = 'customer' then v_child.bank_name end,
      0, 'pending', 'synced', 'active', auth.uid(), coalesce(v_actor.name, ''), coalesce(v_actor.phone, ''),
      now(), p_bundle_type, 'bank', true
    ) returning * into v_bundle;
    v_new := true;
  else
    perform set_config('app.payment_bundle_mutation', 'on', true);
  end if;

  for v_child in
    select child.*
    from public.money_transfers child
    where child.location_id = p_location_id
      and child.transfer_type = p_bundle_type
      and not child.is_payment_bundle and child.bundle_parent_id is null
      and child.record_status = 'active' and child.sync_status = 'synced'
      and child.transfer_method = 'bank' and child.transfer_status in ('pending', 'partial')
      and private.active_transfer_report_no(child.id) is null
      and child.net_amount_to_pay > coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = child.id), 0)
      and (p_bundle_type = 'rubber_export_work'
        or (child.customer_id = p_customer_id and btrim(child.account_number) = btrim(p_account_number)))
    order by child.created_at, child.id
    for update
  loop
    update public.money_transfers set bundle_parent_id = v_bundle.id, updated_at = now()
    where id = v_child.id;
    v_linked := v_linked + 1;
  end loop;

  select coalesce(sum(greatest(child.net_amount_to_pay - coalesce((
    select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = child.id
  ), 0), 0)), 0) into v_due
  from public.money_transfers child where child.bundle_parent_id = v_bundle.id and child.record_status = 'active';
  if v_due <= 0 then raise exception 'MT_BUNDLE_NO_ELIGIBLE_CHILDREN: ไม่มีรายการที่มียอดคงเหลือ'; end if;

  update public.money_transfers
  set net_amount_to_pay = v_due,
      revision_no = case when v_new then revision_no else revision_no + case when v_linked > 0 then 1 else 0 end end,
      updated_at = now()
  where id = v_bundle.id;
  v_result := public.get_payment_bundle_detail(v_bundle.id);
  perform set_config('app.payment_bundle_mutation', 'off', true);
  return v_result;
end;
$$;

create or replace function public.save_payment_bundle(
  p_bundle_id uuid,
  p_expected_revision integer,
  p_slips jsonb,
  p_branch_pays_remaining boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle public.money_transfers;
  v_location_id uuid;
  v_slip_ids uuid[];
  v_paid numeric := 0;
  v_due numeric := 0;
  v_branch_paid numeric := 0;
  v_status text;
  v_fingerprint text;
  v_report_no text;
  v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  if p_bundle_id is null or p_expected_revision is null or p_slips is null
    or jsonb_typeof(p_slips) <> 'array' then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลสลิปไม่ครบ';
  end if;
  select location_id into v_location_id from public.money_transfers where id = p_bundle_id;
  if v_location_id is null or not private.can_access_location(v_location_id) then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));
  select * into v_bundle from public.money_transfers where id = p_bundle_id for update;
  if v_bundle.id is null or not v_bundle.is_payment_bundle or v_bundle.record_status <> 'active' then
    raise exception 'MT_BUNDLE_NOT_FOUND: ไม่พบชุดจ่ายรวม';
  end if;
  if v_bundle.revision_no is distinct from p_expected_revision then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;
  v_report_no := private.active_transfer_report_no(v_bundle.id);
  if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
  if p_branch_pays_remaining and v_bundle.transfer_type <> 'customer' then
    raise exception 'MT_BUNDLE_BRANCH_PAY_CUSTOMER_ONLY: สาขาจ่ายส่วนที่เหลือได้เฉพาะชุดลูกค้า';
  end if;
  if exists (select 1 from jsonb_array_elements(p_slips) x group by x->>'id' having count(*) > 1) then
    raise exception 'MT_DUPLICATE_SLIP_ID: มีรหัสสลิปซ้ำในรายการ';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    where nullif(x->>'id', '') is null
      or coalesce((x->>'amount')::numeric, 0) <= 0
      or coalesce((x->>'fee')::numeric, 0) < 0
      or nullif(x->>'transactionDate', '') is null
      or x->>'inputMethod' not in ('manual', 'ocr')
      or (x->>'inputMethod' = 'manual' and nullif(trim(x->>'referenceNumber'), '') is not null)
      or (x->>'inputMethod' = 'ocr' and nullif(trim(x->>'referenceNumber'), '') is null)
  ) then raise exception 'MT_INVALID_SLIP: จำนวนเงิน ค่าธรรมเนียม วันเวลา หรือที่มาของสลิปไม่ถูกต้อง'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    join public.money_transfer_slips s on s.id = (x->>'id')::uuid
    where s.transfer_id <> p_bundle_id
  ) then raise exception 'MT_SLIP_PARENT_CONFLICT: สลิปอยู่ในรายการโอนอื่น'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x where x->>'inputMethod' = 'ocr'
    group by private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    ) having count(*) > 1
  ) then raise exception 'MT_OCR_DUPLICATE: พบสลิป OCR ซ้ำในรายการ'; end if;
  for v_fingerprint in
    select distinct private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    ) from jsonb_array_elements(p_slips) x where x->>'inputMethod' = 'ocr' order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('money-transfer-ocr:' || v_fingerprint, 0));
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_slips) x
    join public.money_transfer_slips s
      on s.ocr_fingerprint = private.money_transfer_ocr_fingerprint(
        x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
      )
    join public.money_transfers transfer on transfer.id = s.transfer_id and transfer.record_status <> 'deleted'
    where x->>'inputMethod' = 'ocr' and transfer.id <> p_bundle_id
  ) then raise exception 'MT_OCR_DUPLICATE: สลิป OCR ถูกใช้ในรายการอื่นแล้ว'; end if;

  perform set_config('app.payment_bundle_mutation', 'on', true);
  select coalesce(array_agg((x->>'id')::uuid), array[]::uuid[])
  into v_slip_ids from jsonb_array_elements(p_slips) x;
  delete from public.money_transfer_slips s
  where s.transfer_id = p_bundle_id and not (s.id = any(v_slip_ids));
  insert into public.money_transfer_slips (
    id, transfer_id, amount, reference_number, fee, sender_name, receiver_name,
    transaction_date, slip_image_url, sort_order, input_method, ocr_fingerprint
  )
  select (x->>'id')::uuid, p_bundle_id, (x->>'amount')::numeric,
    case when x->>'inputMethod' = 'manual' then null else nullif(x->>'referenceNumber', '') end,
    coalesce((x->>'fee')::numeric, 0), null, null,
    (x->>'transactionDate')::timestamptz, null, coalesce((x->>'sortOrder')::integer, 0),
    x->>'inputMethod', case when x->>'inputMethod' = 'ocr' then private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber', (x->>'amount')::numeric, (x->>'transactionDate')::timestamptz
    ) end
  from jsonb_array_elements(p_slips) x
  on conflict (id) do update set
    amount = excluded.amount, reference_number = excluded.reference_number,
    fee = excluded.fee, transaction_date = excluded.transaction_date,
    sort_order = excluded.sort_order, input_method = excluded.input_method,
    ocr_fingerprint = excluded.ocr_fingerprint, sender_name = null,
    receiver_name = null, slip_image_url = null, updated_at = now()
  where money_transfer_slips.transfer_id = p_bundle_id;

  select coalesce(sum(greatest(child.net_amount_to_pay - coalesce((
    select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = child.id
  ), 0), 0)), 0) into v_due
  from public.money_transfers child where child.bundle_parent_id = p_bundle_id and child.record_status = 'active';
  select coalesce(sum(amount), 0) into v_paid from public.money_transfer_slips where transfer_id = p_bundle_id;
  v_branch_paid := case when p_branch_pays_remaining and v_paid > 0 and v_paid < v_due
    then v_due - v_paid else 0 end;
  v_status := case
    when v_paid <= 0 then 'pending'
    when v_paid < v_due and v_branch_paid > 0 then 'branch_and_transfer'
    when v_paid < v_due then 'partial'
    when v_paid = v_due then 'paid'
    else 'overpaid'
  end;
  update public.money_transfers
  set net_amount_to_pay = v_due,
      branch_paid_amount = v_branch_paid,
      transfer_status = v_status,
      bundle_frozen_at = case when jsonb_array_length(p_slips) > 0
        then coalesce(bundle_frozen_at, now()) else bundle_frozen_at end,
      revision_no = revision_no + 1,
      updated_at = now()
  where id = p_bundle_id;
  v_result := public.get_payment_bundle_detail(p_bundle_id);
  perform set_config('app.payment_bundle_mutation', 'off', true);
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range
    or invalid_datetime_format or datetime_field_overflow then
    raise exception 'MT_INVALID_SLIP: จำนวนเงิน ค่าธรรมเนียม วันเวลา หรือรูปแบบข้อมูลสลิปไม่ถูกต้อง';
end;
$$;

create or replace function public.dissolve_payment_bundle(
  p_bundle_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle public.money_transfers;
  v_count integer;
  v_actor public.profiles;
  v_report_no text;
  v_backend_pid integer := pg_catalog.pg_backend_pid();
  v_transaction_id bigint := pg_catalog.txid_current();
  v_location_id uuid;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  select location_id into v_location_id from public.money_transfers
  where id = p_bundle_id and is_payment_bundle and record_status = 'active';
  if v_location_id is null then
    raise exception 'MT_BUNDLE_NOT_FOUND: ไม่พบชุดจ่ายรวม';
  end if;
  if not private.can_access_location(v_location_id) then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));
  select * into v_bundle from public.money_transfers where id = p_bundle_id for update;
  if v_bundle.id is null or not v_bundle.is_payment_bundle or v_bundle.record_status <> 'active' then
    raise exception 'MT_BUNDLE_NOT_FOUND: ไม่พบชุดจ่ายรวม';
  end if;
  if v_bundle.revision_no is distinct from p_expected_revision then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;
  v_report_no := private.active_transfer_report_no(v_bundle.id);
  if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
  if exists(select 1 from public.money_transfer_slips where transfer_id = p_bundle_id) then
    raise exception 'MT_BUNDLE_HAS_SLIPS: ชุดที่มีสลิปแล้วไม่สามารถยุบได้';
  end if;
  if v_bundle.bundle_frozen_at is not null then
    raise exception 'MT_BUNDLE_FROZEN: ชุดที่เคยเริ่มจ่ายแล้วไม่สามารถยุบได้';
  end if;
  perform set_config('app.payment_bundle_mutation', 'on', true);
  update public.money_transfers set bundle_parent_id = null, updated_at = now()
  where bundle_parent_id = p_bundle_id;
  get diagnostics v_count = row_count;
  select * into v_actor from public.profiles where id = auth.uid();
  insert into private.money_transfer_delete_context (backend_pid, transaction_id, transfer_id)
  values (v_backend_pid, v_transaction_id, p_bundle_id);
  update public.money_transfers
  set record_status = 'deleted', deleted_at = now(),
      deleted_by_name = coalesce(v_actor.name, ''), deleted_by_phone = coalesce(v_actor.phone, ''),
      revision_no = revision_no + 1, updated_at = now()
  where id = p_bundle_id;
  delete from private.money_transfer_delete_context context
  where context.backend_pid = v_backend_pid
    and context.transaction_id = v_transaction_id
    and context.transfer_id = p_bundle_id;
  perform set_config('app.payment_bundle_mutation', 'off', true);
  return jsonb_build_object('status', 'dissolved', 'bundleId', p_bundle_id, 'releasedChildCount', v_count);
end;
$$;

create or replace function public.report_lock_no(source_row public.money_transfers)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.active_transfer_report_no(source_row.id),
    private.active_transfer_report_no(source_row.bundle_parent_id)
  );
$$;

alter function public.get_money_transfer_list(uuid,text,text,timestamptz,uuid,integer)
  rename to get_money_transfer_list_before_payment_bundles;
revoke all on function public.get_money_transfer_list_before_payment_bundles(uuid,text,text,timestamptz,uuid,integer)
  from public, anon, authenticated;

create or replace function public.get_money_transfer_list(
  p_location_id uuid,
  p_status text default 'all',
  p_search text default '',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50,
  p_kind text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_search text := lower(trim(coalesce(p_search, '')));
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  if not private.can_access_location(p_location_id) then raise exception 'Location access denied'; end if;
  if p_page_size < 1 or p_page_size > 100 then raise exception 'Invalid page size'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'Invalid transfer cursor'; end if;
  if p_kind not in ('all', 'single', 'bundle') then raise exception 'Invalid transfer kind'; end if;
  if p_status not in ('all','pending','partial','advance_payment','paid','overpaid',
    'branch_and_transfer','cancelled','branch_pending_receipt','branch_received') then
    raise exception 'Invalid transfer status';
  end if;

  with base as (
    select transfer.*, export.export_no rubber_export_no,
      public.report_lock_no(transfer) report_lock_no,
      coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = transfer.id), 0) paid_amount,
      coalesce((select count(*) from public.money_transfer_slips s where s.transfer_id = transfer.id), 0) slip_count,
      coalesce((select count(*) from public.money_transfer_items item where item.transfer_id = transfer.id), 0) source_count,
      case when transfer.is_payment_bundle then private.payment_bundle_summary(transfer.id) end bundle_summary,
      case
        when transfer.transfer_type = 'branch' and transfer.branch_receipt_contract_version = 1
          and transfer.branch_receipt_status = 'pending_receipt' then 'branch_pending_receipt'
        when transfer.transfer_type = 'branch' then 'branch_received'
        else transfer.transfer_status
      end virtual_status,
      case when v_search = '' then null else (
        select child.id from public.money_transfers child
        left join public.rubber_exports child_export on child_export.id = child.rubber_export_id
        where child.bundle_parent_id = transfer.id and position(v_search in lower(concat_ws(' ',
          child.customer_name, child.account_number, child.account_name, child.bank_name,
          child_export.export_no, child.id::text
        ))) > 0 order by child.created_at, child.id limit 1
      ) end matched_child_id
    from public.money_transfers transfer
    left join public.rubber_exports export on export.id = transfer.rubber_export_id
    where transfer.location_id = p_location_id
      and transfer.record_status <> 'deleted'
      and transfer.transfer_type <> 'cash'
      and transfer.bundle_parent_id is null
      and (p_kind = 'all' or (p_kind = 'bundle' and transfer.is_payment_bundle)
        or (p_kind = 'single' and not transfer.is_payment_bundle))
  ), candidates as (
    select * from base transfer
    where (p_status = 'all' or transfer.virtual_status = p_status)
      and (v_search = '' or position(v_search in lower(concat_ws(' ',
        transfer.customer_name, transfer.account_number, transfer.account_name, transfer.bank_name,
        transfer.transport_staff_name, transfer.target_location_name, transfer.rubber_export_no,
        transfer.time_payroll_employee_name, transfer.time_payroll_source_label, transfer.id::text
      ))) > 0 or transfer.matched_child_id is not null)
      and (p_cursor_created_at is null or (transfer.created_at, transfer.id) < (p_cursor_created_at, p_cursor_id))
    order by transfer.created_at desc, transfer.id desc limit p_page_size + 1
  ), visible as (
    select * from candidates order by created_at desc, id desc limit p_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(row_value)
      || case when row_value.bundle_summary is null then '{}'::jsonb else jsonb_build_object(
        'bundle_child_count', (row_value.bundle_summary->>'childCount')::integer,
        'bundle_original_total', (row_value.bundle_summary->>'originalTotal')::numeric,
        'bundle_child_paid_total', (row_value.bundle_summary->>'childPaidTotal')::numeric,
        'bundle_remaining', (row_value.bundle_summary->>'remaining')::numeric,
        'bundle_overpayment', (row_value.bundle_summary->>'overpayment')::numeric
      ) end order by row_value.created_at desc, row_value.id desc) from visible row_value), '[]'::jsonb),
    'statusCounts', (select jsonb_build_object(
      'all', count(*), 'pending', count(*) filter(where virtual_status='pending'),
      'partial', count(*) filter(where virtual_status='partial'),
      'advance_payment', count(*) filter(where virtual_status='advance_payment'),
      'paid', count(*) filter(where virtual_status='paid'),
      'overpaid', count(*) filter(where virtual_status='overpaid'),
      'branch_and_transfer', count(*) filter(where virtual_status='branch_and_transfer'),
      'cancelled', count(*) filter(where virtual_status='cancelled'),
      'branch_pending_receipt', count(*) filter(where virtual_status='branch_pending_receipt'),
      'branch_received', count(*) filter(where virtual_status='branch_received')
    ) from base),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextCreatedAt', (select created_at from visible order by created_at, id limit 1),
    'nextId', (select id from visible order by created_at, id limit 1)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_money_transfer_detail(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_transfer public.money_transfers;
  v_result jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  select * into v_transfer from public.money_transfers transfer
  where transfer.id = p_transfer_id and transfer.record_status <> 'deleted';
  if v_transfer.id is null then raise exception 'Money transfer not found'; end if;
  if not private.can_access_location(v_transfer.location_id) then raise exception 'Location access denied'; end if;
  select to_jsonb(v_transfer) || jsonb_build_object(
    'report_lock_no', public.report_lock_no(v_transfer),
    'rubber_export_no', (select export.export_no from public.rubber_exports export where export.id = v_transfer.rubber_export_id),
    'bundle_summary', case when v_transfer.is_payment_bundle then private.payment_bundle_summary(v_transfer.id) end,
    'money_transfer_slips', coalesce((select jsonb_agg(to_jsonb(slip) order by slip.sort_order, slip.id)
      from public.money_transfer_slips slip where slip.transfer_id = p_transfer_id), '[]'::jsonb),
    'money_transfer_items', coalesce((select jsonb_agg(to_jsonb(item) order by item.created_at, item.id)
      from public.money_transfer_items item where item.transfer_id = p_transfer_id), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

alter function public.get_actionable_badge_counts()
  rename to get_actionable_badge_counts_before_payment_bundles;
revoke all on function public.get_actionable_badge_counts_before_payment_bundles()
  from public, anon, authenticated;

create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with hidden as (
    select child.location_id, count(*)::bigint item_count
    from public.money_transfers child
    where child.bundle_parent_id is not null and child.record_status <> 'deleted'
      and child.transfer_method = 'bank'
      and child.transfer_status in ('pending', 'partial', 'advance_payment')
    group by child.location_id
  ), adjusted as (
    select base.location_id, base.module_id,
      case when base.module_id = 'money-transfer'
        then greatest(base.item_count - coalesce(hidden.item_count, 0), 0)
        else base.item_count end item_count
    from public.get_actionable_badge_counts_before_payment_bundles() base
    left join hidden on hidden.location_id = base.location_id and base.module_id = 'money-transfer'
  )
  select adjusted.location_id, adjusted.module_id, adjusted.item_count
  from adjusted where adjusted.item_count > 0
  order by adjusted.location_id, adjusted.module_id;
$$;

alter function public.get_telegram_badge_counts()
  rename to get_telegram_badge_counts_before_payment_bundles;
revoke all on function public.get_telegram_badge_counts_before_payment_bundles()
  from public, anon, authenticated, service_role;

create or replace function public.get_telegram_badge_counts()
returns table(
  badge_key text, location_id uuid, branch_name text, module_name text,
  status_label text, item_count bigint, sort_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with hidden as (
    select case child.transfer_status when 'pending' then 'money_transfer_pending'
      when 'partial' then 'money_transfer_partial' else 'money_transfer_advance' end badge_key,
      child.location_id, count(*)::bigint item_count
    from public.money_transfers child
    where child.bundle_parent_id is not null and child.record_status <> 'deleted'
      and child.transfer_method = 'bank'
      and child.transfer_status in ('pending', 'partial', 'advance_payment')
    group by child.transfer_status, child.location_id
  ), adjusted as (
    select base.badge_key, base.location_id, base.branch_name, base.module_name,
      base.status_label, greatest(base.item_count - coalesce(hidden.item_count, 0), 0)::bigint item_count,
      base.sort_order
    from public.get_telegram_badge_counts_before_payment_bundles() base
    left join hidden on hidden.badge_key = base.badge_key and hidden.location_id = base.location_id
  )
  select * from adjusted where adjusted.item_count > 0
  order by case when adjusted.branch_name = 'ส่วนกลาง' then 1 else 0 end,
    adjusted.branch_name, adjusted.sort_order;
$$;

alter function private.reportable_items(uuid,timestamptz)
  rename to reportable_items_before_payment_bundles;

create or replace function private.reportable_items(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns table(entity_type text, entity_id uuid, eligibility_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- The predecessor retains private.reportable_items_before_time_payroll_payment.
  select candidate.entity_type, candidate.entity_id, candidate.eligibility_at
  from private.reportable_items_before_payment_bundles(p_location_id, p_cutoff_at) candidate
  left join public.money_transfers transfer
    on transfer.id = candidate.entity_id
    and candidate.entity_type in ('bank_transfer_source', 'bank_transfer_target')
  where transfer.id is null
    or (
      transfer.bundle_parent_id is null
      and (not transfer.is_payment_bundle or transfer.transfer_status in ('paid', 'overpaid', 'branch_and_transfer'))
      and not (transfer.is_payment_bundle and transfer.transfer_type = 'rubber_export_work'
        and transfer.transfer_status = 'branch_and_transfer')
    );
$$;

revoke all on function private.payment_bundle_mutation_enabled() from public, anon, authenticated, service_role;
revoke all on function private.payment_bundle_summary(uuid) from public, anon, authenticated, service_role;
revoke all on function private.guard_payment_bundle_transfer() from public, anon, authenticated, service_role;
revoke all on function private.guard_payment_bundle_slip() from public, anon, authenticated, service_role;
revoke all on function public.get_payment_bundle_candidates(uuid,text,uuid,text,timestamptz,uuid,integer) from public, anon;
revoke all on function public.get_payment_bundle_detail(uuid,timestamptz,uuid,integer) from public, anon;
revoke all on function public.create_or_update_payment_bundle(uuid,text,uuid,text) from public, anon;
revoke all on function public.save_payment_bundle(uuid,integer,jsonb,boolean) from public, anon;
revoke all on function public.dissolve_payment_bundle(uuid,integer) from public, anon;
revoke all on function public.get_money_transfer_list(uuid,text,text,timestamptz,uuid,integer,text) from public, anon;
revoke all on function public.get_actionable_badge_counts() from public, anon;
revoke all on function public.get_telegram_badge_counts() from public, anon, authenticated;

grant execute on function public.get_payment_bundle_candidates(uuid,text,uuid,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_payment_bundle_detail(uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.create_or_update_payment_bundle(uuid,text,uuid,text) to authenticated;
grant execute on function public.save_payment_bundle(uuid,integer,jsonb,boolean) to authenticated;
grant execute on function public.dissolve_payment_bundle(uuid,integer) to authenticated;
grant execute on function public.get_money_transfer_list(uuid,text,text,timestamptz,uuid,integer,text) to authenticated;
grant execute on function public.get_actionable_badge_counts() to authenticated;
grant execute on function public.get_telegram_badge_counts() to service_role;

notify pgrst, 'reload schema';
