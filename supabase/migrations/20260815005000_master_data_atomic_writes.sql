create or replace function public.save_customer_master_data(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_phone text;
  v_customer_id uuid := nullif(payload->>'customerId', '')::uuid;
  v_location_id uuid := nullif(payload->>'defaultLocationId', '')::uuid;
  v_existing public.customers%rowtype;
begin
  select p.name, p.phone
    into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = v_actor_id
    and p.is_active = true;

  if not found then
    raise exception 'Active authenticated user required' using errcode = '42501';
  end if;

  if v_location_id is null or not private.can_access_location(v_location_id) then
    raise exception 'Location access denied' using errcode = '42501';
  end if;

  if nullif(btrim(payload->>'mainName'), '') is null then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;

  if v_customer_id is null then
    insert into public.customers (
      client_temp_id,
      legacy_rec_id,
      legacy_member_id,
      class,
      main_name,
      fsc_status,
      starting_points_date,
      default_location_id,
      created_by_user_id,
      created_by_name,
      created_by_phone,
      sync_status,
      idempotency_key,
      revision_no,
      record_status,
      server_received_at
    ) values (
      nullif(payload->>'clientTempId', ''),
      nullif(payload->>'legacyRecId', ''),
      nullif(payload->>'legacyMemberId', ''),
      nullif(payload->>'class', ''),
      btrim(payload->>'mainName'),
      nullif(payload->>'fscStatus', ''),
      nullif(payload->>'startingPointsDate', '')::date,
      v_location_id,
      v_actor_id,
      coalesce(v_actor_name, ''),
      coalesce(v_actor_phone, ''),
      'synced',
      nullif(payload->>'idempotencyKey', ''),
      0,
      'active',
      now()
    )
    returning id into v_customer_id;
  else
    select *
      into v_existing
    from public.customers
    where id = v_customer_id
    for update;

    if not found then
      raise exception 'Customer not found' using errcode = 'P0002';
    end if;

    if v_existing.default_location_id is not null
       and not private.can_access_location(v_existing.default_location_id) then
      raise exception 'Customer access denied' using errcode = '42501';
    end if;

    update public.customers
    set legacy_rec_id = nullif(payload->>'legacyRecId', ''),
        legacy_member_id = nullif(payload->>'legacyMemberId', ''),
        class = nullif(payload->>'class', ''),
        main_name = btrim(payload->>'mainName'),
        fsc_status = nullif(payload->>'fscStatus', ''),
        starting_points_date = nullif(payload->>'startingPointsDate', '')::date,
        default_location_id = v_location_id,
        sync_status = 'synced',
        record_status = 'active',
        revision_no = revision_no + 1,
        updated_by_user_id = v_actor_id,
        updated_by_name = coalesce(v_actor_name, ''),
        updated_by_phone = coalesce(v_actor_phone, ''),
        updated_at = now(),
        server_received_at = now()
    where id = v_customer_id;
  end if;

  delete from public.customer_contacts where customer_id = v_customer_id;
  insert into public.customer_contacts (customer_id, phone)
  select v_customer_id, btrim(item.value->>'phone')
  from jsonb_array_elements(coalesce(payload->'contacts', '[]'::jsonb)) as item(value)
  where nullif(btrim(item.value->>'phone'), '') is not null;

  delete from public.customer_bank_accounts where customer_id = v_customer_id;
  insert into public.customer_bank_accounts (
    customer_id,
    bank_name,
    account_number,
    account_name,
    is_primary
  )
  select
    v_customer_id,
    btrim(item.value->>'bankName'),
    btrim(item.value->>'accountNumber'),
    btrim(item.value->>'accountName'),
    coalesce((item.value->>'isPrimary')::boolean, false)
  from jsonb_array_elements(coalesce(payload->'bankAccounts', '[]'::jsonb)) as item(value)
  where nullif(btrim(item.value->>'accountNumber'), '') is not null;

  delete from public.customer_farms where customer_id = v_customer_id;
  insert into public.customer_farms (customer_id, owner_name, address, card_number)
  select
    v_customer_id,
    nullif(btrim(item.value->>'ownerName'), ''),
    nullif(btrim(item.value->>'address'), ''),
    nullif(btrim(item.value->>'cardNumber'), '')
  from jsonb_array_elements(coalesce(payload->'farms', '[]'::jsonb)) as item(value)
  where nullif(btrim(item.value->>'ownerName'), '') is not null
     or nullif(btrim(item.value->>'address'), '') is not null
     or nullif(btrim(item.value->>'cardNumber'), '') is not null;

  return jsonb_build_object('id', v_customer_id);
end;
$$;

revoke all on function public.save_customer_master_data(jsonb) from public, anon;
grant execute on function public.save_customer_master_data(jsonb) to authenticated;

create or replace function public.save_transport_staff_master_data(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_phone text;
  v_staff_id uuid := nullif(payload->>'staffId', '')::uuid;
  v_location_id uuid := nullif(payload->>'defaultLocationId', '')::uuid;
  v_existing public.transport_staffs%rowtype;
begin
  select p.name, p.phone
    into v_actor_name, v_actor_phone
  from public.profiles p
  where p.id = v_actor_id
    and p.is_active = true;

  if not found then
    raise exception 'Active authenticated user required' using errcode = '42501';
  end if;

  if v_location_id is null or not private.can_access_location(v_location_id) then
    raise exception 'Location access denied' using errcode = '42501';
  end if;

  if nullif(btrim(payload->>'mainName'), '') is null then
    raise exception 'Transport staff name is required' using errcode = '22023';
  end if;

  if v_staff_id is null then
    insert into public.transport_staffs (
      client_temp_id,
      idempotency_key,
      legacy_rec_id,
      legacy_member_id,
      main_name,
      sync_status,
      record_status,
      revision_no,
      default_location_id,
      created_by_user_id,
      created_by_name,
      created_by_phone,
      server_received_at
    ) values (
      nullif(payload->>'clientTempId', ''),
      nullif(payload->>'idempotencyKey', ''),
      nullif(payload->>'legacyRecId', ''),
      nullif(payload->>'legacyMemberId', ''),
      btrim(payload->>'mainName'),
      'synced',
      'active',
      0,
      v_location_id,
      v_actor_id,
      coalesce(v_actor_name, ''),
      coalesce(v_actor_phone, ''),
      now()
    )
    returning id into v_staff_id;
  else
    select *
      into v_existing
    from public.transport_staffs
    where id = v_staff_id
    for update;

    if not found then
      raise exception 'Transport staff not found' using errcode = 'P0002';
    end if;

    if v_existing.default_location_id is not null
       and not private.can_access_location(v_existing.default_location_id) then
      raise exception 'Transport staff access denied' using errcode = '42501';
    end if;

    update public.transport_staffs
    set legacy_rec_id = nullif(payload->>'legacyRecId', ''),
        legacy_member_id = nullif(payload->>'legacyMemberId', ''),
        main_name = btrim(payload->>'mainName'),
        sync_status = 'synced',
        record_status = 'active',
        revision_no = revision_no + 1,
        default_location_id = v_location_id,
        updated_by_user_id = v_actor_id,
        updated_by_name = coalesce(v_actor_name, ''),
        updated_by_phone = coalesce(v_actor_phone, ''),
        updated_at = now(),
        server_received_at = now()
    where id = v_staff_id;
  end if;

  delete from public.transport_staff_contacts where staff_id = v_staff_id;
  insert into public.transport_staff_contacts (staff_id, phone)
  select v_staff_id, btrim(item.value->>'phone')
  from jsonb_array_elements(coalesce(payload->'contacts', '[]'::jsonb)) as item(value)
  where nullif(btrim(item.value->>'phone'), '') is not null;

  delete from public.transport_staff_bank_accounts where staff_id = v_staff_id;
  insert into public.transport_staff_bank_accounts (
    staff_id,
    bank_name,
    account_number,
    account_name,
    is_primary
  )
  select
    v_staff_id,
    btrim(item.value->>'bankName'),
    btrim(item.value->>'accountNumber'),
    btrim(item.value->>'accountName'),
    coalesce((item.value->>'isPrimary')::boolean, false)
  from jsonb_array_elements(coalesce(payload->'bankAccounts', '[]'::jsonb)) as item(value)
  where nullif(btrim(item.value->>'accountNumber'), '') is not null;

  delete from public.transport_staff_plates where staff_id = v_staff_id;
  insert into public.transport_staff_plates (staff_id, plate_number)
  select v_staff_id, btrim(item.value->>'plateNumber')
  from jsonb_array_elements(coalesce(payload->'plates', '[]'::jsonb)) as item(value)
  where nullif(btrim(item.value->>'plateNumber'), '') is not null;

  return jsonb_build_object('id', v_staff_id);
end;
$$;

revoke all on function public.save_transport_staff_master_data(jsonb) from public, anon;
grant execute on function public.save_transport_staff_master_data(jsonb) to authenticated;

notify pgrst, 'reload schema';
