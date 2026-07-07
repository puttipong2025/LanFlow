-- LanFlow Supabase schema
-- Apply this after creating a Supabase project. It intentionally starts customers empty.

create extension if not exists pgcrypto;

create type app_role as enum ('user', 'admin', 'super_admin');
create type transaction_type as enum ('income', 'expense');
create type sync_status as enum ('pending', 'syncing', 'synced', 'failed', 'conflict');
create type record_status as enum ('active', 'deleted', 'cancelled');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text not null,
  password_hash text,
  role app_role not null default 'user',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_only_one_super_admin
  on public.profiles ((role))
  where role = 'super_admin';

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,
  address text,
  phone text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, location_id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  legacy_rec_id text,
  legacy_member_id text,
  class text check (class in ('สาขานี้จ่าย', 'สาขาใหญ่จ่าย')),
  main_name text not null check (main_name <> ''),
  fsc_status text,
  starting_points_date date,
  default_location_id uuid references public.locations(id),
  created_by_user_id uuid references public.profiles(id),
  created_by_name text not null,
  created_by_phone text not null,
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  updated_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  phone text not null,
  created_at timestamptz not null default now()
);

create table public.customer_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index customer_bank_accounts_only_one_primary
  on public.customer_bank_accounts (customer_id)
  where is_primary = true;

create table public.customer_farms (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  owner_name text,
  address text,
  card_number text,
  created_at timestamptz not null default now()
);

create table public.rubber_bills (
  id uuid primary key default gen_random_uuid(),
  client_temp_id text unique,
  local_bill_no text not null,
  server_bill_no text,
  idempotency_key text unique,
  sync_status sync_status not null default 'pending',
  record_status record_status not null default 'active',
  location_id uuid not null references public.locations(id),
  bill_no text not null,
  bill_date date not null,
  customer_id uuid references public.customers(id),
  customer_name text,
  customer_type text check (customer_type in ('สาขานี้จ่าย', 'สาขาใหญ่จ่าย')),
  bill_type text not null,
  deduct_weight numeric(12,2) not null default 0,
  weight numeric(12,2) not null default 0,
  rubber_value numeric(12,2) not null default 0,
  average_price numeric(12,2) not null default 0,
  deduction_total numeric(12,2) not null default 0,
  net_total numeric(12,2) not null default 0,
  cash_payment numeric(12,2) not null default 0,
  transfer_payment numeric(12,2) not null default 0,
  acid_pack_count numeric(12,2) not null default 0,
  print_status text not null default 'ยังไม่ได้ปริ้น',
  locked_at timestamptz not null default now(),
  client_recorded_at timestamptz,
  client_created_at timestamptz,
  server_received_at timestamptz,
  revision_no integer not null default 0,
  deleted_at timestamptz,
  deleted_by_name text,
  deleted_by_phone text,
  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null,
  created_by_phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, local_bill_no),
  unique (location_id, server_bill_no, bill_date, bill_type)
);

create table public.rubber_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.rubber_bills(id) on delete cascade,
  item_type text not null,
  description text,
  weight_in numeric(12,2),
  weight_out numeric(12,2),
  net_weight numeric(12,2),
  quantity numeric(12,2),
  unit text,
  price numeric(12,2),
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.income_expense (
  id uuid primary key default gen_random_uuid(),
  client_temp_id text unique,
  local_bill_no text not null,
  server_bill_no text,
  idempotency_key text unique,
  sync_status sync_status not null default 'pending',
  record_status record_status not null default 'active',
  location_id uuid not null references public.locations(id),
  type transaction_type not null,
  number text not null,
  tx_date date not null,
  title text not null,
  cost numeric(12,2) not null default 0,
  gateway text,
  color text,
  unit text,
  price numeric(12,2),
  bill_option text,
  locked_at timestamptz not null default now(),
  client_recorded_at timestamptz,
  client_created_at timestamptz,
  server_received_at timestamptz,
  revision_no integer not null default 0,
  deleted_at timestamptz,
  deleted_by_name text,
  deleted_by_phone text,
  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null,
  created_by_phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.income_expense
  add constraint income_expense_bill_option_check
  check (
    record_status = 'deleted'
    or (
      bill_option is not null
      and (
        (type = 'income' and bill_option in ('รายรับ', 'บิลขาย')) or
        (type = 'expense' and bill_option = 'ค่าใช้จ่าย')
      )
    )
  );

create table public.income_sale_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text,
  created_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.profiles(id)
);

