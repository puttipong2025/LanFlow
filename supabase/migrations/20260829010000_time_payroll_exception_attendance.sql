-- Additive cutover seam for exception-based attendance. TIMER stays active until
-- a global manager explicitly runs activate_exception_attendance().

create extension if not exists btree_gist with schema extensions;

create table public.time_payroll_settings (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'TIMER' check (mode in ('TIMER', 'EXCEPTIONS')),
  workday_end_time time not null default time '16:00',
  pending_workday_end_time time,
  pending_effective_date date,
  activated_on date,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint time_payroll_settings_pending_pair check (
    (pending_workday_end_time is null) = (pending_effective_date is null)
  )
);

insert into public.time_payroll_settings(singleton)
values (true)
on conflict (singleton) do nothing;

create table public.time_payroll_active_periods (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  start_on date not null,
  end_on date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint time_payroll_active_period_dates check (end_on is null or start_on <= end_on),
  constraint time_payroll_active_period_no_overlap
    exclude using gist (
      profile_id with =,
      daterange(start_on, coalesce(end_on, 'infinity'::date), '[]') with &&
    )
);

create unique index time_payroll_active_period_one_open
  on public.time_payroll_active_periods(profile_id)
  where end_on is null;
create index time_payroll_active_period_profile_dates
  on public.time_payroll_active_periods(profile_id, start_on, end_on);

create table public.time_payroll_attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  status text not null check (status in ('HALF_DAY', 'OFF')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (profile_id, work_date)
);

create index time_payroll_attendance_exception_month
  on public.time_payroll_attendance_exceptions(profile_id, work_date);

alter table public.time_payroll_settings enable row level security;
alter table public.time_payroll_active_periods enable row level security;
alter table public.time_payroll_attendance_exceptions enable row level security;

create or replace function private.is_global_time_payroll_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and private.can_access_super_admin_features()
$$;

revoke all on function private.is_global_time_payroll_manager() from public, anon;
grant execute on function private.is_global_time_payroll_manager() to authenticated;

create policy time_payroll_settings_read_authenticated
on public.time_payroll_settings for select to authenticated
using (private.is_active_user());

create policy time_payroll_active_periods_read_self_or_manager
on public.time_payroll_active_periods for select to authenticated
using (profile_id = auth.uid() or private.can_manage_time_payroll_profile(profile_id));

create policy time_payroll_attendance_exceptions_read_self_or_manager
on public.time_payroll_attendance_exceptions for select to authenticated
using (profile_id = auth.uid() or private.can_manage_time_payroll_profile(profile_id));

revoke all on table public.time_payroll_settings from anon, authenticated;
revoke all on table public.time_payroll_active_periods from anon, authenticated;
revoke all on table public.time_payroll_attendance_exceptions from anon, authenticated;
grant select on table public.time_payroll_settings to authenticated;
grant select on table public.time_payroll_active_periods to authenticated;
grant select on table public.time_payroll_attendance_exceptions to authenticated;

drop policy if exists time_tracking_audit_logs_read_manager on public.time_tracking_audit_logs;
create policy time_tracking_audit_logs_read_global_manager
on public.time_tracking_audit_logs for select to authenticated
using (private.is_global_time_payroll_manager());

