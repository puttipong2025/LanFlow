-- Rubber Bill approval gate.
-- A request is persisted before any protected source mutation. Approval reuses
-- the existing authoritative sync function so revision, stock, report, and
-- money-transfer locks remain the final authority.

create table public.rubber_bill_approval_settings (
  id boolean primary key default true check (id = true),
  edit_window_minutes integer not null default 30 check (edit_window_minutes >= 0),
  configured_price numeric(12,2) check (configured_price is null or configured_price > 0),
  updated_by_user_id uuid references public.profiles(id),
  updated_by_name text,
  updated_by_phone text,
  updated_at timestamptz not null default now()
);

insert into public.rubber_bill_approval_settings (id)
values (true);

create table public.rubber_bill_approval_requests (
  id uuid primary key default gen_random_uuid(),
  operation text not null check (operation in ('create', 'update', 'delete')),
  request_status text not null default 'pending' check (request_status in ('pending', 'approved')),
  bill_id uuid references public.rubber_bills(id),
  location_id uuid not null references public.locations(id),
  client_temp_id text not null,
  idempotency_key text not null,
  base_revision_no integer not null,
  matched_reasons text[] not null check (cardinality(matched_reasons) > 0),
  configured_price_snapshot numeric(12,2),
  original_payload jsonb,
  proposed_payload jsonb not null,
  requested_by_user_id uuid not null references public.profiles(id),
  requested_by_name text not null,
  requested_by_phone text not null,
  requested_at timestamptz not null default now(),
  approved_by_user_id uuid references public.profiles(id),
  approved_by_name text,
  approved_by_phone text,
  approved_at timestamptz,
  created_bill_id uuid references public.rubber_bills(id),
  constraint rubber_bill_approval_request_shape check (
    (operation = 'create' and bill_id is null and original_payload is null)
    or
    (operation in ('update', 'delete') and bill_id is not null and original_payload is not null)
  ),
  constraint rubber_bill_approval_decision_shape check (
    (request_status = 'pending'
      and approved_by_user_id is null
      and approved_at is null)
    or
    (request_status = 'approved'
      and approved_by_user_id is not null
      and approved_at is not null)
  ),
  unique (idempotency_key)
);

create unique index rubber_bill_approval_one_pending_bill
  on public.rubber_bill_approval_requests(bill_id)
  where request_status = 'pending' and bill_id is not null;

create unique index rubber_bill_approval_one_pending_create
  on public.rubber_bill_approval_requests(client_temp_id)
  where request_status = 'pending' and operation = 'create';

create index rubber_bill_approval_queue
  on public.rubber_bill_approval_requests(request_status, requested_at desc);

create or replace function private.guard_approved_rubber_bill_request_history()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.request_status = 'approved' then
    raise exception 'ประวัติคำขอที่อนุมัติแล้วแก้ไขหรือลบไม่ได้';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger guard_approved_rubber_bill_request_history
  before update or delete on public.rubber_bill_approval_requests
  for each row execute function private.guard_approved_rubber_bill_request_history();

alter table public.rubber_bill_approval_settings enable row level security;
alter table public.rubber_bill_approval_requests enable row level security;

create policy "active users read rubber bill approval settings"
  on public.rubber_bill_approval_settings for select
  using (private.is_active_user());

create policy "system managers read rubber bill approval requests"
  on public.rubber_bill_approval_requests for select
  using (private.is_active_user() and public.can_access_super_admin_features());

revoke all on public.rubber_bill_approval_settings from anon, authenticated;
revoke all on public.rubber_bill_approval_requests from anon, authenticated;
grant select on public.rubber_bill_approval_settings to authenticated;
grant select on public.rubber_bill_approval_requests to authenticated;
grant all on public.rubber_bill_approval_settings to service_role;
grant all on public.rubber_bill_approval_requests to service_role;

-- Preserve item order for exact per-weigh-row price comparison.
alter table public.rubber_bill_items
  add column sequence_no integer;

