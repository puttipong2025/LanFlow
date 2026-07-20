-- Stock-owned entry deletion is approval-gated.
-- Derived movements from income sales and rubber bills remain controlled by their source modules.

create table if not exists public.stock_entry_approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_status text not null default 'pending'
    check (request_status in ('pending', 'approved', 'rejected', 'cancelled')),
  request_type text not null default 'delete_stock_entry'
    check (request_type in ('delete_stock_entry')),
  request_idempotency_key text not null unique,
  requested_payload jsonb not null,
  stock_entry_id uuid not null references public.stock_entries(id),
  transfer_bill_no text,
  tx_type text not null check (tx_type in ('receive', 'transfer_out')),
  product_id uuid not null references public.stock_products(id),
  product_name text not null,
  quantity numeric(12,2) not null,
  location_id uuid not null references public.locations(id),
  location_name text not null,
  target_location_id uuid references public.locations(id),
  target_location_name text,
  requested_by_user_id uuid not null references public.profiles(id),
  requested_by_name text not null,
  requested_by_phone text not null,
  decided_by_user_id uuid references public.profiles(id),
  decided_by_name text,
  decided_by_phone text,
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stock_entry_approval_requests_status_created_idx
  on public.stock_entry_approval_requests(request_status, created_at desc);

create unique index if not exists stock_entry_approval_requests_pending_entry_idx
  on public.stock_entry_approval_requests(stock_entry_id)
  where request_status = 'pending';

create unique index if not exists stock_entry_approval_requests_pending_transfer_idx
  on public.stock_entry_approval_requests(transfer_bill_no)
  where request_status = 'pending'
    and transfer_bill_no is not null
    and tx_type = 'transfer_out';

alter table public.stock_entry_approval_requests enable row level security;

drop policy if exists "stock_entry_approval_requests_read" on public.stock_entry_approval_requests;

create policy "stock_entry_approval_requests_read"
  on public.stock_entry_approval_requests for select to authenticated
  using (
    public.can_access_super_admin_features()
    or requested_by_user_id = auth.uid()
    or public.can_access_location(location_id)
    or (target_location_id is not null and public.can_access_location(target_location_id))
  );

revoke all on table public.stock_entry_approval_requests from anon, authenticated;
grant select on table public.stock_entry_approval_requests to authenticated;
grant all privileges on table public.stock_entry_approval_requests to service_role;