create or replace function private.effective_time_payroll_settings()
returns table(
  mode text,
  workday_end_time time,
  pending_workday_end_time time,
  pending_effective_date date,
  activated_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.mode,
    case
      when s.pending_effective_date <= (now() at time zone 'Asia/Bangkok')::date
        then s.pending_workday_end_time
      else s.workday_end_time
    end,
    case
      when s.pending_effective_date <= (now() at time zone 'Asia/Bangkok')::date then null
      else s.pending_workday_end_time
    end,
    case
      when s.pending_effective_date <= (now() at time zone 'Asia/Bangkok')::date then null
      else s.pending_effective_date
    end,
    s.activated_on
  from public.time_payroll_settings s
  where s.singleton = true
$$;

revoke all on function private.effective_time_payroll_settings() from public, anon, authenticated;

create or replace function public.get_time_payroll_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings record;
begin
  if not private.is_active_user() then raise exception 'Authentication required'; end if;
  select * into v_settings from private.effective_time_payroll_settings();
  return jsonb_build_object(
    'mode', v_settings.mode,
    'workdayEndTime', to_char(v_settings.workday_end_time, 'HH24:MI'),
    'pendingWorkdayEndTime', case when v_settings.pending_workday_end_time is null then null else to_char(v_settings.pending_workday_end_time, 'HH24:MI') end,
    'pendingEffectiveDate', v_settings.pending_effective_date,
    'activatedOn', v_settings.activated_on
  );
end
$$;

revoke all on function public.get_time_payroll_settings() from public, anon;
grant execute on function public.get_time_payroll_settings() to authenticated;

create or replace function private.exception_attendance_summary(
  p_profile_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select * from private.effective_time_payroll_settings()
  ), bounds as (
    select
      (p_period_start at time zone 'Asia/Bangkok')::date as start_on,
      ((p_period_end at time zone 'Asia/Bangkok')::date - 1) as end_on,
      (p_now at time zone 'Asia/Bangkok')::date as today,
      (p_now at time zone 'Asia/Bangkok')::time as current_time
  ), eligible as (
    select d::date as work_date
    from bounds b
    cross join settings s
    cross join lateral generate_series(b.start_on, b.end_on, interval '1 day') d
    where (d::date < b.today or (d::date = b.today and b.current_time >= s.workday_end_time))
      and exists (
        select 1 from public.time_payroll_active_periods ap
        where ap.profile_id = p_profile_id
          and ap.start_on <= d::date
          and (ap.end_on is null or ap.end_on >= d::date)
      )
  ), classified as (
    select e.work_date, coalesce(x.status, 'FULL') as status
    from eligible e
    left join public.time_payroll_attendance_exceptions x
      on x.profile_id = p_profile_id and x.work_date = e.work_date
  )
  select jsonb_build_object(
    'fullDays', count(*) filter (where status = 'FULL'),
    'halfDays', count(*) filter (where status = 'HALF_DAY'),
    'offDays', count(*) filter (where status = 'OFF'),
    'paidDays', count(*) filter (where status = 'FULL') + (count(*) filter (where status = 'HALF_DAY') * 0.5)
  )
  from classified
$$;

revoke all on function private.exception_attendance_summary(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.calculate_paid_work_days(
  p_profile_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_summary jsonb;
begin
  select s.mode into v_mode from public.time_payroll_settings s where s.singleton = true;
  if coalesce(v_mode, 'TIMER') = 'TIMER' then
    return (
      select coalesce(sum(public.calculate_time_segment_paid_days(
        greatest(seg.start_time, p_period_start),
        least(seg.end_time, coalesce(p_period_end, seg.end_time))
      )), 0)
      from public.time_segments seg
      where seg.profile_id = p_profile_id
        and seg.end_time is not null
        and seg.end_time > p_period_start
        and (p_period_end is null or seg.start_time < p_period_end)
    );
  end if;
  if p_period_end is null then raise exception 'PERIOD_END_REQUIRED'; end if;
  v_summary := private.exception_attendance_summary(p_profile_id, p_period_start, p_period_end, now());
  return coalesce((v_summary ->> 'paidDays')::numeric, 0);
end
$$;

revoke all on function public.calculate_paid_work_days(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.calculate_paid_work_days(uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.get_time_payroll_attendance_month(
  p_profile_id uuid,
  p_month text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_next_month date;
  v_settings jsonb;
  v_summary jsonb;
  v_periods jsonb;
  v_exceptions jsonb;
  v_wage numeric;
begin
  if auth.uid() is null or not (
    p_profile_id = auth.uid() or private.can_manage_time_payroll_profile(p_profile_id)
  ) then raise exception 'Forbidden'; end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'INVALID_MONTH'; end if;
  begin v_month := (p_month || '-01')::date; exception when others then raise exception 'INVALID_MONTH'; end;
  if to_char(v_month, 'YYYY-MM') <> p_month then raise exception 'INVALID_MONTH'; end if;
  v_next_month := (v_month + interval '1 month')::date;
  v_settings := public.get_time_payroll_settings();
  select p.daily_wage into v_wage from public.profiles p where p.id = p_profile_id and p.is_active;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  if v_settings ->> 'mode' = 'TIMER' then
    v_summary := jsonb_build_object(
      'fullDays', 0, 'halfDays', 0, 'offDays', 0,
      'paidDays', public.calculate_paid_work_days(
        p_profile_id,
        v_month::timestamp at time zone 'Asia/Bangkok',
        v_next_month::timestamp at time zone 'Asia/Bangkok'
      )
    );
  else
    v_summary := private.exception_attendance_summary(
      p_profile_id,
      v_month::timestamp at time zone 'Asia/Bangkok',
      v_next_month::timestamp at time zone 'Asia/Bangkok',
      now()
    );
  end if;
  v_summary := v_summary || jsonb_build_object(
    'grossPay', trunc(coalesce((v_summary ->> 'paidDays')::numeric, 0) * coalesce(v_wage, 0), 2)
  );
  select coalesce(jsonb_agg(jsonb_build_object('id', ap.id, 'startOn', ap.start_on, 'endOn', ap.end_on) order by ap.start_on), '[]'::jsonb)
    into v_periods
  from public.time_payroll_active_periods ap
  where ap.profile_id = p_profile_id and ap.start_on < v_next_month and (ap.end_on is null or ap.end_on >= v_month);
  select coalesce(jsonb_agg(jsonb_build_object('date', x.work_date, 'status', x.status) order by x.work_date), '[]'::jsonb)
    into v_exceptions
  from public.time_payroll_attendance_exceptions x
  where x.profile_id = p_profile_id and x.work_date >= v_month and x.work_date < v_next_month;
  return jsonb_build_object(
    'month', p_month,
    'mode', v_settings ->> 'mode',
    'workdayEndTime', v_settings ->> 'workdayEndTime',
    'periods', v_periods,
    'exceptions', v_exceptions,
    'summary', v_summary
  );
end
$$;

revoke all on function public.get_time_payroll_attendance_month(uuid, text) from public, anon;
grant execute on function public.get_time_payroll_attendance_month(uuid, text) to authenticated;

create or replace function private.assert_attendance_month_open(p_profile_id uuid, p_month text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.payroll_slips ps
    where ps.profile_id = p_profile_id and ps.month = p_month and ps.status in ('PENDING', 'APPROVED')
  ) then raise exception 'MONTH_CLOSED:%', p_month; end if;
  if exists (
    select 1
    from public.financial_transactions ft
    where ft.profile_id = p_profile_id
      and ft.status = 'APPROVED'
      and ft.type in ('DEBT_DEDUCTION', 'WITHDRAWAL_DEDUCTION')
      and ft.applied_month = (p_month || '-01')::date
  ) then raise exception 'DEDUCTION_LOCKED:%', p_month; end if;
end
$$;

revoke all on function private.assert_attendance_month_open(uuid, text) from public, anon, authenticated;

create or replace function public.replace_time_payroll_attendance_exceptions(
  p_profile_id uuid,
  p_month text,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_month date;
  v_next date;
  v_changed integer;
begin
  if v_actor is null or not private.can_manage_time_payroll_profile(p_profile_id) then raise exception 'Forbidden'; end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' or jsonb_typeof(p_selections) <> 'array' then raise exception 'INVALID_ATTENDANCE_SELECTIONS'; end if;
  begin v_month := (p_month || '-01')::date; exception when others then raise exception 'INVALID_MONTH'; end;
  if to_char(v_month, 'YYYY-MM') <> p_month then raise exception 'INVALID_MONTH'; end if;
  v_next := (v_month + interval '1 month')::date;
  perform pg_advisory_xact_lock(hashtextextended('time-payroll-attendance:' || p_profile_id::text, 0));
  perform private.assert_attendance_month_open(p_profile_id, p_month);
  if exists (
    select 1 from jsonb_array_elements(p_selections) item
    where (item ->> 'status') not in ('HALF_DAY', 'OFF')
      or (item ->> 'date') is null
      or (item ->> 'date')::date < v_month
      or (item ->> 'date')::date >= v_next
      or not exists (
        select 1 from public.time_payroll_active_periods ap
        where ap.profile_id = p_profile_id and ap.start_on <= (item ->> 'date')::date
          and (ap.end_on is null or ap.end_on >= (item ->> 'date')::date)
      )
  ) or (
    select count(*) <> count(distinct item ->> 'date') from jsonb_array_elements(p_selections) item
  ) then raise exception 'INVALID_ATTENDANCE_SELECTIONS'; end if;

  delete from public.time_payroll_attendance_exceptions x
  where x.profile_id = p_profile_id and x.work_date >= v_month and x.work_date < v_next;
  insert into public.time_payroll_attendance_exceptions(profile_id, work_date, status, created_by, updated_by)
  select p_profile_id, (item ->> 'date')::date, item ->> 'status', v_actor, v_actor
  from jsonb_array_elements(p_selections) item;
  get diagnostics v_changed = row_count;
  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, new_data, comment)
  values (v_actor, 'REPLACE_ATTENDANCE_EXCEPTIONS', 'time_payroll_attendance_exceptions', p_profile_id,
    jsonb_build_object('month', p_month, 'selections', p_selections, 'count', v_changed), 'แก้ข้อยกเว้นวันทำงาน');
  return jsonb_build_object('changed', v_changed, 'month', p_month);
end
$$;

revoke all on function public.replace_time_payroll_attendance_exceptions(uuid, text, jsonb) from public, anon;
grant execute on function public.replace_time_payroll_attendance_exceptions(uuid, text, jsonb) to authenticated;

create or replace function public.update_time_payroll_config(p_workday_end_time text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_time time;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  if p_workday_end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'INVALID_WORKDAY_END_TIME'; end if;
  v_time := p_workday_end_time::time;
  update public.time_payroll_settings
  set workday_end_time = case when pending_effective_date <= v_today then pending_workday_end_time else workday_end_time end,
      pending_workday_end_time = v_time,
      pending_effective_date = v_today + 1,
      updated_by = v_actor,
      updated_at = now()
  where singleton = true;
  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, new_data, comment)
  values (v_actor, 'UPDATE_TIME_PAYROLL_CONFIG', 'time_payroll_settings', v_actor,
    jsonb_build_object('workdayEndTime', p_workday_end_time, 'effectiveDate', v_today + 1), 'ตั้งค่าเวลาสิ้นสุดวัน');
  return public.get_time_payroll_settings();
end
$$;

revoke all on function public.update_time_payroll_config(text) from public, anon;
grant execute on function public.update_time_payroll_config(text) to authenticated;

create or replace function public.set_time_payroll_active_period(
  p_profile_id uuid,
  p_action text,
  p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_open public.time_payroll_active_periods%rowtype;
begin
  if v_actor is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  if p_action not in ('ENABLE', 'PAUSE', 'RESUME', 'END') or p_effective_date is null then raise exception 'INVALID_PERIOD_ACTION'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.is_active) then raise exception 'PROFILE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('time-payroll-period:' || p_profile_id::text, 0));
  perform private.assert_attendance_month_open(p_profile_id, to_char(p_effective_date, 'YYYY-MM'));
  select * into v_open from public.time_payroll_active_periods ap where ap.profile_id = p_profile_id and ap.end_on is null for update;
  if p_action in ('ENABLE', 'RESUME') then
    if found then raise exception 'ACTIVE_PERIOD_ALREADY_OPEN'; end if;
    insert into public.time_payroll_active_periods(profile_id, start_on, created_by, updated_by)
    values (p_profile_id, p_effective_date, v_actor, v_actor);
  elsif p_action = 'PAUSE' then
    if not found or p_effective_date <= v_open.start_on then raise exception 'NO_OPEN_ACTIVE_PERIOD'; end if;
    update public.time_payroll_active_periods set end_on = p_effective_date - 1, updated_by = v_actor, updated_at = now() where id = v_open.id;
  else
    if not found or p_effective_date < v_open.start_on then raise exception 'NO_OPEN_ACTIVE_PERIOD'; end if;
    update public.time_payroll_active_periods set end_on = p_effective_date, updated_by = v_actor, updated_at = now() where id = v_open.id;
  end if;
  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, new_data, comment)
  values (v_actor, 'SET_PAYROLL_ACTIVE_PERIOD', 'time_payroll_active_periods', p_profile_id,
    jsonb_build_object('action', p_action, 'effectiveDate', p_effective_date), 'เปลี่ยนช่วงเงินเดือน');
  return jsonb_build_object('profileId', p_profile_id, 'action', p_action, 'effectiveDate', p_effective_date);
end
$$;

revoke all on function public.set_time_payroll_active_period(uuid, text, date) from public, anon;
grant execute on function public.set_time_payroll_active_period(uuid, text, date) to authenticated;

create or replace function public.get_time_payroll_preflight()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  select jsonb_build_object(
    'activeTimerSegments', (select count(*) from public.time_segments where end_time is null),
    'resumeSchedules', (select count(*) from public.time_tracking_resume_schedules),
    'cronJobs', coalesce((select jsonb_agg(jsonb_build_object('name', j.jobname, 'active', j.active) order by j.jobname)
      from cron.job j where j.jobname in ('time-tracking-daily-cutoff', 'deduct-debts-daily', 'time-tracking-auto-start')), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

revoke all on function public.get_time_payroll_preflight() from public, anon;
grant execute on function public.get_time_payroll_preflight() to authenticated;

create or replace function public.activate_exception_attendance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_active bigint;
  v_resume bigint;
  v_job record;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if v_actor is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  select count(*) into v_active from public.time_segments where end_time is null;
  select count(*) into v_resume from public.time_tracking_resume_schedules;
  if v_active > 0 or v_resume > 0 then raise exception 'ACTIVATION_BLOCKED:active=%:resume=%', v_active, v_resume; end if;
  update public.time_payroll_settings set mode = 'EXCEPTIONS', activated_on = coalesce(activated_on, v_today), updated_by = v_actor, updated_at = now() where singleton = true;
  for v_job in select jobid from cron.job where jobname in ('time-tracking-daily-cutoff', 'deduct-debts-daily', 'time-tracking-auto-start') loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  insert into public.time_tracking_audit_logs(admin_id, action, target_table, record_id, new_data, comment)
  values (v_actor, 'ACTIVATE_EXCEPTION_ATTENDANCE', 'time_payroll_settings', v_actor,
    jsonb_build_object('activatedOn', v_today), 'เปิดใช้วันทำงานแบบข้อยกเว้น');
  return public.get_time_payroll_settings();
end
$$;

revoke all on function public.activate_exception_attendance() from public, anon;
grant execute on function public.activate_exception_attendance() to authenticated;

-- Keep the public decision name, but place a global-only gate in front of the
-- previously verified deduction/expense/idempotency implementation.
alter function public.decide_time_tracking_approval(text, uuid, text, text, uuid)
  rename to decide_time_tracking_approval_internal_20260829;
revoke all on function public.decide_time_tracking_approval_internal_20260829(text, uuid, text, text, uuid)
  from public, anon, authenticated;

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
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  return public.decide_time_tracking_approval_internal_20260829(
    p_source_type, p_source_id, p_decision, p_comment, p_expense_location_id
  );
end
$$;

revoke all on function public.decide_time_tracking_approval(text, uuid, text, text, uuid) from public, anon;
grant execute on function public.decide_time_tracking_approval(text, uuid, text, text, uuid) to authenticated;

-- Preserve the validated create implementation and atomically decide records
-- created by a global manager in the same database transaction.
alter function public.create_time_tracking_transaction(uuid, text, numeric, date, text)
  rename to create_time_tracking_transaction_internal_20260829;
revoke all on function public.create_time_tracking_transaction_internal_20260829(uuid, text, numeric, date, text)
  from public, anon, authenticated;

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
  v_created jsonb;
  v_decision jsonb;
begin
  v_created := public.create_time_tracking_transaction_internal_20260829(
    p_profile_id, p_type, p_amount, p_effective_date, p_description
  );
  if private.is_global_time_payroll_manager() then
    v_decision := public.decide_time_tracking_approval(
      'transaction', (v_created ->> 'id')::uuid, 'APPROVED', null, null
    );
    return v_created || jsonb_build_object('status', 'approved', 'decision', v_decision);
  end if;
  return v_created;
end
$$;

revoke all on function public.create_time_tracking_transaction(uuid, text, numeric, date, text) from public, anon;
grant execute on function public.create_time_tracking_transaction(uuid, text, numeric, date, text) to authenticated;

alter function public.create_time_tracking_payroll_slip(uuid, text, boolean)
  rename to create_time_tracking_payroll_slip_internal_20260829;
revoke all on function public.create_time_tracking_payroll_slip_internal_20260829(uuid, text, boolean)
  from public, anon, authenticated;

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
  v_mode text;
  v_created jsonb;
  v_attendance jsonb;
  v_final jsonb;
begin
  select s.mode into v_mode from public.time_payroll_settings s where s.singleton = true;
  v_created := public.create_time_tracking_payroll_slip_internal_20260829(
    p_profile_id, p_month, case when v_mode = 'EXCEPTIONS' then false else p_auto_start_next_month end
  );
  v_attendance := public.get_time_payroll_attendance_month(p_profile_id, p_month);
  update public.payroll_slips
  set slip_data = coalesce(slip_data, '{}'::jsonb) || jsonb_build_object('attendance', v_attendance)
  where id = (v_created ->> 'id')::uuid;
  if private.is_global_time_payroll_manager() then
    perform public.decide_time_tracking_approval('payroll_slip', (v_created ->> 'id')::uuid, 'APPROVED', null, null);
  end if;
  select to_jsonb(ps) into v_final from public.payroll_slips ps where ps.id = (v_created ->> 'id')::uuid;
  return v_final || jsonb_build_object('auto_start_scheduled', coalesce((v_created ->> 'auto_start_scheduled')::boolean, false));
end
$$;

revoke all on function public.create_time_tracking_payroll_slip(uuid, text, boolean) from public, anon;
grant execute on function public.create_time_tracking_payroll_slip(uuid, text, boolean) to authenticated;

-- Wage changes affect every open payroll month, so delegated managers must not
-- bypass the global-only HTTP gate by calling the legacy RPC directly.
alter function public.update_time_tracking_wage(uuid, numeric)
  rename to update_time_tracking_wage_internal_20260829;
revoke all on function public.update_time_tracking_wage_internal_20260829(uuid, numeric)
  from public, anon, authenticated;

create or replace function public.update_time_tracking_wage(
  p_profile_id uuid,
  p_daily_wage numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_global_time_payroll_manager() then raise exception 'Forbidden'; end if;
  return public.update_time_tracking_wage_internal_20260829(p_profile_id, p_daily_wage);
end
$$;

revoke all on function public.update_time_tracking_wage(uuid, numeric) from public, anon;
grant execute on function public.update_time_tracking_wage(uuid, numeric) to authenticated;
