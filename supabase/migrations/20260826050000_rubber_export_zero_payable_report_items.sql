-- Keep zero-payable, positive-value rubber available for Report Batch and Rubber Export.

begin;

create or replace function private.rubber_bill_is_export_reportable(p_bill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rubber_bills b
    where b.id = p_bill_id
      and b.record_status = 'active'
      and b.sync_status = 'synced'
      and b.server_bill_no is not null
      and b.net_weight > 0
      and b.net_rubber_value > 0
      and b.net_total >= 0
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

comment on function private.rubber_bill_is_export_reportable(uuid) is
  'True when a synced rubber bill has positive net rubber weight/value and priced weigh items, even when customer payable is zero.';

do $$
declare
  v_definition text := pg_get_functiondef(
    'private.reportable_items(uuid,timestamptz)'::regprocedure
  );
  v_old text :=
    'and (private.rubber_bill_is_payable(b.id) or private.rubber_bill_is_branch_receipt_reportable(b.id))';
  v_new text :=
    'and (private.rubber_bill_is_payable(b.id)'
    || ' or private.rubber_bill_is_branch_receipt_reportable(b.id)'
    || ' or private.rubber_bill_is_export_reportable(b.id))';
begin
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'RUBBER_EXPORT_REPORTABLE_ITEMS_ANCHOR_MISMATCH';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

create or replace function private.guard_pending_rubber_bill_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill_id uuid;
begin
  if tg_table_name = 'report_items' then
    if new.entity_type <> 'rubber_bill' or new.active <> true then return new; end if;
    v_bill_id := new.entity_id;
  else
    if new.source_type <> 'rubber_bill' then return new; end if;
    v_bill_id := new.source_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_bill_id::text));
  if private.rubber_bill_has_pending_approval(v_bill_id) then
    raise exception 'บิลยางกำลังรออนุมัติ จึงนำไปทำรายงานหรือโอนเงินไม่ได้';
  end if;
  if tg_table_name = 'report_items'
     and (
       private.rubber_bill_is_branch_receipt_reportable(v_bill_id)
       or private.rubber_bill_is_export_reportable(v_bill_id)
     ) then
    return new;
  end if;
  if not private.rubber_bill_is_payable(v_bill_id) then
    raise exception 'บิลยางยังมีรายการราคา 0 หรือยอดสุทธิไม่มากกว่า 0 จึงนำไปทำรายงานหรือโอนเงินไม่ได้';
  end if;
  return new;
end;
$$;

revoke all on function private.rubber_bill_is_export_reportable(uuid)
from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
