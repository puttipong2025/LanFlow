-- Add is_primary flag to customer_bank_accounts
-- Each customer can have at most 1 primary bank account
alter table public.customer_bank_accounts
  add column is_primary boolean not null default false;

-- Create a partial unique index: only one is_primary = true per customer
create unique index idx_customer_bank_accounts_primary
  on public.customer_bank_accounts (customer_id)
  where is_primary = true;

-- Backfill: for each customer, set the earliest-created bank account as primary
-- This uses a CTE to find the first bank account per customer by created_at
with first_accounts as (
  select distinct on (customer_id) id
  from public.customer_bank_accounts
  order by customer_id, created_at asc, id asc
)
update public.customer_bank_accounts ba
set is_primary = true
from first_accounts fa
where ba.id = fa.id;
