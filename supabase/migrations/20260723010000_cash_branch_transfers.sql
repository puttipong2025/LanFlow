-- Cash branch transfers are source-owned money transfers with a separate
-- physical-cash receipt workflow. Bank transfers keep their existing flow.

alter table public.money_transfers
  add column if not exists transfer_method text not null default 'bank'
    check (transfer_method in ('bank', 'cash'));

update public.money_transfers set transfer_method = 'bank' where transfer_method is null;

create table if not exists public.money_transfer_cash_details (
  transfer_id uuid primary key references public.money_transfers(id) on delete cascade,
  sent_coin_1_count integer not null check (sent_coin_1_count >= 0),
  sent_coin_2_count integer not null check (sent_coin_2_count >= 0),
  sent_coin_5_count integer not null check (sent_coin_5_count >= 0),
  sent_coin_10_count integer not null check (sent_coin_10_count >= 0),
  sent_banknote_20_count integer not null check (sent_banknote_20_count >= 0),
  sent_banknote_50_count integer not null check (sent_banknote_50_count >= 0),
  sent_banknote_100_count integer not null check (sent_banknote_100_count >= 0),
  sent_banknote_500_count integer not null check (sent_banknote_500_count >= 0),
  sent_banknote_1000_count integer not null check (sent_banknote_1000_count >= 0),
  received_coin_1_count integer check (received_coin_1_count >= 0),
  received_coin_2_count integer check (received_coin_2_count >= 0),
  received_coin_5_count integer check (received_coin_5_count >= 0),
  received_coin_10_count integer check (received_coin_10_count >= 0),
  received_banknote_20_count integer check (received_banknote_20_count >= 0),
  received_banknote_50_count integer check (received_banknote_50_count >= 0),
  received_banknote_100_count integer check (received_banknote_100_count >= 0),
  received_banknote_500_count integer check (received_banknote_500_count >= 0),
  received_banknote_1000_count integer check (received_banknote_1000_count >= 0),
  sent_total numeric(12,2) generated always as (
    sent_coin_1_count + sent_coin_2_count * 2 + sent_coin_5_count * 5 + sent_coin_10_count * 10 +
    sent_banknote_20_count * 20 + sent_banknote_50_count * 50 + sent_banknote_100_count * 100 +
    sent_banknote_500_count * 500 + sent_banknote_1000_count * 1000
  ) stored,
  received_total numeric(12,2) generated always as (
    case when received_coin_1_count is null then null else
      received_coin_1_count + received_coin_2_count * 2 + received_coin_5_count * 5 + received_coin_10_count * 10 +
      received_banknote_20_count * 20 + received_banknote_50_count * 50 + received_banknote_100_count * 100 +
      received_banknote_500_count * 500 + received_banknote_1000_count * 1000
    end
  ) stored,
  difference_total numeric(12,2) generated always as (
    case when received_coin_1_count is null then null else
      (received_coin_1_count - sent_coin_1_count) + (received_coin_2_count - sent_coin_2_count) * 2 +
      (received_coin_5_count - sent_coin_5_count) * 5 + (received_coin_10_count - sent_coin_10_count) * 10 +
      (received_banknote_20_count - sent_banknote_20_count) * 20 + (received_banknote_50_count - sent_banknote_50_count) * 50 +
      (received_banknote_100_count - sent_banknote_100_count) * 100 + (received_banknote_500_count - sent_banknote_500_count) * 500 +
      (received_banknote_1000_count - sent_banknote_1000_count) * 1000
    end
  ) stored,
  cash_status text not null default 'pending_receipt'
    check (cash_status in ('pending_receipt', 'received', 'mismatched', 'difference_accepted')),
  note text,
  sent_at timestamptz not null default now(),
  received_by_user_id uuid references public.profiles(id),
  received_by_name text,
  received_by_phone text,
  received_at timestamptz,
  difference_accepted_by_user_id uuid references public.profiles(id),
  difference_accept_reason text,
  difference_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sent_total > 0),
  check (
    (
      cash_status = 'pending_receipt'
      and num_nonnulls(
        received_coin_1_count, received_coin_2_count, received_coin_5_count, received_coin_10_count,
        received_banknote_20_count, received_banknote_50_count, received_banknote_100_count,
        received_banknote_500_count, received_banknote_1000_count
      ) = 0
      and received_by_user_id is null
      and received_at is null
    )
    or (
      cash_status in ('received', 'mismatched', 'difference_accepted')
      and num_nonnulls(
        received_coin_1_count, received_coin_2_count, received_coin_5_count, received_coin_10_count,
        received_banknote_20_count, received_banknote_50_count, received_banknote_100_count,
        received_banknote_500_count, received_banknote_1000_count
      ) = 9
      and received_by_user_id is not null
      and received_at is not null
    )
  ),
  check (
    (cash_status = 'pending_receipt' and difference_total is null)
    or (cash_status = 'received' and difference_total = 0)
    or (cash_status in ('mismatched', 'difference_accepted') and difference_total <> 0)
  ),
  check (
    cash_status <> 'difference_accepted'
    or (difference_accepted_by_user_id is not null and nullif(btrim(difference_accept_reason), '') is not null and difference_accepted_at is not null)
  )
);

