-- Add the receiving-branch confirmation contract without changing creation semantics yet.

alter table public.money_transfers
  add column if not exists branch_receipt_contract_version smallint,
  add column if not exists branch_receipt_status text,
  add column if not exists branch_received_by_user_id uuid references public.profiles(id),
  add column if not exists branch_received_by_name text,
  add column if not exists branch_received_at timestamptz;

alter table public.money_transfers
  drop constraint if exists money_transfers_branch_receipt_contract_check,
  add constraint money_transfers_branch_receipt_contract_check check (
    (
      branch_receipt_contract_version is null
      and branch_receipt_status is null
      and branch_received_by_user_id is null
      and branch_received_by_name is null
      and branch_received_at is null
    )
    or (
      transfer_type = 'branch'
      and branch_receipt_contract_version = 1
      and branch_receipt_status in ('pending_receipt', 'received')
      and (
        (branch_receipt_status = 'pending_receipt'
          and branch_received_by_user_id is null
          and branch_received_by_name is null
          and branch_received_at is null
          and accounting_date is null)
        or
        (branch_receipt_status = 'received'
          and branch_received_by_user_id is not null
          and nullif(btrim(branch_received_by_name), '') is not null
          and branch_received_at is not null
          and accounting_date is not null)
      )
    )
  );

create index if not exists money_transfers_branch_receipt_pending_idx
  on public.money_transfers(target_location_id, created_at desc)
  where transfer_type = 'branch'
    and record_status <> 'deleted'
    and branch_receipt_contract_version = 1
    and branch_receipt_status = 'pending_receipt';

create or replace function private.money_transfer_is_financially_effective(
  p_transfer public.money_transfers
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_transfer.transfer_type <> 'branch'
    or p_transfer.branch_receipt_contract_version is null
    or p_transfer.branch_receipt_status = 'received'
$$;

revoke all on function private.money_transfer_is_financially_effective(public.money_transfers)
  from public, anon, authenticated, service_role;

create or replace function private.reject_future_money_transfer_slip()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.transaction_date is not null and new.transaction_date > statement_timestamp() then
    raise exception 'MT_SLIP_FUTURE_DATE: วันเวลาสลิปต้องไม่เกินเวลาปัจจุบัน';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_future_money_transfer_slip on public.money_transfer_slips;
create trigger reject_future_money_transfer_slip
before insert or update of transaction_date on public.money_transfer_slips
for each row execute function private.reject_future_money_transfer_slip();

create table if not exists public.branch_transfer_delete_requests (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid references public.money_transfers(id) on delete set null,
  location_id uuid not null references public.locations(id),
  location_name text not null,
  transfer_display_no text not null,
  amount numeric(14,2) not null check (amount > 0),
  received_at timestamptz not null,
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
    or (request_status in ('approved', 'rejected')
      and decided_by_user_id is not null and decided_at is not null)
  )
);

create unique index if not exists branch_transfer_delete_requests_one_pending
  on public.branch_transfer_delete_requests(transfer_id)
  where request_status = 'pending' and transfer_id is not null;

create index if not exists branch_transfer_delete_requests_status_created
  on public.branch_transfer_delete_requests(request_status, created_at desc);

alter table public.branch_transfer_delete_requests enable row level security;

drop policy if exists "branch transfer delete requests read" on public.branch_transfer_delete_requests;
create policy "branch transfer delete requests read"
  on public.branch_transfer_delete_requests for select to authenticated
  using (
    private.can_access_super_admin_features()
    or requested_by_user_id = auth.uid()
  );

revoke all on public.branch_transfer_delete_requests from anon, authenticated;
grant select on public.branch_transfer_delete_requests to authenticated;
grant all on public.branch_transfer_delete_requests to service_role;

