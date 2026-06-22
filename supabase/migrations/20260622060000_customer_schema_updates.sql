-- 1. Add CHECK constraint to main_name
ALTER TABLE public.customers ADD CONSTRAINT customers_main_name_check CHECK (main_name <> '');

-- 2. Add updated_by tracking to customers
ALTER TABLE public.customers 
  ADD COLUMN updated_by_user_id uuid REFERENCES public.profiles(id),
  ADD COLUMN updated_by_name text,
  ADD COLUMN updated_by_phone text;

-- 3. Add UNIQUE INDEX for is_primary bank accounts
CREATE UNIQUE INDEX customer_bank_accounts_only_one_primary 
  ON public.customer_bank_accounts (customer_id) 
  WHERE is_primary = true;
