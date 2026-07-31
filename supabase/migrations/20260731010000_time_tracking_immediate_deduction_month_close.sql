-- Time Tracking / Payroll:
-- - manager-owned time controls
-- - effective transaction dates
-- - immediate, cross-month deductions
-- - atomic payroll month close and next-month resume
-- - removal of the unused leave workflow

alter table public.financial_transactions
  add column if not exists effective_date date,
  add column if not exists applied_month date;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_effective_date_shape,
  drop constraint if exists financial_transactions_applied_month_shape;

alter table public.financial_transactions
  add constraint financial_transactions_effective_date_shape check (
    (type in ('DEBT', 'WITHDRAWAL') and effective_date is not null)
    or
    (type not in ('DEBT', 'WITHDRAWAL'))
  ),
  add constraint financial_transactions_applied_month_shape check (
    (
      type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and applied_month is not null
      and applied_month = date_trunc('month', applied_month)::date
    )
    or
    (
      type not in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and applied_month is null
    )
  );

create index if not exists financial_transactions_outstanding_queue
  on public.financial_transactions(profile_id, effective_date, created_at, id)
  where type in ('DEBT', 'WITHDRAWAL')
    and status = 'APPROVED'
    and remaining_amount > 0;

create index if not exists financial_transactions_pending_effective_date
  on public.financial_transactions(profile_id, effective_date)
  where type in ('DEBT', 'WITHDRAWAL')
    and status = 'PENDING';

create index if not exists financial_transactions_deduction_month
  on public.financial_transactions(profile_id, applied_month, parent_debt_id)
  where type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
    and status = 'APPROVED';

create unique index if not exists time_segments_one_active_per_profile
  on public.time_segments(profile_id)
  where end_time is null;