create or replace function public.get_branch_money_transfer_detail(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_transfer public.money_transfers;
begin
  if not private.is_active_user() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ดูรายการโอนเงิน';
  end if;

  select * into v_transfer
  from public.money_transfers transfer
  where transfer.id = p_transfer_id
    and transfer.transfer_type = 'branch'
    and transfer.record_status <> 'deleted';

  if v_transfer.id is null then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
  end if;
  if not private.can_access_location(v_transfer.target_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขาผู้รับ';
  end if;

  return to_jsonb(v_transfer)
    || jsonb_build_object(
      'virtualStatus', case
        when v_transfer.branch_receipt_contract_version = 1
          and v_transfer.branch_receipt_status = 'pending_receipt'
          then 'branch_pending_receipt'
        else 'branch_received'
      end,
      'slips', coalesce((
        select jsonb_agg(to_jsonb(slip) order by slip.sort_order, slip.created_at, slip.id)
        from public.money_transfer_slips slip
        where slip.transfer_id = v_transfer.id
      ), '[]'::jsonb)
    );
end;
$$;

create or replace function public.get_pending_branch_money_transfers(
  p_location_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if not private.is_active_user() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ดูรายการรอยืนยัน';
  end if;
  if not private.can_access_location(p_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขาผู้รับ';
  end if;

  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rows.id,
          'net_amount_to_pay', rows.net_amount_to_pay,
          'created_by_name', rows.created_by_name
        ) order by rows.created_at asc, rows.id asc
      )
      from (
        select
          transfer.id,
          transfer.net_amount_to_pay,
          transfer.created_by_name,
          transfer.created_at
        from public.money_transfers transfer
        where transfer.target_location_id = p_location_id
          and transfer.transfer_type = 'branch'
          and transfer.record_status <> 'deleted'
          and transfer.branch_receipt_contract_version = 1
          and transfer.branch_receipt_status = 'pending_receipt'
        order by transfer.created_at asc, transfer.id asc
        limit v_limit
      ) rows
    ), '[]'::jsonb),
    'total', (
      select count(*)
      from public.money_transfers transfer
      where transfer.target_location_id = p_location_id
        and transfer.transfer_type = 'branch'
        and transfer.record_status <> 'deleted'
        and transfer.branch_receipt_contract_version = 1
        and transfer.branch_receipt_status = 'pending_receipt'
    )
  );
end;
$$;

