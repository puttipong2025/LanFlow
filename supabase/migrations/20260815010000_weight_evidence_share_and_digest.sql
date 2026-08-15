-- Count-aware weight-evidence completion and count-only Telegram evidence digest.
-- Existing completion ownership is deliberately not backfilled with an invented count.

begin;

lock table public.rubber_bills in access exclusive mode;

do $$
begin
  if exists (
    select 1 from public.rubber_bills where evidence_completion_id is not null
  ) then
    raise exception 'WEIGHT_EVIDENCE_COMPLETION_PREFLIGHT_FAILED';
  end if;
end;
$$;

alter table public.rubber_bills
  add column evidence_manual_correction_count integer not null default 0,
  add constraint rubber_bills_evidence_manual_correction_count_nonnegative
    check (evidence_manual_correction_count >= 0);

comment on column public.rubber_bills.evidence_manual_correction_count is
  'Manual-correction count reported by the first winning evidence device; operational metric, not server-audited row evidence.';

create or replace function private.clear_weight_evidence_completion_on_bill_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revision_no is distinct from old.revision_no
     or new.record_status is distinct from old.record_status then
    new.evidence_completion_id := null;
    new.evidence_manual_correction_count := 0;
  end if;
  return new;
end;
$$;

revoke all on function private.clear_weight_evidence_completion_on_bill_change()
  from public, anon, authenticated;