with ordered as (
  select id,
    row_number() over (partition by bill_id order by created_at, id)::integer as sequence_no
  from public.rubber_bill_items
)
update public.rubber_bill_items i
set sequence_no = ordered.sequence_no
from ordered
where ordered.id = i.id;

create or replace function private.assign_rubber_bill_item_sequence()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.sequence_no is null then
    select coalesce(max(i.sequence_no), 0) + 1
      into new.sequence_no
    from public.rubber_bill_items i
    where i.bill_id = new.bill_id;
  end if;
  return new;
end;
$$;

create trigger assign_rubber_bill_item_sequence
  before insert on public.rubber_bill_items
  for each row execute function private.assign_rubber_bill_item_sequence();

alter table public.rubber_bill_items
  alter column sequence_no set not null,
  add constraint rubber_bill_item_sequence_positive check (sequence_no > 0),
  add constraint rubber_bill_item_sequence_unique unique (bill_id, sequence_no);

create or replace function private.rubber_bill_has_pending_approval(p_bill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.rubber_bill_approval_requests r
    where r.bill_id = p_bill_id
      and r.request_status = 'pending'
  );
$$;

create or replace function private.current_rubber_bill_payload(p_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', b.revision_no,
    'clientTempId', b.client_temp_id,
    'idempotencyKey', b.idempotency_key,
    'locationId', b.location_id,
    'recordStatus', b.record_status,
    'localBillNo', b.local_bill_no,
    'billDate', b.bill_date,
    'customerId', b.customer_id,
    'customerName', b.customer_name,
    'customerType', b.customer_type,
    'billType', b.bill_type,
    'deductWeight', b.deduct_weight,
    'weight', b.weight,
    'rubberValue', b.rubber_value,
    'averagePrice', b.average_price,
    'deductionTotal', b.deduction_total,
    'netTotal', b.net_total,
    'cashPayment', b.cash_payment,
    'transferPayment', b.transfer_payment,
    'acidPackCount', b.acid_pack_count,
    'clientRecordedAt', b.client_recorded_at,
    'clientCreatedAt', b.client_created_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'itemType', i.item_type,
          'title', i.description,
          'description', i.description,
          'inWeight', i.weight_in,
          'outWeight', i.weight_out,
          'netWeight', i.net_weight,
          'stockProductId', i.stock_product_id,
          'quantity', i.quantity,
          'unit', i.unit,
          'unitPrice', i.price,
          'totalAmount', i.total,
          'sequenceNo', i.sequence_no
        )
        order by i.sequence_no
      )
      from public.rubber_bill_items i
      where i.bill_id = b.id
    ), '[]'::jsonb)
  )
  from public.rubber_bills b
  where b.id = p_bill_id;
$$;

create or replace function private.rubber_bill_has_active_transfer(p_bill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.money_transfer_items i
    join public.money_transfers t on t.id = i.transfer_id
    where i.source_type = 'rubber_bill'
      and i.source_id = p_bill_id
      and t.record_status <> 'deleted'
  );
$$;

alter function public.sync_rubber_bill(jsonb)
  rename to sync_rubber_bill_core_20260724020000;