create or replace function public.get_pending_branch_money_transfers(p_location_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_pending_branch_money_transfers(p_location_id, 20)
$$;

create or replace function public.receive_branch_money_transfer(
  p_transfer_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.money_transfers;
  v_actor_name text;
  v_target_location_id uuid;
begin
  if not private.is_active_user() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ยืนยันรับเงิน';
  end if;
  if p_transfer_id is null or p_expected_revision is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลยืนยันรับเงินไม่ครบ';
  end if;

  select transfer.target_location_id into v_target_location_id
  from public.money_transfers transfer
  where transfer.id = p_transfer_id;
  if v_target_location_id is null then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงินรอยืนยัน';
  end if;
  if not private.can_access_location(v_target_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขาผู้รับ';
  end if;
  perform private.lock_report_locations(array[v_target_location_id]);

  select * into v_transfer
  from public.money_transfers transfer
  where transfer.id = p_transfer_id
  for update;

  if v_transfer.id is null or v_transfer.record_status = 'deleted'
    or v_transfer.transfer_type <> 'branch'
    or v_transfer.branch_receipt_contract_version <> 1 then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงินรอยืนยัน';
  end if;
  if v_transfer.target_location_id is distinct from v_target_location_id then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;
  if not private.can_access_location(v_transfer.target_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขาผู้รับ';
  end if;

  if v_transfer.branch_receipt_status = 'received' then
    return public.get_branch_money_transfer_detail(v_transfer.id)
      || jsonb_build_object('idempotentReplay', true);
  end if;
  if v_transfer.revision_no <> p_expected_revision then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;

  select profile.name into v_actor_name
  from public.profiles profile
  where profile.id = auth.uid();

  update public.money_transfers transfer set
    branch_receipt_status = 'received',
    branch_received_by_user_id = auth.uid(),
    branch_received_by_name = coalesce(nullif(btrim(v_actor_name), ''), 'ผู้ใช้งาน'),
    branch_received_at = statement_timestamp(),
    accounting_date = (statement_timestamp() at time zone 'Asia/Bangkok')::date,
    revision_no = transfer.revision_no + 1,
    updated_at = statement_timestamp()
  where transfer.id = v_transfer.id;

  return public.get_branch_money_transfer_detail(v_transfer.id)
    || jsonb_build_object('idempotentReplay', false);
end;
$$;

create or replace function public.request_branch_money_transfer_delete(
  p_transfer_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.money_transfers;
  v_requires_approval boolean;
  v_existing_request_id uuid;
  v_request_id uuid;
  v_actor_name text;
  v_actor_phone text;
  v_locked_location_id uuid;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ลบรายการโอนเงิน';
  end if;
  if p_transfer_id is null or p_expected_revision is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลลบรายการโอนไม่ครบ';
  end if;

  select transfer.location_id into v_locked_location_id
  from public.money_transfers transfer
  where transfer.id = p_transfer_id;
  if v_locked_location_id is null then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
  end if;
  if not private.can_access_location(v_locked_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา';
  end if;
  perform private.lock_report_locations(array[v_locked_location_id]);

  select * into v_transfer
  from public.money_transfers transfer
  where transfer.id = p_transfer_id
  for update;

  if v_transfer.id is null or v_transfer.record_status = 'deleted'
    or v_transfer.transfer_type <> 'branch' then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
  end if;
  if v_transfer.location_id is distinct from v_locked_location_id
    or v_transfer.revision_no <> p_expected_revision then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;
  if v_transfer.branch_receipt_contract_version is distinct from 1 then
    raise exception 'MT_LEGACY_BRANCH_READ_ONLY: รายการรุ่นเดิมดูได้อย่างเดียว';
  end if;
  if v_transfer.created_by_user_id is distinct from auth.uid() then
    raise exception 'MT_DELETE_CREATOR_ONLY: เฉพาะผู้สร้างรายการเท่านั้นที่ลบได้';
  end if;
  if not private.can_access_location(v_transfer.location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา';
  end if;

  if public.report_lock_no(v_transfer) is not null then
    raise exception 'MT_REPORT_LOCKED: รายการถูกล็อกโดยรายงาน';
  end if;

  if v_transfer.branch_receipt_contract_version = 1
    and v_transfer.branch_receipt_status = 'pending_receipt' then
    return public.delete_money_transfer_before_branch_receipt(v_transfer.id, v_transfer.revision_no);
  end if;

  select request.id into v_existing_request_id
  from public.branch_transfer_delete_requests request
  where request.transfer_id = v_transfer.id
    and request.request_status = 'pending'
  for update;

  if v_existing_request_id is not null then
    return jsonb_build_object(
      'id', v_transfer.id,
      'status', 'pending_approval',
      'requestId', v_existing_request_id
    );
  end if;

  select coalesce(setting.cash_transfer_delete_requires_approval, true)
  into v_requires_approval
  from public.income_expense_approval_settings setting
  where setting.id = true;

  if not coalesce(v_requires_approval, true) then
    return public.delete_money_transfer_before_branch_receipt(v_transfer.id, v_transfer.revision_no);
  end if;

  select profile.name, profile.phone into v_actor_name, v_actor_phone
  from public.profiles profile
  where profile.id = auth.uid();

  insert into public.branch_transfer_delete_requests (
    transfer_id, location_id, location_name, transfer_display_no, amount, received_at,
    requested_by_user_id, requested_by_name, requested_by_phone
  ) values (
    v_transfer.id,
    v_transfer.location_id,
    coalesce(v_transfer.target_location_name, 'ไม่ทราบสาขา'),
    'TR-' || left(v_transfer.id::text, 8),
    v_transfer.net_amount_to_pay,
    coalesce(v_transfer.branch_received_at, v_transfer.updated_at, v_transfer.created_at),
    auth.uid(),
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, '')
  ) returning id into v_request_id;

  return jsonb_build_object(
    'id', v_transfer.id,
    'status', 'pending_approval',
    'requestId', v_request_id
  );
end;
$$;

create or replace function public.decide_branch_transfer_delete_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.branch_transfer_delete_requests%rowtype;
  v_transfer public.money_transfers;
  v_decider_name text;
  v_decider_phone text;
  v_locked_location_id uuid;
  v_locked_transfer_id uuid;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'คำตัดสินไม่ถูกต้อง';
  end if;

  if p_decision = 'approved' then
    select request.location_id, request.transfer_id
    into v_locked_location_id, v_locked_transfer_id
    from public.branch_transfer_delete_requests request
    where request.id = p_request_id;
    if v_locked_location_id is null or v_locked_transfer_id is null then
      raise exception 'ไม่พบคำขอลบรายการโอนเงิน';
    end if;
    perform private.lock_report_locations(array[v_locked_location_id]);
  end if;

  select * into v_request
  from public.branch_transfer_delete_requests request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'ไม่พบคำขอลบรายการโอนเงิน';
  end if;
  if v_request.request_status <> 'pending' then
    raise exception 'คำขอนี้ถูกดำเนินการแล้ว';
  end if;

  if p_decision = 'approved' then
    if v_request.location_id is distinct from v_locked_location_id
      or v_request.transfer_id is distinct from v_locked_transfer_id then
      raise exception 'คำขอลบถูกแก้ไขแล้ว กรุณาลองใหม่';
    end if;
    select * into v_transfer
    from public.money_transfers transfer
    where transfer.id = v_request.transfer_id
    for update;

    if v_transfer.id is null or v_transfer.record_status = 'deleted' then
      raise exception 'ไม่พบรายการโอนเงินต้นทาง';
    end if;
    if public.report_lock_no(v_transfer) is not null then
      raise exception 'MT_REPORT_LOCKED: รายการถูกล็อกโดยรายงาน';
    end if;

    perform public.delete_money_transfer_before_branch_receipt(v_transfer.id, v_transfer.revision_no);
  end if;

  select profile.name, profile.phone into v_decider_name, v_decider_phone
  from public.profiles profile
  where profile.id = auth.uid();

  update public.branch_transfer_delete_requests request set
    request_status = p_decision,
    decided_by_user_id = auth.uid(),
    decided_by_name = coalesce(v_decider_name, ''),
    decided_by_phone = coalesce(v_decider_phone, ''),
    decided_at = statement_timestamp(),
    decision_comment = nullif(btrim(p_comment), ''),
    updated_at = statement_timestamp()
  where request.id = p_request_id;

  return jsonb_build_object('status', p_decision, 'requestId', p_request_id);
end;
$$;

revoke all on function public.get_branch_money_transfer_detail(uuid) from public, anon;
revoke all on function public.get_pending_branch_money_transfers(uuid, integer) from public, anon;
revoke all on function public.get_pending_branch_money_transfers(uuid) from public, anon;
revoke all on function public.receive_branch_money_transfer(uuid, integer) from public, anon;
revoke all on function public.request_branch_money_transfer_delete(uuid, integer) from public, anon;
revoke all on function public.decide_branch_transfer_delete_request(uuid, text, text) from public, anon;

grant execute on function public.get_branch_money_transfer_detail(uuid) to authenticated;
grant execute on function public.get_pending_branch_money_transfers(uuid, integer) to authenticated;
grant execute on function public.get_pending_branch_money_transfers(uuid) to authenticated;
grant execute on function public.receive_branch_money_transfer(uuid, integer) to authenticated;
grant execute on function public.request_branch_money_transfer_delete(uuid, integer) to authenticated;
grant execute on function public.decide_branch_transfer_delete_request(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