create or replace function private.guard_reported_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_report_no text;
begin
  if tg_table_name = 'rubber_exports' and tg_op = 'UPDATE'
     and (to_jsonb(new) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name'])
       = (to_jsonb(old) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name']) then
    return new;
  end if;

  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);

  if v_report_no is not null then
    if tg_argv[0] = 'rubber_bill'
      and tg_op = 'UPDATE'
      and (to_jsonb(new) - array[
        'print_status',
        'updated_at',
        'evidence_completion_id',
        'evidence_manual_correction_count'
      ]) = (to_jsonb(old) - array[
        'print_status',
        'updated_at',
        'evidence_completion_id',
        'evidence_manual_correction_count'
      ]) then
      return new;
    end if;
    perform private.raise_report_lock(v_report_no);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop function if exists public.claim_weight_evidence_completion(uuid, uuid, integer, uuid);

create function public.claim_weight_evidence_completion(
  p_bill_id uuid,
  p_location_id uuid,
  p_revision_no integer,
  p_completion_id uuid,
  p_manual_correction_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.rubber_bills%rowtype;
  v_weigh_row_count integer;
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null
    or p_completion_id is null
    or p_revision_no is null
    or p_revision_no < 0
    or p_manual_correction_count is null
    or p_manual_correction_count < 0
  then
    raise exception 'WEIGHT_EVIDENCE_INVALID_INPUT';
  end if;

  select * into v_bill
  from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id
  for update;

  if not found
    or v_bill.record_status <> 'active'
    or v_bill.source_rubber_export_id is not null
  then
    return jsonb_build_object('state', 'inactive');
  end if;
  if v_bill.revision_no <> p_revision_no then
    return jsonb_build_object(
      'state', 'stale',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;

  select count(*)::integer into v_weigh_row_count
  from public.rubber_bill_items
  where bill_id = p_bill_id and item_type = 'weigh';

  if v_weigh_row_count = 0
    or p_manual_correction_count > v_weigh_row_count
  then
    raise exception 'WEIGHT_EVIDENCE_INVALID_COUNT';
  end if;

  if v_bill.evidence_completion_id is null then
    update public.rubber_bills
    set evidence_completion_id = p_completion_id,
        evidence_manual_correction_count = p_manual_correction_count,
        updated_at = now()
    where id = p_bill_id;
    return jsonb_build_object(
      'state', 'owned',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;
  if v_bill.evidence_completion_id = p_completion_id then
    return jsonb_build_object(
      'state', 'owned',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;
  return jsonb_build_object(
    'state', 'owned_by_other',
    'currentRevisionNo', v_bill.revision_no
  );
end;
$$;

create or replace function public.release_weight_evidence_completion(
  p_bill_id uuid,
  p_location_id uuid,
  p_revision_no integer,
  p_completion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.rubber_bills%rowtype;
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'WEIGHT_EVIDENCE_ACCESS_DENIED';
  end if;
  if p_bill_id is null or p_completion_id is null
    or p_revision_no is null or p_revision_no < 0
  then
    raise exception 'WEIGHT_EVIDENCE_INVALID_INPUT';
  end if;

  select * into v_bill
  from public.rubber_bills
  where id = p_bill_id and location_id = p_location_id
  for update;

  if not found
    or v_bill.record_status <> 'active'
    or v_bill.source_rubber_export_id is not null
  then
    return jsonb_build_object('state', 'inactive');
  end if;
  if v_bill.revision_no <> p_revision_no then
    return jsonb_build_object(
      'state', 'stale',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;
  if v_bill.evidence_completion_id is distinct from p_completion_id then
    return jsonb_build_object(
      'state', 'not_owner',
      'currentRevisionNo', v_bill.revision_no
    );
  end if;

  update public.rubber_bills
  set evidence_completion_id = null,
      evidence_manual_correction_count = 0,
      updated_at = now()
  where id = p_bill_id;
  return jsonb_build_object(
    'state', 'released',
    'currentRevisionNo', v_bill.revision_no
  );
end;
$$;

revoke all on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid, integer)
  from public, anon;
revoke all on function public.release_weight_evidence_completion(uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.claim_weight_evidence_completion(uuid, uuid, integer, uuid, integer)
  to authenticated;
grant execute on function public.release_weight_evidence_completion(uuid, uuid, integer, uuid)
  to authenticated;

alter table public.telegram_badge_settings
  add column evidence_enabled boolean not null default false,
  add column evidence_interval_minutes integer not null default 60,
  add column evidence_last_attempted_slot_at timestamptz,
  add column evidence_claim_token uuid,
  add column evidence_claimed_at timestamptz,
  add constraint telegram_badge_settings_evidence_interval_check
    check (evidence_interval_minutes between 30 and 1440);

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
      ) order by c.sort_order
    ),
    '[]'::jsonb
  ) into catalog
  from public.telegram_badge_catalog c;

  return jsonb_build_object(
    'enabled', settings.enabled,
    'chatId', coalesce(settings.chat_id, ''),
    'startTime', to_char(settings.start_time, 'HH24:MI'),
    'endTime', to_char(settings.end_time, 'HH24:MI'),
    'intervalMinutes', settings.interval_minutes,
    'enabledBadgeKeys', to_jsonb(settings.enabled_badge_keys),
    'evidenceEnabled', settings.evidence_enabled,
    'evidenceIntervalMinutes', settings.evidence_interval_minutes,
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
  next_evidence_enabled boolean;
  next_evidence_interval integer;
  token_value text;
  actor_name text;
  actor_phone text;
  unknown_keys text[];
  schedule_changed boolean;
  evidence_schedule_changed boolean;
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
  next_evidence_enabled := coalesce((payload->>'evidenceEnabled')::boolean, current_settings.evidence_enabled);
  next_evidence_interval := coalesce((payload->>'evidenceIntervalMinutes')::integer, current_settings.evidence_interval_minutes);
  token_value := nullif(btrim(payload->>'botToken'), '');

  if jsonb_typeof(payload->'enabledBadgeKeys') = 'array' then
    select coalesce(array_agg(value order by value), array[]::text[])
    into next_keys
    from (
      select distinct jsonb_array_elements_text(payload->'enabledBadgeKeys') value
    ) selected;
  else
    next_keys := current_settings.enabled_badge_keys;
  end if;

  select array_agg(key) into unknown_keys
  from unnest(next_keys) key
  where not exists (
    select 1 from public.telegram_badge_catalog c where c.badge_key = key
  );

  if unknown_keys is not null then raise exception 'ประเภท Badge ไม่ถูกต้อง'; end if;
  if next_start_time >= next_end_time then raise exception 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด'; end if;
  if next_interval not between 10 and 240 then raise exception 'ระยะห่างต้องอยู่ระหว่าง 10 ถึง 240 นาที'; end if;
  if next_evidence_interval not between 30 and 1440 then raise exception 'ระยะห่าง Evidence ต้องอยู่ระหว่าง 30 ถึง 1440 นาที'; end if;
  if next_enabled and next_chat_id is null then raise exception 'กรุณาระบุ Chat ID'; end if;
  if next_enabled and current_settings.bot_token_secret_id is null and token_value is null then
    raise exception 'กรุณาระบุ Bot Token';
  end if;

  schedule_changed :=
    next_start_time is distinct from current_settings.start_time
    or next_end_time is distinct from current_settings.end_time
    or next_interval is distinct from current_settings.interval_minutes;
  evidence_schedule_changed :=
    next_start_time is distinct from current_settings.start_time
    or next_end_time is distinct from current_settings.end_time
    or next_evidence_interval is distinct from current_settings.evidence_interval_minutes;

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

  select p.name, p.phone into actor_name, actor_phone
  from public.profiles p where p.id = auth.uid();

  update public.telegram_badge_settings
  set enabled = next_enabled,
      chat_id = next_chat_id,
      start_time = next_start_time,
      end_time = next_end_time,
      interval_minutes = next_interval,
      enabled_badge_keys = next_keys,
      evidence_enabled = next_evidence_enabled,
      evidence_interval_minutes = next_evidence_interval,
      bot_token_secret_id = current_settings.bot_token_secret_id,
      initial_attempt_at = case
        when next_enabled and not current_settings.enabled then now() + interval '10 minutes'
        when not next_enabled then null
        when schedule_changed then null
        else initial_attempt_at
      end,
      retry_at = case when not next_enabled or schedule_changed then null else retry_at end,
      pending_slot_at = case when not next_enabled or schedule_changed then null else pending_slot_at end,
      claim_token = case when not next_enabled or schedule_changed then null else claim_token end,
      claimed_at = case when not next_enabled or schedule_changed then null else claimed_at end,
      last_completed_slot_at = case
        when next_enabled and current_settings.enabled and schedule_changed
          then private.telegram_badge_latest_slot(now(), next_start_time, next_end_time, next_interval)
        else last_completed_slot_at
      end,
      last_error = case when not next_enabled then null else last_error end,
      evidence_last_attempted_slot_at = case
        when next_evidence_enabled and (
          not current_settings.evidence_enabled or evidence_schedule_changed
        ) then private.telegram_badge_latest_slot(
          now(), next_start_time, next_end_time, next_evidence_interval
        )
        else evidence_last_attempted_slot_at
      end,
      evidence_claim_token = case
        when not next_evidence_enabled
          or not next_enabled
          or evidence_schedule_changed
          or next_evidence_enabled is distinct from current_settings.evidence_enabled
        then null else evidence_claim_token
      end,
      evidence_claimed_at = case
        when not next_evidence_enabled
          or not next_enabled
          or evidence_schedule_changed
          or next_evidence_enabled is distinct from current_settings.evidence_enabled
        then null else evidence_claimed_at
      end,
      updated_by_user_id = auth.uid(),
      updated_by_name = actor_name,
      updated_by_phone = actor_phone,
      updated_at = now()
  where id = true;

  return public.get_telegram_badge_config();
end;
$$;

create or replace function public.claim_telegram_evidence_dispatch()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.telegram_badge_settings%rowtype;
  now_at timestamptz := now();
  latest_slot timestamptz;
  claim_slot timestamptz;
  next_claim_token uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into strict settings
  from public.telegram_badge_settings
  where id = true
  for update;

  if not settings.enabled or not settings.evidence_enabled then
    return jsonb_build_object('claimed', false, 'reason', 'disabled');
  end if;

  latest_slot := private.telegram_badge_latest_slot(
    now_at,
    settings.start_time,
    settings.end_time,
    settings.evidence_interval_minutes
  );
  if latest_slot is null then
    return jsonb_build_object('claimed', false, 'reason', 'outside_window');
  end if;

  if settings.evidence_claim_token is not null
    and settings.evidence_claimed_at > now_at - interval '5 minutes'
  then
    return jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  end if;

  if settings.evidence_claim_token is null
    and settings.evidence_last_attempted_slot_at is not null
    and latest_slot <= settings.evidence_last_attempted_slot_at
  then
    return jsonb_build_object('claimed', false, 'reason', 'not_due');
  end if;

  claim_slot := case
    when settings.evidence_claim_token is not null
      then settings.evidence_last_attempted_slot_at
    else latest_slot
  end;
  next_claim_token := extensions.gen_random_uuid();
  update public.telegram_badge_settings
  set evidence_last_attempted_slot_at = claim_slot,
      evidence_claim_token = next_claim_token,
      evidence_claimed_at = now_at,
      updated_at = now_at
  where id = true;

  return jsonb_build_object(
    'claimed', true,
    'claimToken', next_claim_token,
    'slotAt', claim_slot
  );
end;
$$;

create or replace function public.complete_telegram_evidence_dispatch(p_claim_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  update public.telegram_badge_settings
  set evidence_claim_token = null,
      evidence_claimed_at = null,
      updated_at = now()
  where id = true and evidence_claim_token = p_claim_token;

  if not found then raise exception 'claim ไม่ตรงหรือหมดอายุ'; end if;
end;
$$;

create or replace function public.is_telegram_evidence_dispatch_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.role() <> 'service_role' then false
    else coalesce((
      select enabled and evidence_enabled
      from public.telegram_badge_settings where id = true
    ), false)
  end
$$;

create or replace function public.get_weight_evidence_digest()
returns table (
  location_id uuid,
  branch_name text,
  total_weigh_rows bigint,
  manual_correction_count bigint,
  incomplete_weigh_rows bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  return query
  with bill_counts as (
    select b.id,
      b.location_id,
      b.evidence_completion_id,
      b.evidence_manual_correction_count,
      count(i.id)::bigint weigh_rows
    from public.rubber_bills b
    join public.rubber_bill_items i
      on i.bill_id = b.id and i.item_type = 'weigh'
    where b.record_status = 'active'
      and b.source_rubber_export_id is null
      and b.bill_date = (now() at time zone 'Asia/Bangkok')::date
    group by b.id
  )
  select c.location_id,
    coalesce(l.name, 'ไม่ทราบสาขา')::text,
    sum(c.weigh_rows)::bigint,
    sum(case
      when c.evidence_completion_id is not null
        then c.evidence_manual_correction_count
      else 0
    end)::bigint,
    sum(case
      when c.evidence_completion_id is null then c.weigh_rows
      else 0
    end)::bigint
  from bill_counts c
  left join public.locations l on l.id = c.location_id
  group by c.location_id, coalesce(l.name, 'ไม่ทราบสาขา')
  order by sum(c.weigh_rows) desc, coalesce(l.name, 'ไม่ทราบสาขา');
end;
$$;

revoke all on function public.claim_telegram_evidence_dispatch()
  from public, anon, authenticated;
revoke all on function public.complete_telegram_evidence_dispatch(uuid)
  from public, anon, authenticated;
revoke all on function public.is_telegram_evidence_dispatch_enabled()
  from public, anon, authenticated;
revoke all on function public.get_weight_evidence_digest()
  from public, anon, authenticated;
grant execute on function public.claim_telegram_evidence_dispatch() to service_role;
grant execute on function public.complete_telegram_evidence_dispatch(uuid) to service_role;
grant execute on function public.is_telegram_evidence_dispatch_enabled() to service_role;
grant execute on function public.get_weight_evidence_digest() to service_role;

notify pgrst, 'reload schema';

commit;