create unique index income_sale_items_name_active_idx on public.income_sale_items (lower(trim(name))) where is_active = true;

create table public.ocr_tickets (
  id uuid primary key default gen_random_uuid(),
  client_temp_id text unique,
  idempotency_key text unique,
  location_id uuid not null references public.locations(id),
  file_name text not null,
  ticket_id text,
  license_plate text,
  driver_name text,
  date_in date,
  weight_in integer,
  weight_out integer,
  weight_net integer,
  weight_deducted numeric(12,2) default 0,
  weight_remaining numeric(12,2) default 0,
  total_amount numeric(12,2) default 0,
  drive_file_id text,
  drive_url text,
  sync_status sync_status not null default 'pending',
  record_status record_status not null default 'active',
  revision_no integer not null default 0,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text not null default 'ผู้ดูแลระบบ',
  created_by_phone text not null default '0800000000',
  client_recorded_at timestamptz,
  server_received_at timestamptz,
  deleted_at timestamptz,
  deleted_by_name text,
  deleted_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ocr_tickets_location_file_unique
  on public.ocr_tickets (location_id, file_name)
  where record_status = 'active';

create or replace function public.prevent_locked_ocr_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.money_transfer_items i
    join public.money_transfers t on t.id = i.transfer_id
    where i.source_type = 'ocr_ticket'
      and i.source_id = old.id
      and t.record_status <> 'deleted'
  ) then
    raise exception 'รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_locked_ocr_ticket_change() from public, anon, authenticated;

drop trigger if exists ocr_tickets_transfer_relation_update_lock on public.ocr_tickets;
create trigger ocr_tickets_transfer_relation_update_lock
  before update on public.ocr_tickets
  for each row
  execute function public.prevent_locked_ocr_ticket_change();

drop trigger if exists ocr_tickets_transfer_relation_delete_lock on public.ocr_tickets;
create trigger ocr_tickets_transfer_relation_delete_lock
  before delete on public.ocr_tickets
  for each row
  execute function public.prevent_locked_ocr_ticket_change();


create or replace function public.prevent_location_change()
returns trigger
language plpgsql
as $$
begin
  if old.location_id is distinct from new.location_id then
    raise exception 'location_id is locked after creation';
  end if;
  return new;
end;
$$;

create trigger rubber_bills_lock_location
  before update on public.rubber_bills
  for each row execute function public.prevent_location_change();

create trigger income_expense_lock_location
  before update on public.income_expense
  for each row execute function public.prevent_location_change();

create or replace function public.current_profile_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = public.current_profile_id()
      and p.role = 'super_admin'
      and p.is_active = true
  )
$$;

create or replace function public.can_access_location(target_location uuid)
returns boolean
language sql
stable
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.user_locations ul
      join public.profiles p on p.id = ul.user_id
      where ul.location_id = target_location
        and ul.user_id = public.current_profile_id()
        and p.is_active = true
    )
$$;

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.user_locations enable row level security;
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.customer_bank_accounts enable row level security;
alter table public.customer_farms enable row level security;
alter table public.rubber_bills enable row level security;
alter table public.rubber_bill_items enable row level security;
alter table public.income_expense enable row level security;
alter table public.income_sale_items enable row level security;
alter table public.ocr_tickets enable row level security;

create policy "Allow all authenticated users to read active items"
  on public.income_sale_items for select
  using (is_active = true);

create policy "Allow super_admin to read all items"
  on public.income_sale_items for select
  using (public.is_super_admin());

create policy "Allow super_admin to insert"
  on public.income_sale_items for insert
  with check (public.is_super_admin());

create policy "Allow super_admin to update"
  on public.income_sale_items for update
  using (public.is_super_admin());
-- No DELETE policy: all deletes go through RPC only