revoke all on function public.sync_rubber_bill_core_20260724020000(jsonb)
  from public, anon, authenticated;

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_operation text := payload->>'operation';
  v_client_temp_id text := payload->>'clientTempId';
  v_location_id uuid;
  v_idempotency_key text := payload->>'idempotencyKey';
  v_expected_revision integer;
  v_bill public.rubber_bills%rowtype;
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_original_payload jsonb;
  v_current_prices jsonb := '[]'::jsonb;
  v_proposed_prices jsonb := '[]'::jsonb;
  v_price numeric;
  v_price_scale integer;
  v_has_mismatch boolean := false;
  v_reasons text[] := array[]::text[];
  v_request_id uuid;
  v_existing_request_status text;
  v_existing_created_bill_id uuid;
  v_actor_name text;
  v_actor_phone text;
  v_report_no text;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;

  if v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;

  begin
    v_location_id := (payload->>'locationId')::uuid;
    v_expected_revision := coalesce((payload->>'expectedRevisionNo')::integer, 0);
  exception when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid approval payload');
  end;

  if coalesce(v_client_temp_id, '') = ''
     or coalesce(v_idempotency_key, '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;

  select name, phone
    into v_actor_name, v_actor_phone
  from public.profiles
  where id = auth.uid();

  select *
    into v_settings
  from public.rubber_bill_approval_settings
  where id = true;

  if v_operation in ('create', 'update') then
    for v_price, v_price_scale in
      select (item->>'unitPrice')::numeric, scale((item->>'unitPrice')::numeric)
      from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) item
      where item->>'itemType' = 'weigh'
    loop
      if v_price < 0 or v_price_scale > 2 then
        return jsonb_build_object(
          'status', 'failed',
          'errorMessage', 'ราคายางต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง'
        );
      end if;
      if v_settings.configured_price is not null
         and v_price is distinct from v_settings.configured_price then
        v_has_mismatch := true;
      end if;
    end loop;

    select coalesce(jsonb_agg((item->>'unitPrice')::numeric order by (item->>'sequenceNo')::integer), '[]'::jsonb)
      into v_proposed_prices
    from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) item
    where item->>'itemType' = 'weigh';
  end if;

  if v_operation = 'create' then
    perform pg_advisory_xact_lock(hashtext('rubber-bill-create:' || v_client_temp_id));

    select id, request_status, created_bill_id
      into v_request_id, v_existing_request_status, v_existing_created_bill_id
    from public.rubber_bill_approval_requests
    where idempotency_key = v_idempotency_key;

    if v_request_id is not null then
      if v_existing_request_status = 'approved' and v_existing_created_bill_id is not null then
        select *
          into v_bill
        from public.rubber_bills
        where id = v_existing_created_bill_id;
        return jsonb_build_object(
          'status', 'synced',
          'id', v_bill.id,
          'serverBillNo', v_bill.server_bill_no,
          'revisionNo', v_bill.revision_no,
          'serverReceivedAt', v_bill.server_received_at
        );
      end if;
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;

    if v_settings.configured_price is null or not v_has_mismatch then
      return public.sync_rubber_bill_core_20260724020000(payload);
    end if;

    v_reasons := array_append(v_reasons, 'price');
  else
    select *
      into v_bill
    from public.rubber_bills
    where client_temp_id = v_client_temp_id
    for update;

    if v_bill.id is null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Cannot update or delete non-existent record');
    end if;

    perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_bill.id::text));

    if v_bill.location_id <> v_location_id then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'Location mismatch');
    end if;

    if v_bill.idempotency_key = v_idempotency_key then
      return jsonb_build_object(
        'status', 'synced',
        'id', v_bill.id,
        'serverBillNo', v_bill.server_bill_no,
        'revisionNo', v_bill.revision_no,
        'serverReceivedAt', v_bill.server_received_at
      );
    end if;

    if v_bill.revision_no <> v_expected_revision then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Revision mismatch');
    end if;

    select id
      into v_request_id
    from public.rubber_bill_approval_requests
    where bill_id = v_bill.id
      and request_status = 'pending';

    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;

    v_report_no := private.active_report_no('rubber_bill', v_bill.id);
    if v_report_no is not null then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'บิลอยู่ในรายงาน ' || v_report_no || ' แล้ว จึงสร้างคำขอไม่ได้'
      );
    end if;

    if private.rubber_bill_has_active_transfer(v_bill.id) then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'บิลอยู่ในรายการโอนเงินแล้ว จึงสร้างคำขอไม่ได้'
      );
    end if;

    if clock_timestamp() >= v_bill.created_at + make_interval(mins => v_settings.edit_window_minutes) then
      v_reasons := array_append(v_reasons, 'time');
    end if;

    if v_operation = 'update' and v_settings.configured_price is not null then
      select coalesce(jsonb_agg(i.price order by i.sequence_no), '[]'::jsonb)
        into v_current_prices
      from public.rubber_bill_items i
      where i.bill_id = v_bill.id
        and i.item_type = 'weigh';

      if v_current_prices is distinct from v_proposed_prices and v_has_mismatch then
        v_reasons := array_append(v_reasons, 'price');
      end if;
    end if;

    if cardinality(v_reasons) = 0 then
      return public.sync_rubber_bill_core_20260724020000(payload);
    end if;

    v_original_payload := private.current_rubber_bill_payload(v_bill.id);
  end if;

  insert into public.rubber_bill_approval_requests (
    operation,
    bill_id,
    location_id,
    client_temp_id,
    idempotency_key,
    base_revision_no,
    matched_reasons,
    configured_price_snapshot,
    original_payload,
    proposed_payload,
    requested_by_user_id,
    requested_by_name,
    requested_by_phone
  )
  values (
    v_operation,
    v_bill.id,
    v_location_id,
    v_client_temp_id,
    v_idempotency_key,
    v_expected_revision,
    v_reasons,
    v_settings.configured_price,
    v_original_payload,
    payload,
    auth.uid(),
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, '')
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending_approval',
    'requestId', v_request_id,
    'operation', v_operation,
    'clientTempId', v_client_temp_id,
    'matchedReasons', to_jsonb(v_reasons)
  );
