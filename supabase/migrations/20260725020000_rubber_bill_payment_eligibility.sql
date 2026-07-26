create index if not exists rubber_bill_items_payable_lookup
  on public.rubber_bill_items (bill_id, item_type, price);

create or replace function private.rubber_bill_is_payable(p_bill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.rubber_bills b
    where b.id = p_bill_id
      and b.record_status = 'active'
      and b.sync_status = 'synced'
      and b.server_bill_no is not null
      and b.net_total > 0
      and exists (
        select 1
        from public.rubber_bill_items i
        where i.bill_id = b.id
          and i.item_type = 'weigh'
      )
      and not exists (
        select 1
        from public.rubber_bill_items i
        where i.bill_id = b.id
          and i.item_type = 'weigh'
          and coalesce(i.price, 0) <= 0
      )
  );
$$;

revoke all on function private.rubber_bill_is_payable(uuid)
  from public, anon, authenticated;

do $$
declare
  v_definition text;
  v_anchor text := 'and not private.rubber_bill_has_pending_approval(b.id)';
begin
  select pg_get_functiondef(
    'private.reportable_items(uuid,timestamptz)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate Rubber Bill report approval predicate';
  end if;

  v_definition := replace(
    v_definition,
    v_anchor,
    v_anchor || E'\n      and private.rubber_bill_is_payable(b.id)'
  );
  execute v_definition;
end;
$$;

do $$
declare
  v_definition text;
  v_anchor text :=
    'where rb.location_id = p_location_id and rb.record_status = ''active'' and rb.net_total > 0';
begin
  select pg_get_functiondef(
    'public.get_income_expense_feed(uuid,date,date,date,text,integer)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate Rubber Bill Income/Expense feed predicate';
  end if;

  v_definition := replace(
    v_definition,
    v_anchor,
    v_anchor || E'\n          and private.rubber_bill_is_payable(rb.id)'
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

  if not private.rubber_bill_is_payable(v_bill_id) then
    raise exception 'บิลยางยังมีรายการราคา 0 หรือยอดสุทธิไม่มากกว่า 0 จึงนำไปทำรายงานหรือโอนเงินไม่ได้';
  end if;

  return new;
end;
$$;