create table if not exists public.time_tracking_resume_schedules (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  payroll_slip_id uuid not null unique references public.payroll_slips(id) on delete cascade,
  resume_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists time_tracking_resume_schedules_due
  on public.time_tracking_resume_schedules(resume_at);

alter table public.time_tracking_resume_schedules enable row level security;

create or replace function private.is_time_payroll_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and private.can_access_super_admin_features()
$$;

revoke all on function private.is_time_payroll_manager() from public, anon;
grant execute on function private.is_time_payroll_manager() to authenticated;

create or replace function private.can_assign_time_tracking_expense_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_time_payroll_manager()
    and target_location is not null
    and exists (
      select 1
      from public.locations l
      where l.id = target_location
        and l.is_active = true
    )
$$;

create or replace function private.can_approve_time_tracking_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_time_payroll_manager()
    and exists (
      select 1
      from public.profiles p
      where p.id = target_profile_id
        and p.is_active = true
    )
$$;

create or replace function public.calculate_paid_work_days(
  p_profile_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz default null
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(
    public.calculate_time_segment_paid_days(
      greatest(s.start_time, p_period_start),
      least(
        s.end_time,
        coalesce(p_period_end, s.end_time)
      )
    )
  ), 0)
  from public.time_segments s
  where s.profile_id = p_profile_id
    and s.end_time is not null
    and s.end_time > p_period_start
    and (p_period_end is null or s.start_time < p_period_end)
$$;

create or replace function private.apply_time_tracking_deductions(
  p_profile_id uuid,
  p_through_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_first_month date;
  v_through_month date := date_trunc('month', p_through_month)::date;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
  v_daily_wage numeric;
  v_gross numeric;
  v_used numeric;
  v_available numeric;
  v_amount numeric;
  v_total numeric := 0;
  v_parent record;
  v_child_type public.financial_transaction_type;
  v_comment text;
begin
  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));

  if v_through_month > v_current_month then
    v_through_month := v_current_month;
  end if;

  select p.daily_wage
  into v_daily_wage
  from public.profiles p
  where p.id = p_profile_id
    and p.is_active = true;

  if not found or coalesce(v_daily_wage, 0) <= 0 then
    return jsonb_build_object('deducted', 0);
  end if;

  select min(date_trunc('month', ft.effective_date)::date)
  into v_first_month
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and ft.type in ('DEBT', 'WITHDRAWAL')
    and ft.status = 'APPROVED'
    and ft.remaining_amount > 0
    and ft.effective_date < (v_through_month + interval '1 month')::date;

  if v_first_month is null then
    return jsonb_build_object('deducted', 0);
  end if;

  for v_month in
    select generate_series(
      v_first_month::timestamp,
      v_through_month::timestamp,
      interval '1 month'
    )::date
  loop
    if exists (
      select 1
      from public.payroll_slips ps
      where ps.profile_id = p_profile_id
        and ps.month = to_char(v_month, 'YYYY-MM')
    ) then
      continue;
    end if;

    v_gross := public.calculate_paid_work_days(
      p_profile_id,
      v_month::timestamp at time zone 'Asia/Bangkok',
      (v_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
    ) * v_daily_wage;

    select coalesce(sum(ft.amount), 0)
    into v_used
    from public.financial_transactions ft
    where ft.profile_id = p_profile_id
      and ft.status = 'APPROVED'
      and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and ft.applied_month = v_month;

    v_available := greatest(trunc(v_gross - v_used, 2), 0);
    if v_available <= 0 then
      continue;
    end if;

    for v_parent in
      select ft.*
      from public.financial_transactions ft
      where ft.profile_id = p_profile_id
        and ft.type in ('DEBT', 'WITHDRAWAL')
        and ft.status = 'APPROVED'
        and ft.remaining_amount > 0
        and ft.effective_date < (v_month + interval '1 month')::date
      order by ft.effective_date, ft.created_at, ft.id
      for update
    loop
      exit when v_available <= 0;

      v_amount := trunc(least(v_parent.remaining_amount, v_available), 2);
      if v_amount <= 0 then
        continue;
      end if;

      if v_parent.type = 'DEBT' then
        v_child_type := 'DEBT_DEDUCTION';
        v_comment := 'หักหนี้อัตโนมัติ';
      else
        v_child_type := 'WITHDRAWAL_DEDUCTION';
        v_comment := 'หักยอดเบิกเงินอัตโนมัติ';
      end if;

      update public.financial_transactions
      set remaining_amount = greatest(remaining_amount - v_amount, 0)
      where id = v_parent.id;

      insert into public.financial_transactions (
        profile_id,
        type,
        amount,
        status,
        parent_debt_id,
        applied_month,
        admin_comment,
        approved_by,
        approved_at
      )
      values (
        p_profile_id,
        v_child_type,
        v_amount,
        'APPROVED',
        v_parent.id,
        v_month,
        v_comment,
        v_parent.approved_by,
        now()
      );

      insert into public.time_tracking_audit_logs (
        admin_id,
        action,
        target_table,
        record_id,
        new_data,
        comment
      )
      values (
        coalesce(v_parent.approved_by, p_profile_id),
        'AUTO_DEDUCTION',
        'financial_transactions',
        v_parent.id,
        jsonb_build_object(
          'deducted_amount', v_amount,
          'remaining_amount', greatest(v_parent.remaining_amount - v_amount, 0),
          'type', v_child_type,
          'applied_month', v_month
        ),
        v_comment
      );

      v_parent.remaining_amount := greatest(v_parent.remaining_amount - v_amount, 0);
      v_available := trunc(v_available - v_amount, 2);
      v_total := v_total + v_amount;
    end loop;
  end loop;

  return jsonb_build_object('deducted', v_total);
end;
$$;

revoke all on function private.apply_time_tracking_deductions(uuid, date) from public, anon, authenticated;

create or replace function public.deduct_debts_daily()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
begin
  for v_profile_id in
    select distinct ft.profile_id
    from public.financial_transactions ft
    where ft.type in ('DEBT', 'WITHDRAWAL')
      and ft.status = 'APPROVED'
      and ft.remaining_amount > 0
  loop
    perform private.apply_time_tracking_deductions(v_profile_id, v_current_month);
  end loop;
end;
$$;

revoke all on function public.deduct_debts_daily() from public, anon, authenticated;

create or replace function public.run_time_tracking_daily_cutoff()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment record;
  v_cutoff timestamptz := (
    (now() at time zone 'Asia/Bangkok')::date::text || ' 15:00:00'
  )::timestamp at time zone 'Asia/Bangkok';
  v_count integer := 0;
begin
  if now() < v_cutoff then
    return 0;
  end if;

  for v_segment in
    select s.id, s.profile_id
    from public.time_segments s
    join public.profiles p on p.id = s.profile_id and p.is_active = true
    where s.end_time is null
      and s.start_time < v_cutoff
    order by s.profile_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_segment.profile_id::text, 0));

    update public.time_segments
    set end_time = v_cutoff
    where id = v_segment.id
      and end_time is null
      and start_time < v_cutoff;
    if not found then
      continue;
    end if;

    if not exists (
      select 1
      from public.payroll_slips ps
      where ps.profile_id = v_segment.profile_id
        and ps.month = to_char(v_cutoff at time zone 'Asia/Bangkok', 'YYYY-MM')
    ) then
      insert into public.time_segments(profile_id, start_time)
      values (v_segment.profile_id, v_cutoff);
    end if;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, new_data, comment
    )
    values (
      v_segment.profile_id,
      'SYSTEM_DAILY_CUTOFF',
      'time_segments',
      v_segment.profile_id,
      jsonb_build_object('cutoff_time', v_cutoff),
      'ตัดรอบอัตโนมัติ 15:00 น.'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.run_time_tracking_daily_cutoff() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'time-tracking-daily-cutoff';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'time-tracking-daily-cutoff',
    '0 8 * * *',
    'select public.run_time_tracking_daily_cutoff()'
  );
end
$$;

create or replace function public.create_time_tracking_transaction(
  p_profile_id uuid,
  p_type text,
  p_amount numeric,
  p_effective_date date,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_is_manager boolean;
  v_id uuid;
  v_comment text;
  v_actor_name text;
  v_bangkok_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;

  v_is_manager := private.is_time_payroll_manager();
  if p_type not in ('DEBT', 'WITHDRAWAL') then
    raise exception 'INVALID_TRANSACTION_TYPE';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_effective_date is null or p_effective_date > v_bangkok_today then
    raise exception 'FUTURE_EFFECTIVE_DATE';
  end if;
  if p_type = 'DEBT' and not v_is_manager then
    raise exception 'Forbidden';
  end if;
  if p_type = 'WITHDRAWAL' and p_profile_id <> v_actor_id and not v_is_manager then
    raise exception 'Forbidden';
  end if;
  if p_type = 'DEBT' and nullif(btrim(coalesce(p_description, '')), '') is null then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.is_active = true
  ) then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if exists (
    select 1
    from public.payroll_slips ps
    where ps.profile_id = p_profile_id
      and ps.month = to_char(p_effective_date, 'YYYY-MM')
  ) then
    raise exception 'MONTH_CLOSED:%', to_char(p_effective_date, 'YYYY-MM');
  end if;

  select p.name into v_actor_name from public.profiles p where p.id = v_actor_id;
  v_comment := case
    when v_actor_id = p_profile_id and p_type = 'WITHDRAWAL' then null
    when p_type = 'DEBT' then 'สร้างหนี้สินโดย: ' || coalesce(v_actor_name, 'ผู้จัดการ')
    else 'ยื่นแทนโดยผู้จัดการ: ' || coalesce(v_actor_name, 'ผู้จัดการ')
  end;

  insert into public.financial_transactions (
    profile_id,
    type,
    amount,
    effective_date,
    due_date,
    description,
    admin_comment
  )
  values (
    p_profile_id,
    p_type::public.financial_transaction_type,
    trunc(p_amount, 2),
    p_effective_date,
    case when p_type = 'DEBT' then p_effective_date else null end,
    nullif(btrim(coalesce(p_description, '')), ''),
    v_comment
  )
  returning id into v_id;

  insert into public.time_tracking_audit_logs (
    admin_id,
    action,
    target_table,
    record_id,
    new_data,
    comment
  )
  values (
    v_actor_id,
    case when p_type = 'DEBT' then 'CREATE_DEBT' else 'REQUEST_WITHDRAWAL' end,
    'financial_transactions',
    v_id,
    jsonb_build_object(
      'profile_id', p_profile_id,
      'type', p_type,
      'amount', trunc(p_amount, 2),
      'effective_date', p_effective_date,
      'description', nullif(btrim(coalesce(p_description, '')), '')
    ),
    v_comment
  );

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

