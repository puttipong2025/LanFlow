-- Destination snapshot changes must invalidate stale saves, even when the account number is unchanged.
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
      revision_no = case when v_new then revision_no else revision_no + case when v_linked > 0
        or account_number is distinct from v_account.account_number
        or account_name is distinct from v_account.account_name
        or bank_name is distinct from v_account.bank_name
        then 1 else 0 end end,
      updated_at = now()
  where id = v_bundle.id;
  v_result := public.get_payment_bundle_detail(v_bundle.id);
  perform set_config('app.payment_bundle_mutation', 'off', true);
  return v_result;
end;
$$;
