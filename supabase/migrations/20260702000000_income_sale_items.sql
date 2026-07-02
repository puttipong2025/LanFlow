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

-- RLS
alter table public.income_sale_items enable row level security;

-- Policies
create policy "Allow all authenticated users to read active items"
on public.income_sale_items
for select
to authenticated
using (is_active = true);

create policy "Allow super_admin to read all items"
on public.income_sale_items
for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'super_admin'
  )
);

create policy "Allow super_admin to insert"
on public.income_sale_items
for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'super_admin'
  )
);

create policy "Allow super_admin to update"
on public.income_sale_items
for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'super_admin'
  )
);

-- Seed Initial Data
insert into public.income_sale_items (name) values
  ('น้ำกรดตราเสือไฟท์'),
  ('น้ำกรดตรามังกรไฟท์');

-- Migrate data in income_expense
update public.income_expense
set bill_option = 'บิลขาย'
where bill_option = 'บิลน้ำกรด';

update public.income_expense
set record_status = 'deleted',
    bill_option = null,
    deleted_at = now(),
    updated_at = now()
where type = 'income' and bill_option = 'บิลทั่วไป';

update public.income_expense
set record_status = 'deleted',
    bill_option = null,
    deleted_at = now(),
    updated_at = now()
where type = 'expense' and bill_option in ('บิลค่าแรง', 'สูญหาย');

-- Drop transaction_option
alter table public.income_expense drop column if exists transaction_option;

-- Add constraints and grants
create unique index income_sale_items_name_active_idx on public.income_sale_items (lower(trim(name))) where is_active = true;

grant select, insert, update on table public.income_sale_items to authenticated;
grant all privileges on table public.income_sale_items to service_role;

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