create or replace function public.set_time_tracking_status(
  p_profile_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_segment_id uuid;
  v_now timestamptz := now();
  v_current_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_status not in ('RUNNING', 'PAUSED') then
    raise exception 'INVALID_TRACKING_STATUS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  select s.id into v_segment_id
  from public.time_segments s
  where s.profile_id = p_profile_id and s.end_time is null
  for update;

  if p_status = 'RUNNING' then
    if exists (
      select 1 from public.payroll_slips ps
      where ps.profile_id = p_profile_id and ps.month = v_current_month
    ) then
      raise exception 'MONTH_CLOSED:%', v_current_month;
    end if;
    if v_segment_id is null then
      insert into public.time_segments(profile_id, start_time)
      values (p_profile_id, v_now)
      returning id into v_segment_id;
    end if;
  else
    if v_segment_id is not null then
      update public.time_segments set end_time = v_now where id = v_segment_id;
    end if;
    delete from public.time_tracking_resume_schedules where profile_id = p_profile_id;
  end if;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data
  )
  values (
    v_actor_id,
    'TOGGLE_TRACKING',
    'time_segments',
    p_profile_id,
    jsonb_build_object('status', p_status, 'server_time', v_now)
  );

  return jsonb_build_object('status', lower(p_status), 'segmentId', v_segment_id);
end;
$$;

create or replace function public.cutoff_time_tracking(
  p_profile_id uuid,
  p_cutoff_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_segment public.time_segments%rowtype;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_cutoff_time is null or p_cutoff_time > now() + interval '5 minutes' then
    raise exception 'INVALID_CUTOFF_TIME';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));
  select * into v_segment
  from public.time_segments s
  where s.profile_id = p_profile_id and s.end_time is null
  for update;

  if not found or p_cutoff_time <= v_segment.start_time then
    return jsonb_build_object('status', 'unchanged');
  end if;

  update public.time_segments set end_time = p_cutoff_time where id = v_segment.id;
  insert into public.time_segments(profile_id, start_time)
  values (p_profile_id, p_cutoff_time);

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data, comment
  )
  values (
    v_actor_id,
    'CUTOFF_TRACKING',
    'time_segments',
    p_profile_id,
    jsonb_build_object('cutoff_time', p_cutoff_time),
    'Auto split at 15:00'
  );

  return jsonb_build_object('status', 'split');
end;
$$;

create or replace function public.update_time_tracking_wage(
  p_profile_id uuid,
  p_daily_wage numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_old_wage numeric;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_daily_wage is null or p_daily_wage < 0 then
    raise exception 'INVALID_WAGE';
  end if;

  select p.daily_wage into v_old_wage
  from public.profiles p
  where p.id = p_profile_id
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if exists (
    select 1
    from public.financial_transactions ft
    where ft.profile_id = p_profile_id
      and ft.status = 'APPROVED'
      and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and not exists (
        select 1
        from public.payroll_slips ps
        where ps.profile_id = p_profile_id
          and ps.month = to_char(ft.applied_month, 'YYYY-MM')
      )
  ) then
    raise exception 'DEDUCTION_WAGE_LOCKED';
  end if;

  update public.profiles
  set daily_wage = trunc(p_daily_wage, 2)
  where id = p_profile_id;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, old_data, new_data
  )
  values (
    v_actor_id,
    'UPDATE_WAGE',
    'profiles',
    p_profile_id,
    jsonb_build_object('daily_wage', v_old_wage),
    jsonb_build_object('daily_wage', trunc(p_daily_wage, 2))
  );

  return jsonb_build_object('dailyWage', trunc(p_daily_wage, 2));
end;
$$;