create index if not exists money_transfer_cash_details_status_idx
  on public.money_transfer_cash_details(cash_status, sent_at desc);

create or replace function private.cash_transfer_counts(payload jsonb, prefix text)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  keys text[] := array['coin1', 'coin2', 'coin5', 'coin10', 'banknote20', 'banknote50', 'banknote100', 'banknote500', 'banknote1000'];
  result integer[] := array[]::integer[];
  key text;
  value integer;
begin
  foreach key in array keys loop
    if payload #>> array[prefix, key] is null then raise exception 'กรอกจำนวนเงินสดให้ครบทุกช่อง'; end if;
    value := (payload #>> array[prefix, key])::integer;
    if value < 0 then raise exception 'จำนวนเงินสดต้องเป็นศูนย์หรือมากกว่า'; end if;
    result := array_append(result, value);
  end loop;
  return result;
end;
$$;

create or replace function public.create_cash_branch_transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  actor_id uuid := auth.uid(); actor_name text; actor_phone text;
  source_id uuid := (payload->>'sourceLocationId')::uuid;
  target_id uuid := (payload->>'targetLocationId')::uuid;
  target_name text; counts integer[]; new_transfer_id uuid := coalesce((payload->>'id')::uuid, gen_random_uuid());
  existing_transfer_id uuid;
begin
  if not private.is_active_user() or not private.can_access_location(source_id) then raise exception 'ไม่มีสิทธิ์สร้างรายการสำหรับสาขานี้'; end if;
  if source_id is null or target_id is null or source_id = target_id then raise exception 'สาขาปลายทางต้องต่างจากสาขาต้นทาง'; end if;
  select id into existing_transfer_id
  from public.money_transfers
  where idempotency_key = coalesce(payload->>'idempotencyKey', 'cash:' || new_transfer_id::text)
    and transfer_method = 'cash'
    and location_id = source_id
    and created_by_user_id = actor_id;
  if existing_transfer_id is not null then return jsonb_build_object('id', existing_transfer_id, 'status', 'synced'); end if;
  select name, phone into actor_name, actor_phone from public.profiles where id = actor_id;
  select name into target_name from public.locations where id = target_id and is_active = true;
  if target_name is null then raise exception 'ไม่พบสาขาปลายทางที่ใช้งาน'; end if;
  counts := private.cash_transfer_counts(payload, 'sent');
  insert into public.money_transfers (id, client_temp_id, idempotency_key, location_id, target_location_id, target_location_name, net_amount_to_pay, transfer_type, transfer_method, transfer_status, created_by_user_id, created_by_name, created_by_phone, revision_no, record_status)
  values (new_transfer_id, coalesce(payload->>'clientTempId', new_transfer_id::text), coalesce(payload->>'idempotencyKey', 'cash:' || new_transfer_id::text), source_id, target_id, target_name, 0, 'cash', 'cash', 'pending', actor_id, coalesce(actor_name, ''), coalesce(actor_phone, ''), 0, 'active');
  insert into public.money_transfer_cash_details (transfer_id, sent_coin_1_count, sent_coin_2_count, sent_coin_5_count, sent_coin_10_count, sent_banknote_20_count, sent_banknote_50_count, sent_banknote_100_count, sent_banknote_500_count, sent_banknote_1000_count, note)
  values (new_transfer_id, counts[1], counts[2], counts[3], counts[4], counts[5], counts[6], counts[7], counts[8], counts[9], nullif(btrim(payload->>'note'), ''));
  update public.money_transfers set net_amount_to_pay = d.sent_total, updated_at = now() from public.money_transfer_cash_details d where money_transfers.id = new_transfer_id and d.transfer_id = new_transfer_id;
  return jsonb_build_object('id', new_transfer_id, 'status', 'synced');
end;
$$;

create or replace function public.update_cash_branch_transfer(p_transfer_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  transfer_row public.money_transfers%rowtype;
  target_id uuid := (payload->>'targetLocationId')::uuid;
  target_name text;
  counts integer[];
begin
  select * into transfer_row from public.money_transfers where id = p_transfer_id for update;
  if transfer_row.id is null or transfer_row.transfer_method <> 'cash' then raise exception 'ไม่พบรายการเงินสด'; end if;
  if not private.is_active_user() or not private.can_access_location(transfer_row.location_id) then raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้'; end if;
  if auth.uid() <> transfer_row.created_by_user_id and not private.is_super_admin() then raise exception 'ผู้สร้างหรือ super_admin เท่านั้นที่แก้ไขได้'; end if;
  if target_id is null or target_id = transfer_row.location_id then raise exception 'สาขาปลายทางต้องต่างจากสาขาต้นทาง'; end if;
  if not exists (select 1 from public.money_transfer_cash_details where transfer_id = p_transfer_id and cash_status = 'pending_receipt') then raise exception 'แก้ไขได้ก่อนตรวจรับเงินเท่านั้น'; end if;
  select name into target_name from public.locations where id = target_id and is_active = true;
  if target_name is null then raise exception 'ไม่พบสาขาปลายทางที่ใช้งาน'; end if;
  counts := private.cash_transfer_counts(payload, 'sent');
  update public.money_transfer_cash_details set
    sent_coin_1_count = counts[1], sent_coin_2_count = counts[2], sent_coin_5_count = counts[3], sent_coin_10_count = counts[4],
    sent_banknote_20_count = counts[5], sent_banknote_50_count = counts[6], sent_banknote_100_count = counts[7], sent_banknote_500_count = counts[8], sent_banknote_1000_count = counts[9],
    note = nullif(btrim(payload->>'note'), ''), updated_at = now()
  where transfer_id = p_transfer_id;
  update public.money_transfers set
    target_location_id = target_id, target_location_name = target_name,
    net_amount_to_pay = d.sent_total, revision_no = revision_no + 1, updated_at = now()
  from public.money_transfer_cash_details d
  where money_transfers.id = p_transfer_id and d.transfer_id = p_transfer_id;
  return jsonb_build_object('id', p_transfer_id, 'status', 'synced');
end;
$$;

create or replace function public.receive_cash_branch_transfer(p_transfer_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  transfer_row public.money_transfers%rowtype; counts integer[]; actor_id uuid := auth.uid(); actor_name text; actor_phone text; total numeric; sent numeric;
begin
  select * into transfer_row from public.money_transfers where id = p_transfer_id for update;
  if transfer_row.id is null or transfer_row.transfer_method <> 'cash' then raise exception 'ไม่พบรายการเงินสด'; end if;
  if not private.can_access_location(transfer_row.target_location_id) then raise exception 'ไม่มีสิทธิ์ตรวจรับสาขานี้'; end if;
  counts := private.cash_transfer_counts(payload, 'received');
  select name, phone into actor_name, actor_phone from public.profiles where id = actor_id;
  update public.money_transfer_cash_details set
    received_coin_1_count = counts[1], received_coin_2_count = counts[2], received_coin_5_count = counts[3], received_coin_10_count = counts[4],
    received_banknote_20_count = counts[5], received_banknote_50_count = counts[6], received_banknote_100_count = counts[7], received_banknote_500_count = counts[8], received_banknote_1000_count = counts[9],
    received_by_user_id = actor_id, received_by_name = coalesce(actor_name, ''), received_by_phone = coalesce(actor_phone, ''), received_at = now(), updated_at = now(),
    cash_status = case when counts[1] + counts[2] * 2 + counts[3] * 5 + counts[4] * 10 + counts[5] * 20 + counts[6] * 50 + counts[7] * 100 + counts[8] * 500 + counts[9] * 1000 = sent_total then 'received' else 'mismatched' end
  where transfer_id = p_transfer_id and cash_status = 'pending_receipt'
  returning received_total, sent_total into total, sent;
  if not found then raise exception 'รายการนี้ถูกตรวจรับแล้ว'; end if;
  update public.money_transfers set transfer_status = 'paid', revision_no = revision_no + 1, updated_at = now() where id = p_transfer_id;
  return jsonb_build_object('id', p_transfer_id, 'status', 'synced', 'mismatched', total <> sent);
end;
$$;

create or replace function public.accept_cash_branch_difference(p_transfer_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare actor_id uuid := auth.uid(); actor_name text; actor_phone text;
begin
  if not private.is_super_admin() then raise exception 'เฉพาะ super_admin เท่านั้นที่ยอมรับผลต่างได้'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'กรุณาระบุเหตุผลยอมรับผลต่าง'; end if;
  select name, phone into actor_name, actor_phone from public.profiles where id = actor_id;
  update public.money_transfer_cash_details set cash_status = 'difference_accepted', difference_accepted_by_user_id = actor_id, difference_accept_reason = btrim(p_reason), difference_accepted_at = now(), updated_at = now()
  where transfer_id = p_transfer_id and cash_status = 'mismatched';
  if not found then raise exception 'รายการนี้ไม่อยู่ในสถานะยอดไม่ตรง'; end if;
  return jsonb_build_object('id', p_transfer_id, 'status', 'synced');
end;
$$;

create or replace function public.delete_cash_branch_transfer(p_transfer_id uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if not private.is_super_admin() then raise exception 'เฉพาะ super_admin เท่านั้นที่ลบรายการเงินสดได้'; end if;
  delete from public.money_transfers where id = p_transfer_id and transfer_method = 'cash';
  if not found then raise exception 'ไม่พบรายการเงินสด'; end if;
  return jsonb_build_object('id', p_transfer_id, 'status', 'synced');
end;
$$;

alter table public.money_transfer_cash_details enable row level security;
create policy "cash details source or target select" on public.money_transfer_cash_details for select to authenticated using (
  exists (select 1 from public.money_transfers t where t.id = transfer_id and (private.can_access_location(t.location_id) or private.can_access_location(t.target_location_id)))
);

revoke all on public.money_transfer_cash_details from anon, authenticated;
revoke all on function public.create_cash_branch_transfer(jsonb) from public, anon;
revoke all on function public.update_cash_branch_transfer(uuid, jsonb) from public, anon;
revoke all on function public.receive_cash_branch_transfer(uuid, jsonb) from public, anon;
revoke all on function public.accept_cash_branch_difference(uuid, text) from public, anon;
revoke all on function public.delete_cash_branch_transfer(uuid) from public, anon;
grant select on public.money_transfer_cash_details to authenticated;
grant all on public.money_transfer_cash_details to service_role;
grant execute on function public.create_cash_branch_transfer(jsonb), public.update_cash_branch_transfer(uuid, jsonb), public.receive_cash_branch_transfer(uuid, jsonb), public.accept_cash_branch_difference(uuid, text), public.delete_cash_branch_transfer(uuid) to authenticated;
