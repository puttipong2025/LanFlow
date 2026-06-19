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
  main_name text not null,
  fsc_status text,
  starting_points_date date,
  default_location_id uuid references public.locations(id),
  created_by_user_id uuid references public.profiles(id),
  created_by_name text not null,
  created_by_phone text not null,
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
  created_at timestamptz not null default now()
);

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
  transaction_option text,
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

create table public.offline_sync_events (
  id uuid primary key default gen_random_uuid(),
  client_temp_id text not null unique,
  idempotency_key text not null unique,
  entity_type text not null,
  operation_type text not null default 'create',
  location_id uuid references public.locations(id),
  payload jsonb not null,
  status sync_status not null default 'pending',
  server_id uuid,
  error_message text,
  created_by_user_id uuid references public.profiles(id),
  client_recorded_at timestamptz,
  client_created_at timestamptz,
  server_received_at timestamptz,
  server_created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),
  actor_user_id uuid references public.profiles(id),
  actor_name text not null,
  actor_phone text not null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

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
alter table public.offline_sync_events enable row level security;
alter table public.audit_logs enable row level security;

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

create policy "rubber bills insert scoped"
  on public.rubber_bills for insert
  with check (public.can_access_location(location_id));

create policy "rubber bills update scoped no location change"
  on public.rubber_bills for update
  using (public.can_access_location(location_id))
  with check (public.can_access_location(location_id));

create policy "rubber bill items scoped through bill"
  on public.rubber_bill_items for all
  using (exists (select 1 from public.rubber_bills b where b.id = bill_id and public.can_access_location(b.location_id)))
  with check (exists (select 1 from public.rubber_bills b where b.id = bill_id and public.can_access_location(b.location_id)));

create policy "income expense location scoped"
  on public.income_expense for all
  using (public.can_access_location(location_id))
  with check (public.can_access_location(location_id));

create policy "sync events scoped"
  on public.offline_sync_events for all
  using (location_id is null or public.can_access_location(location_id))
  with check (location_id is null or public.can_access_location(location_id));

create policy "audit logs scoped"
  on public.audit_logs for select
  using (location_id is null or public.can_access_location(location_id));

create policy "audit logs insert scoped"
  on public.audit_logs for insert
  with check (location_id is null or public.can_access_location(location_id));
