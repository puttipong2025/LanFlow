-- Add missing columns to customers table for offline-first PWA sync
-- Mirrors the pattern used by rubber_bills and income_expense tables

-- 1. Add sync/revision columns
alter table public.customers
  add column if not exists client_temp_id text unique,
  add column if not exists idempotency_key text unique,
  add column if not exists revision_no integer not null default 0,
  add column if not exists sync_status sync_status not null default 'synced',
  add column if not exists record_status record_status not null default 'active',
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_name text,
  add column if not exists deleted_by_phone text,
  add column if not exists client_recorded_at timestamptz,
  add column if not exists client_created_at timestamptz,
  add column if not exists server_received_at timestamptz;

-- 2. Backfill client_temp_id for existing rows that lack it
update public.customers
  set client_temp_id = legacy_rec_id
  where client_temp_id is null and legacy_rec_id is not null;

update public.customers
  set client_temp_id = id::text
  where client_temp_id is null;

-- 3. Add RLS policies for UPDATE and DELETE (missing from original schema)
create policy "customers update scoped"
  on public.customers for update
  using (default_location_id is null or public.can_access_location(default_location_id))
  with check (default_location_id is null or public.can_access_location(default_location_id));

create policy "customers delete scoped"
  on public.customers for delete
  using (default_location_id is null or public.can_access_location(default_location_id));

-- Also add missing policies for customer child tables (contacts, banks, farms)
-- These use ON DELETE CASCADE so direct manipulation also needs policies

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
