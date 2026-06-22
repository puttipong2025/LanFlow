-- OCR Tickets table for storing scanned weighing ticket data
create table if not exists public.ocr_tickets (
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

-- Prevent duplicate file names within same location
create unique index if not exists ocr_tickets_location_file_unique
  on public.ocr_tickets (location_id, file_name)
  where record_status = 'active';

-- RLS
alter table public.ocr_tickets enable row level security;

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