create or replace function public.replace_time_tracking_segments(
  p_profile_id uuid,
  p_selections jsonb,
  p_full_snapshot jsonb default '{}'::jsonb,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_item jsonb;
  v_date date;
  v_work_type text;
  v_start timestamptz;
  v_end timestamptz;
  v_old jsonb := '[]'::jsonb;
  v_new jsonb := '[]'::jsonb;
  v_inserted public.time_segments%rowtype;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if jsonb_typeof(p_selections) <> 'array' then
    raise exception 'INVALID_SELECTIONS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));

  for v_item in select value from jsonb_array_elements(p_selections)
  loop
    v_date := (v_item->>'date')::date;
    v_work_type := v_item->>'work_type';
    if v_date is null
      or v_date > (now() at time zone 'Asia/Bangkok')::date
      or v_work_type not in ('FULL_DAY', 'HALF_DAY', 'NONE')
    then
      raise exception 'INVALID_SELECTION';
    end if;
    if exists (
      select 1 from public.payroll_slips ps
      where ps.profile_id = p_profile_id
        and ps.month = to_char(v_date, 'YYYY-MM')
    ) then
      raise exception 'MONTH_CLOSED:%', to_char(v_date, 'YYYY-MM');
    end if;
    if exists (
      select 1
      from public.financial_transactions ft
      where ft.profile_id = p_profile_id
        and ft.status = 'APPROVED'
        and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and ft.applied_month = date_trunc('month', v_date)::date
    ) then
      raise exception 'DEDUCTION_LOCKED:%', to_char(v_date, 'YYYY-MM');
    end if;

    v_start := v_date::timestamp at time zone 'Asia/Bangkok';
    v_end := (v_date + 1)::timestamp at time zone 'Asia/Bangkok';

    select v_old || coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    into v_old
    from public.time_segments s
    where s.profile_id = p_profile_id
      and s.start_time >= v_start
      and s.start_time < v_end;

    delete from public.time_segments s
    where s.profile_id = p_profile_id
      and s.start_time >= v_start
      and s.start_time < v_end;

    if v_work_type <> 'NONE' then
      insert into public.time_segments(profile_id, start_time, end_time)
      values (
        p_profile_id,
        (v_date::text || ' 08:00:00')::timestamp at time zone 'Asia/Bangkok',
        (
          v_date::text
          || case when v_work_type = 'HALF_DAY' then ' 12:00:00' else ' 16:00:00' end
        )::timestamp at time zone 'Asia/Bangkok'
      )
      returning * into v_inserted;
      v_new := v_new || jsonb_build_array(to_jsonb(v_inserted));
    end if;
  end loop;

  insert into public.time_tracking_audit_logs (
    admin_id,
    action,
    target_table,
    record_id,
    old_data,
    new_data,
    comment
  )
  values (
    v_actor_id,
    'BULK_UPDATE_SEGMENTS',
    'time_segments',
    p_profile_id,
    jsonb_build_object('segments', v_old),
    jsonb_build_object('segments', v_new, 'selections', p_selections, 'full_snapshot', p_full_snapshot),
    p_comment
  );

  return jsonb_build_object('status', 'updated');
end;
$$;

create or replace function public.create_time_tracking_payroll_slip(
  p_profile_id uuid,
  p_month text,
  p_auto_start_next_month boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_month date;
  v_next_month date;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
  v_scan_month date;
  v_first_segment_month date;
  v_active_segment public.time_segments%rowtype;
  v_was_running boolean := false;
  v_daily_wage numeric;
  v_total_days numeric;
  v_gross numeric;
  v_deductions numeric;
  v_net numeric;
  v_segments jsonb;
  v_transactions jsonb;
  v_slip public.payroll_slips%rowtype;
  v_blocker record;
begin
  if v_actor_id is null or not private.can_approve_time_tracking_profile(p_profile_id) then
    raise exception 'Forbidden';
  end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'INVALID_MONTH';
  end if;

  begin
    v_month := (p_month || '-01')::date;
  exception when others then
    raise exception 'INVALID_MONTH';
  end;
  if to_char(v_month, 'YYYY-MM') <> p_month or v_month > v_current_month then
    raise exception 'INVALID_MONTH';
  end if;
  v_next_month := (v_month + interval '1 month')::date;

  perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || p_profile_id::text, 0));

  if exists (
    select 1 from public.payroll_slips ps
    where ps.profile_id = p_profile_id and ps.month = p_month
  ) then
    raise exception 'MONTH_CLOSED:%', p_month;
  end if;

  select ft.id, ft.type::text type, ft.effective_date
  into v_blocker
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and ft.type in ('DEBT', 'WITHDRAWAL')
    and ft.status = 'PENDING'
    and ft.effective_date < v_next_month
  order by ft.effective_date, ft.created_at, ft.id
  limit 1;
  if found then
    raise exception 'PENDING_BLOCKER:%:%:%',
      v_blocker.type,
      v_blocker.id,
      to_char(v_blocker.effective_date, 'YYYY-MM');
  end if;

  select min(date_trunc('month', s.start_time at time zone 'Asia/Bangkok')::date)
  into v_first_segment_month
  from public.time_segments s
  where s.profile_id = p_profile_id;

  if v_first_segment_month is not null then
    for v_scan_month in
      select generate_series(
        v_first_segment_month::timestamp,
        (v_month - interval '1 month')::timestamp,
        interval '1 month'
      )::date
    loop
      if not exists (
        select 1 from public.payroll_slips ps
        where ps.profile_id = p_profile_id
          and ps.month = to_char(v_scan_month, 'YYYY-MM')
      ) and public.calculate_paid_work_days(
        p_profile_id,
        v_scan_month::timestamp at time zone 'Asia/Bangkok',
        (v_scan_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok'
      ) > 0 then
        raise exception 'OLDER_WORK_MONTH:%', to_char(v_scan_month, 'YYYY-MM');
      end if;
    end loop;
  end if;

  if v_month = v_current_month then
    select * into v_active_segment
    from public.time_segments s
    where s.profile_id = p_profile_id and s.end_time is null
    for update;
    if found then
      v_was_running := true;
      update public.time_segments
      set end_time = now()
      where id = v_active_segment.id;
    end if;
  end if;

  v_total_days := public.calculate_paid_work_days(
    p_profile_id,
    v_month::timestamp at time zone 'Asia/Bangkok',
    v_next_month::timestamp at time zone 'Asia/Bangkok'
  );

  if v_month < v_current_month and v_total_days <= 0 then
    raise exception 'NO_WORK_MONTH:%', p_month;
  end if;

  perform private.apply_time_tracking_deductions(p_profile_id, v_month);

  select p.daily_wage into v_daily_wage
  from public.profiles p
  where p.id = p_profile_id;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  v_gross := trunc(v_total_days * v_daily_wage, 2);
  select coalesce(sum(ft.amount), 0)
  into v_deductions
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and ft.status = 'APPROVED'
    and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
    and ft.applied_month = v_month;
  v_net := greatest(trunc(v_gross - v_deductions, 2), 0);

  select coalesce(jsonb_agg(to_jsonb(s) order by s.start_time), '[]'::jsonb)
  into v_segments
  from public.time_segments s
  where s.profile_id = p_profile_id
    and s.end_time is not null
    and s.end_time > (v_month::timestamp at time zone 'Asia/Bangkok')
    and s.start_time < (v_next_month::timestamp at time zone 'Asia/Bangkok');

  select coalesce(jsonb_agg(to_jsonb(ft) order by ft.created_at, ft.id), '[]'::jsonb)
  into v_transactions
  from public.financial_transactions ft
  where ft.profile_id = p_profile_id
    and (
      (
        ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
        and ft.applied_month = v_month
      )
      or
      (
        ft.type in ('DEBT', 'WITHDRAWAL')
        and ft.effective_date >= v_month
        and ft.effective_date < v_next_month
      )
    );

  insert into public.payroll_slips (
    profile_id,
    month,
    gross_pay,
    total_deductions,
    net_pay,
    total_days,
    daily_wage,
    slip_data,
    status,
    created_by
  )
  values (
    p_profile_id,
    p_month,
    v_gross,
    v_deductions,
    v_net,
    v_total_days,
    v_daily_wage,
    jsonb_build_object(
      'segments', v_segments,
      'transactions', v_transactions,
      'lockedAt', now()
    ),
    'PENDING',
    v_actor_id
  )
  returning * into v_slip;

  if v_month = v_current_month and v_was_running and p_auto_start_next_month then
    insert into public.time_tracking_resume_schedules (
      profile_id,
      payroll_slip_id,
      resume_at,
      created_by
    )
    values (
      p_profile_id,
      v_slip.id,
      v_next_month::timestamp at time zone 'Asia/Bangkok',
      v_actor_id
    )
    on conflict (profile_id) do update
    set
      payroll_slip_id = excluded.payroll_slip_id,
      resume_at = excluded.resume_at,
      created_by = excluded.created_by,
      created_at = now();
  else
    delete from public.time_tracking_resume_schedules
    where profile_id = p_profile_id;
  end if;

  insert into public.time_tracking_audit_logs (
    admin_id, action, target_table, record_id, new_data, comment
  )
  values (
    v_actor_id,
    'CREATE_PAYROLL_SLIP',
    'payroll_slips',
    v_slip.id,
    to_jsonb(v_slip) || jsonb_build_object(
      'was_running', v_was_running,
      'auto_start_next_month', v_month = v_current_month
        and v_was_running
        and p_auto_start_next_month
    ),
    'สร้างสลิปเดือน ' || p_month
  );

  return to_jsonb(v_slip) || jsonb_build_object(
    'auto_start_scheduled',
    v_month = v_current_month and v_was_running and p_auto_start_next_month
  );
end;
$$;

create or replace function public.run_time_tracking_auto_start()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule record;
  v_started integer := 0;
begin
  for v_schedule in
    select rs.*
    from public.time_tracking_resume_schedules rs
    join public.profiles p on p.id = rs.profile_id and p.is_active = true
    where rs.resume_at <= now()
    order by rs.resume_at, rs.profile_id
    for update of rs skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_schedule.profile_id::text, 0));

    if not exists (
      select 1
      from public.time_segments s
      where s.profile_id = v_schedule.profile_id
        and s.end_time is null
    ) and not exists (
      select 1
      from public.payroll_slips ps
      where ps.profile_id = v_schedule.profile_id
        and ps.month = to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    ) then
      insert into public.time_segments(profile_id, start_time)
      values (v_schedule.profile_id, v_schedule.resume_at);

      insert into public.time_tracking_audit_logs (
        admin_id, action, target_table, record_id, new_data, comment
      )
      values (
        v_schedule.created_by,
        'AUTO_START_NEXT_MONTH',
        'time_segments',
        v_schedule.profile_id,
        jsonb_build_object(
          'start_time', v_schedule.resume_at,
          'payroll_slip_id', v_schedule.payroll_slip_id
        ),
        'เริ่มนับเวลาอัตโนมัติหลังปิดเดือน'
      );
      v_started := v_started + 1;
    end if;

    delete from public.time_tracking_resume_schedules
    where profile_id = v_schedule.profile_id;
  end loop;

  return v_started;
