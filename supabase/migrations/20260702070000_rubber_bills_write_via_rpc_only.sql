-- Migration: 20260702070000_rubber_bills_write_via_rpc_only.sql
-- Purpose: Lock down rubber_bills and rubber_bill_items so only the
-- sync_rubber_bill RPC (security definer) can write to them.
-- Authenticated users keep SELECT for reads.

-- 1. Drop existing write policies on rubber_bills (both naming conventions)
drop policy if exists "rubber bills insert scoped" on public.rubber_bills;
drop policy if exists "rubber bills update scoped no location change" on public.rubber_bills;
drop policy if exists "rubber_bills_location_scope" on public.rubber_bills;

-- 2. Drop existing write policy on rubber_bill_items (both naming conventions)
drop policy if exists "rubber bill items scoped through bill" on public.rubber_bill_items;
drop policy if exists "rubber_bill_items_parent_scope" on public.rubber_bill_items;

-- 3. Ensure SELECT-only policy exists for rubber_bills
-- (The "rubber bills location scoped" SELECT policy from schema remains, but
-- drop and recreate the consistent name if the old ALL one was the only one)
drop policy if exists "rubber bills location scoped" on public.rubber_bills;
create policy "rubber bills location scoped"
  on public.rubber_bills for select
  using (public.can_access_location(location_id));

-- 3. Create SELECT-only policy for rubber_bill_items
create policy "rubber bill items select scoped through bill"
  on public.rubber_bill_items for select
  using (exists (
    select 1 from public.rubber_bills b
    where b.id = bill_id
      and public.can_access_location(b.location_id)
  ));

-- 4. Revoke ALL grants, then grant SELECT only
revoke all on public.rubber_bills from anon, authenticated;
revoke all on public.rubber_bill_items from anon, authenticated;

grant select on public.rubber_bills to authenticated;
grant select on public.rubber_bill_items to authenticated;