create or replace function public.delete_income_sale_item(item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
  usage_count bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: only super_admin can delete sale items';
  end if;

  select name into item_name
  from public.income_sale_items
  where id = item_id;

  if item_name is null then
    raise exception 'Item not found';
  end if;

  select count(*) into usage_count
  from public.income_expense
  where title = item_name
    and bill_option = 'บิลขาย'
    and record_status != 'deleted';

  if usage_count > 0 then
    raise exception 'ไม่สามารถลบได้ เพราะมีรายการรายรับที่ใช้ "%" อยู่ % รายการ', item_name, usage_count;
  end if;

  delete from public.income_sale_items where id = item_id;
end;
$$;

revoke all on function public.delete_income_sale_item(uuid) from public;
grant execute on function public.delete_income_sale_item(uuid) to authenticated;

create policy "profiles see own or super admin"
  on public.profiles for select
  using (id = public.current_profile_id() or public.is_super_admin());

create policy "profiles super admin manages"
  on public.profiles for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "locations accessible"
  on public.locations for select
  using (public.is_super_admin() or public.can_access_location(id));

create policy "locations super admin manages"
  on public.locations for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "user locations visible"
  on public.user_locations for select
  using (public.is_super_admin() or user_id = public.current_profile_id() or public.can_access_location(location_id));

create policy "user locations super admin manages"
  on public.user_locations for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "customers scoped by default location"
  on public.customers for select
  using (default_location_id is null or public.can_access_location(default_location_id));

create policy "customers insert scoped"
  on public.customers for insert
  with check (default_location_id is null or public.can_access_location(default_location_id));

create policy "rubber bills location scoped"
  on public.rubber_bills for select
  using (public.can_access_location(location_id));

create policy "rubber bill items select scoped through bill"
  on public.rubber_bill_items for select
  using (exists (select 1 from public.rubber_bills b where b.id = bill_id and public.can_access_location(b.location_id)));

create policy "income_expense_select_location_scope"
  on public.income_expense for select to authenticated
  using (public.can_access_location(location_id));

create policy "ocr tickets location scoped"
  on public.ocr_tickets for select
  using (public.can_access_location(location_id));

create policy "ocr tickets insert scoped"
  on public.ocr_tickets for insert
  with check (public.can_access_location(location_id));

create policy "ocr tickets update scoped"
  on public.ocr_tickets for update
  using (public.can_access_location(location_id))
  with check (public.can_access_location(location_id));

create policy "customers update scoped"
  on public.customers for update
  using (default_location_id is null or public.can_access_location(default_location_id))
  with check (default_location_id is null or public.can_access_location(default_location_id));

create policy "customers delete scoped"
  on public.customers for delete
  using (default_location_id is null or public.can_access_location(default_location_id));

create policy "customer_contacts all through customer"
  on public.customer_contacts for all
  using (exists (
    select 1 from public.customers c
    where c.id = customer_id
      and (c.default_location_id is null or public.can_access_location(c.default_location_id))
  ))
  with check (exists (
    select 1 from public.customers c
    where c.id = customer_id
      and (c.default_location_id is null or public.can_access_location(c.default_location_id))
  ));

create policy "customer_bank_accounts all through customer"
  on public.customer_bank_accounts for all
  using (exists (
    select 1 from public.customers c
    where c.id = customer_id
      and (c.default_location_id is null or public.can_access_location(c.default_location_id))
  ))
  with check (exists (
    select 1 from public.customers c
    where c.id = customer_id
      and (c.default_location_id is null or public.can_access_location(c.default_location_id))
  ));

create policy "customer_farms all through customer"
  on public.customer_farms for all
  using (exists (
    select 1 from public.customers c
    where c.id = customer_id
      and (c.default_location_id is null or public.can_access_location(c.default_location_id))
  ))
  with check (exists (
    select 1 from public.customers c
    where c.id = customer_id
      and (c.default_location_id is null or public.can_access_location(c.default_location_id))
  ));

create policy "customers_select_legacy_global"
  on public.customers for select to authenticated
  using (default_location_id is null and private.is_active_user());

create policy "customer_contacts_select_legacy_global"
  on public.customer_contacts for select to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.default_location_id is null
        and private.is_active_user()
    )
  );