end;
$$;

revoke all on function public.run_time_tracking_auto_start() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'time-tracking-auto-start';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'time-tracking-auto-start',
    '0 17 * * *',
    'select public.run_time_tracking_auto_start()'
  );
end
$$;

create or replace function public.decide_time_tracking_approval(
  p_source_type text,
  p_source_id uuid,
  p_decision text,
  p_comment text default null,
  p_expense_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_actor_id uuid := auth.uid();
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_old_data jsonb;
  v_requires_expense_location boolean := false;
  v_current_month date := date_trunc(
    'month',
    (now() at time zone 'Asia/Bangkok')::date
  )::date;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid approval source';
  end if;
  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'Invalid approval decision';
  end if;

  if p_source_type = 'transaction' then
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;
    if not private.can_approve_time_tracking_profile(v_tx.profile_id) then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_tx.profile_id::text, 0));
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;
    if exists (
      select 1 from public.payroll_slips ps
      where ps.profile_id = v_tx.profile_id
        and ps.month = to_char(v_tx.effective_date, 'YYYY-MM')
    ) then
      raise exception 'MONTH_CLOSED:%', to_char(v_tx.effective_date, 'YYYY-MM');
    end if;

    v_requires_expense_location := p_decision = 'APPROVED' and v_tx.type = 'WITHDRAWAL';
    if v_tx.status <> 'PENDING' then
      if v_tx.status = p_decision::public.approval_status
        and (
          not v_requires_expense_location
          or v_tx.expense_location_id = p_expense_location_id
        )
      then
        return jsonb_build_object(
          'status', lower(p_decision),
          'idempotent', true,
          'sourceType', p_source_type,
          'sourceId', p_source_id
        );
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_expense_location then
      if p_expense_location_id is null
        or not private.can_assign_time_tracking_expense_location(p_expense_location_id)
      then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_tx);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.financial_transactions
      set
        status = 'APPROVED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id,
        approved_at = now(),
        expense_location_id = case
          when v_requires_expense_location then p_expense_location_id
          else null
        end,
        remaining_amount = amount
      where id = v_tx.id;

      perform private.apply_time_tracking_deductions(v_tx.profile_id, v_current_month);
    else
      update public.financial_transactions
      set
        status = 'REJECTED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id
      where id = v_tx.id;
    end if;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    )
    values (
      v_actor_id,
      'DECIDE_TRANSACTION_APPROVAL',
      'financial_transactions',
      v_tx.id,
      v_old_data,
      jsonb_build_object(
        'decision', p_decision,
        'expenseLocationId', p_expense_location_id
      ),
      coalesce(p_comment, '')
    );
  else
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id;
    if not found then raise exception 'Payroll slip not found'; end if;
    if not private.can_approve_time_tracking_profile(v_slip.profile_id) then
      raise exception 'Forbidden';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_slip.profile_id::text, 0));
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found then raise exception 'Payroll slip not found'; end if;

    v_requires_expense_location := p_decision = 'APPROVED' and v_slip.net_pay > 0;
    if v_slip.status <> 'PENDING' then
      if v_slip.status = p_decision::public.approval_status
        and (
          not v_requires_expense_location
          or v_slip.expense_location_id = p_expense_location_id
        )
      then
        return jsonb_build_object(
          'status', lower(p_decision),
          'idempotent', true,
          'sourceType', p_source_type,
          'sourceId', p_source_id
        );
      end if;
      raise exception 'Approval has already been decided';
    end if;

    if v_requires_expense_location then
      if p_expense_location_id is null
        or not private.can_assign_time_tracking_expense_location(p_expense_location_id)
      then
        raise exception 'Expense location access denied';
      end if;
    elsif p_expense_location_id is not null then
      raise exception 'Expense location is not valid for this decision';
    end if;

    v_old_data := to_jsonb(v_slip);
    if p_decision = 'APPROVED' then
      perform set_config('app.time_tracking_expense_rpc', 'true', true);
      update public.payroll_slips
      set
        status = 'APPROVED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id,
        approved_at = now(),
        expense_location_id = case
          when v_requires_expense_location then p_expense_location_id
          else null
        end
      where id = v_slip.id;
    else
      update public.payroll_slips
      set
        status = 'REJECTED',
        admin_comment = coalesce(p_comment, ''),
        approved_by = v_actor_id
      where id = v_slip.id;
    end if;

    insert into public.time_tracking_audit_logs (
      admin_id, action, target_table, record_id, old_data, new_data, comment
    )
    values (
      v_actor_id,
      'DECIDE_PAYROLL_SLIP_APPROVAL',
      'payroll_slips',
      v_slip.id,
      v_old_data,
      jsonb_build_object(
        'decision', p_decision,
        'expenseLocationId', p_expense_location_id
      ),
      coalesce(p_comment, '')
    );
  end if;

  return jsonb_build_object(
    'status', lower(p_decision),
    'idempotent', false,
    'sourceType', p_source_type,
    'sourceId', p_source_id
  );
