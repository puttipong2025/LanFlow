-- Replace destructive pending merge with customer-identity payment bundles.
-- Destination accounts belong to the parent; child snapshots are preserved.
drop function if exists public.merge_pending_money_transfers(uuid);

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
    ) then
      raise exception 'MT_BUNDLE_DESTINATION_MISMATCH: ลูกค้าไม่ตรงกับชุด';
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
  if p_bundle_type is null or p_bundle_type not in ('customer', 'rubber_export_work') then
    raise exception 'MT_BUNDLE_INVALID_TYPE: ประเภทชุดไม่ถูกต้อง';
  end if;
  if p_bundle_type = 'customer' and p_customer_id is null then
    raise exception 'MT_BUNDLE_DESTINATION_REQUIRED: กรุณาเลือกลูกค้า';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then raise exception 'MT_INVALID_PAGE_SIZE'; end if;
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
        or transfer.customer_id = p_customer_id
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
  v_account public.customer_bank_accounts;
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
  if p_bundle_type is null or p_bundle_type not in ('customer', 'rubber_export_work') then
    raise exception 'MT_BUNDLE_INVALID_TYPE: ประเภทชุดไม่ถูกต้อง';
  end if;
  if p_bundle_type = 'customer' and p_customer_id is null then
    raise exception 'MT_BUNDLE_DESTINATION_REQUIRED: กรุณาเลือกลูกค้า';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'payment-bundle:' || p_location_id::text || ':' || p_bundle_type || ':'
      || coalesce(p_customer_id::text, '') || ':' || coalesce(btrim(p_account_number), ''), 0
  ));
  select * into v_actor from public.profiles where id = auth.uid() and is_active;
  if p_bundle_type = 'customer' then
    select account.* into v_account
    from public.customer_bank_accounts account
    join public.customers customer on customer.id = account.customer_id
    where account.customer_id = p_customer_id
      and private.can_access_optional_location(customer.default_location_id)
      and (nullif(btrim(p_account_number), '') is null or account.account_number = p_account_number)
    order by account.is_primary desc, account.id
    limit 1;
    if nullif(btrim(p_account_number), '') is not null and v_account.id is null then
      raise exception 'MT_BUNDLE_INVALID_ACCOUNT: กรุณาเลือกบัญชีของลูกค้ารายนี้ใหม่';
    end if;
  end if;

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
      or bundle.customer_id = p_customer_id
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
        or child.customer_id = p_customer_id)
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
      case when p_bundle_type = 'customer' then v_account.account_number end,
      case when p_bundle_type = 'customer' then v_account.account_name end,
      case when p_bundle_type = 'customer' then v_account.bank_name end,
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
        or child.customer_id = p_customer_id)
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
  if p_bundle_type = 'customer' and (
    select count(*) from public.money_transfers
    where bundle_parent_id = v_bundle.id and record_status = 'active'
  ) < 2 then
    raise exception 'MT_BUNDLE_MIN_CHILDREN: ต้องมีรายการของลูกค้าคนเดียวกันอย่างน้อย 2 รายการ';
  end if;
  if v_due <= 0 then raise exception 'MT_BUNDLE_NO_ELIGIBLE_CHILDREN: ไม่มีรายการที่มียอดคงเหลือ'; end if;

  update public.money_transfers
  set net_amount_to_pay = v_due,
      account_number = case when p_bundle_type = 'customer' then v_account.account_number else null end,
      account_name = case when p_bundle_type = 'customer' then v_account.account_name else null end,
      bank_name = case when p_bundle_type = 'customer' then v_account.bank_name else null end,
      revision_no = case when v_new then revision_no else revision_no + case when v_linked > 0 or account_number is distinct from v_account.account_number then 1 else 0 end end,
      updated_at = now()
  where id = v_bundle.id;
  v_result := public.get_payment_bundle_detail(v_bundle.id);
  perform set_config('app.payment_bundle_mutation', 'off', true);
  return v_result;
end;
$$;

create or replace function public.get_payment_bundle_customer_options(p_location_id uuid)
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
  select coalesce(jsonb_agg(to_jsonb(option) order by option.customer_id), '[]'::jsonb)
  into v_result
  from (
    select transfer.customer_id, count(*) eligible_count
    from public.money_transfers transfer
    join public.customers customer on customer.id = transfer.customer_id
    where transfer.location_id = p_location_id
      and private.can_access_optional_location(customer.default_location_id)
      and transfer.transfer_type = 'customer'
      and not transfer.is_payment_bundle and transfer.bundle_parent_id is null
      and transfer.record_status = 'active' and transfer.sync_status = 'synced'
      and transfer.transfer_method = 'bank' and transfer.transfer_status in ('pending', 'partial')
      and private.active_transfer_report_no(transfer.id) is null
      and transfer.net_amount_to_pay > coalesce((
        select sum(slip.amount) from public.money_transfer_slips slip where slip.transfer_id = transfer.id
      ), 0)
    group by transfer.customer_id
    having count(*) >= 2
  ) option;
  return v_result;
end;
$$;

revoke all on function public.get_payment_bundle_customer_options(uuid) from public, anon;
grant execute on function public.get_payment_bundle_customer_options(uuid) to authenticated;
notify pgrst, 'reload schema';
