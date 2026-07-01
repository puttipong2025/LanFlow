-- Table: payroll_slips
create table public.payroll_slips (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) not null,
  month text not null, -- Format: YYYY-MM
  gross_pay numeric not null default 0,
  total_deductions numeric not null default 0,
  net_pay numeric not null default 0,
  total_days numeric not null default 0,
  daily_wage numeric not null default 0,
  slip_data jsonb not null default '{}'::jsonb,
  status approval_status not null default 'PENDING',
  created_by uuid references public.profiles(id) not null,
  approved_by uuid references public.profiles(id),
  admin_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trigger for updated_at
create trigger handle_updated_at before update on public.payroll_slips
  for each row execute function moddatetime('updated_at');

-- GRANTS AND RLS
grant all on table public.payroll_slips to authenticated;
alter table public.payroll_slips enable row level security;
create policy "payroll_slips_all" on public.payroll_slips for all to authenticated using (true);