end;
$$;

create or replace function public.delete_time_tracking_source_permanently(
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_actor_id uuid := auth.uid();
  v_is_manager boolean;
  v_tx public.financial_transactions%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_blocked_month text;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if p_source_type not in ('transaction', 'payroll_slip') then
    raise exception 'Invalid deletion source';
  end if;
  v_is_manager := private.is_time_payroll_manager();

  if p_source_type = 'transaction' then
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;

    if v_tx.status = 'PENDING'
      and v_tx.type = 'WITHDRAWAL'
      and v_tx.profile_id = v_actor_id
    then
      null;
    elsif not v_is_manager then
      raise exception 'Forbidden';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_tx.profile_id::text, 0));
    select * into v_tx
    from public.financial_transactions
    where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;

    select ps.month into v_blocked_month
    from public.payroll_slips ps
    where ps.profile_id = v_tx.profile_id
      and (
        ps.month = to_char(v_tx.effective_date, 'YYYY-MM')
        or exists (
          select 1
          from public.financial_transactions child
          where child.parent_debt_id = v_tx.id
            and child.applied_month is not null
            and ps.month = to_char(child.applied_month, 'YYYY-MM')
        )
      )
    order by ps.month
    limit 1;
    if v_blocked_month is not null then
      raise exception 'MONTH_CLOSED:%', v_blocked_month;
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'financial_transactions'
      and (
        record_id = v_tx.id
        or record_id in (
          select id
          from public.financial_transactions
          where parent_debt_id = v_tx.id
        )
      );

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.financial_transactions where parent_debt_id = v_tx.id;
    delete from public.financial_transactions where id = v_tx.id;
  else
    if not v_is_manager then raise exception 'Forbidden'; end if;

    select * into v_slip
    from public.payroll_slips
    where id = p_source_id;
    if not found then raise exception 'Payroll slip not found'; end if;
    if not private.can_approve_time_tracking_profile(v_slip.profile_id) then
      raise exception 'Forbidden';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('time-tracking:' || v_slip.profile_id::text, 0));
    select * into v_slip
    from public.payroll_slips
    where id = p_source_id
    for update;
    if not found then raise exception 'Payroll slip not found'; end if;

    if exists (
      select 1
      from public.payroll_slips newer
      where newer.profile_id = v_slip.profile_id
        and newer.month > v_slip.month
    ) then
      select min(newer.month) into v_blocked_month
      from public.payroll_slips newer
      where newer.profile_id = v_slip.profile_id
        and newer.month > v_slip.month;
      raise exception 'DELETE_NEWER_SLIP_FIRST:%', v_blocked_month;
    end if;

    delete from public.time_tracking_audit_logs
    where target_table = 'payroll_slips' and record_id = v_slip.id;

    perform set_config('app.time_tracking_permanent_delete_rpc', 'true', true);
    delete from public.payroll_slips where id = v_slip.id;
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'sourceType', p_source_type,
    'sourceId', p_source_id
  );
