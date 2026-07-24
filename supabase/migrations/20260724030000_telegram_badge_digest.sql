-- Central Telegram digest for unresolved badges.
-- PostgreSQL owns schedule/retry/claim state and aggregation. The Edge Function
-- is deliberately thin: claim, format, send, complete.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table public.telegram_badge_catalog (
  badge_key text primary key,
  module_name text not null,
  status_label text not null,
  sort_order integer not null unique,
  check (badge_key ~ '^[a-z0-9_]+$')
);

insert into public.telegram_badge_catalog (badge_key, module_name, status_label, sort_order)
values
  ('rubber_bill_approval_pending', 'บิลยาง', 'รออนุมัติ', 10),
  ('income_expense_approval_pending', 'รายรับรายจ่าย', 'รออนุมัติ', 20),
  ('cash_transfer_pending_receipt', 'โอนเงินสดระหว่างสาขา', 'รอตรวจรับ', 30),
  ('cash_transfer_mismatched', 'โอนเงินสดระหว่างสาขา', 'ยอดไม่ตรง', 40),
  ('stock_approval_pending', 'สต็อกสินค้า', 'รออนุมัติ', 50),
  ('money_transfer_pending', 'โอนเงิน', 'รอดำเนินการ', 60),
  ('money_transfer_partial', 'โอนเงิน', 'ชำระบางส่วน', 70),
  ('money_transfer_advance', 'โอนเงิน', 'เงินล่วงหน้า', 80),
  ('time_tracking_approval_pending', 'ลงเวลางาน', 'รออนุมัติ', 90),
  ('rubber_export_draft', 'ส่งออกยาง', 'ฉบับร่าง', 100);

create table public.telegram_badge_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default false,
  chat_id text,
  start_time time not null default time '08:00',
  end_time time not null default time '20:00',
  interval_minutes integer not null default 60,
  enabled_badge_keys text[] not null default array[
    'rubber_bill_approval_pending',
    'income_expense_approval_pending',
    'cash_transfer_pending_receipt',
    'cash_transfer_mismatched',
    'stock_approval_pending',
    'money_transfer_pending',
    'money_transfer_partial',
    'money_transfer_advance',
    'time_tracking_approval_pending',
    'rubber_export_draft'
  ]::text[],
  bot_token_secret_id uuid,
  dispatch_secret_id uuid,
  edge_url_secret_id uuid,
  initial_attempt_at timestamptz,
  retry_at timestamptz,
  pending_slot_at timestamptz,
  claim_token uuid,
  claimed_at timestamptz,
  last_completed_slot_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  updated_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time),
  check (interval_minutes between 10 and 240),
  check (chat_id is null or nullif(btrim(chat_id), '') is not null)
);

insert into public.telegram_badge_settings (id) values (true);

alter table public.telegram_badge_catalog enable row level security;
alter table public.telegram_badge_settings enable row level security;

create policy "system managers read telegram badge catalog"
  on public.telegram_badge_catalog for select to authenticated
  using (private.is_active_user() and public.can_access_super_admin_features());

create policy "system managers read telegram badge settings"
  on public.telegram_badge_settings for select to authenticated
  using (private.is_active_user() and public.can_access_super_admin_features());

revoke all on public.telegram_badge_catalog, public.telegram_badge_settings
  from anon, authenticated;
grant select on public.telegram_badge_catalog, public.telegram_badge_settings
  to authenticated;
grant all on public.telegram_badge_catalog, public.telegram_badge_settings
  to service_role;

create or replace function private.telegram_badge_require_manager()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user()
    or not private.can_access_super_admin_features()
  then
    raise exception 'ไม่มีสิทธิ์จัดการ Telegram Badge';
  end if;
end;
$$;

revoke all on function private.telegram_badge_require_manager() from public, anon, authenticated;

create or replace function public.get_telegram_badge_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings public.telegram_badge_settings%rowtype;
  catalog jsonb;