create or replace function public.validate_stock_non_negative_after_entry_delete(
  p_location_id uuid,
  p_product_id uuid,
  p_deleted_entry_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric := 0;
  v_movement record;
begin
  for v_movement in
    select
      movement_id,
      source_type,
      source_id,
      tx_date,
      display_bill_no,
      quantity_delta
    from public.stock_movements
    where location_id = p_location_id
      and product_id = p_product_id
      and not (
        source_type = 'stock_entry'
        and source_id = any(p_deleted_entry_ids)
      )
    order by tx_date asc, movement_id asc
  loop
    v_balance := v_balance + coalesce(v_movement.quantity_delta, 0);

    if v_balance < -0.000001 then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'ลบรายการนี้ไม่ได้ เพราะรายการ ' || coalesce(v_movement.display_bill_no, v_movement.movement_id) || ' วันที่ ' || v_movement.tx_date::text || ' จะทำให้สต็อกติดลบ'
      );
    end if;
  end loop;

  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.create_stock_entry_delete_approval_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_user boolean;
  v_user_id uuid;
  v_user_name text;
  v_user_phone text;
  v_request_key text;
  v_entry_id uuid;
  v_entry public.stock_entries%rowtype;
  v_location_name text;
  v_target_entry public.stock_entries%rowtype;
  v_target_location_name text;
  v_existing_id uuid;
  v_existing_status text;
  v_request_id uuid;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_entry_id := nullif(payload->>'stockEntryId', '')::uuid;
  if v_entry_id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการสต็อก');
  end if;

  select *
    into v_entry
  from public.stock_entries
  where id = v_entry_id
  for update;

  if v_entry.id is null or v_entry.record_status != 'active' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการสต็อกที่ลบได้');
  end if;

  if v_entry.tx_type = 'transfer_in' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการย้ายสต็อกต้องลบจากฝั่งย้ายออกเท่านั้น');
  end if;

  if v_entry.tx_type not in ('receive', 'transfer_out') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ลบได้เฉพาะรายการรับเข้า หรือย้ายออก');
  end if;

  if not public.can_access_location(v_entry.location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  select name into v_location_name
  from public.locations
  where id = v_entry.location_id;

  if v_entry.tx_type = 'transfer_out' then
    if v_entry.transfer_bill_no is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการย้ายนี้ไม่สมบูรณ์');
    end if;

    select *
      into v_target_entry
    from public.stock_entries
    where transfer_bill_no = v_entry.transfer_bill_no
      and product_id = v_entry.product_id
      and tx_type = 'transfer_in'
      and record_status = 'active'
    limit 1;

    if v_target_entry.id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการย้ายเข้าคู่กัน');
    end if;

    select name into v_target_location_name
    from public.locations
    where id = v_target_entry.location_id;

    select id, request_status
      into v_existing_id, v_existing_status
    from public.stock_entry_approval_requests
    where request_status = 'pending'
      and transfer_bill_no = v_entry.transfer_bill_no
      and tx_type = 'transfer_out'
    limit 1;
  else
    select id, request_status
      into v_existing_id, v_existing_status
    from public.stock_entry_approval_requests
    where request_status = 'pending'
      and stock_entry_id = v_entry.id
    limit 1;
  end if;

  if v_existing_id is not null then
    return jsonb_build_object(
      'status', 'pending',
      'requestId', v_existing_id,
      'requestStatus', v_existing_status
    );
  end if;

  v_request_key := nullif(payload->>'requestIdempotencyKey', '');
  if v_request_key is null then
    v_request_key := gen_random_uuid()::text;
  end if;

  v_user_id := auth.uid();
  select name, phone into v_user_name, v_user_phone
  from public.profiles
  where id = v_user_id;

  insert into public.stock_entry_approval_requests (
    request_idempotency_key,
    requested_payload,
    stock_entry_id,
    transfer_bill_no,
    tx_type,
    product_id,
    product_name,
    quantity,
    location_id,
    location_name,
    target_location_id,
    target_location_name,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  ) values (
    v_request_key,
    jsonb_build_object(
      'action', 'delete_stock_entry',
      'stockEntryId', v_entry.id,
      'transferBillNo', v_entry.transfer_bill_no
    ),
    v_entry.id,
    v_entry.transfer_bill_no,
    v_entry.tx_type,
    v_entry.product_id,
    v_entry.product_name,
    abs(v_entry.quantity_delta),
    v_entry.location_id,
    coalesce(v_location_name, ''),
    case when v_entry.tx_type = 'transfer_out' then v_target_entry.location_id else null end,
    case when v_entry.tx_type = 'transfer_out' then coalesce(v_target_location_name, '') else null end,
    v_user_id,
    coalesce(v_user_name, ''),
    coalesce(v_user_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending',
    'requestId', v_request_id,
    'requestType', 'delete_stock_entry'
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

create or replace function public.decide_stock_entry_delete_approval_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_entry_approval_requests%rowtype;
  v_decider_id uuid;
  v_decider_name text;
  v_decider_phone text;
  v_entry public.stock_entries%rowtype;
  v_entry_ids uuid[];
  v_pair_count integer;
  v_location_id uuid;
  v_validation jsonb;
begin
  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้');
  end if;

  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid decision');
  end if;

  select *
    into v_request
  from public.stock_entry_approval_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบคำขออนุมัติ');
  end if;

  if v_request.request_status != 'pending' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'คำขอนี้ถูกดำเนินการไปแล้ว');
  end if;

  v_decider_id := auth.uid();
  select name, phone into v_decider_name, v_decider_phone
  from public.profiles
  where id = v_decider_id;

  if p_decision = 'rejected' then
    update public.stock_entry_approval_requests
    set request_status = 'rejected',
        decided_by_user_id = v_decider_id,
        decided_by_name = coalesce(v_decider_name, ''),
        decided_by_phone = coalesce(v_decider_phone, ''),
        decided_at = now(),
        decision_comment = p_comment,
        updated_at = now()
    where id = v_request.id;

    return jsonb_build_object('status', 'rejected', 'requestId', v_request.id);
  end if;

  select *
    into v_entry
  from public.stock_entries
  where id = v_request.stock_entry_id
  for update;

  if v_entry.id is null or v_entry.record_status != 'active' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบรายการสต็อกที่ลบได้');
  end if;

  if v_entry.tx_type = 'receive' then
    v_entry_ids := array[v_entry.id];
  elsif v_entry.tx_type = 'transfer_out' then
    perform 1
    from public.stock_entries
    where transfer_bill_no = v_entry.transfer_bill_no
      and product_id = v_entry.product_id
      and record_status = 'active'
      and tx_type in ('transfer_out', 'transfer_in')
    for update;

    select array_agg(id order by tx_type), count(*)
      into v_entry_ids, v_pair_count
    from public.stock_entries
    where transfer_bill_no = v_entry.transfer_bill_no
      and product_id = v_entry.product_id
      and record_status = 'active'
      and tx_type in ('transfer_out', 'transfer_in');

    if coalesce(v_pair_count, 0) != 2 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการย้ายนี้ไม่สมบูรณ์ จึงลบไม่ได้');
    end if;
  else
    return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการย้ายสต็อกต้องลบจากฝั่งย้ายออกเท่านั้น');
  end if;

  for v_location_id in
    select distinct location_id
    from public.stock_entries
    where id = any(v_entry_ids)
  loop
    perform pg_advisory_xact_lock(hashtext('acid-stock:' || v_location_id::text || ':' || v_entry.product_id::text));

    v_validation := public.validate_stock_non_negative_after_entry_delete(
      v_location_id,
      v_entry.product_id,
      v_entry_ids
    );

    if coalesce(v_validation->>'status', 'failed') != 'ok' then
      return v_validation;
    end if;
  end loop;

  update public.stock_entries
  set record_status = 'deleted',
      deleted_at = now(),
      deleted_by_name = coalesce(v_decider_name, ''),
      deleted_by_phone = coalesce(v_decider_phone, ''),
      updated_at = now()
  where id = any(v_entry_ids);

  update public.stock_entry_approval_requests
  set request_status = 'approved',
      decided_by_user_id = v_decider_id,
      decided_by_name = coalesce(v_decider_name, ''),
      decided_by_phone = coalesce(v_decider_phone, ''),
      decided_at = now(),
      decision_comment = p_comment,
      updated_at = now()
  where id = v_request.id;

  return jsonb_build_object(
    'status', 'approved',
    'requestId', v_request.id,
    'deletedEntryIds', to_jsonb(v_entry_ids)
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.validate_stock_non_negative_after_entry_delete(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.create_stock_entry_delete_approval_request(jsonb) from public, anon;
revoke all on function public.decide_stock_entry_delete_approval_request(uuid, text, text) from public, anon;
grant execute on function public.create_stock_entry_delete_approval_request(jsonb) to authenticated;
grant execute on function public.decide_stock_entry_delete_approval_request(uuid, text, text) to authenticated;