end;
$$;

create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_can_manage_system boolean;
  v_can_use_money_transfer boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select
    p.role,
    p.role = 'super_admin' or p.can_access_super_admin_features = true,
    p.role = 'super_admin'
      or p.can_access_super_admin_features = true
      or p.can_access_money_transfer = true
  into v_role, v_can_manage_system, v_can_use_money_transfer
  from public.profiles p
  where p.id = v_user_id and p.is_active = true;
  if v_role is null then raise exception 'Inactive profile'; end if;

  return query
  with accessible_locations as (
    select ul.location_id
    from public.user_locations ul
    join public.locations l on l.id = ul.location_id and l.is_active = true
    where ul.user_id = v_user_id
  ),
  counts as (
    select al.location_id, 'rubber'::text module_id, count(*)::bigint item_count
    from accessible_locations al
    cross join lateral private.rubber_bill_report_blockers(al.location_id, now()) b
    where v_can_manage_system or b.blocker_type = 'zero_price'
    group by al.location_id

    union all
    select t.target_location_id, 'cash', count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    join accessible_locations al on al.location_id = t.target_location_id
    where d.cash_status = 'pending_receipt' and t.record_status <> 'deleted'
    group by t.target_location_id

    union all
    select r.location_id, 'cash', count(*)::bigint
    from public.income_expense_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select r.source_location_id, 'cash', count(*)::bigint
    from public.cash_transfer_delete_requests r
    join accessible_locations al on al.location_id = r.source_location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.source_location_id

    union all
    select t.location_id, 'money-transfer', count(*)::bigint
    from public.money_transfers t
    join accessible_locations al on al.location_id = t.location_id
    where v_can_use_money_transfer
      and t.transfer_method = 'bank'
      and t.transfer_status in ('pending', 'partial', 'advance_payment')
      and t.record_status <> 'deleted'
    group by t.location_id

    union all
    select r.location_id, 'acid-stock', count(*)::bigint
    from public.stock_entry_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select al.location_id, 'acid-stock', count(r.id)::bigint
    from accessible_locations al
    cross join public.stock_product_approval_requests r
    where v_can_manage_system and r.request_status = 'pending'
    group by al.location_id

    union all
    select al.location_id, 'time-tracking', count(requests.id)::bigint
    from accessible_locations al
    cross join (
      select ft.id
      from public.financial_transactions ft
      where v_can_manage_system and ft.status = 'PENDING'
      union all
      select ps.id
      from public.payroll_slips ps
      where v_can_manage_system and ps.status = 'PENDING'
    ) requests
    group by al.location_id

    union all
    select e.location_id, 'rubber-export', count(*)::bigint
    from public.rubber_exports e
    join accessible_locations al on al.location_id = e.location_id
    where (v_can_manage_system or v_role = 'admin') and e.status = 'draft'
    group by e.location_id
  )
  select c.location_id, c.module_id, sum(c.item_count)::bigint
  from counts c
  where c.item_count > 0
  group by c.location_id, c.module_id
  order by c.location_id, c.module_id;
end;
$$;