begin
  perform private.telegram_badge_require_manager();

  select * into strict settings
  from public.telegram_badge_settings
  where id = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', c.badge_key,
        'moduleLabel', c.module_name,
        'statusLabel', c.status_label,
        'sortOrder', c.sort_order,
        'enabled', c.badge_key = any(settings.enabled_badge_keys)
      )
      order by c.sort_order
    ),
    '[]'::jsonb
  )
  into catalog
  from public.telegram_badge_catalog c;

  return jsonb_build_object(
    'enabled', settings.enabled,
    'chatId', coalesce(settings.chat_id, ''),
    'startTime', to_char(settings.start_time, 'HH24:MI'),
    'endTime', to_char(settings.end_time, 'HH24:MI'),
    'intervalMinutes', settings.interval_minutes,
    'enabledBadgeKeys', to_jsonb(settings.enabled_badge_keys),
    'tokenConfigured', settings.bot_token_secret_id is not null,
    'catalog', catalog,
    'lastAttemptAt', settings.last_attempt_at,
    'lastSuccessAt', settings.last_success_at,
    'lastError', settings.last_error,
    'updatedAt', settings.updated_at,
    'updatedByName', settings.updated_by_name
  );
end;
$$;

revoke all on function public.get_telegram_badge_config() from public, anon;
grant execute on function public.get_telegram_badge_config() to authenticated;

