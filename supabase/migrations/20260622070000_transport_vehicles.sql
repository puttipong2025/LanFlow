-- Transport Staffs module tables (ขนส่งและพนักงาน)
-- 1 คน (คนขับ/คนขนส่ง/พนักงาน) → หลายทะเบียนรถ (1:M)

-- ตารางหลัก: ข้อมูลขนส่งและพนักงาน
create table public.transport_staffs (
  id uuid primary key default gen_random_uuid(),
  client_temp_id text,
  idempotency_key text unique,
  legacy_rec_id text,
  legacy_member_id text,
  main_name text not null,
  sync_status sync_status not null default 'pending',
  record_status record_status not null default 'active',
  revision_no integer not null default 0,
  default_location_id uuid references public.locations(id),
  created_by_user_id uuid references public.profiles(id),
  created_by_name text not null default '',
  created_by_phone text not null default '',
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  updated_by_phone text,
  server_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ตาราง child: เบอร์โทรศัพท์
create table public.transport_staff_contacts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.transport_staffs(id) on delete cascade,
  phone text not null,
  created_at timestamptz not null default now()
);

-- ตาราง child: บัญชีธนาคาร
create table public.transport_staff_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.transport_staffs(id) on delete cascade,
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

-- ตาราง child: ทะเบียนรถ (1 คน → หลายทะเบียน)
create table public.transport_staff_plates (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.transport_staffs(id) on delete cascade,
  plate_number text not null,
  created_at timestamptz not null default now()
);

-- Unique constraint: is_primary = true per staff_id (bank accounts)
create unique index transport_staff_bank_accounts_one_primary
  on public.transport_staff_bank_accounts (staff_id)
  where is_primary = true;

-- RLS
alter table public.transport_staffs enable row level security;
alter table public.transport_staff_contacts enable row level security;
alter table public.transport_staff_bank_accounts enable row level security;
alter table public.transport_staff_plates enable row level security;

-- Policies
create policy "transport_staffs scoped by default location"
  on public.transport_staffs for select
  using (default_location_id is null or public.can_access_location(default_location_id));

create policy "transport_staffs insert scoped"
  on public.transport_staffs for insert
  with check (default_location_id is null or public.can_access_location(default_location_id));

create policy "transport_staffs update scoped"
  on public.transport_staffs for update
  using (default_location_id is null or public.can_access_location(default_location_id))
  with check (default_location_id is null or public.can_access_location(default_location_id));

create policy "transport_staffs delete scoped"
  on public.transport_staffs for delete
  using (default_location_id is null or public.can_access_location(default_location_id));

-- Child tables: all operations through parent
create policy "transport_staff_contacts through parent"
  on public.transport_staff_contacts for all
  using (exists (select 1 from public.transport_staffs s where s.id = staff_id))
  with check (exists (select 1 from public.transport_staffs s where s.id = staff_id));

create policy "transport_staff_bank_accounts through parent"
  on public.transport_staff_bank_accounts for all
  using (exists (select 1 from public.transport_staffs s where s.id = staff_id))
  with check (exists (select 1 from public.transport_staffs s where s.id = staff_id));

create policy "transport_staff_plates through parent"
  on public.transport_staff_plates for all
  using (exists (select 1 from public.transport_staffs s where s.id = staff_id))
  with check (exists (select 1 from public.transport_staffs s where s.id = staff_id));

-- Grants for service_role
grant all on public.transport_staffs to service_role;
grant all on public.transport_staff_contacts to service_role;
grant all on public.transport_staff_bank_accounts to service_role;
grant all on public.transport_staff_plates to service_role;