create policy "customer_bank_accounts_select_legacy_global"
  on public.customer_bank_accounts for select to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.default_location_id is null
        and private.is_active_user()
    )
  );

create policy "customer_farms_select_legacy_global"
  on public.customer_farms for select to authenticated
  using (
    exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.default_location_id is null
        and private.is_active_user()
    )
  );

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant select, insert, update on table public.income_sale_items to authenticated;
grant all privileges on all sequences in schema public to service_role;

-- Revoke direct write on rubber_bills/rubber_bill_items (write via RPC only)
revoke all on public.rubber_bills from anon, authenticated;
revoke all on public.rubber_bill_items from anon, authenticated;
grant select on public.rubber_bills to authenticated;
grant select on public.rubber_bill_items to authenticated;

-- Revoke direct write on income_expense (write via RPC only)
revoke all on public.income_expense from anon, authenticated;
grant select on public.income_expense to authenticated;

-- sync_rubber_bill RPC: atomic create/update/delete for rubber bills
create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
  v_record_status record_status;
  v_idempotency_key text;

  v_bill_id uuid;
  v_current_revision integer;
  v_server_bill_no text;
  v_existing_idempotency_key text;
  v_transfer_locked boolean;

  v_item jsonb;
  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;

  v_date text;
  v_next_seq integer;
begin
  -- 1. Check Auth
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone from public.profiles where id = v_created_by_user_id;

  -- 2. Extract payload
  v_operation := payload->>'operation';
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  v_client_temp_id := payload->>'clientTempId';
  v_location_id := (payload->>'locationId')::uuid;
  v_record_status := (payload->>'recordStatus')::record_status;
  v_idempotency_key := payload->>'idempotencyKey';

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  -- 3. Concurrency & Idempotency
  select id, revision_no, server_bill_no, idempotency_key
  into v_bill_id, v_current_revision, v_server_bill_no, v_existing_idempotency_key
  from public.rubber_bills
  where client_temp_id = v_client_temp_id
  for update;

  if v_bill_id is not null then
    if v_idempotency_key = v_existing_idempotency_key then
      return jsonb_build_object('status', 'synced', 'id', v_bill_id, 'serverBillNo', v_server_bill_no, 'revisionNo', v_current_revision, 'serverReceivedAt', now());
    end if;
    if v_operation = 'create' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
    else
      if v_current_revision != coalesce(v_expected_revision, v_current_revision) then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
      end if;
    end if;
  else
    if v_operation != 'create' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;
  end if;

  if v_bill_id is not null and v_operation in ('update', 'delete') then
    select exists (
      select 1
      from public.money_transfer_items i
      join public.money_transfers t on t.id = i.transfer_id
      where i.source_type = 'rubber_bill'
        and i.source_id = v_bill_id
        and t.record_status <> 'deleted'
    ) into v_transfer_locked;

    if coalesce(v_transfer_locked, false) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน'
      );
    end if;
  end if;

  -- 4. Process
  if v_operation = 'delete' then
    update public.rubber_bills
    set record_status = 'deleted', deleted_at = now(),
        deleted_by_name = payload->>'deletedByName', deleted_by_phone = payload->>'deletedByPhone',
        revision_no = revision_no + 1, idempotency_key = v_idempotency_key, server_received_at = now()
    where id = v_bill_id
    returning id, revision_no into v_bill_id, v_current_revision;
  else
    if v_bill_id is null then
      v_date := to_char((payload->>'billDate')::date, 'YYMMDD');
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));
      select count(*) + 1 into v_next_seq from public.rubber_bills where location_id = v_location_id and to_char(bill_date, 'YYMMDD') = v_date and server_bill_no is not null;
      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');
    end if;

    insert into public.rubber_bills (
      client_temp_id, idempotency_key, revision_no, sync_status, record_status,
      location_id, bill_no, local_bill_no, server_bill_no, bill_date,
      customer_name, customer_type, bill_type,
      weight, rubber_value, average_price, deduction_total, net_total,
      cash_payment, transfer_payment, acid_pack_count,
      client_recorded_at, client_created_at, server_received_at,
      created_by_user_id, created_by_name, created_by_phone
    ) values (
      v_client_temp_id, v_idempotency_key, coalesce(v_expected_revision + 1, 1), 'synced', 'active',
      v_location_id, coalesce(v_server_bill_no, payload->>'localBillNo'), payload->>'localBillNo', v_server_bill_no, (payload->>'billDate')::date,
      payload->>'customerName', payload->>'customerType', 'weighing',
      (payload->>'weight')::numeric, (payload->>'rubberValue')::numeric, (payload->>'averagePrice')::numeric,
      (payload->>'deductionTotal')::numeric, (payload->>'netTotal')::numeric,
      (payload->>'cashPayment')::numeric, (payload->>'transferPayment')::numeric, (payload->>'acidPackCount')::numeric,
      (payload->>'clientRecordedAt')::timestamptz, (payload->>'clientCreatedAt')::timestamptz, now(),
      v_created_by_user_id, v_created_by_name, v_created_by_phone
    )
    on conflict (client_temp_id) do update set
      revision_no = public.rubber_bills.revision_no + 1, idempotency_key = excluded.idempotency_key,
      sync_status = 'synced', record_status = 'active',
      bill_date = excluded.bill_date, customer_name = excluded.customer_name, customer_type = excluded.customer_type,
      weight = excluded.weight, rubber_value = excluded.rubber_value, average_price = excluded.average_price,
      deduction_total = excluded.deduction_total, net_total = excluded.net_total,
      cash_payment = excluded.cash_payment, transfer_payment = excluded.transfer_payment, acid_pack_count = excluded.acid_pack_count,
      client_recorded_at = excluded.client_recorded_at, server_received_at = now()
    returning id, revision_no into v_bill_id, v_current_revision;

    delete from public.rubber_bill_items where bill_id = v_bill_id;
    for v_item in select * from jsonb_array_elements(payload->'items')
    loop
      insert into public.rubber_bill_items (bill_id, item_type, description, weight_in, weight_out, net_weight, quantity, unit, price, total)
      values (v_bill_id, v_item->>'itemType', v_item->>'description', (v_item->>'inWeight')::numeric, (v_item->>'outWeight')::numeric, (v_item->>'netWeight')::numeric, (v_item->>'quantity')::numeric, v_item->>'unit', (v_item->>'unitPrice')::numeric, (v_item->>'totalAmount')::numeric);
    end loop;
  end if;

  return jsonb_build_object('status', 'synced', 'id', v_bill_id, 'serverBillNo', v_server_bill_no, 'revisionNo', v_current_revision, 'serverReceivedAt', now());
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