create or replace function public.get_telegram_badge_counts()
returns table(
  badge_key text,
  location_id uuid,
  branch_name text,
  module_name text,
  status_label text,
  item_count bigint,
  sort_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with enabled as (
    select c.badge_key, c.module_name, c.status_label, c.sort_order
    from public.telegram_badge_catalog c
    join public.telegram_badge_settings s
      on s.id = true and c.badge_key = any(s.enabled_badge_keys)
  ),
  pending as (
    select 'rubber_bill_approval_pending'::text badge_key,
      r.location_id, coalesce(l.name, 'ส่วนกลาง') branch_name, count(*)::bigint item_count
    from public.rubber_bill_approval_requests r
    left join public.locations l on l.id = r.location_id
    where r.request_status = 'pending'
    group by r.location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'income_expense_approval_pending',
      r.location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.income_expense_approval_requests r
    left join public.locations l on l.id = r.location_id
    where r.request_status = 'pending'
    group by r.location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'cash_transfer_pending_receipt',
      t.target_location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    left join public.locations l on l.id = t.target_location_id
    where d.cash_status = 'pending_receipt' and t.record_status <> 'deleted'
    group by t.target_location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'cash_transfer_mismatched',
      t.target_location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    left join public.locations l on l.id = t.target_location_id
    where d.cash_status = 'mismatched' and t.record_status <> 'deleted'
    group by t.target_location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'stock_approval_pending', null::uuid, 'ส่วนกลาง', count(*)::bigint
    from public.stock_product_approval_requests r
    where r.request_status = 'pending'
    having count(*) > 0

    union all
    select 'stock_approval_pending',
      r.location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.stock_entry_approval_requests r
    left join public.locations l on l.id = r.location_id
    where r.request_status = 'pending'
    group by r.location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select
      case t.transfer_status
        when 'pending' then 'money_transfer_pending'
        when 'partial' then 'money_transfer_partial'
        else 'money_transfer_advance'
      end,
      t.location_id,
      coalesce(l.name, 'ส่วนกลาง'),
      count(*)::bigint
    from public.money_transfers t
    left join public.locations l on l.id = t.location_id
    where t.transfer_method = 'bank'
      and t.transfer_status in ('pending', 'partial', 'advance_payment')
      and t.record_status <> 'deleted'
    group by t.transfer_status, t.location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'time_tracking_approval_pending', null::uuid, 'ส่วนกลาง', count(*)::bigint
    from (
      select id from public.financial_transactions where status = 'PENDING'
      union all
      select id from public.payroll_slips where status = 'PENDING'
    ) requests
    having count(*) > 0

    union all
    select 'rubber_export_draft',
      e.location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.rubber_exports e
    left join public.locations l on l.id = e.location_id
    where e.status = 'draft'
    group by e.location_id, coalesce(l.name, 'ส่วนกลาง')
  )
  select e.badge_key, p.location_id, p.branch_name, e.module_name, e.status_label,
    sum(p.item_count)::bigint item_count, e.sort_order
  from pending p
  join enabled e on e.badge_key = p.badge_key
  where p.item_count > 0
  group by e.badge_key, p.location_id, p.branch_name, e.module_name, e.status_label, e.sort_order
  order by
    case when p.branch_name = 'ส่วนกลาง' then 1 else 0 end,
    p.branch_name,
    e.sort_order
$$;

drop trigger if exists report_lock_leave_requests on public.leave_requests;
drop function if exists public.report_lock_no(public.leave_requests);
drop table if exists public.leave_requests;
drop type if exists public.leave_request_type;

drop policy if exists financial_transactions_all on public.financial_transactions;
drop policy if exists payroll_slips_all on public.payroll_slips;
drop policy if exists time_segments_all on public.time_segments;
drop policy if exists time_tracking_audit_logs_all on public.time_tracking_audit_logs;

create policy financial_transactions_read_self_or_manager
on public.financial_transactions
for select
to authenticated
using (
  profile_id = auth.uid()
  or private.is_time_payroll_manager()
);

create policy payroll_slips_read_self_or_manager
on public.payroll_slips
for select
to authenticated
using (
  profile_id = auth.uid()
  or private.is_time_payroll_manager()
);

create policy time_segments_read_self_or_manager
on public.time_segments
for select
to authenticated
using (
  profile_id = auth.uid()
  or private.is_time_payroll_manager()
);

create policy time_tracking_audit_logs_read_manager
on public.time_tracking_audit_logs
for select
to authenticated
using (private.is_time_payroll_manager());

create policy time_tracking_resume_schedules_read_self_or_manager
on public.time_tracking_resume_schedules
for select
to authenticated
using (
  profile_id = auth.uid()
  or private.is_time_payroll_manager()
);

revoke all on table public.financial_transactions from anon, authenticated;
revoke all on table public.payroll_slips from anon, authenticated;
revoke all on table public.time_segments from anon, authenticated;
revoke all on table public.time_tracking_audit_logs from anon, authenticated;
revoke all on table public.time_tracking_resume_schedules from anon, authenticated;

grant select on table public.financial_transactions to authenticated;
grant select on table public.payroll_slips to authenticated;
grant select on table public.time_segments to authenticated;
grant select on table public.time_tracking_audit_logs to authenticated;
grant select on table public.time_tracking_resume_schedules to authenticated;

-- Service-role access is reserved for trusted maintenance and automated tests.
grant all on table public.financial_transactions to service_role;
grant all on table public.payroll_slips to service_role;
grant all on table public.time_segments to service_role;
grant all on table public.time_tracking_audit_logs to service_role;
grant all on table public.time_tracking_resume_schedules to service_role;

revoke all on function public.create_time_tracking_transaction(uuid, text, numeric, date, text) from public, anon;
revoke all on function public.set_time_tracking_status(uuid, text) from public, anon;
revoke all on function public.cutoff_time_tracking(uuid, timestamptz) from public, anon;
revoke all on function public.update_time_tracking_wage(uuid, numeric) from public, anon;
revoke all on function public.replace_time_tracking_segments(uuid, jsonb, jsonb, text) from public, anon;
revoke all on function public.create_time_tracking_payroll_slip(uuid, text, boolean) from public, anon;
revoke all on function public.decide_time_tracking_approval(text, uuid, text, text, uuid) from public, anon;
revoke all on function public.delete_time_tracking_source_permanently(text, uuid) from public, anon;

grant execute on function public.create_time_tracking_transaction(uuid, text, numeric, date, text) to authenticated;
grant execute on function public.set_time_tracking_status(uuid, text) to authenticated;
grant execute on function public.cutoff_time_tracking(uuid, timestamptz) to authenticated;
grant execute on function public.update_time_tracking_wage(uuid, numeric) to authenticated;
grant execute on function public.replace_time_tracking_segments(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.create_time_tracking_payroll_slip(uuid, text, boolean) to authenticated;
grant execute on function public.decide_time_tracking_approval(text, uuid, text, text, uuid) to authenticated;
grant execute on function public.delete_time_tracking_source_permanently(text, uuid) to authenticated;