exception
  when unique_violation then
    select id
      into v_request_id
    from public.rubber_bill_approval_requests
    where request_status = 'pending'
      and (
        idempotency_key = v_idempotency_key
        or bill_id = v_bill.id
        or (operation = 'create' and client_temp_id = v_client_temp_id)
      )
    order by requested_at desc
    limit 1;

    if v_request_id is not null then
      return jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_request_id,
        'operation', v_operation,
        'clientTempId', v_client_temp_id
      );
    end if;
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
  when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

create or replace function public.save_rubber_bill_approval_settings(
  p_edit_window_minutes integer,
  p_configured_price numeric
)
returns public.rubber_bill_approval_settings
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_result public.rubber_bill_approval_settings%rowtype;
  v_actor_name text;
  v_actor_phone text;
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์ตั้งค่าการอนุมัติบิลยาง';
  end if;
  if p_edit_window_minutes is null or p_edit_window_minutes < 0 then
    raise exception 'จำนวนนาทีต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  if p_configured_price is not null
     and (p_configured_price <= 0 or scale(p_configured_price) > 2) then
    raise exception 'ราคายางต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;

  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bill_approval_settings
  set edit_window_minutes = p_edit_window_minutes,
      configured_price = p_configured_price,
      updated_by_user_id = auth.uid(),
      updated_by_name = coalesce(v_actor_name, ''),
      updated_by_phone = coalesce(v_actor_phone, ''),
      updated_at = now()
  where id = true
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.save_rubber_bill_approval_settings(integer, numeric)
  from public, anon;
grant execute on function public.save_rubber_bill_approval_settings(integer, numeric)
  to authenticated;

