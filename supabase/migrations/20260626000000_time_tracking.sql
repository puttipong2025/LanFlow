-- Enable moddatetime extension
create extension if not exists moddatetime schema extensions;

-- Add daily_wage to profiles
alter table public.profiles add column daily_wage numeric not null default 0;

-- Table: time_segments
create table public.time_segments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) not null,
  start_time timestamptz not null default now(),
  end_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Type for leave request
create type leave_request_type as enum ('FULL_DAY', 'HALF_DAY');
create type approval_status as enum ('PENDING', 'APPROVED', 'REJECTED');

-- Table: leave_requests
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) not null,
  start_date date not null,
  end_date date not null,
  type leave_request_type not null default 'FULL_DAY',
  status approval_status not null default 'PENDING',
  admin_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Table: debts
create table public.debts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) not null unique,
  total_amount numeric not null default 0,
  remaining_amount numeric not null default 0,
  installment_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Type for financial transaction
create type financial_transaction_type as enum ('WITHDRAWAL', 'DEBT_INSTALLMENT', 'ADJUSTMENT', 'SALARY');

-- Table: financial_transactions
create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) not null,
  type financial_transaction_type not null,
  amount numeric not null,
  status approval_status not null default 'PENDING',
  admin_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Table: time_tracking_audit_logs
create table public.time_tracking_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) not null,
  action text not null,
  target_table text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  comment text not null,
  created_at timestamptz not null default now()
);

-- Create updated_at triggers
create trigger handle_updated_at before update on public.time_segments
  for each row execute function moddatetime('updated_at');

create trigger handle_updated_at before update on public.leave_requests
  for each row execute function moddatetime('updated_at');

create trigger handle_updated_at before update on public.debts
  for each row execute function moddatetime('updated_at');

create trigger handle_updated_at before update on public.financial_transactions
  for each row execute function moddatetime('updated_at');

-- GRANTS AND RLS
grant select(daily_wage), update(daily_wage) on table public.profiles to authenticated;

grant all on table public.time_segments to authenticated;
alter table public.time_segments enable row level security;
create policy "time_segments_all" on public.time_segments for all to authenticated using (true);

grant all on table public.leave_requests to authenticated;
alter table public.leave_requests enable row level security;
create policy "leave_requests_all" on public.leave_requests for all to authenticated using (true);

grant all on table public.debts to authenticated;
alter table public.debts enable row level security;
create policy "debts_all" on public.debts for all to authenticated using (true);

grant all on table public.financial_transactions to authenticated;
alter table public.financial_transactions enable row level security;
create policy "financial_transactions_all" on public.financial_transactions for all to authenticated using (true);

grant all on table public.time_tracking_audit_logs to authenticated;
alter table public.time_tracking_audit_logs enable row level security;
create policy "time_tracking_audit_logs_all" on public.time_tracking_audit_logs for all to authenticated using (true);