-- sync_income_expense RPC: atomic create/update/delete for income-expense rows
create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation text;
  v_expected_revision integer;
  v_client_temp_id text;
  v_location_id uuid;
  v_record_status record_status;
  v_idempotency_key text;

  v_row_id uuid;
  v_current_revision integer;
  v_server_bill_no text;
  v_existing_idempotency_key text;

  v_active_user boolean;
  v_created_by_user_id uuid;
  v_created_by_name text;
  v_created_by_phone text;

  v_type text;
  v_bill_option text;
  v_cost numeric;
  v_date text;
  v_next_seq integer;
begin
  v_active_user := private.is_active_user();
  if not coalesce(v_active_user, false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  v_created_by_user_id := auth.uid();
  select name, phone into v_created_by_name, v_created_by_phone
  from public.profiles where id = v_created_by_user_id;

  v_operation := payload->>'operation';
  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  v_client_temp_id := payload->>'clientTempId';
  v_location_id := (payload->>'locationId')::uuid;
  v_record_status := (payload->>'recordStatus')::record_status;
  v_idempotency_key := payload->>'idempotencyKey';
  v_type := payload->>'type';
  v_bill_option := payload->>'billOption';
  v_cost := (payload->>'cost')::numeric;

  -- Serialize all operations for the same client temp id before checking existence.
  -- Without this, duplicate offline create replays can both miss the row, then
  -- fall through to ON CONFLICT and incorrectly bump revision_no.
  perform pg_advisory_xact_lock(hashtext('income_expense:' || v_client_temp_id));

  if not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied');
  end if;

  if v_operation != 'delete' then
    if v_type not in ('income', 'expense') then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid type');
    end if;
    if v_cost is null or v_cost <= 0 then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'cost must be > 0');
    end if;
    if v_bill_option is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'billOption is required');
    end if;
    if v_type = 'income' and v_bill_option not in ('รายรับ', 'บิลขาย') then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid billOption for income');
    end if;
    if v_type = 'expense' and v_bill_option != 'ค่าใช้จ่าย' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid billOption for expense');
    end if;
    if v_bill_option = 'บิลขาย' then
      if coalesce((payload->>'unit')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'unit must be > 0 for บิลขาย');
      end if;
      if coalesce((payload->>'price')::numeric, 0) <= 0 then
        return jsonb_build_object('status', 'failed', 'errorMessage', 'price must be > 0 for บิลขาย');
      end if;
    end if;
  end if;

  select id, revision_no, server_bill_no, idempotency_key
  into v_row_id, v_current_revision, v_server_bill_no, v_existing_idempotency_key
  from public.income_expense
  where client_temp_id = v_client_temp_id
  for update;

  if v_row_id is not null then
    if v_idempotency_key = v_existing_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_row_id,
        'serverBillNo', v_server_bill_no,
        'revisionNo', v_current_revision,
        'serverReceivedAt', now()
      );
    end if;

    if v_operation = 'create' then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
    else
      if v_current_revision != coalesce(v_expected_revision, v_current_revision) then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
      end if;
    end if;
  else
    if v_operation != 'create' then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;
  end if;

  if v_operation = 'delete' then
    update public.income_expense
    set record_status = 'deleted',
        deleted_at = now(),
        deleted_by_name = payload->>'deletedByName',
        deleted_by_phone = payload->>'deletedByPhone',
        revision_no = revision_no + 1,
        idempotency_key = v_idempotency_key,
        server_received_at = now()
    where id = v_row_id
    returning id, revision_no into v_row_id, v_current_revision;

  else
    if v_row_id is null then
      v_date := to_char((payload->>'txDate')::date, 'YYMMDD');

      -- Shared sequence for income and expense, matching the old generateTxNo behavior.
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));

      select count(*) + 1 into v_next_seq
      from public.income_expense
      where location_id = v_location_id
        and tx_date = (payload->>'txDate')::date
        and server_bill_no is not null;

      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');
    end if;

    insert into public.income_expense (
      client_temp_id, idempotency_key, revision_no, sync_status, record_status,
      location_id, type, number, local_bill_no, server_bill_no,
      tx_date, title, cost, unit, price, bill_option,
      client_recorded_at, client_created_at, server_received_at,
      created_by_user_id, created_by_name, created_by_phone
    ) values (
      v_client_temp_id,
      v_idempotency_key,
      coalesce(v_expected_revision + 1, 1),
      'synced',
      'active',
      v_location_id,
      v_type::transaction_type,
      coalesce(v_server_bill_no, payload->>'localBillNo'),
      payload->>'localBillNo',
      v_server_bill_no,
      (payload->>'txDate')::date,
      payload->>'title',
      v_cost,
      case when v_bill_option = 'บิลขาย' then payload->>'unit' else null end,
      case when v_bill_option = 'บิลขาย' then (payload->>'price')::numeric else null end,
      v_bill_option,
      (payload->>'clientRecordedAt')::timestamptz,
      (payload->>'clientCreatedAt')::timestamptz,
      now(),
      v_created_by_user_id,
      v_created_by_name,
      v_created_by_phone
    )
    on conflict (client_temp_id) do update set
      revision_no = public.income_expense.revision_no + 1,
      idempotency_key = excluded.idempotency_key,
      sync_status = 'synced',
      record_status = 'active',
      tx_date = excluded.tx_date,
      title = excluded.title,
      cost = excluded.cost,
      unit = excluded.unit,
      price = excluded.price,
      bill_option = excluded.bill_option,
      client_recorded_at = excluded.client_recorded_at,
      server_received_at = now()
    returning id, revision_no into v_row_id, v_current_revision;
  end if;

  return jsonb_build_object(
    'status', 'synced',
    'id', v_row_id,
    'serverBillNo', v_server_bill_no,
    'revisionNo', v_current_revision,
    'serverReceivedAt', now()
  );

exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;
