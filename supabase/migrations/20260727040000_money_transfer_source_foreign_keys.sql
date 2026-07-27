-- Give every money-transfer item a real FK to exactly one supported source.
-- Legacy source_type/source_id stays in place for existing reports and clients.

alter table public.money_transfer_items
  add column if not exists rubber_bill_id uuid,
  add column if not exists ocr_ticket_id uuid;

do $$
begin
  if exists (
    select 1
    from public.money_transfer_items i
    join public.money_transfers t on t.id = i.transfer_id
    left join public.rubber_bills rb
      on i.source_type = 'rubber_bill'
     and rb.id = i.source_id
    left join public.ocr_tickets ot
      on i.source_type = 'ocr_ticket'
     and ot.id = i.source_id
    where (i.source_type = 'rubber_bill' and rb.id is null)
       or (i.source_type = 'ocr_ticket' and ot.id is null)
       or (i.source_type = 'rubber_bill' and rb.location_id <> t.location_id)
       or (i.source_type = 'ocr_ticket' and ot.location_id <> t.location_id)
       or (i.source_type = 'rubber_bill' and rb.record_status = 'deleted')
       or (i.source_type = 'ocr_ticket' and ot.record_status = 'deleted')
       or t.record_status = 'deleted'
  ) then
    raise exception 'money_transfer_items contains an orphaned, mismatched, or cross-location source; repair the test data before applying this migration';
  end if;
end
$$;

update public.money_transfer_items
set rubber_bill_id = source_id,
    ocr_ticket_id = null
where source_type = 'rubber_bill';

update public.money_transfer_items
set rubber_bill_id = null,
    ocr_ticket_id = source_id
where source_type = 'ocr_ticket';

alter table public.money_transfer_items
  drop constraint if exists money_transfer_items_rubber_bill_fk,
  add constraint money_transfer_items_rubber_bill_fk
    foreign key (rubber_bill_id)
    references public.rubber_bills(id)
    on delete restrict,
  drop constraint if exists money_transfer_items_ocr_ticket_fk,
  add constraint money_transfer_items_ocr_ticket_fk
    foreign key (ocr_ticket_id)
    references public.ocr_tickets(id)
    on delete restrict,
  drop constraint if exists money_transfer_items_source_fk_shape_check,
  add constraint money_transfer_items_source_fk_shape_check check (
    (
      source_type = 'rubber_bill'
      and rubber_bill_id is not null
      and rubber_bill_id = source_id
      and ocr_ticket_id is null
    )
    or
    (
      source_type = 'ocr_ticket'
      and ocr_ticket_id is not null
      and ocr_ticket_id = source_id
      and rubber_bill_id is null
    )
  );

create or replace function public.sync_money_transfer_item_source_fks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transfer_location_id uuid;
  v_source_location_id uuid;
begin
  select t.location_id
  into v_transfer_location_id
  from public.money_transfers t
  where t.id = new.transfer_id
    and t.record_status <> 'deleted'
  for update;

  if v_transfer_location_id is null then
    raise exception 'money transfer not found';
  end if;

  if new.source_type = 'rubber_bill' then
    if new.rubber_bill_id is not null and new.rubber_bill_id <> new.source_id then
      raise exception 'rubber_bill_id must match source_id';
    end if;
    new.rubber_bill_id := new.source_id;
    new.ocr_ticket_id := null;
    select rb.location_id
    into v_source_location_id
    from public.rubber_bills rb
    where rb.id = new.rubber_bill_id
      and rb.record_status <> 'deleted'
    for update;
  elsif new.source_type = 'ocr_ticket' then
    if new.ocr_ticket_id is not null and new.ocr_ticket_id <> new.source_id then
      raise exception 'ocr_ticket_id must match source_id';
    end if;
    new.rubber_bill_id := null;
    new.ocr_ticket_id := new.source_id;
    select ot.location_id
    into v_source_location_id
    from public.ocr_tickets ot
    where ot.id = new.ocr_ticket_id
      and ot.record_status <> 'deleted'
    for update;
  else
    raise exception 'unsupported money transfer source type: %', new.source_type;
  end if;

  if v_source_location_id is null then
    raise exception 'money transfer source not found';
  end if;

  if v_source_location_id <> v_transfer_location_id then
    raise exception 'money transfer source must belong to the transfer location';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_money_transfer_item_source_fks() from public, anon, authenticated;

drop trigger if exists money_transfer_items_sync_source_fks on public.money_transfer_items;
create trigger money_transfer_items_sync_source_fks
  before insert or update of source_type, source_id, rubber_bill_id, ocr_ticket_id
  on public.money_transfer_items
  for each row
  execute function public.sync_money_transfer_item_source_fks();

create or replace function public.get_money_transfer_receipt_source_details(p_transfer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
  v_items jsonb;
begin
  if not private.is_active_user() then
    raise exception 'Unauthorized or inactive user';
  end if;

  if not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;

  select t.location_id
  into v_location_id
  from public.money_transfers t
  where t.id = p_transfer_id
    and t.record_status <> 'deleted';

  if v_location_id is null then
    raise exception 'Money transfer not found';
  end if;

  if not private.can_access_location(v_location_id) then
    raise exception 'Location access denied';
  end if;

  if exists (
    select 1
    from public.money_transfer_items i
    left join public.rubber_bills rb on rb.id = i.rubber_bill_id
    left join public.ocr_tickets ot on ot.id = i.ocr_ticket_id
    where i.transfer_id = p_transfer_id
      and (
        (i.source_type = 'rubber_bill' and rb.id is null)
        or (i.source_type = 'ocr_ticket' and ot.id is null)
        or (i.source_type = 'rubber_bill' and rb.location_id <> v_location_id)
        or (i.source_type = 'ocr_ticket' and ot.location_id <> v_location_id)
        or (i.source_type = 'rubber_bill' and rb.record_status = 'deleted')
        or (i.source_type = 'ocr_ticket' and ot.record_status = 'deleted')
      )
  ) then
    raise exception 'Money transfer source is missing or belongs to another location';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'itemId', i.id,
        'sourceType', i.source_type,
        'sourceId', i.source_id,
        'netWeightAfterDeduction',
          case
            when i.source_type = 'rubber_bill' then rb.weight - rb.deduct_weight
            else coalesce(ot.weight_remaining, 0)
          end,
        'deductedAmount',
          case
            when i.source_type = 'rubber_bill' then rb.deduction_total
            else ot.money_deducted
          end,
        'netPayableAmount',
          case
            when i.source_type = 'rubber_bill' then rb.net_total
            else coalesce(ot.total_amount, 0) - coalesce(ot.money_deducted, 0)
          end
      )
      order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
  into v_items
  from public.money_transfer_items i
  left join public.rubber_bills rb on rb.id = i.rubber_bill_id
  left join public.ocr_tickets ot on ot.id = i.ocr_ticket_id
  where i.transfer_id = p_transfer_id;

  return jsonb_build_object(
    'transferId', p_transfer_id,
    'items', v_items
  );
end;
$$;

revoke all on function public.get_money_transfer_receipt_source_details(uuid) from public, anon;
grant execute on function public.get_money_transfer_receipt_source_details(uuid) to authenticated;
