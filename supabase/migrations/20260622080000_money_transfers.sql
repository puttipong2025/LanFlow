-- Money Transfer System
-- Parent: money_transfers
-- Child 1: money_transfer_slips (bank transfer slips, 1-N)
-- Child 2: money_transfer_items (linked rubber_bills / ocr_tickets)

-- ═══ Parent: money_transfers ═══
create table if not exists public.money_transfers (
  id uuid primary key default gen_random_uuid(),
  client_temp_id text unique,
  idempotency_key text unique,
  location_id uuid not null references public.locations(id),
  customer_id uuid references public.customers(id),
  customer_name text,
  account_number text,
  account_name text,
  bank_name text,
  net_amount_to_pay numeric(12,2) not null default 0,
  transfer_status text not null default 'pending'
    check (transfer_status in ('pending', 'completed', 'cancelled')),
  sync_status sync_status not null default 'pending',
  record_status record_status not null default 'active',
  revision_no integer not null default 0,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text not null default '',
  created_by_phone text not null default '',
  client_recorded_at timestamptz,
  server_received_at timestamptz,
  deleted_at timestamptz,
  deleted_by_name text,
  deleted_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ═══ Child 1: money_transfer_slips (bank slips scanned via OCR) ═══
create table if not exists public.money_transfer_slips (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.money_transfers(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  reference_number text,
  fee numeric(12,2) not null default 0,
  sender_name text,
  receiver_name text,
  transaction_date timestamptz,
  slip_image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ═══ Child 2: money_transfer_items (linked rubber_bills / ocr_tickets) ═══
create table if not exists public.money_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.money_transfers(id) on delete cascade,
  source_type text not null check (source_type in ('rubber_bill', 'ocr_ticket')),
  source_id uuid not null,
  customer_name text,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- Prevent same bill/ticket from being used in multiple transfers
create unique index if not exists money_transfer_items_source_unique
  on public.money_transfer_items (source_type, source_id);

-- ═══ RLS ═══
alter table public.money_transfers enable row level security;
alter table public.money_transfer_slips enable row level security;
alter table public.money_transfer_items enable row level security;

-- money_transfers
create policy "money transfers location scoped select"
  on public.money_transfers for select
  using (public.can_access_location(location_id));

create policy "money transfers location scoped insert"
  on public.money_transfers for insert
  with check (public.can_access_location(location_id));

create policy "money transfers location scoped update"
  on public.money_transfers for update
  using (public.can_access_location(location_id))
  with check (public.can_access_location(location_id));

create policy "money transfers location scoped delete"
  on public.money_transfers for delete
  using (public.can_access_location(location_id));

-- money_transfer_slips (scoped through parent)
create policy "money transfer slips scoped through transfer"
  on public.money_transfer_slips for all
  using (exists (
    select 1 from public.money_transfers t
    where t.id = transfer_id and public.can_access_location(t.location_id)
  ))
  with check (exists (
    select 1 from public.money_transfers t
    where t.id = transfer_id and public.can_access_location(t.location_id)
  ));

-- money_transfer_items (scoped through parent)
create policy "money transfer items scoped through transfer"
  on public.money_transfer_items for all
  using (exists (
    select 1 from public.money_transfers t
    where t.id = transfer_id and public.can_access_location(t.location_id)
  ))
  with check (exists (
    select 1 from public.money_transfers t
    where t.id = transfer_id and public.can_access_location(t.location_id)
  ));

-- Grant service_role access (matches existing pattern)
grant all on public.money_transfers to service_role;
grant all on public.money_transfer_slips to service_role;
grant all on public.money_transfer_items to service_role;