create or replace function public.save_telegram_badge_config(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_settings public.telegram_badge_settings%rowtype;
  next_enabled boolean;
  next_chat_id text;
  next_start_time time;
  next_end_time time;
  next_interval integer;
  next_keys text[];
  token_value text;
  actor_name text;
  actor_phone text;
  unknown_keys text[];
  schedule_changed boolean;
begin
  perform private.telegram_badge_require_manager();

  select * into strict current_settings
  from public.telegram_badge_settings
  where id = true
  for update;

  next_enabled := coalesce((payload->>'enabled')::boolean, current_settings.enabled);
  next_chat_id := nullif(btrim(coalesce(payload->>'chatId', current_settings.chat_id)), '');
  next_start_time := coalesce(nullif(payload->>'startTime', '')::time, current_settings.start_time);
  next_end_time := coalesce(nullif(payload->>'endTime', '')::time, current_settings.end_time);
  next_interval := coalesce((payload->>'intervalMinutes')::integer, current_settings.interval_minutes);
  token_value := nullif(btrim(payload->>'botToken'), '');

  if jsonb_typeof(payload->'enabledBadgeKeys') = 'array' then
    select coalesce(array_agg(value order by value), array[]::text[])
    into next_keys
    from (
      select distinct jsonb_array_elements_text(payload->'enabledBadgeKeys') as value
    ) selected;
  else
    next_keys := current_settings.enabled_badge_keys;
  end if;

  select array_agg(key)
  into unknown_keys
  from unnest(next_keys) key
  where not exists (
    select 1 from public.telegram_badge_catalog c where c.badge_key = key
  );

  if unknown_keys is not null then
    raise exception 'ประเภท Badge ไม่ถูกต้อง';
  end if;
  if next_start_time >= next_end_time then
    raise exception 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด';
  end if;
  if next_interval not between 10 and 240 then
    raise exception 'ระยะห่างต้องอยู่ระหว่าง 10 ถึง 240 นาที';
  end if;
  if next_enabled and next_chat_id is null then
    raise exception 'กรุณาระบุ Chat ID';
  end if;
  if next_enabled and current_settings.bot_token_secret_id is null and token_value is null then
    raise exception 'กรุณาระบุ Bot Token';
  end if;

  schedule_changed :=
    next_start_time is distinct from current_settings.start_time
    or next_end_time is distinct from current_settings.end_time
    or next_interval is distinct from current_settings.interval_minutes;

  if token_value is not null then
    if current_settings.bot_token_secret_id is null then
      current_settings.bot_token_secret_id := vault.create_secret(
        token_value,
        'lanflow_telegram_badge_bot_token',
        'Telegram Bot Token for the LanFlow badge digest'
      );
    else
      perform vault.update_secret(
        current_settings.bot_token_secret_id,
        token_value,
        'lanflow_telegram_badge_bot_token',
        'Telegram Bot Token for the LanFlow badge digest'
      );
    end if;
  end if;

  select p.name, p.phone
  into actor_name, actor_phone
  from public.profiles p
  where p.id = auth.uid();

  update public.telegram_badge_settings
  set enabled = next_enabled,
      chat_id = next_chat_id,
      start_time = next_start_time,
      end_time = next_end_time,
      interval_minutes = next_interval,
      enabled_badge_keys = next_keys,
      bot_token_secret_id = current_settings.bot_token_secret_id,
      initial_attempt_at = case
        when next_enabled and not current_settings.enabled then now() + interval '10 minutes'
        when not next_enabled then null
        when schedule_changed then null
        else initial_attempt_at
      end,
      retry_at = case
        when not next_enabled or schedule_changed then null
        else retry_at
      end,
      pending_slot_at = case
        when not next_enabled or schedule_changed then null
        else pending_slot_at
      end,
      claim_token = case
        when not next_enabled or schedule_changed then null
        else claim_token
      end,
      claimed_at = case
        when not next_enabled or schedule_changed then null
        else claimed_at
      end,
      last_completed_slot_at = case
        when next_enabled and current_settings.enabled and schedule_changed
          then private.telegram_badge_latest_slot(
            now(),
            next_start_time,
            next_end_time,
            next_interval
          )
        else last_completed_slot_at
      end,
      last_error = case when not next_enabled then null else last_error end,
      updated_by_user_id = auth.uid(),
      updated_by_name = actor_name,
      updated_by_phone = actor_phone,
      updated_at = now()
  where id = true;

  return public.get_telegram_badge_config();
end;
$$;

revoke all on function public.save_telegram_badge_config(jsonb) from public, anon;
grant execute on function public.save_telegram_badge_config(jsonb) to authenticated;

create or replace function public.configure_telegram_badge_dispatcher(
  p_edge_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.telegram_badge_settings%rowtype;
  normalized_url text := nullif(btrim(p_edge_url), '');
  dispatch_secret text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if normalized_url is null or normalized_url !~ '^https?://' then
    raise exception 'Edge Function URL ไม่ถูกต้อง';
  end if;

  select * into strict settings
  from public.telegram_badge_settings
  where id = true
  for update;

  if settings.edge_url_secret_id is null then
    settings.edge_url_secret_id := vault.create_secret(
      normalized_url,
      'lanflow_telegram_badge_edge_url',
      'Telegram badge Edge Function URL'
    );
  else
    perform vault.update_secret(
      settings.edge_url_secret_id,
      normalized_url,
      'lanflow_telegram_badge_edge_url',
      'Telegram badge Edge Function URL'
    );
  end if;

  if settings.dispatch_secret_id is null then
    dispatch_secret := encode(extensions.gen_random_bytes(32), 'hex');
    settings.dispatch_secret_id := vault.create_secret(
      dispatch_secret,
      'lanflow_telegram_badge_dispatch_secret',
      'Internal secret used by pg_cron to invoke the badge Edge Function'
    );
  end if;

  update public.telegram_badge_settings
  set edge_url_secret_id = settings.edge_url_secret_id,
      dispatch_secret_id = settings.dispatch_secret_id,
      updated_at = now()
  where id = true;
end;
$$;

revoke all on function public.configure_telegram_badge_dispatcher(text)
  from public, anon, authenticated;
grant execute on function public.configure_telegram_badge_dispatcher(text)
  to service_role;

create or replace function public.verify_telegram_badge_dispatch_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role'
    and coalesce(
      (
        select p_secret = ds.decrypted_secret
        from public.telegram_badge_settings s
        join vault.decrypted_secrets ds on ds.id = s.dispatch_secret_id
        where s.id = true
      ),
      false
    )
$$;

revoke all on function public.verify_telegram_badge_dispatch_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_telegram_badge_dispatch_secret(text)
  to service_role;

create or replace function private.telegram_badge_latest_slot(
  p_now timestamptz,
  p_start_time time,
  p_end_time time,
  p_interval_minutes integer
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_now timestamp := p_now at time zone 'Asia/Bangkok';
  window_start timestamptz;
  window_end timestamptz;
  elapsed_minutes integer;
begin
  window_start := ((local_now::date + p_start_time) at time zone 'Asia/Bangkok');
  window_end := ((local_now::date + p_end_time) at time zone 'Asia/Bangkok');

  if p_now < window_start or p_now > window_end then
    return null;
  end if;

  elapsed_minutes := floor(extract(epoch from (p_now - window_start)) / 60)::integer;
  return window_start
    + make_interval(mins => (elapsed_minutes / p_interval_minutes) * p_interval_minutes);
end;
$$;

revoke all on function private.telegram_badge_latest_slot(timestamptz, time, time, integer)
  from public, anon, authenticated;

create or replace function public.claim_telegram_badge_dispatch()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.telegram_badge_settings%rowtype;
  now_at timestamptz := now();
  latest_slot timestamptz;
  due_slot timestamptz;
  next_claim_token uuid;
  local_today date := (now_at at time zone 'Asia/Bangkok')::date;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select * into strict settings
  from public.telegram_badge_settings
  where id = true
  for update;

  if not settings.enabled then
    return jsonb_build_object('claimed', false, 'reason', 'disabled');
  end if;

  latest_slot := private.telegram_badge_latest_slot(
    now_at,
    settings.start_time,
    settings.end_time,
    settings.interval_minutes
  );
  if latest_slot is null then
    return jsonb_build_object('claimed', false, 'reason', 'outside_window');
  end if;

  if settings.claim_token is not null
    and settings.claimed_at > now_at - interval '5 minutes'
  then
    return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  end if;

  if settings.pending_slot_at is not null
    and (settings.pending_slot_at at time zone 'Asia/Bangkok')::date <> local_today
  then
    settings.pending_slot_at := null;
    settings.retry_at := null;
  end if;

  if settings.pending_slot_at is not null
    and settings.retry_at is not null
    and settings.retry_at <= now_at
  then
    due_slot := settings.pending_slot_at;
  elsif settings.initial_attempt_at is not null
    and settings.initial_attempt_at <= now_at
  then
    due_slot := latest_slot;
  elsif settings.initial_attempt_at is null
    and settings.pending_slot_at is null
    and (
      settings.last_completed_slot_at is null
      or latest_slot > settings.last_completed_slot_at
    )
  then
    due_slot := latest_slot;
  else
    return jsonb_build_object('claimed', false, 'reason', 'not_due');
  end if;

  next_claim_token := extensions.gen_random_uuid();
  update public.telegram_badge_settings
  set pending_slot_at = due_slot,
      claim_token = next_claim_token,
      claimed_at = now_at,
      initial_attempt_at = null,
      last_attempt_at = now_at,
      updated_at = now_at
  where id = true;

  return jsonb_build_object(
    'claimed', true,
    'claimToken', next_claim_token,
    'slotAt', due_slot
  );
end;
$$;

revoke all on function public.claim_telegram_badge_dispatch()
  from public, anon, authenticated;
grant execute on function public.claim_telegram_badge_dispatch()
  to service_role;

create or replace function public.complete_telegram_badge_dispatch(
  p_claim_token uuid,
  p_outcome text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.telegram_badge_settings%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_outcome not in ('sent', 'no_items', 'failed') then
    raise exception 'ผลการส่งไม่ถูกต้อง';
  end if;

  select * into strict settings
  from public.telegram_badge_settings
  where id = true
  for update;

  if settings.claim_token is distinct from p_claim_token then
    raise exception 'claim ไม่ตรงหรือหมดอายุ';
  end if;

  update public.telegram_badge_settings
  set last_completed_slot_at = case
        when p_outcome in ('sent', 'no_items') then pending_slot_at
        else last_completed_slot_at
      end,
      last_success_at = case
        when p_outcome = 'sent' then now()
        else last_success_at
      end,
      last_error = case
        when p_outcome = 'failed' then left(coalesce(p_error, 'ส่ง Telegram ไม่สำเร็จ'), 500)
        else null
      end,
      retry_at = case
        when p_outcome = 'failed' then now() + interval '10 minutes'
        else null
      end,
      pending_slot_at = case
        when p_outcome = 'failed' then pending_slot_at
        else null
      end,
      claim_token = null,
      claimed_at = null,
      updated_at = now()
  where id = true;
end;
$$;

revoke all on function public.complete_telegram_badge_dispatch(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_telegram_badge_dispatch(uuid, text, text)
  to service_role;

create or replace function public.get_telegram_badge_delivery_credentials()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  token_value text;
  target_chat_id text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select ds.decrypted_secret, s.chat_id
  into token_value, target_chat_id
  from public.telegram_badge_settings s
  left join vault.decrypted_secrets ds on ds.id = s.bot_token_secret_id
  where s.id = true;

  return jsonb_build_object('botToken', token_value, 'chatId', target_chat_id);
end;
$$;

revoke all on function public.get_telegram_badge_delivery_credentials()
  from public, anon, authenticated;
grant execute on function public.get_telegram_badge_delivery_credentials()
  to service_role;

create or replace function public.get_telegram_badge_counts()
returns table (
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
    where d.cash_status = 'pending_receipt'
      and t.record_status <> 'deleted'
    group by t.target_location_id, coalesce(l.name, 'ส่วนกลาง')

    union all
    select 'cash_transfer_mismatched',
      t.target_location_id, coalesce(l.name, 'ส่วนกลาง'), count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    left join public.locations l on l.id = t.target_location_id
    where d.cash_status = 'mismatched'
      and t.record_status <> 'deleted'
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
      select id from public.leave_requests where status = 'PENDING'
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
    e.sort_order;
$$;

revoke all on function public.get_telegram_badge_counts()
  from public, anon, authenticated;
grant execute on function public.get_telegram_badge_counts()
  to service_role;

create index if not exists income_expense_approval_pending_digest
  on public.income_expense_approval_requests(location_id)
  where request_status = 'pending';
create index if not exists cash_transfer_pending_digest
  on public.money_transfer_cash_details(transfer_id)
  where cash_status in ('pending_receipt', 'mismatched');
create index if not exists money_transfer_pending_digest
  on public.money_transfers(location_id, transfer_status)
  where transfer_method = 'bank'
    and transfer_status in ('pending', 'partial', 'advance_payment')
    and record_status <> 'deleted';
create index if not exists financial_transactions_pending_digest
  on public.financial_transactions(id)
  where status = 'PENDING';
create index if not exists leave_requests_pending_digest
  on public.leave_requests(id)
  where status = 'PENDING';
create index if not exists payroll_slips_pending_digest
  on public.payroll_slips(id)
  where status = 'PENDING';
create index if not exists rubber_exports_draft_digest
  on public.rubber_exports(location_id)
  where status = 'draft';

create or replace function public.dispatch_telegram_badge_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  edge_url text;
  dispatch_secret text;
  request_id bigint;
begin
  if not exists (
    select 1
    from public.telegram_badge_settings s
    where s.id = true and s.enabled = true
  ) then
    return null;
  end if;

  select url_secret.decrypted_secret, dispatch_secret_row.decrypted_secret
  into edge_url, dispatch_secret
  from public.telegram_badge_settings s
  left join vault.decrypted_secrets url_secret on url_secret.id = s.edge_url_secret_id
  left join vault.decrypted_secrets dispatch_secret_row on dispatch_secret_row.id = s.dispatch_secret_id
  where s.id = true;

  if edge_url is null or dispatch_secret is null then
    return null;
  end if;

  select net.http_post(
    url := edge_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-lanflow-dispatch-secret', dispatch_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function public.dispatch_telegram_badge_tick()
  from public, anon, authenticated;
grant execute on function public.dispatch_telegram_badge_tick()
  to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'telegram-badge-digest-tick';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'telegram-badge-digest-tick',
    '* * * * *',
    'select public.dispatch_telegram_badge_tick()'
  );
end;
$$;