create or replace function public.list_rubber_bill_approval_markers(p_location_id uuid)
returns table (
  request_id uuid,
  bill_id uuid,
  client_temp_id text,
  operation text,
  matched_reasons text[],
  requested_at timestamptz,
  proposed_create_payload jsonb
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูคำขอของสาขานี้';
  end if;

  return query
  select
    r.id,
    r.bill_id,
    r.client_temp_id,
    r.operation,
    r.matched_reasons,
    r.requested_at,
    case when r.operation = 'create' then r.proposed_payload else null end
  from public.rubber_bill_approval_requests r
  where r.location_id = p_location_id
    and r.request_status = 'pending'
  order by r.requested_at desc;
end;
$$;

revoke all on function public.list_rubber_bill_approval_markers(uuid)
  from public, anon;
grant execute on function public.list_rubber_bill_approval_markers(uuid)
  to authenticated;

create or replace function public.approve_rubber_bill_approval_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.rubber_bill_approval_requests%rowtype;
  v_result jsonb;
  v_actor_name text;
  v_actor_phone text;
  v_created_bill_id uuid;
  v_report_no text;
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์อนุมัติคำขอบิลยาง';
  end if;

  select *
    into v_request
  from public.rubber_bill_approval_requests
  where id = p_request_id
  for update;

  if v_request.id is null or v_request.request_status <> 'pending' then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;

  if v_request.bill_id is not null then
    perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_request.bill_id::text));
    v_report_no := private.active_report_no('rubber_bill', v_request.bill_id);
    if v_report_no is not null then
      raise exception 'บิลอยู่ในรายงาน % แล้ว จึงอนุมัติไม่ได้', v_report_no;
    end if;
    if private.rubber_bill_has_active_transfer(v_request.bill_id) then
      raise exception 'บิลอยู่ในรายการโอนเงินแล้ว จึงอนุมัติไม่ได้';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('rubber-bill-create:' || v_request.client_temp_id));
  end if;

  v_result := public.sync_rubber_bill_core_20260724020000(v_request.proposed_payload);
  if v_result->>'status' <> 'synced' then
    raise exception '%', coalesce(v_result->>'errorMessage', 'อนุมัติคำขอไม่สำเร็จ');
  end if;

  v_created_bill_id := (v_result->>'id')::uuid;

  if v_request.operation = 'create' then
    update public.rubber_bills
    set created_by_user_id = v_request.requested_by_user_id,
        created_by_name = v_request.requested_by_name,
        created_by_phone = v_request.requested_by_phone
    where id = v_created_bill_id;
  end if;

  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bill_approval_requests
  set request_status = 'approved',
      approved_by_user_id = auth.uid(),
      approved_by_name = coalesce(v_actor_name, ''),
      approved_by_phone = coalesce(v_actor_phone, ''),
      approved_at = now(),
      created_bill_id = case when operation = 'create' then v_created_bill_id else null end
  where id = p_request_id;

  return jsonb_build_object(
    'status', 'approved',
    'requestId', p_request_id,
    'operation', v_request.operation,
    'billId', v_created_bill_id,
    'syncResult', v_result
  );
end;
$$;

revoke all on function public.approve_rubber_bill_approval_request(uuid)
  from public, anon;
grant execute on function public.approve_rubber_bill_approval_request(uuid)
  to authenticated;

create or replace function public.delete_rubber_bill_approval_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์ลบคำขอบิลยาง';
  end if;

  delete from public.rubber_bill_approval_requests
  where id = p_request_id
    and request_status = 'pending';

  if not found then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;
end;
$$;

revoke all on function public.delete_rubber_bill_approval_request(uuid)
  from public, anon;
grant execute on function public.delete_rubber_bill_approval_request(uuid)
  to authenticated;

-- Keep pending bills out of normal report generation. The trigger below closes
-- the race between candidate selection and a concurrent approval request.
do $$
declare
  v_definition text;
  v_anchor text := 'and b.server_bill_no is not null';
begin
  select pg_get_functiondef(
    'private.reportable_items(uuid, timestamptz)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate rubber bill report candidate predicate';
  end if;

  v_definition := replace(
    v_definition,
    v_anchor,
    v_anchor || E'\n      and not private.rubber_bill_has_pending_approval(b.id)'
  );
  execute v_definition;
end;
$$;

create or replace function private.guard_pending_rubber_bill_relation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_bill_id uuid;
begin
  if tg_table_name = 'report_items' then
    if new.entity_type <> 'rubber_bill' or new.active <> true then
      return new;
    end if;
    v_bill_id := new.entity_id;
  else
    if new.source_type <> 'rubber_bill' then
      return new;
    end if;
    v_bill_id := new.source_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_bill_id::text));
  if private.rubber_bill_has_pending_approval(v_bill_id) then
    raise exception 'บิลยางกำลังรออนุมัติ จึงนำไปทำรายงานหรือโอนเงินไม่ได้';
  end if;
  return new;
end;
$$;

create trigger pending_rubber_bill_blocks_report
  before insert or update on public.report_items
  for each row execute function private.guard_pending_rubber_bill_relation();

create trigger pending_rubber_bill_blocks_money_transfer
  before insert or update on public.money_transfer_items
  for each row execute function private.guard_pending_rubber_bill_relation();
